import { Header } from "@/components/common/Header";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/types";
import { redirect } from "next/navigation";

export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("*").eq("id", user.id).single<Profile>();
  if (!profile || profile.account_status !== "active") redirect("/login");

  const [{ count: unreadCount }, { count: pendingEventCount }, { count: pendingChangeCount }] = await Promise.all([
    supabase.from("messages").select("id", { count: "exact", head: true }).eq("recipient_id", user.id).eq("is_read", false),
    profile.role === "admin"
      ? supabase.from("calendar_events").select("id", { count: "exact", head: true }).eq("status", "pending")
      : Promise.resolve({ count: 0 }),
    profile.role === "admin"
      ? supabase.from("event_change_requests").select("id", { count: "exact", head: true }).eq("status", "pending")
      : Promise.resolve({ count: 0 }),
  ]);
  const pendingCount = (pendingEventCount ?? 0) + (pendingChangeCount ?? 0);

  return (
    <div className="min-h-screen">
      <Header profile={profile} unreadCount={unreadCount ?? 0} pendingCount={pendingCount ?? 0} />
      <main className="mx-auto max-w-[1500px] px-4 py-6">{children}</main>
    </div>
  );
}
