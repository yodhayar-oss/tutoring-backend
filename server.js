require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');

const { initDb } = require('./src/db');
const { bootstrapAdmin } = require('./src/bootstrap');
const ticketRoutes = require('./src/routes/tickets');
const tutorRoutes = require('./src/routes/tutors');
const adminRoutes = require('./src/routes/admin');
const volunteerHoursRoutes = require('./src/routes/volunteerHours');
const dateTesterRoutes = require('./src/routes/dateTester'); // TEMPORARY — see src/routes/dateTester.js

const PORT = process.env.PORT || 3000;
const app = express();

app.disable('x-powered-by');
// Content-Security-Policy is left off here for simplicity (it can otherwise
// block the Google Fonts stylesheet this frontend loads). Tighten this before
// a real production launch — see README.md.
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.set('trust proxy', 1);

// Slow down brute-force attempts on the login/signup endpoints
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false });
app.use(['/api/tutor/login', '/api/admin/login', '/api/tutor/signup'], loginLimiter);

// On a long-running host this work happens once before listen(). On Vercel
// each serverless instance is created on demand, so it has to happen on the
// first request that instance sees instead — memoised so it's still once per
// process, and retried on the next request if it fails.
let readyPromise = null;
function ensureReady() {
  if (!readyPromise) {
    readyPromise = (async () => {
      await initDb();
      await bootstrapAdmin();
    })().catch(err => {
      readyPromise = null; // let the next request try again
      throw err;
    });
  }
  return readyPromise;
}

app.use((req, res, next) => {
  ensureReady().then(() => next()).catch(next);
});

app.use('/api/tickets', ticketRoutes);
app.use('/api/tutor', tutorRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/volunteer-hours', volunteerHoursRoutes);
app.use('/api/date-tester', dateTesterRoutes); // TEMPORARY — remove with public/date-tester.*

app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// Central error handler — catches multer errors (bad file type, too large),
// database errors, and anything thrown inside an async route handler.
app.use((err, req, res, next) => {
  console.error(err);
  res.status(400).json({ error: err.message || 'Something went wrong.' });
});

// Vercel imports this module and drives `app` itself, so only listen when this
// file is what was actually run (`npm start`, or any long-running host).
if (require.main === module) {
  ensureReady()
    .then(() => {
      app.listen(PORT, () => console.log(`Tutoring server running at http://localhost:${PORT}`));
    })
    .catch(err => {
      console.error('Failed to start server:', err);
      process.exit(1);
    });
}

module.exports = app;
