"use client";

import { Search, UserRound } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { USER_ROLE_LABELS } from "@/lib/constants";
import { parseJsonResponse } from "@/lib/utils";
import type { UsageUserSummary, UserRole } from "@/types";

type UsersResponse = {
  users: UsageUserSummary[];
  viewerRole: UserRole;
  viewerDepartment: string;
};

export function UsageUserList() {
  const [users, setUsers] = useState<UsageUserSummary[]>([]);
  const [viewerRole, setViewerRole] = useState<UserRole>("user");
  const [viewerDepartment, setViewerDepartment] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await parseJsonResponse<UsersResponse>(
        await fetch("/api/usage/users", { cache: "no-store" }),
      );
      setUsers(data.users);
      setViewerRole(data.viewerRole);
      setViewerDepartment(data.viewerDepartment);
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

  const description =
    viewerRole === "admin"
      ? "전체 인원의 휴가·외박·외출 사용현황을 확인할 수 있습니다."
      : viewerRole === "department_admin"
        ? `${viewerDepartment} 소속 인원의 휴가·외박·외출 사용현황을 확인할 수 있습니다.`
        : "본인의 휴가·외박·외출 사용현황만 확인할 수 있습니다.";

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-2xl font-black">사용현황</h1>
        <p className="mt-1 text-sm text-slate-500">{description}</p>
      </div>

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
            placeholder="이름, 아이디 또는 부서로 검색"
          />
        </label>
      </div>

      {error && (
        <div className="card border-rose-200 p-5 text-sm font-semibold text-rose-700">
          {error}
        </div>
      )}

      {!error && loading && <div className="card p-8 text-center text-slate-500">사용자 목록을 불러오는 중...</div>}

      {!error && !loading && filteredUsers.length === 0 && (
        <div className="card p-8 text-center text-slate-500">검색 결과가 없습니다.</div>
      )}

      {!error && !loading && filteredUsers.length > 0 && (
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
