"use client";

import { ArrowLeft, Building2, ChevronRight } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { formatEventLabel } from "@/lib/constants";
import { parseJsonResponse } from "@/lib/utils";
import type { CalendarEvent, EventChangeRequest, UserRole } from "@/types";

type DepartmentSummary = {
  name: string;
  pendingCount: number;
};

type ApprovalResponse = {
  departments: DepartmentSummary[];
  selectedDepartment: string | null;
  role: UserRole;
  events: CalendarEvent[];
  requests: EventChangeRequest[];
};

export function ApprovalList() {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [changeRequests, setChangeRequests] = useState<EventChangeRequest[]>([]);
  const [departments, setDepartments] = useState<DepartmentSummary[]>([]);
  const [selectedDepartment, setSelectedDepartment] = useState<string | null>(null);
  const [role, setRole] = useState<UserRole>("user");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async (department: string | null = null) => {
    setLoading(true);
    setError("");
    try {
      const query = department ? `?department=${encodeURIComponent(department)}` : "";
      const data = await parseJsonResponse<ApprovalResponse>(
        await fetch(`/api/admin/approvals${query}`, { cache: "no-store" }),
      );
      setEvents(data.events);
      setChangeRequests(data.requests);
      setDepartments(data.departments);
      setRole(data.role);
      setSelectedDepartment(data.selectedDepartment);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "일정 승인 요청을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function decideEvent(id: string, decision: "approve" | "reject") {
    let reason = "";
    if (decision === "reject") {
      reason = prompt("거절 사유를 입력하세요.")?.trim() ?? "";
      if (!reason) return;
    }
    if (!confirm(decision === "approve" ? "이 일정을 승인하시겠습니까?" : "이 일정을 거절하시겠습니까?")) return;
    try {
      await parseJsonResponse(await fetch(`/api/admin/approvals/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, reason }),
      }));
      await load(selectedDepartment);
    } catch (decisionError) {
      alert(decisionError instanceof Error ? decisionError.message : "일정을 처리하지 못했습니다.");
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
      await parseJsonResponse(await fetch(`/api/admin/event-change-requests/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, reason }),
      }));
      await load(selectedDepartment);
    } catch (decisionError) {
      alert(decisionError instanceof Error ? decisionError.message : "변경 요청을 처리하지 못했습니다.");
    }
  }

  if (loading) return <p>승인 요청을 불러오는 중...</p>;

  if (error) {
    return (
      <div>
        <h1 className="mb-5 text-2xl font-black">일정 승인</h1>
        <div className="card p-8 text-center">
          <p className="text-rose-700">{error}</p>
          <button type="button" className="btn-secondary mt-4" onClick={() => load(selectedDepartment)}>다시 불러오기</button>
        </div>
      </div>
    );
  }

  if (!selectedDepartment) {
    return (
      <div>
        <h1 className="mb-2 text-2xl font-black">일정 승인</h1>
        <p className="mb-5 text-sm text-slate-500">
          {role === "admin"
            ? "5개 부서 중 확인할 부서를 선택하세요. 각 부서의 승인 대기 요청을 따로 처리할 수 있습니다."
            : "소속 부서의 승인 대기 요청만 확인하고 처리할 수 있습니다."}
        </p>

        <div className={`grid gap-3 ${departments.length === 1 ? "max-w-md" : "sm:grid-cols-2 xl:grid-cols-5"}`}>
          {departments.map((department) => (
            <button
              key={department.name}
              type="button"
              onClick={() => load(department.name)}
              className="card flex items-center gap-3 p-4 text-left transition hover:border-blue-300 hover:bg-blue-50"
            >
              <span className="rounded-xl bg-slate-100 p-2 text-slate-600">
                <Building2 size={20} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-black">{department.name}</span>
                <span className={`mt-1 block text-xs font-bold ${department.pendingCount > 0 ? "text-rose-600" : "text-slate-400"}`}>
                  승인 대기 {department.pendingCount}건
                </span>
              </span>
              <ChevronRight size={18} className="text-slate-400" />
            </button>
          ))}
        </div>
      </div>
    );
  }

  const empty = events.length === 0 && changeRequests.length === 0;

  return (
    <div>
      <button
        type="button"
        onClick={() => {
          setSelectedDepartment(null);
          setEvents([]);
          setChangeRequests([]);
        }}
        className="btn-secondary mb-4 flex items-center gap-1.5"
      >
        <ArrowLeft size={16} /> 부서 목록
      </button>

      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black">{selectedDepartment} 일정 승인</h1>
          <p className="mt-1 text-sm text-slate-500">이 부서 소속 사용자의 요청만 표시됩니다.</p>
        </div>
        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">
          전체 승인 대기 {events.length + changeRequests.length}건
        </span>
      </div>

      {empty ? (
        <div className="card p-8 text-center text-slate-500">{selectedDepartment}의 승인 대기 요청이 없습니다.</div>
      ) : (
        <div className="space-y-6">
          {events.length > 0 && (
            <section>
              <h2 className="mb-3 text-lg font-black">신규 일정 요청</h2>
              <div className="space-y-4">
                {events.map((event) => (
                  <article key={event.id} className="card p-5">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div>
                        <div className="font-black">[{formatEventLabel(event.event_type, event.title)}]</div>
                        <p className="mt-2 text-sm text-slate-600">신청자 {event.profile?.display_name} · {event.profile?.department}</p>
                        <p className="text-sm text-slate-600">{event.start_date} ~ {event.end_date} · {event.all_day ? "종일" : `${event.start_time?.slice(0, 5)}~${event.end_time?.slice(0, 5)}`}</p>
                        {event.description && <p className="mt-3 rounded-lg bg-slate-50 p-3 text-sm">{event.description}</p>}
                        {event.admin_note && <p className="mt-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">관리자 메모: {event.admin_note}</p>}
                      </div>
                      <div className="flex gap-2">
                        <button className="btn-primary" onClick={() => decideEvent(event.id, "approve")}>승인</button>
                        <button className="btn-danger" onClick={() => decideEvent(event.id, "reject")}>거절</button>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          )}

          {changeRequests.length > 0 && (
            <section>
              <h2 className="mb-3 text-lg font-black">일정 수정·삭제 요청</h2>
              <div className="space-y-4">
                {changeRequests.map((request) => {
                  const event = request.event;
                  if (!event) return null;
                  return (
                    <article key={request.id} className="card p-5">
                      <div className="flex flex-wrap items-start justify-between gap-4">
                        <div className="min-w-0 flex-1">
                          <div className="font-black">[{request.request_type === "update" ? "수정" : "삭제"} 요청] {formatEventLabel(event.event_type, event.title)}</div>
                          <p className="mt-2 text-sm text-slate-600">요청자 {request.requester?.display_name ?? event.profile?.display_name} · {request.requester?.department ?? event.profile?.department}</p>
                          <div className="mt-3 rounded-lg bg-slate-50 p-3 text-sm">
                            <strong>현재 일정</strong><br />
                            [{formatEventLabel(event.event_type, event.title)}]<br />
                            {event.start_date} ~ {event.end_date} · {event.all_day ? "종일" : `${event.start_time?.slice(0, 5)}~${event.end_time?.slice(0, 5)}`}
                          </div>
                          {request.request_type === "update" && request.proposed_event_type && (
                            <div className="mt-2 rounded-lg bg-blue-50 p-3 text-sm text-blue-900">
                              <strong>변경 요청 내용</strong><br />
                              [{formatEventLabel(request.proposed_event_type, request.proposed_title)}]<br />
                              {request.proposed_start_date} ~ {request.proposed_end_date} · {request.proposed_all_day ? "종일" : `${request.proposed_start_time?.slice(0, 5)}~${request.proposed_end_time?.slice(0, 5)}`}
                            </div>
                          )}
                          <p className="mt-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-800"><strong>요청 사유:</strong> {request.reason}</p>
                        </div>
                        <div className="flex gap-2">
                          <button className="btn-primary" onClick={() => decideChange(request.id, "approve")}>승인</button>
                          <button className="btn-danger" onClick={() => decideChange(request.id, "reject")}>거절</button>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
