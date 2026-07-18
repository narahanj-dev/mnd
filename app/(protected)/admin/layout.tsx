import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/types";
import { redirect } from "next/navigation";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, account_status")
    .eq("id", user.id)
    .single<Pick<Profile, "role" | "account_status">>();

  if (
    !profile ||
    profile.account_status !== "active" ||
    (profile.role !== "admin" && profile.role !== "department_admin")
  ) {
    redirect("/calendar");
  }

  return children;
}
