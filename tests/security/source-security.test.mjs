import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

function filesUnder(directory, name = 'route.ts') {
  const result = [];
  for (const entry of fs.readdirSync(path.join(root, directory), { withFileTypes: true })) {
    const relative = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...filesUnder(relative, name));
    else if (entry.name === name) result.push(relative);
  }
  return result;
}

test('all state-changing API routes enforce same-origin checks', () => {
  for (const file of filesUnder('app/api')) {
    const source = read(file);
    if (/export async function (POST|PATCH|DELETE)/.test(source)) {
      assert.match(source, /assertSameOrigin\(request\)/, `${file} is missing CSRF same-origin validation`);
    }
  }
});

test('fixed temporary password and decryptable signup password storage are absent', () => {
  const checked = [
    'lib/constants.ts',
    'app/api/admin/users/[id]/route.ts',
    'app/api/signup-request/route.ts',
    'supabase/schema.sql',
  ].map(read).join('\n');
  assert.doesNotMatch(checked, /RESET_TEMPORARY_PASSWORD|mnd890701!/);
  assert.doesNotMatch(checked, /requested_password/);
  assert.match(read('app/api/signup-request/route.ts'), /auth\.admin\.createUser/);
  assert.match(read('app/api/signup-request/route.ts'), /account_status:\s*"pending"/);
});

test('database policy removes direct anonymous business-data access', () => {
  const rls = read('supabase/rls-policies.sql');
  assert.doesNotMatch(rls, /Anyone can submit signup request/i);
  assert.doesNotMatch(rls, /create policy/i);
  assert.match(rls, /revoke all on public\.profiles from anon, authenticated/);
  assert.match(rls, /revoke all on public\.calendar_events from anon, authenticated/);
  assert.match(rls, /revoke all on public\.messages from anon, authenticated/);
});

test('server security layers are configured', () => {
  assert.match(read('proxy.ts'), /Content-Security-Policy/);
  assert.match(read('next.config.ts'), /Strict-Transport-Security/);
  assert.match(read('lib/auth/guards.ts'), /assertAppSession/);
  assert.match(read('lib/auth/guards.ts'), /requireAal2/);
  assert.match(read('app/api/admin/users/[id]/route.ts'), /verifyCurrentPassword/);
  assert.match(read('lib/security/session-cookie.ts'), /SESSION_IDLE_SECONDS = 300/);
  assert.match(read('supabase/migration_20260719_full_server_security.sql'), /consume_security_rate_limit/);
  assert.match(read('supabase/migration_20260719_full_server_security.sql'), /security_audit_logs/);
});

test('sensitive event and message fields use application encryption helpers', () => {
  assert.match(read('app/api/events/route.ts'), /encryptCalendarEventFields/);
  assert.match(read('app/api/events/route.ts'), /decryptCalendarEvent/);
  assert.match(read('app/api/messages/route.ts'), /encryptMessageFields/);
  assert.match(read('app/api/messages/route.ts'), /decryptMessages/);
  assert.match(read('scripts/migrate-content-encryption.mjs'), /calendar_events/);
  assert.match(read('scripts/migrate-content-encryption.mjs'), /messages/);
});
