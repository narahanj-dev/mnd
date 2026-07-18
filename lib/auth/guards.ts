import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/types";
import { decryptProfile } from "@/lib/security/pii";
import { passwordExpired } from "@/lib/security/password-history";
import { createAdminClient } from "@/lib/supabase/admin";

export async function requireUser(options: { allowPasswordChangeRequired?: boolean } = {}) {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    throw new Error("UNAUTHORIZED");
  }

  const { data: rawProfile, error: profileError } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single<Profile>();

  const profile = decryptProfile(rawProfile) as Profile | null;

  if (profileError || !profile || profile.account_status !== "active") {
    throw new Error("FORBIDDEN");
  }

  const needsPasswordChange = profile.must_change_password || passwordExpired(profile.password_changed_at);
  if (needsPasswordChange && !profile.must_change_password) {
    profile.must_change_password = true;
    await createAdminClient().from("profiles").update({ must_change_password: true }).eq("id", user.id);
  }
  if (needsPasswordChange && !options.allowPasswordChangeRequired) {
    throw new Error("PASSWORD_CHANGE_REQUIRED");
  }

  return { supabase, user, profile };
}

export async function requireAdmin() {
  const result = await requireUser();
  if (result.profile.role !== "admin") {
    throw new Error("FORBIDDEN");
  }
  return result;
}

export async function requireUserManager() {
  const result = await requireUser();
  if (result.profile.role !== "admin" && result.profile.role !== "department_admin") {
    throw new Error("FORBIDDEN");
  }
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
  const message = error instanceof Error ? error.message : "UNKNOWN";
  if (message === "UNAUTHORIZED") {
    return Response.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }
  if (message === "PASSWORD_CHANGE_REQUIRED") {
    return Response.json({ error: "비밀번호를 먼저 변경해야 합니다." }, { status: 428 });
  }
  if (message === "FORBIDDEN") {
    return Response.json({ error: "접근 권한이 없습니다." }, { status: 403 });
  }
  return Response.json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
}
