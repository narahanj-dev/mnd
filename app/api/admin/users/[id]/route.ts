import { z } from "zod";
import {
  authErrorResponse,
  canManageUser,
  requireUser,
  requireUserManager,
} from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { DEPARTMENTS, loginIdToEmail } from "@/lib/constants";
import type { Profile } from "@/types";

const updateSchema = z.object({
  action: z.literal("updateIdentity"),
  loginId: z.string().regex(/^[A-Za-z0-9_-]{4,30}$/),
  department: z.enum(DEPARTMENTS),
  role: z.enum(["user", "department_admin", "admin"]),
});

const resetPasswordSchema = z.object({
  action: z.literal("resetPassword"),
});

const patchSchema = z.discriminatedUnion("action", [
  updateSchema,
  resetPasswordSchema,
]);

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { user: actingUser, profile: actingProfile } = await requireUser();
    const { id } = await context.params;
    const parsed = patchSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success) {
      return Response.json(
        { error: "수정 내용을 확인하세요." },
        { status: 400 },
      );
    }

    const admin = createAdminClient();
    const { data: targetProfile, error: profileReadError } = await admin
      .from("profiles")
      .select("*")
      .eq("id", id)
      .single<Profile>();

    if (profileReadError || !targetProfile) {
      return Response.json(
        { error: "사용자 계정을 찾을 수 없습니다." },
        { status: 404 },
      );
    }

    const isSelfService = actingProfile.role === "user" && actingUser.id === id;

    if (!isSelfService && !canManageUser(actingProfile, targetProfile)) {
      return Response.json(
        { error: "해당 사용자를 관리할 권한이 없습니다." },
        { status: 403 },
      );
    }

    if (actingProfile.role === "user" && !isSelfService) {
      return Response.json(
        { error: "본인 정보만 수정할 수 있습니다." },
        { status: 403 },
      );
    }

    if (
      actingProfile.role === "user" &&
      parsed.data.action === "resetPassword"
    ) {
      return Response.json(
        {
          error:
            "일반사용자는 사용자 관리에서 비밀번호를 초기화할 수 없습니다.",
        },
        { status: 403 },
      );
    }

    if (
      parsed.data.action === "updateIdentity" &&
      actingProfile.role === "user" &&
      (parsed.data.department !== targetProfile.department ||
        parsed.data.role !== targetProfile.role)
    ) {
      return Response.json(
        { error: "일반사용자는 아이디만 변경할 수 있습니다." },
        { status: 403 },
      );
    }

    if (
      parsed.data.action === "updateIdentity" &&
      actingProfile.role === "department_admin" &&
      parsed.data.role === "admin"
    ) {
      return Response.json(
        { error: "관리자 권한은 관리자만 부여할 수 있습니다." },
        { status: 403 },
      );
    }

    if (
      parsed.data.action === "updateIdentity" &&
      actingProfile.role === "department_admin" &&
      parsed.data.department !== actingProfile.department
    ) {
      return Response.json(
        { error: "부서관리자는 사용자를 다른 부서로 이동할 수 없습니다." },
        { status: 403 },
      );
    }

    const { data: authData, error: authReadError } =
      await admin.auth.admin.getUserById(id);
    if (authReadError || !authData.user) {
      return Response.json(
        { error: authReadError?.message ?? "인증 계정을 찾을 수 없습니다." },
        { status: 404 },
      );
    }

    if (parsed.data.action === "resetPassword") {
      const temporaryPassword = "12345";
      const { error: authError } = await admin.auth.admin.updateUserById(id, {
        password: temporaryPassword,
        user_metadata: {
          ...authData.user.user_metadata,
          must_change_password: true,
        },
      });

      if (authError)
        return Response.json({ error: authError.message }, { status: 400 });

      const { error: profileError } = await admin
        .from("profiles")
        .update({ must_change_password: true })
        .eq("id", id);

      if (profileError)
        return Response.json({ error: profileError.message }, { status: 400 });

      await admin.from("messages").insert({
        sender_id: actingUser.id,
        recipient_id: id,
        title: "비밀번호 초기화 안내",
        content:
          "사용자 관리 담당자가 비밀번호를 12345로 초기화했습니다. 로그인 후 새 비밀번호로 변경하세요.",
        message_type: "password_reset",
      });

      return Response.json({ ok: true, temporaryPassword });
    }

    const nextLoginId = parsed.data.loginId.trim();
    const nextDepartment = parsed.data.department;
    const nextRole = parsed.data.role;

    if (nextLoginId !== targetProfile.login_id) {
      const { data: duplicate } = await admin
        .from("profiles")
        .select("id")
        .eq("login_id", nextLoginId)
        .neq("id", id)
        .maybeSingle();

      if (duplicate) {
        return Response.json(
          { error: "이미 사용 중인 아이디입니다." },
          { status: 409 },
        );
      }
    }

    const previousUserMetadata = authData.user.user_metadata ?? {};
    const previousAppMetadata = authData.user.app_metadata ?? {};
    const nextUserMetadata = {
      ...previousUserMetadata,
      login_id: nextLoginId,
      department: nextDepartment,
    };
    const nextAppMetadata = {
      ...previousAppMetadata,
      role: nextRole,
    };

    const { error: authUpdateError } = await admin.auth.admin.updateUserById(
      id,
      {
        email: loginIdToEmail(nextLoginId),
        user_metadata: nextUserMetadata,
        app_metadata: nextAppMetadata,
      },
    );

    if (authUpdateError) {
      return Response.json({ error: authUpdateError.message }, { status: 400 });
    }

    const { error: profileUpdateError } = await admin
      .from("profiles")
      .update({
        login_id: nextLoginId,
        department: nextDepartment,
        role: nextRole,
      })
      .eq("id", id);

    if (profileUpdateError) {
      await admin.auth.admin.updateUserById(id, {
        email: loginIdToEmail(targetProfile.login_id),
        user_metadata: previousUserMetadata,
        app_metadata: previousAppMetadata,
      });
      return Response.json(
        { error: profileUpdateError.message },
        { status: 400 },
      );
    }

    const { error: linkedRequestError } = await admin
      .from("signup_requests")
      .update({ requested_login_id: nextLoginId, department: nextDepartment })
      .eq("approved_user_id", id);

    const { error: legacyRequestError } = await admin
      .from("signup_requests")
      .update({
        requested_login_id: nextLoginId,
        department: nextDepartment,
        approved_user_id: id,
      })
      .is("approved_user_id", null)
      .eq("status", "approved")
      .eq("requested_login_id", targetProfile.login_id);

    if (linkedRequestError || legacyRequestError) {
      await admin
        .from("profiles")
        .update({
          login_id: targetProfile.login_id,
          department: targetProfile.department,
          role: targetProfile.role,
        })
        .eq("id", id);
      await admin.auth.admin.updateUserById(id, {
        email: loginIdToEmail(targetProfile.login_id),
        user_metadata: previousUserMetadata,
        app_metadata: previousAppMetadata,
      });
      return Response.json(
        { error: linkedRequestError?.message ?? legacyRequestError?.message },
        { status: 400 },
      );
    }

    return Response.json({ ok: true });
  } catch (error) {
    return authErrorResponse(error);
  }
}

