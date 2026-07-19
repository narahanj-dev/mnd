import { requireUser, authErrorResponse } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { decryptProfileRelation } from "@/lib/security/pii";
import { decryptCalendarEvent, decryptEventChange } from "@/lib/security/secure-fields";

export async function GET(request: Request) {
  try {
    const { user, profile } = await requireUser();
    const url = new URL(request.url);
    const status = url.searchParams.get("status");
    const admin = createAdminClient();
    let query = admin.from("event_change_requests")
      .select("*, event:calendar_events!event_change_requests_event_id_fkey(*, profile:profiles!calendar_events_user_id_fkey(display_name,department)), requester:profiles!event_change_requests_requester_id_fkey(display_name,department)")
      .order("created_at", { ascending: false });
    if (profile.role !== "admin") query = query.eq("requester_id", user.id);
    if (status === "pending" || status === "approved" || status === "rejected") query = query.eq("status", status);
    const { data, error } = await query;
    if (error) throw error;
    const requests = (data ?? []).map((rawItem) => {
      const item = decryptEventChange(rawItem);
      const rawEventRelation = Array.isArray(item.event) ? item.event[0] : item.event;
      const eventRelation = rawEventRelation ? decryptCalendarEvent(rawEventRelation) : rawEventRelation;
      return {
        ...item,
        requester: decryptProfileRelation(item.requester as Record<string, unknown> | Record<string, unknown>[] | null),
        event: eventRelation ? { ...eventRelation, profile: decryptProfileRelation(eventRelation.profile as Record<string, unknown> | Record<string, unknown>[] | null) } : eventRelation,
      };
    });
    return Response.json({ requests });
  } catch (error) { return authErrorResponse(error); }
}
