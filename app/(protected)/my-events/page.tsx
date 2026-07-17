import { MyEventsList } from "@/components/calendar/MyEventsList";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/types";
export default async function MyEventsPage() { const supabase = await createClient(); const { data: { user } } = await supabase.auth.getUser(); const { data: profile } = await supabase.from("profiles").select("*").eq("id", user!.id).single<Profile>(); return <MyEventsList userId={user!.id} isAdmin={profile?.role === "admin"} />; }
