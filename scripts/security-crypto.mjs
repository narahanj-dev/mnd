import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const VERSION = 'enc:v1';

export function loadLocalEnv() {
  const envPath = path.join(process.cwd(), '.env.local');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const index = trimmed.indexOf('=');
    if (index <= 0) continue;
    const name = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^['"]|['"]$/g, '');
    process.env[name] ??= value;
  }
}

export function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} 환경변수가 필요합니다.`);
  return value;
}

export function keyFromEnv(name) {
  const raw = requiredEnv(name);
  if (/^[0-9a-f]{64}$/i.test(raw)) return Buffer.from(raw, 'hex');

  let decoded;
  try {
    decoded = Buffer.from(raw, 'base64');
  } catch {
    throw new Error(`${name} 환경변수는 32바이트 Base64 또는 64자리 16진수 키여야 합니다.`);
  }
  const normalizedInput = raw.replace(/=+$/, '');
  const normalizedDecoded = decoded.toString('base64').replace(/=+$/, '');
  if (decoded.length !== 32 || normalizedInput !== normalizedDecoded) {
    throw new Error(`${name} 환경변수는 32바이트 Base64 또는 64자리 16진수 키여야 합니다.`);
  }
  return decoded;
}

export function encryptValue(value, key) {
  if (value == null) return null;
  if (value.startsWith(`${VERSION}:`)) return value;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [VERSION, iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ciphertext.toString('base64url')].join(':');
}

export function decryptValue(value, key) {
  if (value == null || value === '' || !value.startsWith(`${VERSION}:`)) return value;
  const parts = value.split(':');
  if (parts.length !== 5) throw new Error('암호화 데이터 형식이 올바르지 않습니다.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(parts[2], 'base64url'));
  decipher.setAuthTag(Buffer.from(parts[3], 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(parts[4], 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

export function blindIndex(value, purpose, key) {
  return crypto.createHmac('sha256', key)
    .update(`${purpose}:${value.trim().normalize('NFKC').toLocaleLowerCase('en-US')}`, 'utf8')
    .digest('hex');
}

export function passwordFingerprint(userId, password, pepper) {
  return crypto.createHmac('sha256', pepper).update(`${userId}:${password}`).digest('hex');
}
