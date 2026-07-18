import { z } from "zod";
import { authErrorResponse, requireUserManager } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { loginIdToEmail } from "@/lib/constants";

const schema = z.object({
  decision: z.enum(["approve", "reject"]),
  loginId: z.string().optional(),
  password: z.string().optional(),
  reason: z.string().optional(),
});

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { profile } = await requireUserManager();
    const { id } = await context.params;
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return Response.json({ error: "요청을 확인하세요." }, { status: 400 });

    const admin = createAdminClient();
    const { data: req, error: requestError } = await admin
      .from("signup_requests")
      .select("*")
      .eq("id", id)
      .single();

    if (requestError || !req || req.status !== "pending") {
      return Response.json({ error: "대기 중인 신청이 아닙니다." }, { status: 404 });
    }

    if (profile.role === "department_admin" && req.department !== profile.department) {
      return Response.json({ error: "다른 부서의 가입신청은 처리할 수 없습니다." }, { status: 403 });
    }

    if (parsed.data.decision === "reject") {
      if (!parsed.data.reason?.trim()) {
        return Response.json({ error: "거절 사유를 입력하세요." }, { status: 400 });
      }
      const { error } = await admin.from("signup_requests").delete().eq("id", id);
      if (error) return Response.json({ error: error.message }, { status: 400 });
      return Response.json({ ok: true });
    }

    const loginId = parsed.data.loginId?.trim() || req.requested_login_id;
    const password = parsed.data.password;
    if (!password || password.length < 4) {
      return Response.json({ error: "4자 이상의 임시 비밀번호를 입력하세요." }, { status: 400 });
    }
    if (!req.birth_date) {
      return Response.json({ error: "생년월일이 없는 신청입니다. 신청 정보를 확인하세요." }, { status: 400 });
    }

    const { data, error } = await admin.auth.admin.createUser({
      email: loginIdToEmail(loginId),
      password,
      email_confirm: true,
      user_metadata: {
        login_id: loginId,
        display_name: req.name,
        department: req.department,
        birth_date: req.birth_date,
        must_change_password: true,
      },
      app_metadata: { role: "user" },
    });
    if (error || !data.user) {
      return Response.json({ error: error?.message ?? "계정 생성 실패" }, { status: 400 });
    }

    const { error: profileError } = await admin.from("profiles").upsert({
      id: data.user.id,
      login_id: loginId,
      display_name: req.name,
      department: req.department,
      birth_date: req.birth_date,
      role: "user",
      account_status: "active",
      must_change_password: true,
    });

    if (profileError) {
      await admin.auth.admin.deleteUser(data.user.id);
      return Response.json({ error: profileError.message }, { status: 400 });
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
