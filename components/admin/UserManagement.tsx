"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { DEPARTMENTS } from "@/lib/constants";
import { parseJsonResponse } from "@/lib/utils";
import type { Profile } from "@/types";

type UsersResponse = {
  users: Profile[];
  currentUserId: string;
};

export function UserManagement() {
  const [users, setUsers] = useState<Profile[]>([]);
  const [currentUserId, setCurrentUserId] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [editUser, setEditUser] = useState<Profile | null>(null);
  const [deleteUser, setDeleteUser] = useState<Profile | null>(null);
  const [deleteLoginId, setDeleteLoginId] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    try {
      const data = await parseJsonResponse<UsersResponse>(
        await fetch("/api/admin/users", { cache: "no-store" }),
      );
      setUsers(data.users);
      setCurrentUserId(data.currentUserId);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "사용자 목록을 불러오지 못했습니다.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

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
      await load();
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
      await parseJsonResponse(
        await fetch(`/api/admin/users/${editUser.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "updateIdentity",
            loginId: form.get("loginId"),
            department: form.get("department"),
          }),
        }),
      );
      setEditUser(null);
      setMessage("아이디와 부서를 변경했습니다. 달력과 관련 화면에도 즉시 반영됩니다.");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "사용자 정보 수정에 실패했습니다.");
    } finally {
      setBusyId(null);
    }
  }

  async function resetPassword(user: Profile) {
    const confirmed = window.confirm(
      `${user.display_name}님의 비밀번호를 12345로 초기화하시겠습니까?`,
    );
    if (!confirmed) return;

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
      await load();
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
        }),
      );
      setDeleteUser(null);
      setDeleteLoginId("");
      setMessage(`${target.display_name} 계정과 관련 데이터를 모두 삭제했습니다.`);
      await load();
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : "계정 삭제에 실패했습니다.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black">사용자 관리</h1>
          <p className="mt-1 text-sm text-slate-500">
            삭제하면 계정과 해당 사용자의 일정·쪽지·요청 기록이 모두 영구 삭제됩니다.
          </p>
        </div>
        <button className="btn-primary" onClick={() => setCreateOpen(true)}>
          + 사용자 생성
        </button>
      </div>

      {message && (
        <p className="mb-4 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold">
          {message}
        </p>
      )}

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[1050px] text-sm">
          <thead className="bg-slate-50 text-left">
            <tr>
              {["이름", "아이디", "부서", "권한", "상태", "최근 로그인", "관리"].map(
                (heading) => (
                  <th key={heading} className="p-3">
                    {heading}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {users.map((user) => {
              const busy = busyId === user.id;
              const isCurrentUser = currentUserId === user.id;
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
                  <td className="p-3">{user.role === "admin" ? "관리자" : "일반 사용자"}</td>
                  <td className="p-3">{user.account_status === "active" ? "활성" : "비활성"}</td>
                  <td className="p-3">
                    {user.last_login_at
                      ? new Date(user.last_login_at).toLocaleString("ko-KR")
                      : "-"}
                  </td>
                  <td className="p-3">
                    <div className="flex flex-wrap gap-2">
                      <button
                        className="btn-secondary text-xs"
                        disabled={busy}
                        onClick={() => setEditUser(user)}
                      >
                        아이디·부서 변경
                      </button>
                      <button
                        className="btn-secondary text-xs"
                        disabled={busy}
                        onClick={() => void resetPassword(user)}
                      >
                        비밀번호 초기화
                      </button>
                      <button
                        className="btn-danger text-xs disabled:cursor-not-allowed disabled:opacity-40"
                        disabled={busy || isCurrentUser}
                        title={
                          isCurrentUser
                            ? "현재 로그인한 관리자 계정은 삭제할 수 없습니다."
                            : undefined
                        }
                        onClick={() => openDeleteModal(user)}
                      >
                        삭제
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {createOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4"
          onMouseDown={(event) => event.target === event.currentTarget && setCreateOpen(false)}
        >
          <form onSubmit={create} className="card w-full max-w-lg space-y-4 p-6">
            <h2 className="text-xl font-black">새 사용자 계정</h2>
            <input name="displayName" className="input" placeholder="이름" required />
            <input name="loginId" className="input" placeholder="아이디" required />
            <input
              name="password"
              type="password"
              className="input"
              placeholder="임시 비밀번호"
              required
            />
            <select name="department" className="input" required defaultValue="">
              <option value="" disabled>
                부서를 선택하세요
              </option>
              {DEPARTMENTS.map((department) => (
                <option key={department} value={department}>
                  {department}
                </option>
              ))}
            </select>
            <select name="role" className="input">
              <option value="user">일반 사용자</option>
              <option value="admin">관리자</option>
            </select>
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-secondary" onClick={() => setCreateOpen(false)}>
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
          onMouseDown={(event) => event.target === event.currentTarget && setEditUser(null)}
        >
          <form onSubmit={updateIdentity} className="card w-full max-w-lg space-y-5 p-6">
            <div>
              <h2 className="text-xl font-black">아이디·부서 변경</h2>
              <p className="mt-1 text-sm text-slate-500">
                {editUser.display_name}님의 정보가 달력 일정과 모든 관련 화면에 함께 반영됩니다.
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
            <label className="block text-sm font-bold">
              부서
              <select
                name="department"
                className="input mt-1"
                defaultValue={editUser.department}
                required
              >
                {DEPARTMENTS.map((department) => (
                  <option key={department} value={department}>
                    {department}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-secondary" onClick={() => setEditUser(null)}>
                취소
              </button>
              <button className="btn-primary" disabled={busyId === editUser.id}>
                {busyId === editUser.id ? "변경 중..." : "변경 저장"}
              </button>
            </div>
          </form>
        </div>
      )}

      {deleteUser && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/60 p-4"
          onMouseDown={(event) => event.target === event.currentTarget && closeDeleteModal()}
        >
          <form onSubmit={deleteAccount} className="card w-full max-w-lg space-y-5 p-6">
            <div>
              <h2 className="text-xl font-black text-rose-700">사용자 계정 삭제</h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                <strong>{deleteUser.display_name}</strong>님의 계정과 달력 일정, 일정 요청,
                수신·발신 쪽지 등 관련 기록을 모두 영구 삭제합니다. 삭제 후에는 복구할 수
                없습니다.
              </p>
            </div>

            <label className="block text-sm font-bold">
              확인을 위해 아이디 <strong className="text-rose-700">{deleteUser.login_id}</strong> 입력
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
                disabled={busyId === deleteUser.id || deleteLoginId.trim() !== deleteUser.login_id}
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
