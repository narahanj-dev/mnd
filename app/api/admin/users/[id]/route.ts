import { z } from "zod";
import { authErrorResponse, canManageUser, requireUser, requireUserManager } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { DEPARTMENTS, RESET_TEMPORARY_PASSWORD } from "@/lib/constants";
import { decryptProfile, encryptPii, encryptProfileValues, loginIdHash, loginIdToAuthEmail, sanitizedAuthUserMetadata } from "@/lib/security/pii";
import { recordPassword } from "@/lib/security/password-history";
import type { Profile } from "@/types";

const updateSchema = z.object({
  action: z.literal("updateIdentity"),
  loginId: z.string().regex(/^[A-Za-z0-9_-]{4,30}$/),
  department: z.enum(DEPARTMENTS),
  role: z.enum(["user", "department_admin", "admin"]),
});
const resetPasswordSchema = z.object({ action: z.literal("resetPassword") });
const patchSchema = z.discriminatedUnion("action", [updateSchema, resetPasswordSchema]);

type AdminClient = ReturnType<typeof createAdminClient>;

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { user: actingUser, profile: actingProfile } = await requireUser();
    const { id } = await context.params;
    const parsed = patchSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return Response.json({ error: "수정 내용을 확인하세요." }, { status: 400 });

    const admin = createAdminClient();
    const { data: rawTarget, error: profileReadError } = await admin.from("profiles").select("*").eq("id", id).single();
    const targetProfile = decryptProfile(rawTarget) as Profile | null;
    if (profileReadError || !targetProfile) return Response.json({ error: "사용자 계정을 찾을 수 없습니다." }, { status: 404 });

    const isSelfService = actingProfile.role === "user" && actingUser.id === id;
    if (!isSelfService && !canManageUser(actingProfile, targetProfile)) {
      return Response.json({ error: "해당 사용자를 관리할 권한이 없습니다." }, { status: 403 });
    }
    if (actingProfile.role === "user" && !isSelfService) return Response.json({ error: "본인 정보만 수정할 수 있습니다." }, { status: 403 });
    if (actingProfile.role === "user" && parsed.data.action === "resetPassword") {
      return Response.json({ error: "일반사용자는 사용자 관리에서 비밀번호를 초기화할 수 없습니다." }, { status: 403 });
    }

    const { data: authData, error: authReadError } = await admin.auth.admin.getUserById(id);
    if (authReadError || !authData.user) return Response.json({ error: authReadError?.message ?? "인증 계정을 찾을 수 없습니다." }, { status: 404 });

    if (parsed.data.action === "resetPassword") {
      const temporaryPassword = RESET_TEMPORARY_PASSWORD;
      const { error: authError } = await admin.auth.admin.updateUserById(id, {
        password: temporaryPassword,
        user_metadata: sanitizedAuthUserMetadata(true),
      });
      if (authError) return Response.json({ error: authError.message }, { status: 400 });

      try {
        await recordPassword(admin, id, temporaryPassword, { allowExisting: true });
      } catch (error) {
        return Response.json({ error: error instanceof Error ? error.message : "비밀번호 이력 저장 실패" }, { status: 400 });
      }

      await admin.from("profiles").update({
        must_change_password: true,
        password_changed_at: new Date().toISOString(),
      }).eq("id", id);
      await admin.from("messages").insert({
        sender_id: actingUser.id,
        recipient_id: id,
        title: "비밀번호 초기화 안내",
        content: "관리자가 비밀번호를 초기화했습니다. 임시 비밀번호로 로그인한 뒤 즉시 새 비밀번호로 변경하세요.",
        message_type: "password_reset",
      });
      return Response.json({ ok: true, temporaryPassword });
    }

    if (actingProfile.role === "user" && (parsed.data.department !== targetProfile.department || parsed.data.role !== targetProfile.role)) {
      return Response.json({ error: "일반사용자는 아이디만 변경할 수 있습니다." }, { status: 403 });
    }
    if (actingProfile.role === "department_admin" && parsed.data.role === "admin") {
      return Response.json({ error: "관리자 권한은 관리자만 부여할 수 있습니다." }, { status: 403 });
    }
    if (actingProfile.role === "department_admin" && parsed.data.department !== actingProfile.department) {
      return Response.json({ error: "부서관리자는 사용자를 다른 부서로 이동할 수 없습니다." }, { status: 403 });
    }

    const nextHash = loginIdHash(parsed.data.loginId);
    if (parsed.data.loginId !== targetProfile.login_id) {
      const { data: duplicate } = await admin.from("profiles").select("id").eq("login_id_hash", nextHash).neq("id", id).maybeSingle();
      if (duplicate) return Response.json({ error: "이미 사용 중인 아이디입니다." }, { status: 409 });
    }

    const { error: authUpdateError } = await admin.auth.admin.updateUserById(id, {
      email: loginIdToAuthEmail(parsed.data.loginId),
      email_confirm: true,
      user_metadata: sanitizedAuthUserMetadata(targetProfile.must_change_password),
      app_metadata: { ...authData.user.app_metadata, role: parsed.data.role },
    });
    if (authUpdateError) return Response.json({ error: authUpdateError.message }, { status: 400 });

    const { error: profileUpdateError } = await admin.from("profiles").update({
      ...encryptProfileValues({ login_id: parsed.data.loginId }),
      department: parsed.data.department,
      role: parsed.data.role,
    }).eq("id", id);
    if (profileUpdateError) {
      await admin.auth.admin.updateUserById(id, {
        email: loginIdToAuthEmail(targetProfile.login_id),
        app_metadata: authData.user.app_metadata,
        user_metadata: sanitizedAuthUserMetadata(targetProfile.must_change_password),
      });
      return Response.json({ error: profileUpdateError.message }, { status: 400 });
    }

    await admin.from("signup_requests").update({
      requested_login_id: encryptPii(parsed.data.loginId),
      requested_login_id_hash: nextHash,
      department: parsed.data.department,
    }).eq("approved_user_id", id);

    return Response.json({ ok: true });
  } catch (error) {
    return authErrorResponse(error);
  }
}

