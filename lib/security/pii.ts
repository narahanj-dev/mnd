import { createCipheriv, createDecipheriv, createHmac, createHash, randomBytes } from "node:crypto";

const VERSION = "enc:v1";
const AUTH_EMAIL_DOMAIN = "leave-calendar.local";

type Row = Record<string, unknown>;

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} 환경변수가 설정되지 않았습니다.`);
  return value;
}

function keyFromEnv(name: string) {
  const raw = requiredEnv(name);
  if (/^[0-9a-f]{64}$/i.test(raw)) return Buffer.from(raw, "hex");
  try {
    const decoded = Buffer.from(raw, "base64");
    if (decoded.length === 32) return decoded;
  } catch {}
  return createHash("sha256").update(raw, "utf8").digest();
}

function encryptionKey() {
  return keyFromEnv("PII_ENCRYPTION_KEY");
}

function hashKey() {
  return keyFromEnv("PII_HASH_KEY");
}

export function encryptPii(value: string | null | undefined) {
  if (value == null || value === "") return value ?? null;
  if (value.startsWith(`${VERSION}:`)) return value;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(":");
}

export function decryptPii(value: string | null | undefined) {
  if (value == null || value === "") return value ?? null;
  if (!value.startsWith(`${VERSION}:`)) return value;
  const parts = value.split(":");
  if (parts.length !== 5) throw new Error("암호화 데이터 형식이 올바르지 않습니다.");
  const [, , ivText, tagText, cipherText] = parts;
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivText, "base64url"));
  decipher.setAuthTag(Buffer.from(tagText, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(cipherText, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export function blindIndex(value: string, purpose: string) {
  return createHmac("sha256", hashKey())
    .update(`${purpose}:${value.trim().normalize("NFKC").toLocaleLowerCase("en-US")}`, "utf8")
    .digest("hex");
}

export function loginIdHash(loginId: string) {
  return blindIndex(loginId, "login-id");
}

export function loginIdToAuthEmail(loginId: string) {
  return `${loginIdHash(loginId)}@${AUTH_EMAIL_DOMAIN}`;
}

export function legacyLoginIdToAuthEmail(loginId: string) {
  return `${loginId.trim()}@${AUTH_EMAIL_DOMAIN}`;
}

export function sanitizedAuthUserMetadata(mustChangePassword: boolean) {
  return {
    login_id: null,
    display_name: null,
    department: null,
    birth_date: null,
    birth_month_day: null,
    must_change_password: mustChangePassword,
  };
}

export function birthMonthDay(value: string) {
  const match = /^(?:\d{4}-)?(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) throw new Error("생일은 월/일 형식이어야 합니다.");
  const month = Number(match[1]);
  const day = Number(match[2]);
  const testYear = 2000;
  const date = new Date(Date.UTC(testYear, month - 1, day));
  if (date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) {
    throw new Error("올바른 월/일을 입력하세요.");
  }
  return `${match[1]}-${match[2]}`;
}

export function maskDisplayName(name: string) {
  const chars = Array.from(name.trim());
  if (chars.length === 0) return "*";
  if (chars.length === 1) return "*";
  if (chars.length === 2) return `${chars[0]}*`;
  if (chars.length === 3) return `${chars[0]}*${chars[2]}`;
  return `${chars[0]}${chars[1]}${"*".repeat(chars.length - 2)}`;
}

export function encryptProfileValues(values: {
  login_id?: string;
  display_name?: string;
  birth_month_day?: string | null;
}) {
  const result: Row = {};
  if (values.login_id !== undefined) {
    result.login_id = encryptPii(values.login_id);
    result.login_id_hash = loginIdHash(values.login_id);
  }
  if (values.display_name !== undefined) result.display_name = encryptPii(values.display_name);
  if (values.birth_month_day !== undefined) {
    result.birth_month_day = values.birth_month_day ? encryptPii(birthMonthDay(values.birth_month_day)) : null;
  }
  return result;
}

export function decryptProfile<T>(row: T): T {
  if (!row || typeof row !== "object") return row;
  const value = row as Row;
  return {
    ...value,
    ...(typeof value.login_id === "string" ? { login_id: decryptPii(value.login_id) } : {}),
    ...(typeof value.display_name === "string" ? { display_name: decryptPii(value.display_name) } : {}),
    ...(typeof value.birth_month_day === "string" ? { birth_month_day: decryptPii(value.birth_month_day) } : {}),
  } as T;
}

export function decryptProfiles<T>(rows: T[] | null | undefined) {
  return (rows ?? []).map((row) => decryptProfile(row));
}

export function decryptProfileRelation<T>(relation: T): T {
  if (Array.isArray(relation)) return relation.map((row) => decryptProfile(row)) as T;
  return decryptProfile(relation);
}

export function encryptSignupRequestValues(values: {
  name?: string;
  requested_login_id?: string;
  birth_month_day?: string;
  reason?: string | null;
}) {
  const result: Row = {};
  if (values.name !== undefined) result.name = encryptPii(values.name);
  if (values.requested_login_id !== undefined) {
    result.requested_login_id = encryptPii(values.requested_login_id);
    result.requested_login_id_hash = loginIdHash(values.requested_login_id);
  }
  if (values.birth_month_day !== undefined) {
    result.birth_month_day = encryptPii(birthMonthDay(values.birth_month_day));
  }
  if (values.reason !== undefined) result.reason = values.reason ? encryptPii(values.reason) : null;
  return result;
}

export function decryptSignupRequest<T>(row: T): T {
  if (!row || typeof row !== "object") return row;
  const value = row as Row;
  return {
    ...value,
    ...(typeof value.name === "string" ? { name: decryptPii(value.name) } : {}),
    ...(typeof value.requested_login_id === "string" ? { requested_login_id: decryptPii(value.requested_login_id) } : {}),
    ...(typeof value.birth_month_day === "string" ? { birth_month_day: decryptPii(value.birth_month_day) } : {}),
    ...(typeof value.reason === "string" ? { reason: decryptPii(value.reason) } : {}),
  } as T;
}
