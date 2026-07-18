"use client";

import { ArrowLeft, CalendarDays, Check, Filter, X } from "lucide-react";
import Link from "next/link";
import { FormEvent, useCallback, useMemo, useState } from "react";
import { StatusBadge } from "@/components/common/StatusBadge";
import { EVENT_TYPE_STYLES, USER_ROLE_LABELS, formatEventLabel } from "@/lib/constants";
import { parseJsonResponse } from "@/lib/utils";
import type {
  CalendarEvent,
  EventChangeRequest,
  RequestStatus,
  UsageEventType,
  UsageUserSummary,
  UserRole,
} from "@/types";
import { EventEditModal } from "./EventEditModal";

type Period = {
  year: number;
  month: number;
};

type DetailResponse = {
  user: UsageUserSummary;
  viewerId: string;
  viewerRole: UserRole;
  year: number;
  month: number;
  events: CalendarEvent[];
  requests: EventChangeRequest[];
};

const FILTER_OPTIONS: { value: UsageEventType; label: string }[] = [
  { value: "leave", label: "휴가" },
  { value: "overnight", label: "외박" },
  { value: "weekend_outing", label: "외출" },
  { value: "weekday_outing", label: "평일외출" },
];

const requestStatusLabels: Record<RequestStatus, string> = {
  pending: "승인 대기",
  approved: "승인",
  rejected: "거절",
};

const requestStatusStyles: Record<RequestStatus, string> = {
  pending: "bg-amber-100 text-amber-800",
  approved: "bg-emerald-100 text-emerald-800",
  rejected: "bg-rose-100 text-rose-800",
};

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Seoul",
  }).format(new Date(value));
}

