import { z } from "zod";
import { requireAdmin, authErrorResponse } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { loginIdToEmail } from "@/lib/constants";
const schema = z.object({ loginId: z.string().regex(/^[A-Za-z0-9_-]{4,30}$/).optional(), password: z.string().min(6).max(100).optional(), displayName: z.string().min(1).max(50).optional() });
export async function PATCH(request: Request) {
  try {
    const { user } = await requireAdmin(); const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return Response.json({ error: "입력값을 확인하세요. 비밀번호는 6자 이상입니다." }, { status: 400 });
    const admin = createAdminClient(); const authUpdate: Record<string, unknown> = {}; const profileUpdate: Record<string, unknown> = {};
    if (parsed.data.loginId) { authUpdate.email = loginIdToEmail(parsed.data.loginId); profileUpdate.login_id = parsed.data.loginId; }
    if (parsed.data.password) authUpdate.password = parsed.data.password;
    if (parsed.data.displayName) profileUpdate.display_name = parsed.data.displayName;
    if (Object.keys(authUpdate).length) { const { error } = await admin.auth.admin.updateUserById(user.id, authUpdate); if (error) return Response.json({ error: error.message }, { status: 400 }); }
    if (Object.keys(profileUpdate).length) await admin.from("profiles").update(profileUpdate).eq("id", user.id);
    if (parsed.data.displayName) await admin.from("admin_settings").upsert({ admin_user_id: user.id, display_name: parsed.data.displayName }, { onConflict: "admin_user_id" });
    return Response.json({ ok: true });
  } catch (error) { return authErrorResponse(error); }
}
