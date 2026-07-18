"use client";

import { TimerReset } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

const SESSION_TIMEOUT_SECONDS = 300;

function formatRemainingTime(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

export function SessionTimeout() {
  const pathname = usePathname();
  const router = useRouter();
  const deadlineRef = useRef(0);
  const logoutStartedRef = useRef(false);
  const [remainingSeconds, setRemainingSeconds] = useState(SESSION_TIMEOUT_SECONDS);

  const logoutByTimeout = useCallback(async () => {
    if (logoutStartedRef.current) return;
    logoutStartedRef.current = true;
    setRemainingSeconds(0);

    try {
      await fetch("/api/auth/logout", { method: "POST", keepalive: true });
    } finally {
      router.replace("/login?reason=session-timeout");
      router.refresh();
    }
  }, [router]);

  useEffect(() => {
    logoutStartedRef.current = false;
    deadlineRef.current = Date.now() + SESSION_TIMEOUT_SECONDS * 1000;
    setRemainingSeconds(SESSION_TIMEOUT_SECONDS);

    const updateRemainingTime = () => {
      const nextRemaining = Math.max(
        0,
        Math.ceil((deadlineRef.current - Date.now()) / 1000),
      );
      setRemainingSeconds(nextRemaining);
      if (nextRemaining === 0) void logoutByTimeout();
    };

    updateRemainingTime();
    const timerId = window.setInterval(updateRemainingTime, 250);
    return () => window.clearInterval(timerId);
  }, [pathname, logoutByTimeout]);

  return (
    <div
      className={`flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-black tabular-nums ${
        remainingSeconds <= 60
          ? "bg-rose-100 text-rose-800"
          : "bg-slate-100 text-slate-700"
      }`}
      title="페이지 이동 또는 새로고침 시 5분으로 초기화됩니다."
      aria-live={remainingSeconds <= 10 ? "assertive" : "off"}
      aria-label={`자동 로그아웃까지 ${formatRemainingTime(remainingSeconds)}`}
    >
      <TimerReset size={15} aria-hidden="true" />
      {formatRemainingTime(remainingSeconds)}
    </div>
  );
}
