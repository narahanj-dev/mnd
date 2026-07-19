import { createAdminClient } from "@/lib/supabase/admin";
import { SecurityError } from "@/lib/security/errors";
import { keyedDigest } from "@/lib/security/request";

export async function enforceRateLimit(options: {
  purpose: string;
  identity: string;
  limit: number;
  windowSeconds: number;
}) {
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
    const retryAfter = Math.max(1, Number(result?.retry_after_seconds || options.windowSeconds));
    throw new SecurityError(
      "RATE_LIMITED",
      429,
      `요청이 너무 많습니다. 약 ${Math.ceil(retryAfter / 60)}분 후 다시 시도하세요.`,
    );
  }
}
