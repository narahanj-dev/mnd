import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireUser, authErrorResponse } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { ensurePasswordNotReused, insertPasswordRecord, prunePasswordHistory, removePasswordRecord } from "@/lib/security/password-history";
import { validatePassword } from "@/lib/security/password-policy";
import { loginIdToAuthEmail, sanitizedAuthUserMetadata } from "@/lib/security/pii";
import { assertSameOrigin, clientIp } from "@/lib/security/request";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { SecurityError } from "@/lib/security/errors";
import { startAppSession } from "@/lib/security/session";
import { writeAuditLog } from "@/lib/security/audit";
import { requireAal2 } from "@/lib/security/mfa";

const schema = z.object({
  currentPassword: z.string().max(100).optional(),
  password: z.string().min(1).max(100),
});

export async function POST(request: Request) {
  let actorId: string | null = null;
  try {
    assertSameOrigin(request);
    const { supabase, user, profile } = await requireUser({ allowPasswordChangeRequired: true });
    actorId = user.id;
    if (profile.role !== "user" && !profile.must_change_password) await requireAal2(supabase);
    await enforceRateLimit({ purpose: "password-change", identity: `${user.id}:${clientIp(request)}`, limit: 5, windowSeconds: 1800 });
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new SecurityError("INVALID_INPUT", 400, "새 비밀번호를 확인하세요.");

    const policyError = validatePassword(parsed.data.password, { loginId: profile.login_id, displayName: profile.display_name });
    if (policyError) throw new SecurityError("WEAK_PASSWORD", 400, policyError);

    if (!profile.must_change_password) {
      const currentPassword = parsed.data.currentPassword?.trim();
      if (!currentPassword) throw new SecurityError("CURRENT_PASSWORD_REQUIRED", 400, "현재 비밀번호를 입력하세요.");
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
      if (!url || !publishableKey) throw new SecurityError("CONFIG", 503, "비밀번호 확인 설정을 불러오지 못했습니다.");
      const verifier = createSupabaseClient(url, publishableKey, { auth: { autoRefreshToken: false, persistSession: false } });
      const { error: verifyError } = await verifier.auth.signInWithPassword({ email: loginIdToAuthEmail(profile.login_id), password: currentPassword });
      if (verifyError) throw new SecurityError("CURRENT_PASSWORD_INVALID", 400, "현재 비밀번호가 일치하지 않습니다.");
    }

    const admin = createAdminClient();
    await ensurePasswordNotReused(admin, user.id, parsed.data.password);
    const historyRecordId = await insertPasswordRecord(admin, user.id, parsed.data.password);
    const nextVersion = (profile.session_version ?? 1) + 1;

    const { error: authError } = await supabase.auth.updateUser({
      password: parsed.data.password,
      data: sanitizedAuthUserMetadata(false),
    });
    if (authError) {
      await removePasswordRecord(admin, historyRecordId);
      throw new SecurityError("PASSWORD_UPDATE_FAILED", 400, "비밀번호를 변경하지 못했습니다.");
    }

    try {
      const { error: profileUpdateError } = await admin.from("profiles").update({
        must_change_password: false,
        temporary_password_expires_at: null,
        password_changed_at: new Date().toISOString(),
        session_version: nextVersion,
      }).eq("id", user.id);
      if (profileUpdateError) throw profileUpdateError;
      const { data: authData } = await admin.auth.admin.getUserById(user.id);
      if (authData.user) {
        await admin.auth.admin.updateUserById(user.id, {
          app_metadata: { ...authData.user.app_metadata, session_version: nextVersion },
          user_metadata: sanitizedAuthUserMetadata(false),
        });
      }
      await startAppSession(user.id, nextVersion);
      try { await prunePasswordHistory(admin, user.id); }
      catch (historyError) { console.error("[password-history-prune]", historyError); }
    } catch (updateError) {
      await admin.from("profiles").update({ must_change_password: true }).eq("id", user.id);
      throw updateError;
    }

    await writeAuditLog({ request, action: "auth.password_change", actorId: user.id, targetUserId: user.id, success: true });
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) {
    await writeAuditLog({ request, action: "auth.password_change", actorId, targetUserId: actorId, success: false });
    return authErrorResponse(error);
  }
}
