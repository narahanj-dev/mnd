import crypto from 'node:crypto';
for (const name of [
  'PII_ENCRYPTION_KEY',
  'PII_HASH_KEY',
  'PASSWORD_HISTORY_PEPPER',
  'SESSION_SIGNING_KEY',
  'RATE_LIMIT_PEPPER',
]) {
  console.log(`${name}=${crypto.randomBytes(32).toString('base64')}`);
}
