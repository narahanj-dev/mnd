"use client";

import { ArrowLeft, CalendarDays, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { EVENT_TYPE_STYLES, USER_ROLE_LABELS } from "@/lib/constants";
import { parseJsonResponse } from "@/lib/utils";
import type { UsageCategorySummary, UsageDetailResponse } from "@/types";

function formatDate(date: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
    timeZone: "Asia/Seoul",
  }).format(new Date(`${date}T00:00:00+09:00`));
}

export function UsageDetail({ userId }: { userId: string }) {
  const [data, setData] = useState<UsageDetailResponse | null>(null);
  const [selected, setSelected] = useState<UsageCategorySummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await parseJsonResponse<UsageDetailResponse>(
        await fetch(`/api/usage/${userId}`, { cache: "no-store" }),
      );
      setData(result);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "사용현황을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!selected) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelected(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", closeOnEscape);
      document.body.style.overflow = "";
    };
  }, [selected]);

  if (loading) return <div className="card p-8 text-center text-slate-500">사용현황을 불러오는 중...</div>;

  if (error || !data) {
    return (
      <div>
        <Link href="/usage" className="mb-4 inline-flex items-center gap-1 text-sm font-bold text-blue-700">
          <ArrowLeft size={16} /> 사용자 목록
        </Link>
        <div className="card border-rose-200 p-6 text-rose-700">{error || "사용현황을 찾을 수 없습니다."}</div>
      </div>
    );
  }

  return (
    <div>
      <Link href="/usage" className="mb-4 inline-flex items-center gap-1 text-sm font-bold text-blue-700 hover:underline">
        <ArrowLeft size={16} /> 사용자 목록으로
      </Link>

      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black">{data.user.display_name} 사용현황</h1>
          <p className="mt-1 text-sm text-slate-500">
            {data.user.department} · {USER_ROLE_LABELS[data.user.role]} · 아이디 {data.user.login_id}
          </p>
        </div>
        <p className="text-xs text-slate-400">승인 완료된 일정만 집계됩니다.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {data.categories.map((category) => (
          <button
            key={category.eventType}
            type="button"
            onClick={() => setSelected(category)}
            className="card p-5 text-left transition hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-lg"
          >
            <div className="flex items-center justify-between gap-3">
              <span className={`rounded-full border px-3 py-1 text-sm font-black ${EVENT_TYPE_STYLES[category.eventType]}`}>
                {category.label}
              </span>
              <CalendarDays size={20} className="text-slate-400" />
            </div>
            <div className="mt-6 flex items-end gap-1">
              <strong className="text-4xl font-black text-slate-900">{category.totalDays}</strong>
              <span className="pb-1 text-sm font-bold text-slate-500">일</span>
            </div>
            <div className="mt-3 text-xs text-slate-400">등록 일정 {category.eventCount}건 · 상세보기</div>
          </button>
        ))}
      </div>

      <div className="card mt-5 p-5 text-sm text-slate-500">
        사용일수는 각 일정의 시작일과 종료일을 포함한 실제 날짜를 기준으로 계산하며, 같은 항목에서 날짜가 겹치면 한 번만 집계합니다.
      </div>

      {selected && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setSelected(null);
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="usage-detail-title"
            className="card flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden"
          >
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 p-5">
              <div>
                <div className={`mb-2 inline-flex rounded-full border px-3 py-1 text-sm font-black ${EVENT_TYPE_STYLES[selected.eventType]}`}>
                  {selected.label}
                </div>
                <h2 id="usage-detail-title" className="text-xl font-black">
                  총 사용일수 {selected.totalDays}일
                </h2>
                <p className="mt-1 text-sm text-slate-500">승인 일정 {selected.eventCount}건</p>
              </div>
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"
                aria-label="상세 팝업 닫기"
              >
                <X size={22} />
              </button>
            </div>

            <div className="overflow-y-auto p-5">
              {selected.events.length === 0 ? (
                <div className="rounded-xl bg-slate-50 p-8 text-center text-slate-500">사용 내역이 없습니다.</div>
              ) : (
                <div className="space-y-4">
                  {selected.events.map((event) => (
                    <article key={event.id} className="rounded-xl border border-slate-200 p-4">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <strong className="text-base">{event.title}</strong>
                        <span className="text-sm font-black text-blue-700">{event.dates.length}일</span>
                      </div>
                      <p className="mt-2 text-sm text-slate-600">
                        {formatDate(event.start_date)}
                        {event.start_date !== event.end_date && ` ~ ${formatDate(event.end_date)}`}
                      </p>
                      {(event.description || event.public_note) && (
                        <div className="mt-3 rounded-lg bg-slate-50 p-3 text-sm text-slate-600">
                          {event.description && <p>{event.description}</p>}
                          {event.public_note && <p className={event.description ? "mt-1" : ""}>{event.public_note}</p>}
                        </div>
                      )}
                      <div className="mt-3">
                        <div className="mb-2 text-xs font-black text-slate-500">사용 날짜</div>
                        <div className="flex flex-wrap gap-2">
                          {event.dates.map((date) => (
                            <span key={date} className="rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">
                              {formatDate(date)}
                            </span>
                          ))}
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
