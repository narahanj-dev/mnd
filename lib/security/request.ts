import { createHmac } from "node:crypto";
import { SecurityError } from "@/lib/security/errors";

function canonicalOrigin(value: string) {
  const url = new URL(value);
  return `${url.protocol}//${url.host}`;
}

export function assertSameOrigin(request: Request) {
  const method = request.method.toUpperCase();
  if (["GET", "HEAD", "OPTIONS"].includes(method)) return;

  const expected = canonicalOrigin(request.url);
  const origin = request.headers.get("origin");
  const referer = request.headers.get("referer");
  const fetchSite = request.headers.get("sec-fetch-site");

  if (fetchSite && !["same-origin", "same-site", "none"].includes(fetchSite)) {
    throw new SecurityError("CSRF_REJECTED", 403, "허용되지 않은 요청입니다.");
  }

  if (origin) {
    if (canonicalOrigin(origin) !== expected) {
      throw new SecurityError("CSRF_REJECTED", 403, "허용되지 않은 요청입니다.");
    }
    return;
  }

  if (referer) {
    if (canonicalOrigin(referer) !== expected) {
      throw new SecurityError("CSRF_REJECTED", 403, "허용되지 않은 요청입니다.");
    }
    return;
  }

  throw new SecurityError("CSRF_MISSING_ORIGIN", 403, "요청 출처를 확인할 수 없습니다.");
}

export function clientIp(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip")?.trim() || "unknown";
}

export function userAgent(request: Request) {
  return request.headers.get("user-agent")?.slice(0, 500) || "unknown";
}

export function keyedDigest(purpose: string, value: string) {
  const pepper = process.env.RATE_LIMIT_PEPPER?.trim() || process.env.PII_HASH_KEY?.trim();
  if (!pepper) throw new SecurityError("SECURITY_CONFIG", 503, "서버 보안 설정을 확인하세요.");
  return createHmac("sha256", pepper).update(`${purpose}:${value}`).digest("hex");
}
