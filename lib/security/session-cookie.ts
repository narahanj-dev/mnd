import { createHmac, timingSafeEqual } from "node:crypto";
import { SecurityError } from "@/lib/security/errors";

export const APP_SESSION_COOKIE_NAME = "mnd_app_session";
export const SESSION_IDLE_SECONDS = 300;
export const SESSION_ABSOLUTE_SECONDS = 8 * 60 * 60;

export type AppSessionPayload = {
  userId: string;
  sessionVersion: number;
  startedAt: number;
  touchedAt: number;
};

function secret() {
  const value = process.env.SESSION_SIGNING_KEY?.trim();
  if (!value || value.length < 32) {
    throw new SecurityError("SESSION_CONFIG", 503, "서버 세션 보안 설정을 확인하세요.");
  }
  return value;
}

function signature(encoded: string) {
  return createHmac("sha256", secret()).update(encoded).digest("base64url");
}

export function encodeAppSession(payload: AppSessionPayload) {
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${encoded}.${signature(encoded)}`;
}

export function decodeAppSession(value: string): AppSessionPayload | null {
  const [encoded, provided] = value.split(".");
  if (!encoded || !provided) return null;
  const expected = signature(encoded);
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as AppSessionPayload;
    if (
      !payload.userId
      || !Number.isInteger(payload.sessionVersion)
      || !Number.isFinite(payload.startedAt)
      || !Number.isFinite(payload.touchedAt)
      || payload.startedAt > payload.touchedAt
    ) return null;
    return payload;
  } catch {
    return null;
  }
}

export function appSessionCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict" as const,
    path: "/",
    maxAge: SESSION_IDLE_SECONDS,
  };
}

export function isAppSessionExpired(payload: AppSessionPayload) {
  const now = Date.now();
  return now - payload.touchedAt > SESSION_IDLE_SECONDS * 1000
    || now - payload.startedAt > SESSION_ABSOLUTE_SECONDS * 1000;
}
