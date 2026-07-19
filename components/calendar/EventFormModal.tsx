"use client";

import { X } from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  DEPARTMENT_CAPACITY_EVENT_TYPES,
  EVENT_SUBTYPE_OPTIONS,
  EVENT_TYPE_LABELS,
  EVENT_TYPE_OPTIONS,
  departmentCapacityThreshold,
  formatEventLabel,
} from "@/lib/constants";
import { parseJsonResponse } from "@/lib/utils";
import type { CalendarEvent, EventType } from "@/types";

export function EventFormModal({
  date,
  events,
  capacityEvents,
  selectedDepartment,
  departmentCounts,
  onClose,
  onSaved,
}: {
  date: string;
  events: CalendarEvent[];
  capacityEvents: CalendarEvent[];
  selectedDepartment: string;
  departmentCounts: Record<string, number>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [showForm, setShowForm] = useState(events.length === 0);
  const [allDay, setAllDay] = useState(true);
  const [eventType, setEventType] = useState<EventType>("leave");
  const [title, setTitle] = useState("연가");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const close = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);

  const summary = useMemo(() => {
    const countByType = new Map<EventType, number>();
    for (const option of EVENT_TYPE_OPTIONS) countByType.set(option.value, 0);
    for (const item of events) countByType.set(item.event_type, (countByType.get(item.event_type) ?? 0) + 1);

    const displayedPeople = new Set(events.map((item) => item.user_id));
    const day = new Date(`${date}T00:00:00`);
    const threshold = departmentCapacityThreshold(day);
    const departmentNames = selectedDepartment === "all"
      ? Object.keys(departmentCounts)
      : [selectedDepartment];
    const departmentRates = departmentNames.map((departmentName) => {
      const memberCount = departmentCounts[departmentName] ?? 0;
      const people = new Set(
        capacityEvents
          .filter(
            (item) =>
              item.profile?.department === departmentName &&
              DEPARTMENT_CAPACITY_EVENT_TYPES.includes(item.event_type),
          )
          .map((item) => item.user_id),
      );
      const percentage = memberCount > 0 ? (people.size / memberCount) * 100 : 0;
      return { departmentName, memberCount, peopleCount: people.size, percentage, exceeded: percentage > threshold };
    });
    const selectedRate = departmentRates[0] ?? { memberCount: 0, peopleCount: 0, percentage: 0 };
    const highestRate = departmentRates.reduce((highest, item) => item.percentage > highest.percentage ? item : highest, selectedRate);

    return { countByType, displayedPeople, threshold, departmentRates, selectedRate, highestRate };
  }, [capacityEvents, date, departmentCounts, events, selectedDepartment]);

  function changeEventType(nextType: EventType) {
    setEventType(nextType);
    const subtypeOptions = EVENT_SUBTYPE_OPTIONS[nextType];
    if (subtypeOptions) {
      setTitle(subtypeOptions[0]);
    } else if (EVENT_SUBTYPE_OPTIONS[eventType]?.includes(title)) {
      setTitle("");
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setLoading(true); setError("");
    const form = new FormData(event.currentTarget);
    const payload = {
      eventType, title, startDate: form.get("startDate"), endDate: form.get("endDate"),
      allDay, startTime: allDay ? null : form.get("startTime"), endTime: allDay ? null : form.get("endTime"),
      description: form.get("description"), publicNote: form.get("publicNote"), adminNote: form.get("adminNote"),
    };
    try {
      const result = await parseJsonResponse<{ message?: string }>(await fetch("/api/events", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }));
      alert(result.message ?? "일정 추가 요청이 접수되었습니다. 관리자의 승인이 완료될 때까지 기다려 주세요.");
      onSaved(); onClose();
    } catch (err) { setError(err instanceof Error ? err.message : "등록에 실패했습니다."); }
    finally { setLoading(false); }
  }

  const subtypeOptions = EVENT_SUBTYPE_OPTIONS[eventType];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4" onMouseDown={(e) => e.currentTarget === e.target && onClose()}>
      <section className="card max-h-[90vh] w-full max-w-2xl overflow-y-auto p-5" role="dialog" aria-modal="true">
        <div className="flex items-start justify-between"><div><h2 className="text-xl font-black">{date} 일정</h2><p className="text-sm text-slate-500">해당 날짜의 일정 확인 및 추가</p></div><button onClick={onClose} className="rounded-lg p-2 hover:bg-slate-100" aria-label="닫기"><X /></button></div>

        <div className="mt-5 rounded-2xl border border-blue-100 bg-blue-50/70 p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <p className="text-xs font-bold text-slate-500">표시 인원 합계</p>
              <p className="mt-1 text-2xl font-black text-slate-900">{summary.displayedPeople.size}명</p>
              <p className="mt-1 text-xs text-slate-500">표시 일정 {events.length}건</p>
            </div>
            <div>
              <p className="text-xs font-bold text-slate-500">휴가·외박·외출 인원 비율</p>
              <p className={`mt-1 text-2xl font-black ${summary.departmentRates.some((item) => item.exceeded) ? "text-rose-700" : "text-blue-800"}`}>
                {(selectedDepartment === "all" ? summary.highestRate.percentage : summary.selectedRate.percentage).toFixed(1)}%
              </p>
              <p className="mt-1 text-xs text-slate-500">
                {selectedDepartment === "all"
                  ? `부서별 최고 비율 · 기준 ${summary.threshold}% 초과 시 날짜 음영`
                  : `${summary.selectedRate.peopleCount}명 / ${selectedDepartment} 부서원 ${summary.selectedRate.memberCount}명 · 기준 ${summary.threshold}%`}
              </p>
            </div>
          </div>
          {selectedDepartment === "all" && (
            <div className="mt-3 flex flex-wrap gap-2">
              {summary.departmentRates.map((item) => (
                <span
                  key={item.departmentName}
                  className={`rounded-full px-3 py-1 text-xs font-bold shadow-sm ${item.exceeded ? "bg-rose-100 text-rose-800" : "bg-white text-slate-700"}`}
                >
                  {item.departmentName} {item.percentage.toFixed(1)}%
                </span>
              ))}
            </div>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            {EVENT_TYPE_OPTIONS.map((option) => (
              <span key={option.value} className="rounded-full bg-white px-3 py-1 text-xs font-bold text-slate-700 shadow-sm">
                {option.label} {summary.countByType.get(option.value) ?? 0}건
              </span>
            ))}
          </div>
        </div>

        {events.length > 0 && (
          <div className="mt-5">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-black">등록 일정 {events.length}건</h3>
              <span className="text-xs text-slate-500">목록 안에서 스크롤할 수 있습니다.</span>
            </div>
            <div className="mt-2 max-h-[45vh] space-y-2 overflow-y-auto overscroll-contain pr-2">
              {events.map((item) => <div key={item.id} className="rounded-xl border border-slate-200 p-3"><div className="font-bold">[{formatEventLabel(item.event_type, item.title)}] {item.profile?.display_name}</div><div className="mt-1 text-sm text-slate-500">{item.all_day ? "종일" : `${item.start_time?.slice(0,5)}~${item.end_time?.slice(0,5)}`}</div></div>)}
            </div>
            {!showForm && <button className="btn-primary mt-3" onClick={() => setShowForm(true)}>+ 일정 추가</button>}
          </div>
        )}
        {showForm && (
          <form onSubmit={submit} className="mt-5 grid gap-4 md:grid-cols-2">
            <label className="text-sm font-bold">표시 항목<select name="eventType" value={eventType} onChange={(e) => changeEventType(e.target.value as EventType)} className="input mt-1">{EVENT_TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
            <label className="text-sm font-bold">종류
              {subtypeOptions ? (
                <select name="title" value={title} onChange={(e) => setTitle(e.target.value)} className="input mt-1">
                  {subtypeOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                </select>
              ) : (
                <input name="title" value={title} onChange={(e) => setTitle(e.target.value)} className="input mt-1" required maxLength={100} placeholder={`${EVENT_TYPE_LABELS[eventType]} 종류 입력`} />
              )}
            </label>
            <label className="text-sm font-bold">시작일<input name="startDate" type="date" defaultValue={date} className="input mt-1" required /></label>
            <label className="text-sm font-bold">종료일<input name="endDate" type="date" defaultValue={date} className="input mt-1" required /></label>
            <label className="flex items-center gap-2 text-sm font-bold md:col-span-2"><input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} /> 종일 일정</label>
            {!allDay && <><label className="text-sm font-bold">시작 시간<input name="startTime" type="time" className="input mt-1" required /></label><label className="text-sm font-bold">종료 시간<input name="endTime" type="time" className="input mt-1" required /></label></>}
            <label className="text-sm font-bold md:col-span-2">상세 내용<textarea name="description" className="input mt-1 min-h-20" maxLength={2000} /></label>
            <label className="text-sm font-bold md:col-span-2">공개 메모<textarea name="publicNote" className="input mt-1 min-h-16" maxLength={500} /></label>
            <label className="text-sm font-bold md:col-span-2">관리자에게만 전달할 메모<textarea name="adminNote" className="input mt-1 min-h-16" maxLength={500} /></label>
            {error && <p className="text-sm font-semibold text-rose-700 md:col-span-2">{error}</p>}
            <div className="flex justify-end gap-2 md:col-span-2"><button type="button" className="btn-secondary" onClick={onClose}>취소</button><button className="btn-primary" disabled={loading}>{loading ? "추가 중..." : "추가하기"}</button></div>
          </form>
        )}
      </section>
    </div>
  );
}
