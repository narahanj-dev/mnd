import { createAdminClient } from "@/lib/supabase/admin";
import { SecurityError } from "@/lib/security/errors";
import { keyedDigest } from "@/lib/security/request";

type RateLimitOptions = {
  purpose: string;
  identity: string;
  limit: number;
  windowSeconds: number;
};

function rateLimitError(retryAfter: number) {
  return new SecurityError(
    "RATE_LIMITED",
    429,
    `요청이 너무 많습니다. 약 ${Math.ceil(Math.max(1, retryAfter) / 60)}분 후 다시 시도하세요.`,
  );
}

/** 현재 실패 횟수만 확인하며 성공한 로그인은 횟수에 포함하지 않습니다. */
export async function assertRateLimitAvailable(options: RateLimitOptions) {
  const key = keyedDigest(options.purpose, options.identity);
  const { data, error } = await createAdminClient()
    .from("security_rate_limits")
    .select("window_started_at,attempts")
    .eq("key_hash", key)
    .maybeSingle<{ window_started_at: string; attempts: number }>();
  if (error) {
    console.error("[rate-limit-check]", error);
    throw new SecurityError("RATE_LIMIT_UNAVAILABLE", 503, "보안 확인을 처리할 수 없습니다. 잠시 후 다시 시도하세요.");
  }
  if (!data) return;
  const elapsed = Math.max(0, Math.floor((Date.now() - new Date(data.window_started_at).getTime()) / 1000));
  if (elapsed < options.windowSeconds && data.attempts >= options.limit) {
    throw rateLimitError(options.windowSeconds - elapsed);
  }
}

/** 요청 또는 인증 실패를 원자적으로 기록하고 한도를 초과하면 차단합니다. */
export async function enforceRateLimit(options: RateLimitOptions) {
  const admin = createAdminClient();
  const key = keyedDigest(options.purpose, options.identity);
  const { data, error } = await admin.rpc("consume_security_rate_limit", {
    p_key_hash: key,
    p_limit: options.limit,
    p_window_seconds: options.windowSeconds,
  });

  if (error) {
    console.error("[rate-limit]", error);
    throw new SecurityError("RATE_LIMIT_UNAVAILABLE", 503, "보안 확인을 처리할 수 없습니다. 잠시 후 다시 시도하세요.");
  }

  const result = Array.isArray(data) ? data[0] : data;
  if (!result?.allowed) {
    throw rateLimitError(Number(result?.retry_after_seconds || options.windowSeconds));
  }
}
