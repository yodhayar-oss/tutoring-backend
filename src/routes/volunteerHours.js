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

// Admin sends a volunteer-hours-completed PDF to a specific tutor
router.post('/:tutorId', asyncHandler(requireAdmin), pdfUpload.single('pdf'), asyncHandler(async (req, res) => {
  const tutor = await get('SELECT id FROM tutors WHERE id = ?', [req.params.tutorId]);
  if (!tutor) return res.status(404).json({ error: 'Tutor not found.' });
  if (!req.file) return res.status(400).json({ error: 'No PDF received.' });
  const id = 'vh_' + crypto.randomUUID();
  const title = ((req.body && req.body.title) ? String(req.body.title) : '').slice(0, 140) || 'Volunteer hours completed';
  const base64 = req.file.buffer.toString('base64');
  await run(
    `INSERT INTO volunteer_hours_docs (id, tutor_id, file_data, file_mime, original_name, title, uploaded_by_admin_id, created_at)
     VALUES (?,?,?,?,?,?,?,?)`,
    [id, tutor.id, base64, req.file.mimetype || 'application/pdf', req.file.originalname || 'volunteer-hours.pdf', title, req.adminId, Date.now()]
  );
  res.status(201).json(serializeVolDoc(await get('SELECT * FROM volunteer_hours_docs WHERE id = ?', [id])));
}));

// Admin: list every document sent to a specific tutor
router.get('/for-tutor/:tutorId', asyncHandler(requireAdmin), asyncHandler(async (req, res) => {
  const rows = await all('SELECT * FROM volunteer_hours_docs WHERE tutor_id = ? ORDER BY created_at DESC', [req.params.tutorId]);
  res.json(rows.map(serializeVolDoc));
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
