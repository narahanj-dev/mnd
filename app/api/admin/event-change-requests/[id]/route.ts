import { z } from "zod";
import { requireUserManager, authErrorResponse, canManageUser } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatEventLabel } from "@/lib/constants";
import type { CalendarEvent, EventChangeRequest, Profile } from "@/types";
import { decryptCalendarEvent, decryptEventChange, encryptCalendarEventFields, encryptEventChangeFields, encryptMessageFields } from "@/lib/security/secure-fields";
import { assertSameOrigin, clientIp } from "@/lib/security/request";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { SecurityError } from "@/lib/security/errors";
import { writeAuditLog } from "@/lib/security/audit";

const schema = z.object({ decision: z.enum(["approve", "reject"]), reason: z.string().max(1000).optional() });
type TargetProfile = Pick<Profile, "role" | "department">;

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  let actorId: string | null = null;
  let resourceId: string | null = null;
  try {
    assertSameOrigin(request);
    const { user, profile } = await requireUserManager();
    actorId = user.id;
    await enforceRateLimit({ purpose: "event-change-approval", identity: `${user.id}:${clientIp(request)}`, limit: 50, windowSeconds: 600 });
    const { id } = await context.params;
    resourceId = id;
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success || (parsed.data.decision === "reject" && !parsed.data.reason?.trim())) throw new SecurityError("INVALID_INPUT", 400, "거절하는 경우 거절 사유를 입력하세요.");

    const admin = createAdminClient();
    const { data: rawRequest, error: requestLookupError } = await admin.from("event_change_requests")
      .select("*, event:calendar_events!event_change_requests_event_id_fkey(*, profile:profiles!calendar_events_user_id_fkey(role,department))")
      .eq("id", id).single();
    const changeRequest = decryptEventChange(rawRequest) as (EventChangeRequest & { event: CalendarEvent & { profile: TargetProfile } }) | null;
    if (requestLookupError || !changeRequest || changeRequest.status !== "pending" || !changeRequest.event) throw new SecurityError("NOT_FOUND", 404, "처리할 변경 요청을 찾을 수 없습니다.");
    changeRequest.event = decryptCalendarEvent(changeRequest.event);

    const targetProfile = changeRequest.event.profile as TargetProfile | null;
    if (!targetProfile || !canManageUser(profile, targetProfile)) throw new SecurityError("FORBIDDEN", 403, "소속 부서원의 일정만 처리할 수 있습니다.");

    const approved = parsed.data.decision === "approve";
    if (approved) {
      if (changeRequest.request_type === "delete") {
        const { error } = await admin.from("calendar_events").update({ status: "cancelled" }).eq("id", changeRequest.event_id);
        if (error) throw error;
      } else {
        const { error } = await admin.from("calendar_events").update(encryptCalendarEventFields({
          event_type: changeRequest.proposed_event_type, title: changeRequest.proposed_title,
          start_date: changeRequest.proposed_start_date, end_date: changeRequest.proposed_end_date,
          all_day: changeRequest.proposed_all_day, start_time: changeRequest.proposed_all_day ? null : changeRequest.proposed_start_time,
          end_time: changeRequest.proposed_all_day ? null : changeRequest.proposed_end_time,
          description: changeRequest.proposed_description, public_note: changeRequest.proposed_public_note,
          admin_note: changeRequest.proposed_admin_note,
        })).eq("id", changeRequest.event_id);
        if (error) throw error;
      }
    }

    const { error: requestError } = await admin.from("event_change_requests").update(encryptEventChangeFields({
      status: approved ? "approved" : "rejected",
      rejection_reason: approved ? null : parsed.data.reason,
      processed_by: user.id,
      processed_at: new Date().toISOString(),
    })).eq("id", id).eq("status", "pending");
    if (requestError) throw requestError;

    const requestLabel = changeRequest.request_type === "update" ? "수정" : "삭제";
    const resultLabel = approved ? "승인" : "거절";
    const content = approved
      ? `일정 '${formatEventLabel(changeRequest.event.event_type, changeRequest.event.title)}'의 ${requestLabel} 요청이 승인되었습니다.`
      : `일정 '${formatEventLabel(changeRequest.event.event_type, changeRequest.event.title)}'의 ${requestLabel} 요청이 거절되었습니다. 기존 일정은 그대로 유지됩니다.\n거절 사유: ${parsed.data.reason}`;
    await admin.from("messages").insert(encryptMessageFields({
      sender_id: user.id, recipient_id: changeRequest.requester_id, related_event_id: changeRequest.event_id,
      title: `일정 ${requestLabel} 요청 ${resultLabel} 안내`, content,
      message_type: approved ? "event_change_approved" : "event_change_rejected",
    }));

    await writeAuditLog({ request, action: approved ? "event_change.approve" : "event_change.reject", actorId: user.id, targetUserId: changeRequest.requester_id, targetResourceId: id, success: true });
    return Response.json({ ok: true });
  } catch (error) {
    await writeAuditLog({ request, action: "event_change.decision", actorId, targetResourceId: resourceId, success: false });
    return authErrorResponse(error);
  }
}
