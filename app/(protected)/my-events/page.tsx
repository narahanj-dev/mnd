import { redirect } from "next/navigation";
import { MyEventsList } from "@/components/calendar/MyEventsList";
import { requireUser } from "@/lib/auth/guards";

export default async function MyEventsPage() {
  const { user, profile } = await requireUser();
  if (profile.role === "user") redirect(`/my-events/${user.id}`);
  return <MyEventsList />;
}
