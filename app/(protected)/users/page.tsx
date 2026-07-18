import { UserManagement } from "@/components/admin/UserManagement";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/types";
import { redirect } from "next/navigation";

export default async function UsersPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, account_status")
    .eq("id", user.id)
    .single<Pick<Profile, "role" | "account_status">>();

  if (!profile || profile.account_status !== "active") {
    redirect("/calendar");
  }

  return <UserManagement />;
}
