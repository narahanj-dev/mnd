import { z } from "zod";
import { requireAdmin, authErrorResponse } from "@/lib/auth/guards";
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
    const { user } = await requireAdmin();
    const { id } = await context.params;
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return Response.json({ error: "요청을 확인하세요." }, { status: 400 });
    const admin = createAdminClient();
    const { data: req } = await admin.from("signup_requests").select("*").eq("id", id).single();
    if (!req || req.status !== "pending") return Response.json({ error: "대기 중인 신청이 아닙니다." }, { status: 404 });

    if (parsed.data.decision === "reject") {
      if (!parsed.data.reason?.trim()) return Response.json({ error: "거절 사유를 입력하세요." }, { status: 400 });
      await admin.from("signup_requests").update({
        status: "rejected",
        rejection_reason: parsed.data.reason,
        processed_by: user.id,
        processed_at: new Date().toISOString(),
      }).eq("id", id);
      return Response.json({ ok: true });
    }

    const loginId = parsed.data.loginId || req.requested_login_id;
    const password = parsed.data.password;
    if (!password || password.length < 4) return Response.json({ error: "4자 이상의 임시 비밀번호를 입력하세요." }, { status: 400 });
    if (!req.birth_date) return Response.json({ error: "생년월일이 없는 신청입니다. 신청 정보를 확인하세요." }, { status: 400 });

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
    if (error || !data.user) return Response.json({ error: error?.message ?? "계정 생성 실패" }, { status: 400 });

    await admin.from("profiles").upsert({
      id: data.user.id,
      login_id: loginId,
      display_name: req.name,
      department: req.department,
      birth_date: req.birth_date,
      role: "user",
      account_status: "active",
      must_change_password: true,
    });
    await admin.from("signup_requests").update({
      status: "approved",
      approved_user_id: data.user.id,
      processed_by: user.id,
      processed_at: new Date().toISOString(),
    }).eq("id", id);
    return Response.json({ ok: true });
  } catch (error) { return authErrorResponse(error); }
}
