import { createAdminClient } from "@/lib/supabase/admin";
import { clientIp, keyedDigest, userAgent } from "@/lib/security/request";

type AuditOptions = {
  request: Request;
  action: string;
  actorId?: string | null;
  targetUserId?: string | null;
  targetResourceId?: string | null;
  success: boolean;
  metadata?: Record<string, unknown>;
};

export function auditLogValues(request: Request) {
  return {
    ipHash: keyedDigest("audit-ip", clientIp(request)),
    userAgent: userAgent(request),
  };
}

function auditRow(options: AuditOptions) {
  const values = auditLogValues(options.request);
  return {
    actor_id: options.actorId ?? null,
    action: options.action,
    target_user_id: options.targetUserId ?? null,
    target_resource_id: options.targetResourceId ?? null,
    success: options.success,
    ip_hash: values.ipHash,
    user_agent: values.userAgent,
    metadata: options.metadata ?? {},
  };
}

/**
 * 감사로그 저장 실패를 호출자에게 전달합니다.
 * 중요 작업은 이 함수를 작업 전에 호출하여 감사기록이 불가능한 상태에서 변경되지 않게 해야 합니다.
 */
export async function writeAuditLog(options: AuditOptions) {
  const { error } = await createAdminClient().from("security_audit_logs").insert(auditRow(options));
  if (error) throw error;
}

/** 오류 처리 중에는 원래 오류를 가리지 않도록 최선형으로 기록합니다. */
export async function writeAuditLogBestEffort(options: AuditOptions) {
  try {
    await writeAuditLog(options);
  } catch (error) {
    console.error("[audit-log]", error);
  }
}

/**
 * 계정·권한·관리자 설정처럼 복구가 어려운 작업 전에 반드시 남기는 시작 기록입니다.
 * 이 기록이 실패하면 실제 변경을 시작하지 않습니다.
 */
export async function beginPrivilegedAudit(options: Omit<AuditOptions, "success">) {
  const values = auditLogValues(options.request);
  const { data, error } = await createAdminClient()
    .from("security_audit_logs")
    .insert({
      ...auditRow({
        ...options,
        success: false,
        metadata: { ...(options.metadata ?? {}), audit_state: "started" },
      }),
      ip_hash: values.ipHash,
      user_agent: values.userAgent,
    })
    .select("id")
    .single<{ id: string }>();
  if (error || !data) throw error ?? new Error("감사로그 시작 기록을 저장하지 못했습니다.");
  return data.id;
}

/** 시작 기록은 남아 있으므로 완료 표시 실패가 실제 변경 결과를 뒤집지는 않습니다. */
export async function completePrivilegedAudit(
  auditId: string,
  success: boolean,
  metadata: Record<string, unknown> = {},
) {
  const { error } = await createAdminClient()
    .from("security_audit_logs")
    .update({ success, metadata: { ...metadata, audit_state: success ? "completed" : "failed" } })
    .eq("id", auditId);
  if (error) console.error("[audit-log-complete]", error);
}
