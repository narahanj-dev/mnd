import { CalendarBoard } from "@/components/calendar/CalendarBoard";
import { requireUser } from "@/lib/auth/guards";

export default async function CalendarPage() {
  const { profile } = await requireUser({ allowPasswordChangeRequired: true });
  return <CalendarBoard profile={profile} />;
}
