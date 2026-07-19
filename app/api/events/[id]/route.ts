import { z } from "zod";
import { requireUser, authErrorResponse } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { EVENT_TYPE_VALUES, formatEventLabel, isValidEventTitle } from "@/lib/constants";
import type { EventType } from "@/types";
import { decryptCalendarEvent, encryptCalendarEventFields, encryptEventChangeFields, encryptMessageFields } from "@/lib/security/secure-fields";
import { assertSameOrigin, clientIp, readJsonBody } from "@/lib/security/request";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { SecurityError } from "@/lib/security/errors";
import { requireAal2 } from "@/lib/security/mfa";
import { beginPrivilegedAudit, completePrivilegedAudit, writeAuditLog, writeAuditLogBestEffort } from "@/lib/security/audit";
import { assertEventDuration } from "@/lib/security/date-limits";

const schema = z.object({
  action: z.enum(["update", "delete"]), reason: z.string().trim().min(1).max(1000),
  eventType: z.enum(EVENT_TYPE_VALUES).optional(), title: z.string().min(1).max(100).optional(),
  startDate: z.string().date().optional(), endDate: z.string().date().optional(), allDay: z.boolean().optional(),
  startTime: z.string().nullable().optional(), endTime: z.string().nullable().optional(),
  description: z.string().max(2000).nullable().optional(), publicNote: z.string().max(500).nullable().optional(), adminNote: z.string().max(500).nullable().optional(),
});

type EventRow = {
  id: string; user_id: string; event_type: EventType; title: string; start_date: string; end_date: string;
  all_day: boolean; start_time: string | null; end_time: string | null; description: string | null;
  public_note: string | null; admin_note: string | null; status: string;
};

function buildUpdate(current: EventRow, value: z.infer<typeof schema>, canSetAdminNote: boolean) {
  const allDay = value.allDay ?? current.all_day;
  return {
    event_type: value.eventType ?? current.event_type, title: value.title?.trim() ?? current.title,
    start_date: value.startDate ?? current.start_date, end_date: value.endDate ?? current.end_date,
    all_day: allDay, start_time: allDay ? null : value.startTime ?? current.start_time,
    end_time: allDay ? null : value.endTime ?? current.end_time, description: value.description ?? current.description,
    public_note: value.publicNote ?? current.public_note,
    admin_note: canSetAdminNote ? value.adminNote ?? current.admin_note : current.admin_note,
  };
}

