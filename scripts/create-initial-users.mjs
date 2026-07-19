import { createClient } from '@supabase/supabase-js';
import {
  blindIndex,
  encryptValue,
  keyFromEnv,
  loadLocalEnv,
  passwordFingerprint,
  requiredEnv,
} from './security-crypto.mjs';

loadLocalEnv();

const encryptionKey = keyFromEnv('PII_ENCRYPTION_KEY');
const hashKey = keyFromEnv('PII_HASH_KEY');
const passwordPepper = requiredEnv('PASSWORD_HISTORY_PEPPER');
const supabase = createClient(
  requiredEnv('NEXT_PUBLIC_SUPABASE_URL'),
  requiredEnv('SUPABASE_SERVICE_ROLE_KEY'),
  { auth: { autoRefreshToken: false, persistSession: false } },
);

function loginHash(value) {
  return blindIndex(value, 'login-id', hashKey);
}
function authEmail(value) {
  return `${loginHash(value)}@leave-calendar.local`;
}
function validatePassword(password) {
  const categories = [/[A-Z]/.test(password), /[a-z]/.test(password), /\d/.test(password), /[^A-Za-z0-9]/.test(password)].filter(Boolean).length;
  return password.length >= 9 && password.length <= 100 && categories >= 3 && !/(1234|qwerty|asdf|zxcv|password|love|happy)/i.test(password);
}

const users = [{
  loginId: requiredEnv('INITIAL_ADMIN_ID'),
  password: requiredEnv('INITIAL_ADMIN_PASSWORD'),
  displayName: process.env.INITIAL_ADMIN_NAME || '관리자',
  department: process.env.INITIAL_ADMIN_DEPARTMENT || '대대본부',
  role: 'admin',
}];
for (const number of [1, 2]) {
  const loginId = process.env[`TEST_USER_${number}_ID`]?.trim();
  const password = process.env[`TEST_USER_${number}_PASSWORD`]?.trim();
  if (loginId && password) users.push({
    loginId,
    password,
    displayName: process.env[`TEST_USER_${number}_NAME`] || `사용자${number}`,
    department: process.env[`TEST_USER_${number}_DEPARTMENT`] || '대대본부',
    role: 'user',
  });
}

const { data: existingUsers, error: listError } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
if (listError) throw listError;

for (const account of users) {
  if (!validatePassword(account.password)) throw new Error(`${account.loginId} 비밀번호가 보안정책을 충족하지 않습니다.`);
  const email = authEmail(account.loginId);
  let authUser = existingUsers?.users.find((user) => user.email === email);
  if (!authUser) {
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password: account.password,
      email_confirm: true,
      app_metadata: { role: account.role, session_version: 1 },
      user_metadata: { login_id: null, display_name: null, department: null, birth_date: null, birth_month_day: null, must_change_password: true },
    });
    if (error || !data.user) throw error ?? new Error('계정 생성 실패');
    authUser = data.user;
  } else {
    const { error } = await supabase.auth.admin.updateUserById(authUser.id, {
      password: account.password,
      app_metadata: { role: account.role, session_version: 1 },
      user_metadata: { login_id: null, display_name: null, department: null, birth_date: null, birth_month_day: null, must_change_password: true },
    });
    if (error) throw error;
  }

  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const { error: profileError } = await supabase.from('profiles').upsert({
    id: authUser.id,
    login_id: encryptValue(account.loginId, encryptionKey),
    login_id_hash: loginHash(account.loginId),
    display_name: encryptValue(account.displayName, encryptionKey),
    department: account.department,
    role: account.role,
    account_status: 'active',
    must_change_password: true,
    password_changed_at: now,
    session_version: 1,
    temporary_password_expires_at: expiresAt,
  });
  if (profileError) throw profileError;

  const { error: historyError } = await supabase.from('password_history').upsert({
    user_id: authUser.id,
    password_fingerprint: passwordFingerprint(authUser.id, account.password, passwordPepper),
  }, { onConflict: 'user_id,password_fingerprint' });
  if (historyError) throw historyError;

  if (account.role === 'admin') {
    const { error: settingsError } = await supabase.from('admin_settings').upsert({
      admin_user_id: authUser.id,
      display_name: encryptValue(account.displayName, encryptionKey),
    }, { onConflict: 'admin_user_id' });
    if (settingsError) throw settingsError;
  }
  console.log(`${account.loginId} 계정 준비 완료`);
}
