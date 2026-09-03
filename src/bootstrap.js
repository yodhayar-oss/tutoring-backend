const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { get, run } = require('./db');

function genPassword(len = 12) {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  const bytes = crypto.randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += chars[bytes[i] % chars.length];
  return out;
}

async function bootstrapAdmin() {
  const existing = await get('SELECT COUNT(*) as c FROM admins');
  if (existing && existing.c > 0) return;

  const email = process.env.ADMIN_BOOTSTRAP_EMAIL || 'admin@yourschool.edu';
  const password = genPassword(12);
  const passwordHash = await bcrypt.hash(password, 12);
  const id = 'ad_' + crypto.randomUUID();

  await run(
    'INSERT INTO admins (id, email, password_hash, must_change_password, created_at) VALUES (?,?,?,1,?)',
    [id, email, passwordHash, Date.now()]
  );

  console.log('\n==============================================');
  console.log('  First-run admin account created');
  console.log('  Email:    ' + email);
  console.log('  Password: ' + password);
  console.log('  Sign in and change this password right away');
  console.log('  (Admin -> Account). This will not be shown again.');
  console.log('==============================================\n');
}

module.exports = { bootstrapAdmin };
