require('dotenv').config();
const { createClient } = require('@libsql/client');

console.log('URL:', process.env.TURSO_DATABASE_URL);
console.log('Token starts with:', (process.env.TURSO_AUTH_TOKEN || '').slice(0, 8) + '...');

const client = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN
});

client.execute('SELECT 1 as ok')
  .then(res => console.log('SUCCESS:', res.rows))
  .catch(err => console.error('FAILED:', err.message));