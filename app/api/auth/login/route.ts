import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { loginIdToEmail } from "@/lib/constants";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Profile } from "@/types";

const schema = z.object({ loginId: z.string().min(4).max(30), password: z.string().min(4).max(100), adminOnly: z.boolean().optional() });

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "아이디와 비밀번호를 확인하세요." }, { status: 400 });
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email: loginIdToEmail(parsed.data.loginId), password: parsed.data.password });
  if (error || !data.user) return Response.json({ error: "아이디 또는 비밀번호가 올바르지 않습니다." }, { status: 401 });

  const { data: profile } = await supabase.from("profiles").select("*").eq("id", data.user.id).single<Profile>();
  if (!profile || profile.account_status !== "active") {
    await supabase.auth.signOut();
    return Response.json({ error: "사용할 수 없는 계정입니다. 관리자에게 문의하세요." }, { status: 403 });
  }
  if (parsed.data.adminOnly && profile.role !== "admin") {
    await supabase.auth.signOut();
    return Response.json({ error: "관리자 계정이 아닙니다." }, { status: 403 });
  }
  const admin = createAdminClient();
  await admin.from("profiles").update({ last_login_at: new Date().toISOString() }).eq("id", data.user.id);
  return Response.json({ ok: true, role: profile.role, mustChangePassword: profile.must_change_password });
}
