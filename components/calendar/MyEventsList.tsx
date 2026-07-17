"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { EVENT_TYPE_LABELS } from "@/lib/constants";
import { parseJsonResponse } from "@/lib/utils";
import type { CalendarEvent, EventChangeRequest, RequestStatus } from "@/types";
import { StatusBadge } from "@/components/common/StatusBadge";
import { EventEditModal } from "./EventEditModal";

type AdminRequestGroup = {
  userId: string;
  name: string;
  department: string;
  events: CalendarEvent[];
  requests: EventChangeRequest[];
  pendingCount: number;
};

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

export function MyEventsList({ userId, isAdmin }: { userId: string; isAdmin: boolean }) {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [requests, setRequests] = useState<EventChangeRequest[]>([]);
  const [editing, setEditing] = useState<CalendarEvent | null>(null);
  const [openUserId, setOpenUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [eventData, requestData] = await Promise.all([
        parseJsonResponse<{ events: CalendarEvent[] }>(await fetch("/api/events", { cache: "no-store" })),
        parseJsonResponse<{ requests: EventChangeRequest[] }>(await fetch("/api/event-change-requests", { cache: "no-store" })),
      ]);
      setEvents(isAdmin ? eventData.events : eventData.events.filter((event) => event.user_id === userId));
      setRequests(requestData.requests);
    } finally {
      setLoading(false);
    }
  }, [isAdmin, userId]);

  useEffect(() => { load(); }, [load]);

  const latestRequestByEvent = useMemo(() => {
    const map = new Map<string, EventChangeRequest>();
    requests.forEach((request) => { if (!map.has(request.event_id)) map.set(request.event_id, request); });
    return map;
  }, [requests]);

  const adminGroups = useMemo<AdminRequestGroup[]>(() => {
    if (!isAdmin) return [];
    const map = new Map<string, AdminRequestGroup>();

    const getGroup = (groupUserId: string, name?: string, department?: string) => {
      const existing = map.get(groupUserId);
      if (existing) return existing;
      const group: AdminRequestGroup = {
        userId: groupUserId,
        name: name ?? "사용자",
        department: department ?? "미지정",
        events: [],
        requests: [],
        pendingCount: 0,
      };
      map.set(groupUserId, group);
      return group;
    };

    events.forEach((event) => {
      const group = getGroup(event.user_id, event.profile?.display_name, event.profile?.department);
      group.events.push(event);
      if (event.status === "pending") group.pendingCount += 1;
    });

    requests.forEach((request) => {
      const group = getGroup(
        request.requester_id,
        request.requester?.display_name ?? request.event?.profile?.display_name,
        request.requester?.department ?? request.event?.profile?.department,
      );
      group.requests.push(request);
      if (request.status === "pending") group.pendingCount += 1;
    });

    return [...map.values()]
      .map((group) => ({
        ...group,
        events: group.events.sort((a, b) => b.created_at.localeCompare(a.created_at)),
        requests: group.requests.sort((a, b) => b.created_at.localeCompare(a.created_at)),
      }))
      .sort((a, b) => b.pendingCount - a.pendingCount || a.name.localeCompare(b.name, "ko"));
  }, [events, isAdmin, requests]);

  async function remove(event: CalendarEvent) {
    const reason = prompt(isAdmin ? "사용자에게 전달할 삭제 사유를 입력하세요." : "관리자에게 전달할 삭제 사유를 입력하세요.")?.trim();
    if (!reason) return;
    if (!confirm(isAdmin ? "이 일정을 즉시 삭제하시겠습니까?" : "이 일정의 삭제 승인을 요청하시겠습니까?")) return;
    const result = await parseJsonResponse<{ message?: string }>(await fetch(`/api/events/${event.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete", reason }),
    }));
    alert(result.message ?? (isAdmin ? "일정이 삭제되었습니다." : "삭제 요청이 접수되었습니다."));
    await load();
  }

  async function decideEvent(id: string, decision: "approve" | "reject") {
    let reason = "";
    if (decision === "reject") {
      reason = prompt("거절 사유를 입력하세요.")?.trim() ?? "";
      if (!reason) return;
    }
    if (!confirm(decision === "approve" ? "이 일정을 승인하시겠습니까?" : "이 일정을 거절하시겠습니까?")) return;
    await parseJsonResponse(await fetch(`/api/admin/approvals/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision, reason }),
    }));
    await load();
  }

  async function decideChange(id: string, decision: "approve" | "reject") {
    let reason = "";
    if (decision === "reject") {
      reason = prompt("거절 사유를 입력하세요. 기존 일정은 그대로 유지됩니다.")?.trim() ?? "";
      if (!reason) return;
    }
    if (!confirm(decision === "approve" ? "이 변경 요청을 승인하시겠습니까?" : "이 변경 요청을 거절하시겠습니까?")) return;
    await parseJsonResponse(await fetch(`/api/admin/event-change-requests/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision, reason }),
    }));
    await load();
  }

  if (loading) return <p>일정을 불러오는 중...</p>;

  if (isAdmin) {
    return (
      <div>
        <h1 className="mb-2 text-2xl font-black">사용자별 일정 요청 관리</h1>
        <p className="mb-5 text-sm text-slate-500">사용자 이름을 누르면 해당 사용자가 등록한 일정 추가·수정·삭제 요청만 펼쳐집니다.</p>
        {adminGroups.length === 0 ? (
          <div className="card p-8 text-center text-slate-500">등록된 일정 요청이 없습니다.</div>
        ) : (
          <div className="space-y-3">
            {adminGroups.map((group) => {
              const opened = openUserId === group.userId;
              return (
                <section key={group.userId} className="card overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setOpenUserId(opened ? null : group.userId)}
                    className="flex w-full items-center gap-3 p-5 text-left hover:bg-slate-50"
                    aria-expanded={opened}
                  >
                    {opened ? <ChevronDown size={20} /> : <ChevronRight size={20} />}
                    <div className="min-w-0 flex-1">
                      <div className="font-black">{group.name}</div>
                      <div className="mt-1 text-xs text-slate-500">{group.department}</div>
                    </div>
                    <div className="text-right text-xs font-bold text-slate-500">
                      {group.pendingCount > 0 && <div className="text-rose-600">승인 대기 {group.pendingCount}건</div>}
                      <div>전체 {group.events.length + group.requests.length}건</div>
                    </div>
                  </button>

                  {opened && (
                    <div className="border-t border-slate-200 bg-slate-50/60 p-4 sm:p-5">
                      <div className="space-y-6">
                        <section>
                          <h2 className="mb-3 text-base font-black">일정 추가 요청 및 등록 일정</h2>
                          {group.events.length === 0 ? (
                            <p className="rounded-xl bg-white p-4 text-sm text-slate-500">일정 추가 내역이 없습니다.</p>
                          ) : (
                            <div className="space-y-3">
                              {group.events.map((event) => (
                                <article key={event.id} className="rounded-xl border border-slate-200 bg-white p-4">
                                  <div className="flex flex-wrap items-start justify-between gap-3">
                                    <div className="min-w-0 flex-1">
                                      <div className="flex flex-wrap items-center gap-2">
                                        <strong>[{EVENT_TYPE_LABELS[event.event_type]}] {event.title}</strong>
                                        <StatusBadge status={event.status} />
                                      </div>
                                      <p className="mt-2 text-sm text-slate-600">{event.start_date} ~ {event.end_date} · {event.all_day ? "종일" : `${event.start_time?.slice(0, 5)}~${event.end_time?.slice(0, 5)}`}</p>
                                      <p className="mt-1 text-xs text-slate-400">등록일 {new Date(event.created_at).toLocaleString("ko-KR")}</p>
                                      {event.description && <p className="mt-3 rounded-lg bg-slate-50 p-3 text-sm">{event.description}</p>}
                                      {event.rejection_reason && <p className="mt-3 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">거절 사유: {event.rejection_reason}</p>}
                                    </div>
                                    <div className="flex shrink-0 flex-wrap gap-2">
                                      {event.status === "pending" && <><button className="btn-primary text-sm" onClick={() => decideEvent(event.id, "approve")}>승인</button><button className="btn-danger text-sm" onClick={() => decideEvent(event.id, "reject")}>거절</button></>}
                                      {event.status === "approved" && <><button className="btn-secondary text-sm" onClick={() => setEditing(event)}>수정</button><button className="btn-danger text-sm" onClick={() => remove(event)}>삭제</button></>}
                                    </div>
                                  </div>
                                </article>
                              ))}
                            </div>
                          )}
                        </section>

                        <section>
                          <h2 className="mb-3 text-base font-black">일정 수정·삭제 요청</h2>
                          {group.requests.length === 0 ? (
                            <p className="rounded-xl bg-white p-4 text-sm text-slate-500">수정·삭제 요청 내역이 없습니다.</p>
                          ) : (
                            <div className="space-y-3">
                              {group.requests.map((request) => {
                                const event = request.event;
                                if (!event) return null;
                                return (
                                  <article key={request.id} className="rounded-xl border border-slate-200 bg-white p-4">
                                    <div className="flex flex-wrap items-start justify-between gap-3">
                                      <div className="min-w-0 flex-1">
                                        <div className="flex flex-wrap items-center gap-2">
                                          <strong>[{request.request_type === "update" ? "수정" : "삭제"} 요청] {event.title}</strong>
                                          <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${requestStatusStyles[request.status]}`}>{requestStatusLabels[request.status]}</span>
                                        </div>
                                        <div className="mt-3 rounded-lg bg-slate-50 p-3 text-sm">
                                          <strong>현재 일정</strong><br />
                                          [{EVENT_TYPE_LABELS[event.event_type]}] {event.title}<br />
                                          {event.start_date} ~ {event.end_date} · {event.all_day ? "종일" : `${event.start_time?.slice(0, 5)}~${event.end_time?.slice(0, 5)}`}
                                        </div>
                                        {request.request_type === "update" && request.proposed_event_type && (
                                          <div className="mt-2 rounded-lg bg-blue-50 p-3 text-sm text-blue-900">
                                            <strong>변경 요청 내용</strong><br />
                                            [{EVENT_TYPE_LABELS[request.proposed_event_type]}] {request.proposed_title}<br />
                                            {request.proposed_start_date} ~ {request.proposed_end_date} · {request.proposed_all_day ? "종일" : `${request.proposed_start_time?.slice(0, 5)}~${request.proposed_end_time?.slice(0, 5)}`}
                                          </div>
                                        )}
                                        <p className="mt-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-800"><strong>요청 사유:</strong> {request.reason}</p>
                                        {request.rejection_reason && <p className="mt-2 rounded-lg bg-rose-50 p-3 text-sm text-rose-700"><strong>거절 사유:</strong> {request.rejection_reason}</p>}
                                      </div>
                                      {request.status === "pending" && <div className="flex shrink-0 gap-2"><button className="btn-primary text-sm" onClick={() => decideChange(request.id, "approve")}>승인</button><button className="btn-danger text-sm" onClick={() => decideChange(request.id, "reject")}>거절</button></div>}
                                    </div>
                                  </article>
                                );
                              })}
                            </div>
                          )}
                        </section>
                      </div>
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        )}
        {editing && <EventEditModal event={editing} isAdmin onClose={() => setEditing(null)} onSaved={load} />}
      </div>
    );
  }

  return (
    <div>
      <h1 className="mb-5 text-2xl font-black">내 일정</h1>
      {events.length === 0 ? <div className="card p-8 text-center text-slate-500">등록한 일정이 없습니다.</div> : (
        <div className="grid gap-4 lg:grid-cols-2">
          {events.map((event) => {
            const changeRequest = latestRequestByEvent.get(event.id);
            const pendingChange = changeRequest?.status === "pending";
            const manageable = event.status === "approved";
            return (
              <article key={event.id} className="card p-5">
                <div className="flex items-center justify-between gap-3"><strong>[{EVENT_TYPE_LABELS[event.event_type]}] {event.title}</strong><StatusBadge status={event.status} /></div>
                <p className="mt-3 text-sm text-slate-600">{event.start_date} ~ {event.end_date} · {event.all_day ? "종일" : `${event.start_time?.slice(0, 5)}~${event.end_time?.slice(0, 5)}`}</p>
                <p className="mt-1 text-xs text-slate-400">등록일 {new Date(event.created_at).toLocaleString("ko-KR")}</p>
                {event.rejection_reason && <p className="mt-3 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">거절 사유: {event.rejection_reason}</p>}
                {changeRequest && (
                  <div className={`mt-3 rounded-lg p-3 text-sm ${changeRequest.status === "pending" ? "bg-amber-50 text-amber-800" : changeRequest.status === "rejected" ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-800"}`}>
                    최근 {changeRequest.request_type === "update" ? "수정" : "삭제"} 요청: {requestStatusLabels[changeRequest.status]}<br />
                    사유: {changeRequest.reason}
                    {changeRequest.rejection_reason && <><br />거절 사유: {changeRequest.rejection_reason}</>}
                  </div>
                )}
                {manageable && (
                  <div className="mt-4 flex justify-end gap-2">
                    <button className="btn-secondary text-sm" disabled={pendingChange} onClick={() => setEditing(event)}>수정 요청</button>
                    <button className="btn-danger text-sm" disabled={pendingChange} onClick={() => remove(event)}>삭제 요청</button>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
      {editing && <EventEditModal event={editing} isAdmin={false} onClose={() => setEditing(null)} onSaved={load} />}
    </div>
  );
}
