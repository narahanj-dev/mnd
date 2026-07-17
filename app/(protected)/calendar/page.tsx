import { CalendarBoard } from "@/components/calendar/CalendarBoard";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/types";

export default async function CalendarPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: profile } = await supabase.from("profiles").select("*").eq("id", user!.id).single<Profile>();
  return <CalendarBoard profile={profile!} />;
}
