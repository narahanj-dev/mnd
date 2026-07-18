import { z } from "zod";
import { authErrorResponse, requireUserManager } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { decryptSignupRequest, decryptSignupRequestPassword, encryptProfileValues, loginIdHash, loginIdToAuthEmail, sanitizedAuthUserMetadata } from "@/lib/security/pii";
import { validatePassword } from "@/lib/security/password-policy";
import { recordPassword } from "@/lib/security/password-history";

const schema = z.object({
  decision: z.enum(["approve", "reject"]),
  loginId: z.string().regex(/^[A-Za-z0-9_-]{4,30}$/).optional(),
  reason: z.string().max(1000).optional(),
});

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { profile } = await requireUserManager();
    const { id } = await context.params;
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return Response.json({ error: "요청을 확인하세요." }, { status: 400 });

    const admin = createAdminClient();
    const { data: rawRequest, error: requestError } = await admin.from("signup_requests").select("*").eq("id", id).single();
    const signupRequest = decryptSignupRequest(rawRequest);
    if (requestError || !signupRequest || signupRequest.status !== "pending") {
      return Response.json({ error: "대기 중인 신청이 아닙니다." }, { status: 404 });
    }
    if (profile.role === "department_admin" && signupRequest.department !== profile.department) {
      return Response.json({ error: "다른 부서의 가입신청은 처리할 수 없습니다." }, { status: 403 });
    }

    if (parsed.data.decision === "reject") {
      if (!parsed.data.reason?.trim()) return Response.json({ error: "거절 사유를 입력하세요." }, { status: 400 });
      const { error } = await admin.from("signup_requests").delete().eq("id", id);
      if (error) return Response.json({ error: error.message }, { status: 400 });
      return Response.json({ ok: true });
    }

    const loginId = parsed.data.loginId?.trim() || String(signupRequest.requested_login_id);
    const password = decryptSignupRequestPassword(rawRequest);
    if (!password) {
      return Response.json({ error: "기존 가입신청에는 설정된 비밀번호가 없습니다. 해당 신청을 거절한 뒤 다시 신청하도록 안내하세요." }, { status: 400 });
    }

    const policyError = validatePassword(password, { loginId, displayName: String(signupRequest.name) });
    if (policyError) return Response.json({ error: `신청자가 설정한 비밀번호를 사용할 수 없습니다. ${policyError}` }, { status: 400 });
    if (!signupRequest.birth_month_day) return Response.json({ error: "생일 월/일이 없는 신청입니다." }, { status: 400 });

    const hash = loginIdHash(loginId);
    const { data: duplicate } = await admin.from("profiles").select("id").eq("login_id_hash", hash).maybeSingle();
    if (duplicate) return Response.json({ error: "이미 사용 중인 아이디입니다." }, { status: 409 });

    const { data, error } = await admin.auth.admin.createUser({
      email: loginIdToAuthEmail(loginId),
      password,
      email_confirm: true,
      user_metadata: sanitizedAuthUserMetadata(false),
      app_metadata: { role: "user" },
    });
    if (error || !data.user) return Response.json({ error: error?.message ?? "계정 생성 실패" }, { status: 400 });

    const now = new Date().toISOString();
    const { error: profileError } = await admin.from("profiles").upsert({
      id: data.user.id,
      ...encryptProfileValues({ login_id: loginId, display_name: String(signupRequest.name), birth_month_day: String(signupRequest.birth_month_day) }),
      department: signupRequest.department,
      role: "user",
      account_status: "active",
      must_change_password: false,
      password_changed_at: now,
    });
    if (profileError) {
      await admin.auth.admin.deleteUser(data.user.id);
      return Response.json({ error: profileError.message }, { status: 400 });
    }

    try {
      await recordPassword(admin, data.user.id, password);
    } catch (historyError) {
      await admin.auth.admin.deleteUser(data.user.id);
      return Response.json({ error: historyError instanceof Error ? historyError.message : "비밀번호 이력 저장 실패" }, { status: 400 });
    }

    const { error: deleteError } = await admin.from("signup_requests").delete().eq("id", id);
    if (deleteError) {
      await admin.auth.admin.deleteUser(data.user.id);
      return Response.json({ error: deleteError.message }, { status: 400 });
    }
    return Response.json({ ok: true });
  } catch (error) {
    return authErrorResponse(error);
  }
}
