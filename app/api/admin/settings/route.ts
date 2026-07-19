import { z } from "zod";
import { requireAdmin, authErrorResponse } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { encryptPii, encryptProfileValues, loginIdHash, loginIdToAuthEmail, sanitizedAuthUserMetadata } from "@/lib/security/pii";
import { ensurePasswordNotReused, recordPassword } from "@/lib/security/password-history";
import { validatePassword } from "@/lib/security/password-policy";
import { assertSameOrigin, clientIp } from "@/lib/security/request";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { SecurityError } from "@/lib/security/errors";
import { startAppSession } from "@/lib/security/session";
import { writeAuditLog } from "@/lib/security/audit";
import { verifyCurrentPassword } from "@/lib/security/reauth";

const schema = z.object({
  loginId: z.string().regex(/^[A-Za-z0-9_-]{4,30}$/).optional(),
  password: z.string().max(100).optional(),
  displayName: z.string().trim().min(1).max(50).optional(),
  currentPassword: z.string().min(1).max(100),
});

export async function PATCH(request: Request) {
  let actorId: string | null = null;
  try {
    assertSameOrigin(request);
    const { user, profile } = await requireAdmin();
    actorId = user.id;
    await enforceRateLimit({ purpose: "admin-settings", identity: `${user.id}:${clientIp(request)}`, limit: 5, windowSeconds: 1800 });
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new SecurityError("INVALID_INPUT", 400, "입력값과 현재 비밀번호를 확인하세요.");

    await verifyCurrentPassword({
      userId: user.id,
      email: user.email,
      password: parsed.data.currentPassword,
    });

    const admin = createAdminClient();
    const nextLoginId = parsed.data.loginId ?? profile.login_id;
    const nextDisplayName = parsed.data.displayName ?? profile.display_name;
    if (parsed.data.password) {
      const policyError = validatePassword(parsed.data.password, { loginId: nextLoginId, displayName: nextDisplayName });
      if (policyError) throw new SecurityError("WEAK_PASSWORD", 400, policyError);
      await ensurePasswordNotReused(admin, user.id, parsed.data.password);
    }

    if (parsed.data.loginId && parsed.data.loginId !== profile.login_id) {
      const { data: duplicate } = await admin.from("profiles").select("id").eq("login_id_hash", loginIdHash(parsed.data.loginId)).neq("id", user.id).maybeSingle();
      if (duplicate) throw new SecurityError("DUPLICATE_LOGIN", 409, "이미 사용 중인 아이디입니다.");
    }

    const { data: authData, error: authReadError } = await admin.auth.admin.getUserById(user.id);
    if (authReadError || !authData.user) throw new SecurityError("AUTH_NOT_FOUND", 404, "인증 계정을 찾을 수 없습니다.");

    const rotateSession = Boolean(parsed.data.password || (parsed.data.loginId && parsed.data.loginId !== profile.login_id));
    const nextVersion = rotateSession ? (profile.session_version ?? 1) + 1 : (profile.session_version ?? 1);
    const authUpdate: Record<string, unknown> = {
      user_metadata: sanitizedAuthUserMetadata(false),
      app_metadata: { ...authData.user.app_metadata, session_version: nextVersion },
    };
    if (parsed.data.loginId) { authUpdate.email = loginIdToAuthEmail(parsed.data.loginId); authUpdate.email_confirm = true; }
    if (parsed.data.password) authUpdate.password = parsed.data.password;
    const { error: authError } = await admin.auth.admin.updateUserById(user.id, authUpdate);
    if (authError) throw authError;

    const profileUpdate: Record<string, unknown> = { session_version: nextVersion };
    if (parsed.data.loginId) Object.assign(profileUpdate, encryptProfileValues({ login_id: parsed.data.loginId }));
    if (parsed.data.displayName) Object.assign(profileUpdate, encryptProfileValues({ display_name: parsed.data.displayName }));
    if (parsed.data.password) Object.assign(profileUpdate, { must_change_password: false, temporary_password_expires_at: null, password_changed_at: new Date().toISOString() });
    const { error: profileError } = await admin.from("profiles").update(profileUpdate).eq("id", user.id);
    if (profileError) {
      await admin.auth.admin.updateUserById(user.id, { email: authData.user.email, app_metadata: authData.user.app_metadata });
      throw profileError;
    }

    if (parsed.data.password) await recordPassword(admin, user.id, parsed.data.password);
    if (parsed.data.displayName) {
      await admin.from("admin_settings").upsert({ admin_user_id: user.id, display_name: encryptPii(parsed.data.displayName) }, { onConflict: "admin_user_id" });
    }
    if (rotateSession) await startAppSession(user.id, nextVersion);

    await writeAuditLog({ request, action: "admin.settings_update", actorId: user.id, targetUserId: user.id, success: true, metadata: { login_changed: Boolean(parsed.data.loginId), password_changed: Boolean(parsed.data.password), name_changed: Boolean(parsed.data.displayName) } });
    return Response.json({ ok: true });
  } catch (error) {
    await writeAuditLog({ request, action: "admin.settings_update", actorId, targetUserId: actorId, success: false });
    return authErrorResponse(error);
  }
}
