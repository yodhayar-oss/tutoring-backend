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

I wrote and syntax-checked every file (`node --check`) and unit-tested the
scheduling logic in isolation, but I could not run `npm install`, connect to
a real Turso database, or actually start this server myself — the
environment I built it in has no outbound network access. The database
layer (`src/db.js`) and the `@libsql/client` usage follow that library's
documented API, but please run through the real flows yourself before
trusting this with real students: sign up as a tutee, sign up and verify as
a tutor, claim a session, upload proof, log in as admin, approve a tutor,
and send a volunteer-hours PDF — both locally and on your deployed copy.

## Project layout

```
server.js                     — Express app entry point
src/db.js                     — Turso client + query helpers + schema
src/auth.js                   — signed-cookie (JWT) login helpers
src/auth-middleware.js        — route guards (tutor / admin / either) built on auth.js
src/async-handler.js          — wraps async route handlers so errors aren't swallowed
src/eligibility.js            — sign-up window & claim-limit rules (authoritative copy)
src/serialize.js              — DB row -> API response shaping
src/bootstrap.js              — creates the first admin account on first run
src/routes/tickets.js         — tutee requests, claiming, cancelling, proof uploads
src/routes/tutors.js          — tutor signup/login, verification form upload
src/routes/admin.js           — admin login, tutor roster/approval, reset
src/routes/volunteerHours.js  — admin sends PDFs, tutor/admin downloads them
public/                       — the frontend (index.html, styles.css, app.js) — unchanged from the disk-based version, since it only talks to the API
```
