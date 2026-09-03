const express = require('express');
const crypto = require('crypto');
const multer = require('multer');
const { get, all, run } = require('../db');
const {
  SUBJECTS, TUTEE_CUTOFF, TUTOR_CUTOFF, MAX_PER_SUBJECT_PER_DAY,
  isDateEligibleForSubject, getEligibleDates, fmtISO, parseISO, todayMidnight
} = require('../eligibility');
const { serializeTicket } = require('../serialize');
const { requireActor, requireAdmin } = require('../auth-middleware');
const { readAuth } = require('../auth');
const asyncHandler = require('../async-handler');

const router = express.Router();
function isValidEmail(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e); }

// Photos are kept in memory just long enough to base64-encode them into the
// database — nothing ever touches the server's local disk.
const proofUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 4 * 1024 * 1024 },
  fileFilter: (req, file, cb) => file.mimetype.startsWith('image/') ? cb(null, true) : cb(new Error('Only image uploads are allowed.'))
});

// --- Tutee: submit a request ---
router.post('/', asyncHandler(async (req, res) => {
  const { tuteeName, tuteeEmail, subjectKey, subOption, date, note } = req.body || {};
  if (!tuteeName || !tuteeEmail || !subjectKey || !date) {
    return res.status(400).json({ error: 'Name, email, subject, and day are required.' });
  }
  if (!isValidEmail(tuteeEmail)) return res.status(400).json({ error: 'Enter a valid email address.' });
  const subj = SUBJECTS[subjectKey];
  if (!subj) return res.status(400).json({ error: 'Unknown subject.' });
  if (subj.subOptions && !subj.subOptions.includes(subOption)) {
    return res.status(400).json({ error: 'Choose a valid course level.' });
  }
  if (!isDateEligibleForSubject(subjectKey, date, new Date(), TUTEE_CUTOFF.h, TUTEE_CUTOFF.m)) {
    return res.status(400).json({ error: 'That day is no longer available. Please pick another day.' });
  }
  const id = 'tk_' + crypto.randomUUID();
  await run(
    `INSERT INTO tickets (id, tutee_name, tutee_email, subject_key, sub_option, date, note, status, created_at)
     VALUES (?,?,?,?,?,?,?, 'open', ?)`,
    [id, String(tuteeName).slice(0, 120), tuteeEmail.toLowerCase(), subjectKey, subj.subOptions ? subOption : null, date, (note || '').slice(0, 1000), Date.now()]
  );
  res.status(201).json(serializeTicket(await get('SELECT * FROM tickets WHERE id = ?', [id])));
}));

// --- Tutee: look up requests by email ---
router.get('/', asyncHandler(async (req, res) => {
  const email = (req.query.email || '').toLowerCase().trim();
  if (!email) return res.status(400).json({ error: 'An email is required to look up requests.' });
  const rows = await all('SELECT * FROM tickets WHERE tutee_email = ? ORDER BY date ASC, created_at ASC', [email]);
  res.json(rows.map(serializeTicket));
}));

// --- Open tickets within the signed-in actor's own sign-up window ---
router.get('/open', asyncHandler(requireActor), asyncHandler(async (req, res) => {
  const allowedDates = new Set(getEligibleDates(new Date(), TUTOR_CUTOFF.h, TUTOR_CUTOFF.m).map(fmtISO));
  const rows = await all("SELECT * FROM tickets WHERE status = 'open'");
  res.json(rows.filter(t => allowedDates.has(t.date)).map(serializeTicket));
}));

// --- Tickets claimed by the signed-in actor ---
router.get('/mine', asyncHandler(requireActor), asyncHandler(async (req, res) => {
  const rows = await all('SELECT * FROM tickets WHERE tutor_id = ? ORDER BY date ASC', [req.actor.id]);
  res.json(rows.map(serializeTicket));
}));

// --- All tickets (admin) ---
router.get('/all', asyncHandler(requireAdmin), asyncHandler(async (req, res) => {
  const rows = await all('SELECT * FROM tickets ORDER BY date ASC, created_at ASC');
  res.json(rows.map(serializeTicket));
}));

