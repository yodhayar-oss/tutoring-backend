const { readAuth } = require('./auth');
const { get } = require('./db');

// Confirms the cookie says "tutor" — does NOT check verification status.
// (Used for endpoints an unverified tutor should still reach, like /me and
// the verification-form upload itself.)
async function requireTutor(req, res, next) {
  const auth = readAuth(req);
  if (!auth || auth.kind !== 'tutor') return res.status(401).json({ error: 'Please sign in as a tutor.' });
  req.tutorId = auth.id;
  next();
}

async function requireAdmin(req, res, next) {
  const auth = readAuth(req);
  if (!auth || auth.kind !== 'admin') return res.status(401).json({ error: 'Please sign in as an admin.' });
  req.adminId = auth.id;
  next();
}

// Accepts a verified tutor OR an admin (admins can also claim/tutor sessions).
// Normalizes whichever is signed in into req.actor = { id, email, kind }.
// This one DOES hit the database, since a tutor's verification status can
// change after their cookie was issued (e.g. an admin approves/rejects them).
async function requireActor(req, res, next) {
  const auth = readAuth(req);
  if (auth && auth.kind === 'tutor') {
    const tutor = await get('SELECT * FROM tutors WHERE id = ?', [auth.id]);
    if (tutor && tutor.verification_status === 'approved') {
      req.actor = { id: tutor.id, email: tutor.email, kind: 'tutor' };
      return next();
    }
  }
  if (auth && auth.kind === 'admin') {
    const admin = await get('SELECT * FROM admins WHERE id = ?', [auth.id]);
    if (admin) {
      req.actor = { id: 'admin:' + admin.id, email: admin.email + ' (admin)', kind: 'admin' };
      return next();
    }
  }
  return res.status(401).json({ error: 'Sign in as a verified tutor or an admin first.' });
}

module.exports = { requireTutor, requireAdmin, requireActor };