async function clearRelatedUserData(admin: AdminClient, targetId: string) {
  const { data: ownedEvents, error: eventReadError } = await admin.from("calendar_events").select("id").eq("user_id", targetId);
  if (eventReadError) return `삭제 대상 일정 조회 실패: ${eventReadError.message}`;
  const eventIds = (ownedEvents ?? []).map((event) => event.id as string);

  const nullifyResults = await Promise.all([
    admin.from("signup_requests").update({ processed_by: null }).eq("processed_by", targetId),
    admin.from("calendar_events").update({ approved_by: null }).eq("approved_by", targetId),
    admin.from("event_change_requests").update({ processed_by: null }).eq("processed_by", targetId),
  ]);
  const nullifyError = nullifyResults.find((result) => result.error)?.error;
  if (nullifyError) return `처리자 기록 정리 실패: ${nullifyError.message}`;

  if (eventIds.length > 0) {
    const { error } = await admin.from("messages").delete().in("related_event_id", eventIds);
    if (error) return `일정 관련 쪽지 삭제 실패: ${error.message}`;
  }
  const operations = await Promise.all([
    admin.from("messages").delete().or(`sender_id.eq.${targetId},recipient_id.eq.${targetId}`),
    admin.from("event_change_requests").delete().eq("requester_id", targetId),
    admin.from("signup_requests").delete().eq("approved_user_id", targetId),
    admin.from("admin_settings").delete().eq("admin_user_id", targetId),
    admin.from("calendar_events").delete().eq("user_id", targetId),
  ]);
  const error = operations.find((result) => result.error)?.error;
  return error ? `관련 데이터 삭제 실패: ${error.message}` : null;
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { user: actingUser, profile: actingProfile } = await requireUserManager();
    const { id } = await context.params;
    if (actingUser.id === id) return Response.json({ error: "현재 로그인한 계정은 삭제할 수 없습니다." }, { status: 400 });

    const admin = createAdminClient();
    const { data: rawTarget, error: profileError } = await admin.from("profiles").select("*").eq("id", id).maybeSingle();
    const targetProfile = decryptProfile(rawTarget) as Profile | null;
    if (profileError) return Response.json({ error: profileError.message }, { status: 400 });
    if (!targetProfile) return Response.json({ error: "사용자 계정을 찾을 수 없습니다." }, { status: 404 });
    if (!canManageUser(actingProfile, targetProfile)) return Response.json({ error: "해당 사용자를 삭제할 권한이 없습니다." }, { status: 403 });

    const cleanupError = await clearRelatedUserData(admin, id);
    if (cleanupError) return Response.json({ error: cleanupError }, { status: 400 });

    const { error: authDeleteError } = await admin.auth.admin.deleteUser(id);
    if (authDeleteError && !/not found|does not exist/i.test(authDeleteError.message)) {
      return Response.json({ error: `인증 계정 삭제 실패: ${authDeleteError.message}` }, { status: 400 });
    }
    if (authDeleteError) await admin.from("profiles").delete().eq("id", id);
    return Response.json({ ok: true });
  } catch (error) {
    return authErrorResponse(error);
  }
}
