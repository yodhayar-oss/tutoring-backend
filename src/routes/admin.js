const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { get, all, run } = require('../db');
const { serializeTutor, serializeAdmin } = require('../serialize');
const { requireAdmin, requireSuperAdmin } = require('../auth-middleware');
const { setAuthCookie, clearAuthCookie } = require('../auth');
const { normalizeEligibility } = require('../eligibility');
const asyncHandler = require('../async-handler');

const router = express.Router();
function isValidEmail(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e); }

router.post('/login', asyncHandler(async (req, res) => {
  const { email, password } = req.body || {};
  const admin = await get('SELECT * FROM admins WHERE email = ?', [(email || '').toLowerCase()]);
  if (!admin || !(await bcrypt.compare(password || '', admin.password_hash))) {
    return res.status(401).json({ error: 'Incorrect email or password.' });
  }
  setAuthCookie(res, { kind: 'admin', id: admin.id });
  res.json(serializeAdmin(admin));
}));

router.post('/logout', (req, res) => {
  clearAuthCookie(res);
  res.json({ ok: true });
});

router.get('/me', asyncHandler(requireAdmin), asyncHandler(async (req, res) => {
  const admin = await get('SELECT * FROM admins WHERE id = ?', [req.adminId]);
  if (!admin) return res.status(404).json({ error: 'Not found.' });
  res.json(serializeAdmin(admin));
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

/* ------------------------------- TUTORS ---------------------------------- */

router.get('/tutors', asyncHandler(requireAdmin), asyncHandler(async (req, res) => {
  const rows = await all('SELECT * FROM tutors ORDER BY created_at DESC');
  res.json(rows.map(serializeTutor));
}));

// Approving a tutor is also where an admin decides what they may teach, so
// the subject/level picker is required here rather than optional.
router.post('/tutors/:id/approve', asyncHandler(requireAdmin), asyncHandler(async (req, res) => {
  const tutor = await get('SELECT id FROM tutors WHERE id = ?', [req.params.id]);
  if (!tutor) return res.status(404).json({ error: 'Not found.' });
  const eligibility = normalizeEligibility((req.body || {}).eligibility);
  await run(
    "UPDATE tutors SET verification_status = 'approved', eligibility = ? WHERE id = ?",
    [JSON.stringify(eligibility), tutor.id]
  );
  res.json({ ok: true, eligibility });
}));

// Change what an already-approved tutor may teach, at any time.
router.put('/tutors/:id/eligibility', asyncHandler(requireAdmin), asyncHandler(async (req, res) => {
  const tutor = await get('SELECT id FROM tutors WHERE id = ?', [req.params.id]);
  if (!tutor) return res.status(404).json({ error: 'Not found.' });
  const eligibility = normalizeEligibility((req.body || {}).eligibility);
  await run('UPDATE tutors SET eligibility = ? WHERE id = ?', [JSON.stringify(eligibility), tutor.id]);
  res.json({ ok: true, eligibility });
}));

router.post('/tutors/:id/reject', asyncHandler(requireAdmin), asyncHandler(async (req, res) => {
  const r = await run("UPDATE tutors SET verification_status = 'rejected' WHERE id = ?", [req.params.id]);
  if (!r.changes) return res.status(404).json({ error: 'Not found.' });
  res.json({ ok: true });
}));

// Delete a tutor account outright. Sessions they had claimed but not yet
// completed go back on the open board so another tutor can pick them up;
// completed sessions are left alone so the record of who tutored whom
// survives. The browser asks for confirmation before calling this.
router.delete('/tutors/:id', asyncHandler(requireAdmin), asyncHandler(async (req, res) => {
  const tutor = await get('SELECT * FROM tutors WHERE id = ?', [req.params.id]);
  if (!tutor) return res.status(404).json({ error: 'Not found.' });

  const reopened = await run(
    `UPDATE tickets SET status = 'open', tutor_id = NULL, tutor_email = NULL, claimed_at = NULL
     WHERE tutor_id = ? AND status = 'claimed'`,
    [tutor.id]
  );
  await run('DELETE FROM volunteer_hours_docs WHERE tutor_id = ?', [tutor.id]);
  await run('DELETE FROM tutors WHERE id = ?', [tutor.id]);

  res.json({ ok: true, email: tutor.email, reopenedSessions: reopened.changes });
}));

/* ------------------------------- ADMINS -----------------------------------
   Only the owner admin (the first-run account, is_super = 1) can see or
   change this list. Admins it creates are ordinary admins — they can run the
   program, but not add or remove other admins. */

router.get('/admins', asyncHandler(requireSuperAdmin), asyncHandler(async (req, res) => {
  const rows = await all('SELECT * FROM admins ORDER BY is_super DESC, created_at ASC');
  res.json(rows.map(serializeAdmin));
}));

router.post('/admins', asyncHandler(requireSuperAdmin), asyncHandler(async (req, res) => {
  const { email, password, confirmPassword } = req.body || {};
  if (!isValidEmail(email || '')) return res.status(400).json({ error: 'Enter a valid email address.' });
  if (!password || password.length < 8) return res.status(400).json({ error: 'Temporary password must be at least 8 characters.' });
  if (password !== confirmPassword) return res.status(400).json({ error: 'Passwords do not match.' });
  const emailLower = email.toLowerCase();
  if (await get('SELECT id FROM admins WHERE email = ?', [emailLower])) {
    return res.status(409).json({ error: 'An admin with that email already exists.' });
  }
  const id = 'ad_' + crypto.randomUUID();
  const passwordHash = await bcrypt.hash(password, 12);
  await run(
    `INSERT INTO admins (id, email, password_hash, must_change_password, is_super, created_by_admin_id, created_at)
     VALUES (?,?,?,1,0,?,?)`,
    [id, emailLower, passwordHash, req.adminId, Date.now()]
  );
  res.status(201).json(serializeAdmin(await get('SELECT * FROM admins WHERE id = ?', [id])));
}));

router.delete('/admins/:id', asyncHandler(requireSuperAdmin), asyncHandler(async (req, res) => {
  const target = await get('SELECT * FROM admins WHERE id = ?', [req.params.id]);
  if (!target) return res.status(404).json({ error: 'Not found.' });
  if (target.id === req.adminId) return res.status(400).json({ error: "You can't delete your own owner account." });
  if (target.is_super) return res.status(400).json({ error: 'The owner admin account cannot be deleted.' });
  await run('DELETE FROM admins WHERE id = ?', [target.id]);
  res.json({ ok: true, email: target.email });
}));

/* ------------------------------ DANGER ZONE ------------------------------- */

// Wipes tickets, tutors, and volunteer-hours docs (keeps admin accounts so
// you can't lock yourself out). No files to clean up — everything lives as
// rows in the database. Owner-only: this throws away every tutor account and
// the whole session history at once, so admins the owner creates can't do it.
router.post('/reset', asyncHandler(requireSuperAdmin), asyncHandler(async (req, res) => {
  await run('DELETE FROM tickets');
  await run('DELETE FROM tutors');
  await run('DELETE FROM volunteer_hours_docs');
  res.json({ ok: true });
}));

module.exports = router;
