import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

const envPath = path.join(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const index = trimmed.indexOf('=');
    if (index > 0) process.env[trimmed.slice(0, index).trim()] ??= trimmed.slice(index + 1).trim().replace(/^['\"]|['\"]$/g, '');
  }
}

const required = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} 환경변수가 필요합니다.`);
  return value;
};

const supabaseUrl = required('NEXT_PUBLIC_SUPABASE_URL');
const serviceRoleKey = required('SUPABASE_SERVICE_ROLE_KEY');
const encryptionKeyRaw = required('PII_ENCRYPTION_KEY');
const hashKeyRaw = required('PII_HASH_KEY');

function keyFrom(raw) {
  if (/^[0-9a-f]{64}$/i.test(raw)) return Buffer.from(raw, 'hex');
  const decoded = Buffer.from(raw, 'base64');
  if (decoded.length === 32) return decoded;
  return crypto.createHash('sha256').update(raw, 'utf8').digest();
}

const encryptionKey = keyFrom(encryptionKeyRaw);
const hashKey = keyFrom(hashKeyRaw);
const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function encrypt(value) {
  if (value == null || value === '') return value ?? null;
  if (value.startsWith('enc:v1:')) return value;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey, iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['enc:v1', iv.toString('base64url'), tag.toString('base64url'), ciphertext.toString('base64url')].join(':');
}

function decrypt(value) {
  if (value == null || value === '' || !value.startsWith('enc:v1:')) return value;
  const parts = value.split(':');
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey, Buffer.from(parts[2], 'base64url'));
  decipher.setAuthTag(Buffer.from(parts[3], 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(parts[4], 'base64url')), decipher.final()]).toString('utf8');
}

function loginHash(loginId) {
  return crypto.createHmac('sha256', hashKey)
    .update(`login-id:${loginId.trim().normalize('NFKC').toLocaleLowerCase('en-US')}`, 'utf8')
    .digest('hex');
}

function authEmail(loginId) {
  return `${loginHash(loginId)}@leave-calendar.local`;
}

async function migrateProfiles() {
  const { data: rows, error } = await admin.from('profiles').select('*');
  if (error) throw error;
  for (const row of rows ?? []) {
    const loginId = decrypt(row.login_id);
    const displayName = decrypt(row.display_name);
    const monthDay = row.birth_month_day ? decrypt(row.birth_month_day) : row.birth_date?.slice(5) ?? null;
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
      login_id: encrypt(loginId),
      login_id_hash: loginHash(loginId),
      display_name: encrypt(displayName),
      birth_month_day: monthDay ? encrypt(monthDay) : null,
      must_change_password: true,
      password_changed_at: null,
    }).eq('id', row.id);
    if (updateError) throw updateError;
    console.log(`프로필 암호화 완료: ${row.id}`);
  }
}

async function migrateSignupRequests() {
  const { data: rows, error } = await admin.from('signup_requests').select('*');
  if (error) throw error;
  for (const row of rows ?? []) {
    const loginId = decrypt(row.requested_login_id);
    const name = decrypt(row.name);
    const monthDay = row.birth_month_day ? decrypt(row.birth_month_day) : row.birth_date?.slice(5) ?? null;
    const reason = decrypt(row.reason);
    const update = {
      name: encrypt(name),
      requested_login_id: encrypt(loginId),
      requested_login_id_hash: loginId ? loginHash(loginId) : null,
      birth_month_day: monthDay ? encrypt(monthDay) : null,
      reason: reason ? encrypt(reason) : null,
    };
    const { error: updateError } = await admin.from('signup_requests').update(update).eq('id', row.id);
    if (updateError) throw updateError;
    console.log(`가입신청 암호화 완료: ${row.id}`);
  }
}

async function migrateAdminSettings() {
  const { data: rows, error } = await admin.from('admin_settings').select('*');
  if (error) throw error;
  for (const row of rows ?? []) {
    const name = decrypt(row.display_name);
    const { error: updateError } = await admin.from('admin_settings').update({ display_name: encrypt(name) }).eq('id', row.id);
    if (updateError) throw updateError;
  }
}

await migrateProfiles();
await migrateSignupRequests();
await migrateAdminSettings();
console.log('개인정보 암호화 마이그레이션이 완료되었습니다. 이제 finalize SQL을 실행하세요.');
