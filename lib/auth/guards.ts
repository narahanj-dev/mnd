import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/types";

export async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    throw new Error("UNAUTHORIZED");
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single<Profile>();

  if (profileError || !profile || profile.account_status !== "active") {
    throw new Error("FORBIDDEN");
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
  if (message === "FORBIDDEN") {
    return Response.json({ error: "접근 권한이 없습니다." }, { status: 403 });
  }
  return Response.json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
}
