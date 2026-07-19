import type { SupabaseClient } from "@supabase/supabase-js";
import { SecurityError } from "@/lib/security/errors";

export async function requireAal2(supabase: SupabaseClient) {
  if (process.env.REQUIRE_ADMIN_MFA === "false") return;
  const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (error) {
    console.error("[mfa-aal]", error);
    throw new SecurityError("MFA_CHECK_FAILED", 503, "관리자 추가 인증 상태를 확인하지 못했습니다.");
  }
  if (data.currentLevel !== "aal2") {
    throw new SecurityError("MFA_REQUIRED", 403, "관리자 추가 인증이 필요합니다.");
  }
}
