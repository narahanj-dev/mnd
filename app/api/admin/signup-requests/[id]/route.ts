import { z } from "zod";
import { authErrorResponse, requireUserManager } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  decryptSignupRequest,
  decryptSignupRequestPassword,
  encryptProfileValues,
  loginIdHash,
  loginIdToAuthEmail,
  sanitizedAuthUserMetadata,
} from "@/lib/security/pii";
import { validatePassword } from "@/lib/security/password-policy";
import { recordPassword } from "@/lib/security/password-history";

const schema = z.object({
  decision: z.enum(["approve", "reject"]),
  loginId: z.string().regex(/^[A-Za-z0-9_-]{4,30}$/).optional(),
  reason: z.string().max(1000).optional(),
});

type AdminClient = ReturnType<typeof createAdminClient>;
type AuthUser = Awaited<ReturnType<AdminClient["auth"]["admin"]["getUserById"]>>["data"]["user"];

function errorText(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  if (error && typeof error === "object") {
    const value = error as Record<string, unknown>;
    for (const key of ["message", "error_description", "details", "hint", "code"]) {
      const candidate = value[key];
      if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
    }
    try {
      const serialized = JSON.stringify(error);
      if (serialized && serialized !== "{}") return serialized;
    } catch {
      // 기본 문구 사용
    }
  }
  return fallback;
}

function isDuplicateAuthUserError(error: unknown) {
  return /already registered|already exists|email.*exists|user.*exists|duplicate/i.test(errorText(error, ""));
}

async function findAuthUserByEmail(admin: AdminClient, email: string): Promise<AuthUser | null> {
  const perPage = 1000;
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw new Error(`기존 인증 계정 조회 실패: ${errorText(error, "알 수 없는 오류")}`);
    const user = data.users.find((item) => item.email?.toLowerCase() === email.toLowerCase());
    if (user) return user;
    if (data.users.length < perPage) return null;
  }
  return null;
}

