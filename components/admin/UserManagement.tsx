"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { parseJsonResponse } from "@/lib/utils";
import type { Profile } from "@/types";

export function UserManagement() {
  const [users, setUsers] = useState<Profile[]>([]);
  const [open, setOpen] = useState(false);
  const load = useCallback(async () => { const data = await parseJsonResponse<{ users: Profile[] }>(await fetch("/api/admin/users", { cache: "no-store" })); setUsers(data.users); }, []);
  useEffect(() => { load(); }, [load]);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    await parseJsonResponse(await fetch("/api/admin/users", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.fromEntries(form.entries())) }));
    alert("사용자 계정을 생성했습니다."); setOpen(false); await load();
  }
  async function toggle(user: Profile) { await parseJsonResponse(await fetch(`/api/admin/users/${user.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accountStatus: user.account_status === "active" ? "inactive" : "active" }) })); await load(); }
  async function reset(user: Profile) { const password = prompt(`${user.display_name}의 새 임시 비밀번호를 입력하세요.`); if (!password) return; await parseJsonResponse(await fetch(`/api/admin/users/${user.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) })); alert("비밀번호를 초기화했습니다."); }

  return <div><div className="mb-5 flex items-center justify-between"><h1 className="text-2xl font-black">사용자 관리</h1><button className="btn-primary" onClick={() => setOpen(true)}>+ 사용자 생성</button></div><div className="card overflow-x-auto"><table className="w-full min-w-[850px] text-sm"><thead className="bg-slate-50 text-left"><tr>{["이름","아이디","부서","권한","상태","최근 로그인","관리"].map((h) => <th key={h} className="p-3">{h}</th>)}</tr></thead><tbody className="divide-y divide-slate-200">{users.map((user) => <tr key={user.id}><td className="p-3 font-bold">{user.display_name}</td><td className="p-3">{user.login_id}</td><td className="p-3">{user.department}</td><td className="p-3">{user.role === "admin" ? "관리자" : "일반 사용자"}</td><td className="p-3">{user.account_status === "active" ? "활성" : "비활성"}</td><td className="p-3">{user.last_login_at ? new Date(user.last_login_at).toLocaleString("ko-KR") : "-"}</td><td className="p-3"><div className="flex gap-2"><button className="btn-secondary text-xs" onClick={() => reset(user)}>비밀번호 초기화</button><button className="btn-secondary text-xs" onClick={() => toggle(user)}>{user.account_status === "active" ? "비활성화" : "활성화"}</button></div></td></tr>)}</tbody></table></div>{open && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}><form onSubmit={create} className="card w-full max-w-lg space-y-4 p-6"><h2 className="text-xl font-black">새 사용자 계정</h2><input name="displayName" className="input" placeholder="이름" required /><input name="loginId" className="input" placeholder="아이디" required /><input name="password" type="password" className="input" placeholder="임시 비밀번호" required /><input name="department" className="input" placeholder="소속 부서" required /><select name="role" className="input"><option value="user">일반 사용자</option><option value="admin">관리자</option></select><div className="flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={() => setOpen(false)}>취소</button><button className="btn-primary">생성</button></div></form></div>}</div>;
}
