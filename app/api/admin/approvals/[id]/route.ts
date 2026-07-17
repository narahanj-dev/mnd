import { z } from "zod";
import { requireAdmin, authErrorResponse } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";

const schema = z.object({ decision: z.enum(["approve", "reject"]), reason: z.string().max(1000).optional() });
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { user, profile } = await requireAdmin(); const { id } = await context.params;
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success || (parsed.data.decision === "reject" && !parsed.data.reason?.trim())) return Response.json({ error: "거절 사유를 입력하세요." }, { status: 400 });
    const admin = createAdminClient();
    const { data: event } = await admin.from("calendar_events").select("*").eq("id", id).single();
    if (!event || event.status !== "pending") return Response.json({ error: "승인 대기 일정을 찾을 수 없습니다." }, { status: 404 });
    const approved = parsed.data.decision === "approve";
    const { error } = await admin.from("calendar_events").update({ status: approved ? "approved" : "rejected", rejection_reason: approved ? null : parsed.data.reason, approved_by: user.id, approved_at: new Date().toISOString() }).eq("id", id);
    if (error) return Response.json({ error: error.message }, { status: 400 });
    await admin.from("messages").insert({
      sender_id: user.id, recipient_id: event.user_id, related_event_id: event.id,
      title: approved ? "일정 승인 안내" : "일정 거절 안내",
      content: approved ? `등록한 일정 '${event.title}' (${event.start_date}~${event.end_date})이 승인되었습니다.` : `등록한 일정 '${event.title}' (${event.start_date}~${event.end_date})이 거절되었습니다.\n거절 사유: ${parsed.data.reason}\n처리 관리자: ${profile.display_name}`,
      message_type: approved ? "event_approved" : "event_rejected",
    });
    return Response.json({ ok: true });
  } catch (error) { return authErrorResponse(error); }
}
