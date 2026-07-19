import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { APP_SESSION_COOKIE_NAME, SESSION_IDLE_SECONDS, appSessionCookieOptions, decodeAppSession, encodeAppSession, isAppSessionExpired } from "@/lib/security/session-cookie";

function buildCsp(nonce: string) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const connectSources = ["'self'"];
  if (supabaseUrl) {
    try {
      const parsed = new URL(supabaseUrl);
      connectSources.push(parsed.origin, `${parsed.protocol === "https:" ? "wss:" : "ws:"}//${parsed.host}`);
    } catch {}
  }
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src ${connectSources.join(" ")}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "worker-src 'self' blob:",
    process.env.NODE_ENV === "production" ? "upgrade-insecure-requests" : "",
  ].filter(Boolean).join("; ");
}

export async function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", buildCsp(nonce));

  let response = NextResponse.next({ request: { headers: requestHeaders } });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (url && key) {
    const supabase = createServerClient(url, key, {
      cookies: {
        getAll() { return request.cookies.getAll(); },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request: { headers: requestHeaders } });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, { ...options, httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/" }));
        },
      },
    });
    await supabase.auth.getUser();
  }

  const appSessionValue = request.cookies.get(APP_SESSION_COOKIE_NAME)?.value;
  if (appSessionValue) {
    try {
      const appSession = decodeAppSession(appSessionValue);
      if (!appSession || isAppSessionExpired(appSession)) {
        response.cookies.delete(APP_SESSION_COOKIE_NAME);
      } else {
        response.cookies.set(
          APP_SESSION_COOKIE_NAME,
          encodeAppSession({ ...appSession, touchedAt: Date.now() }),
          { ...appSessionCookieOptions(), maxAge: SESSION_IDLE_SECONDS },
        );
      }
    } catch {
      response.cookies.delete(APP_SESSION_COOKIE_NAME);
    }
  }

  response.headers.set("Content-Security-Policy", buildCsp(nonce));
  response.headers.set("x-nonce", nonce);
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
