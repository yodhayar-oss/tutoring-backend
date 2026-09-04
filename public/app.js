/* =========================================================================
   SCIENCE TUTORING SIGN-UP DESK — frontend
   Talks to the real backend (see server.js and src/) over fetch(). All
   accounts, requests, and photos/PDFs live in the server's SQLite database
   and uploads folder — nothing is stored in the browser itself.
   ========================================================================= */

/* ---------------------------- CONFIG -----------------------------------
   Mirrors src/eligibility.js on the server, for instant UI feedback only.
   The server re-checks everything before writing to the database, so this
   copy being out of sync would only affect what the form *offers*, not
   what's actually allowed. */
const CONFIG = {
  SUBJECTS: {
    biology: { label: "Biology", teacher: "Mr. Hauser", room: "hauser", days: [1,3], subOptions: ["Biology / Biology Adv", "AP Biology"] },
    chemistry: { label: "Chemistry", teacher: "Mrs. Montgomery", room: "montgomery", days: [1,3,4], subOptions: ["Chemistry / Chemistry Adv", "AP Chemistry"] },
    physics: { label: "Physics", teacher: "Ms. Rittenhouse", room: "rittenhouse", days: [2,3,4], subOptions: ["Physics 1", "AP Physics 1", "AP Physics 2", "AP Physics C"] },
    envsci: { label: "AP Environmental Science", teacher: "Ms. Alejo", room: "alejo", days: [1,2,4], subOptions: null },
    psychology: { label: "AP Psychology", teacher: "Mr. J", room: "mr-j", days: [1,2,3], subOptions: null }
  },
  TUTEE_CUTOFF: { h: 12, m: 0 },
  TUTOR_CUTOFF: { h: 12, m: 15 },
  MAX_PER_ROOM_PER_DAY: 3,
  /* Days with no tutoring at all (2026-27 school year) — holidays, breaks,
     and staff days. Mirror of NO_TUTORING_DATES in src/eligibility.js; the
     server rejects these regardless of what this copy says. */
  NO_TUTORING_DATES: [
    '2026-09-07','2026-09-08',
    '2026-10-09','2026-10-12','2026-10-13',
    '2026-11-23','2026-11-24','2026-11-25','2026-11-26','2026-11-27',
    '2026-12-21','2026-12-22','2026-12-23','2026-12-24','2026-12-25',
    '2026-12-28','2026-12-29','2026-12-30','2026-12-31',
    '2027-01-01','2027-01-04','2027-01-18',
    '2027-02-12','2027-02-15',
    '2027-03-15','2027-03-16','2027-03-17','2027-03-18','2027-03-19','2027-03-26',
    '2027-04-16','2027-04-30'
  ]
};
const NO_TUTORING_SET = new Set(CONFIG.NO_TUTORING_DATES);
const CONTACT_EMAIL = 'yodha.yarmaneni.215@k12.friscoisd.org';
const EXAMPLE_EMAIL = 'yourname@k12.friscoisd.org';
const SUBJ_CLASS = { biology:'subj-biology', chemistry:'subj-chemistry', physics:'subj-physics', envsci:'subj-envsci', psychology:'subj-psychology' };
const WEEKDAY_LONG = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

/* ---------------------------- STATE ------------------------------------ */
let session = { tutor: null, admin: null };
let cache = { lookupTickets: null, openTickets: [], myTickets: [], myVolDocs: [], allTickets: [], tutors: [], admins: [], volDocsForTutor: [] };
let state = {
  view: 'tutee',
  adminSubtab: 'overview',
  tutorAuthMode: 'login',
  tuteeLookupEmail: null,
  lastSubmittedEmail: '',
  volHoursSelectedTutor: null
};
let toasts = [];
let toastCounter = 0;

