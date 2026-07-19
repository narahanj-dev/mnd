import { authErrorResponse, requireUserManager } from "@/lib/auth/guards";
import { DEPARTMENTS } from "@/lib/constants";
import { createAdminClient } from "@/lib/supabase/admin";
import { decryptSignupRequest } from "@/lib/security/pii";
import { decryptSignupSensitiveFields } from "@/lib/security/secure-fields";
import { SecurityError } from "@/lib/security/errors";

export async function GET(request: Request) {
  try {
    const { profile } = await requireUserManager();
    const admin = createAdminClient();
    const requestedDepartment = new URL(request.url).searchParams.get("department")?.trim() || null;
    const allowedDepartments = profile.role === "admin" ? [...DEPARTMENTS] : [profile.department];

    if (requestedDepartment && !allowedDepartments.includes(requestedDepartment)) {
      throw new SecurityError("FORBIDDEN_DEPARTMENT", 403, "이 부서의 가입신청을 처리할 권한이 없습니다.");
    }

    const { data: pendingRows, error: pendingError } = await admin.from("signup_requests").select("department").eq("status", "pending").in("department", allowedDepartments);
    if (pendingError) throw pendingError;

    const departments = allowedDepartments.map((name) => ({
      name,
      requestCount: (pendingRows ?? []).filter((item) => item.department === name).length,
    }));

    let requests: Record<string, unknown>[] = [];
    if (requestedDepartment) {
      const { data, error } = await admin
        .from("signup_requests")
        .select("id,name,department,birth_month_day,requested_login_id,auth_user_id,reason,status,rejection_reason,created_at")
        .eq("status", "pending")
        .eq("department", requestedDepartment)
        .order("created_at", { ascending: false });
      if (error) throw error;
      requests = (data ?? []).map((item) => ({
        ...decryptSignupSensitiveFields(decryptSignupRequest(item)),
        account_ready: Boolean(item.auth_user_id),
      }));
    }

    return Response.json({ requests, departments, selectedDepartment: requestedDepartment, viewerRole: profile.role, viewerDepartment: profile.department });
  } catch (error) {
    return authErrorResponse(error);
  }
}
