import { z } from "zod";
import { requireAdmin, authErrorResponse } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { loginIdToEmail } from "@/lib/constants";
const schema = z.object({ loginId: z.string().regex(/^[A-Za-z0-9_-]{4,30}$/).optional(), password: z.string().min(4).max(100).optional(), displayName: z.string().min(1).max(50).optional(), department: z.string().min(1).max(80).optional(), role: z.enum(["user", "admin"]).optional(), accountStatus: z.enum(["active", "inactive"]).optional() });
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin(); const { id } = await context.params; const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return Response.json({ error: "수정 내용을 확인하세요." }, { status: 400 });
    const admin = createAdminClient(); const authUpdate: Record<string, unknown> = {}; const profileUpdate: Record<string, unknown> = {};
    if (parsed.data.loginId) { authUpdate.email = loginIdToEmail(parsed.data.loginId); profileUpdate.login_id = parsed.data.loginId; }
    if (parsed.data.password) { authUpdate.password = parsed.data.password; profileUpdate.must_change_password = true; }
    if (parsed.data.role) { authUpdate.app_metadata = { role: parsed.data.role }; profileUpdate.role = parsed.data.role; }
    if (parsed.data.displayName) profileUpdate.display_name = parsed.data.displayName;
    if (parsed.data.department) profileUpdate.department = parsed.data.department;
    if (parsed.data.accountStatus) profileUpdate.account_status = parsed.data.accountStatus;
    if (Object.keys(authUpdate).length) { const { error } = await admin.auth.admin.updateUserById(id, authUpdate); if (error) return Response.json({ error: error.message }, { status: 400 }); }
    if (Object.keys(profileUpdate).length) { const { error } = await admin.from("profiles").update(profileUpdate).eq("id", id); if (error) return Response.json({ error: error.message }, { status: 400 }); }
    return Response.json({ ok: true });
  } catch (error) { return authErrorResponse(error); }
}
