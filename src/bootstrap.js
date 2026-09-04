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
  if (existing && existing.c > 0) {
    // A database created before admin accounts had an owner flag: promote the
    // oldest admin, so there's always exactly one account that can create and
    // remove other admins.
    const supers = await get('SELECT COUNT(*) as c FROM admins WHERE is_super = 1');
    if (!supers || !supers.c) {
      const oldest = await get('SELECT id, email FROM admins ORDER BY created_at ASC LIMIT 1');
      if (oldest) {
        await run('UPDATE admins SET is_super = 1 WHERE id = ?', [oldest.id]);
        console.log(`Owner admin set to ${oldest.email} (the first admin account created).`);
      }
    }
    return;
  }

  const email = process.env.ADMIN_BOOTSTRAP_EMAIL || 'admin@yourschool.edu';
  const password = genPassword(12);
  const passwordHash = await bcrypt.hash(password, 12);
  const id = 'ad_' + crypto.randomUUID();

  await run(
    'INSERT INTO admins (id, email, password_hash, must_change_password, is_super, created_at) VALUES (?,?,?,1,1,?)',
    [id, email, passwordHash, Date.now()]
  );

  console.log('\n==============================================');
  console.log('  First-run admin account created (owner admin —');
  console.log('  the only one who can add or remove other admins)');
  console.log('  Email:    ' + email);
  console.log('  Password: ' + password);
  console.log('  Sign in and change this password right away');
  console.log('  (Admin -> Account). This will not be shown again.');
  console.log('==============================================\n');
}

module.exports = { bootstrapAdmin };
