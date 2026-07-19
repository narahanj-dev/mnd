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
  assert.doesNotMatch(read('app/api/signup-request/route.ts'), /auth\.admin\.createUser/);
  assert.match(read('app/api/signup-request/route.ts'), /status:\s*403/);
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
  assert.match(read('lib/security/session-cookie.ts'), /SESSION_ABSOLUTE_SECONDS/);
  assert.match(read('lib/security/request.ts'), /APP_ORIGIN/);
  assert.match(read('supabase/migration_20260719_full_server_security.sql'), /consume_security_rate_limit/);
  assert.match(read('supabase/migration_20260719_full_server_security.sql'), /security_audit_logs/);
});

test('sensitive event and message fields use application encryption helpers', () => {
  assert.match(read('app/api/events/route.ts'), /encryptCalendarEventFields/);
  assert.match(read('app/api/events/route.ts'), /\.eq\("status", "approved"\)/);
  assert.doesNotMatch(read('app/api/events/route.ts'), /select\("[^"]*description/);
  assert.match(read('app/api/messages/route.ts'), /encryptMessageFields/);
  assert.match(read('app/api/messages/route.ts'), /decryptMessages/);
  assert.match(read('scripts/migrate-content-encryption.mjs'), /calendar_events/);
  assert.match(read('scripts/migrate-content-encryption.mjs'), /messages/);
});


test('department capacity thresholds and closed signup flow are wired into the UI', () => {
  const constants = read('lib/constants.ts');
  const calendar = read('components/calendar/CalendarBoard.tsx');
  const loginForm = read('components/auth/LoginForm.tsx');
  assert.match(constants, /WEEKDAY_DEPARTMENT_CAPACITY_PERCENT = 25/);
  assert.match(constants, /WEEKEND_DEPARTMENT_CAPACITY_PERCENT = 35/);
  assert.match(calendar, /DEPARTMENT_CAPACITY_EVENT_TYPES/);
  assert.match(calendar, /percentage > capacityThreshold|people\.size \/ memberCount\) \* 100 > capacityThreshold/);
  assert.doesNotMatch(loginForm, /signup-request|회원가입 신청/);
  assert.match(read('app/signup-request/page.tsx'), /signup-disabled/);
});


test('calendar API minimizes other-user data and bounds requested ranges', () => {
  const route = read('app/api/events/route.ts');
  assert.match(route, /view !== "calendar"/);
  assert.match(route, /assertCalendarRange/);
  assert.match(route, /publicUserId/);
  assert.match(route, /publicEventId/);
  assert.doesNotMatch(route, /rejection_reason,approved_by,approved_at,created_at,updated_at/);
});

test('privileged account APIs consistently require AAL2', () => {
  for (const file of [
    'app/api/events/route.ts',
    'app/api/events/[id]/route.ts',
    'app/api/event-change-requests/route.ts',
    'app/api/messages/route.ts',
    'app/api/messages/[id]/route.ts',
    'app/api/auth/change-password/route.ts',
  ]) {
    assert.match(read(file), /requireAal2/, `${file} is missing privileged MFA enforcement`);
  }
});

test('approval decisions use atomic database functions', () => {
  const migration = read('supabase/migration_20260719_security_hardening.sql');
  assert.match(migration, /decide_calendar_event_atomic/);
  assert.match(migration, /decide_event_change_atomic/);
  assert.match(migration, /for update/i);
  assert.match(migration, /event_change_requests_one_pending_per_event_idx/);
  assert.match(read('app/api/admin/approvals/[id]/route.ts'), /decide_calendar_event_atomic/);
  assert.match(read('app/api/admin/event-change-requests/[id]/route.ts'), /decide_event_change_atomic/);
});

test('cryptographic configuration rejects weak fallback keys', () => {
  const pii = read('lib/security/pii.ts');
  assert.doesNotMatch(pii, /createHash\("sha256"\)\.update\(raw/);
  assert.match(pii, /32바이트 Base64|64자리 16진수/);
  assert.match(read('lib/security/password-history.ts'), /length < 32/);
});

test('browser JavaScript cannot read Supabase authentication tokens', () => {
  assert.equal(fs.existsSync(path.join(root, 'lib/supabase/client.ts')), false);
  assert.match(read('lib/supabase/server.ts'), /httpOnly:\s*true/);
  assert.match(read('proxy.ts'), /httpOnly:\s*true/);
  assert.match(read('components/auth/MfaGate.tsx'), /\/api\/auth\/mfa/);
  assert.doesNotMatch(read('components/auth/MfaGate.tsx'), /createBrowserClient|supabase\.auth/);
});
