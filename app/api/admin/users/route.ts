import { z } from "zod";
import { requireAdmin, authErrorResponse } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { loginIdToEmail } from "@/lib/constants";

export async function GET() {
  try { await requireAdmin(); const admin = createAdminClient(); const { data, error } = await admin.from("profiles").select("*").order("created_at"); if (error) return Response.json({ error: error.message }, { status: 400 }); return Response.json({ users: data ?? [] }); }
  catch (error) { return authErrorResponse(error); }
}

const schema = z.object({ loginId: z.string().regex(/^[A-Za-z0-9_-]{4,30}$/), password: z.string().min(4).max(100), displayName: z.string().min(1).max(50), department: z.string().min(1).max(80), role: z.enum(["user", "admin"]).default("user") });
export async function POST(request: Request) {
  try {
    await requireAdmin(); const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return Response.json({ error: "계정 입력값을 확인하세요." }, { status: 400 });
    const admin = createAdminClient();
    const { data, error } = await admin.auth.admin.createUser({ email: loginIdToEmail(parsed.data.loginId), password: parsed.data.password, email_confirm: true, app_metadata: { role: parsed.data.role }, user_metadata: { login_id: parsed.data.loginId, display_name: parsed.data.displayName, department: parsed.data.department, must_change_password: true } });
    if (error || !data.user) return Response.json({ error: error?.message ?? "사용자 생성 실패" }, { status: 400 });
    await admin.from("profiles").upsert({ id: data.user.id, login_id: parsed.data.loginId, display_name: parsed.data.displayName, department: parsed.data.department, role: parsed.data.role, account_status: "active", must_change_password: true });
    await admin.from("messages").insert({ recipient_id: data.user.id, title: "계정 생성 완료", content: `아이디 ${parsed.data.loginId} 계정이 생성되었습니다. 첫 로그인 후 비밀번호를 변경하세요.`, message_type: "account_created" });
    return Response.json({ ok: true });
  } catch (error) { return authErrorResponse(error); }
}
