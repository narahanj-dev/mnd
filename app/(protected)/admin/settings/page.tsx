import { AdminSettingsForm } from "@/components/admin/AdminSettingsForm";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/types";
import { redirect } from "next/navigation";

export default async function SettingsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single<Profile>();

  if (!profile || profile.role !== "admin" || profile.account_status !== "active") {
    redirect("/calendar");
  }

  return <AdminSettingsForm profile={profile} />;
}
