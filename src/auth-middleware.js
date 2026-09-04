const { readAuth } = require('./auth');
const { get } = require('./db');
const { parseEligibility } = require('./eligibility');

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

// Only the owner admin (the first-run account) may add or remove admins.
// Admins it creates can do everything else, but not this.
async function requireSuperAdmin(req, res, next) {
  const auth = readAuth(req);
  if (!auth || auth.kind !== 'admin') return res.status(401).json({ error: 'Please sign in as an admin.' });
  const admin = await get('SELECT * FROM admins WHERE id = ?', [auth.id]);
  if (!admin || !admin.is_super) {
    return res.status(403).json({ error: 'Only the owner admin account can manage admin accounts.' });
  }
  req.adminId = admin.id;
  req.admin = admin;
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
      req.actor = {
        id: tutor.id,
        email: tutor.email,
        kind: 'tutor',
        // Which subjects/levels this tutor is cleared for. null = everything.
        eligibility: parseEligibility(tutor.eligibility)
      };
      return next();
    }
  }
  if (auth && auth.kind === 'admin') {
    const admin = await get('SELECT * FROM admins WHERE id = ?', [auth.id]);
    if (admin) {
      // Admins acting as tutors aren't limited to a subject list.
      req.actor = { id: 'admin:' + admin.id, email: admin.email + ' (admin)', kind: 'admin', eligibility: null };
      return next();
    }
  }
  return res.status(401).json({ error: 'Sign in as a verified tutor or an admin first.' });
}

module.exports = { requireTutor, requireAdmin, requireSuperAdmin, requireActor };