function validateUpdate(update: ReturnType<typeof buildUpdate>) {
  if (!isValidEventTitle(update.event_type, update.title)) return "선택한 표시 항목의 종류를 확인하세요.";
  try { assertEventDuration(update.start_date, update.end_date); } catch (error) { return error instanceof SecurityError ? error.publicMessage : "일정 기간을 확인하세요."; }
  if (!update.all_day && (!update.start_time || !update.end_time || update.end_time <= update.start_time)) return "시간 일정을 올바르게 입력하세요.";
  return null;
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  let actorId: string | null = null;
  let resourceId: string | null = null;
  let privilegedAuditId: string | null = null;
  try {
    assertSameOrigin(request);
    const { user, profile, supabase } = await requireUser();
    actorId = user.id;
    if (profile.role !== "user") await requireAal2(supabase);
    await enforceRateLimit({ purpose: "event-change", identity: `${user.id}:${clientIp(request)}`, limit: 30, windowSeconds: 600 });
    const { id } = await context.params;
    resourceId = id;
    const parsed = schema.safeParse(await readJsonBody(request));
    if (!parsed.success) throw new SecurityError("INVALID_INPUT", 400, "수정·삭제 사유와 요청 내용을 확인하세요.");

    const admin = createAdminClient();
    const { data: rawCurrent, error: currentError } = await admin.from("calendar_events").select("*").eq("id", id).single<EventRow>();
    if (currentError || !rawCurrent) throw new SecurityError("NOT_FOUND", 404, "일정을 찾을 수 없습니다.");
    const current = decryptCalendarEvent(rawCurrent);
    const own = current.user_id === user.id;
    if (!own && profile.role !== "admin") throw new SecurityError("FORBIDDEN", 403, "본인이 등록한 일정만 요청할 수 있습니다.");
    if (["cancelled", "rejected"].includes(current.status)) throw new SecurityError("CLOSED_EVENT", 400, "이미 종료된 일정은 수정하거나 삭제할 수 없습니다.");

    if (profile.role === "admin") {
      if (parsed.data.action === "delete") {
        privilegedAuditId = await beginPrivilegedAudit({
          request, action: "event.admin_delete", actorId: user.id,
          targetUserId: current.user_id, targetResourceId: id,
        });
        const { error } = await admin.from("calendar_events").update({ status: "cancelled" }).eq("id", id);
        if (error) throw error;
        await admin.from("messages").insert(encryptMessageFields({
          sender_id: user.id, recipient_id: current.user_id, related_event_id: current.id,
          title: "관리자 일정 삭제 안내",
          content: `관리자가 일정 '${formatEventLabel(current.event_type, current.title)}' (${current.start_date}~${current.end_date})을 삭제했습니다.\n처리 사유: ${parsed.data.reason}`,
          message_type: "event_admin_deleted",
        }));
        await completePrivilegedAudit(privilegedAuditId, true);
        return Response.json({ ok: true, message: "일정이 삭제되었으며 사용자에게 사유를 전송했습니다." });
      }

      const update = buildUpdate(current, parsed.data, true);
      const validationError = validateUpdate(update);
      if (validationError) throw new SecurityError("INVALID_EVENT", 400, validationError);
      privilegedAuditId = await beginPrivilegedAudit({
        request, action: "event.admin_update", actorId: user.id,
        targetUserId: current.user_id, targetResourceId: id,
      });
      const { error } = await admin.from("calendar_events").update(encryptCalendarEventFields(update)).eq("id", id);
      if (error) throw error;
      await admin.from("messages").insert(encryptMessageFields({
        sender_id: user.id, recipient_id: current.user_id, related_event_id: current.id,
        title: "관리자 일정 수정 안내",
        content: `관리자가 일정 '${formatEventLabel(current.event_type, current.title)}'을 수정했습니다.\n변경 일정: '${formatEventLabel(update.event_type, update.title)}' (${update.start_date}~${update.end_date})\n처리 사유: ${parsed.data.reason}`,
        message_type: "event_admin_updated",
      }));
      await completePrivilegedAudit(privilegedAuditId, true);
      return Response.json({ ok: true, message: "일정이 수정되었으며 사용자에게 사유를 전송했습니다." });
    }

    if (current.status !== "approved") throw new SecurityError("NOT_APPROVED", 400, "승인 완료된 일정만 수정 또는 삭제를 요청할 수 있습니다.");
    const { data: pendingRequest } = await admin.from("event_change_requests").select("id").eq("event_id", id).eq("status", "pending").maybeSingle();
    if (pendingRequest) throw new SecurityError("DUPLICATE_REQUEST", 409, "이미 처리 대기 중인 수정 또는 삭제 요청이 있습니다.");

    const update = buildUpdate(current, parsed.data, false);
    if (parsed.data.action === "update") {
      const validationError = validateUpdate(update);
      if (validationError) throw new SecurityError("INVALID_EVENT", 400, validationError);
    }

    const { data: changeRequest, error: requestError } = await admin.from("event_change_requests").insert(encryptEventChangeFields({
      event_id: current.id, requester_id: user.id, request_type: parsed.data.action, reason: parsed.data.reason,
      proposed_event_type: parsed.data.action === "update" ? update.event_type : null,
      proposed_title: parsed.data.action === "update" ? update.title : null,
      proposed_start_date: parsed.data.action === "update" ? update.start_date : null,
      proposed_end_date: parsed.data.action === "update" ? update.end_date : null,
      proposed_all_day: parsed.data.action === "update" ? update.all_day : null,
      proposed_start_time: parsed.data.action === "update" ? update.start_time : null,
      proposed_end_time: parsed.data.action === "update" ? update.end_time : null,
      proposed_description: parsed.data.action === "update" ? update.description : null,
      proposed_public_note: parsed.data.action === "update" ? update.public_note : null,
      proposed_admin_note: null,
      status: "pending",
    })).select("id").single();
    if (requestError || !changeRequest) throw requestError ?? new Error("change request failed");

    const { data: managers } = await admin.from("profiles").select("id").in("role", ["admin", "department_admin"]).eq("account_status", "active").eq("department", profile.department);
    if (managers?.length) {
      const requestLabel = parsed.data.action === "update" ? "수정" : "삭제";
      await admin.from("messages").insert(managers.map((recipient) => encryptMessageFields({
        sender_id: user.id, recipient_id: recipient.id, related_event_id: current.id,
        title: `일정 ${requestLabel} 승인 요청`,
        content: `사용자가 일정 '${formatEventLabel(current.event_type, current.title)}' (${current.start_date}~${current.end_date})의 ${requestLabel}을 요청했습니다.\n요청 사유: ${parsed.data.reason}`,
        message_type: parsed.data.action === "update" ? "event_update_requested" : "event_delete_requested",
      })));
    }

    await writeAuditLog({ request, action: `event.${parsed.data.action}_request`, actorId: user.id, targetUserId: user.id, targetResourceId: id, success: true });
    return Response.json({
      ok: true, requestId: changeRequest.id,
      message: parsed.data.action === "update" ? "일정 수정 요청이 접수되었습니다. 관리자 승인 전까지 기존 일정이 유지됩니다." : "일정 삭제 요청이 접수되었습니다. 관리자 승인 전까지 달력에 일정이 유지됩니다.",
    });
  } catch (error) {
    if (privilegedAuditId) await completePrivilegedAudit(privilegedAuditId, false);
    else await writeAuditLogBestEffort({ request, action: "event.change", actorId, targetResourceId: resourceId, success: false });
    return authErrorResponse(error);
  }
}
