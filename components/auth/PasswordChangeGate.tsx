"use client";

import { FormEvent, ReactNode, useState } from "react";
import { useRouter } from "next/navigation";
import { parseJsonResponse } from "@/lib/utils";
import { PASSWORD_POLICY_TEXT } from "@/lib/security/password-policy";

export function PasswordChangeGate({ required, children }: { required: boolean; children: ReactNode }) {
  const router = useRouter();
  const [open, setOpen] = useState(required);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") || "");
    const confirmPassword = String(form.get("confirmPassword") || "");
    if (password !== confirmPassword) {
      setError("비밀번호 확인이 일치하지 않습니다.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      await parseJsonResponse(await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      }));
      setOpen(false);
      router.refresh();
    } catch (changeError) {
      setError(changeError instanceof Error ? changeError.message : "비밀번호 변경에 실패했습니다.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      {children}
      {open && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/70 p-4">
          <form onSubmit={submit} className="card w-full max-w-lg space-y-4 p-6" role="dialog" aria-modal="true">
            <div>
              <h2 className="text-xl font-black">비밀번호 변경 필요</h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">임시 비밀번호이거나 마지막 변경 후 6개월이 지났습니다. 변경을 완료해야 계속 사용할 수 있습니다.</p>
            </div>
            <div className="rounded-xl bg-slate-50 p-4 text-sm leading-6 text-slate-700">
              <p className="font-bold">{PASSWORD_POLICY_TEXT}</p>
              <p className="mt-1">연속 숫자, 전화번호, love·happy·password, qwerty·asdf, 아이디·이름 포함 비밀번호는 사용할 수 없습니다. 최근 비밀번호 5개도 재사용할 수 없습니다.</p>
            </div>
            <label className="block text-sm font-bold">새 비밀번호<input name="password" type="password" className="input mt-1" minLength={9} autoComplete="new-password" required /></label>
            <label className="block text-sm font-bold">새 비밀번호 확인<input name="confirmPassword" type="password" className="input mt-1" minLength={9} autoComplete="new-password" required /></label>
            {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">{error}</p>}
            <button className="btn-primary w-full" disabled={loading}>{loading ? "변경 중..." : "비밀번호 변경"}</button>
          </form>
        </div>
      )}
    </>
  );
}