type AdminClient = ReturnType<typeof createAdminClient>;

type DeletionTarget = Pick<Profile, "id" | "login_id">;

async function clearRelatedUserData(
  admin: AdminClient,
  target: DeletionTarget,
) {
  const { data: ownedEvents, error: eventReadError } = await admin
    .from("calendar_events")
    .select("id")
    .eq("user_id", target.id);

  if (eventReadError)
    return `삭제 대상 일정 조회 실패: ${eventReadError.message}`;

  const ownedEventIds = (ownedEvents ?? []).map((event) => event.id as string);

  const nullifyOperations = await Promise.all([
    admin
      .from("signup_requests")
      .update({ processed_by: null })
      .eq("processed_by", target.id),
    admin
      .from("calendar_events")
      .update({ approved_by: null })
      .eq("approved_by", target.id),
    admin
      .from("event_change_requests")
      .update({ processed_by: null })
      .eq("processed_by", target.id),
  ]);

  const nullifyError = nullifyOperations.find((result) => result.error)?.error;
  if (nullifyError) return `처리자 기록 정리 실패: ${nullifyError.message}`;

  if (ownedEventIds.length > 0) {
    const { error: relatedMessageError } = await admin
      .from("messages")
      .delete()
      .in("related_event_id", ownedEventIds);
    if (relatedMessageError)
      return `일정 관련 쪽지 삭제 실패: ${relatedMessageError.message}`;

    const { error: relatedRequestError } = await admin
      .from("event_change_requests")
      .delete()
      .in("event_id", ownedEventIds);
    if (relatedRequestError)
      return `일정 변경 요청 삭제 실패: ${relatedRequestError.message}`;
  }

  const { error: messageError } = await admin
    .from("messages")
    .delete()
    .or(`sender_id.eq.${target.id},recipient_id.eq.${target.id}`);
  if (messageError) return `사용자 쪽지 삭제 실패: ${messageError.message}`;

  const { error: requesterError } = await admin
    .from("event_change_requests")
    .delete()
    .eq("requester_id", target.id);
  if (requesterError)
    return `사용자 변경 요청 삭제 실패: ${requesterError.message}`;

  const { error: linkedSignupError } = await admin
    .from("signup_requests")
    .delete()
    .eq("approved_user_id", target.id);
  if (linkedSignupError && linkedSignupError.code !== "42703") {
    return `연결된 회원가입 기록 삭제 실패: ${linkedSignupError.message}`;
  }

  const { error: legacySignupError } = await admin
    .from("signup_requests")
    .delete()
    .eq("status", "approved")
    .eq("requested_login_id", target.login_id);
  if (legacySignupError)
    return `회원가입 기록 삭제 실패: ${legacySignupError.message}`;

  const { error: settingsError } = await admin
    .from("admin_settings")
    .delete()
    .eq("admin_user_id", target.id);
  if (settingsError) return `관리자 설정 삭제 실패: ${settingsError.message}`;

  const { error: ownedEventError } = await admin
    .from("calendar_events")
    .delete()
    .eq("user_id", target.id);
  if (ownedEventError)
    return `사용자 일정 삭제 실패: ${ownedEventError.message}`;

  return null;
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { user: actingUser, profile: actingProfile } =
      await requireUserManager();
    const { id } = await context.params;

    if (actingUser.id === id) {
      return Response.json(
        { error: "현재 로그인한 계정은 삭제할 수 없습니다." },
        { status: 400 },
      );
    }

    const admin = createAdminClient();
    const { data: targetProfile, error: profileError } = await admin
      .from("profiles")
      .select("*")
      .eq("id", id)
      .maybeSingle<Profile>();

    if (profileError)
      return Response.json({ error: profileError.message }, { status: 400 });
    if (!targetProfile) {
      return Response.json(
        { error: "사용자 계정을 찾을 수 없습니다." },
        { status: 404 },
      );
    }

    if (!canManageUser(actingProfile, targetProfile)) {
      return Response.json(
        { error: "해당 사용자를 삭제할 권한이 없습니다." },
        { status: 403 },
      );
    }

    const cleanupError = await clearRelatedUserData(admin, targetProfile);
    if (cleanupError) {
      return Response.json(
        {
          error: `${cleanupError} Supabase SQL 마이그레이션 적용 여부를 확인하세요.`,
        },
        { status: 400 },
      );
    }

    const { error: authDeleteError } = await admin.auth.admin.deleteUser(id);
    if (authDeleteError) {
      const authUserMissing = /not found|does not exist/i.test(
        authDeleteError.message,
      );
      if (!authUserMissing) {
        return Response.json(
          { error: `인증 계정 삭제 실패: ${authDeleteError.message}` },
          { status: 400 },
        );
      }

      const { error: orphanProfileError } = await admin
        .from("profiles")
        .delete()
        .eq("id", id);
      if (orphanProfileError) {
        return Response.json(
          { error: `고아 프로필 삭제 실패: ${orphanProfileError.message}` },
          { status: 400 },
        );
      }
    }

    return Response.json({ ok: true });
  } catch (error) {
    return authErrorResponse(error);
  }
}
