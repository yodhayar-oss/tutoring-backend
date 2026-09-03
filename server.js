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

app.use('/api/tickets', ticketRoutes);
app.use('/api/tutor', tutorRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/volunteer-hours', volunteerHoursRoutes);

app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// Central error handler — catches multer errors (bad file type, too large),
// database errors, and anything thrown inside an async route handler.
app.use((err, req, res, next) => {
  console.error(err);
  res.status(400).json({ error: err.message || 'Something went wrong.' });
});

async function main() {
  await initDb();
  await bootstrapAdmin();
  app.listen(PORT, () => console.log(`Tutoring server running at http://localhost:${PORT}`));
}

main().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
