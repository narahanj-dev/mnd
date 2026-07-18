import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const envPath = path.join(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const index = trimmed.indexOf('=');
    if (index > 0) process.env[trimmed.slice(0, index).trim()] ??= trimmed.slice(index + 1).trim().replace(/^['"]|['"]$/g, '');
  }
}

const required = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} 환경변수가 필요합니다.`);
  return value;
};
const keyFrom = (raw) => {
  if (/^[0-9a-f]{64}$/i.test(raw)) return Buffer.from(raw, 'hex');
  const decoded = Buffer.from(raw, 'base64');
  return decoded.length === 32 ? decoded : crypto.createHash('sha256').update(raw).digest();
};
const encryptionKey = keyFrom(required('PII_ENCRYPTION_KEY'));
const hashKey = keyFrom(required('PII_HASH_KEY'));
const passwordPepper = required('PASSWORD_HISTORY_PEPPER');
const supabase = createClient(required('NEXT_PUBLIC_SUPABASE_URL'), required('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });

function encrypt(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey, iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return ['enc:v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ciphertext.toString('base64url')].join(':');
}
function loginHash(value) {
  return crypto.createHmac('sha256', hashKey).update(`login-id:${value.trim().normalize('NFKC').toLocaleLowerCase('en-US')}`).digest('hex');
}
function authEmail(value) { return `${loginHash(value)}@leave-calendar.local`; }
function passwordFingerprint(userId, password) { return crypto.createHmac('sha256', passwordPepper).update(`${userId}:${password}`).digest('hex'); }
function validatePassword(password) {
  const categories = [/[A-Z]/.test(password), /[a-z]/.test(password), /\d/.test(password), /[^A-Za-z0-9]/.test(password)].filter(Boolean).length;
  return password.length >= 9 && categories >= 3 && !/(1234|qwerty|asdf|zxcv|password|love|happy)/i.test(password);
}

const users = [{
  loginId: required('INITIAL_ADMIN_ID'),
  password: required('INITIAL_ADMIN_PASSWORD'),
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

for (const account of users) {
  if (!validatePassword(account.password)) throw new Error(`${account.loginId} 비밀번호가 보안정책을 충족하지 않습니다.`);
  const email = authEmail(account.loginId);
  const { data: existing } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
  let authUser = existing?.users.find((user) => user.email === email);
  if (!authUser) {
    const { data, error } = await supabase.auth.admin.createUser({
      email, password: account.password, email_confirm: true,
      app_metadata: { role: account.role }, user_metadata: { login_id: null, display_name: null, department: null, birth_date: null, birth_month_day: null, must_change_password: true },
    });
    if (error || !data.user) throw error ?? new Error('계정 생성 실패');
    authUser = data.user;
  } else {
    const { error } = await supabase.auth.admin.updateUserById(authUser.id, {
      password: account.password, app_metadata: { role: account.role }, user_metadata: { login_id: null, display_name: null, department: null, birth_date: null, birth_month_day: null, must_change_password: true },
    });
    if (error) throw error;
  }

  const now = new Date().toISOString();
  const { error: profileError } = await supabase.from('profiles').upsert({
    id: authUser.id,
    login_id: encrypt(account.loginId), login_id_hash: loginHash(account.loginId),
    display_name: encrypt(account.displayName), department: account.department, role: account.role,
    account_status: 'active', must_change_password: true, password_changed_at: now,
  });
  if (profileError) throw profileError;
  await supabase.from('password_history').upsert({
    user_id: authUser.id,
    password_fingerprint: passwordFingerprint(authUser.id, account.password),
  }, { onConflict: 'user_id,password_fingerprint' });
  if (account.role === 'admin') {
    await supabase.from('admin_settings').upsert({ admin_user_id: authUser.id, display_name: encrypt(account.displayName) }, { onConflict: 'admin_user_id' });
  }
  console.log(`${account.loginId} 계정 준비 완료`);
}
