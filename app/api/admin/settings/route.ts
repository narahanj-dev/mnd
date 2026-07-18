import { z } from "zod";
import { requireAdmin, authErrorResponse } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { encryptPii, encryptProfileValues, loginIdHash, loginIdToAuthEmail, sanitizedAuthUserMetadata } from "@/lib/security/pii";
import { ensurePasswordNotReused, recordPassword } from "@/lib/security/password-history";
import { validatePassword } from "@/lib/security/password-policy";

const schema = z.object({
  loginId: z.string().regex(/^[A-Za-z0-9_-]{4,30}$/).optional(),
  password: z.string().max(100).optional(),
  displayName: z.string().trim().min(1).max(50).optional(),
});

export async function PATCH(request: Request) {
  try {
    const { user, profile } = await requireAdmin();
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return Response.json({ error: "입력값을 확인하세요." }, { status: 400 });
    const admin = createAdminClient();

    const nextLoginId = parsed.data.loginId ?? profile.login_id;
    const nextDisplayName = parsed.data.displayName ?? profile.display_name;
    if (parsed.data.password) {
      const policyError = validatePassword(parsed.data.password, { loginId: nextLoginId, displayName: nextDisplayName });
      if (policyError) return Response.json({ error: policyError }, { status: 400 });
      try {
        await ensurePasswordNotReused(admin, user.id, parsed.data.password);
      } catch (error) {
        return Response.json({ error: error instanceof Error ? error.message : "비밀번호 이력을 확인하지 못했습니다." }, { status: 400 });
      }
    }

    if (parsed.data.loginId && parsed.data.loginId !== profile.login_id) {
      const { data: duplicate } = await admin.from("profiles").select("id").eq("login_id_hash", loginIdHash(parsed.data.loginId)).neq("id", user.id).maybeSingle();
      if (duplicate) return Response.json({ error: "이미 사용 중인 아이디입니다." }, { status: 409 });
    }

    const { data: authData, error: authReadError } = await admin.auth.admin.getUserById(user.id);
    if (authReadError || !authData.user) return Response.json({ error: authReadError?.message ?? "인증 계정을 찾을 수 없습니다." }, { status: 404 });

    const authUpdate: Record<string, unknown> = {
      user_metadata: sanitizedAuthUserMetadata(false),
      app_metadata: authData.user.app_metadata,
    };
    if (parsed.data.loginId) {
      authUpdate.email = loginIdToAuthEmail(parsed.data.loginId);
      authUpdate.email_confirm = true;
    }
    if (parsed.data.password) authUpdate.password = parsed.data.password;
    const { error: authError } = await admin.auth.admin.updateUserById(user.id, authUpdate);
    if (authError) return Response.json({ error: authError.message }, { status: 400 });

    const profileUpdate: Record<string, unknown> = {};
    if (parsed.data.loginId) Object.assign(profileUpdate, encryptProfileValues({ login_id: parsed.data.loginId }));
    if (parsed.data.displayName) Object.assign(profileUpdate, encryptProfileValues({ display_name: parsed.data.displayName }));
    if (parsed.data.password) Object.assign(profileUpdate, { must_change_password: false, password_changed_at: new Date().toISOString() });
    if (Object.keys(profileUpdate).length > 0) {
      const { error } = await admin.from("profiles").update(profileUpdate).eq("id", user.id);
      if (error) return Response.json({ error: error.message }, { status: 400 });
    }

    if (parsed.data.password) {
      try {
        await recordPassword(admin, user.id, parsed.data.password);
      } catch (error) {
        await admin.from("profiles").update({ must_change_password: true }).eq("id", user.id);
        return Response.json({ error: error instanceof Error ? error.message : "비밀번호 이력 저장 실패" }, { status: 500 });
      }
    }
    if (parsed.data.displayName) {
      await admin.from("admin_settings").upsert({
        admin_user_id: user.id,
        display_name: encryptPii(parsed.data.displayName),
      }, { onConflict: "admin_user_id" });
    }
    return Response.json({ ok: true });
  } catch (error) {
    return authErrorResponse(error);
  }
}
