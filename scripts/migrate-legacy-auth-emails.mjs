import { createClient } from '@supabase/supabase-js';
import {
  blindIndex,
  decryptValue,
  keyFromEnv,
  loadLocalEnv,
  requiredEnv,
} from './security-crypto.mjs';

loadLocalEnv();

const encryptionKey = keyFromEnv('PII_ENCRYPTION_KEY');
const hashKey = keyFromEnv('PII_HASH_KEY');
const admin = createClient(
  requiredEnv('NEXT_PUBLIC_SUPABASE_URL'),
  requiredEnv('SUPABASE_SERVICE_ROLE_KEY'),
  { auth: { autoRefreshToken: false, persistSession: false } },
);

function expectedEmail(loginId) {
  const hash = blindIndex(loginId, 'login-id', hashKey);
  return `${hash}@leave-calendar.local`;
}

const { data: profiles, error: profileError } = await admin.from('profiles').select('id,login_id');
if (profileError) throw profileError;

let migrated = 0;
let unchanged = 0;
for (const profile of profiles ?? []) {
  const loginId = decryptValue(profile.login_id, encryptionKey);
  if (!loginId) throw new Error(`프로필 ${profile.id}의 아이디를 복호화할 수 없습니다.`);
  const email = expectedEmail(loginId);
  const { data: authData, error: readError } = await admin.auth.admin.getUserById(profile.id);
  if (readError || !authData.user) throw readError ?? new Error(`Auth 사용자 ${profile.id}를 찾을 수 없습니다.`);
  if (authData.user.email === email) {
    unchanged += 1;
    continue;
  }
  const { error: updateError } = await admin.auth.admin.updateUserById(profile.id, {
    email,
    email_confirm: true,
    app_metadata: authData.user.app_metadata,
    user_metadata: authData.user.user_metadata,
  });
  if (updateError) throw updateError;
  migrated += 1;
  console.log(`Auth 이메일 전환 완료: ${profile.id}`);
}

console.log(`구형 Auth 이메일 전환 완료: 변경 ${migrated}명, 기존 정상 ${unchanged}명`);
