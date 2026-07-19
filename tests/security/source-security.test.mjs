import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const exists = (file) => fs.existsSync(path.join(root, file));

function filesUnder(directory, name = 'route.ts') {
  const absolute = path.join(root, directory);
  if (!fs.existsSync(absolute)) return [];
  const result = [];
  for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
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

test('public signup code and stored signup data are removed', () => {
  for (const file of [
    'app/api/signup-request/route.ts',
    'app/api/admin/signup-requests/route.ts',
    'app/api/admin/signup-requests/[id]/route.ts',
    'components/auth/SignupRequestForm.tsx',
    'components/admin/SignupRequestList.tsx',
    'lib/security/signup-invite-code.ts',
  ]) assert.equal(exists(file), false, `${file} must be removed`);
  assert.doesNotMatch(read('supabase/schema.sql'), /signup_requests/);
  assert.match(read('supabase/migration_20260719_full_server_security.sql'), /drop table if exists public\.signup_requests cascade/);
});

test('database policy removes direct anonymous business-data access', () => {
  const rls = read('supabase/rls-policies.sql');
  assert.doesNotMatch(rls, /create policy/i);
  assert.match(rls, /revoke all on public\.profiles from anon, authenticated/);
  assert.match(rls, /revoke all on public\.calendar_events from anon, authenticated/);
  assert.match(rls, /revoke all on public\.messages from anon, authenticated/);
});

test('server security layers are configured', () => {
  assert.match(read('proxy.ts'), /Content-Security-Policy/);
  assert.match(read('next.config.ts'), /Strict-Transport-Security/);
  assert.match(read('next.config.ts'), /private, no-store/);
  assert.match(read('lib/auth/guards.ts'), /assertAppSession/);
  assert.match(read('lib/auth/guards.ts'), /requireAal2/);
  assert.match(read('app/api/admin/users/[id]/route.ts'), /verifyCurrentPassword/);
  assert.match(read('lib/security/session-cookie.ts'), /SESSION_IDLE_SECONDS = 300/);
  assert.match(read('lib/security/request.ts'), /APP_ORIGIN/);
});

test('department admins can manage only ordinary users', () => {
  const guards = read('lib/auth/guards.ts');
  const route = read('app/api/admin/users/[id]/route.ts');
  assert.match(guards, /target\.role === "user"/);
  assert.match(route, /parsed\.data\.role !== "user"/);
  assert.match(read('app/api/admin/users/route.ts'), /query = query\.eq\("role", "user"\)/);
});

test('self approval is blocked in API and database functions', () => {
  assert.match(read('app/api/admin/approvals/[id]/route.ts'), /event\.user_id === user\.id/);
  assert.match(read('app/api/admin/event-change-requests/[id]/route.ts'), /changeRequest\.event\.user_id === user\.id/);
  const migration = read('supabase/migration_20260719_full_server_security.sql');
  assert.match(migration, /event_row\.user_id = p_actor_id/);
  assert.match(migration, /request_row\.requester_id = p_actor_id/);
  assert.match(migration, /SELF_APPROVAL_FORBIDDEN/);
});

test('approval decisions and audit records use atomic or fail-closed paths', () => {
  const migration = read('supabase/migration_20260719_full_server_security.sql');
  assert.match(migration, /decide_calendar_event_atomic/);
  assert.match(migration, /decide_event_change_atomic/);
  assert.match(migration, /for update/i);
  assert.match(read('lib/security/audit.ts'), /beginPrivilegedAudit/);
  assert.match(read('lib/security/audit.ts'), /if \(error\) throw error/);
  assert.match(read('app/api/admin/users/[id]/route.ts'), /beginPrivilegedAudit/);
  assert.match(read('app/api/admin/settings/route.ts'), /beginPrivilegedAudit/);
});

test('sensitive event titles, notes, requests and messages use encryption helpers', () => {
  const fields = read('lib/security/secure-fields.ts');
  assert.match(fields, /EVENT_FIELDS = \["title"/);
  assert.match(fields, /"proposed_title"/);
  assert.match(read('app/api/events/route.ts'), /decryptCalendarEvents/);
  assert.match(read('app/api/messages/route.ts'), /encryptMessageFields/);
  assert.match(read('scripts/migrate-content-encryption.mjs'), /\['calendar_events', \['title'/);
});

test('login failure limits do not share one global unknown-IP bucket', () => {
  const login = read('app/api/auth/login/route.ts');
  assert.match(login, /knownIp = ip !== "unknown"/);
  assert.match(login, /login-ip.*limit: 100/);
  assert.match(login, /login-id.*limit: 6/);
  assert.match(login, /assertRateLimitAvailable/);
});

test('security retention cleanup is scheduled automatically', () => {
  const migration = read('supabase/migration_20260719_full_server_security.sql');
  assert.match(migration, /cleanup_security_records/);
  assert.match(migration, /leave_calendar_security_cleanup/);
  assert.match(migration, /cron\.schedule/);
});

test('calendar API minimizes other-user data and bounds requested ranges', () => {
  const route = read('app/api/events/route.ts');
  assert.match(route, /view !== "calendar"/);
  assert.match(route, /assertCalendarRange/);
  assert.match(route, /publicUserId/);
  assert.match(route, /publicEventId/);
});

test('browser JavaScript cannot read Supabase authentication tokens', () => {
  assert.equal(exists('lib/supabase/client.ts'), false);
  assert.match(read('lib/supabase/server.ts'), /httpOnly:\s*true/);
  assert.match(read('proxy.ts'), /httpOnly:\s*true/);
  assert.doesNotMatch(read('components/auth/MfaGate.tsx'), /createBrowserClient|supabase\.auth/);
});

test('dependency override pins a patched PostCSS release', () => {
  const packageJson = JSON.parse(read('package.json'));
  assert.equal(packageJson.overrides?.postcss, '8.5.19');
});
