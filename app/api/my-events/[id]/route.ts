import { authErrorResponse, canManageUser, requireUser } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { decryptProfile } from "@/lib/security/pii";
import { decryptCalendarEvents, decryptEventChanges } from "@/lib/security/secure-fields";
import { requireAal2 } from "@/lib/security/mfa";
import type { CalendarEvent, EventChangeRequest, Profile, UsageUserSummary } from "@/types";

const MY_EVENT_TYPES = ["leave", "overnight", "weekend_outing", "weekday_outing"] as const;

type TargetProfile = Pick<
  Profile,
  "id" | "login_id" | "display_name" | "department" | "role" | "account_status"
>;

function monthRange(year: number, month: number) {
  const start = `${year}-${String(month).padStart(2, "0")}-01`;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const end = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  return { start, end };
}

function overlaps(startDate: string | null, endDate: string | null, start: string, end: string) {
  return Boolean(startDate && endDate && startDate <= end && endDate >= start);
}

function canViewTarget(
  viewer: Pick<Profile, "id" | "role" | "department">,
  target: Pick<Profile, "id" | "role" | "department">,
) {
  if (viewer.role === "user") return viewer.id === target.id;
  return canManageUser(viewer, target);
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { user, profile, supabase } = await requireUser();
    if (profile.role !== "user") await requireAal2(supabase);
    const { id } = await context.params;
    const url = new URL(request.url);
    const year = Number(url.searchParams.get("year"));
    const month = Number(url.searchParams.get("month"));

    if (!Number.isInteger(year) || year < 2000 || year > 2100 || !Number.isInteger(month) || month < 1 || month > 12) {
      return Response.json({ error: "조회할 연도와 월을 확인하세요." }, { status: 400 });
    }

    const admin = createAdminClient();
    const { data: rawTarget, error: targetError } = await admin
      .from("profiles")
      .select("id,login_id,display_name,department,role,account_status")
      .eq("id", id)
      .maybeSingle();
    const target = decryptProfile(rawTarget) as TargetProfile | null;

    if (targetError) throw targetError;
    if (!target || target.account_status !== "active") {
      return Response.json({ error: "사용자를 찾을 수 없습니다." }, { status: 404 });
    }

    if (!canViewTarget({ id: user.id, role: profile.role, department: profile.department }, target)) {
      return Response.json({ error: "이 사용자의 일정을 볼 권한이 없습니다." }, { status: 403 });
    }

    const { start, end } = monthRange(year, month);
    const { data: eventRows, error: eventError } = await admin
      .from("calendar_events")
      .select("*")
      .eq("user_id", target.id)
      .in("event_type", [...MY_EVENT_TYPES])
      .order("start_date", { ascending: false })
      .returns<CalendarEvent[]>();

    if (eventError) throw eventError;

    const allEvents = decryptCalendarEvents(eventRows ?? []);
    const eventIds = allEvents.map((event) => event.id);
    let allRequests: EventChangeRequest[] = [];

    if (eventIds.length > 0) {
      const { data: requestRows, error: requestError } = await admin
        .from("event_change_requests")
        .select("*")
        .in("event_id", eventIds)
        .order("created_at", { ascending: false })
        .returns<EventChangeRequest[]>();

      if (requestError) throw requestError;
      allRequests = decryptEventChanges(requestRows ?? []);
    }

    const requestsByEvent = new Map<string, EventChangeRequest[]>();
    allRequests.forEach((changeRequest) => {
      const list = requestsByEvent.get(changeRequest.event_id) ?? [];
      list.push(changeRequest);
      requestsByEvent.set(changeRequest.event_id, list);
    });

    const events = allEvents.filter((event) => {
      if (overlaps(event.start_date, event.end_date, start, end)) return true;
      return (requestsByEvent.get(event.id) ?? []).some((changeRequest) =>
        overlaps(changeRequest.proposed_start_date, changeRequest.proposed_end_date, start, end),
      );
    });
    const visibleEventIds = new Set(events.map((event) => event.id));
    const requests = allRequests.filter((changeRequest) => visibleEventIds.has(changeRequest.event_id));

    const responseUser: UsageUserSummary = {
      id: target.id,
      login_id: target.login_id,
      display_name: target.display_name,
      department: target.department,
      role: target.role,
    };

    const safeEvents = events.map((event) => {
      if (profile.role !== "user") return event;
      const safeEvent: Record<string, unknown> = { ...event };
      delete safeEvent.admin_note;
      delete safeEvent.approved_by;
      return safeEvent;
    });
    const safeRequests = requests.map((changeRequest) => {
      if (profile.role !== "user") return changeRequest;
      const safeRequest: Record<string, unknown> = { ...changeRequest };
      delete safeRequest.proposed_admin_note;
      delete safeRequest.processed_by;
      return safeRequest;
    });

    return Response.json({
      user: responseUser,
      viewerId: user.id,
      viewerRole: profile.role,
      year,
      month,
      events: safeEvents,
      requests: safeRequests,
    });
  } catch (error) {
    return authErrorResponse(error);
  }
}
