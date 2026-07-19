import { z } from "zod";
import { requireUserManager, authErrorResponse, canManageUser } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatEventLabel } from "@/lib/constants";
import type { Profile } from "@/types";
import { decryptCalendarEvent, encryptCalendarEventFields, encryptMessageFields } from "@/lib/security/secure-fields";
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
    await enforceRateLimit({ purpose: "event-approval", identity: `${user.id}:${clientIp(request)}`, limit: 50, windowSeconds: 600 });
    const { id } = await context.params;
    resourceId = id;
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success || (parsed.data.decision === "reject" && !parsed.data.reason?.trim())) throw new SecurityError("INVALID_INPUT", 400, "거절 사유를 입력하세요.");

    const admin = createAdminClient();
    const { data: rawEvent, error: eventError } = await admin.from("calendar_events")
      .select("*, profile:profiles!calendar_events_user_id_fkey(role,department)").eq("id", id).single();
    const event = decryptCalendarEvent(rawEvent);
    if (eventError || !event || event.status !== "pending") throw new SecurityError("NOT_FOUND", 404, "승인 대기 일정을 찾을 수 없습니다.");

    const targetProfile = event.profile as TargetProfile | null;
    if (!targetProfile || !canManageUser(profile, targetProfile)) throw new SecurityError("FORBIDDEN", 403, "소속 부서원의 일정만 처리할 수 있습니다.");

    const approved = parsed.data.decision === "approve";
    const { error } = await admin.from("calendar_events").update(encryptCalendarEventFields({
      status: approved ? "approved" : "rejected",
      rejection_reason: approved ? null : parsed.data.reason,
      approved_by: user.id,
      approved_at: new Date().toISOString(),
    })).eq("id", id).eq("status", "pending");
    if (error) throw error;

    await admin.from("messages").insert(encryptMessageFields({
      sender_id: user.id, recipient_id: event.user_id, related_event_id: event.id,
      title: approved ? "일정 승인 안내" : "일정 거절 안내",
      content: approved
        ? `등록한 일정 '${formatEventLabel(event.event_type, event.title)}' (${event.start_date}~${event.end_date})이 승인되었습니다.`
        : `등록한 일정 '${formatEventLabel(event.event_type, event.title)}' (${event.start_date}~${event.end_date})이 거절되었습니다.\n거절 사유: ${parsed.data.reason}`,
      message_type: approved ? "event_approved" : "event_rejected",
    }));

    await writeAuditLog({ request, action: approved ? "event.approve" : "event.reject", actorId: user.id, targetUserId: event.user_id, targetResourceId: id, success: true });
    return Response.json({ ok: true });
  } catch (error) {
    await writeAuditLog({ request, action: "event.approval", actorId, targetResourceId: resourceId, success: false });
    return authErrorResponse(error);
  }
}
