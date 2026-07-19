"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Factor = { id: string; status: string; friendly_name?: string };

export function MfaGate() {
  const router = useRouter();
  const [factor, setFactor] = useState<Factor | null>(null);
  const [qrCode, setQrCode] = useState("");
  const [secret, setSecret] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    void (async () => {
      const supabase = createClient();
      const { data: level } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (level?.currentLevel === "aal2") {
        router.replace("/calendar");
        router.refresh();
        return;
      }
      const { data, error: listError } = await supabase.auth.mfa.listFactors();
      if (!active) return;
      if (listError) {
        setError("추가 인증 정보를 확인하지 못했습니다.");
        setLoading(false);
        return;
      }
      const verified = data.totp.find((item) => item.status === "verified") as Factor | undefined;
      if (verified) {
        setFactor(verified);
        setLoading(false);
        return;
      }
      // 새로고침 중 남은 미검증 요소를 정리해 불필요한 TOTP 등록이 누적되지 않게 합니다.
      for (const pendingFactor of data.totp.filter((item) => item.status !== "verified")) {
        await supabase.auth.mfa.unenroll({ factorId: pendingFactor.id });
      }
      const { data: enrolled, error: enrollError } = await supabase.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: "부대달력 관리자 인증",
      });
      if (!active) return;
      if (enrollError || !enrolled) {
        setError("인증 앱 등록을 시작하지 못했습니다.");
      } else {
        setFactor({ id: enrolled.id, status: "unverified" });
        setQrCode(enrolled.totp.qr_code);
        setSecret(enrolled.totp.secret);
      }
      setLoading(false);
    })();
    return () => { active = false; };
  }, [router]);

  async function verify(event: FormEvent) {
    event.preventDefault();
    if (!factor || !/^\d{6}$/.test(code)) {
      setError("인증 앱에 표시된 6자리 코드를 입력하세요.");
      return;
    }
    setLoading(true);
    setError("");
    const supabase = createClient();
    const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({
      factorId: factor.id,
      code,
    });
    if (verifyError) {
      setError("인증 코드가 올바르지 않거나 만료되었습니다.");
      setLoading(false);
      return;
    }
    router.replace("/calendar");
    router.refresh();
  }

  return (
    <form onSubmit={verify} className="card mx-auto max-w-lg space-y-5 p-6 sm:p-8">
      <h1 className="text-2xl font-black">관리자 추가 인증</h1>
      <p className="text-sm text-slate-600 dark:text-slate-300">관리자 및 부서관리자는 인증 앱의 일회용 코드를 확인해야 합니다.</p>
      {qrCode && (
        <div className="space-y-3 rounded-xl bg-white p-4 text-center dark:bg-slate-900">
          {/* Supabase가 반환하는 QR 데이터 URI만 사용합니다. */}
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
