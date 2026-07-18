"use client";

import { ArrowLeft, Building2, ChevronRight, Search, UserRound } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { USER_ROLE_LABELS } from "@/lib/constants";
import { parseJsonResponse } from "@/lib/utils";
import type { UsageUserSummary, UserRole } from "@/types";

type DepartmentSummary = {
  name: string;
  userCount: number;
};

type UsersResponse = {
  users: UsageUserSummary[];
  departments: DepartmentSummary[];
  selectedDepartment: string | null;
  viewerRole: UserRole;
  viewerDepartment: string;
};

export function UsageUserList() {
  const [users, setUsers] = useState<UsageUserSummary[]>([]);
  const [departments, setDepartments] = useState<DepartmentSummary[]>([]);
  const [selectedDepartment, setSelectedDepartment] = useState<string | null>(null);
  const [viewerRole, setViewerRole] = useState<UserRole>("user");
  const [viewerDepartment, setViewerDepartment] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async (department: string | null = null) => {
    setLoading(true);
    setError("");
    try {
      const query = department ? `?department=${encodeURIComponent(department)}` : "";
      const data = await parseJsonResponse<UsersResponse>(
        await fetch(`/api/usage/users${query}`, { cache: "no-store" }),
      );
      setUsers(data.users);
      setDepartments(data.departments);
      setSelectedDepartment(data.selectedDepartment);
      setViewerRole(data.viewerRole);
      setViewerDepartment(data.viewerDepartment);
      setSearch("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "사용자 목록을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filteredUsers = useMemo(() => {
    const keyword = search.trim().toLocaleLowerCase("ko");
    if (!keyword) return users;
    return users.filter((user) =>
      [user.display_name, user.login_id, user.department, USER_ROLE_LABELS[user.role]]
        .some((value) => value.toLocaleLowerCase("ko").includes(keyword)),
    );
  }, [search, users]);

  if (loading) {
    return <div className="card p-8 text-center text-slate-500">사용현황을 불러오는 중...</div>;
  }

  if (error) {
    return (
      <div>
        <h1 className="mb-5 text-2xl font-black">사용현황</h1>
        <div className="card p-8 text-center">
          <p className="text-rose-700">{error}</p>
          <button type="button" className="btn-secondary mt-4" onClick={() => load(selectedDepartment)}>
            다시 불러오기
          </button>
        </div>
      </div>
    );
  }

  const showDepartmentList = viewerRole !== "user" && !selectedDepartment;

  if (showDepartmentList) {
    return (
      <div>
        <h1 className="mb-2 text-2xl font-black">사용현황</h1>
        <p className="mb-5 text-sm text-slate-500">
          {viewerRole === "admin"
            ? "5개 부서 중 확인할 부서를 선택하세요. 부서별 인원의 사용현황을 따로 확인할 수 있습니다."
            : `${viewerDepartment} 소속 인원의 사용현황만 확인할 수 있습니다.`}
        </p>

        <div className={`grid gap-3 ${departments.length === 1 ? "max-w-md" : "sm:grid-cols-2 xl:grid-cols-5"}`}>
          {departments.map((department) => (
            <button
              key={department.name}
              type="button"
              onClick={() => load(department.name)}
              className="card flex items-center gap-3 p-4 text-left transition hover:border-blue-300 hover:bg-blue-50"
            >
              <span className="rounded-xl bg-slate-100 p-2 text-slate-600">
                <Building2 size={20} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-black">{department.name}</span>
                <span className="mt-1 block text-xs font-bold text-slate-500">
                  사용 인원 {department.userCount}명
                </span>
              </span>
              <ChevronRight size={18} className="text-slate-400" />
            </button>
          ))}
        </div>
      </div>
    );
  }

  const title = viewerRole === "user" ? "내 사용현황" : `${selectedDepartment} 사용현황`;
  const description =
    viewerRole === "user"
      ? "본인의 연가·외박·외출 사용현황을 확인할 수 있습니다."
      : `${selectedDepartment} 소속 인원을 선택해 상세 사용현황을 확인하세요.`;

  return (
    <div>
      {viewerRole !== "user" && (
        <button
          type="button"
          onClick={() => {
            setSelectedDepartment(null);
            setUsers([]);
            setSearch("");
          }}
          className="btn-secondary mb-4 flex items-center gap-1.5"
        >
          <ArrowLeft size={16} /> 부서 목록
        </button>
      )}

      <div className="mb-5">
        <h1 className="text-2xl font-black">{title}</h1>
        <p className="mt-1 text-sm text-slate-500">{description}</p>
      </div>

      {viewerRole !== "user" && (
        <div className="card mb-4 p-4">
          <label className="relative block">
            <span className="sr-only">사용자 검색</span>
            <Search
              size={18}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
            />
            <input
              className="input pl-10"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="이름 또는 아이디로 검색"
            />
          </label>
        </div>
      )}

      {filteredUsers.length === 0 ? (
        <div className="card p-8 text-center text-slate-500">
          {search ? "검색 결과가 없습니다." : `${selectedDepartment ?? viewerDepartment} 소속 사용자가 없습니다.`}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {filteredUsers.map((user) => (
            <Link
              key={user.id}
              href={`/usage/${user.id}`}
              className="card group flex items-center gap-4 p-5 transition hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-lg"
            >
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-blue-50 text-blue-700 group-hover:bg-blue-100">
                <UserRound size={24} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-lg font-black text-slate-900">{user.display_name}</div>
                <div className="mt-1 truncate text-sm text-slate-500">
                  {user.department} · {USER_ROLE_LABELS[user.role]}
                </div>
                <div className="mt-1 truncate text-xs text-slate-400">아이디 {user.login_id}</div>
              </div>
              <span className="shrink-0 text-sm font-bold text-blue-700">보기</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
