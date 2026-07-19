import { createHmac } from "node:crypto";
import { SecurityError } from "@/lib/security/errors";

function canonicalOrigin(value: string) {
  const url = new URL(value);
  return `${url.protocol}//${url.host}`;
}

function configuredAppOrigin(request: Request) {
  const configured = process.env.APP_ORIGIN?.trim();
  if (configured) return canonicalOrigin(configured);
  if (process.env.NODE_ENV === "production") {
    throw new SecurityError("APP_ORIGIN_CONFIG", 503, "서버 요청 출처 설정을 확인하세요.");
  }
  return canonicalOrigin(request.url);
}

export function assertSameOrigin(request: Request) {
  const method = request.method.toUpperCase();
  if (["GET", "HEAD", "OPTIONS"].includes(method)) return;

  const expected = configuredAppOrigin(request);
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

function firstIp(value: string | null) {
  return value?.split(",")[0]?.trim() || null;
}

export function clientIp(request: Request) {
  // Hosting provider가 직접 작성하는 헤더를 우선 사용합니다.
  const providerIp = firstIp(request.headers.get("x-vercel-forwarded-for"))
    || firstIp(request.headers.get("cf-connecting-ip"))
    || firstIp(request.headers.get("fly-client-ip"));
  if (providerIp) return providerIp;

  // 자체 프록시를 운영하는 경우에만 일반 전달 헤더를 신뢰합니다.
  if (process.env.TRUST_PROXY_HEADERS === "true") {
    return firstIp(request.headers.get("x-forwarded-for"))
      || firstIp(request.headers.get("x-real-ip"))
      || "unknown";
  }
  return "unknown";
}

export function userAgent(request: Request) {
  return request.headers.get("user-agent")?.slice(0, 500) || "unknown";
}

function secretPepper() {
  const pepper = process.env.RATE_LIMIT_PEPPER?.trim() || process.env.PII_HASH_KEY?.trim();
  if (!pepper || pepper.length < 32) {
    throw new SecurityError("SECURITY_CONFIG", 503, "서버 보안 설정을 확인하세요.");
  }
  return pepper;
}

export function keyedDigest(purpose: string, value: string) {
  return createHmac("sha256", secretPepper()).update(`${purpose}:${value}`).digest("hex");
}

export async function readJsonBody(request: Request, maxBytes = 16 * 1024) {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") {
    throw new SecurityError("UNSUPPORTED_MEDIA_TYPE", 415, "JSON 형식의 요청만 허용됩니다.");
  }

  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new SecurityError("PAYLOAD_TOO_LARGE", 413, "요청 내용이 너무 큽니다.");
  }

  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > maxBytes) {
    throw new SecurityError("PAYLOAD_TOO_LARGE", 413, "요청 내용이 너무 큽니다.");
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new SecurityError("INVALID_JSON", 400, "요청 형식이 올바르지 않습니다.");
  }
}
