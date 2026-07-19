import { createClient } from '@supabase/supabase-js';
import {
  blindIndex,
  decryptValue,
  encryptValue,
  keyFromEnv,
  loadLocalEnv,
  requiredEnv,
} from './security-crypto.mjs';

loadLocalEnv();

const supabaseUrl = requiredEnv('NEXT_PUBLIC_SUPABASE_URL');
const serviceRoleKey = requiredEnv('SUPABASE_SERVICE_ROLE_KEY');
const encryptionKey = keyFromEnv('PII_ENCRYPTION_KEY');
const hashKey = keyFromEnv('PII_HASH_KEY');
const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function loginHash(loginId) {
  return blindIndex(loginId, 'login-id', hashKey);
}
function authEmail(loginId) {
  return `${loginHash(loginId)}@leave-calendar.local`;
}

async function migrateProfiles() {
  const { data: rows, error } = await admin.from('profiles').select('*');
  if (error) throw error;
  for (const row of rows ?? []) {
    const loginId = decryptValue(row.login_id, encryptionKey);
    const displayName = decryptValue(row.display_name, encryptionKey);
    const monthDay = row.birth_month_day
      ? decryptValue(row.birth_month_day, encryptionKey)
      : row.birth_date?.slice(5) ?? null;
    if (!loginId || !displayName) throw new Error(`프로필 ${row.id}의 아이디 또는 이름이 없습니다.`);

    const { data: authData, error: authReadError } = await admin.auth.admin.getUserById(row.id);
    if (authReadError || !authData.user) throw authReadError ?? new Error(`Auth 사용자 ${row.id} 없음`);
    const { error: authError } = await admin.auth.admin.updateUserById(row.id, {
      email: authEmail(loginId),
      email_confirm: true,
      user_metadata: { login_id: null, display_name: null, department: null, birth_date: null, birth_month_day: null, must_change_password: true },
      app_metadata: authData.user.app_metadata,
    });
    if (authError) throw authError;

    const { error: updateError } = await admin.from('profiles').update({
      login_id: encryptValue(loginId, encryptionKey),
      login_id_hash: loginHash(loginId),
      display_name: encryptValue(displayName, encryptionKey),
      birth_month_day: monthDay ? encryptValue(monthDay, encryptionKey) : null,
      must_change_password: true,
      password_changed_at: null,
    }).eq('id', row.id);
    if (updateError) throw updateError;
    console.log(`프로필 암호화 완료: ${row.id}`);
  }
}

async function migrateAdminSettings() {
  const { data: rows, error } = await admin.from('admin_settings').select('*');
  if (error) throw error;
  for (const row of rows ?? []) {
    const name = decryptValue(row.display_name, encryptionKey);
    const { error: updateError } = await admin.from('admin_settings')
      .update({ display_name: encryptValue(name, encryptionKey) })
      .eq('id', row.id);
    if (updateError) throw updateError;
  }
}

await migrateProfiles();
await migrateAdminSettings();
console.log('프로필 및 관리자 설정 개인정보 암호화 마이그레이션이 완료되었습니다.');
