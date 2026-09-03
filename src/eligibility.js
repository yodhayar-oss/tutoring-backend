// Shared scheduling rules for the tutoring site. This is the SERVER's copy —
// the authoritative one. The browser has its own copy of the pure date-math
// functions (duplicated in public/app.js) purely so the sign-up form can
// show/hide options instantly without a round trip; every request is
// re-validated against this copy before anything is written to the database.

const SUBJECTS = {
  biology: {
    label: 'Biology',
    teacher: 'Mr. Hauser',
    days: [1, 3], // Mon, Wed
    subOptions: ['Biology / Biology Adv', 'AP Biology']
  },
  chemistry: {
    label: 'Chemistry',
    teacher: 'Mrs. Montgomery',
    days: [1, 3, 4], // Mon, Wed, Thu
    subOptions: ['Chemistry / Chemistry Adv', 'AP Chemistry']
  },
  physics: {
    label: 'Physics',
    teacher: 'Ms. Rittenhouse',
    days: [2, 3, 4], // Tue, Wed, Thu
    subOptions: ['Physics 1', 'AP Physics 1', 'AP Physics 2', 'AP Physics C']
  },
  envsci: {
    label: 'AP Environmental Science',
    teacher: 'Ms. Alejo',
    days: [1, 2, 4], // Mon, Tue, Thu
    subOptions: null
  },
  psychology: {
    label: 'AP Psychology',
    teacher: 'Mr. J',
    days: [1, 2, 3], // Mon, Tue, Wed
    subOptions: null
  }
};

const TUTEE_CUTOFF = { h: 12, m: 0 };
const TUTOR_CUTOFF = { h: 12, m: 15 };
const MAX_PER_SUBJECT_PER_DAY = 3;

function pad2(n) { return String(n).padStart(2, '0'); }
function fmtISO(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
function parseISO(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
function todayMidnight(now = new Date()) { return new Date(now.getFullYear(), now.getMonth(), now.getDate()); }

// Remaining Mon-Thu of the current week (from today onward) + all Mon-Thu of
// next week. Today is only included if `now` is before the cutoff time.
function getEligibleDates(now, cutoffH, cutoffM) {
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
      if (date.getTime() === today.getTime()) {
        const cutoff = new Date(today);
        cutoff.setHours(cutoffH, cutoffM, 0, 0);
        if (now.getTime() >= cutoff.getTime()) continue;
      }
      out.push(date);
    }
  }
  return out;
}

function eligibleForSubject(subjectKey, now, cutoffH, cutoffM) {
  const subj = SUBJECTS[subjectKey];
  if (!subj) return [];
  return getEligibleDates(now, cutoffH, cutoffM).filter(d => subj.days.includes(d.getDay()));
}

function isDateEligibleForSubject(subjectKey, dateStr, now, cutoffH, cutoffM) {
  return eligibleForSubject(subjectKey, now, cutoffH, cutoffM).some(d => fmtISO(d) === dateStr);
}

module.exports = {
  SUBJECTS,
  TUTEE_CUTOFF,
  TUTOR_CUTOFF,
  MAX_PER_SUBJECT_PER_DAY,
  getEligibleDates,
  eligibleForSubject,
  isDateEligibleForSubject,
  fmtISO,
  parseISO,
  todayMidnight
};
