"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { DEPARTMENTS } from "@/lib/constants";
import { PASSWORD_POLICY_TEXT } from "@/lib/security/password-policy";
import { parseJsonResponse } from "@/lib/utils";

export function SignupRequestForm() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") || "");
    const confirmPassword = String(form.get("confirmPassword") || "");

    if (password !== confirmPassword) {
      setError("비밀번호 확인이 일치하지 않습니다.");
      setLoading(false);
      return;
    }

    try {
      await parseJsonResponse(await fetch("/api/signup-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(Object.fromEntries(form.entries())),
      }));
      alert("회원가입 신청이 접수되었습니다. 관리자 승인을 기다려주세요.");
      router.push("/login");
    } catch (err) {
      setError(err instanceof Error ? err.message : "신청에 실패했습니다.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} className="card mx-auto max-w-xl space-y-4 p-6 sm:p-8">
      <h1 className="text-2xl font-black">회원가입 신청</h1>
      <p className="text-sm text-slate-500">생년은 수집하지 않으며 생일 월/일만 암호화하여 저장합니다.</p>
      <label className="block text-sm font-bold">이름<input name="name" className="input mt-1" required maxLength={50} /></label>
      <fieldset>
        <legend className="text-sm font-bold">생일(월/일)</legend>
        <div className="mt-1 grid grid-cols-2 gap-2">
          <label className="text-xs text-slate-500">월<input name="birthMonth" type="number" min={1} max={12} className="input mt-1" placeholder="월" required /></label>
          <label className="text-xs text-slate-500">일<input name="birthDay" type="number" min={1} max={31} className="input mt-1" placeholder="일" required /></label>
        </div>
      </fieldset>
      <label className="block text-sm font-bold">소속 부서<select name="department" className="input mt-1" required defaultValue=""><option value="" disabled>부서를 선택하세요</option>{DEPARTMENTS.map((department) => <option key={department} value={department}>{department}</option>)}</select></label>
      <label className="block text-sm font-bold">희망 아이디<input name="requestedLoginId" className="input mt-1" required minLength={4} maxLength={30} pattern="[A-Za-z0-9_-]{4,30}" autoComplete="username" /></label>
      <label className="block text-sm font-bold">
        회원가입 코드
        <input
          name="inviteCode"
          type="password"
          className="input mt-1"
          required
          minLength={4}
          maxLength={100}
          autoComplete="off"
          aria-describedby="signup-invite-code-help"
        />
        <span id="signup-invite-code-help" className="mt-1 block text-xs font-normal text-slate-500 dark:text-slate-400">
          관리자에게 구두로 안내받은 코드를 입력하세요. 코드는 가입신청 정보에 저장되지 않습니다.
        </span>
      </label>
      <div className="rounded-xl bg-slate-50 p-4 text-sm leading-6 text-slate-700">
        <p className="font-bold">{PASSWORD_POLICY_TEXT}</p>
        <p className="mt-1">연속 문자열, 전화번호형 숫자열, 잘 알려진 단어, 아이디 또는 이름이 포함된 비밀번호는 사용할 수 없습니다.</p>
      </div>
      <label className="block text-sm font-bold">비밀번호<input name="password" type="password" className="input mt-1" required minLength={9} maxLength={100} autoComplete="new-password" /></label>
      <label className="block text-sm font-bold">비밀번호 확인<input name="confirmPassword" type="password" className="input mt-1" required minLength={9} maxLength={100} autoComplete="new-password" /></label>
      <label className="block text-sm font-bold">신청 사유<textarea name="reason" className="input mt-1 min-h-28" maxLength={500} /></label>
      {error && <p className="text-sm font-semibold text-rose-700">{error}</p>}
      <div className="flex justify-end gap-2"><button type="button" onClick={() => router.back()} className="btn-secondary">취소</button><button className="btn-primary" disabled={loading}>{loading ? "접수 중..." : "신청하기"}</button></div>
    </form>
  );
}