async function removeNewUser(admin: AdminClient, userId: string, shouldDelete: boolean) {
  if (!shouldDelete) return;
  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) console.error("[signup-approval-cleanup]", error);
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { user: manager, profile } = await requireUserManager();
    const { id } = await context.params;
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return Response.json({ error: "요청을 확인하세요." }, { status: 400 });

    const admin = createAdminClient();
    const { data: rawRequest, error: requestError } = await admin
      .from("signup_requests")
      .select("*")
      .eq("id", id)
      .single();
    const signupRequest = decryptSignupRequest(rawRequest);

    if (requestError || !signupRequest || signupRequest.status !== "pending") {
      return Response.json({ error: "대기 중인 신청이 아닙니다." }, { status: 404 });
    }
    if (profile.role === "department_admin" && signupRequest.department !== profile.department) {
      return Response.json({ error: "다른 부서의 가입신청은 처리할 수 없습니다." }, { status: 403 });
    }

    if (parsed.data.decision === "reject") {
      if (!parsed.data.reason?.trim()) {
        return Response.json({ error: "거절 사유를 입력하세요." }, { status: 400 });
      }
      const { error } = await admin.from("signup_requests").delete().eq("id", id);
      if (error) return Response.json({ error: errorText(error, "가입신청 삭제 실패") }, { status: 400 });
      return Response.json({ ok: true });
    }

    const loginId = parsed.data.loginId?.trim() || String(signupRequest.requested_login_id);
    const password = decryptSignupRequestPassword(rawRequest);
    if (!password) {
      return Response.json({
        error: "기존 가입신청에는 설정된 비밀번호가 없습니다. 해당 신청을 거절한 뒤 다시 신청하도록 안내하세요.",
      }, { status: 400 });
    }

    const policyError = validatePassword(password, {
      loginId,
      displayName: String(signupRequest.name),
    });
    if (policyError) {
      return Response.json({ error: `신청자가 설정한 비밀번호를 사용할 수 없습니다. ${policyError}` }, { status: 400 });
    }
    if (!signupRequest.birth_month_day) {
      return Response.json({ error: "생일 월/일이 없는 신청입니다." }, { status: 400 });
    }

    const hash = loginIdHash(loginId);
    const authEmail = loginIdToAuthEmail(loginId);
    const { data: duplicate, error: duplicateError } = await admin
      .from("profiles")
      .select("id")
      .eq("login_id_hash", hash)
      .maybeSingle();
    if (duplicateError) {
      return Response.json({ error: `아이디 중복 확인 실패: ${errorText(duplicateError, "알 수 없는 오류")}` }, { status: 400 });
    }
    if (duplicate) return Response.json({ error: "이미 사용 중인 아이디입니다." }, { status: 409 });

    let authUser: AuthUser | null = null;
    let newlyCreated = false;
    const createResult = await admin.auth.admin.createUser({
      email: authEmail,
      password,
      email_confirm: true,
      user_metadata: sanitizedAuthUserMetadata(false),
      app_metadata: { role: "user" },
    });

    if (createResult.error || !createResult.data.user) {
      if (!isDuplicateAuthUserError(createResult.error)) {
        return Response.json({
          error: `Supabase 인증 계정 생성 실패: ${errorText(createResult.error, "사용자 정보가 반환되지 않았습니다.")}`,
        }, { status: 400 });
      }

      authUser = await findAuthUserByEmail(admin, authEmail);
      if (!authUser) {
        return Response.json({
          error: `동일한 인증 이메일이 존재하지만 계정을 찾지 못했습니다. Supabase Authentication 사용자 목록을 확인하세요. (${authEmail})`,
        }, { status: 409 });
      }

      const { error: updateAuthError } = await admin.auth.admin.updateUserById(authUser.id, {
        password,
        email_confirm: true,
        user_metadata: sanitizedAuthUserMetadata(false),
        app_metadata: { ...authUser.app_metadata, role: "user" },
      });
      if (updateAuthError) {
        return Response.json({
          error: `기존 인증 계정 복구 실패: ${errorText(updateAuthError, "알 수 없는 오류")}`,
        }, { status: 400 });
      }
    } else {
      authUser = createResult.data.user;
      newlyCreated = true;
    }

    if (!authUser) {
      return Response.json({ error: "인증 사용자 정보를 준비하지 못했습니다." }, { status: 500 });
    }

    const now = new Date().toISOString();
    const { error: profileError } = await admin.from("profiles").upsert({
      id: authUser.id,
      ...encryptProfileValues({
        login_id: loginId,
        display_name: String(signupRequest.name),
        birth_month_day: String(signupRequest.birth_month_day),
      }),
      department: signupRequest.department,
      role: "user",
      account_status: "active",
      must_change_password: false,
      password_changed_at: now,
    }, { onConflict: "id" });

    if (profileError) {
      await removeNewUser(admin, authUser.id, newlyCreated);
      return Response.json({
        error: `사용자 프로필 생성 실패: ${errorText(profileError, "알 수 없는 오류")}`,
      }, { status: 400 });
    }

    try {
      await recordPassword(admin, authUser.id, password, { allowExisting: true });
    } catch (historyError) {
      await removeNewUser(admin, authUser.id, newlyCreated);
      return Response.json({
        error: `비밀번호 이력 저장 실패: ${errorText(historyError, "알 수 없는 오류")}`,
      }, { status: 400 });
    }

    const { error: requestUpdateError } = await admin
      .from("signup_requests")
      .update({
        status: "approved",
        approved_user_id: authUser.id,
        processed_by: manager.id,
        processed_at: now,
      })
      .eq("id", id)
      .eq("status", "pending");

    if (requestUpdateError) {
      await removeNewUser(admin, authUser.id, newlyCreated);
      return Response.json({
        error: `가입신청 승인 상태 저장 실패: ${errorText(requestUpdateError, "알 수 없는 오류")}`,
      }, { status: 400 });
    }

    // 승인된 신청은 화면에서 보이지 않도록 삭제합니다. 삭제가 실패해도 status가 approved이므로 재노출되지 않습니다.
    const { error: deleteError } = await admin.from("signup_requests").delete().eq("id", id);
    if (deleteError) {
      console.error("[signup-approval-request-delete]", deleteError);
    }

    return Response.json({ ok: true, loginId });
  } catch (error) {
    if (error instanceof Error && !["UNAUTHORIZED", "PASSWORD_CHANGE_REQUIRED", "FORBIDDEN"].includes(error.message)) {
      console.error("[signup-approval]", error);
      return Response.json({
        error: `가입 승인 처리 중 오류가 발생했습니다. ${errorText(error, "알 수 없는 오류")}`,
      }, { status: 500 });
    }
    return authErrorResponse(error);
  }
}
