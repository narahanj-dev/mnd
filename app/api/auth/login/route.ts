import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { decryptProfile, legacyLoginIdToAuthEmail, loginIdToAuthEmail } from "@/lib/security/pii";
import { passwordExpired } from "@/lib/security/password-history";
import type { Profile } from "@/types";
import { assertSameOrigin, clientIp } from "@/lib/security/request";
import { assertRateLimitAvailable, enforceRateLimit } from "@/lib/security/rate-limit";
import { SecurityError, safeErrorResponse } from "@/lib/security/errors";
import { startAppSession } from "@/lib/security/session";
import { writeAuditLogBestEffort } from "@/lib/security/audit";

const schema = z.object({
  loginId: z.string().regex(/^[A-Za-z0-9_-]{4,30}$/),
  password: z.string().min(1).max(100),
  adminOnly: z.boolean().optional(),
});

export async function POST(request: Request) {
  let auditLoginId = "invalid";
  let userId: string | null = null;
  try {
    assertSameOrigin(request);
    const ip = clientIp(request);
    const knownIp = ip !== "unknown";
    if (knownIp) {
      await assertRateLimitAvailable({ purpose: "login-ip", identity: ip, limit: 100, windowSeconds: 600 });
    }

    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      if (knownIp) await enforceRateLimit({ purpose: "login-ip", identity: ip, limit: 100, windowSeconds: 600 });
      throw new SecurityError("INVALID_LOGIN", 400, "아이디와 비밀번호를 확인하세요.");
    }
    auditLoginId = parsed.data.loginId.toLowerCase();
    await assertRateLimitAvailable({ purpose: "login-id", identity: auditLoginId, limit: 6, windowSeconds: 600 });

    const supabase = await createClient();
    let { data, error } = await supabase.auth.signInWithPassword({
      email: loginIdToAuthEmail(parsed.data.loginId),
      password: parsed.data.password,
    });
    if (error || !data.user) {
      const legacyResult = await supabase.auth.signInWithPassword({
        email: legacyLoginIdToAuthEmail(parsed.data.loginId),
        password: parsed.data.password,
      });
      data = legacyResult.data;
      error = legacyResult.error;
    }
    if (error || !data.user) {
      await enforceRateLimit({ purpose: "login-id", identity: auditLoginId, limit: 6, windowSeconds: 600 });
      if (knownIp) await enforceRateLimit({ purpose: "login-ip", identity: ip, limit: 100, windowSeconds: 600 });
      throw new SecurityError("INVALID_CREDENTIALS", 401, "아이디 또는 비밀번호가 올바르지 않습니다.");
    }
    userId = data.user.id;

    const admin = createAdminClient();
    const { data: rawProfile } = await admin.from("profiles").select("*").eq("id", userId).single();
    const profile = decryptProfile(rawProfile) as Profile | null;
    if (!profile || profile.account_status !== "active") {
      await supabase.auth.signOut();
      throw new SecurityError("INACTIVE_ACCOUNT", 403, "사용할 수 없는 계정입니다. 관리자에게 문의하세요.");
    }
    if (parsed.data.adminOnly && profile.role !== "admin") {
      await supabase.auth.signOut();
      throw new SecurityError("NOT_ADMIN", 403, "관리자 계정이 아닙니다.");
    }
    if (profile.must_change_password && profile.temporary_password_expires_at && new Date(profile.temporary_password_expires_at).getTime() < Date.now()) {
      await supabase.auth.signOut();
      throw new SecurityError("TEMP_PASSWORD_EXPIRED", 403, "임시 비밀번호가 만료되었습니다. 관리자에게 다시 초기화를 요청하세요.");
    }

    const expired = passwordExpired(profile.password_changed_at);
    const mustChangePassword = profile.must_change_password || expired;
    await admin.from("profiles").update({
      last_login_at: new Date().toISOString(),
      ...(expired ? { must_change_password: true } : {}),
    }).eq("id", userId);

    await startAppSession(userId, profile.session_version ?? 1);
    let mfaRequired = false;
    if (profile.role === "admin" || profile.role === "department_admin") {
      const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      mfaRequired = process.env.REQUIRE_ADMIN_MFA !== "false" && aal?.currentLevel !== "aal2";
    }

    await writeAuditLogBestEffort({ request, action: "auth.login", actorId: userId, targetUserId: userId, success: true, metadata: { role: profile.role } });
    return Response.json({ ok: true, role: profile.role, mustChangePassword, mfaRequired });
  } catch (error) {
    await writeAuditLogBestEffort({ request, action: "auth.login", actorId: userId, targetUserId: userId, success: false, metadata: { login_id_hash_source: auditLoginId !== "invalid" } });
    return safeErrorResponse(error, "login");
  }
}
