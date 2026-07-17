import { authErrorResponse, requireUser } from "@/lib/auth/guards";
import { DEPARTMENTS } from "@/lib/constants";
import { createAdminClient } from "@/lib/supabase/admin";
import type { UsageUserSummary } from "@/types";

type DepartmentRow = {
  department: string;
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
        .maybeSingle<UsageUserSummary>();

      if (error) {
        return Response.json({ error: error.message }, { status: 400 });
      }

      return Response.json({
        users: data ? [data] : [],
        departments: [],
        selectedDepartment: profile.department,
        viewerRole: profile.role,
        viewerDepartment: profile.department,
      });
    }

    const requestedDepartment = new URL(request.url).searchParams.get("department")?.trim() || null;
    const allowedDepartments: string[] =
      profile.role === "admin" ? [...DEPARTMENTS] : [profile.department];

    if (requestedDepartment && !allowedDepartments.includes(requestedDepartment)) {
      return Response.json({ error: "이 부서의 사용현황을 볼 권한이 없습니다." }, { status: 403 });
    }

    let departmentQuery = admin
      .from("profiles")
      .select("department")
      .eq("account_status", "active");

    if (profile.role === "department_admin") {
      departmentQuery = departmentQuery.eq("department", profile.department);
    } else {
      departmentQuery = departmentQuery.in("department", allowedDepartments);
    }

    const { data: departmentRows, error: departmentError } = await departmentQuery.returns<DepartmentRow[]>();
    if (departmentError) {
      return Response.json({ error: departmentError.message }, { status: 400 });
    }

    const departments = allowedDepartments.map((name) => ({
      name,
      userCount: (departmentRows ?? []).filter((row) => row.department === name).length,
    }));

    let users: UsageUserSummary[] = [];
    if (requestedDepartment) {
      const { data, error } = await admin
        .from("profiles")
        .select("id,login_id,display_name,department,role")
        .eq("account_status", "active")
        .eq("department", requestedDepartment)
        .order("display_name", { ascending: true })
        .returns<UsageUserSummary[]>();

      if (error) {
        return Response.json({ error: error.message }, { status: 400 });
      }
      users = data ?? [];
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
