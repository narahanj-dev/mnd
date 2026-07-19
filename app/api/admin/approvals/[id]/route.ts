import { z } from "zod";
import { requireUserManager, authErrorResponse, canManageUser } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatEventLabel } from "@/lib/constants";
import type { Profile } from "@/types";
import { decryptCalendarEvent, encryptCalendarEventFields, encryptMessageFields } from "@/lib/security/secure-fields";
import { assertSameOrigin, clientIp, readJsonBody } from "@/lib/security/request";
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
    await enforceRateLimit({ purpose: "event-approval", identity: `${user.id}:${clientIp(request)}`, limit: 50, windowSeconds: 600 });
    const { id } = await context.params;
    resourceId = id;
    const parsed = schema.safeParse(await readJsonBody(request));
    if (!parsed.success || (parsed.data.decision === "reject" && !parsed.data.reason?.trim())) {
      throw new SecurityError("INVALID_INPUT", 400, "거절 사유를 입력하세요.");
    }

    const admin = createAdminClient();
    const { data: rawEvent, error: eventError } = await admin
      .from("calendar_events")
      .select("*, profile:profiles!calendar_events_user_id_fkey(role,department)")
      .eq("id", id)
      .maybeSingle();
    const event = decryptCalendarEvent(rawEvent);
    if (eventError) throw eventError;
    if (!event) throw new SecurityError("NOT_FOUND", 404, "승인할 일정을 찾을 수 없습니다.");

    if (event.user_id === user.id) {
      throw new SecurityError("SELF_APPROVAL_FORBIDDEN", 403, "본인이 신청한 일정은 직접 승인할 수 없습니다.");
    }

    const targetProfile = event.profile as TargetProfile | null;
    if (!targetProfile || !canManageUser(profile, targetProfile)) {
      throw new SecurityError("FORBIDDEN", 403, "소속 부서원의 일정만 처리할 수 있습니다.");
    }

    const approved = parsed.data.decision === "approve";
    const encryptedDecision = encryptCalendarEventFields({
      rejection_reason: approved ? null : parsed.data.reason?.trim() || null,
    });
    const message = encryptMessageFields({
      title: approved ? "일정 승인 안내" : "일정 거절 안내",
      content: approved
        ? `등록한 일정 '${formatEventLabel(event.event_type, event.title)}' (${event.start_date}~${event.end_date})이 승인되었습니다.`
        : `등록한 일정 '${formatEventLabel(event.event_type, event.title)}' (${event.start_date}~${event.end_date})이 거절되었습니다.\n거절 사유: ${parsed.data.reason?.trim()}`,
    });
    const audit = auditLogValues(request);

    const { data, error } = await admin.rpc("decide_calendar_event_atomic", {
      p_event_id: id,
      p_actor_id: user.id,
      p_decision: parsed.data.decision,
      p_rejection_reason: encryptedDecision.rejection_reason,
      p_message_title: message.title,
      p_message_content: message.content,
      p_message_type: approved ? "event_approved" : "event_rejected",
      p_audit_action: approved ? "event.approve" : "event.reject",
      p_ip_hash: audit.ipHash,
      p_user_agent: audit.userAgent,
    });
    if (error?.code === "42501") throw new SecurityError("FORBIDDEN", 403, "소속 부서원의 일정만 처리할 수 있습니다.");
    if (error) throw error;
    const result = Array.isArray(data) ? data[0] : data;
    if (!result?.processed) {
      throw new SecurityError("ALREADY_PROCESSED", 409, "이미 다른 관리자가 처리했거나 처리할 수 없는 일정입니다.");
    }

    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) {
    await writeAuditLogBestEffort({ request, action: "event.approval", actorId, targetResourceId: resourceId, success: false });
    return authErrorResponse(error);
  }
}
