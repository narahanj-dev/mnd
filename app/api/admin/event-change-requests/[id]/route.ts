import { z } from "zod";
import { requireUserManager, authErrorResponse, canManageUser } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatEventLabel } from "@/lib/constants";
import type { CalendarEvent, EventChangeRequest, Profile } from "@/types";
import { decryptCalendarEvent, decryptEventChange, encryptCalendarEventFields, encryptEventChangeFields, encryptMessageFields } from "@/lib/security/secure-fields";
import { assertSameOrigin, clientIp } from "@/lib/security/request";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { SecurityError } from "@/lib/security/errors";
import { auditLogValues, writeAuditLogBestEffort } from "@/lib/security/audit";

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
    if (!parsed.success || (parsed.data.decision === "reject" && !parsed.data.reason?.trim())) {
      throw new SecurityError("INVALID_INPUT", 400, "거절하는 경우 거절 사유를 입력하세요.");
    }

    const admin = createAdminClient();
    const { data: rawRequest, error: requestLookupError } = await admin
      .from("event_change_requests")
      .select("*, event:calendar_events!event_change_requests_event_id_fkey(*, profile:profiles!calendar_events_user_id_fkey(role,department))")
      .eq("id", id)
      .maybeSingle();
    if (requestLookupError) throw requestLookupError;
    if (!rawRequest) throw new SecurityError("NOT_FOUND", 404, "처리할 변경 요청을 찾을 수 없습니다.");

    const changeRequest = decryptEventChange(rawRequest) as EventChangeRequest & {
      event: CalendarEvent & { profile: TargetProfile };
    };
    if (!changeRequest.event) throw new SecurityError("NOT_FOUND", 404, "연결된 일정을 찾을 수 없습니다.");
    changeRequest.event = decryptCalendarEvent(changeRequest.event);

    if (changeRequest.event.user_id === user.id || changeRequest.requester_id === user.id) {
      throw new SecurityError("SELF_APPROVAL_FORBIDDEN", 403, "본인이 신청한 일정 변경은 직접 승인할 수 없습니다.");
    }

    const targetProfile = changeRequest.event.profile as TargetProfile | null;
    if (!targetProfile || !canManageUser(profile, targetProfile)) {
      throw new SecurityError("FORBIDDEN", 403, "소속 부서원의 일정만 처리할 수 있습니다.");
    }

    const approved = parsed.data.decision === "approve";
    const encryptedUpdate = encryptCalendarEventFields({
      title: changeRequest.proposed_title,
      description: changeRequest.proposed_description,
      public_note: changeRequest.proposed_public_note,
      admin_note: changeRequest.proposed_admin_note,
    });
    const encryptedRequestDecision = encryptEventChangeFields({
      rejection_reason: approved ? null : parsed.data.reason?.trim() || null,
    });

    const requestLabel = changeRequest.request_type === "update" ? "수정" : "삭제";
    const resultLabel = approved ? "승인" : "거절";
    const message = encryptMessageFields({
      title: `일정 ${requestLabel} 요청 ${resultLabel} 안내`,
      content: approved
        ? `일정 '${formatEventLabel(changeRequest.event.event_type, changeRequest.event.title)}'의 ${requestLabel} 요청이 승인되었습니다.`
        : `일정 '${formatEventLabel(changeRequest.event.event_type, changeRequest.event.title)}'의 ${requestLabel} 요청이 거절되었습니다. 기존 일정은 그대로 유지됩니다.\n거절 사유: ${parsed.data.reason?.trim()}`,
    });
    const audit = auditLogValues(request);

    const { data, error } = await admin.rpc("decide_event_change_atomic", {
      p_request_id: id,
      p_actor_id: user.id,
      p_decision: parsed.data.decision,
      p_rejection_reason: encryptedRequestDecision.rejection_reason,
      p_event_type: approved && changeRequest.request_type === "update" ? changeRequest.proposed_event_type : null,
      p_title: approved && changeRequest.request_type === "update" ? encryptedUpdate.title : null,
      p_start_date: approved && changeRequest.request_type === "update" ? changeRequest.proposed_start_date : null,
      p_end_date: approved && changeRequest.request_type === "update" ? changeRequest.proposed_end_date : null,
      p_all_day: approved && changeRequest.request_type === "update" ? changeRequest.proposed_all_day : null,
      p_start_time: approved && changeRequest.request_type === "update" ? changeRequest.proposed_start_time : null,
      p_end_time: approved && changeRequest.request_type === "update" ? changeRequest.proposed_end_time : null,
      p_description: approved && changeRequest.request_type === "update" ? encryptedUpdate.description : null,
      p_public_note: approved && changeRequest.request_type === "update" ? encryptedUpdate.public_note : null,
      p_admin_note: approved && changeRequest.request_type === "update" ? encryptedUpdate.admin_note : null,
      p_message_title: message.title,
      p_message_content: message.content,
      p_message_type: approved ? "event_change_approved" : "event_change_rejected",
      p_audit_action: approved ? "event_change.approve" : "event_change.reject",
      p_ip_hash: audit.ipHash,
      p_user_agent: audit.userAgent,
    });
    if (error?.code === "42501") throw new SecurityError("FORBIDDEN", 403, "소속 부서원의 일정만 처리할 수 있습니다.");
    if (error) throw error;
    const result = Array.isArray(data) ? data[0] : data;
    if (!result?.processed) {
      throw new SecurityError("ALREADY_PROCESSED", 409, "이미 다른 관리자가 처리했거나 현재 일정 상태에서 처리할 수 없습니다.");
    }

    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) {
    await writeAuditLogBestEffort({ request, action: "event_change.decision", actorId, targetResourceId: resourceId, success: false });
    return authErrorResponse(error);
  }
}
