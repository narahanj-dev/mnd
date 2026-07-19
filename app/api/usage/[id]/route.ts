import { authErrorResponse, requireUser } from "@/lib/auth/guards";
import { EVENT_TYPE_LABELS } from "@/lib/constants";
import { createAdminClient } from "@/lib/supabase/admin";
import { decryptProfile } from "@/lib/security/pii";
import { decryptCalendarEvents } from "@/lib/security/secure-fields";
import { requireAal2 } from "@/lib/security/mfa";
import { MAX_EVENT_DURATION_DAYS, inclusiveDays } from "@/lib/security/date-limits";
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
  const dayCount = inclusiveDays(startDate, endDate);
  if (dayCount > MAX_EVENT_DURATION_DAYS) {
    throw new Error("허용 범위를 초과한 일정 데이터가 있습니다. 관리자에게 문의하세요.");
  }
  const start = new Date(`${startDate}T00:00:00Z`);
  return Array.from({ length: dayCount }, (_, index) =>
    new Date(start.getTime() + index * 86_400_000).toISOString().slice(0, 10),
  );
}

function canViewTarget(
  viewer: Pick<Profile, "id" | "role" | "department">,
  target: Pick<Profile, "id" | "department" | "role">,
) {
  if (viewer.role === "admin") return true;
  if (viewer.role === "department_admin") return viewer.department === target.department && target.role !== "admin";
  return viewer.id === target.id;
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { user, profile, supabase } = await requireUser();
    if (profile.role !== "user") await requireAal2(supabase);
    const { id } = await context.params;
    const admin = createAdminClient();

    const { data: rawTarget, error: targetError } = await admin
      .from("profiles")
      .select("id,login_id,display_name,department,role,account_status")
      .eq("id", id)
      .maybeSingle();
    const target = decryptProfile(rawTarget) as Pick<Profile, "id" | "login_id" | "display_name" | "department" | "role" | "account_status"> | null;

    if (targetError) throw targetError;
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

    if (eventError) throw eventError;

    const decryptedRows = decryptCalendarEvents(eventRows ?? []) as UsageEventRow[];
    const categories: UsageCategorySummary[] = USAGE_EVENT_TYPES.map((eventType) => {
      const events: UsageEventDetail[] = decryptedRows
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
