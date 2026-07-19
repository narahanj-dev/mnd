import { z } from "zod";
import { authErrorResponse, requireUserManager } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { decryptSignupRequest, encryptProfileValues, loginIdHash, loginIdToAuthEmail, sanitizedAuthUserMetadata } from "@/lib/security/pii";
import { assertSameOrigin, clientIp } from "@/lib/security/request";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { SecurityError } from "@/lib/security/errors";
import { writeAuditLog } from "@/lib/security/audit";

const schema = z.object({
  decision: z.enum(["approve", "reject"]),
  loginId: z.string().regex(/^[A-Za-z0-9_-]{4,30}$/).optional(),
  reason: z.string().max(1000).optional(),
});

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  let targetUserId: string | null = null;
  try {
    assertSameOrigin(request);
    const { user: manager, profile } = await requireUserManager();
    await enforceRateLimit({ purpose: "signup-decision", identity: `${manager.id}:${clientIp(request)}`, limit: 30, windowSeconds: 600 });

    const { id } = await context.params;
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new SecurityError("INVALID_INPUT", 400, "요청을 확인하세요.");

    const admin = createAdminClient();
    const { data: rawRequest, error: requestError } = await admin.from("signup_requests").select("*").eq("id", id).single();
    const signupRequest = decryptSignupRequest(rawRequest) as Record<string, unknown> | null;
    if (requestError || !signupRequest || signupRequest.status !== "pending") {
      throw new SecurityError("NOT_PENDING", 404, "대기 중인 신청이 아닙니다.");
    }
    if (profile.role === "department_admin" && signupRequest.department !== profile.department) {
      throw new SecurityError("FORBIDDEN", 403, "다른 부서의 가입신청은 처리할 수 없습니다.");
    }

    targetUserId = typeof signupRequest.auth_user_id === "string" ? signupRequest.auth_user_id : null;

    if (parsed.data.decision === "reject") {
      if (!parsed.data.reason?.trim()) throw new SecurityError("REASON_REQUIRED", 400, "거절 사유를 입력하세요.");
      if (targetUserId) {
        const { error } = await admin.auth.admin.deleteUser(targetUserId);
        if (error && !/not found|does not exist/i.test(error.message)) throw error;
      } else {
        const { error } = await admin.from("signup_requests").delete().eq("id", id);
        if (error) throw error;
      }
      await writeAuditLog({ request, action: "signup.reject", actorId: manager.id, targetUserId, targetResourceId: id, success: true, metadata: { department: signupRequest.department } });
      return Response.json({ ok: true });
    }

    if (!targetUserId) {
      throw new SecurityError("LEGACY_SIGNUP", 400, "업데이트 전 가입신청입니다. 거절 후 다시 신청하도록 안내하세요.");
    }
    if (!signupRequest.birth_month_day) throw new SecurityError("MISSING_BIRTHDAY", 400, "생일 월/일이 없는 신청입니다.");

    const loginId = parsed.data.loginId?.trim() || String(signupRequest.requested_login_id);
    const hash = loginIdHash(loginId);
    const { data: duplicate, error: duplicateError } = await admin.from("profiles").select("id").eq("login_id_hash", hash).neq("id", targetUserId).maybeSingle();
    if (duplicateError) throw duplicateError;
    if (duplicate) throw new SecurityError("DUPLICATE_LOGIN", 409, "이미 사용 중인 아이디입니다.");

    const { data: authData, error: authReadError } = await admin.auth.admin.getUserById(targetUserId);
    if (authReadError || !authData.user) throw new SecurityError("AUTH_NOT_FOUND", 404, "가입 대기 인증 계정을 찾을 수 없습니다.");

    const previousEmail = authData.user.email;
    const previousMetadata = authData.user.app_metadata;
    const { error: authUpdateError } = await admin.auth.admin.updateUserById(targetUserId, {
      email: loginIdToAuthEmail(loginId),
      email_confirm: true,
      user_metadata: sanitizedAuthUserMetadata(false),
      app_metadata: { ...previousMetadata, role: "user", signup_pending: false, session_version: 1 },
    });
    if (authUpdateError) throw authUpdateError;

    const now = new Date().toISOString();
    const { error: profileError } = await admin.from("profiles").update({
      ...encryptProfileValues({
        login_id: loginId,
        display_name: String(signupRequest.name),
        birth_month_day: String(signupRequest.birth_month_day),
      }),
      department: signupRequest.department,
      role: "user",
      account_status: "active",
      must_change_password: false,
      temporary_password_expires_at: null,
      session_version: 1,
      password_changed_at: now,
    }).eq("id", targetUserId).eq("account_status", "pending");

    if (profileError) {
      await admin.auth.admin.updateUserById(targetUserId, { email: previousEmail, app_metadata: previousMetadata });
      throw profileError;
    }

    const { error: deleteError } = await admin.from("signup_requests").delete().eq("id", id).eq("status", "pending");
    if (deleteError) {
      await admin.from("profiles").update({ account_status: "pending" }).eq("id", targetUserId);
      await admin.auth.admin.updateUserById(targetUserId, { email: previousEmail, app_metadata: previousMetadata });
      throw deleteError;
    }

    await writeAuditLog({ request, action: "signup.approve", actorId: manager.id, targetUserId, targetResourceId: id, success: true, metadata: { department: signupRequest.department } });
    return Response.json({ ok: true, loginId });
  } catch (error) {
    await writeAuditLog({ request, action: "signup.decision", targetUserId, success: false });
    return authErrorResponse(error);
  }
}
