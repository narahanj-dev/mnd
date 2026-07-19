import { cookies } from "next/headers";
import { SecurityError } from "@/lib/security/errors";
import {
  APP_SESSION_COOKIE_NAME,
  appSessionCookieOptions,
  decodeAppSession,
  encodeAppSession,
  isAppSessionExpired,
} from "@/lib/security/session-cookie";

export { APP_SESSION_COOKIE_NAME, SESSION_IDLE_SECONDS, SESSION_ABSOLUTE_SECONDS } from "@/lib/security/session-cookie";

export async function startAppSession(userId: string, sessionVersion: number) {
  const store = await cookies();
  store.set(
    APP_SESSION_COOKIE_NAME,
    encodeAppSession({ userId, sessionVersion, startedAt: Date.now(), touchedAt: Date.now() }),
    appSessionCookieOptions(),
  );
}

// Server Components cannot mutate cookies. The proxy refreshes the idle timestamp
// on every same-site page/API navigation; this guard only validates the signed value.
export async function assertAppSession(userId: string, sessionVersion: number) {
  const store = await cookies();
  const raw = store.get(APP_SESSION_COOKIE_NAME)?.value;
  const payload = raw ? decodeAppSession(raw) : null;
  const expired = !payload || isAppSessionExpired(payload);
  const mismatched = payload?.userId !== userId || payload?.sessionVersion !== sessionVersion;

  if (expired || mismatched) {
    throw new SecurityError("SESSION_EXPIRED", 401, "로그인 시간이 만료되었습니다. 다시 로그인하세요.");
  }
}

export async function clearAppSession() {
  const store = await cookies();
  store.delete(APP_SESSION_COOKIE_NAME);
}
