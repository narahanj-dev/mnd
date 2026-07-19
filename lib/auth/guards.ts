import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/types";
import { decryptProfile } from "@/lib/security/pii";
import { passwordExpired } from "@/lib/security/password-history";
import { createAdminClient } from "@/lib/supabase/admin";
import { assertAppSession } from "@/lib/security/session";
import { requireAal2 } from "@/lib/security/mfa";
import { SecurityError, safeErrorResponse } from "@/lib/security/errors";

export async function requireUser(options: { allowPasswordChangeRequired?: boolean; skipAppSession?: boolean } = {}) {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    throw new SecurityError("UNAUTHORIZED", 401, "로그인이 필요합니다.");
  }

  const { data: rawProfile, error: profileError } = await createAdminClient()
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single<Profile>();

  const profile = decryptProfile(rawProfile) as Profile | null;

  if (profileError || !profile || profile.account_status !== "active") {
    throw new SecurityError("FORBIDDEN", 403, "접근 권한이 없습니다.");
  }

  if (!options.skipAppSession) {
    await assertAppSession(user.id, profile.session_version ?? 1);
  }

  const needsPasswordChange = profile.must_change_password || passwordExpired(profile.password_changed_at);
  if (needsPasswordChange && !profile.must_change_password) {
    profile.must_change_password = true;
    await createAdminClient().from("profiles").update({ must_change_password: true }).eq("id", user.id);
  }
  if (needsPasswordChange && !options.allowPasswordChangeRequired) {
    throw new SecurityError("PASSWORD_CHANGE_REQUIRED", 428, "비밀번호를 먼저 변경해야 합니다.");
  }

  return { supabase, user, profile };
}

export async function requireAdmin() {
  const result = await requireUser();
  if (result.profile.role !== "admin") {
    throw new SecurityError("FORBIDDEN", 403, "접근 권한이 없습니다.");
  }
  await requireAal2(result.supabase);
  return result;
}

export async function requireUserManager(options: { requireMfa?: boolean } = {}) {
  const result = await requireUser();
  if (result.profile.role !== "admin" && result.profile.role !== "department_admin") {
    throw new SecurityError("FORBIDDEN", 403, "접근 권한이 없습니다.");
  }
  if (options.requireMfa !== false) await requireAal2(result.supabase);
  return result;
}

export function canManageUser(
  manager: Pick<Profile, "role" | "department">,
  target: Pick<Profile, "role" | "department">,
) {
  if (manager.role === "admin") return true;
  return (
    manager.role === "department_admin" &&
    manager.department === target.department &&
    target.role !== "admin"
  );
}

export function authErrorResponse(error: unknown) {
  return safeErrorResponse(error, "auth-guard");
}
