const { createClient } = require('@libsql/client');

if (!process.env.TURSO_DATABASE_URL) {
  console.warn(
    '\nWARNING: TURSO_DATABASE_URL is not set. Copy .env.example to .env and fill in\n' +
    'your Turso database URL and auth token (see README.md) before starting the server.\n'
  );
}

const client = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN
});

// --- Small helpers so the rest of the app can use plain objects instead of
//     libSQL's raw ResultSet shape. ---

function rowToObject(row, columns) {
  const obj = {};
  columns.forEach(col => { obj[col] = row[col]; });
  return obj;
}

async function all(sql, args = []) {
  const res = await client.execute({ sql, args });
  return res.rows.map(r => rowToObject(r, res.columns));
}

async function get(sql, args = []) {
  const rows = await all(sql, args);
  return rows[0] || null;
}

async function run(sql, args = []) {
  const res = await client.execute({ sql, args });
  return { changes: Number(res.rowsAffected || 0), lastInsertRowid: res.lastInsertRowid };
}

async function exec(sql) {
  await client.execute(sql);
}

async function initDb() {
  await exec(`
    CREATE TABLE IF NOT EXISTS tutors (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      verification_status TEXT NOT NULL DEFAULT 'unsubmitted',
      verification_form_data TEXT,
      verification_form_mime TEXT,
      created_at INTEGER NOT NULL
    )
  `);
  await exec(`
    CREATE TABLE IF NOT EXISTS admins (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      must_change_password INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL
    )
  `);
  await exec(`
    CREATE TABLE IF NOT EXISTS tickets (
      id TEXT PRIMARY KEY,
      tutee_name TEXT NOT NULL,
      tutee_email TEXT NOT NULL,
      subject_key TEXT NOT NULL,
      sub_option TEXT,
      date TEXT NOT NULL,
      note TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      tutor_id TEXT,
      tutor_email TEXT,
      claimed_at INTEGER,
      proof_photo_data TEXT,
      proof_photo_mime TEXT,
      proof_submitted_at INTEGER,
      cancelled_by TEXT,
      created_at INTEGER NOT NULL
    )
  `);
  await exec(`
    CREATE TABLE IF NOT EXISTS volunteer_hours_docs (
      id TEXT PRIMARY KEY,
      tutor_id TEXT NOT NULL,
      file_data TEXT NOT NULL,
      file_mime TEXT NOT NULL DEFAULT 'application/pdf',
      original_name TEXT,
      title TEXT,
      uploaded_by_admin_id TEXT,
      created_at INTEGER NOT NULL
    )
  `);
  await exec(`CREATE INDEX IF NOT EXISTS idx_tickets_status_date ON tickets(status, date)`);
  await exec(`CREATE INDEX IF NOT EXISTS idx_tickets_tutor ON tickets(tutor_id)`);
  await exec(`CREATE INDEX IF NOT EXISTS idx_tickets_tutee_email ON tickets(tutee_email)`);
  await exec(`CREATE INDEX IF NOT EXISTS idx_volhours_tutor ON volunteer_hours_docs(tutor_id)`);
}

module.exports = { client, all, get, run, exec, initDb };
