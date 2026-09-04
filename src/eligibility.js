// Shared scheduling rules for the tutoring site. This is the SERVER's copy —
// the authoritative one. The browser has its own copy of the pure date-math
// functions (duplicated in public/app.js) purely so the sign-up form can
// show/hide options instantly without a round trip; every request is
// re-validated against this copy before anything is written to the database.

// `room` is where the subject actually meets. It's what the per-day limits
// below are counted against, so if two subjects ever move into one teacher's
// room, give them the same `room` value and the rules follow automatically.
const SUBJECTS = {
  biology: {
    label: 'Biology',
    teacher: 'Mr. Hauser',
    room: 'hauser',
    days: [1, 3], // Mon, Wed
    subOptions: ['Biology / Biology Adv', 'AP Biology']
  },
  chemistry: {
    label: 'Chemistry',
    teacher: 'Mrs. Montgomery',
    room: 'montgomery',
    days: [1, 3, 4], // Mon, Wed, Thu
    subOptions: ['Chemistry / Chemistry Adv', 'AP Chemistry']
  },
  physics: {
    label: 'Physics',
    teacher: 'Ms. Rittenhouse',
    room: 'rittenhouse',
    days: [2, 3, 4], // Tue, Wed, Thu
    subOptions: ['Physics 1', 'AP Physics 1', 'AP Physics 2', 'AP Physics C']
  },
  envsci: {
    label: 'AP Environmental Science',
    teacher: 'Ms. Alejo',
    room: 'alejo',
    days: [1, 2, 4], // Mon, Tue, Thu
    subOptions: null
  },
  psychology: {
    label: 'AP Psychology',
    teacher: 'Mr. J',
    room: 'mr-j',
    days: [1, 2, 3], // Mon, Tue, Wed
    subOptions: null
  }
};

const TUTEE_CUTOFF = { h: 12, m: 0 };
const TUTOR_CUTOFF = { h: 12, m: 15 };
const MAX_PER_ROOM_PER_DAY = 3;

/* --- Days with no tutoring at all (2026-27 school year) ------------------
   Holidays, breaks, and staff days. A date listed here is never offered to
   tutees or tutors, and is rejected server-side even if someone crafts the
   request by hand. A few of these already fall on a Friday (tutoring only
   runs Mon-Thu), but they're listed anyway so this stays a faithful copy of
   the school calendar. Keep in sync with the copy in public/app.js. */
const NO_TUTORING_DATES = [
  // September 2026
  '2026-09-07', '2026-09-08',
  // October 2026
  '2026-10-09', '2026-10-12', '2026-10-13',
  // November 2026 — Thanksgiving break
  '2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26', '2026-11-27',
  // December 2026 — winter break
  '2026-12-21', '2026-12-22', '2026-12-23', '2026-12-24', '2026-12-25',
  '2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31',
  // January 2027 — end of winter break, then MLK Day
  '2027-01-01', '2027-01-04', '2027-01-18',
  // February 2027
  '2027-02-12', '2027-02-15',
  // March 2027 — spring break, plus one more day off
  '2027-03-15', '2027-03-16', '2027-03-17', '2027-03-18', '2027-03-19',
  '2027-03-26',
  // April 2027
  '2027-04-16', '2027-04-30'
];
const NO_TUTORING_SET = new Set(NO_TUTORING_DATES);

function isNoTutoringDate(dateStr) {
  return NO_TUTORING_SET.has(dateStr);
}

