import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireUser, authErrorResponse } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  ensurePasswordNotReused,
  recordPassword,
} from "@/lib/security/password-history";
import { validatePassword } from "@/lib/security/password-policy";
import { loginIdToAuthEmail } from "@/lib/security/pii";

const schema = z.object({
  currentPassword: z.string().max(100).optional(),
  password: z.string().min(1).max(100),
});

export async function POST(request: Request) {
  try {
    const { supabase, user, profile } = await requireUser({
      allowPasswordChangeRequired: true,
    });
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success)
      return Response.json(
        { error: "새 비밀번호를 확인하세요." },
        { status: 400 },
      );

    const policyError = validatePassword(parsed.data.password, {
      loginId: profile.login_id,
      displayName: profile.display_name,
    });
    if (policyError)
      return Response.json({ error: policyError }, { status: 400 });

    if (!profile.must_change_password) {
      const currentPassword = parsed.data.currentPassword?.trim();
      if (!currentPassword) {
        return Response.json(
          { error: "현재 비밀번호를 입력하세요." },
          { status: 400 },
        );
      }

      const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
      if (!url || !publishableKey) {
        return Response.json(
          { error: "비밀번호 확인 설정을 불러오지 못했습니다." },
          { status: 500 },
        );
      }

      const verifier = createSupabaseClient(url, publishableKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const { error: verifyError } = await verifier.auth.signInWithPassword({
        email: loginIdToAuthEmail(profile.login_id),
        password: currentPassword,
      });
      if (verifyError) {
        return Response.json(
          { error: "현재 비밀번호가 일치하지 않습니다." },
          { status: 400 },
        );
      }
    }

    const admin = createAdminClient();
    try {
      await ensurePasswordNotReused(admin, user.id, parsed.data.password);
    } catch (error) {
      return Response.json(
        {
          error:
            error instanceof Error
              ? error.message
              : "비밀번호 재사용 여부를 확인하지 못했습니다.",
        },
        { status: 400 },
      );
    }

    const { error } = await supabase.auth.updateUser({
      password: parsed.data.password,
    });
    if (error) return Response.json({ error: error.message }, { status: 400 });

    try {
      await recordPassword(admin, user.id, parsed.data.password);
      await admin
        .from("profiles")
        .update({
          must_change_password: false,
          password_changed_at: new Date().toISOString(),
        })
        .eq("id", user.id);
    } catch (historyError) {
      await admin
        .from("profiles")
        .update({ must_change_password: true })
        .eq("id", user.id);
      return Response.json(
        {
          error:
            historyError instanceof Error
              ? historyError.message
              : "비밀번호 이력을 저장하지 못했습니다.",
        },
        { status: 500 },
      );
    }

    return Response.json({ ok: true });
  } catch (error) {
    return authErrorResponse(error);
  }
}
