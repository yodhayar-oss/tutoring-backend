/* ===========================================================================
   TEMPORARY — no-tutoring date tester
   ---------------------------------------------------------------------------
   Read-only. Lets you pretend it's any date/time and see exactly what the
   server would offer tutees and tutors on that day, so the no-tutoring
   calendar can be checked without waiting for November.

   Nothing here writes to the database or reads anyone's account. To remove
   it when you're done testing, delete these four things:
     1. this file (src/routes/dateTester.js)
     2. the two dateTester lines in server.js
     3. public/date-tester.html
     4. public/date-tester.js
   =========================================================================== */

const express = require('express');
const {
  SUBJECTS, TUTEE_CUTOFF, TUTOR_CUTOFF, NO_TUTORING_DATES,
  isNoTutoringDate, upcomingNoTutoringDates, getEligibleDates,
  eligibleForSubject, isDateEligibleForSubject, fmtISO
} = require('../eligibility');

const router = express.Router();

const WEEKDAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];

function describe(d) {
  return {
    iso: fmtISO(d),
    weekday: WEEKDAY[d.getDay()],
    label: `${WEEKDAY[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`
  };
}

// Accepts "2026-11-23T09:30" (what <input type="datetime-local"> sends) or a
// plain "2026-11-23", and builds a local-time Date so the weekday math lines
// up with how the real server sees a school day.
function parsePretendNow(raw) {
  if (!raw) return new Date();
  const m = String(raw).match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m;
  return new Date(Number(y), Number(mo) - 1, Number(d), h ? Number(h) : 8, mi ? Number(mi) : 0, 0, 0);
}

// Subject metadata, so the tester page can pick a subject that actually meets
// on the weekday it's about to test.
router.get('/subjects', (req, res) => {
  res.json(Object.entries(SUBJECTS).map(([key, s]) => ({
    key, label: s.label, teacher: s.teacher, days: s.days, subOptions: s.subOptions
  })));
});

// The whole no-tutoring calendar, annotated. Days that fall on a Friday or
// weekend are flagged, since tutoring only runs Mon-Thu anyway — those are
// closed twice over.
router.get('/calendar', (req, res) => {
  res.json({
    total: NO_TUTORING_DATES.length,
    dates: NO_TUTORING_DATES.map(iso => {
      const [y, m, d] = iso.split('-').map(Number);
      const date = new Date(y, m - 1, d);
      const dow = date.getDay();
      return {
        ...describe(date),
        runsOnThisWeekday: dow >= 1 && dow <= 4
      };
    })
  });
});

// What the server would offer if "now" were the given date/time.
router.get('/preview', (req, res) => {
  const now = parsePretendNow(req.query.now);
  if (!now || isNaN(now.getTime())) {
    return res.status(400).json({ error: 'Use a date like 2026-11-23 or 2026-11-23T09:30.' });
  }

  const tuteeDates = getEligibleDates(now, TUTEE_CUTOFF.h, TUTEE_CUTOFF.m);
  const tutorDates = getEligibleDates(now, TUTOR_CUTOFF.h, TUTOR_CUTOFF.m);

  res.json({
    now: {
      ...describe(now),
      time: `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
      isNoTutoringDay: isNoTutoringDate(fmtISO(now))
    },
    tuteeWindow: tuteeDates.map(describe),
    tutorWindow: tutorDates.map(describe),
    // Days inside the same two-week window that were dropped because the
    // school calendar says there's no tutoring.
    closedInWindow: upcomingNoTutoringDates(now).map(describe),
    subjects: Object.entries(SUBJECTS).map(([key, subj]) => ({
      key,
      label: subj.label,
      teacher: subj.teacher,
      dates: eligibleForSubject(key, now, TUTEE_CUTOFF.h, TUTEE_CUTOFF.m).map(describe)
    }))
  });
});

// Would a booking for `date` be accepted, pretending it's `now`? This runs
// the same check the real POST /api/tickets endpoint runs.
router.get('/check', (req, res) => {
  const now = parsePretendNow(req.query.now);
  const date = String(req.query.date || '');
  const subjectKey = String(req.query.subject || '');
  if (!now || isNaN(now.getTime())) return res.status(400).json({ error: 'Bad "now" value.' });
  if (!SUBJECTS[subjectKey]) return res.status(400).json({ error: 'Unknown subject.' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'Bad "date" value.' });

  const allowed = isDateEligibleForSubject(subjectKey, date, now, TUTEE_CUTOFF.h, TUTEE_CUTOFF.m);
  let reason;
  if (allowed) reason = 'Accepted — this booking would go through.';
  else if (isNoTutoringDate(date)) reason = 'Rejected — no tutoring on this day (school calendar).';
  else {
    const [y, m, d] = date.split('-').map(Number);
    const dow = new Date(y, m - 1, d).getDay();
    if (dow < 1 || dow > 4) reason = 'Rejected — tutoring only runs Monday through Thursday.';
    else if (!SUBJECTS[subjectKey].days.includes(dow)) reason = `Rejected — ${SUBJECTS[subjectKey].label} does not meet on that weekday.`;
    else reason = 'Rejected — that day is outside the current two-week sign-up window (or past the cutoff).';
  }
  res.json({ allowed, reason, date, subjectKey, isNoTutoringDay: isNoTutoringDate(date) });
});

module.exports = router;