function pad2(n) { return String(n).padStart(2, '0'); }
function fmtISO(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
function parseISO(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
function todayMidnight(now = new Date()) { return new Date(now.getFullYear(), now.getMonth(), now.getDate()); }

// Every Mon-Thu in the two-week window, ignoring the no-tutoring calendar.
// Split out so the "which days are closed?" helper below can reuse it.
function windowWeekdays(now) {
  const today = todayMidnight(now);
  const dow = today.getDay();
  const diffToMonday = dow === 0 ? -6 : 1 - dow;
  const monday = new Date(today);
  monday.setDate(today.getDate() + diffToMonday);
  const out = [];
  for (let w = 0; w < 2; w++) {
    for (let d = 0; d < 4; d++) { // Mon..Thu
      const date = new Date(monday);
      date.setDate(monday.getDate() + w * 7 + d);
      if (date.getTime() < today.getTime()) continue;
      out.push(date);
    }
  }
  return out;
}

// Remaining Mon-Thu of the current week (from today onward) + all Mon-Thu of
// next week, minus every day on the no-tutoring calendar. Today is only
// included if `now` is before the cutoff time.
function getEligibleDates(now, cutoffH, cutoffM) {
  const today = todayMidnight(now);
  return windowWeekdays(now).filter(date => {
    if (date.getTime() === today.getTime()) {
      const cutoff = new Date(today);
      cutoff.setHours(cutoffH, cutoffM, 0, 0);
      if (now.getTime() >= cutoff.getTime()) return false;
    }
    return !isNoTutoringDate(fmtISO(date));
  });
}

// The no-tutoring days falling inside the window we'd otherwise be offering
// — i.e. the closures actually worth telling people about right now.
function upcomingNoTutoringDates(now = new Date()) {
  return windowWeekdays(now).filter(d => isNoTutoringDate(fmtISO(d)));
}

function eligibleForSubject(subjectKey, now, cutoffH, cutoffM) {
  const subj = SUBJECTS[subjectKey];
  if (!subj) return [];
  return getEligibleDates(now, cutoffH, cutoffM).filter(d => subj.days.includes(d.getDay()));
}

function isDateEligibleForSubject(subjectKey, dateStr, now, cutoffH, cutoffM) {
  return eligibleForSubject(subjectKey, now, cutoffH, cutoffM).some(d => fmtISO(d) === dateStr);
}

/* ------------------------- TUTOR SUBJECT ELIGIBILITY ---------------------
   What a given tutor is allowed to teach. An admin picks this when they
   approve the tutor, and can change it at any time afterwards.

   Stored on the tutor row as JSON shaped like:
     { "biology": ["AP Biology"], "envsci": [] }
   A subject the tutor may teach is present as a key. If that subject has
   course levels, the array lists the exact levels they're cleared for; if it
   has no levels (AP Environmental Science, AP Psychology) the array is empty
   and the key alone grants the subject.

   `null` means "nothing recorded" — accounts approved before this feature
   existed. Those are treated as cleared for everything so nobody who was
   already tutoring gets locked out overnight; the admin screens flag them so
   they can be given a real list. */

function parseEligibility(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw === 'object') return raw;
  try {
    const parsed = JSON.parse(raw);
    return (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : null;
  } catch (e) {
    return null;
  }
}

// Throws on anything malformed, so routes can hand user input straight in.
function normalizeEligibility(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Choose at least one subject this tutor can teach.');
  }
  const out = {};
  for (const [key, value] of Object.entries(input)) {
    const subj = SUBJECTS[key];
    if (!subj) throw new Error(`Unknown subject: ${key}`);
    if (!subj.subOptions) {
      out[key] = [];
      continue;
    }
    const levels = Array.isArray(value) ? value : [];
    const cleaned = subj.subOptions.filter(l => levels.includes(l));
    if (!cleaned.length) {
      throw new Error(`Choose at least one course level for ${subj.label}, or leave that subject unchecked.`);
    }
    out[key] = cleaned;
  }
  if (!Object.keys(out).length) {
    throw new Error('Choose at least one subject this tutor can teach.');
  }
  return out;
}

/* ---------------------- ONE ROOM PER TUTOR PER DAY ------------------------
   A tutor works in a single teacher's room on any given day, and takes at
   most MAX_PER_ROOM_PER_DAY students there. Claiming the first session of the
   day picks the room; every other room is closed to them until the next day.
   Cancelled sessions don't count, so cancelling frees the room back up. */

function roomOf(subjectKey) {
  const subj = SUBJECTS[subjectKey];
  return subj ? subj.room : null;
}
function roomLabel(subjectKey) {
  const subj = SUBJECTS[subjectKey];
  return subj ? `${subj.teacher}'s room` : 'that room';
}

// `sameDaySubjectKeys` is the subject of every session this tutor already
// holds on the day in question (cancelled ones excluded). Returns null when
// they may take `subjectKey` that day, otherwise the reason they may not.
function roomConflict(sameDaySubjectKeys, subjectKey) {
  const room = roomOf(subjectKey);
  if (!room) return 'Unknown subject.';

  const elsewhere = (sameDaySubjectKeys || []).find(k => roomOf(k) !== room);
  if (elsewhere) {
    return `You're already tutoring in ${roomLabel(elsewhere)} that day — a tutor can only work in one room per day.`;
  }
  const here = (sameDaySubjectKeys || []).filter(k => roomOf(k) === room).length;
  if (here >= MAX_PER_ROOM_PER_DAY) {
    return `You've already signed up for ${MAX_PER_ROOM_PER_DAY} students in ${roomLabel(subjectKey)} that day.`;
  }
  return null;
}

function canTutor(eligibility, subjectKey, subOption) {
  if (eligibility === null || eligibility === undefined) return true; // legacy: everything
  const allowed = eligibility[subjectKey];
  if (!allowed) return false;
  const subj = SUBJECTS[subjectKey];
  if (!subj || !subj.subOptions) return true;
  return Array.isArray(allowed) && allowed.includes(subOption);
}

module.exports = {
  SUBJECTS,
  TUTEE_CUTOFF,
  TUTOR_CUTOFF,
  MAX_PER_ROOM_PER_DAY,
  roomOf,
  roomLabel,
  roomConflict,
  NO_TUTORING_DATES,
  isNoTutoringDate,
  upcomingNoTutoringDates,
  getEligibleDates,
  eligibleForSubject,
  isDateEligibleForSubject,
  parseEligibility,
  normalizeEligibility,
  canTutor,
  fmtISO,
  parseISO,
  todayMidnight
};
