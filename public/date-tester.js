/* ===========================================================================
   TEMPORARY — no-tutoring date tester (browser half)
   Talks only to /api/date-tester/*, which is read-only. Delete this file,
   public/date-tester.html, src/routes/dateTester.js and the two dateTester
   lines in server.js to remove the tester entirely.
   =========================================================================== */

const WEEKDAY_INDEX = {
  Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6
};

let SUBJECTS = [];
let CALENDAR = null;

function esc(s){
  return String(s === null || s === undefined ? '' : s)
    .replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function json(url){ return fetch(url).then(r => r.json()); }

function shiftISO(iso, days){
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  const p = n => String(n).padStart(2, '0');
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`;
}
function isoWeekday(iso){
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).getDay();
}
// A subject that actually meets on the given weekday — otherwise a rejection
// would prove nothing about the closure itself.
function subjectForWeekday(dow){
  return (SUBJECTS.find(s => s.days.includes(dow)) || SUBJECTS[0]).key;
}

/* --------------------------- 1. SINGLE-DAY PREVIEW ------------------------ */

function dayPills(dates, closedSet){
  if (!dates.length) return `<p class="fine" style="margin:6px 0 0;">Nothing — every day in the window is closed or past its cutoff.</p>`;
  return `<ul class="day-list">${dates.map(d =>
    `<li class="day-pill ${closedSet && closedSet.has(d.iso) ? 'closed' : ''}">${esc(d.label)}</li>`
  ).join('')}</ul>`;
}

async function runPreview(){
  const value = document.getElementById('pretend-now').value;
  const out = document.getElementById('preview-out');
  if (!value){ out.innerHTML = `<div class="empty-state">Pick a date first.</div>`; return; }
  out.innerHTML = `<div class="empty-state">Asking the server…</div>`;

  const data = await json('/api/date-tester/preview?now=' + encodeURIComponent(value));
  if (data.error){ out.innerHTML = `<div class="empty-state">${esc(data.error)}</div>`; return; }

  const closedSet = new Set(data.closedInWindow.map(d => d.iso));
  out.innerHTML = `
    <p style="margin-bottom:10px;">
      Pretending it is <strong>${esc(data.now.label)}</strong> at ${esc(data.now.time)} —
      <span class="now-badge ${data.now.isNoTutoringDay ? 'closed' : ''}">
        ${data.now.isNoTutoringDay ? 'this day is on the no-tutoring list' : 'a normal day'}
      </span>
    </p>

    <div class="result-block">
      <h3>Days a student could book</h3>
      ${dayPills(data.tuteeWindow)}
    </div>

    <div class="result-block">
      <h3>Days a tutor could sign up for</h3>
      ${dayPills(data.tutorWindow)}
    </div>

    <div class="result-block">
      <h3>Blocked by the no-tutoring calendar</h3>
      ${data.closedInWindow.length
        ? dayPills(data.closedInWindow, closedSet)
        : `<p class="fine" style="margin:6px 0 0;">Nothing in this two-week window is closed.</p>`}
    </div>

    <div class="result-block">
      <h3>By subject (what the booking form would offer)</h3>
      <table class="roster">
        <thead><tr><th>Subject</th><th>Days offered</th></tr></thead>
        <tbody>
          ${data.subjects.map(s => `
            <tr>
              <td>${esc(s.label)} <span class="fine">— ${esc(s.teacher)}</span></td>
              <td class="mono">${s.dates.length ? s.dates.map(d => esc(d.label)).join('<br>') : '<span class="fine">none</span>'}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>
  `;
}

/* ------------------------- 2. CHECK EVERY CLOSED DAY ---------------------- */

async function runAllChecks(){
  const out = document.getElementById('all-out');
  out.innerHTML = `<div class="empty-state">Running ${CALENDAR.total} checks…</div>`;

  const rows = [];
  for (const day of CALENDAR.dates){
    // Stand a week earlier so the day under test sits in the sign-up window.
    const now = shiftISO(day.iso, -7) + 'T08:00';

    if (!day.runsOnThisWeekday){
      rows.push({
        day,
        verdict: 'na',
        blocked: 'Tutoring never runs on a ' + day.weekday + '.',
        control: '—'
      });
      continue;
    }

    const dow = WEEKDAY_INDEX[day.weekday];
    const subject = subjectForWeekday(dow);
    const closed = await json(`/api/date-tester/check?now=${encodeURIComponent(now)}&date=${day.iso}&subject=${subject}`);

    // Control: the same weekday a week earlier, if that one is open. Proves
    // the refusal above came from the calendar, not from a broken window.
    const controlDate = shiftISO(day.iso, -7);
    const controlNow = shiftISO(controlDate, -7) + 'T08:00';
    const control = await json(`/api/date-tester/check?now=${encodeURIComponent(controlNow)}&date=${controlDate}&subject=${subject}`);
    const controlIsAlsoClosed = control.isNoTutoringDay;

    const blockedOk = closed.allowed === false && closed.isNoTutoringDay === true;
    const controlOk = controlIsAlsoClosed ? null : control.allowed === true;

    rows.push({
      day,
      verdict: (blockedOk && controlOk !== false) ? 'pass' : 'fail',
      blocked: closed.reason,
      control: controlIsAlsoClosed
        ? `${controlDate} is also closed — skipped`
        : `${controlDate} → ${control.allowed ? 'accepted ✓' : 'REFUSED ✗'}`
    });
  }

  const failures = rows.filter(r => r.verdict === 'fail').length;
  const passes = rows.filter(r => r.verdict === 'pass').length;
  const skipped = rows.filter(r => r.verdict === 'na').length;

  out.innerHTML = `
    <div class="summary-line ${failures ? 'fail' : 'pass'}">
      ${failures
        ? `${failures} of ${rows.length} closed days did NOT behave correctly.`
        : `All ${rows.length} closed days behave correctly — ${passes} actively blocked, ${skipped} on a weekday tutoring never runs.`}
    </div>
    <table class="roster">
      <thead><tr><th>Date</th><th>Result</th><th>What the server said</th><th>Control (a normal day)</th></tr></thead>
      <tbody>
        ${rows.map(r => `
          <tr>
            <td class="mono">${esc(r.day.iso)}<br><span class="fine">${esc(r.day.label)}</span></td>
            <td><span class="verdict ${r.verdict}">${r.verdict === 'pass' ? 'BLOCKED ✓' : r.verdict === 'fail' ? 'PROBLEM ✗' : 'N/A'}</span></td>
            <td>${esc(r.blocked)}</td>
            <td class="mono">${esc(r.control)}</td>
          </tr>`).join('')}
      </tbody>
    </table>
  `;
}

/* -------------------------------- SETUP ---------------------------------- */

function buildQuickJumps(){
  // One button per run of consecutive closed days, labelled by its first day.
  const groups = [];
  CALENDAR.dates.forEach(d => {
    const last = groups[groups.length - 1];
    if (last && shiftISO(last.dates[last.dates.length - 1].iso, 1) === d.iso) last.dates.push(d);
    else groups.push({ dates: [d] });
  });

  document.getElementById('quick-jumps').innerHTML = groups.map(g => {
    const first = g.dates[0];
    const label = g.dates.length > 1
      ? `${first.label} +${g.dates.length - 1}`
      : first.label;
    // Land a week before the closure so the window covers it.
    return `<button class="btn btn-ghost btn-small" data-jump="${shiftISO(first.iso, -7)}T08:00">${esc(label)}</button>`;
  }).join('');
}

async function init(){
  [SUBJECTS, CALENDAR] = await Promise.all([
    json('/api/date-tester/subjects'),
    json('/api/date-tester/calendar')
  ]);
  buildQuickJumps();

  // Default to a week before the first closure so there's something to see.
  document.getElementById('pretend-now').value = shiftISO(CALENDAR.dates[0].iso, -7) + 'T08:00';
  await runPreview();

  document.getElementById('run-preview').addEventListener('click', runPreview);
  document.getElementById('run-all').addEventListener('click', runAllChecks);
  document.getElementById('quick-jumps').addEventListener('click', async e => {
    const btn = e.target.closest('[data-jump]');
    if (!btn) return;
    document.getElementById('pretend-now').value = btn.dataset.jump;
    await runPreview();
    document.getElementById('preview-out').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });
}

init().catch(err => {
  document.getElementById('preview-out').innerHTML =
    `<div class="empty-state">Could not reach the tester API: ${esc(err.message)}</div>`;
});
