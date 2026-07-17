import { requireUser, authErrorResponse } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(request: Request) {
  try {
    const { user, profile } = await requireUser();
    const url = new URL(request.url);
    const status = url.searchParams.get("status");
    const admin = createAdminClient();
    let query = admin
      .from("event_change_requests")
      .select("*, event:calendar_events!event_change_requests_event_id_fkey(*, profile:profiles!calendar_events_user_id_fkey(display_name,department)), requester:profiles!event_change_requests_requester_id_fkey(display_name,department)")
      .order("created_at", { ascending: false });
    if (profile.role !== "admin") query = query.eq("requester_id", user.id);
    if (status === "pending" || status === "approved" || status === "rejected") query = query.eq("status", status);
    const { data, error } = await query;
    if (error) return Response.json({ error: error.message }, { status: 400 });
    return Response.json({ requests: data ?? [] });
  } catch (error) { return authErrorResponse(error); }
}
