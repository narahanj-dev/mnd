"use client";

import { ArrowLeft, Building2, ChevronRight, Search } from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  DEPARTMENTS,
  USER_ROLE_LABELS,
  USER_ROLE_OPTIONS,
} from "@/lib/constants";
import { PASSWORD_POLICY_TEXT } from "@/lib/security/password-policy";
import { parseJsonResponse } from "@/lib/utils";
import type { Profile, UserRole } from "@/types";

type DepartmentSummary = { name: string; userCount: number };
type TemporaryPasswordResult = {
  displayName: string;
  loginId: string;
  temporaryPassword: string;
  expiresAt: string;
};
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
  const [selectedDepartment, setSelectedDepartment] = useState<string | null>(
    null,
  );
  const [search, setSearch] = useState("");
  const [currentUserId, setCurrentUserId] = useState("");
  const [currentUserRole, setCurrentUserRole] = useState<UserRole>("user");
  const [currentUserDepartment, setCurrentUserDepartment] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [editUser, setEditUser] = useState<Profile | null>(null);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [passwordError, setPasswordError] = useState("");
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [resetUser, setResetUser] = useState<Profile | null>(null);
  const [resetCurrentPassword, setResetCurrentPassword] = useState("");
  const [resetError, setResetError] = useState("");
  const [temporaryPasswordResult, setTemporaryPasswordResult] = useState<TemporaryPasswordResult | null>(null);
  const [temporaryPasswordCopied, setTemporaryPasswordCopied] = useState(false);
  const [deleteUser, setDeleteUser] = useState<Profile | null>(null);
  const [deleteLoginId, setDeleteLoginId] = useState("");
  const [deleteCurrentPassword, setDeleteCurrentPassword] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);

  const isFullAdmin = currentUserRole === "admin";
  const isSelfService = currentUserRole === "user";

  const load = useCallback(async (department: string | null = null) => {
    setLoading(true);
    try {
      const query = department
        ? `?department=${encodeURIComponent(department)}`
        : "";
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
      setMessage(
        error instanceof Error
          ? error.message
          : "사용자 목록을 불러오지 못했습니다.",
      );
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
      [
        user.display_name,
        user.login_id,
        user.department,
        USER_ROLE_LABELS[user.role],
      ].some((value) => value.toLocaleLowerCase("ko").includes(keyword)),
    );
  }, [search, users]);

  function canManage(target: Profile) {
    if (currentUserRole === "admin") return true;
    if (currentUserRole === "department_admin") {
      return (
        target.department === currentUserDepartment && target.role !== "admin"
      );
    }
    return target.id === currentUserId;
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
      setMessage(
        error instanceof Error ? error.message : "사용자 생성에 실패했습니다.",
      );
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
            currentPassword: form.get("currentPassword"),
          }),
        }),
      );
      const changedCurrentUser = editUser.id === currentUserId;
      setEditUser(null);
      setMessage(
        isSelfService
          ? "아이디를 변경했습니다. 다음 로그인부터 변경한 아이디를 사용하세요."
          : "아이디, 부서 및 권한을 변경했습니다. 관련 화면에도 즉시 반영됩니다.",
      );
      if (changedCurrentUser && !isSelfService) {
        window.location.assign("/users");
        return;
      }
      await load(selectedDepartment);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "사용자 정보 수정에 실패했습니다.",
      );
    } finally {
      setBusyId(null);
    }
  }

  async function changeOwnPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const currentPassword = String(form.get("currentPassword") || "");
    const password = String(form.get("password") || "");
    const confirmPassword = String(form.get("confirmPassword") || "");

    if (password !== confirmPassword) {
      setPasswordError("새 비밀번호 확인이 일치하지 않습니다.");
      return;
    }

    setPasswordBusy(true);
    setPasswordError("");
    setMessage("");
    try {
      await parseJsonResponse(
        await fetch("/api/auth/change-password", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ currentPassword, password }),
        }),
      );
      setPasswordOpen(false);
      setMessage(
        "비밀번호를 변경했습니다. 다음 로그인부터 새 비밀번호를 사용하세요.",
      );
      formElement.reset();
    } catch (error) {
      setPasswordError(
        error instanceof Error
          ? error.message
          : "비밀번호 변경에 실패했습니다.",
      );
    } finally {
      setPasswordBusy(false);
    }
  }

  function openResetModal(user: Profile) {
    setMessage("");
    setResetError("");
    setResetCurrentPassword("");
    setResetUser(user);
  }

  function closeResetModal() {
    if (resetUser && busyId === resetUser.id) return;
    setResetUser(null);
    setResetCurrentPassword("");
    setResetError("");
  }

  async function resetPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!resetUser) return;
    const target = resetUser;
    setBusyId(target.id);
    setResetError("");
    setMessage("");
    try {
      const result = await parseJsonResponse<{ temporaryPassword: string; expiresAt: string }>(
        await fetch(`/api/admin/users/${target.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "resetPassword",
            currentPassword: resetCurrentPassword,
          }),
        }),
      );
      setResetUser(null);
      setResetCurrentPassword("");
      setTemporaryPasswordCopied(false);
      setTemporaryPasswordResult({
        displayName: target.display_name,
        loginId: target.login_id,
        temporaryPassword: result.temporaryPassword,
        expiresAt: result.expiresAt,
      });
      await load(selectedDepartment);
    } catch (error) {
      setResetError(
        error instanceof Error
          ? error.message
          : "비밀번호 초기화에 실패했습니다.",
      );
    } finally {
      setBusyId(null);
    }
  }

  async function copyTemporaryPassword() {
    if (!temporaryPasswordResult) return;
    try {
      await navigator.clipboard.writeText(temporaryPasswordResult.temporaryPassword);
      setTemporaryPasswordCopied(true);
    } catch {
      setMessage("임시 비밀번호를 자동 복사하지 못했습니다. 화면의 비밀번호를 직접 선택해 복사하세요.");
    }
  }

  function closeTemporaryPasswordResult() {
    setTemporaryPasswordResult(null);
    setTemporaryPasswordCopied(false);
  }

  function openDeleteModal(user: Profile) {
    setMessage("");
    setDeleteError("");
    setDeleteLoginId("");
    setDeleteCurrentPassword("");
    setDeleteUser(user);
  }

  function closeDeleteModal() {
    if (deleteUser && busyId === deleteUser.id) return;
    setDeleteUser(null);
    setDeleteLoginId("");
    setDeleteCurrentPassword("");
    setDeleteError("");
  }

  async function deleteAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!deleteUser) return;
    if (deleteLoginId.trim() !== deleteUser.login_id) {
      setDeleteError("삭제할 사용자의 아이디를 정확히 입력하세요.");
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
          body: JSON.stringify({ currentPassword: deleteCurrentPassword }),
        }),
      );
      setDeleteUser(null);
      setDeleteLoginId("");
      setDeleteCurrentPassword("");
      setMessage(
        `${target.display_name} 계정과 관련 데이터를 모두 삭제했습니다.`,
      );
      await load(selectedDepartment);
    } catch (error) {
      setDeleteError(
        error instanceof Error ? error.message : "계정 삭제에 실패했습니다.",
      );
    } finally {
      setBusyId(null);
    }
  }

  if (loading)
    return (
      <div className="card p-8 text-center text-slate-500">
        사용자 관리를 불러오는 중...
      </div>
    );

  const showDepartmentList = !selectedDepartment && !isSelfService;

  return (
    <div>
      {showDepartmentList ? (
        <>
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-2xl font-black">사용자 관리</h1>
              <p className="mt-1 text-sm text-slate-500">
                {isFullAdmin
                  ? "5개 부서 중 관리할 부서를 선택하세요."
                  : `${currentUserDepartment} 소속 사용자만 관리할 수 있습니다.`}
              </p>
            </div>
            {isFullAdmin && (
              <button
                className="btn-primary"
                onClick={() => setCreateOpen(true)}
              >
                + 사용자 생성
              </button>
            )}
          </div>
          {message && (
            <p className="mb-4 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold">
              {message}
            </p>
          )}
          <div
            className={`grid gap-3 ${departments.length === 1 ? "max-w-md" : "sm:grid-cols-2 xl:grid-cols-5"}`}
          >
            {departments.map((department) => (
              <button
                key={department.name}
                type="button"
                onClick={() => void load(department.name)}
                className="card flex items-center gap-3 p-4 text-left transition hover:border-blue-300 hover:bg-blue-50"
              >
                <span className="rounded-xl bg-slate-100 p-2 text-slate-600">
                  <Building2 size={20} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-black">
                    {department.name}
                  </span>
                  <span className="mt-1 block text-xs font-bold text-slate-500">
                    사용자 {department.userCount}명
                  </span>
                </span>
                <ChevronRight size={18} className="text-slate-400" />
              </button>
            ))}
          </div>
        </>
      ) : (
        <>
          {!isSelfService && (
            <button
              type="button"
              className="btn-secondary mb-4 flex items-center gap-1.5"
              onClick={() => void load(null)}
            >
              <ArrowLeft size={16} /> 부서 목록
            </button>
          )}
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-2xl font-black">
                {isSelfService
                  ? "내 사용자 정보"
                  : `${selectedDepartment} 사용자 관리`}
              </h1>
              <p className="mt-1 text-sm text-slate-500">
                {isSelfService
                  ? "본인 계정 정보만 조회할 수 있으며 아이디와 비밀번호를 직접 변경할 수 있습니다."
                  : "부서 내에서 이름 또는 아이디로 검색할 수 있습니다. 삭제하면 관련 기록도 모두 삭제됩니다."}
              </p>
            </div>
            {isFullAdmin && (
              <button
                className="btn-primary"
                onClick={() => setCreateOpen(true)}
              >
                + 사용자 생성
              </button>
            )}
          </div>
          {message && (
            <p className="mb-4 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold">
              {message}
            </p>
          )}
          {!isSelfService && (
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
              {search ? "검색 결과가 없습니다." : "등록된 사용자가 없습니다."}
            </div>
          ) : (
            <div className="card overflow-x-auto">
              <table className="w-full min-w-[1050px] text-sm">
                <thead className="bg-slate-50 text-left">
                  <tr>
                    {[
                      "이름",
                      "아이디",
                      "부서",
                      "권한",
                      "상태",
                      "최근 로그인",
                      "관리",
                    ].map((heading) => (
                      <th key={heading} className="p-3">
                        {heading}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {filteredUsers.map((user) => {
                    const busy = busyId === user.id;
                    const isCurrentUser = currentUserId === user.id;
                    const manageable = canManage(user);
                    const disabledTitle = !manageable
                      ? "해당 사용자를 관리할 권한이 없습니다."
                      : undefined;
                    return (
                      <tr key={user.id}>
                        <td className="p-3 font-bold">
                          {user.display_name}
                          {isCurrentUser && (
                            <span className="ml-2 rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-700">
                              현재 계정
                            </span>
                          )}
                        </td>
                        <td className="p-3">{user.login_id}</td>
                        <td className="p-3">{user.department}</td>
                        <td className="p-3">{USER_ROLE_LABELS[user.role]}</td>
                        <td className="p-3">
                          {user.account_status === "active" ? "활성" : "비활성"}
                        </td>
                        <td className="p-3">
                          {user.last_login_at
                            ? new Date(user.last_login_at).toLocaleString(
                                "ko-KR",
                              )
                            : "-"}
                        </td>
                        <td className="p-3">
                          <div className="flex flex-wrap gap-2">
                            <button
                              className="btn-secondary text-xs disabled:cursor-not-allowed disabled:opacity-40"
                              disabled={busy || !manageable}
                              title={disabledTitle}
                              onClick={() => setEditUser(user)}
                            >
                              {isSelfService
                                ? "아이디 변경"
                                : "아이디·부서·권한 변경"}
                            </button>
                            {isSelfService && isCurrentUser && (
                              <button
                                className="btn-secondary text-xs disabled:cursor-not-allowed disabled:opacity-40"
                                disabled={passwordBusy}
                                onClick={() => {
                                  setPasswordError("");
                                  setPasswordOpen(true);
                                }}
                              >
                                비밀번호 변경
                              </button>
                            )}
                            {!isSelfService && (
                              <>
                                <button
                                  className="btn-secondary text-xs disabled:cursor-not-allowed disabled:opacity-40"
                                  disabled={busy || !manageable}
                                  title={disabledTitle}
                                  onClick={() => openResetModal(user)}
                                >
                                  비밀번호 초기화
                                </button>
                                <button
                                  className="btn-danger text-xs disabled:cursor-not-allowed disabled:opacity-40"
                                  disabled={
                                    busy || isCurrentUser || !manageable
                                  }
                                  title={
                                    isCurrentUser
                                      ? "현재 로그인한 계정은 삭제할 수 없습니다."
                                      : disabledTitle
                                  }
                                  onClick={() => openDeleteModal(user)}
                                >
                                  삭제
                                </button>
                              </>
                            )}
                          </div>
                        </td>
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
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4"
          onMouseDown={(event) =>
            event.target === event.currentTarget && setCreateOpen(false)
          }
        >
          <form
            onSubmit={create}
            className="card w-full max-w-lg space-y-4 p-6"
          >
            <h2 className="text-xl font-black">새 사용자 계정</h2>
            <input
              name="displayName"
              className="input"
              placeholder="이름"
              required
            />
            <input
              name="loginId"
              className="input"
              placeholder="아이디"
              required
            />
            <input
              name="password"
              type="password"
              minLength={9}
              className="input"
              placeholder="임시 비밀번호"
              required
            />
            <select
              name="department"
              className="input"
              required
              defaultValue={selectedDepartment ?? ""}
            >
              <option value="" disabled>
                부서를 선택하세요
              </option>
              {DEPARTMENTS.map((department) => (
                <option key={department} value={department}>
                  {department}
                </option>
              ))}
            </select>
            <select name="role" className="input" defaultValue="user">
              {USER_ROLE_OPTIONS.map((role) => (
                <option key={role.value} value={role.value}>
                  {role.label}
                </option>
              ))}
            </select>
            <label className="block text-sm font-bold">
              현재 관리자 비밀번호
              <input
                name="currentPassword"
                type="password"
                className="input mt-1"
                autoComplete="current-password"
                required
              />
            </label>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setCreateOpen(false)}
              >
                취소
              </button>
              <button className="btn-primary">생성</button>
            </div>
          </form>
        </div>
      )}

      {editUser && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4"
          onMouseDown={(event) =>
            event.target === event.currentTarget && setEditUser(null)
          }
        >
          <form
            onSubmit={updateIdentity}
            className="card w-full max-w-lg space-y-5 p-6"
          >
            <div>
              <h2 className="text-xl font-black">
                {isSelfService ? "내 아이디 변경" : "아이디·부서·권한 변경"}
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                {isSelfService
                  ? "아이디를 변경하면 다음 로그인부터 새 아이디를 사용해야 합니다."
                  : `${editUser.display_name}님의 정보가 모든 관련 화면에 함께 반영됩니다.`}
              </p>
            </div>
            <label className="block text-sm font-bold">
              로그인 아이디
              <input
                name="loginId"
                className="input mt-1"
                defaultValue={editUser.login_id}
                pattern="[A-Za-z0-9_-]{4,30}"
                required
              />
            </label>
            {isSelfService ? (
              <>
                <input
                  type="hidden"
                  name="department"
                  value={editUser.department}
                />
                <input type="hidden" name="role" value={editUser.role} />
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <div className="text-xs font-bold text-slate-500">부서</div>
                    <div className="mt-1 font-black">{editUser.department}</div>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <div className="text-xs font-bold text-slate-500">권한</div>
                    <div className="mt-1 font-black">
                      {USER_ROLE_LABELS[editUser.role]}
                    </div>
                  </div>
                </div>
                <p className="rounded-xl bg-blue-50 px-4 py-3 text-sm font-semibold text-blue-800">
                  일반사용자는 본인 아이디와 비밀번호를 직접 변경할 수 있습니다.
                  부서와 권한 변경은 관리자에게 요청하세요.
                </p>
              </>
            ) : (
              <>
                <label className="block text-sm font-bold">
                  부서
                  <select
                    name="department"
                    className="input mt-1"
                    defaultValue={editUser.department}
                    required
                  >
                    {(isFullAdmin ? DEPARTMENTS : [currentUserDepartment]).map(
                      (department) => (
                        <option key={department} value={department}>
                          {department}
                        </option>
                      ),
                    )}
                  </select>
                </label>
                <label className="block text-sm font-bold">
                  권한
                  <select
                    name="role"
                    className="input mt-1"
                    defaultValue={editUser.role}
                    required
                  >
                    {USER_ROLE_OPTIONS.filter(
                      (role) => isFullAdmin || role.value !== "admin",
                    ).map((role) => (
                      <option key={role.value} value={role.value}>
                        {role.label}
                      </option>
                    ))}
                  </select>
                </label>
                {!isFullAdmin && (
                  <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
                    부서관리자는 본인 부서 안에서만 사용자를 관리할 수 있으며
                    관리자 권한은 부여할 수 없습니다.
                  </p>
                )}
              </>
            )}
            <label className="block text-sm font-bold">
              현재 비밀번호
              <input
                name="currentPassword"
                type="password"
                className="input mt-1"
                autoComplete="current-password"
                required
              />
            </label>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setEditUser(null)}
              >
                취소
              </button>
              <button className="btn-primary" disabled={busyId === editUser.id}>
                {busyId === editUser.id ? "변경 중..." : "변경 저장"}
              </button>
            </div>
          </form>
        </div>
      )}

      {resetUser && !isSelfService && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/60 p-4"
          onMouseDown={(event) =>
            event.target === event.currentTarget && closeResetModal()
          }
        >
          <form
            onSubmit={resetPassword}
            className="card w-full max-w-lg space-y-5 p-6"
          >
            <div>
              <h2 className="text-xl font-black">비밀번호 초기화</h2>
              <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
                <strong>{resetUser.display_name}</strong>님의 비밀번호를 무작위 임시
                비밀번호로 초기화합니다. 임시 비밀번호는 30분 동안만 유효합니다.
              </p>
            </div>
            <label className="block text-sm font-bold">
              현재 관리자 비밀번호
              <input
                value={resetCurrentPassword}
                onChange={(event) => {
                  setResetCurrentPassword(event.target.value);
                  setResetError("");
                }}
                type="password"
                className="input mt-2"
                autoComplete="current-password"
                required
                autoFocus
              />
            </label>
            {resetError && (
              <p className="rounded-xl bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700 dark:bg-rose-950/60 dark:text-rose-200">
                {resetError}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="btn-secondary"
                onClick={closeResetModal}
                disabled={busyId === resetUser.id}
              >
                취소
              </button>
              <button
                className="btn-primary disabled:cursor-not-allowed disabled:opacity-40"
                disabled={busyId === resetUser.id || !resetCurrentPassword}
              >
                {busyId === resetUser.id ? "초기화 중..." : "비밀번호 초기화"}
              </button>
            </div>
          </form>
        </div>
      )}

      {temporaryPasswordResult && !isSelfService && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/70 p-4"
          role="presentation"
        >
          <section
            className="card w-full max-w-lg space-y-5 p-6"
            role="dialog"
            aria-modal="true"
            aria-labelledby="temporary-password-result-title"
          >
            <div>
              <h2 id="temporary-password-result-title" className="text-xl font-black">
                임시 비밀번호 발급 완료
              </h2>
              <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
                <strong>{temporaryPasswordResult.displayName}</strong>님에게 아래 아이디와 임시 비밀번호를 별도로 전달하세요.
              </p>
            </div>
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/50">
              <dl className="space-y-3">
                <div>
                  <dt className="text-xs font-bold text-amber-800 dark:text-amber-200">아이디</dt>
                  <dd className="mt-1 break-all font-mono text-lg font-black text-slate-950 dark:text-white">{temporaryPasswordResult.loginId}</dd>
                </div>
                <div>
                  <dt className="text-xs font-bold text-amber-800 dark:text-amber-200">임시 비밀번호</dt>
                  <dd className="mt-1 select-all break-all rounded-xl bg-white px-4 py-3 font-mono text-xl font-black tracking-wide text-slate-950 shadow-sm dark:bg-slate-900 dark:text-white">
                    {temporaryPasswordResult.temporaryPassword}
                  </dd>
                </div>
              </dl>
            </div>
            <p className="rounded-xl bg-rose-50 px-4 py-3 text-sm font-bold leading-6 text-rose-800 dark:bg-rose-950/60 dark:text-rose-200">
              이 팝업을 닫으면 임시 비밀번호를 다시 확인할 수 없습니다. {new Date(temporaryPasswordResult.expiresAt).toLocaleString("ko-KR")}까지 로그인해야 하며, 로그인 직후 새 비밀번호로 변경해야 합니다.
            </p>
            <div className="flex flex-wrap justify-end gap-2">
              <button type="button" className="btn-secondary" onClick={() => void copyTemporaryPassword()}>
                {temporaryPasswordCopied ? "복사 완료" : "비밀번호 복사"}
              </button>
              <button type="button" className="btn-primary" onClick={closeTemporaryPasswordResult}>
                전달 내용 확인 완료
              </button>
            </div>
          </section>
        </div>
      )}

      {passwordOpen && isSelfService && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/60 p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !passwordBusy) {
              setPasswordOpen(false);
              setPasswordError("");
            }
          }}
        >
          <form
            onSubmit={changeOwnPassword}
            className="card w-full max-w-lg space-y-4 p-6"
            role="dialog"
            aria-modal="true"
            aria-labelledby="self-password-change-title"
          >
            <div>
              <h2
                id="self-password-change-title"
                className="text-xl font-black"
              >
                내 비밀번호 변경
              </h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                변경을 완료하면 다음 로그인부터 새 비밀번호를 사용합니다.
              </p>
            </div>
            <div className="rounded-xl bg-slate-50 p-4 text-sm leading-6 text-slate-700">
              <p className="font-bold">{PASSWORD_POLICY_TEXT}</p>
              <p className="mt-1">
                연속 숫자, 전화번호, love·happy·password, qwerty·asdf,
                아이디·이름이 포함된 비밀번호와 최근 비밀번호 5개는 사용할 수
                없습니다.
              </p>
            </div>
            <label className="block text-sm font-bold">
              현재 비밀번호
              <input
                name="currentPassword"
                type="password"
                className="input mt-1"
                maxLength={100}
                autoComplete="current-password"
                required
              />
            </label>
            <label className="block text-sm font-bold">
              새 비밀번호
              <input
                name="password"
                type="password"
                className="input mt-1"
                minLength={9}
                maxLength={100}
                autoComplete="new-password"
                required
              />
            </label>
            <label className="block text-sm font-bold">
              새 비밀번호 확인
              <input
                name="confirmPassword"
                type="password"
                className="input mt-1"
                minLength={9}
                maxLength={100}
                autoComplete="new-password"
                required
              />
            </label>
            {passwordError && (
              <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">
                {passwordError}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="btn-secondary"
                disabled={passwordBusy}
                onClick={() => {
                  setPasswordOpen(false);
                  setPasswordError("");
                }}
              >
                취소
              </button>
              <button className="btn-primary" disabled={passwordBusy}>
                {passwordBusy ? "변경 중..." : "비밀번호 변경"}
              </button>
            </div>
          </form>
        </div>
      )}

      {deleteUser && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/60 p-4"
          onMouseDown={(event) =>
            event.target === event.currentTarget && closeDeleteModal()
          }
        >
          <form
            onSubmit={deleteAccount}
            className="card w-full max-w-lg space-y-5 p-6"
          >
            <div>
              <h2 className="text-xl font-black text-rose-700">
                사용자 계정 삭제
              </h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                <strong>{deleteUser.display_name}</strong>님의 계정과 달력 일정,
                일정 요청, 수신·발신 쪽지 등 관련 기록을 모두 영구 삭제합니다.
              </p>
            </div>
            <label className="block text-sm font-bold">
              확인을 위해 아이디{" "}
              <strong className="text-rose-700">{deleteUser.login_id}</strong>{" "}
              입력
              <input
                value={deleteLoginId}
                onChange={(event) => {
                  setDeleteLoginId(event.target.value);
                  setDeleteError("");
                }}
                className="input mt-2"
                placeholder={deleteUser.login_id}
                autoComplete="off"
                autoFocus
                required
              />
            </label>
            <label className="block text-sm font-bold">
              현재 관리자 비밀번호
              <input
                value={deleteCurrentPassword}
                onChange={(event) => {
                  setDeleteCurrentPassword(event.target.value);
                  setDeleteError("");
                }}
                type="password"
                className="input mt-2"
                autoComplete="current-password"
                required
              />
            </label>
            {deleteError && (
              <p className="rounded-xl bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
                {deleteError}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="btn-secondary"
                onClick={closeDeleteModal}
                disabled={busyId === deleteUser.id}
              >
                취소
              </button>
              <button
                className="btn-danger disabled:cursor-not-allowed disabled:opacity-40"
                disabled={
                  busyId === deleteUser.id ||
                  deleteLoginId.trim() !== deleteUser.login_id ||
                  !deleteCurrentPassword
                }
              >
                {busyId === deleteUser.id ? "삭제 중..." : "영구 삭제"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
