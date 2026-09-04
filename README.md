# Science Tutoring — Backend & Site

A Node.js/Express backend that stores everything — accounts, tickets,
verification-form photos, tutoring-proof photos, and volunteer-hours PDFs —
in **Turso**, a free hosted SQLite-compatible database. Nothing is written to
the server's local disk, which means this app can run on a genuinely free
host (like Render's free tier) without losing data when the service restarts,
sleeps, or gets redeployed.

## Why this version is different

The first version of this backend stored its database and uploaded files as
regular files on the server's disk. That's normal for a real server, but most
free hosting tiers don't give you a disk that survives restarts — so photos
and accounts would quietly vanish. This version fixes that by:

- Using **Turso** (free, hosted, SQLite-compatible) instead of a local `.db` file
- Storing uploaded photos and PDFs as data *inside* that database instead of as files on disk
- Using signed, httpOnly cookies (JSON Web Tokens) for login instead of a server-side session store

The result: the whole app is "stateless" from the host's point of view. You
can restart it, redeploy it, or run it on a free tier that wipes its disk
constantly, and nothing is lost — the data lives in Turso, not on the server.

## Requirements

- Node.js 18 or newer
- npm
- A free Turso account (no credit card) — see below

## 1. Create a free Turso database

1. Go to **[turso.tech](https://turso.tech)** and sign up for free.
2. Once you're in the dashboard, create a new database (any name, e.g. `tutoring`).
3. Find your database's connection URL — it looks like `libsql://tutoring-yourname.turso.io`.
4. Create an auth token for it (Turso's dashboard has a button for this, usually under the database's "Settings" or a "Create Token" action).
5. Keep both the URL and the token handy for the next step.

(If you're comfortable with a terminal, Turso also has a CLI — `turso db create`, `turso db show --url`, `turso db tokens create` — but the dashboard works fine too.)

## 2. Set up and run locally

1. `npm install`
2. `cp .env.example .env`, then edit it:
   - `TURSO_DATABASE_URL` — the URL from step 1
   - `TURSO_AUTH_TOKEN` — the token from step 1
   - `JWT_SECRET` — a long random string. Generate one with:
     `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
   - `ADMIN_BOOTSTRAP_EMAIL` — the email for the first admin account
3. `npm start`
4. Open `http://localhost:3000`
5. Check your terminal for the auto-generated first-run admin password —
   it's printed once to the server console, never shown in the browser.
   Sign in as admin and change it right away (Admin → Account).

The database tables are created automatically the first time the server
starts, directly in your Turso database.

## 3. Deploy somewhere free

Because there's no local disk to worry about anymore, you can deploy this to
**Render's free tier** (or Railway, Fly.io, Cyclic, etc.) and it will keep its
data:

1. Push this project to a GitHub repository (your `.env` file is git-ignored on purpose — never commit it).
2. On Render, create a new **Web Service** from that repository.
   - Build command: `npm install`
   - Start command: `npm start`
   - Instance type: **Free**
3. In Render's "Environment" tab, add the same variables from your `.env` file: `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `JWT_SECRET`, `ADMIN_BOOTSTRAP_EMAIL`, and `NODE_ENV=production`.
4. Deploy. Render gives you a public URL like `https://your-app.onrender.com`.
5. Check the "Logs" tab for the one-time admin password, same as running locally.

**What "free" still means here:** Render's free web services go to sleep
after 15 minutes with no visitors and take 30-60 seconds to wake back up on
the next visit. That's just a speed inconvenience now, not a data-loss risk —
your accounts, requests, and photos stay safe in Turso the whole time,
however long the service has been asleep.

## Scheduling, tutor subjects, and admin roles

### Days with no tutoring

`src/eligibility.js` holds `NO_TUTORING_DATES` — the 2026-27 school year's
holidays, breaks, and staff days. Those days are never offered to students or
tutors, and are rejected by the server even if someone crafts the request by
hand. The list is mirrored in `public/app.js` so the booking form can hide
them instantly; **if you edit one copy, edit the other**, then run:

```
npm run test:dates
```

That script re-checks the whole calendar against the real scheduling rules
(no server or database needed) and fails loudly if the two copies disagree or
a day isn't actually being blocked.

There is also a browser-based tester at **`/date-tester.html`** — see
"The date tester" below.

### What each tutor is allowed to teach

When an admin approves a tutor, they pick the exact subjects — and for
Biology, Chemistry, and Physics the exact course levels — that tutor may
teach. Those clearances are stored as JSON on the tutor's row and can be
changed at any time from **Admin → Tutor Roster → Edit subjects**.

- Tutors see their own clearances at the top of their dashboard.
- The open-requests board only shows requests they're cleared for, and the
  server refuses a claim for anything else.
- Admins acting as tutors aren't restricted to a subject list.
- A tutor approved *before* this feature existed has no clearances recorded.
  Rather than locking them out, they're treated as cleared for everything and
  flagged in the roster as "All subjects — not set yet" until an admin sets a
  real list.

### One room per tutor per day

Every subject has a `room` in `src/eligibility.js` (Biology → Mr. Hauser,
Chemistry → Mrs. Montgomery, and so on). On any given day a tutor works in
**one room only**, with at most `MAX_PER_ROOM_PER_DAY` (3) students in it:

- Their first sign-up of the day picks the room. Every other room is locked
  for that day.
- They can take a 2nd and 3rd student in that same room; a 4th is refused.
- Other days are unaffected — the rule is per day, not per week.
- Cancelling a session frees the slot back up, and cancelling all of them
  releases the room so a different one can be chosen.
- Admins claiming sessions follow the same rule.

Requests a tutor can't take today still appear on their board, greyed out
with the reason (`blockedReason` on `GET /api/tickets/open`), rather than
vanishing without explanation. The server re-checks on every claim, so the
greyed-out button isn't the only thing enforcing it.

If two subjects ever move into the same teacher's room, give them the same
`room` value in both `src/eligibility.js` and `public/app.js` and the rule
follows automatically.

### Sending volunteer hours

**Admin → Volunteer Hours** sends one PDF to as many tutors as you tick, in a
single upload. Each recipient gets their own row in the database, so they can
download their own copy and deleting one tutor never removes another's
document. **Select all** / **Clear** are there for the common "everyone who
tutored this term" case, and ticking the same person twice still sends one
copy.

Below the form, **Everything sent so far** lists every document grouped by
the tutor it went to.

### Deleting tutors

**Admin → Tutor Roster → Delete** removes a tutor account after a
confirmation prompt. Sessions they had claimed but not yet completed go back
on the open board for another tutor; completed sessions are left alone so the
record of who tutored whom survives.

### Admin accounts

The first-run admin (the one created from `ADMIN_BOOTSTRAP_EMAIL`) is the
**owner admin**. Only that account can:

- create or delete admin accounts (the **Admin Accounts** tab is hidden from
  everyone else), and
- use **Clear all data**, which wipes every tutor account, request, and
  volunteer-hours document in one go.

The server enforces both, not just the UI. Admins the owner creates can do
everything else — verifications, subject clearances, sessions, volunteer
hours, deleting individual tutors — but cannot add or remove admins, cannot
delete the owner, and cannot wipe the database. The owner account itself
can't be deleted.

If you're upgrading a database that already had admins in it, the oldest
admin account is automatically promoted to owner the next time the server
starts.

## The date tester

`/date-tester.html` is a temporary tool for checking the no-tutoring
calendar: pick any date in the school year and it shows exactly what the
server would offer, plus a one-click pass/fail run over all 32 closed days.
It's read-only and never touches accounts or the database.

**It is no longer linked from the site** — type the URL to reach it (e.g.
`http://localhost:3000/date-tester.html`). To delete it entirely:

1. Delete `public/date-tester.html`
2. Delete `public/date-tester.js`
3. Delete `src/routes/dateTester.js`
4. Delete the two `dateTester` lines in `server.js`

`tools/verify-blackout-dates.js` and `npm run test:dates` are worth keeping —
they don't ship anything to the browser.

## Restart the server after changing anything in `src/`

`public/` is read from disk on every request, so front-end edits show up as
soon as you reload the page. Everything in `src/` and `server.js` is loaded
into memory once at startup. If the server keeps running while those change,
the site ends up with a **new front end talking to an old back end** —
features appear in the UI but silently do nothing, and any new database
columns never get added.

Stop the server and run `npm start` again after touching `src/`. The Admin →
Overview tab shows a warning banner when it detects this mismatch.

## What's stored where

- **Turso** — every table: tutor/admin accounts, tutee requests, ticket
  history, verification-form photos, tutoring-proof photos, and
  volunteer-hours PDFs (photos/PDFs are stored base64-encoded in text
  columns, not as separate files).
- **Nothing** is stored on the server's local disk. There's no `data/`
  folder in this version.

Back up your data by exporting your Turso database periodically (Turso's
dashboard and CLI both support this) — that's now the only copy of your data.

## Security notes

- Passwords are hashed with bcrypt.
- Login state is a signed, httpOnly cookie (a JWT) — the server never keeps
  a list of "logged in" users; it just verifies the cookie's signature on
  each request. Cookies expire after 12 hours.
- Verification-form photos, tutoring-proof photos, and volunteer-hours PDFs
  are only served to an admin or the person who owns them — never made public.
- Set `NODE_ENV=production` once you're behind HTTPS — this makes login
  cookies `secure`, so they're never sent over plain HTTP.
- This still stores photos of a verification form, tutoring-proof photos, and
  volunteer-hour PDFs — some of it about students who may be minors. Check
  with your school's IT/administration about data retention and privacy
  requirements (e.g. FERPA) before rolling this out for real.
- Helmet's Content-Security-Policy is turned off for simplicity (it
  otherwise blocks the Google Fonts stylesheet). Consider tightening it later.

## A note on testing

The scheduling calendar, per-tutor subject clearances, tutor deletion, and
the owner-only admin controls were run end-to-end against a live server
backed by a local SQLite file (`TURSO_DATABASE_URL=file:test-local.db`),
covering both the API and the browser UI. `npm run test:dates` re-runs the
calendar half of that any time, with no server or database needed.

Sending volunteer-hours PDFs to several tutors at once was covered the same
way (25 checks over the API plus a run through the real form in a browser).

What's still only been exercised against a local SQLite file rather than a
real Turso database: the photo uploads (verification forms and
proof-of-tutoring). Walk through those yourself on your deployed copy before
trusting this with real students.

## Project layout

```
server.js                     — Express app entry point
src/db.js                     — Turso client + query helpers + schema
src/auth.js                   — signed-cookie (JWT) login helpers
src/auth-middleware.js        — route guards (tutor / admin / either) built on auth.js
src/async-handler.js          — wraps async route handlers so errors aren't swallowed
src/eligibility.js            — sign-up window, no-tutoring calendar, one-room-per-day rule, tutor subject clearances (authoritative copy)
src/serialize.js              — DB row -> API response shaping
src/bootstrap.js              — creates the first admin (the owner admin) on first run
src/routes/tickets.js         — tutee requests, claiming, cancelling, proof uploads
src/routes/tutors.js          — tutor signup/login, verification form upload
src/routes/admin.js           — admin login, tutor roster/approval/deletion, admin accounts, reset
src/routes/volunteerHours.js  — admin sends one PDF to one or more tutors, tutor/admin downloads them
src/routes/dateTester.js      — TEMPORARY read-only calendar preview API (see "Removing the date tester")
tools/verify-blackout-dates.js— `npm run test:dates` — checks the no-tutoring calendar with no server needed
public/index.html, app.js, styles.css  — the frontend; talks to the API only
public/date-tester.html, date-tester.js — TEMPORARY calendar tester page
```
