const jwt = require('jsonwebtoken');

const COOKIE_NAME = 'auth';
const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-.env-before-deploying';
const TOKEN_TTL_SECONDS = 60 * 60 * 12; // 12 hours

// Login state lives entirely in a signed, httpOnly cookie on the browser —
// there's no server-side session store to keep alive, so this works the same
// whether the server has been running for a week or was just restarted.

function setAuthCookie(res, payload) {
  const token = jwt.sign(payload, JWT_SECRET, { expiresIn: TOKEN_TTL_SECONDS });
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: TOKEN_TTL_SECONDS * 1000,
    path: '/'
  });
}

function clearAuthCookie(res) {
  res.clearCookie(COOKIE_NAME, { path: '/' });
}

// Returns { kind: 'tutor'|'admin', id } or null. Never throws.
function readAuth(req) {
  const token = req.cookies && req.cookies[COOKIE_NAME];
  if (!token) return null;
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (e) {
    return null;
  }
}

module.exports = { setAuthCookie, clearAuthCookie, readAuth, COOKIE_NAME };
