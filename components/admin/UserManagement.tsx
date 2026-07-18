"use client";

import { ArrowLeft, Building2, ChevronRight, Search } from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { DEPARTMENTS, USER_ROLE_LABELS, USER_ROLE_OPTIONS } from "@/lib/constants";
import { parseJsonResponse } from "@/lib/utils";
import type { Profile, UserRole } from "@/types";

type DepartmentSummary = { name: string; userCount: number };
type UsersResponse = {
  users: Profile[];
  departments: DepartmentSummary[];
  selectedDepartment: string | null;
  currentUserId: string;
  currentUserRole: UserRole;
  currentUserDepartment: string;
};

export function UserManagement() {
  const [users, setUsers] = useState<Profile[]>([]);
  const [departments, setDepartments] = useState<DepartmentSummary[]>([]);
  const [selectedDepartment, setSelectedDepartment] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [currentUserId, setCurrentUserId] = useState("");
  const [currentUserRole, setCurrentUserRole] = useState<UserRole>("user");
  const [currentUserDepartment, setCurrentUserDepartment] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [editUser, setEditUser] = useState<Profile | null>(null);
  const [deleteUser, setDeleteUser] = useState<Profile | null>(null);
  const [deleteLoginId, setDeleteLoginId] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);

  const isFullAdmin = currentUserRole === "admin";

  const load = useCallback(async (department: string | null = null) => {
    setLoading(true);
    try {
      const query = department ? `?department=${encodeURIComponent(department)}` : "";
      const data = await parseJsonResponse<UsersResponse>(
        await fetch(`/api/admin/users${query}`, { cache: "no-store" }),
      );
      setUsers(data.users);
      setDepartments(data.departments);
      setSelectedDepartment(data.selectedDepartment);
      setCurrentUserId(data.currentUserId);
      setCurrentUserRole(data.currentUserRole);
      setCurrentUserDepartment(data.currentUserDepartment);
      setSearch("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "사용자 목록을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const filteredUsers = useMemo(() => {
    const keyword = search.trim().toLocaleLowerCase("ko");
    if (!keyword) return users;
    return users.filter((user) =>
      [user.display_name, user.login_id, user.department, USER_ROLE_LABELS[user.role]]
        .some((value) => value.toLocaleLowerCase("ko").includes(keyword)),
    );
  }, [search, users]);

  function canManage(target: Profile) {
    if (currentUserRole === "admin") return true;
    return currentUserRole === "department_admin" &&
      target.department === currentUserDepartment &&
      target.role !== "admin";
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    try {
      const form = new FormData(event.currentTarget);
      await parseJsonResponse(
        await fetch("/api/admin/users", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(Object.fromEntries(form.entries())),
        }),
      );
      setCreateOpen(false);
      setMessage("사용자 계정을 생성했습니다.");
      await load(selectedDepartment);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "사용자 생성에 실패했습니다.");
    }
  }

  async function updateIdentity(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editUser) return;
    setBusyId(editUser.id);
    setMessage("");
    try {
      const form = new FormData(event.currentTarget);
      const nextRole = String(form.get("role")) as UserRole;
      await parseJsonResponse(
        await fetch(`/api/admin/users/${editUser.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "updateIdentity",
            loginId: form.get("loginId"),
            department: form.get("department"),
            role: nextRole,
          }),
        }),
      );
      const changedCurrentUser = editUser.id === currentUserId;
      setEditUser(null);
      setMessage("군번, 부서와 권한을 변경했습니다. 관련 화면에도 즉시 반영됩니다.");
      if (changedCurrentUser && nextRole === "user") {
        window.location.assign("/calendar");
        return;
      }
      await load(selectedDepartment);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "사용자 정보 수정에 실패했습니다.");
    } finally {
      setBusyId(null);
    }
  }

  async function resetPassword(user: Profile) {
    if (!window.confirm(`${user.display_name}님의 비밀번호를 12345로 초기화하시겠습니까?`)) return;
    setBusyId(user.id);
    setMessage("");
    try {
      await parseJsonResponse(
        await fetch(`/api/admin/users/${user.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "resetPassword" }),
        }),
      );
      setMessage(`${user.display_name}님의 비밀번호를 12345로 초기화했습니다.`);
      await load(selectedDepartment);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "비밀번호 초기화에 실패했습니다.");
    } finally {
      setBusyId(null);
    }
  }

  function openDeleteModal(user: Profile) {
    setMessage("");
    setDeleteError("");
    setDeleteLoginId("");
    setDeleteUser(user);
  }

  function closeDeleteModal() {
    if (deleteUser && busyId === deleteUser.id) return;
    setDeleteUser(null);
    setDeleteLoginId("");
    setDeleteError("");
  }

  async function deleteAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!deleteUser) return;
    if (deleteLoginId.trim() !== deleteUser.login_id) {
      setDeleteError("삭제할 사용자의 군번을 정확히 입력하세요.");
      return;
    }
    const target = deleteUser;
    setBusyId(target.id);
    setDeleteError("");
    setMessage("");
    try {
      await parseJsonResponse(
        await fetch(`/api/admin/users/${target.id}`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
        }),
      );
      setDeleteUser(null);
      setDeleteLoginId("");
      setMessage(`${target.display_name} 계정과 관련 데이터를 모두 삭제했습니다.`);
      await load(selectedDepartment);
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : "계정 삭제에 실패했습니다.");
    } finally {
      setBusyId(null);
    }
  }

  if (loading) return <div className="card p-8 text-center text-slate-500">사용자 관리를 불러오는 중...</div>;

  const showDepartmentList = !selectedDepartment;

  return (
    <div>
      {showDepartmentList ? (
        <>
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-2xl font-black">사용자 관리</h1>
              <p className="mt-1 text-sm text-slate-500">
                {isFullAdmin ? "5개 부서 중 관리할 부서를 선택하세요." : `${currentUserDepartment} 소속 사용자만 관리할 수 있습니다.`}
              </p>
            </div>
            {isFullAdmin && <button className="btn-primary" onClick={() => setCreateOpen(true)}>+ 사용자 생성</button>}
          </div>
          {message && <p className="mb-4 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold">{message}</p>}
          <div className={`grid gap-3 ${departments.length === 1 ? "max-w-md" : "sm:grid-cols-2 xl:grid-cols-5"}`}>
            {departments.map((department) => (
              <button
                key={department.name}
                type="button"
                onClick={() => void load(department.name)}
                className="card flex items-center gap-3 p-4 text-left transition hover:border-blue-300 hover:bg-blue-50"
              >
                <span className="rounded-xl bg-slate-100 p-2 text-slate-600"><Building2 size={20} /></span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-black">{department.name}</span>
                  <span className="mt-1 block text-xs font-bold text-slate-500">사용자 {department.userCount}명</span>
                </span>
                <ChevronRight size={18} className="text-slate-400" />
              </button>
            ))}
          </div>
        </>
      ) : (
        <>
          <button type="button" className="btn-secondary mb-4 flex items-center gap-1.5" onClick={() => void load(null)}>
            <ArrowLeft size={16} /> 부서 목록
          </button>
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-2xl font-black">{selectedDepartment} 사용자 관리</h1>
              <p className="mt-1 text-sm text-slate-500">부서 내에서 이름 또는 군번로 검색할 수 있습니다. 삭제하면 관련 기록도 모두 삭제됩니다.</p>
            </div>
            {isFullAdmin && <button className="btn-primary" onClick={() => setCreateOpen(true)}>+ 사용자 생성</button>}
          </div>
          {message && <p className="mb-4 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold">{message}</p>}
          <div className="card mb-4 p-4">
            <label className="relative block">
              <span className="sr-only">사용자 검색</span>
              <Search size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input className="input pl-10" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="이름 또는 군번로 검색" />
            </label>
          </div>

          {filteredUsers.length === 0 ? (
            <div className="card p-8 text-center text-slate-500">{search ? "검색 결과가 없습니다." : "등록된 사용자가 없습니다."}</div>
          ) : (
            <div className="card overflow-x-auto">
              <table className="w-full min-w-[1050px] text-sm">
                <thead className="bg-slate-50 text-left"><tr>{["이름", "군번", "부서", "권한", "상태", "최근 로그인", "관리"].map((heading) => <th key={heading} className="p-3">{heading}</th>)}</tr></thead>
                <tbody className="divide-y divide-slate-200">
                  {filteredUsers.map((user) => {
                    const busy = busyId === user.id;
                    const isCurrentUser = currentUserId === user.id;
                    const manageable = canManage(user);
                    const disabledTitle = !manageable ? "관리자 계정은 전체 관리자만 관리할 수 있습니다." : undefined;
                    return (
                      <tr key={user.id}>
                        <td className="p-3 font-bold">{user.display_name}{isCurrentUser && <span className="ml-2 rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-700">현재 계정</span>}</td>
                        <td className="p-3">{user.login_id}</td>
                        <td className="p-3">{user.department}</td>
                        <td className="p-3">{USER_ROLE_LABELS[user.role]}</td>
                        <td className="p-3">{user.account_status === "active" ? "활성" : "비활성"}</td>
                        <td className="p-3">{user.last_login_at ? new Date(user.last_login_at).toLocaleString("ko-KR") : "-"}</td>
                        <td className="p-3"><div className="flex flex-wrap gap-2">
                          <button className="btn-secondary text-xs disabled:cursor-not-allowed disabled:opacity-40" disabled={busy || !manageable} title={disabledTitle} onClick={() => setEditUser(user)}>군번·부서·권한 변경</button>
                          <button className="btn-secondary text-xs disabled:cursor-not-allowed disabled:opacity-40" disabled={busy || !manageable} title={disabledTitle} onClick={() => void resetPassword(user)}>비밀번호 초기화</button>
                          <button className="btn-danger text-xs disabled:cursor-not-allowed disabled:opacity-40" disabled={busy || isCurrentUser || !manageable} title={isCurrentUser ? "현재 로그인한 계정은 삭제할 수 없습니다." : disabledTitle} onClick={() => openDeleteModal(user)}>삭제</button>
                        </div></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {createOpen && isFullAdmin && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4" onMouseDown={(event) => event.target === event.currentTarget && setCreateOpen(false)}>
          <form onSubmit={create} className="card w-full max-w-lg space-y-4 p-6">
            <h2 className="text-xl font-black">새 사용자 계정</h2>
            <input name="displayName" className="input" placeholder="이름" required />
            <input name="loginId" className="input" placeholder="군번" required />
            <input name="password" type="password" className="input" placeholder="임시 비밀번호" required />
            <select name="department" className="input" required defaultValue={selectedDepartment ?? ""}>
              <option value="" disabled>부서를 선택하세요</option>
              {DEPARTMENTS.map((department) => <option key={department} value={department}>{department}</option>)}
            </select>
            <select name="role" className="input" defaultValue="user">{USER_ROLE_OPTIONS.map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}</select>
            <div className="flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={() => setCreateOpen(false)}>취소</button><button className="btn-primary">생성</button></div>
          </form>
        </div>
      )}

      {editUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4" onMouseDown={(event) => event.target === event.currentTarget && setEditUser(null)}>
          <form onSubmit={updateIdentity} className="card w-full max-w-lg space-y-5 p-6">
            <div><h2 className="text-xl font-black">군번·부서·권한 변경</h2><p className="mt-1 text-sm text-slate-500">{editUser.display_name}님의 정보가 모든 관련 화면에 함께 반영됩니다.</p></div>
            <label className="block text-sm font-bold">로그인 군번<input name="loginId" className="input mt-1" defaultValue={editUser.login_id} pattern="[A-Za-z0-9_-]{4,30}" required /></label>
            <label className="block text-sm font-bold">부서
              <select name="department" className="input mt-1" defaultValue={editUser.department} required>
                {(isFullAdmin ? DEPARTMENTS : [currentUserDepartment]).map((department) => <option key={department} value={department}>{department}</option>)}
              </select>
            </label>
            <label className="block text-sm font-bold">권한<select name="role" className="input mt-1" defaultValue={editUser.role} required>{USER_ROLE_OPTIONS.filter((role) => isFullAdmin || role.value !== "admin").map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}</select></label>
            {!isFullAdmin && <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">부서관리자는 본인 부서 안에서만 사용자를 관리할 수 있으며 관리자 권한은 부여할 수 없습니다.</p>}
            <div className="flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={() => setEditUser(null)}>취소</button><button className="btn-primary" disabled={busyId === editUser.id}>{busyId === editUser.id ? "변경 중..." : "변경 저장"}</button></div>
          </form>
        </div>
      )}

      {deleteUser && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/60 p-4" onMouseDown={(event) => event.target === event.currentTarget && closeDeleteModal()}>
          <form onSubmit={deleteAccount} className="card w-full max-w-lg space-y-5 p-6">
            <div><h2 className="text-xl font-black text-rose-700">사용자 계정 삭제</h2><p className="mt-2 text-sm leading-6 text-slate-600"><strong>{deleteUser.display_name}</strong>님의 계정과 달력 일정, 일정 요청, 수신·발신 쪽지 등 관련 기록을 모두 영구 삭제합니다.</p></div>
            <label className="block text-sm font-bold">확인을 위해 군번 <strong className="text-rose-700">{deleteUser.login_id}</strong> 입력<input value={deleteLoginId} onChange={(event) => { setDeleteLoginId(event.target.value); setDeleteError(""); }} className="input mt-2" placeholder={deleteUser.login_id} autoComplete="off" autoFocus required /></label>
            {deleteError && <p className="rounded-xl bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">{deleteError}</p>}
            <div className="flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={closeDeleteModal} disabled={busyId === deleteUser.id}>취소</button><button className="btn-danger disabled:cursor-not-allowed disabled:opacity-40" disabled={busyId === deleteUser.id || deleteLoginId.trim() !== deleteUser.login_id}>{busyId === deleteUser.id ? "삭제 중..." : "영구 삭제"}</button></div>
          </form>
        </div>
      )}
    </div>
  );
}
