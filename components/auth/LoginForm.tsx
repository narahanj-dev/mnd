"use client";

import { LockKeyhole, Settings, UserRoundPlus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { parseJsonResponse } from "@/lib/utils";

export function LoginForm() {
  const router = useRouter();
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);

  async function submit(event: FormEvent, adminOnly = false) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const result = await parseJsonResponse<{ role: "user" | "admin" }>(await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ loginId, password, adminOnly }),
      }));
      router.replace(adminOnly || result.role === "admin" ? "/admin/settings" : "/calendar");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "로그인에 실패했습니다.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <form onSubmit={(event) => submit(event)} className="space-y-4">
        <label className="block text-sm font-bold text-slate-700">아이디
          <input className="input mt-1.5" value={loginId} onChange={(e) => setLoginId(e.target.value)} inputMode="text" autoComplete="username" required />
        </label>
        <label className="block text-sm font-bold text-slate-700">비밀번호
          <input className="input mt-1.5" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
        </label>
        {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">{error}</p>}
        <button className="btn-primary flex w-full items-center justify-center gap-2" disabled={loading}>
          <LockKeyhole size={18} /> {loading ? "로그인 중..." : "로그인"}
        </button>
        <div className="grid grid-cols-2 gap-2">
          <Link href="/signup-request" className="btn-secondary flex items-center justify-center gap-1.5 text-sm"><UserRoundPlus size={16} /> 회원가입 신청</Link>
          <button type="button" onClick={() => setAdminOpen(true)} className="btn-secondary flex items-center justify-center gap-1.5 text-sm"><Settings size={16} /> 관리자 설정</button>
        </div>
      </form>

      {adminOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4" onMouseDown={(e) => e.target === e.currentTarget && setAdminOpen(false)}>
          <form onSubmit={(event) => submit(event, true)} className="card w-full max-w-md p-6" role="dialog" aria-modal="true" aria-label="관리자 로그인">
            <h2 className="text-xl font-black">관리자 설정 로그인</h2>
            <p className="mt-1 text-sm text-slate-500">관리자 계정만 접근할 수 있습니다.</p>
            <div className="mt-5 space-y-4">
              <input className="input" placeholder="관리자 아이디" value={loginId} onChange={(e) => setLoginId(e.target.value)} required />
              <input className="input" type="password" placeholder="관리자 비밀번호" value={password} onChange={(e) => setPassword(e.target.value)} required />
              {error && <p className="text-sm font-semibold text-rose-700">{error}</p>}
              <div className="flex justify-end gap-2">
                <button type="button" className="btn-secondary" onClick={() => setAdminOpen(false)}>취소</button>
                <button className="btn-primary" disabled={loading}>관리자 로그인</button>
              </div>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
