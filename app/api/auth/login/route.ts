import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { decryptProfile, legacyLoginIdToAuthEmail, loginIdToAuthEmail } from "@/lib/security/pii";
import { passwordExpired } from "@/lib/security/password-history";
import type { Profile } from "@/types";

const schema = z.object({
  loginId: z.string().regex(/^[A-Za-z0-9_-]{4,30}$/),
  password: z.string().min(1).max(100),
  adminOnly: z.boolean().optional(),
});

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "아이디와 비밀번호를 확인하세요." }, { status: 400 });

  const supabase = await createClient();
  let { data, error } = await supabase.auth.signInWithPassword({
    email: loginIdToAuthEmail(parsed.data.loginId),
    password: parsed.data.password,
  });
  // 개인정보 마이그레이션 전환 기간에만 기존 평문 기반 Auth 이메일도 허용합니다.
  if (error || !data.user) {
    const legacyResult = await supabase.auth.signInWithPassword({
      email: legacyLoginIdToAuthEmail(parsed.data.loginId),
      password: parsed.data.password,
    });
    data = legacyResult.data;
    error = legacyResult.error;
  }
  if (error || !data.user) {
    return Response.json({ error: "아이디 또는 비밀번호가 올바르지 않습니다." }, { status: 401 });
  }

  const { data: rawProfile } = await supabase.from("profiles").select("*").eq("id", data.user.id).single();
  const profile = decryptProfile(rawProfile) as Profile | null;
  if (!profile || profile.account_status !== "active") {
    await supabase.auth.signOut();
    return Response.json({ error: "사용할 수 없는 계정입니다. 관리자에게 문의하세요." }, { status: 403 });
  }
  if (parsed.data.adminOnly && profile.role !== "admin") {
    await supabase.auth.signOut();
    return Response.json({ error: "관리자 계정이 아닙니다." }, { status: 403 });
  }

  const expired = passwordExpired(profile.password_changed_at);
  const mustChangePassword = profile.must_change_password || expired;
  const admin = createAdminClient();
  await admin.from("profiles").update({
    last_login_at: new Date().toISOString(),
    ...(expired ? { must_change_password: true } : {}),
  }).eq("id", data.user.id);

  return Response.json({ ok: true, role: profile.role, mustChangePassword });
}
