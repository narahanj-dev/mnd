"use client";

import { LockKeyhole } from "lucide-react";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { parseJsonResponse } from "@/lib/utils";

export function LoginForm() {
  const router = useRouter();
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const result = await parseJsonResponse<{ mfaRequired?: boolean }>(await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ loginId, password }),
      }));
      router.replace(result.mfaRequired ? "/mfa" : "/calendar");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "로그인에 실패했습니다.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
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
    </form>
  );
}
