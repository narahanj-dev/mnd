import { createAdminClient } from "@/lib/supabase/admin";
import { clientIp, keyedDigest, userAgent } from "@/lib/security/request";

export function auditLogValues(request: Request) {
  return {
    ipHash: keyedDigest("audit-ip", clientIp(request)),
    userAgent: userAgent(request),
  };
}

export async function writeAuditLog(options: {
  request: Request;
  action: string;
  actorId?: string | null;
  targetUserId?: string | null;
  targetResourceId?: string | null;
  success: boolean;
  metadata?: Record<string, unknown>;
}) {
  try {
    await createAdminClient().from("security_audit_logs").insert({
      actor_id: options.actorId ?? null,
      action: options.action,
      target_user_id: options.targetUserId ?? null,
      target_resource_id: options.targetResourceId ?? null,
      success: options.success,
      ip_hash: auditLogValues(options.request).ipHash,
      user_agent: auditLogValues(options.request).userAgent,
      metadata: options.metadata ?? {},
    });
  } catch (error) {
    console.error("[audit-log]", error);
  }
}
