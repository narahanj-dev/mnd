import { CalendarBoard } from "@/components/calendar/CalendarBoard";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/types";
import { decryptProfile } from "@/lib/security/pii";

export default async function CalendarPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: rawProfile } = await supabase.from("profiles").select("*").eq("id", user!.id).single();
  const profile = decryptProfile(rawProfile) as Profile;
  return <CalendarBoard profile={profile} />;
}
