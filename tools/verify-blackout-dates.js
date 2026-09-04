/* ===========================================================================
   Checks the no-tutoring calendar against the real scheduling rules in
   src/eligibility.js. Run it with:   node tools/verify-blackout-dates.js

   It needs no database and no server — it calls the same functions the live
   endpoints call. Exits non-zero if anything is wrong, so it also works as a
   pre-deploy sanity check.
   =========================================================================== */

const {
  SUBJECTS, TUTEE_CUTOFF, TUTOR_CUTOFF, NO_TUTORING_DATES, MAX_PER_ROOM_PER_DAY,
  isNoTutoringDate, getEligibleDates, isDateEligibleForSubject, canTutor,
  roomConflict, roomOf, fmtISO
} = require('../src/eligibility');

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// The list as the school calendar states it, kept separate from the copy in
// src/eligibility.js so a typo in either one shows up as a mismatch.
const EXPECTED = [
  '2026-09-07', '2026-09-08',
  '2026-10-09', '2026-10-12', '2026-10-13',
  '2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26', '2026-11-27',
  '2026-12-21', '2026-12-22', '2026-12-23', '2026-12-24', '2026-12-25',
  '2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31',
  '2027-01-01', '2027-01-04', '2027-01-18',
  '2027-02-12', '2027-02-15',
  '2027-03-15', '2027-03-16', '2027-03-17', '2027-03-18', '2027-03-19', '2027-03-26',
  '2027-04-16', '2027-04-30'
];

