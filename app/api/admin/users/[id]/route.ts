import { z } from "zod";
import { authErrorResponse, canManageUser, requireUser, requireUserManager } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { DEPARTMENTS } from "@/lib/constants";
import { decryptProfile, encryptProfileValues, loginIdHash, loginIdToAuthEmail, sanitizedAuthUserMetadata } from "@/lib/security/pii";
import { insertPasswordRecord, prunePasswordHistory, removePasswordRecord } from "@/lib/security/password-history";
import type { Profile } from "@/types";
import { generateTemporaryPassword } from "@/lib/security/temporary-password";
import { encryptMessageFields } from "@/lib/security/secure-fields";
import { assertSameOrigin, clientIp, readJsonBody } from "@/lib/security/request";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { SecurityError } from "@/lib/security/errors";
import { beginPrivilegedAudit, completePrivilegedAudit, writeAuditLogBestEffort } from "@/lib/security/audit";
import { requireAal2 } from "@/lib/security/mfa";
import { verifyCurrentPassword } from "@/lib/security/reauth";

const updateSchema = z.object({
  action: z.literal("updateIdentity"),
  loginId: z.string().regex(/^[A-Za-z0-9_-]{4,30}$/),
  department: z.enum(DEPARTMENTS),
  role: z.enum(["user", "department_admin", "admin"]),
  currentPassword: z.string().min(1).max(100),
});
const resetPasswordSchema = z.object({
  action: z.literal("resetPassword"),
  currentPassword: z.string().min(1).max(100),
});
const patchSchema = z.discriminatedUnion("action", [updateSchema, resetPasswordSchema]);

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  let actorId: string | null = null;
  let targetId: string | null = null;
  let privilegedAuditId: string | null = null;
  try {
    assertSameOrigin(request);
    const { user: actingUser, profile: actingProfile, supabase } = await requireUser();
    actorId = actingUser.id;
    const { id } = await context.params;
    targetId = id;
    const parsed = patchSchema.safeParse(await readJsonBody(request));
    if (!parsed.success) throw new SecurityError("INVALID_INPUT", 400, "수정 내용을 확인하세요.");

    if (actingProfile.role !== "user") {
      await requireAal2(supabase);
      await enforceRateLimit({ purpose: "user-admin-action", identity: `${actingUser.id}:${clientIp(request)}`, limit: 40, windowSeconds: 600 });
    }

    const admin = createAdminClient();
    const { data: rawTarget, error: profileReadError } = await admin.from("profiles").select("*").eq("id", id).single();
    const targetProfile = decryptProfile(rawTarget) as Profile | null;
    if (profileReadError || !targetProfile) throw new SecurityError("NOT_FOUND", 404, "사용자 계정을 찾을 수 없습니다.");

    const isSelfService = actingProfile.role === "user" && actingUser.id === id;
    if (!isSelfService && !canManageUser(actingProfile, targetProfile)) throw new SecurityError("FORBIDDEN", 403, "해당 사용자를 관리할 권한이 없습니다.");
    if (actingProfile.role === "user" && parsed.data.action === "resetPassword") throw new SecurityError("FORBIDDEN", 403, "일반사용자는 비밀번호를 초기화할 수 없습니다.");
    await enforceRateLimit({ purpose: "privileged-reauth", identity: `${actingUser.id}:${clientIp(request)}`, limit: 5, windowSeconds: 1800 });
    await verifyCurrentPassword({ userId: actingUser.id, email: actingUser.email, password: parsed.data.currentPassword });

    const { data: authData, error: authReadError } = await admin.auth.admin.getUserById(id);
    if (authReadError || !authData.user) throw new SecurityError("AUTH_NOT_FOUND", 404, "인증 계정을 찾을 수 없습니다.");

    if (parsed.data.action === "resetPassword") {
      privilegedAuditId = await beginPrivilegedAudit({
        request, action: "user.password_reset", actorId: actingUser.id, targetUserId: id,
      });
      const temporaryPassword = generateTemporaryPassword();
      const nextVersion = (targetProfile.session_version ?? 1) + 1;
      const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
      const historyRecordId = await insertPasswordRecord(admin, id, temporaryPassword, { allowExisting: true });
      const { error: profileUpdateError } = await admin.from("profiles").update({
        must_change_password: true,
        temporary_password_expires_at: expiresAt,
        password_changed_at: new Date().toISOString(),
        session_version: nextVersion,
      }).eq("id", id);
      if (profileUpdateError) {
        await removePasswordRecord(admin, historyRecordId);
        throw profileUpdateError;
      }

      const { error: authError } = await admin.auth.admin.updateUserById(id, {
        password: temporaryPassword,
        user_metadata: sanitizedAuthUserMetadata(true),
        app_metadata: { ...authData.user.app_metadata, session_version: nextVersion },
      });
      if (authError) {
        await admin.from("profiles").update({
          must_change_password: targetProfile.must_change_password,
          temporary_password_expires_at: targetProfile.temporary_password_expires_at,
          password_changed_at: targetProfile.password_changed_at,
          session_version: targetProfile.session_version ?? 1,
        }).eq("id", id);
        await removePasswordRecord(admin, historyRecordId);
        throw authError;
      }

      try { await prunePasswordHistory(admin, id); }
      catch (historyError) { console.error("[reset-password-history-prune]", historyError); }

      await admin.from("messages").insert(encryptMessageFields({
        sender_id: actingUser.id,
        recipient_id: id,
        title: "비밀번호 초기화 안내",
        content: "관리자가 비밀번호를 초기화했습니다. 임시 비밀번호는 30분 동안만 유효하며 로그인 후 즉시 변경해야 합니다.",
        message_type: "password_reset",
      }));
      await completePrivilegedAudit(privilegedAuditId, true);
      return Response.json({ ok: true, temporaryPassword, expiresAt }, { headers: { "Cache-Control": "no-store, max-age=0" } });
    }

    if (actingProfile.role === "user" && (parsed.data.department !== targetProfile.department || parsed.data.role !== targetProfile.role)) {
      throw new SecurityError("FORBIDDEN", 403, "일반사용자는 아이디만 변경할 수 있습니다.");
    }
    if (actingUser.id === id && parsed.data.role !== actingProfile.role) {
      throw new SecurityError("SELF_ROLE_CHANGE", 400, "현재 로그인한 계정의 권한은 직접 변경할 수 없습니다.");
    }
    if (actingProfile.role === "department_admin" && parsed.data.role !== "user") {
      throw new SecurityError("FORBIDDEN", 403, "부서관리자는 일반사용자 계정만 관리할 수 있습니다.");
    }
    if (actingProfile.role === "department_admin" && parsed.data.department !== actingProfile.department) throw new SecurityError("FORBIDDEN", 403, "부서관리자는 사용자를 다른 부서로 이동할 수 없습니다.");

    const nextHash = loginIdHash(parsed.data.loginId);
    if (parsed.data.loginId !== targetProfile.login_id) {
      const { data: duplicate } = await admin.from("profiles").select("id").eq("login_id_hash", nextHash).neq("id", id).maybeSingle();
      if (duplicate) throw new SecurityError("DUPLICATE_LOGIN", 409, "이미 사용 중인 아이디입니다.");
    }

    privilegedAuditId = await beginPrivilegedAudit({
      request, action: "user.identity_update", actorId: actingUser.id, targetUserId: id,
      metadata: {
        role_changed: parsed.data.role !== targetProfile.role,
        department_changed: parsed.data.department !== targetProfile.department,
      },
    });

    const securitySensitiveChange = parsed.data.role !== targetProfile.role || parsed.data.department !== targetProfile.department;
    const nextVersion = securitySensitiveChange ? (targetProfile.session_version ?? 1) + 1 : (targetProfile.session_version ?? 1);
    const { error: authUpdateError } = await admin.auth.admin.updateUserById(id, {
      email: loginIdToAuthEmail(parsed.data.loginId),
      email_confirm: true,
      user_metadata: sanitizedAuthUserMetadata(targetProfile.must_change_password),
      app_metadata: { ...authData.user.app_metadata, role: parsed.data.role, session_version: nextVersion },
    });
    if (authUpdateError) throw authUpdateError;

    const { error: profileUpdateError } = await admin.from("profiles").update({
      ...encryptProfileValues({ login_id: parsed.data.loginId }),
      department: parsed.data.department,
      role: parsed.data.role,
      session_version: nextVersion,
    }).eq("id", id);
    if (profileUpdateError) {
      await admin.auth.admin.updateUserById(id, { email: authData.user.email, app_metadata: authData.user.app_metadata });
      throw profileUpdateError;
    }

    await completePrivilegedAudit(privilegedAuditId, true, {
      role_changed: parsed.data.role !== targetProfile.role,
      department_changed: parsed.data.department !== targetProfile.department,
    });
    return Response.json({ ok: true });
  } catch (error) {
    if (privilegedAuditId) await completePrivilegedAudit(privilegedAuditId, false);
    else await writeAuditLogBestEffort({ request, action: "user.update", actorId, targetUserId: targetId, success: false });
    return authErrorResponse(error);
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  let actorId: string | null = null;
  let targetId: string | null = null;
  let privilegedAuditId: string | null = null;
  try {
    assertSameOrigin(request);
    const { user: actingUser, profile: actingProfile } = await requireUserManager();
    actorId = actingUser.id;
    const { id } = await context.params;
    targetId = id;
    const deleteInput = z.object({ currentPassword: z.string().min(1).max(100) }).safeParse(await readJsonBody(request));
    if (!deleteInput.success) throw new SecurityError("REAUTH_REQUIRED", 400, "현재 비밀번호를 입력하세요.");
    if (actingUser.id === id) throw new SecurityError("SELF_DELETE", 400, "현재 로그인한 계정은 삭제할 수 없습니다.");
    await enforceRateLimit({ purpose: "user-delete", identity: `${actingUser.id}:${clientIp(request)}`, limit: 10, windowSeconds: 600 });

    const admin = createAdminClient();
    const { data: rawTarget, error: profileError } = await admin.from("profiles").select("*").eq("id", id).maybeSingle();
    const targetProfile = decryptProfile(rawTarget) as Profile | null;
    if (profileError) throw profileError;
    if (!targetProfile) throw new SecurityError("NOT_FOUND", 404, "사용자 계정을 찾을 수 없습니다.");
    if (!canManageUser(actingProfile, targetProfile)) throw new SecurityError("FORBIDDEN", 403, "해당 사용자를 삭제할 권한이 없습니다.");
    await enforceRateLimit({ purpose: "privileged-reauth", identity: `${actingUser.id}:${clientIp(request)}`, limit: 5, windowSeconds: 1800 });
    await verifyCurrentPassword({ userId: actingUser.id, email: actingUser.email, password: deleteInput.data.currentPassword });
    privilegedAuditId = await beginPrivilegedAudit({
      request, action: "user.delete", actorId: actingUser.id, targetUserId: id,
    });

    const { error: authDeleteError } = await admin.auth.admin.deleteUser(id);
    if (authDeleteError && !/not found|does not exist/i.test(authDeleteError.message)) throw authDeleteError;
    if (authDeleteError) await admin.from("profiles").delete().eq("id", id);

    await completePrivilegedAudit(privilegedAuditId, true);
    return Response.json({ ok: true });
  } catch (error) {
    if (privilegedAuditId) await completePrivilegedAudit(privilegedAuditId, false);
    else await writeAuditLogBestEffort({ request, action: "user.delete", actorId, targetUserId: targetId, success: false });
    return authErrorResponse(error);
  }
}
