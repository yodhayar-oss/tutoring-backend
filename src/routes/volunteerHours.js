const express = require('express');
const crypto = require('crypto');
const multer = require('multer');
const { get, all, run } = require('../db');
const { serializeVolDoc } = require('../serialize');
const { requireAdmin } = require('../auth-middleware');
const { readAuth } = require('../auth');
const asyncHandler = require('../async-handler');

const router = express.Router();

const pdfUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => file.mimetype === 'application/pdf' ? cb(null, true) : cb(new Error('Only PDF files are allowed.'))
});

// Admin sends one volunteer-hours-completed PDF to one or more tutors. The
// same file is stored once per tutor, so each of them can download their own
// copy and deleting one tutor never takes another's document with it.
//
// `tutorIds` arrives from a multipart form, which can't carry arrays, so it
// accepts either repeated fields or one comma-separated value.
router.post('/', asyncHandler(requireAdmin), pdfUpload.single('pdf'), asyncHandler(async (req, res) => {
  const requested = parseTutorIds(req.body && req.body.tutorIds);
  if (!requested.length) return res.status(400).json({ error: 'Choose at least one tutor to send this to.' });
  if (!req.file) return res.status(400).json({ error: 'No PDF received.' });

  const found = await all(
    `SELECT id, email FROM tutors WHERE id IN (${requested.map(() => '?').join(',')})`,
    requested
  );
  const missing = requested.filter(id => !found.some(t => t.id === id));
  if (missing.length) {
    return res.status(404).json({ error: `${missing.length} of the tutors you picked no longer exist. Refresh and try again.` });
  }

  const title = ((req.body && req.body.title) ? String(req.body.title) : '').slice(0, 140) || 'Volunteer hours completed';
  const base64 = req.file.buffer.toString('base64');
  const mime = req.file.mimetype || 'application/pdf';
  const originalName = req.file.originalname || 'volunteer-hours.pdf';
  const now = Date.now();

  for (const tutor of found) {
    await run(
      `INSERT INTO volunteer_hours_docs (id, tutor_id, file_data, file_mime, original_name, title, uploaded_by_admin_id, created_at)
       VALUES (?,?,?,?,?,?,?,?)`,
      ['vh_' + crypto.randomUUID(), tutor.id, base64, mime, originalName, title, req.adminId, now]
    );
  }

  res.status(201).json({ ok: true, sent: found.length, tutors: found.map(t => t.email) });
}));

function parseTutorIds(raw) {
  const list = Array.isArray(raw) ? raw : (raw === undefined || raw === null ? [] : [raw]);
  const flat = list.flatMap(v => String(v).split(',')).map(s => s.trim()).filter(Boolean);
  return [...new Set(flat)]; // the same tutor twice shouldn't mean two copies
}

// Admin: every document sent so far, newest first, with the tutor it went to.
router.get('/all', asyncHandler(requireAdmin), asyncHandler(async (req, res) => {
  const rows = await all(`
    SELECT d.*, t.email AS tutor_email
    FROM volunteer_hours_docs d
    LEFT JOIN tutors t ON t.id = d.tutor_id
    ORDER BY d.created_at DESC
  `);
  res.json(rows.map(d => ({ ...serializeVolDoc(d), tutorEmail: d.tutor_email })));
}));

// Download a PDF — the owning tutor, or any admin
router.get('/:id/file', asyncHandler(async (req, res) => {
  const doc = await get('SELECT * FROM volunteer_hours_docs WHERE id = ?', [req.params.id]);
  if (!doc) return res.status(404).json({ error: 'Not found.' });
  const auth = readAuth(req);
  const isAdmin = auth && auth.kind === 'admin';
  const isOwningTutor = auth && auth.kind === 'tutor' && auth.id === doc.tutor_id;
  if (!isAdmin && !isOwningTutor) return res.status(403).json({ error: 'Not authorized.' });
  res.set('Content-Type', doc.file_mime || 'application/pdf');
  res.set('Content-Disposition', `attachment; filename="${(doc.original_name || 'volunteer-hours.pdf').replace(/"/g, '')}"`);
  res.send(Buffer.from(doc.file_data, 'base64'));
}));

module.exports = router;