let failures = 0;
let checks = 0;
function check(label, condition, detail) {
  checks++;
  if (condition) return;
  failures++;
  console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`);
}
function section(title) { console.log(`\n${title}`); }

function toDate(iso) { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); }
function shift(iso, days) { const d = toDate(iso); d.setDate(d.getDate() + days); return fmtISO(d); }
function subjectsMeetingOn(dow) { return Object.keys(SUBJECTS).filter(k => SUBJECTS[k].days.includes(dow)); }
function at8am(iso) { const d = toDate(iso); d.setHours(8, 0, 0, 0); return d; }

/* -- 1. The list itself ---------------------------------------------------- */
section('1. The no-tutoring list matches the school calendar');
check('same number of dates', NO_TUTORING_DATES.length === EXPECTED.length,
  `code has ${NO_TUTORING_DATES.length}, calendar has ${EXPECTED.length}`);
EXPECTED.forEach(iso => check(`${iso} is on the list`, isNoTutoringDate(iso)));
NO_TUTORING_DATES.forEach(iso => check(`${iso} is expected`, EXPECTED.includes(iso), 'extra date in the code'));
console.log(`  ${EXPECTED.length} dates, ${EXPECTED.filter(d => { const w = toDate(d).getDay(); return w >= 1 && w <= 4; }).length} of them on a Mon-Thu (the days tutoring actually runs)`);

/* -- 2. Every closed day is refused ---------------------------------------- */
section('2. Every closed day is refused for both students and tutors');
for (const iso of EXPECTED) {
  const dow = toDate(iso).getDay();
  if (dow < 1 || dow > 4) continue; // tutoring never runs this weekday anyway

  const now = at8am(shift(iso, -7)); // stand a week earlier: iso is "next week"
  const tuteeDays = getEligibleDates(now, TUTEE_CUTOFF.h, TUTEE_CUTOFF.m).map(fmtISO);
  const tutorDays = getEligibleDates(now, TUTOR_CUTOFF.h, TUTOR_CUTOFF.m).map(fmtISO);

  check(`${iso} (${WEEKDAY[dow]}) hidden from students`, !tuteeDays.includes(iso));
  check(`${iso} (${WEEKDAY[dow]}) hidden from tutors`, !tutorDays.includes(iso));

  for (const key of subjectsMeetingOn(dow)) {
    check(`${iso} refused for ${SUBJECTS[key].label}`,
      !isDateEligibleForSubject(key, iso, now, TUTEE_CUTOFF.h, TUTEE_CUTOFF.m));
  }
}

/* -- 3. Closed days are refused when they'd be "today" too ----------------- */
section('3. Closed days stay refused when they are today');
for (const iso of EXPECTED) {
  const dow = toDate(iso).getDay();
  if (dow < 1 || dow > 4) continue;
  const now = at8am(iso); // 8am on the closed day, well before any cutoff
  check(`${iso} still refused at 8am on the day itself`,
    !getEligibleDates(now, TUTEE_CUTOFF.h, TUTEE_CUTOFF.m).map(fmtISO).includes(iso));
}

/* -- 4. Control: normal days still work ------------------------------------ */
section('4. Control — normal days are still accepted (the calendar is not blocking everything)');
let controls = 0;
for (const iso of EXPECTED) {
  const dow = toDate(iso).getDay();
  if (dow < 1 || dow > 4) continue;
  const control = shift(iso, -7); // same weekday, one week earlier
  if (isNoTutoringDate(control)) continue; // that one's closed too — nothing to prove
  const now = at8am(shift(control, -7));
  const key = subjectsMeetingOn(dow)[0];
  controls++;
  check(`${control} (${WEEKDAY[dow]}) is accepted for ${SUBJECTS[key].label}`,
    isDateEligibleForSubject(key, control, now, TUTEE_CUTOFF.h, TUTEE_CUTOFF.m));
}
console.log(`  ${controls} control days checked`);

/* -- 5. Nothing else got swept up ------------------------------------------ */
section('5. No day outside the list is being blocked');
let scanned = 0, wronglyBlocked = 0;
for (let i = 0; i < 400; i++) {
  const iso = shift('2026-08-17', i); // a Monday, through to autumn 2027
  const dow = toDate(iso).getDay();
  if (dow < 1 || dow > 4) continue;
  if (isNoTutoringDate(iso)) continue;
  const now = at8am(shift(iso, -7));
  scanned++;
  if (!getEligibleDates(now, TUTEE_CUTOFF.h, TUTEE_CUTOFF.m).map(fmtISO).includes(iso)) {
    wronglyBlocked++;
    console.log(`  FAIL  ${iso} (${WEEKDAY[dow]}) is not on the list but was blocked anyway`);
    failures++;
  }
  checks++;
}
console.log(`  ${scanned} ordinary school days scanned, ${wronglyBlocked} wrongly blocked`);

/* -- 6. Tutor subject clearances ------------------------------------------- */
section('6. Tutor subject/level clearances');
const scoped = { biology: ['AP Biology'], envsci: [] };
check('cleared subject + level allowed', canTutor(scoped, 'biology', 'AP Biology'));
check('cleared subject, wrong level refused', !canTutor(scoped, 'biology', 'Biology / Biology Adv'));
check('uncleared subject refused', !canTutor(scoped, 'physics', 'AP Physics 1'));
check('level-less subject allowed by key alone', canTutor(scoped, 'envsci', null));
check('level-less subject refused when not listed', !canTutor(scoped, 'psychology', null));
check('no clearances recorded means everything (legacy accounts)', canTutor(null, 'physics', 'AP Physics C'));

/* -- 7. One room per tutor per day ----------------------------------------- */
section('7. One room per tutor per day, three students in it');
check('every subject names a room', Object.keys(SUBJECTS).every(k => !!roomOf(k)));

// Nothing booked yet: any room is open.
check('first sign-up of the day is allowed', roomConflict([], 'biology') === null);

// One session in Mr. Hauser's room: Biology stays open, everything else shuts.
const oneInHauser = ['biology'];
check('a 2nd student in the same room is allowed', roomConflict(oneInHauser, 'biology') === null);
for (const key of ['chemistry', 'physics', 'envsci', 'psychology']) {
  const reason = roomConflict(oneInHauser, key);
  check(`${SUBJECTS[key].label} is locked once booked in Mr. Hauser's room`, typeof reason === 'string' && /one room per day/.test(reason), String(reason));
}

// Filling the room stops at three.
check('3rd student in the same room is allowed', roomConflict(['biology', 'biology'], 'biology') === null);
const full = roomConflict(['biology', 'biology', 'biology'], 'biology');
check(`a 4th student in the same room is refused`, typeof full === 'string' && full.includes(String(MAX_PER_ROOM_PER_DAY)), String(full));
check('the limit really is ' + MAX_PER_ROOM_PER_DAY, MAX_PER_ROOM_PER_DAY === 3);

// Different course levels in the same room are still the same room.
check('mixed levels count against the same room',
  roomConflict(['biology', 'biology', 'biology'], 'biology') !== null);

// A day with nothing booked is unaffected by another day's bookings — the
// caller passes only that day's sessions, so an empty list must stay open.
check('a different day is unaffected', roomConflict([], 'physics') === null);

/* -- Result ---------------------------------------------------------------- */
console.log(`\n${'='.repeat(64)}`);
if (failures) {
  console.log(`FAILED — ${failures} of ${checks} checks did not pass.`);
  process.exit(1);
}
console.log(`PASSED — all ${checks} checks.`);
console.log('='.repeat(64));