export function MyEventsDetail({ userId }: { userId: string }) {
  const now = new Date();
  const [draftYear, setDraftYear] = useState(now.getFullYear());
  const [draftMonth, setDraftMonth] = useState(now.getMonth() + 1);
  const [period, setPeriod] = useState<Period | null>(null);
  const [periodDialogOpen, setPeriodDialogOpen] = useState(true);
  const [data, setData] = useState<DetailResponse | null>(null);
  const [editing, setEditing] = useState<CalendarEvent | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [enabledTypes, setEnabledTypes] = useState<Record<UsageEventType, boolean>>({
    leave: true,
    overnight: true,
    weekend_outing: true,
    weekday_outing: true,
  });

  const years = useMemo(() => {
    const currentYear = new Date().getFullYear();
    return Array.from({ length: 26 }, (_, index) => currentYear + 5 - index);
  }, []);

  const load = useCallback(
    async (selectedPeriod: Period) => {
      setLoading(true);
      setError("");
      try {
        const response = await parseJsonResponse<DetailResponse>(
          await fetch(
            `/api/my-events/${userId}?year=${selectedPeriod.year}&month=${selectedPeriod.month}`,
            { cache: "no-store" },
          ),
        );
        setData(response);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "일정을 불러오지 못했습니다.");
      } finally {
        setLoading(false);
      }
    },
    [userId],
  );

  function applyPeriod(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const selected = { year: draftYear, month: draftMonth };
    setPeriod(selected);
    setPeriodDialogOpen(false);
    void load(selected);
  }

  const requestsByEvent = useMemo(() => {
    const map = new Map<string, EventChangeRequest[]>();
    (data?.requests ?? []).forEach((request) => {
      const list = map.get(request.event_id) ?? [];
      list.push(request);
      map.set(request.event_id, list);
    });
    return map;
  }, [data?.requests]);

  const visibleEvents = useMemo(
    () => (data?.events ?? []).filter((event) => enabledTypes[event.event_type as UsageEventType]),
    [data?.events, enabledTypes],
  );

  const eventCounts = useMemo(() => {
    const counts: Record<UsageEventType, number> = {
      leave: 0,
      overnight: 0,
      weekend_outing: 0,
      weekday_outing: 0,
    };
    (data?.events ?? []).forEach((event) => {
      if (event.event_type in counts) counts[event.event_type as UsageEventType] += 1;
    });
    return counts;
  }, [data?.events]);

  async function refresh() {
    if (period) await load(period);
  }

  async function remove(event: CalendarEvent) {
    if (!data) return;
    const isAdmin = data.viewerRole === "admin";
    const reason = prompt(
      isAdmin ? "사용자에게 전달할 삭제 사유를 입력하세요." : "관리자에게 전달할 삭제 사유를 입력하세요.",
    )?.trim();
    if (!reason) return;
    if (!confirm(isAdmin ? "이 일정을 즉시 삭제하시겠습니까?" : "이 일정의 삭제 승인을 요청하시겠습니까?")) return;

    try {
      const result = await parseJsonResponse<{ message?: string }>(
        await fetch(`/api/events/${event.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "delete", reason }),
        }),
      );
      alert(result.message ?? (isAdmin ? "일정이 삭제되었습니다." : "삭제 요청이 접수되었습니다."));
      await refresh();
    } catch (actionError) {
      alert(actionError instanceof Error ? actionError.message : "삭제 처리에 실패했습니다.");
    }
  }

  async function decideEvent(id: string, decision: "approve" | "reject") {
    let reason = "";
    if (decision === "reject") {
      reason = prompt("거절 사유를 입력하세요.")?.trim() ?? "";
      if (!reason) return;
    }
    if (!confirm(decision === "approve" ? "이 일정을 승인하시겠습니까?" : "이 일정을 거절하시겠습니까?")) return;

    try {
      await parseJsonResponse(
        await fetch(`/api/admin/approvals/${id}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ decision, reason }),
        }),
      );
      await refresh();
    } catch (actionError) {
      alert(actionError instanceof Error ? actionError.message : "승인 처리에 실패했습니다.");
    }
  }

  async function decideChange(id: string, decision: "approve" | "reject") {
    let reason = "";
    if (decision === "reject") {
      reason = prompt("거절 사유를 입력하세요. 기존 일정은 그대로 유지됩니다.")?.trim() ?? "";
      if (!reason) return;
    }
    if (!confirm(decision === "approve" ? "이 변경 요청을 승인하시겠습니까?" : "이 변경 요청을 거절하시겠습니까?")) return;

    try {
      await parseJsonResponse(
        await fetch(`/api/admin/event-change-requests/${id}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ decision, reason }),
        }),
      );
      await refresh();
    } catch (actionError) {
      alert(actionError instanceof Error ? actionError.message : "변경 요청 처리에 실패했습니다.");
    }
  }

  const isManager = data?.viewerRole === "admin" || data?.viewerRole === "department_admin";
  const isAdmin = data?.viewerRole === "admin";
  const isOwnUser = data?.viewerRole === "user" && data.viewerId === data.user.id;
  const anyFilterEnabled = Object.values(enabledTypes).some(Boolean);

  return (
    <div>
      {data && (
        <Link
          href={data.viewerRole === "user" ? "/calendar" : "/my-events"}
          className="btn-secondary mb-4 inline-flex items-center gap-1.5"
        >
          <ArrowLeft size={16} /> {data.viewerRole === "user" ? "달력" : "사용자 목록"}
        </Link>
      )}

      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black">{data ? `${data.user.display_name} 일정` : "내 일정"}</h1>
          <p className="mt-1 text-sm text-slate-500">
            {data
              ? `${data.user.department} · ${USER_ROLE_LABELS[data.user.role]} · 아이디 ${data.user.login_id}`
              : "조회할 연도와 월을 선택하세요."}
          </p>
        </div>
        {period && (
          <button
            type="button"
            onClick={() => setPeriodDialogOpen(true)}
            className="btn-secondary flex items-center gap-2"
          >
            <CalendarDays size={17} /> {period.year}년 {period.month}월 변경
          </button>
        )}
      </div>

      {error && (
        <div className="card mb-4 p-6 text-center">
          <p className="text-rose-700">{error}</p>
          {period && (
            <button type="button" className="btn-secondary mt-4" onClick={() => load(period)}>
              다시 불러오기
            </button>
          )}
        </div>
      )}

      {loading && <div className="card p-8 text-center text-slate-500">일정을 불러오는 중...</div>}

      {!loading && !error && data && period && (
        <>
          <section className="card mb-5 p-4 sm:p-5">
            <div className="mb-3 flex items-center gap-2">
              <Filter size={18} className="text-slate-500" />
              <h2 className="font-black">표시 항목</h2>
              <span className="text-xs text-slate-500">버튼을 눌러 항목별로 켜고 끌 수 있습니다.</span>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {FILTER_OPTIONS.map((option) => {
                const enabled = enabledTypes[option.value];
                return (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={enabled}
                    onClick={() =>
                      setEnabledTypes((current) => ({ ...current, [option.value]: !current[option.value] }))
                    }
                    className={`flex items-center justify-between rounded-xl border px-3 py-3 text-left text-sm font-black transition ${
                      enabled
                        ? EVENT_TYPE_STYLES[option.value]
                        : "border-slate-200 bg-white text-slate-400"
                    }`}
                  >
                    <span>{option.label}</span>
                    <span className="flex items-center gap-1.5">
                      {eventCounts[option.value]}건
                      <span
                        className={`flex h-5 w-5 items-center justify-center rounded-full border ${
                          enabled ? "border-current bg-white/70" : "border-slate-300"
                        }`}
                      >
                        {enabled && <Check size={13} />}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          {!anyFilterEnabled ? (
            <div className="card p-8 text-center text-slate-500">확인할 항목을 하나 이상 켜주세요.</div>
          ) : visibleEvents.length === 0 ? (
            <div className="card p-8 text-center text-slate-500">
              {period.year}년 {period.month}월에 선택한 항목의 신청 내역이 없습니다.
            </div>
          ) : (
            <div className="space-y-4">
              {visibleEvents.map((event) => {
                const eventRequests = requestsByEvent.get(event.id) ?? [];
                const pendingChange = eventRequests.some((request) => request.status === "pending");
                const userCanManage = isOwnUser && event.status === "approved";
                const adminCanManage = isAdmin && event.status === "approved";

                return (
                  <article key={event.id} className="card p-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={`rounded-full border px-2.5 py-1 text-xs font-black ${EVENT_TYPE_STYLES[event.event_type]}`}
                          >
                            {formatEventLabel(event.event_type, event.title)}
                          </span>
                          <StatusBadge status={event.status} />
                        </div>
                        <p className="mt-3 text-sm text-slate-600">
                          {event.start_date} ~ {event.end_date} · {event.all_day ? "종일" : `${event.start_time?.slice(0, 5)}~${event.end_time?.slice(0, 5)}`}
                        </p>
                        <p className="mt-1 text-xs text-slate-400">신청일 {formatDateTime(event.created_at)}</p>
                        {event.description && <p className="mt-3 rounded-lg bg-slate-50 p-3 text-sm">{event.description}</p>}
                        {event.public_note && (
                          <p className="mt-2 rounded-lg bg-blue-50 p-3 text-sm text-blue-800">
                            공개 메모: {event.public_note}
                          </p>
                        )}
                        {event.rejection_reason && (
                          <p className="mt-2 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">
                            거절 사유: {event.rejection_reason}
                          </p>
                        )}
                      </div>

                      <div className="flex shrink-0 flex-wrap gap-2">
                        {isManager && event.status === "pending" && (
                          <>
                            <button className="btn-primary text-sm" onClick={() => decideEvent(event.id, "approve")}>
                              승인
                            </button>
                            <button className="btn-danger text-sm" onClick={() => decideEvent(event.id, "reject")}>
                              거절
                            </button>
                          </>
                        )}
                        {(userCanManage || adminCanManage) && (
                          <>
                            <button
                              className="btn-secondary text-sm"
                              disabled={pendingChange}
                              onClick={() => setEditing(event)}
                            >
                              {isAdmin ? "수정" : "수정 요청"}
                            </button>
                            <button
                              className="btn-danger text-sm"
                              disabled={pendingChange}
                              onClick={() => remove(event)}
                            >
                              {isAdmin ? "삭제" : "삭제 요청"}
                            </button>
                          </>
                        )}
                      </div>
                    </div>

                    {eventRequests.length > 0 && (
                      <section className="mt-5 border-t border-slate-200 pt-4">
                        <h3 className="mb-3 text-sm font-black">수정·삭제 요청 내역</h3>
                        <div className="space-y-3">
                          {eventRequests.map((request) => (
                            <div key={request.id} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                              <div className="flex flex-wrap items-start justify-between gap-3">
                                <div className="min-w-0 flex-1">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <strong>{request.request_type === "update" ? "수정 요청" : "삭제 요청"}</strong>
                                    <span className={`rounded-full px-2 py-1 text-xs font-black ${requestStatusStyles[request.status]}`}>
                                      {requestStatusLabels[request.status]}
                                    </span>
                                  </div>
                                  <p className="mt-2 text-xs text-slate-400">요청일 {formatDateTime(request.created_at)}</p>
                                  {request.request_type === "update" && (
                                    <div className="mt-3 rounded-lg bg-white p-3 text-sm text-slate-700">
                                      <div className="font-bold">
                                        {request.proposed_event_type
                                          ? `[${formatEventLabel(request.proposed_event_type, request.proposed_title)}]`
                                          : "[종류 미지정]"}
                                      </div>
                                      <div className="mt-1">
                                        {request.proposed_start_date} ~ {request.proposed_end_date} · {request.proposed_all_day ? "종일" : `${request.proposed_start_time?.slice(0, 5)}~${request.proposed_end_time?.slice(0, 5)}`}
                                      </div>
                                    </div>
                                  )}
                                  <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
                                    <strong>요청 사유:</strong> {request.reason}
                                  </p>
                                  {request.rejection_reason && (
                                    <p className="mt-2 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">
                                      <strong>거절 사유:</strong> {request.rejection_reason}
                                    </p>
                                  )}
                                </div>
                                {isManager && request.status === "pending" && (
                                  <div className="flex shrink-0 gap-2">
                                    <button className="btn-primary text-sm" onClick={() => decideChange(request.id, "approve")}>
                                      승인
                                    </button>
                                    <button className="btn-danger text-sm" onClick={() => decideChange(request.id, "reject")}>
                                      거절
                                    </button>
                                  </div>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </section>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </>
      )}

      {periodDialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-4">
          <form onSubmit={applyPeriod} className="card w-full max-w-md p-5" role="dialog" aria-modal="true">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-xl font-black">연·월 선택</h2>
                <p className="mt-1 text-sm text-slate-500">확인할 일정의 연도와 월을 선택하세요.</p>
              </div>
              {period && (
                <button
                  type="button"
                  onClick={() => setPeriodDialogOpen(false)}
                  className="rounded-lg p-2 hover:bg-slate-100"
                  aria-label="닫기"
                >
                  <X size={20} />
                </button>
              )}
            </div>

            <div className="mt-5 grid grid-cols-2 gap-3">
              <label className="text-sm font-bold">
                연도
                <select
                  className="input mt-1"
                  value={draftYear}
                  onChange={(event) => setDraftYear(Number(event.target.value))}
                >
                  {years.map((year) => (
                    <option key={year} value={year}>
                      {year}년
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm font-bold">
                월
                <select
                  className="input mt-1"
                  value={draftMonth}
                  onChange={(event) => setDraftMonth(Number(event.target.value))}
                >
                  {Array.from({ length: 12 }, (_, index) => index + 1).map((month) => (
                    <option key={month} value={month}>
                      {month}월
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <button type="submit" className="btn-primary mt-5 w-full">
              선택한 월 조회
            </button>
          </form>
        </div>
      )}

      {editing && data && (
        <EventEditModal
          event={editing}
          isAdmin={data.viewerRole === "admin"}
          onClose={() => setEditing(null)}
          onSaved={() => void refresh()}
        />
      )}
    </div>
  );
}
