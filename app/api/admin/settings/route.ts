import { z } from "zod";
import { requireAdmin, authErrorResponse } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { encryptPii, encryptProfileValues, loginIdHash, loginIdToAuthEmail, sanitizedAuthUserMetadata } from "@/lib/security/pii";
import { ensurePasswordNotReused, insertPasswordRecord, prunePasswordHistory, removePasswordRecord } from "@/lib/security/password-history";
import { validatePassword } from "@/lib/security/password-policy";
import { assertSameOrigin, clientIp, readJsonBody } from "@/lib/security/request";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { SecurityError } from "@/lib/security/errors";
import { startAppSession } from "@/lib/security/session";
import { beginPrivilegedAudit, completePrivilegedAudit, writeAuditLogBestEffort } from "@/lib/security/audit";
import { verifyCurrentPassword } from "@/lib/security/reauth";

const schema = z.object({
  loginId: z.string().regex(/^[A-Za-z0-9_-]{4,30}$/).optional(),
  password: z.string().max(100).optional(),
  displayName: z.string().trim().min(1).max(50).optional(),
  currentPassword: z.string().min(1).max(100),
});

export async function PATCH(request: Request) {
  let actorId: string | null = null;
  let privilegedAuditId: string | null = null;
  try {
    assertSameOrigin(request);
    const { user, profile } = await requireAdmin();
    actorId = user.id;
    await enforceRateLimit({ purpose: "admin-settings", identity: `${user.id}:${clientIp(request)}`, limit: 5, windowSeconds: 1800 });
    const parsed = schema.safeParse(await readJsonBody(request));
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

    privilegedAuditId = await beginPrivilegedAudit({
      request, action: "admin.settings_update", actorId: user.id, targetUserId: user.id,
      metadata: {
        login_changed: Boolean(parsed.data.loginId),
        password_changed: Boolean(parsed.data.password),
        name_changed: Boolean(parsed.data.displayName),
      },
    });

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
    const historyRecordId = parsed.data.password
      ? await insertPasswordRecord(admin, user.id, parsed.data.password)
      : null;

    const { error: authError } = await admin.auth.admin.updateUserById(user.id, authUpdate);
    if (authError) {
      if (historyRecordId) await removePasswordRecord(admin, historyRecordId);
      throw authError;
    }

    const rollbackAuth = async () => {
      const rollback: Record<string, unknown> = {
        app_metadata: authData.user.app_metadata,
        user_metadata: authData.user.user_metadata,
      };
      if (authData.user.email) {
        rollback.email = authData.user.email;
        rollback.email_confirm = true;
      }
      if (parsed.data.password) rollback.password = parsed.data.currentPassword;
      const { error } = await admin.auth.admin.updateUserById(user.id, rollback);
      if (error) console.error("[admin-settings-auth-rollback]", error);
    };
    const rollbackProfile = async () => {
      const { error } = await admin.from("profiles").update({
        ...encryptProfileValues({ login_id: profile.login_id, display_name: profile.display_name }),
        must_change_password: profile.must_change_password,
        temporary_password_expires_at: profile.temporary_password_expires_at,
        password_changed_at: profile.password_changed_at,
        session_version: profile.session_version ?? 1,
      }).eq("id", user.id);
      if (error) console.error("[admin-settings-profile-rollback]", error);
    };

    const profileUpdate: Record<string, unknown> = { session_version: nextVersion };
    if (parsed.data.loginId) Object.assign(profileUpdate, encryptProfileValues({ login_id: parsed.data.loginId }));
    if (parsed.data.displayName) Object.assign(profileUpdate, encryptProfileValues({ display_name: parsed.data.displayName }));
    if (parsed.data.password) Object.assign(profileUpdate, { must_change_password: false, temporary_password_expires_at: null, password_changed_at: new Date().toISOString() });
    const { error: profileError } = await admin.from("profiles").update(profileUpdate).eq("id", user.id);
    if (profileError) {
      await rollbackAuth();
      if (historyRecordId) await removePasswordRecord(admin, historyRecordId);
      throw profileError;
    }

    if (parsed.data.displayName) {
      const { error: settingsError } = await admin.from("admin_settings").upsert(
        { admin_user_id: user.id, display_name: encryptPii(parsed.data.displayName) },
        { onConflict: "admin_user_id" },
      );
      if (settingsError) {
        await rollbackProfile();
        await rollbackAuth();
        if (historyRecordId) await removePasswordRecord(admin, historyRecordId);
        throw settingsError;
      }
    }
    if (historyRecordId) {
      try { await prunePasswordHistory(admin, user.id); }
      catch (historyError) { console.error("[admin-settings-password-history-prune]", historyError); }
    }
    if (rotateSession) await startAppSession(user.id, nextVersion);

    await completePrivilegedAudit(privilegedAuditId, true, {
      login_changed: Boolean(parsed.data.loginId),
      password_changed: Boolean(parsed.data.password),
      name_changed: Boolean(parsed.data.displayName),
    });
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) {
    if (privilegedAuditId) await completePrivilegedAudit(privilegedAuditId, false);
    else await writeAuditLogBestEffort({ request, action: "admin.settings_update", actorId, targetUserId: actorId, success: false });
    return authErrorResponse(error);
  }
}
