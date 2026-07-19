"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { parseJsonResponse } from "@/lib/utils";

type StatusResponse = {
  currentLevel: "aal1" | "aal2" | null;
  factorId: string | null;
  needsEnrollment: boolean;
};

type EnrollResponse = {
  factorId: string;
  qrCode?: string;
  secret?: string;
  alreadyEnrolled?: boolean;
};

export function MfaGate() {
  const router = useRouter();
  const [factorId, setFactorId] = useState<string | null>(null);
  const [qrCode, setQrCode] = useState("");
  const [secret, setSecret] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const status = await parseJsonResponse<StatusResponse>(
          await fetch("/api/auth/mfa", { cache: "no-store" }),
        );
        if (!active) return;
        if (status.currentLevel === "aal2") {
          router.replace("/calendar");
          router.refresh();
          return;
        }
        if (status.factorId) {
          setFactorId(status.factorId);
          setLoading(false);
          return;
        }
        const enrolled = await parseJsonResponse<EnrollResponse>(
          await fetch("/api/auth/mfa", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "enroll" }),
          }),
        );
        if (!active) return;
        setFactorId(enrolled.factorId);
        setQrCode(enrolled.qrCode ?? "");
        setSecret(enrolled.secret ?? "");
      } catch (loadError) {
        if (active) setError(loadError instanceof Error ? loadError.message : "추가 인증 정보를 확인하지 못했습니다.");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [router]);

  async function verify(event: FormEvent) {
    event.preventDefault();
    if (!factorId || !/^\d{6}$/.test(code)) {
      setError("인증 앱에 표시된 6자리 코드를 입력하세요.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      await parseJsonResponse(
        await fetch("/api/auth/mfa", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "verify", factorId, code }),
        }),
      );
      router.replace("/calendar");
      router.refresh();
    } catch (verifyError) {
      setError(verifyError instanceof Error ? verifyError.message : "인증 코드가 올바르지 않거나 만료되었습니다.");
      setLoading(false);
    }
  }

  return (
    <form onSubmit={verify} className="card mx-auto max-w-lg space-y-5 p-6 sm:p-8">
      <h1 className="text-2xl font-black">관리자 추가 인증</h1>
      <p className="text-sm text-slate-600 dark:text-slate-300">관리자 및 부서관리자는 인증 앱의 일회용 코드를 확인해야 합니다.</p>
      {qrCode && (
        <div className="space-y-3 rounded-xl bg-white p-4 text-center dark:bg-slate-900">
          {/* 서버가 Supabase에서 받은 QR 데이터 URI만 사용합니다. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qrCode} alt="인증 앱 등록 QR 코드" className="mx-auto h-56 w-56" />
          <p className="break-all text-xs text-slate-500">QR 인식이 어려우면 다음 키를 직접 입력하세요: <strong>{secret}</strong></p>
        </div>
      )}
      <label className="block text-sm font-bold">6자리 인증 코드
        <input value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" className="input mt-1" required />
      </label>
      {error && <p className="rounded-lg bg-rose-50 p-3 text-sm font-semibold text-rose-700 dark:bg-rose-950/60 dark:text-rose-200">{error}</p>}
      <button className="btn-primary w-full" disabled={loading}>{loading ? "확인 중..." : "추가 인증 완료"}</button>
    </form>
  );
}