// --- Tutee: withdraw an open request (must supply the matching email) ---
router.delete('/:id', asyncHandler(async (req, res) => {
  const t = await get('SELECT * FROM tickets WHERE id = ?', [req.params.id]);
  if (!t) return res.status(404).json({ error: 'Not found.' });
  if (t.status !== 'open') return res.status(400).json({ error: 'Only open requests can be withdrawn.' });
  const email = ((req.body && req.body.tuteeEmail) || '').toLowerCase();
  if (email !== t.tutee_email) return res.status(403).json({ error: 'That email does not match this request.' });
  await run('DELETE FROM tickets WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
}));

// --- Claim a ticket (tutor, or admin acting as a tutor) ---
router.post('/:id/claim', asyncHandler(requireActor), asyncHandler(async (req, res) => {
  const t = await get('SELECT * FROM tickets WHERE id = ?', [req.params.id]);
  if (!t || t.status !== 'open') return res.status(400).json({ error: 'That request is no longer open.' });
  const allowedDates = new Set(getEligibleDates(new Date(), TUTOR_CUTOFF.h, TUTOR_CUTOFF.m).map(fmtISO));
  if (!allowedDates.has(t.date)) return res.status(400).json({ error: 'That day is outside your current sign-up window.' });
  const countRow = await get(
    `SELECT COUNT(*) as c FROM tickets WHERE tutor_id = ? AND subject_key = ? AND date = ? AND status != 'cancelled'`,
    [req.actor.id, t.subject_key, t.date]
  );
  if ((countRow ? countRow.c : 0) >= MAX_PER_SUBJECT_PER_DAY) {
    return res.status(400).json({ error: `You've already signed up to tutor ${MAX_PER_SUBJECT_PER_DAY} students for this subject on that day.` });
  }
  await run(
    `UPDATE tickets SET status='claimed', tutor_id=?, tutor_email=?, claimed_at=? WHERE id=?`,
    [req.actor.id, req.actor.email, Date.now(), t.id]
  );
  res.json(serializeTicket(await get('SELECT * FROM tickets WHERE id = ?', [t.id])));
}));

// --- Self-cancel (tutor, or admin acting as a tutor) — allowed until the day before ---
router.post('/:id/cancel', asyncHandler(requireActor), asyncHandler(async (req, res) => {
  const t = await get('SELECT * FROM tickets WHERE id = ?', [req.params.id]);
  if (!t || t.tutor_id !== req.actor.id) return res.status(403).json({ error: 'This is not your session.' });
  if (!(parseISO(t.date).getTime() > todayMidnight().getTime())) {
    return res.status(400).json({ error: "This session is today, so it can't be cancelled anymore." });
  }
  await run(`UPDATE tickets SET status='open', tutor_id=NULL, tutor_email=NULL, claimed_at=NULL WHERE id=?`, [t.id]);
  res.json({ ok: true });
}));

// --- Admin: cancel any session, for any reason ---
router.post('/:id/admin-cancel', asyncHandler(requireAdmin), asyncHandler(async (req, res) => {
  const t = await get('SELECT * FROM tickets WHERE id = ?', [req.params.id]);
  if (!t) return res.status(404).json({ error: 'Not found.' });
  await run(`UPDATE tickets SET status='cancelled', cancelled_by='admin' WHERE id=?`, [t.id]);
  res.json({ ok: true });
}));

// --- Upload proof-of-tutoring photo — this is the "task" assigned the
//     moment a session is claimed, not gated by the session date. ---
router.post('/:id/proof-photo', asyncHandler(requireActor), proofUpload.single('photo'), asyncHandler(async (req, res) => {
  const t = await get('SELECT * FROM tickets WHERE id = ?', [req.params.id]);
  if (!t || t.tutor_id !== req.actor.id) return res.status(403).json({ error: 'This is not your session.' });
  if (t.status === 'cancelled') return res.status(400).json({ error: 'This session was cancelled.' });
  if (!req.file) return res.status(400).json({ error: 'No photo received.' });
  const base64 = req.file.buffer.toString('base64');
  await run(
    `UPDATE tickets SET proof_photo_data=?, proof_photo_mime=?, proof_submitted_at=?, status='completed' WHERE id=?`,
    [base64, req.file.mimetype, Date.now(), t.id]
  );
  res.json({ ok: true });
}));

// --- View proof photo: admin, or the tutor/admin-actor who submitted it ---
router.get('/:id/proof-photo', asyncHandler(async (req, res) => {
  const t = await get('SELECT * FROM tickets WHERE id = ?', [req.params.id]);
  if (!t || !t.proof_photo_data) return res.status(404).json({ error: 'No photo on file.' });
  const auth = readAuth(req);
  const isAdmin = auth && auth.kind === 'admin';
  const isOwningTutor = auth && auth.kind === 'tutor' && t.tutor_id === auth.id;
  const isOwningAdminActor = auth && auth.kind === 'admin' && t.tutor_id === ('admin:' + auth.id);
  if (!isAdmin && !isOwningTutor && !isOwningAdminActor) return res.status(403).json({ error: 'Not authorized to view this photo.' });
  res.set('Content-Type', t.proof_photo_mime || 'image/jpeg');
  res.send(Buffer.from(t.proof_photo_data, 'base64'));
}));

module.exports = router;
