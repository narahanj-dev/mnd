import { z } from "zod";
import { requireAdmin, authErrorResponse } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";

const schema = z.object({
  decision: z.enum(["approve", "reject"]),
  reason: z.string().max(1000).optional(),
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { user, profile } = await requireAdmin();
    const { id } = await context.params;
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success || (parsed.data.decision === "reject" && !parsed.data.reason?.trim())) {
      return Response.json({ error: "거절하는 경우 거절 사유를 입력하세요." }, { status: 400 });
    }

    const admin = createAdminClient();
    const { data: changeRequest } = await admin.from("event_change_requests").select("*, event:calendar_events!event_change_requests_event_id_fkey(*)").eq("id", id).single();
    if (!changeRequest || changeRequest.status !== "pending" || !changeRequest.event) {
      return Response.json({ error: "처리할 변경 요청을 찾을 수 없습니다." }, { status: 404 });
    }

    const approved = parsed.data.decision === "approve";
    if (approved) {
      if (changeRequest.request_type === "delete") {
        const { error } = await admin.from("calendar_events").update({ status: "cancelled" }).eq("id", changeRequest.event_id);
        if (error) return Response.json({ error: error.message }, { status: 400 });
      } else {
        const { error } = await admin.from("calendar_events").update({
          event_type: changeRequest.proposed_event_type,
          title: changeRequest.proposed_title,
          start_date: changeRequest.proposed_start_date,
          end_date: changeRequest.proposed_end_date,
          all_day: changeRequest.proposed_all_day,
          start_time: changeRequest.proposed_all_day ? null : changeRequest.proposed_start_time,
          end_time: changeRequest.proposed_all_day ? null : changeRequest.proposed_end_time,
          description: changeRequest.proposed_description,
          public_note: changeRequest.proposed_public_note,
          admin_note: changeRequest.proposed_admin_note,
        }).eq("id", changeRequest.event_id);
        if (error) return Response.json({ error: error.message }, { status: 400 });
      }
    }

    const { error: requestError } = await admin.from("event_change_requests").update({
      status: approved ? "approved" : "rejected",
      rejection_reason: approved ? null : parsed.data.reason,
      processed_by: user.id,
      processed_at: new Date().toISOString(),
    }).eq("id", id);
    if (requestError) return Response.json({ error: requestError.message }, { status: 400 });

    const requestLabel = changeRequest.request_type === "update" ? "수정" : "삭제";
    const resultLabel = approved ? "승인" : "거절";
    const content = approved
      ? `일정 '${changeRequest.event.title}'의 ${requestLabel} 요청이 승인되었습니다.\n처리 관리자: ${profile.display_name}`
      : `일정 '${changeRequest.event.title}'의 ${requestLabel} 요청이 거절되었습니다. 기존 일정은 그대로 유지됩니다.\n거절 사유: ${parsed.data.reason}\n처리 관리자: ${profile.display_name}`;
    const { error: messageError } = await admin.from("messages").insert({
      sender_id: user.id,
      recipient_id: changeRequest.requester_id,
      related_event_id: changeRequest.event_id,
      title: `일정 ${requestLabel} 요청 ${resultLabel} 안내`,
      content,
      message_type: approved ? "event_change_approved" : "event_change_rejected",
    });
    if (messageError) return Response.json({ error: messageError.message }, { status: 400 });

    return Response.json({ ok: true });
  } catch (error) { return authErrorResponse(error); }
}