/* ---------------------------- UTILITIES --------------------------------- */
function escapeHtml(str){
  if (str === null || str === undefined) return '';
  return String(str).replace(/[&<>"']/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s]));
}
function pad2(n){ return String(n).padStart(2,'0'); }
function fmtISO(d){ return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`; }
function parseISO(s){ const [y,m,d] = s.split('-').map(Number); return new Date(y, m-1, d); }
function todayMidnight(){ const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); }
function fmtLong(d){ return `${WEEKDAY_LONG[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`; }
function fmtShort(d){ return `${WEEKDAY_LONG[d.getDay()].slice(0,3)} ${MONTHS[d.getMonth()].slice(0,3)} ${d.getDate()}`; }
function fmtHour({h,m}){ const hr12 = ((h % 12) === 0) ? 12 : (h % 12); const ampm = h < 12 ? 'AM' : 'PM'; return `${hr12}:${pad2(m)} ${ampm}`; }

function isNoTutoringDate(dateStr){ return NO_TUTORING_SET.has(dateStr); }

// Every Mon-Thu in the two-week window, before the no-tutoring calendar is
// applied. Shared by the two functions below.
function windowWeekdays(now){
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dow = today.getDay();
  const diffToMonday = dow === 0 ? -6 : 1 - dow;
  const monday = new Date(today); monday.setDate(today.getDate() + diffToMonday);
  const out = [];
  for (let w=0; w<2; w++){
    for (let d=0; d<4; d++){
      const date = new Date(monday); date.setDate(monday.getDate() + w*7 + d);
      if (date.getTime() < today.getTime()) continue;
      out.push(date);
    }
  }
  return out;
}
function getEligibleDates(now, cutoffH, cutoffM){
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return windowWeekdays(now).filter(date => {
    if (date.getTime() === today.getTime()){
      const cutoff = new Date(today); cutoff.setHours(cutoffH, cutoffM, 0, 0);
      if (now.getTime() >= cutoff.getTime()) return false;
    }
    return !isNoTutoringDate(fmtISO(date));
  });
}
// Days inside the window that are closed by the school calendar — the ones
// worth telling people about instead of silently hiding.
function upcomingNoTutoringDates(now){
  return windowWeekdays(now).filter(d => isNoTutoringDate(fmtISO(d)));
}
function closedDaysNote(now){
  const closed = upcomingNoTutoringDates(now);
  if (!closed.length) return '';
  return `<div class="closed-note"><strong>No tutoring on:</strong> ${closed.map(fmtShort).join(' · ')}</div>`;
}
function eligibleForSubject(subjectKey, now, cutoffH, cutoffM){
  const subj = CONFIG.SUBJECTS[subjectKey];
  if (!subj) return [];
  return getEligibleDates(now, cutoffH, cutoffM).filter(d => subj.days.includes(d.getDay()));
}

/* ------------------- TUTOR SUBJECT ELIGIBILITY (display) -------------------
   `eligibility` is an object like { biology: ["AP Biology"], envsci: [] } —
   a subject the tutor may teach appears as a key, and for subjects that have
   course levels the array lists the exact levels. `null` means the account
   was approved before this feature existed, so it can currently tutor
   everything until an admin sets a real list. */
function eligibilityEntries(elig){
  if (!elig) return [];
  return Object.entries(CONFIG.SUBJECTS)
    .filter(([key]) => Object.prototype.hasOwnProperty.call(elig, key))
    .map(([key, subj]) => ({
      key,
      label: subj.label,
      levels: subj.subOptions ? (elig[key] || []) : null
    }));
}
function eligibilitySummary(elig){
  if (!elig) return 'All subjects (not set yet)';
  const entries = eligibilityEntries(elig);
  if (!entries.length) return 'Nothing assigned';
  return entries.map(e => e.levels && e.levels.length < (CONFIG.SUBJECTS[e.key].subOptions || []).length
    ? `${e.label} (${e.levels.join(', ')})`
    : e.label
  ).join('; ');
}
function eligibilityChips(elig){
  if (!elig) return `<span class="chip chip-unsubmitted">All subjects — not set yet</span>`;
  const entries = eligibilityEntries(elig);
  if (!entries.length) return `<span class="chip chip-rejected">Nothing assigned</span>`;
  return entries.map(e => `
    <span class="elig-chip ${SUBJ_CLASS[e.key]}">
      ${escapeHtml(e.label)}${e.levels && e.levels.length ? `<span class="elig-chip-levels">${e.levels.map(escapeHtml).join(' · ')}</span>` : ''}
    </span>`).join('');
}
function eligibilityPicker(current){
  return `<div class="elig-picker" id="elig-picker">
    ${Object.entries(CONFIG.SUBJECTS).map(([key, s]) => {
      const on = !!(current && Object.prototype.hasOwnProperty.call(current, key));
      const chosen = on ? (current[key] || []) : [];
      return `
      <div class="elig-subject">
        <label class="elig-row elig-head">
          <input type="checkbox" data-elig-subject="${key}" ${on ? 'checked' : ''}>
          <span><strong>${escapeHtml(s.label)}</strong> <span class="fine">— ${escapeHtml(s.teacher)}</span></span>
        </label>
        ${s.subOptions ? `
          <div class="elig-levels">
            ${s.subOptions.map(l => `
              <label class="elig-row">
                <input type="checkbox" data-elig-level="${key}" value="${escapeHtml(l)}" ${chosen.includes(l) ? 'checked' : ''}>
                <span>${escapeHtml(l)}</span>
              </label>`).join('')}
          </div>` : `<div class="elig-levels"><span class="fine">No separate course levels — the whole subject.</span></div>`}
      </div>`;
    }).join('')}
  </div>`;
}
function collectEligibility(){
  const root = document.getElementById('elig-picker');
  if (!root) return null;
  const out = {};
  root.querySelectorAll('[data-elig-subject]').forEach(cb => {
    if (!cb.checked) return;
    const key = cb.dataset.eligSubject;
    const subj = CONFIG.SUBJECTS[key];
    if (!subj.subOptions){ out[key] = []; return; }
    out[key] = Array.from(root.querySelectorAll(`[data-elig-level="${key}"]`))
      .filter(l => l.checked).map(l => l.value);
  });
  return out;
}
function validateEligibility(elig){
  const keys = Object.keys(elig || {});
  if (!keys.length) return 'Pick at least one subject this tutor can teach.';
  for (const key of keys){
    const subj = CONFIG.SUBJECTS[key];
    if (subj.subOptions && !elig[key].length){
      return `Pick at least one course level for ${subj.label}, or uncheck that subject.`;
    }
  }
  return null;
}

function compressImage(file, maxDim=1000, quality=0.72){
  return new Promise((resolve, reject)=>{
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        let w = img.width, h = img.height;
        if (w > h && w > maxDim){ h = Math.round(h * (maxDim / w)); w = maxDim; }
        else if (h >= w && h > maxDim){ w = Math.round(w * (maxDim / h)); h = maxDim; }
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0,0,w,h);
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = () => reject(new Error('Could not read that image file.'));
      img.src = e.target.result;
    };
    reader.onerror = () => reject(new Error('Could not read that file.'));
    reader.readAsDataURL(file);
  });
}
function dataURLToBlob(dataURL){
  const [header, base64] = dataURL.split(',');
  const mime = header.match(/:(.*?);/)[1];
  const binary = atob(base64);
  const array = new Uint8Array(binary.length);
  for (let i=0;i<binary.length;i++) array[i] = binary.charCodeAt(i);
  return new Blob([array], { type: mime });
}

/* ---------------------------- API HELPER --------------------------------- */
async function api(method, url, body, isForm){
  const opts = { method, credentials: 'same-origin', headers: {} };
  if (body !== undefined){
    if (isForm){ opts.body = body; }
    else { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  }
  const res = await fetch(url, opts);
  let data = null;
  try{ data = await res.json(); }catch(e){ /* no body */ }
  if (!res.ok) throw new Error((data && data.error) || `Request failed (${res.status}).`);
  return data;
}

/* ---------------------------- TOASTS -------------------------------------- */
function pushToast(msg, kind){
  const id = ++toastCounter;
  toasts.push({ id, msg, kind: kind || 'info' });
  renderToasts();
  setTimeout(()=>{ toasts = toasts.filter(t=>t.id!==id); renderToasts(); }, 5200);
}
function renderToasts(){
  const wrap = document.getElementById('toast-wrap');
  wrap.innerHTML = toasts.map(t => `
    <div class="toast toast-${t.kind}">
      <span>${escapeHtml(t.msg)}</span>
      <button data-dismiss-toast="${t.id}" aria-label="Dismiss">&times;</button>
    </div>
  `).join('');
}
document.getElementById('toast-wrap').addEventListener('click', e=>{
  const btn = e.target.closest('[data-dismiss-toast]');
  if (!btn) return;
  const id = Number(btn.dataset.dismissToast);
  toasts = toasts.filter(t=>t.id!==id);
  renderToasts();
});

/* ============================== RENDER =================================== */
function render(){
  const app = document.getElementById('app');
  app.innerHTML = `
    ${renderMasthead()}
    <div class="tabs">
      ${tabBtn('tutee','Book a Session')}
      ${tabBtn('tutor','Tutor Sign-In')}
      ${tabBtn('admin','Admin')}
    </div>
    <div class="panel">
      ${state.view === 'tutee' ? renderTuteeView() : ''}
      ${state.view === 'tutor' ? renderTutorView() : ''}
      ${state.view === 'admin' ? renderAdminView() : ''}
    </div>
    <p class="footer-note">
      Need a change, an improvement, or found a bug? Email
      <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a> and it'll get looked at.
    </p>
  `;
  renderToasts();
}
function tabBtn(key, label){
  return `<button class="tab ${state.view===key?'active':''}" data-action="switch-view" data-target="${key}">${label}</button>`;
}
function renderMasthead(){
  const now = new Date();
  return `
    <div class="masthead">
      <div>
        <h1 class="brand-title">Science Tutoring — Sign-Up Desk</h1>
        <p class="brand-sub">Peer tutoring for Biology, Chemistry, Physics, AP Environmental Science, and AP Psychology.</p>
      </div>
      <div class="today">${fmtLong(now)}<br>${now.toLocaleTimeString([], {hour:'numeric', minute:'2-digit'})}</div>
    </div>
  `;
}

/* --------------------------- TUTEE VIEW ----------------------------------- */
function renderTuteeView(){
  const now = new Date();
  const dates = getEligibleDates(now, CONFIG.TUTEE_CUTOFF.h, CONFIG.TUTEE_CUTOFF.m);
  const closed = upcomingNoTutoringDates(now);
  const windowNote = dates.length
    ? `Open days right now: ${dates.map(fmtShort).join(', ')}. Each subject only meets on its teacher's usual days below.`
    : (closed.length
        ? `No sign-up days are open — the next two weeks are school holidays or breaks.`
        : `No sign-up days are open right now — check back Monday morning.`);
  return `
    <h2 class="section-title">Request a tutor</h2>
    <p class="section-sub">Sign-ups close for the current day at ${fmtHour(CONFIG.TUTEE_CUTOFF)}. ${windowNote}</p>
    ${closedDaysNote(now)}

    <form id="tutee-form" data-form="tutee-request">
      <div class="grid-2">
        <div class="field">
          <label class="req">Your name</label>
          <input name="tuteeName" required maxlength="80" placeholder="First and last name" />
        </div>
        <div class="field">
          <label class="req">Your email</label>
          <input name="tuteeEmail" type="email" required maxlength="120" placeholder="${EXAMPLE_EMAIL}" />
        </div>
      </div>
      <div class="grid-2">
        <div class="field">
          <label class="req">Subject</label>
          <select name="subjectKey" id="tutee-subject-select" required>
            <option value="">Choose a subject</option>
            ${Object.entries(CONFIG.SUBJECTS).map(([k,s])=>`<option value="${k}">${escapeHtml(s.label)} — ${escapeHtml(s.teacher)}</option>`).join('')}
          </select>
        </div>
        <div class="field" id="tutee-suboption-wrap"></div>
      </div>
      <div class="field">
        <label class="req">Day</label>
        <select name="date" id="tutee-date-select" disabled required>
          <option value="">Choose a subject first</option>
        </select>
        <div class="hint">Only days that are both open for sign-ups and taught by that subject's teacher are listed.</div>
      </div>
      <div class="field">
        <label>What do you need help with? <span class="fine">(optional)</span></label>
        <textarea name="note" maxlength="600" placeholder="e.g. Struggling with unit 3 stoichiometry problems, especially limiting reagent questions."></textarea>
      </div>
      <button type="submit" class="btn btn-primary">Submit request</button>
    </form>

    <hr class="divider" />

    <h2 class="section-title">Check on a request</h2>
    <p class="section-sub">Look up requests you've already submitted by email.</p>
    <form id="tutee-lookup-form" data-form="tutee-lookup" class="grid-2" style="align-items:end;">
      <div class="field" style="margin-bottom:0;">
        <label>Your email</label>
        <input name="lookupEmail" type="email" placeholder="${EXAMPLE_EMAIL}" value="${escapeHtml(state.lastSubmittedEmail||'')}" />
      </div>
      <div class="field" style="margin-bottom:0;">
        <button type="submit" class="btn">Look up my requests</button>
      </div>
    </form>
    ${renderTuteeLookupResults()}
  `;
}
function renderTuteeLookupResults(){
  if (!cache.lookupTickets) return '';
  if (!cache.lookupTickets.length) return `<div class="empty-state" style="margin-top:16px;">No requests found for that email yet.</div>`;
  return `<div class="ticket-list" style="margin-top:16px;">${cache.lookupTickets.map(t=>renderTicket(t,'tutee')).join('')}</div>`;
}

/* --------------------------- TICKET COMPONENT ------------------------------ */
function statusChip(status){
  const label = { open:'Open', claimed:'Claimed', completed:'Completed', cancelled:'Cancelled' }[status] || status;
  return `<span class="chip chip-${status}">${label}</span>`;
}
function renderTicket(t, context){
  const subj = CONFIG.SUBJECTS[t.subjectKey];
  const dateObj = parseISO(t.date);
  let actions = '';
  let taskBanner = '';
  if (context === 'tutor-board' && t.status === 'open'){
    // blockedReason comes from the server: they're cleared for this subject
    // but already booked in another room that day, or already have three here.
    actions = t.blockedReason
      ? `<button class="btn btn-primary btn-small" disabled>Sign up to tutor</button>
         <span class="fine">${escapeHtml(t.blockedReason)}</span>`
      : `<button class="btn btn-primary btn-small" data-action="claim-ticket" data-id="${t.id}">Sign up to tutor</button>`;
  }
  if (context === 'tutor-mine'){
    const canCancel = t.status === 'claimed' && dateObj.getTime() > todayMidnight().getTime();
    if (t.status === 'claimed'){
      actions += `<button class="btn btn-danger btn-small" data-action="cancel-ticket-self" data-id="${t.id}" ${canCancel?'':'disabled'}>Cancel appointment</button>`;
      if (!canCancel) actions += `<span class="fine">Same-day appointments can't be cancelled.</span>`;
      // Task fix: this is assigned the moment the session is claimed, not
      // gated behind the session date arriving.
      taskBanner = `
        <div class="task-banner">
          <strong>Task: submit proof of tutoring</strong>
          Upload a photo of you tutoring this student to mark the session complete.
          <div style="margin-top:8px;">
            <label class="btn btn-primary btn-small" style="cursor:pointer;">Upload photo<input type="file" accept="image/*" capture="environment" data-file="proof" data-id="${t.id}" style="display:none;"></label>
          </div>
        </div>
      `;
    }
    if (t.status === 'completed'){
      actions += `<span class="chip chip-completed">Proof received ✓</span>`;
    }
  }
  if (context === 'admin'){
    if (t.status === 'open' || t.status === 'claimed'){
      actions += `<button class="btn btn-danger btn-small" data-action="cancel-ticket-admin" data-id="${t.id}">Cancel session</button>`;
    }
    if (t.hasProofPhoto){
      actions += `<button class="btn btn-ghost btn-small" data-action="view-proof-photo" data-id="${t.id}">View proof photo</button>`;
    }
  }
  if (context === 'tutee' && t.status === 'open'){
    actions += `<button class="btn btn-ghost btn-small" data-action="withdraw-ticket" data-id="${t.id}">Withdraw request</button>`;
  }
  return `
    <div class="ticket ${SUBJ_CLASS[t.subjectKey]}">
      <div class="ticket-main">
        <div class="ticket-top">
          <span class="ticket-subject">${escapeHtml(subj ? subj.label : t.subjectLabel)}</span>
          ${t.subOption ? `<span class="fine">${escapeHtml(t.subOption)}</span>` : ''}
          ${statusChip(t.status)}
        </div>
        <div class="ticket-meta">${escapeHtml(t.teacher)}'s room · ${fmtLong(dateObj)}${t.tutorEmail ? ` · tutor: ${escapeHtml(t.tutorEmail)}` : ''}${context!=='tutor-board' && context!=='tutor-mine' ? ` · ${escapeHtml(t.tuteeName)} (${escapeHtml(t.tuteeEmail)})` : ''}</div>
        ${t.note ? `<div class="ticket-note">${escapeHtml(t.note)}</div>` : ''}
        ${actions ? `<div class="ticket-actions">${actions}</div>` : ''}
        ${taskBanner}
      </div>
      <div class="ticket-stub">
        <span class="ticket-id">${t.id}</span>
        <span class="ticket-date">${fmtShort(dateObj)}</span>
      </div>
    </div>
  `;
}

/* --------------------------- TUTOR VIEW ------------------------------------ */
function renderTutorView(){
  const tutor = session.tutor;
  if (!tutor) return renderTutorAuth();
  if (tutor.verificationStatus !== 'approved') return renderTutorVerification(tutor);
  return renderTutorDashboard(tutor);
}
function renderTutorAuth(){
  const isSignup = state.tutorAuthMode === 'signup';
  return `
    <div class="auth-card">
      <h2 class="section-title">${isSignup ? 'Create your tutor account' : 'Tutor sign-in'}</h2>
      <p class="section-sub">${isSignup ? 'Use your school email. After creating your account you\'ll verify it by uploading a photo of your completed verification form.' : 'Sign in to view open tutoring requests and manage your sessions.'}</p>
      <form data-form="${isSignup ? 'tutor-signup' : 'tutor-login'}">
        <div class="field">
          <label class="req">School email</label>
          <input name="email" type="email" required placeholder="${EXAMPLE_EMAIL}" />
        </div>
        <div class="field">
          <label class="req">Password</label>
          <input name="password" type="password" required minlength="8" placeholder="${isSignup?'At least 8 characters':'Your password'}" />
        </div>
        ${isSignup ? `
        <div class="field">
          <label class="req">Confirm password</label>
          <input name="confirmPassword" type="password" required minlength="8" />
        </div>` : ''}
        <button type="submit" class="btn btn-primary">${isSignup ? 'Create account' : 'Sign in'}</button>
      </form>
      <div class="auth-switch">
        ${isSignup
          ? `Already have an account? <button data-action="tutor-auth-mode" data-target="login">Sign in</button>`
          : `New tutor? <button data-action="tutor-auth-mode" data-target="signup">Create an account</button>`}
      </div>
    </div>
  `;
}
function renderTutorVerification(tutor){
  if (tutor.verificationStatus === 'unsubmitted' || tutor.verificationStatus === 'rejected'){
    return `
      <div class="auth-card">
        <h2 class="section-title">Verify your account</h2>
        ${tutor.verificationStatus === 'rejected'
          ? `<p class="section-sub" style="color:var(--danger);">Your last submission was rejected. Please upload a new, clear photo of your completed verification form.</p>`
          : `<p class="section-sub">Upload a photo of your completed tutor verification form so an admin can approve your account.</p>`}
        <div class="photo-drop">
          <p style="margin-bottom:0;">Take or choose a photo of your verification form</p>
          <input type="file" accept="image/*" capture="environment" data-file="verification-form" />
        </div>
        <div class="btn-row">
          <button class="btn btn-ghost btn-small" data-action="tutor-logout">Sign out</button>
        </div>
      </div>
    `;
  }
  return `
    <div class="auth-card">
      <h2 class="section-title">Verification pending</h2>
      <p class="section-sub">Thanks — your verification form was submitted. An admin needs to approve your account before you can sign up to tutor. Check back soon.</p>
      <div class="btn-row">
        <button class="btn btn-ghost btn-small" data-action="tutor-logout">Sign out</button>
      </div>
    </div>
  `;
}
function renderTutorDashboard(tutor){
  const now = new Date();
  const dates = getEligibleDates(now, CONFIG.TUTOR_CUTOFF.h, CONFIG.TUTOR_CUTOFF.m).map(fmtISO);
  const open = (cache.openTickets || []).filter(t => dates.includes(t.date));
  const mine = cache.myTickets || [];
  const docs = cache.myVolDocs || [];
  return `
    <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px; margin-bottom:6px;">
      <div>
        <h2 class="section-title" style="margin-bottom:2px;">Open tutoring requests</h2>
        <p class="section-sub" style="margin-bottom:0;">Signed in as ${escapeHtml(tutor.email)}. Sign-ups close at ${fmtHour(CONFIG.TUTOR_CUTOFF)} same-day. Up to ${CONFIG.MAX_PER_ROOM_PER_DAY} students a day, all in the same teacher's room — your first sign-up of the day picks the room.</p>
      </div>
      <button class="btn btn-ghost btn-small" data-action="tutor-logout">Sign out</button>
    </div>

    <div class="elig-panel">
      <h3 class="elig-panel-title">What you're approved to tutor</h3>
      <div class="elig-chip-row">${eligibilityChips(tutor.eligibility)}</div>
      <p class="fine" style="margin:8px 0 0;">
        ${tutor.eligibility
          ? 'Only requests matching these subjects and course levels appear on your board.'
          : 'An admin hasn\'t set your subjects yet, so every request is showing. Ask an admin to set them.'}
        Something look wrong? Email <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>.
      </p>
    </div>
    ${closedDaysNote(now)}

    <div style="margin:16px 0 26px;">
      ${open.length ? `<div class="ticket-list">${open.map(t=>renderTicket(t,'tutor-board')).join('')}</div>` : `<div class="empty-state">No open requests in your sign-up window right now.</div>`}
    </div>

    <hr class="divider" />
    <h2 class="section-title">My sessions</h2>
    <p class="section-sub">You can cancel an appointment up until the day before it happens. As soon as you claim a session, upload a photo as proof of tutoring.</p>
    ${mine.length ? `<div class="ticket-list">${mine.map(t=>renderTicket(t,'tutor-mine')).join('')}</div>` : `<div class="empty-state">You haven't signed up for any sessions yet.</div>`}

    <hr class="divider" />
    <h2 class="section-title">My documents</h2>
    <p class="section-sub">Volunteer-hours confirmations an admin has sent you.</p>
    ${docs.length ? `<div class="doc-list">${docs.map(d=>`
      <div class="doc-item">
        <span>${escapeHtml(d.title)} <span class="fine">— ${new Date(d.createdAt).toLocaleDateString()}</span></span>
        <a class="btn btn-ghost btn-small" href="/api/volunteer-hours/${d.id}/file" target="_blank" rel="noopener">Download</a>
      </div>
    `).join('')}</div>` : `<div class="empty-state">Nothing here yet.</div>`}
  `;
}

/* --------------------------- ADMIN VIEW ------------------------------------ */
function renderAdminView(){
  const admin = session.admin;
  if (!admin) return renderAdminAuth();
  return renderAdminDashboard(admin);
}
function renderAdminAuth(){
  return `
    <div class="auth-card">
      <h2 class="section-title">Admin sign-in</h2>
      <p class="section-sub">For tutoring program administrators. The very first admin account's password was printed once to the server's console log when it started up.</p>
      <form data-form="admin-login">
        <div class="field">
          <label class="req">Email</label>
          <input name="email" type="email" required />
        </div>
        <div class="field">
          <label class="req">Password</label>
          <input name="password" type="password" required />
        </div>
        <button type="submit" class="btn btn-primary">Sign in</button>
      </form>
    </div>
  `;
}
function renderAdminDashboard(admin){
  const tutors = cache.tutors || [];
  const pendingTutors = tutors.filter(t=>t.verificationStatus==='pending');
  const tickets = cache.allTickets || [];
  const open = tickets.filter(t=>t.status==='open').length;
  const claimed = tickets.filter(t=>t.status==='claimed').length;
  const completed = tickets.filter(t=>t.status==='completed').length;

  const subtabs = [
    ['overview','Overview'],
    ['verifications','Tutor Verifications' + (pendingTutors.length?` (${pendingTutors.length})`:'')],
    ['sessions','All Sessions'],
    ['tutors','Tutor Roster'],
    ['volhours','Volunteer Hours'],
    ['tutorboard','Tutor Board'],
    // Only the owner admin can add or remove other admins, so only they see
    // this tab. The server enforces it too.
    ...(admin.isSuper ? [['admins','Admin Accounts']] : []),
    ['account','Account']
  ];

  // The browser loads app.js fresh from disk on every visit, but the server
  // only picks up src/ changes when its process restarts. If those two get out
  // of step, features look present but quietly do nothing — so say so plainly
  // rather than letting an admin chase a phantom bug.
  const staleServer = admin.isSuper === undefined;
  const staleBanner = staleServer
    ? `<div class="notice"><strong>The server is running older code than this page.</strong>
         Subject clearances and admin-account controls won't work until the server process is
         restarted (stop it and run <strong>npm start</strong> again). Restarting also adds the
         database columns these features need.</div>`
    : '';

  let body = '';
  if (state.adminSubtab === 'overview'){
    body = `
      ${staleBanner}
      ${admin.mustChangePassword ? `<div class="notice">This account is still using its auto-generated password. Head to <strong>Account</strong> to set your own.</div>` : ''}
      <div class="stat-row">
        <div class="stat"><div class="num">${open}</div><div class="lbl">Open requests</div></div>
        <div class="stat"><div class="num">${claimed}</div><div class="lbl">Claimed sessions</div></div>
        <div class="stat"><div class="num">${completed}</div><div class="lbl">Completed sessions</div></div>
        <div class="stat"><div class="num">${pendingTutors.length}</div><div class="lbl">Tutors awaiting verification</div></div>
        <div class="stat"><div class="num">${tutors.filter(t=>t.verificationStatus==='approved').length}</div><div class="lbl">Approved tutors</div></div>
      </div>
      <p class="section-sub">Use the tabs above to review tutor verifications, manage sessions, send volunteer-hours PDFs, or claim a session yourself.</p>
    `;
  } else if (state.adminSubtab === 'verifications'){
    body = `
      <h2 class="section-title">Tutor verifications</h2>
      <p class="section-sub">Tutors upload a photo of their completed verification form — review it, then approve them for the specific subjects and course levels they're allowed to teach, or reject them.</p>
      ${pendingTutors.length ? `
        <table class="roster">
          <thead><tr><th>Email</th><th>Submitted</th><th>Verification Form</th><th>Decision</th></tr></thead>
          <tbody>
          ${pendingTutors.map(t=>`
            <tr>
              <td>${escapeHtml(t.email)}</td>
              <td>${new Date(t.createdAt).toLocaleDateString()}</td>
              <td><button class="btn btn-ghost btn-small" data-action="view-tutor-form" data-id="${t.id}">View form</button></td>
              <td>
                <div class="btn-row">
                  <button class="btn btn-primary btn-small" data-action="approve-tutor" data-id="${t.id}">Approve &amp; set subjects</button>
                  <button class="btn btn-danger btn-small" data-action="reject-tutor" data-id="${t.id}">Reject</button>
                </div>
              </td>
            </tr>
          `).join('')}
          </tbody>
        </table>
      ` : `<div class="empty-state">No tutors are waiting on verification.</div>`}
    `;
  } else if (state.adminSubtab === 'sessions'){
    body = `
      <h2 class="section-title">All tutoring sessions</h2>
      <p class="section-sub">Cancel a session for any reason — it will be closed out and won't automatically reopen.</p>
      ${tickets.length ? `<div class="ticket-list">${tickets.map(t=>renderTicket(t,'admin')).join('')}</div>` : `<div class="empty-state">No requests have been submitted yet.</div>`}
    `;
  } else if (state.adminSubtab === 'tutors'){
    body = `
      <h2 class="section-title">Tutor roster</h2>
      <p class="section-sub">Change what a tutor is allowed to teach at any time, or delete an account outright.</p>
      ${tutors.length ? `
        <table class="roster">
          <thead><tr><th>Email</th><th>Status</th><th>Approved to tutor</th><th>Joined</th><th></th></tr></thead>
          <tbody>
            ${tutors.map(t=>`
              <tr>
                <td>${escapeHtml(t.email)}</td>
                <td>${statusChip(t.verificationStatus)}</td>
                <td>${t.verificationStatus === 'approved'
                      ? `<div class="elig-chip-row">${eligibilityChips(t.eligibility)}</div>`
                      : `<span class="fine">—</span>`}</td>
                <td>${new Date(t.createdAt).toLocaleDateString()}</td>
                <td>
                  <div class="btn-row" style="margin-top:0; justify-content:flex-end;">
                    ${t.verificationStatus === 'approved'
                      ? `<button class="btn btn-ghost btn-small" data-action="edit-tutor-eligibility" data-id="${t.id}">Edit subjects</button>`
                      : ''}
                    <button class="btn btn-danger btn-small" data-action="delete-tutor" data-id="${t.id}">Delete</button>
                  </div>
                </td>
              </tr>`).join('')}
          </tbody>
        </table>
      ` : `<div class="empty-state">No tutors have signed up yet.</div>`}
    `;
  } else if (state.adminSubtab === 'volhours'){
    body = renderAdminVolunteerHours();
  } else if (state.adminSubtab === 'tutorboard'){
    body = renderAdminTutorBoard();
  } else if (state.adminSubtab === 'admins'){
    body = renderAdminAccounts(admin);
  } else if (state.adminSubtab === 'account'){
    body = `
      <h2 class="section-title">Account settings</h2>
      <p class="section-sub">Signed in as ${escapeHtml(admin.email)}.</p>
      <div class="auth-card" style="margin:0 0 26px;">
        <form data-form="admin-change-password">
          <div class="field"><label class="req">Current password</label><input name="currentPassword" type="password" required /></div>
          <div class="field"><label class="req">New password</label><input name="newPassword" type="password" required minlength="8" /></div>
          <div class="field"><label class="req">Confirm new password</label><input name="confirmPassword" type="password" required minlength="8" /></div>
          <button type="submit" class="btn btn-primary">Update password</button>
        </form>
      </div>
      <div class="btn-row">
        <button class="btn btn-ghost btn-small" data-action="admin-logout">Sign out</button>
        ${/* Owner-only: wiping every tutor and session is not something an
             admin the owner created should be able to do. Server enforced. */
          admin.isSuper
            ? `<button class="btn btn-danger btn-small" data-action="reset-all-data">Clear all data</button>`
            : ''}
      </div>
    `;
  }

  return `
    <div class="subtabs">${subtabs.map(([k,l])=>`<button class="subtab ${state.adminSubtab===k?'active':''}" data-action="admin-tab" data-target="${k}">${l}</button>`).join('')}</div>
    ${body}
  `;
}
function renderAdminVolunteerHours(){
  const tutors = cache.tutors || [];
  const approved = tutors.filter(t=>t.verificationStatus==='approved');
  if (!state.volHoursSelectedTutor && approved[0]) state.volHoursSelectedTutor = approved[0].id;
  const selected = state.volHoursSelectedTutor || '';
  const docs = cache.volDocsForTutor || [];
  return `
    <h2 class="section-title">Send volunteer hours</h2>
    <p class="section-sub">Send a tutor a PDF confirming their completed volunteer hours.</p>
    <div class="field" style="max-width:420px;">
      <label class="req">Tutor</label>
      <select id="volhours-tutor-select">
        ${approved.length ? approved.map(t=>`<option value="${t.id}" ${t.id===selected?'selected':''}>${escapeHtml(t.email)}</option>`).join('') : '<option value="">No approved tutors yet</option>'}
      </select>
    </div>
    <form data-form="admin-send-volhours" style="max-width:420px;">
      <div class="field">
        <label>Title / note <span class="fine">(optional)</span></label>
        <input name="title" maxlength="140" placeholder="e.g. Fall 2026 — 12 hours" />
      </div>
      <div class="field">
        <label class="req">PDF file</label>
        <input type="file" name="pdf" accept="application/pdf" required />
      </div>
      <button type="submit" class="btn btn-primary" ${approved.length?'':'disabled'}>Send PDF</button>
    </form>
    <hr class="divider" />
    <h3 style="font-size:16px;">Previously sent to this tutor</h3>
    ${docs.length ? `<div class="doc-list">${docs.map(d=>`
      <div class="doc-item">
        <span>${escapeHtml(d.title)} <span class="fine">— ${new Date(d.createdAt).toLocaleDateString()}</span></span>
        <a class="btn btn-ghost btn-small" href="/api/volunteer-hours/${d.id}/file" target="_blank" rel="noopener">Download</a>
      </div>
    `).join('')}</div>` : `<div class="empty-state">No documents sent to this tutor yet.</div>`}
  `;
}
function renderAdminAccounts(admin){
  const admins = cache.admins || [];
  return `
    <h2 class="section-title">Admin accounts</h2>
    <p class="section-sub">
      You're signed in as the <strong>owner admin</strong>, so you're the only one who can add or remove admins.
      Admins you create here can run everything else — verifications, sessions, volunteer hours — but they can't
      create or delete admin accounts, and they can't remove you.
    </p>
    ${admins.length ? `
      <table class="roster">
        <thead><tr><th>Email</th><th>Role</th><th>Added</th><th></th></tr></thead>
        <tbody>
          ${admins.map(a=>`
            <tr>
              <td>${escapeHtml(a.email)}${a.id===admin.id?` <span class="fine">(you)</span>`:''}</td>
              <td>${a.isSuper
                    ? `<span class="chip chip-approved">Owner</span>`
                    : `<span class="chip chip-open">Admin</span>`}
                  ${a.mustChangePassword && !a.isSuper ? `<span class="fine"> · hasn't set their own password yet</span>` : ''}</td>
              <td>${new Date(a.createdAt).toLocaleDateString()}</td>
              <td>
                <div class="btn-row" style="margin-top:0; justify-content:flex-end;">
                  ${a.isSuper
                    ? `<span class="fine">Can't be deleted</span>`
                    : `<button class="btn btn-danger btn-small" data-action="delete-admin" data-id="${a.id}">Delete</button>`}
                </div>
              </td>
            </tr>`).join('')}
        </tbody>
      </table>
    ` : `<div class="empty-state">No admin accounts loaded.</div>`}

    <hr class="divider" />
    <h3 style="font-size:16px;">Add an admin</h3>
    <p class="section-sub">Give them a temporary password and pass it on in person — they'll be asked to change it after signing in.</p>
    <form data-form="admin-create" class="auth-card" style="margin:0;">
      <div class="field">
        <label class="req">Their school email</label>
        <input name="email" type="email" required placeholder="${EXAMPLE_EMAIL}" />
      </div>
      <div class="field">
        <label class="req">Temporary password</label>
        <input name="password" type="password" required minlength="8" placeholder="At least 8 characters" />
      </div>
      <div class="field">
        <label class="req">Confirm temporary password</label>
        <input name="confirmPassword" type="password" required minlength="8" />
      </div>
      <button type="submit" class="btn btn-primary">Create admin account</button>
    </form>
  `;
}
function renderAdminTutorBoard(){
  const now = new Date();
  const dates = getEligibleDates(now, CONFIG.TUTOR_CUTOFF.h, CONFIG.TUTOR_CUTOFF.m).map(fmtISO);
  const open = (cache.openTickets || []).filter(t => dates.includes(t.date));
  const mine = cache.myTickets || [];
  return `
    <h2 class="section-title">Tutor board (acting as admin)</h2>
    <p class="section-sub">Admins can also claim requests directly, the same way a tutor would — and aren't limited to a subject list.</p>
    ${closedDaysNote(now)}
    ${open.length ? `<div class="ticket-list">${open.map(t=>renderTicket(t,'tutor-board')).join('')}</div>` : `<div class="empty-state">No open requests in the current sign-up window.</div>`}
    <hr class="divider" />
    <h3 style="font-size:16px;">My claimed sessions (as admin)</h3>
    ${mine.length ? `<div class="ticket-list">${mine.map(t=>renderTicket(t,'tutor-mine')).join('')}</div>` : `<div class="empty-state">None yet.</div>`}
  `;
}

/* ---------------------------- DATA LOADING -------------------------------- */
async function loadVolHoursForSelectedTutor(){
  if (!state.volHoursSelectedTutor){ cache.volDocsForTutor = []; return; }
  try{ cache.volDocsForTutor = await api('GET', `/api/volunteer-hours/for-tutor/${state.volHoursSelectedTutor}`); }
  catch(err){ cache.volDocsForTutor = []; }
}
async function loadAndRender(){
  try{
    if (state.view === 'tutor' && session.tutor && session.tutor.verificationStatus === 'approved'){
      const [open, mine, docs] = await Promise.all([
        api('GET','/api/tickets/open'),
        api('GET','/api/tickets/mine'),
        api('GET','/api/tutor/volunteer-hours')
      ]);
      cache.openTickets = open; cache.myTickets = mine; cache.myVolDocs = docs;
    }
    if (state.view === 'admin' && session.admin){
      if (['overview','verifications','tutors','volhours'].includes(state.adminSubtab)){
        cache.tutors = await api('GET','/api/admin/tutors');
      }
      if (['overview','sessions'].includes(state.adminSubtab)){
        cache.allTickets = await api('GET','/api/tickets/all');
      }
      if (state.adminSubtab === 'volhours'){
        const approved = (cache.tutors||[]).filter(t=>t.verificationStatus==='approved');
        if (!state.volHoursSelectedTutor && approved[0]) state.volHoursSelectedTutor = approved[0].id;
        await loadVolHoursForSelectedTutor();
      }
      if (state.adminSubtab === 'tutorboard'){
        const [open, mine] = await Promise.all([api('GET','/api/tickets/open'), api('GET','/api/tickets/mine')]);
        cache.openTickets = open; cache.myTickets = mine;
      }
      if (state.adminSubtab === 'admins' && session.admin.isSuper){
        cache.admins = await api('GET','/api/admin/admins');
      }
    }
  }catch(err){ pushToast(err.message, 'error'); }
  render();
}

/* ============================== HANDLERS =================================== */
async function handleTuteeRequest(form){
  const fd = new FormData(form);
  const payload = {
    tuteeName: (fd.get('tuteeName')||'').trim(),
    tuteeEmail: (fd.get('tuteeEmail')||'').trim(),
    subjectKey: fd.get('subjectKey'),
    subOption: fd.get('subOption') || null,
    date: fd.get('date'),
    note: (fd.get('note')||'').trim()
  };
  try{
    await api('POST','/api/tickets', payload);
    state.lastSubmittedEmail = payload.tuteeEmail;
    state.tuteeLookupEmail = payload.tuteeEmail;
    cache.lookupTickets = await api('GET', '/api/tickets?email=' + encodeURIComponent(payload.tuteeEmail));
    pushToast('Request submitted! Track its status below with your email.', 'success');
    render();
  }catch(err){ pushToast(err.message, 'error'); }
}
async function handleTuteeLookup(form){
  const fd = new FormData(form);
  const email = (fd.get('lookupEmail')||'').trim();
  if (!email){ pushToast('Enter the email you used to sign up.', 'error'); return; }
  try{
    state.tuteeLookupEmail = email;
    cache.lookupTickets = await api('GET','/api/tickets?email='+encodeURIComponent(email));
    render();
  }catch(err){ pushToast(err.message,'error'); }
}
async function handleWithdraw(id){
  try{
    await api('DELETE', '/api/tickets/'+id, { tuteeEmail: state.tuteeLookupEmail });
    cache.lookupTickets = (cache.lookupTickets||[]).filter(t=>t.id!==id);
    pushToast('Request withdrawn.', 'info');
    render();
  }catch(err){ pushToast(err.message,'error'); }
}
async function handleTutorSignup(form){
  const fd = new FormData(form);
  const payload = { email:(fd.get('email')||'').trim(), password: fd.get('password')||'', confirmPassword: fd.get('confirmPassword')||'' };
  try{
    session.tutor = await api('POST','/api/tutor/signup', payload);
    pushToast('Account created. Now upload a photo of your completed verification form.', 'success');
    render();
  }catch(err){ pushToast(err.message,'error'); }
}
async function handleTutorLogin(form){
  const fd = new FormData(form);
  const payload = { email:(fd.get('email')||'').trim(), password: fd.get('password')||'' };
  try{
    session.tutor = await api('POST','/api/tutor/login', payload);
    await loadAndRender();
  }catch(err){ pushToast(err.message,'error'); }
}
async function handleTutorLogout(){
  try{ await api('POST','/api/tutor/logout'); }catch(e){}
  session.tutor = null; render();
}
async function handleTutorVerifyFile(input){
  const file = input.files[0]; if (!file) return;
  pushToast('Uploading photo…','info');
  try{
    const dataUrl = await compressImage(file);
    const fd = new FormData(); fd.append('photo', dataURLToBlob(dataUrl), 'verification-form.jpg');
    const data = await api('POST','/api/tutor/verification-form', fd, true);
    session.tutor.verificationStatus = data.verificationStatus;
    pushToast('Photo received — your account is pending admin approval.','success');
    render();
  }catch(err){ pushToast(err.message,'error'); }
}
async function handleClaim(id){
  try{
    await api('POST', `/api/tickets/${id}/claim`);
    pushToast("You're signed up to tutor this session.",'success');
    await loadAndRender();
  }catch(err){ pushToast(err.message,'error'); }
}
async function handleSelfCancel(id){
  try{
    await api('POST', `/api/tickets/${id}/cancel`);
    pushToast('Appointment cancelled — the request has been reopened for another tutor.','info');
    await loadAndRender();
  }catch(err){ pushToast(err.message,'error'); }
}
async function handleProofFile(input){
  const id = input.dataset.id;
  const file = input.files[0]; if (!file) return;
  pushToast('Uploading photo…','info');
  try{
    const dataUrl = await compressImage(file);
    const fd = new FormData(); fd.append('photo', dataURLToBlob(dataUrl), 'proof.jpg');
    await api('POST', `/api/tickets/${id}/proof-photo`, fd, true);
    pushToast('Photo received — thanks for confirming the session!','success');
    await loadAndRender();
  }catch(err){ pushToast(err.message,'error'); }
}
// Approving a tutor and editing an approved tutor's subjects use the same
// picker — the only difference is which endpoint it saves to.
function openEligibilityModal(id, mode){
  const tutor = (cache.tutors || []).find(t => t.id === id);
  if (!tutor){ pushToast('That tutor is no longer in the list.','error'); return; }
  const heading = mode === 'approve' ? 'Approve tutor' : 'Edit what this tutor can teach';
  const cta = mode === 'approve' ? 'Approve tutor' : 'Save changes';
  showModal(`
    <h3 style="margin-bottom:2px;">${heading}</h3>
    <p class="section-sub" style="margin-bottom:14px;">
      ${escapeHtml(tutor.email)} — tick every subject they may tutor, and for subjects with course levels, exactly which levels.
    </p>
    ${eligibilityPicker(tutor.eligibility)}
    <div class="btn-row" style="margin-top:16px;">
      <button class="btn btn-primary btn-small" data-action="save-eligibility" data-id="${id}" data-mode="${mode}">${cta}</button>
      <button class="btn btn-ghost btn-small" data-action="close-modal">Cancel</button>
    </div>
  `);
}
async function handleSaveEligibility(id, mode){
  const eligibility = collectEligibility();
  const problem = validateEligibility(eligibility);
  if (problem){ pushToast(problem, 'error'); return; }
  try{
    if (mode === 'approve'){
      await api('POST', `/api/admin/tutors/${id}/approve`, { eligibility });
      pushToast('Tutor approved and their subjects are set.','success');
    } else {
      await api('PUT', `/api/admin/tutors/${id}/eligibility`, { eligibility });
      pushToast('Subjects updated.','success');
    }
    closeModal();
    await loadAndRender();
  }catch(err){ pushToast(err.message,'error'); }
}
async function handleDeleteTutor(id){
  const tutor = (cache.tutors || []).find(t => t.id === id);
  const who = tutor ? tutor.email : 'this tutor';
  if (!confirm(
    `Delete the tutor account for ${who}?\n\n` +
    `This permanently removes their account and any volunteer-hours PDFs sent to them. ` +
    `Sessions they'd claimed but not finished go back on the open board for another tutor. ` +
    `This cannot be undone.`
  )) return;
  try{
    const res = await api('DELETE', `/api/admin/tutors/${id}`);
    pushToast(
      `Deleted ${res.email}.` + (res.reopenedSessions ? ` ${res.reopenedSessions} session(s) reopened.` : ''),
      'info'
    );
    await loadAndRender();
  }catch(err){ pushToast(err.message,'error'); }
}
async function handleCreateAdmin(form){
  const fd = new FormData(form);
  const payload = {
    email: (fd.get('email')||'').trim(),
    password: fd.get('password')||'',
    confirmPassword: fd.get('confirmPassword')||''
  };
  try{
    const created = await api('POST','/api/admin/admins', payload);
    pushToast(`Admin account created for ${created.email}.`,'success');
    form.reset();
    await loadAndRender();
  }catch(err){ pushToast(err.message,'error'); }
}
async function handleDeleteAdmin(id){
  const target = (cache.admins || []).find(a => a.id === id);
  const who = target ? target.email : 'this admin';
  if (!confirm(`Delete the admin account for ${who}?\n\nThey'll lose access immediately. This cannot be undone.`)) return;
  try{
    const res = await api('DELETE', `/api/admin/admins/${id}`);
    pushToast(`Deleted admin ${res.email}.`,'info');
    await loadAndRender();
  }catch(err){ pushToast(err.message,'error'); }
}
async function handleRejectTutor(id){
  try{ await api('POST', `/api/admin/tutors/${id}/reject`); pushToast('Tutor verification rejected.','info'); await loadAndRender(); }
  catch(err){ pushToast(err.message,'error'); }
}
async function handleAdminCancel(id){
  try{ await api('POST', `/api/tickets/${id}/admin-cancel`); pushToast('Session cancelled.','info'); await loadAndRender(); }
  catch(err){ pushToast(err.message,'error'); }
}
async function handleAdminLogin(form){
  const fd = new FormData(form);
  try{
    session.admin = await api('POST','/api/admin/login', { email:(fd.get('email')||'').trim(), password: fd.get('password')||'' });
    await loadAndRender();
  }catch(err){ pushToast(err.message,'error'); }
}
async function handleAdminLogout(){
  try{ await api('POST','/api/admin/logout'); }catch(e){}
  session.admin = null; state.adminSubtab = 'overview'; render();
}
async function handleAdminChangePassword(form){
  const fd = new FormData(form);
  try{
    await api('POST','/api/admin/change-password', {
      currentPassword: fd.get('currentPassword')||'', newPassword: fd.get('newPassword')||'', confirmPassword: fd.get('confirmPassword')||''
    });
    session.admin.mustChangePassword = false;
    pushToast('Password updated.','success');
    render();
  }catch(err){ pushToast(err.message,'error'); }
}
async function handleAdminSendVolHours(form){
  const select = document.getElementById('volhours-tutor-select');
  const tutorId = select ? select.value : '';
  if (!tutorId){ pushToast('Choose a tutor first.','error'); return; }
  const fileInput = form.querySelector('input[type=file]');
  if (!fileInput || !fileInput.files[0]){ pushToast('Choose a PDF file.','error'); return; }
  const fd = new FormData(form);
  const payload = new FormData();
  payload.append('pdf', fileInput.files[0]);
  payload.append('title', fd.get('title') || '');
  try{
    await api('POST', `/api/volunteer-hours/${tutorId}`, payload, true);
    pushToast('PDF sent to the tutor.','success');
    state.volHoursSelectedTutor = tutorId;
    await loadVolHoursForSelectedTutor();
    render();
  }catch(err){ pushToast(err.message,'error'); }
}
async function handleResetAllData(){
  if (!confirm('This clears every tutor account and tutoring request (admin accounts are kept). Continue?')) return;
  try{
    await api('POST','/api/admin/reset');
    pushToast('All data cleared.','info');
    cache = { lookupTickets: null, openTickets: [], myTickets: [], myVolDocs: [], allTickets: [], tutors: [], admins: [], volDocsForTutor: [] };
    state.volHoursSelectedTutor = null;
    await loadAndRender();
  }catch(err){ pushToast(err.message,'error'); }
}

/* --------------------------- PHOTO MODAL ----------------------------------- */
function showModal(html){
  document.getElementById('modal-body').innerHTML = html;
  document.getElementById('photo-modal').classList.remove('hidden');
}
function closeModal(){
  document.getElementById('photo-modal').classList.add('hidden');
  document.getElementById('modal-body').innerHTML = '';
}
function handleViewTutorForm(id){
  showModal(`<h3 style="margin-bottom:8px;">Verification form</h3><img src="/api/tutor/${id}/verification-form" alt="Tutor verification form" />`);
}
function handleViewProofPhoto(id){
  showModal(`<h3 style="margin-bottom:8px;">Proof of tutoring</h3><img src="/api/tickets/${id}/proof-photo" alt="Tutoring proof photo" />`);
}

/* --------------------------- DEPENDENT FIELDS ------------------------------ */
function updateTuteeDependentFields(subjectKey){
  const subOptWrap = document.getElementById('tutee-suboption-wrap');
  const dateSelect = document.getElementById('tutee-date-select');
  if (!subOptWrap || !dateSelect) return;
  const subj = CONFIG.SUBJECTS[subjectKey];
  if (!subj){
    subOptWrap.innerHTML = '';
    dateSelect.innerHTML = '<option value="">Choose a subject first</option>';
    dateSelect.disabled = true;
    return;
  }
  subOptWrap.innerHTML = subj.subOptions
    ? `<label class="req">Course level</label><select name="subOption" required><option value="">Choose a level</option>${subj.subOptions.map(o=>`<option value="${escapeHtml(o)}">${escapeHtml(o)}</option>`).join('')}</select>`
    : '';
  const dates = eligibleForSubject(subjectKey, new Date(), CONFIG.TUTEE_CUTOFF.h, CONFIG.TUTEE_CUTOFF.m);
  if (!dates.length){
    dateSelect.innerHTML = '<option value="">No sessions available right now</option>';
    dateSelect.disabled = true;
  } else {
    dateSelect.disabled = false;
    dateSelect.innerHTML = '<option value="">Choose a day</option>' + dates.map(d=>`<option value="${fmtISO(d)}">${fmtLong(d)}</option>`).join('');
  }
}

/* ------------------------------ EVENTS ------------------------------------- */
document.addEventListener('submit', async (e)=>{
  const form = e.target;
  if (!form.dataset || !form.dataset.form) return;
  e.preventDefault();
  const kind = form.dataset.form;
  try{
    if (kind === 'tutee-request') await handleTuteeRequest(form);
    else if (kind === 'tutee-lookup') await handleTuteeLookup(form);
    else if (kind === 'tutor-signup') await handleTutorSignup(form);
    else if (kind === 'tutor-login') await handleTutorLogin(form);
    else if (kind === 'admin-login') await handleAdminLogin(form);
    else if (kind === 'admin-change-password') await handleAdminChangePassword(form);
    else if (kind === 'admin-send-volhours') await handleAdminSendVolHours(form);
    else if (kind === 'admin-create') await handleCreateAdmin(form);
  }catch(err){ console.error(err); pushToast('Something went wrong: ' + err.message, 'error'); }
});

document.addEventListener('change', async (e)=>{
  if (e.target.id === 'tutee-subject-select'){ updateTuteeDependentFields(e.target.value); return; }
  // Subject/level checkboxes in the eligibility picker move together: ticking
  // a subject grants all of its levels, and ticking any level grants the
  // subject it belongs to.
  if (e.target.matches('[data-elig-subject]')){
    const key = e.target.dataset.eligSubject;
    document.querySelectorAll(`[data-elig-level="${key}"]`).forEach(cb => { cb.checked = e.target.checked; });
    return;
  }
  if (e.target.matches('[data-elig-level]')){
    const key = e.target.dataset.eligLevel;
    const anyOn = Array.from(document.querySelectorAll(`[data-elig-level="${key}"]`)).some(cb => cb.checked);
    const subjectBox = document.querySelector(`[data-elig-subject="${key}"]`);
    if (subjectBox) subjectBox.checked = anyOn;
    return;
  }
  if (e.target.id === 'volhours-tutor-select'){
    state.volHoursSelectedTutor = e.target.value;
    await loadVolHoursForSelectedTutor();
    render();
    return;
  }
  if (e.target.matches('[data-file="verification-form"]')){ await handleTutorVerifyFile(e.target); return; }
  if (e.target.matches('[data-file="proof"]')){ await handleProofFile(e.target); return; }
});

document.addEventListener('click', async (e)=>{
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const action = btn.dataset.action;
  const id = btn.dataset.id;
  try{
    if (action === 'switch-view'){ state.view = btn.dataset.target; await loadAndRender(); }
    else if (action === 'tutor-auth-mode'){ state.tutorAuthMode = btn.dataset.target; render(); }
    else if (action === 'tutor-logout') await handleTutorLogout();
    else if (action === 'admin-logout') await handleAdminLogout();
    else if (action === 'admin-tab'){ state.adminSubtab = btn.dataset.target; await loadAndRender(); }
    else if (action === 'claim-ticket') await handleClaim(id);
    else if (action === 'cancel-ticket-self') await handleSelfCancel(id);
    else if (action === 'cancel-ticket-admin') await handleAdminCancel(id);
    else if (action === 'withdraw-ticket') await handleWithdraw(id);
    else if (action === 'approve-tutor') openEligibilityModal(id, 'approve');
    else if (action === 'edit-tutor-eligibility') openEligibilityModal(id, 'edit');
    else if (action === 'save-eligibility') await handleSaveEligibility(id, btn.dataset.mode);
    else if (action === 'delete-tutor') await handleDeleteTutor(id);
    else if (action === 'delete-admin') await handleDeleteAdmin(id);
    else if (action === 'reject-tutor') await handleRejectTutor(id);
    else if (action === 'view-tutor-form') handleViewTutorForm(id);
    else if (action === 'view-proof-photo') handleViewProofPhoto(id);
    else if (action === 'close-modal') closeModal();
    else if (action === 'reset-all-data') await handleResetAllData();
  }catch(err){ console.error(err); pushToast('Something went wrong: ' + err.message, 'error'); }
});
document.getElementById('photo-modal').addEventListener('click', (e)=>{
  if (e.target.id === 'photo-modal') closeModal();
});

/* -------------------------------- INIT -------------------------------------- */
async function init(){
  try{ session.tutor = await api('GET','/api/tutor/me'); }catch(e){ session.tutor = null; }
  try{ session.admin = await api('GET','/api/admin/me'); }catch(e){ session.admin = null; }
  await loadAndRender();
}
init();
