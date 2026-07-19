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
    if (index > 0) process.env[trimmed.slice(0, index).trim()] ??= trimmed.slice(index + 1).trim().replace(/^['"]|['"]$/g, '');
  }
}

const required = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} 환경변수가 필요합니다.`);
  return value;
};

function keyFrom(raw) {
  if (/^[0-9a-f]{64}$/i.test(raw)) return Buffer.from(raw, 'hex');
  const decoded = Buffer.from(raw, 'base64');
  if (decoded.length === 32) return decoded;
  return crypto.createHash('sha256').update(raw, 'utf8').digest();
}

const key = keyFrom(required('PII_ENCRYPTION_KEY'));
const admin = createClient(required('NEXT_PUBLIC_SUPABASE_URL'), required('SUPABASE_SERVICE_ROLE_KEY'), {
  auth: { autoRefreshToken: false, persistSession: false },
});

function encrypt(value) {
  if (value == null || value === '') return value ?? null;
  if (value.startsWith('enc:v1:')) return value;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['enc:v1', iv.toString('base64url'), tag.toString('base64url'), ciphertext.toString('base64url')].join(':');
}

const targets = [
  ['calendar_events', ['description', 'public_note', 'admin_note', 'rejection_reason']],
  ['event_change_requests', ['reason', 'proposed_description', 'proposed_public_note', 'proposed_admin_note', 'rejection_reason']],
  ['messages', ['title', 'content']],
  ['signup_requests', ['reason', 'rejection_reason']],
];

for (const [table, fields] of targets) {
  const { data: rows, error } = await admin.from(table).select(`id,${fields.join(',')}`);
  if (error) throw error;
  for (const row of rows ?? []) {
    const update = {};
    for (const field of fields) {
      if (typeof row[field] === 'string' && !row[field].startsWith('enc:v1:')) update[field] = encrypt(row[field]);
    }
    if (Object.keys(update).length === 0) continue;
    const { error: updateError } = await admin.from(table).update(update).eq('id', row.id);
    if (updateError) throw updateError;
  }
  console.log(`${table} 민감내용 암호화 완료`);
}

console.log('일정 메모, 요청 사유, 쪽지 내용 암호화가 완료되었습니다.');
