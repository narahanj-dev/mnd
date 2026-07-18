import { redirect } from "next/navigation";
import { MyEventsList } from "@/components/calendar/MyEventsList";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/types";
import { decryptProfile } from "@/lib/security/pii";

export default async function MyEventsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: rawProfile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user!.id)
    .single();
  const profile = decryptProfile(rawProfile) as Profile | null;

  if (profile?.role === "user") {
    redirect(`/my-events/${user!.id}`);
  }

  return <MyEventsList />;
}
