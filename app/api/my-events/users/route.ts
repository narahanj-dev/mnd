import { authErrorResponse, requireUser } from "@/lib/auth/guards";
import { DEPARTMENTS } from "@/lib/constants";
import { createAdminClient } from "@/lib/supabase/admin";
import type { UsageUserSummary } from "@/types";
import { decryptProfile, decryptProfiles } from "@/lib/security/pii";

type DepartmentRow = {
  department: string;
  role: UsageUserSummary["role"];
};

export async function GET(request: Request) {
  try {
    const { user, profile } = await requireUser();
    const admin = createAdminClient();

    if (profile.role === "user") {
      const { data, error } = await admin
        .from("profiles")
        .select("id,login_id,display_name,department,role")
        .eq("id", user.id)
        .eq("account_status", "active")
        .maybeSingle();

      if (error) return Response.json({ error: error.message }, { status: 400 });

      return Response.json({
        users: data ? [decryptProfile(data) as unknown as UsageUserSummary] : [],
        departments: [],
        selectedDepartment: profile.department,
        viewerRole: profile.role,
        viewerDepartment: profile.department,
      });
    }

    const requestedDepartment = new URL(request.url).searchParams.get("department")?.trim() || null;
    const allowedDepartments: string[] = profile.role === "admin" ? [...DEPARTMENTS] : [profile.department];

    if (requestedDepartment && !allowedDepartments.includes(requestedDepartment)) {
      return Response.json({ error: "이 부서의 일정을 볼 권한이 없습니다." }, { status: 403 });
    }

    let departmentQuery = admin
      .from("profiles")
      .select("department,role")
      .eq("account_status", "active");

    if (profile.role === "department_admin") {
      departmentQuery = departmentQuery.eq("department", profile.department).neq("role", "admin");
    } else {
      departmentQuery = departmentQuery.in("department", allowedDepartments);
    }

    const { data: departmentRows, error: departmentError } = await departmentQuery.returns<DepartmentRow[]>();
    if (departmentError) return Response.json({ error: departmentError.message }, { status: 400 });

    const departments = allowedDepartments.map((name) => ({
      name,
      userCount: (departmentRows ?? []).filter((row) => row.department === name).length,
    }));

    let users: UsageUserSummary[] = [];
    if (requestedDepartment) {
      let usersQuery = admin
        .from("profiles")
        .select("id,login_id,display_name,department,role")
        .eq("account_status", "active")
        .eq("department", requestedDepartment);

      if (profile.role === "department_admin") {
        usersQuery = usersQuery.neq("role", "admin");
      }

      const { data, error } = await usersQuery;
      if (error) return Response.json({ error: error.message }, { status: 400 });
      users = decryptProfiles(data as Record<string, unknown>[]).map((item) => item as unknown as UsageUserSummary)
        .sort((a, b) => a.display_name.localeCompare(b.display_name, "ko"));
    }

    return Response.json({
      users,
      departments,
      selectedDepartment: requestedDepartment,
      viewerRole: profile.role,
      viewerDepartment: profile.department,
    });
  } catch (error) {
    return authErrorResponse(error);
  }
}
