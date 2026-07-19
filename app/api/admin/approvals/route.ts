import { requireUserManager, authErrorResponse, canManageUser } from "@/lib/auth/guards";
import { DEPARTMENTS } from "@/lib/constants";
import { createAdminClient } from "@/lib/supabase/admin";
import type { CalendarEvent, EventChangeRequest, Profile } from "@/types";
import { decryptProfileRelation } from "@/lib/security/pii";
import { decryptCalendarEvent, decryptEventChange } from "@/lib/security/secure-fields";

type ManagedProfile = Pick<Profile, "id" | "department" | "role">;

type DepartmentSummary = {
  name: string;
  pendingCount: number;
};

export async function GET(request: Request) {
  try {
    const { profile } = await requireUserManager();
    const admin = createAdminClient();
    const requestedDepartment = new URL(request.url).searchParams.get("department")?.trim() || null;

    const allowedDepartments = profile.role === "admin"
      ? [...DEPARTMENTS]
      : DEPARTMENTS.filter((department) => department === profile.department);

    if (allowedDepartments.length === 0) {
      return Response.json({ error: "소속 부서가 올바르게 설정되지 않았습니다." }, { status: 403 });
    }

    if (requestedDepartment && !allowedDepartments.includes(requestedDepartment as (typeof DEPARTMENTS)[number])) {
      return Response.json({ error: "해당 부서의 일정 승인 요청을 볼 수 없습니다." }, { status: 403 });
    }

    const { data: managedProfileData, error: profileError } = await admin
      .from("profiles")
      .select("id,department,role")
      .in("department", allowedDepartments);

    if (profileError) throw profileError;

    const managedProfiles = ((managedProfileData ?? []) as ManagedProfile[]).filter((target) =>
      canManageUser(profile, target),
    );
    const managedUserIds = managedProfiles.map((target) => target.id);

    const eventQuery = admin
      .from("calendar_events")
      .select("*, profile:profiles!calendar_events_user_id_fkey(display_name,department,role)")
      .eq("status", "pending")
      .order("created_at", { ascending: false });

    const [{ data: eventData, error: eventError }, { data: requestData, error: requestError }] = await Promise.all([
      managedUserIds.length > 0
        ? eventQuery.in("user_id", managedUserIds)
        : Promise.resolve({ data: [], error: null }),
      admin
        .from("event_change_requests")
        .select("*, event:calendar_events!event_change_requests_event_id_fkey(*, profile:profiles!calendar_events_user_id_fkey(display_name,department,role)), requester:profiles!event_change_requests_requester_id_fkey(display_name,department,role)")
        .eq("status", "pending")
        .order("created_at", { ascending: false }),
    ]);

    if (eventError) throw eventError;
    if (requestError) throw requestError;

    const events = ((eventData ?? []) as CalendarEvent[]).map((rawEvent) => { const event = decryptCalendarEvent(rawEvent); return ({
      ...event,
      profile: decryptProfileRelation(event.profile as Record<string, unknown> | Record<string, unknown>[] | null),
    }); }) as CalendarEvent[];
    const requests = ((requestData ?? []) as EventChangeRequest[]).map((rawChangeRequest) => { const changeRequest = decryptEventChange(rawChangeRequest);
      const event = changeRequest.event ? {
        ...decryptCalendarEvent(changeRequest.event),
        profile: decryptProfileRelation(changeRequest.event.profile as Record<string, unknown> | Record<string, unknown>[] | null),
      } : undefined;
      return {
        ...changeRequest,
        event,
        requester: decryptProfileRelation(changeRequest.requester as Record<string, unknown> | Record<string, unknown>[] | null),
      } as EventChangeRequest;
    }).filter((changeRequest) => {
      const targetProfile = changeRequest.event?.profile ?? changeRequest.requester;
      return Boolean(targetProfile && canManageUser(profile, targetProfile));
    });

    const counts = new Map<string, number>(allowedDepartments.map((department) => [department, 0]));
    events.forEach((event) => {
      const department = event.profile?.department;
      if (department && counts.has(department)) counts.set(department, (counts.get(department) ?? 0) + 1);
    });
    requests.forEach((changeRequest) => {
      const department = changeRequest.event?.profile?.department ?? changeRequest.requester?.department;
      if (department && counts.has(department)) counts.set(department, (counts.get(department) ?? 0) + 1);
    });

    const departments: DepartmentSummary[] = allowedDepartments.map((department) => ({
      name: department,
      pendingCount: counts.get(department) ?? 0,
    }));

    return Response.json({
      departments,
      selectedDepartment: requestedDepartment,
      role: profile.role,
      events: requestedDepartment
        ? events.filter((event) => event.profile?.department === requestedDepartment)
        : [],
      requests: requestedDepartment
        ? requests.filter((changeRequest) =>
            (changeRequest.event?.profile?.department ?? changeRequest.requester?.department) === requestedDepartment,
          )
        : [],
    });
  } catch (error) {
    return authErrorResponse(error);
  }
}
