import { requireUserManager, authErrorResponse, canManageUser } from "@/lib/auth/guards";
import { DEPARTMENTS } from "@/lib/constants";
import { createAdminClient } from "@/lib/supabase/admin";
import type { CalendarEvent, EventChangeRequest } from "@/types";

export async function GET() {
  try {
    const { profile } = await requireUserManager();
    const admin = createAdminClient();

    const allowedDepartments = profile.role === "admin"
      ? [...DEPARTMENTS]
      : DEPARTMENTS.filter((department) => department === profile.department);

    if (allowedDepartments.length === 0) {
      return Response.json({ error: "소속 부서가 올바르게 설정되지 않았습니다." }, { status: 403 });
    }

    const [{ data: eventData, error: eventError }, { data: requestData, error: requestError }] = await Promise.all([
      admin
        .from("calendar_events")
        .select("*, profile:profiles!calendar_events_user_id_fkey(display_name,department,role)")
        .eq("status", "pending")
        .order("created_at", { ascending: false }),
      admin
        .from("event_change_requests")
        .select("*, event:calendar_events!event_change_requests_event_id_fkey(*, profile:profiles!calendar_events_user_id_fkey(display_name,department,role)), requester:profiles!event_change_requests_requester_id_fkey(display_name,department,role)")
        .eq("status", "pending")
        .order("created_at", { ascending: false }),
    ]);

    if (eventError) return Response.json({ error: eventError.message }, { status: 400 });
    if (requestError) return Response.json({ error: requestError.message }, { status: 400 });

    const events = ((eventData ?? []) as CalendarEvent[]).filter((event) =>
      Boolean(event.profile && canManageUser(profile, event.profile)),
    );
    const requests = ((requestData ?? []) as EventChangeRequest[]).filter((changeRequest) => {
      const targetProfile = changeRequest.event?.profile ?? changeRequest.requester;
      return Boolean(targetProfile && canManageUser(profile, targetProfile));
    });

    return Response.json({
      allowedDepartments,
      currentDepartment: profile.department,
      role: profile.role,
      events,
      requests,
    });
  } catch (error) {
    return authErrorResponse(error);
  }
}
