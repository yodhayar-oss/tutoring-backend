const express = require('express');
const bcrypt = require('bcryptjs');
const { get, all, run } = require('../db');
const { serializeTutor } = require('../serialize');
const { requireAdmin } = require('../auth-middleware');
const { setAuthCookie, clearAuthCookie } = require('../auth');
const asyncHandler = require('../async-handler');

const router = express.Router();

router.post('/login', asyncHandler(async (req, res) => {
  const { email, password } = req.body || {};
  const admin = await get('SELECT * FROM admins WHERE email = ?', [(email || '').toLowerCase()]);
  if (!admin || !(await bcrypt.compare(password || '', admin.password_hash))) {
    return res.status(401).json({ error: 'Incorrect email or password.' });
  }
  setAuthCookie(res, { kind: 'admin', id: admin.id });
  res.json({ id: admin.id, email: admin.email, mustChangePassword: !!admin.must_change_password });
}));

router.post('/logout', (req, res) => {
  clearAuthCookie(res);
  res.json({ ok: true });
});

router.get('/me', asyncHandler(requireAdmin), asyncHandler(async (req, res) => {
  const admin = await get('SELECT * FROM admins WHERE id = ?', [req.adminId]);
  if (!admin) return res.status(404).json({ error: 'Not found.' });
  res.json({ id: admin.id, email: admin.email, mustChangePassword: !!admin.must_change_password });
}));

router.post('/change-password', asyncHandler(requireAdmin), asyncHandler(async (req, res) => {
  const admin = await get('SELECT * FROM admins WHERE id = ?', [req.adminId]);
  const { currentPassword, newPassword, confirmPassword } = req.body || {};
  if (!(await bcrypt.compare(currentPassword || '', admin.password_hash))) {
    return res.status(401).json({ error: 'Current password is incorrect.' });
  }
  if (!newPassword || newPassword.length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters.' });
  if (newPassword !== confirmPassword) return res.status(400).json({ error: 'New passwords do not match.' });
  const hash = await bcrypt.hash(newPassword, 12);
  await run('UPDATE admins SET password_hash = ?, must_change_password = 0 WHERE id = ?', [hash, admin.id]);
  res.json({ ok: true });
}));

router.get('/tutors', asyncHandler(requireAdmin), asyncHandler(async (req, res) => {
  const rows = await all('SELECT * FROM tutors ORDER BY created_at DESC');
  res.json(rows.map(serializeTutor));
}));

router.post('/tutors/:id/approve', asyncHandler(requireAdmin), asyncHandler(async (req, res) => {
  const r = await run("UPDATE tutors SET verification_status = 'approved' WHERE id = ?", [req.params.id]);
  if (!r.changes) return res.status(404).json({ error: 'Not found.' });
  res.json({ ok: true });
}));

router.post('/tutors/:id/reject', asyncHandler(requireAdmin), asyncHandler(async (req, res) => {
  const r = await run("UPDATE tutors SET verification_status = 'rejected' WHERE id = ?", [req.params.id]);
  if (!r.changes) return res.status(404).json({ error: 'Not found.' });
  res.json({ ok: true });
}));

// Danger zone: wipes tickets, tutors, and volunteer-hours docs (keeps admin
// accounts so you can't lock yourself out). No files to clean up anymore —
// everything lives as rows in the database.
router.post('/reset', asyncHandler(requireAdmin), asyncHandler(async (req, res) => {
  await run('DELETE FROM tickets');
  await run('DELETE FROM tutors');
  await run('DELETE FROM volunteer_hours_docs');
  res.json({ ok: true });
}));

module.exports = router;
