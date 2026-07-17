import { z } from "zod";
import { requireUser, authErrorResponse } from "@/lib/auth/guards";
const schema = z.object({ password: z.string().min(6).max(100) });
export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return Response.json({ error: "비밀번호는 6자 이상이어야 합니다." }, { status: 400 });
    const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
    if (error) return Response.json({ error: error.message }, { status: 400 });
    await supabase.from("profiles").update({ must_change_password: false }).eq("id", user.id);
    return Response.json({ ok: true });
  } catch (error) { return authErrorResponse(error); }
}
