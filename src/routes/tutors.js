const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const { get, all, run } = require('../db');
const { serializeTutor, serializeVolDoc } = require('../serialize');
const { requireTutor, requireAdmin } = require('../auth-middleware');
const { setAuthCookie, clearAuthCookie } = require('../auth');
const asyncHandler = require('../async-handler');

const router = express.Router();
function isValidEmail(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e); }

const formUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 4 * 1024 * 1024 },
  fileFilter: (req, file, cb) => file.mimetype.startsWith('image/') ? cb(null, true) : cb(new Error('Only image uploads are allowed.'))
});

router.post('/signup', asyncHandler(async (req, res) => {
  const { email, password, confirmPassword } = req.body || {};
  if (!isValidEmail(email || '')) return res.status(400).json({ error: 'Enter a valid school email.' });
  if (!password || password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  if (password !== confirmPassword) return res.status(400).json({ error: 'Passwords do not match.' });
  const emailLower = email.toLowerCase();
  if (await get('SELECT id FROM tutors WHERE email = ?', [emailLower])) {
    return res.status(409).json({ error: 'An account with that email already exists. Try signing in instead.' });
  }
  const id = 'tu_' + crypto.randomUUID();
  const passwordHash = await bcrypt.hash(password, 12);
  await run(
    `INSERT INTO tutors (id, email, password_hash, verification_status, created_at) VALUES (?,?,?,?,?)`,
    [id, emailLower, passwordHash, 'unsubmitted', Date.now()]
  );
  setAuthCookie(res, { kind: 'tutor', id });
  res.status(201).json(serializeTutor(await get('SELECT * FROM tutors WHERE id = ?', [id])));
}));

router.post('/login', asyncHandler(async (req, res) => {
  const { email, password } = req.body || {};
  const tutor = await get('SELECT * FROM tutors WHERE email = ?', [(email || '').toLowerCase()]);
  if (!tutor || !(await bcrypt.compare(password || '', tutor.password_hash))) {
    return res.status(401).json({ error: 'Incorrect email or password.' });
  }
  setAuthCookie(res, { kind: 'tutor', id: tutor.id });
  res.json(serializeTutor(tutor));
}));

router.post('/logout', (req, res) => {
  clearAuthCookie(res);
  res.json({ ok: true });
});

router.get('/me', asyncHandler(requireTutor), asyncHandler(async (req, res) => {
  const tutor = await get('SELECT * FROM tutors WHERE id = ?', [req.tutorId]);
  if (!tutor) return res.status(404).json({ error: 'Not found.' });
  res.json(serializeTutor(tutor));
}));

// Upload a photo of the completed verification form (a paper form — NOT a
// school ID card; earlier versions of this app mislabeled this step).
router.post('/verification-form', asyncHandler(requireTutor), formUpload.single('photo'), asyncHandler(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No photo received.' });
  const base64 = req.file.buffer.toString('base64');
  await run(
    `UPDATE tutors SET verification_form_data = ?, verification_form_mime = ?, verification_status = 'pending' WHERE id = ?`,
    [base64, req.file.mimetype, req.tutorId]
  );
  res.json({ ok: true, verificationStatus: 'pending' });
}));

// Admin views a tutor's verification form photo
router.get('/:id/verification-form', asyncHandler(requireAdmin), asyncHandler(async (req, res) => {
  const tutor = await get('SELECT * FROM tutors WHERE id = ?', [req.params.id]);
  if (!tutor || !tutor.verification_form_data) return res.status(404).json({ error: 'No form on file.' });
  res.set('Content-Type', tutor.verification_form_mime || 'image/jpeg');
  res.send(Buffer.from(tutor.verification_form_data, 'base64'));
}));

// Tutor: list volunteer-hours PDFs an admin has sent me
router.get('/volunteer-hours', asyncHandler(requireTutor), asyncHandler(async (req, res) => {
  const rows = await all('SELECT * FROM volunteer_hours_docs WHERE tutor_id = ? ORDER BY created_at DESC', [req.tutorId]);
  res.json(rows.map(serializeVolDoc));
}));

module.exports = router;
