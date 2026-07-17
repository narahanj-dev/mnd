import { authErrorResponse, requireUser } from "@/lib/auth/guards";
import { EVENT_TYPE_LABELS } from "@/lib/constants";
import { createAdminClient } from "@/lib/supabase/admin";
import type {
  EventType,
  Profile,
  UsageCategorySummary,
  UsageEventDetail,
  UsageEventType,
} from "@/types";

const USAGE_EVENT_TYPES: UsageEventType[] = [
  "leave",
  "overnight",
  "weekend_outing",
  "weekday_outing",
];

type UsageEventRow = Pick<
  UsageEventDetail,
  "id" | "event_type" | "title" | "start_date" | "end_date" | "description" | "public_note"
>;

function enumerateDates(startDate: string, endDate: string) {
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  const dates: string[] = [];

  for (let cursor = start; cursor <= end; cursor = new Date(cursor.getTime() + 86_400_000)) {
    dates.push(cursor.toISOString().slice(0, 10));
  }

  return dates;
}

function canViewTarget(
  viewer: Pick<Profile, "id" | "role" | "department">,
  target: Pick<Profile, "id" | "department">,
) {
  if (viewer.role === "admin") return true;
  if (viewer.role === "department_admin") return viewer.department === target.department;
  return viewer.id === target.id;
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { user, profile } = await requireUser();
    const { id } = await context.params;
    const admin = createAdminClient();

    const { data: target, error: targetError } = await admin
      .from("profiles")
      .select("id,login_id,display_name,department,role,account_status")
      .eq("id", id)
      .maybeSingle<Pick<Profile, "id" | "login_id" | "display_name" | "department" | "role" | "account_status">>();

    if (targetError) {
      return Response.json({ error: targetError.message }, { status: 400 });
    }
    if (!target || target.account_status !== "active") {
      return Response.json({ error: "사용자를 찾을 수 없습니다." }, { status: 404 });
    }

    if (!canViewTarget({ id: user.id, role: profile.role, department: profile.department }, target)) {
      return Response.json({ error: "이 사용자의 사용현황을 볼 권한이 없습니다." }, { status: 403 });
    }

    const { data: eventRows, error: eventError } = await admin
      .from("calendar_events")
      .select("id,event_type,title,start_date,end_date,description,public_note")
      .eq("user_id", target.id)
      .eq("status", "approved")
      .in("event_type", USAGE_EVENT_TYPES)
      .order("start_date", { ascending: false })
      .returns<UsageEventRow[]>();

    if (eventError) {
      return Response.json({ error: eventError.message }, { status: 400 });
    }

    const categories: UsageCategorySummary[] = USAGE_EVENT_TYPES.map((eventType) => {
      const events: UsageEventDetail[] = (eventRows ?? [])
        .filter((event) => event.event_type === eventType)
        .map((event) => ({
          ...event,
          event_type: event.event_type as UsageEventType,
          dates: enumerateDates(event.start_date, event.end_date),
        }));
      const usedDates = [...new Set(events.flatMap((event) => event.dates))].sort().reverse();

      return {
        eventType,
        label: EVENT_TYPE_LABELS[eventType as EventType],
        totalDays: usedDates.length,
        eventCount: events.length,
        usedDates,
        events,
      };
    });

    return Response.json({
      user: {
        id: target.id,
        login_id: target.login_id,
        display_name: target.display_name,
        department: target.department,
        role: target.role,
      },
      categories,
    });
  } catch (error) {
    return authErrorResponse(error);
  }
}
