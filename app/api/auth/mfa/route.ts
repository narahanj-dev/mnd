import { z } from "zod";
import { requireUser, authErrorResponse } from "@/lib/auth/guards";
import { assertSameOrigin, clientIp, readJsonBody } from "@/lib/security/request";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { SecurityError } from "@/lib/security/errors";
import { verifyCurrentPassword } from "@/lib/security/reauth";
import { writeAuditLogBestEffort } from "@/lib/security/audit";

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("enroll"), currentPassword: z.string().min(1).max(100) }),
  z.object({ action: z.literal("verify"), factorId: z.string().uuid(), code: z.string().regex(/^\d{6}$/) }),
]);

async function requirePrivilegedForMfa() {
  const result = await requireUser({ allowPasswordChangeRequired: true });
  if (result.profile.role === "user") {
    throw new SecurityError("FORBIDDEN", 403, "추가 인증 대상 계정이 아닙니다.");
  }
  return result;
}

export async function GET() {
  try {
    const { supabase } = await requirePrivilegedForMfa();
    const [{ data: level, error: levelError }, { data: factors, error: factorError }] = await Promise.all([
      supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
      supabase.auth.mfa.listFactors(),
    ]);
    if (levelError || factorError) throw new SecurityError("MFA_CHECK_FAILED", 503, "추가 인증 정보를 확인하지 못했습니다.");
    const verified = factors.totp.find((item) => item.status === "verified");
    return Response.json({
      currentLevel: level.currentLevel,
      factorId: verified?.id ?? null,
      needsEnrollment: !verified,
    }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function POST(request: Request) {
  let actorId: string | null = null;
  let auditAction = "auth.mfa.unknown";
  try {
    assertSameOrigin(request);
    const { supabase, user } = await requirePrivilegedForMfa();
    actorId = user.id;
    await enforceRateLimit({ purpose: "mfa", identity: `${user.id}:${clientIp(request)}`, limit: 10, windowSeconds: 600 });
    const parsed = actionSchema.safeParse(await readJsonBody(request));
    if (!parsed.success) throw new SecurityError("INVALID_INPUT", 400, "추가 인증 요청을 확인하세요.");

    if (parsed.data.action === "verify") {
      auditAction = "auth.mfa.verify";
      const { error } = await supabase.auth.mfa.challengeAndVerify({
        factorId: parsed.data.factorId,
        code: parsed.data.code,
      });
      if (error) throw new SecurityError("MFA_INVALID", 400, "인증 코드가 올바르지 않거나 만료되었습니다.");
      await writeAuditLogBestEffort({ request, action: auditAction, actorId: user.id, targetUserId: user.id, success: true });
      return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store, max-age=0" } });
    }

    auditAction = "auth.mfa.enroll";
    const { data: factors, error: listError } = await supabase.auth.mfa.listFactors();
    if (listError) throw new SecurityError("MFA_CHECK_FAILED", 503, "추가 인증 정보를 확인하지 못했습니다.");
    const verified = factors.totp.find((item) => item.status === "verified");
    if (verified) {
      return Response.json(
        { factorId: verified.id, alreadyEnrolled: true },
        { headers: { "Cache-Control": "no-store, max-age=0" } },
      );
    }

    await verifyCurrentPassword({
      userId: user.id,
      email: user.email,
      password: parsed.data.currentPassword,
    });

    for (const pending of factors.totp.filter((item) => item.status !== "verified")) {
      const { error: unenrollError } = await supabase.auth.mfa.unenroll({ factorId: pending.id });
      if (unenrollError) throw new SecurityError("MFA_RESET_FAILED", 503, "이전 인증 등록 정보를 정리하지 못했습니다.");
    }
    const { data, error } = await supabase.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: "부대달력 관리자 인증",
    });
    if (error || !data) throw new SecurityError("MFA_ENROLL_FAILED", 503, "인증 앱 등록을 시작하지 못했습니다.");
    await writeAuditLogBestEffort({ request, action: auditAction, actorId: user.id, targetUserId: user.id, success: true });
    return Response.json({
      factorId: data.id,
      qrCode: data.totp.qr_code,
      secret: data.totp.secret,
    }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) {
    await writeAuditLogBestEffort({ request, action: auditAction, actorId, targetUserId: actorId, success: false });
    return authErrorResponse(error);
  }
}
