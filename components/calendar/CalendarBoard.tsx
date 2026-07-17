"use client";

import { addMonths, eachDayOfInterval, endOfMonth, endOfWeek, format, isSameMonth, isToday, startOfMonth, startOfWeek } from "date-fns";
import { ko } from "date-fns/locale";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EVENT_TYPE_LABELS, EVENT_TYPE_STYLES } from "@/lib/constants";
import { parseJsonResponse } from "@/lib/utils";
import type { CalendarEvent, EventType, Profile } from "@/types";
import { EventFormModal } from "./EventFormModal";

const types: EventType[] = ["leave", "outing", "schedule", "anniversary"];

export function CalendarBoard({ profile }: { profile: Profile }) {
  const [months, setMonths] = useState(12);
  const [previousMonths, setPreviousMonths] = useState(0);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [enabled, setEnabled] = useState<Record<EventType, boolean>>({ leave: true, outing: true, schedule: true, anniversary: true });
  const [department, setDepartment] = useState("all");
  const [userId, setUserId] = useState("all");
  const [myOnly, setMyOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const sentinel = useRef<HTMLDivElement>(null);

  const firstMonth = addMonths(startOfMonth(new Date()), -previousMonths);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rangeFirstMonth = addMonths(startOfMonth(new Date()), -previousMonths);
      const rangeLastMonth = addMonths(startOfMonth(new Date()), months - 1);
      const start = format(startOfMonth(rangeFirstMonth), "yyyy-MM-dd");
      const end = format(endOfMonth(rangeLastMonth), "yyyy-MM-dd");
      const data = await parseJsonResponse<{ events: CalendarEvent[] }>(await fetch(`/api/events?start=${start}&end=${end}`, { cache: "no-store" }));
      setEvents(data.events);
    } catch (error) { console.error(error); }
    finally { setLoading(false); }
  }, [previousMonths, months]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const node = sentinel.current;
    if (!node) return;
    const observer = new IntersectionObserver((entries) => entries[0]?.isIntersecting && setMonths((value) => Math.min(value + 6, 36)), { rootMargin: "500px" });
    observer.observe(node); return () => observer.disconnect();
  }, []);

  const profiles = useMemo(() => {
    const map = new Map<string, { id: string; name: string; department: string }>();
    events.forEach((event) => map.set(event.user_id, { id: event.user_id, name: event.profile?.display_name ?? "사용자", department: event.profile?.department ?? "미지정" }));
    return [...map.values()];
  }, [events]);
  const departments = [...new Set(profiles.map((item) => item.department))];

  const filtered = events.filter((event) => enabled[event.event_type] && (department === "all" || event.profile?.department === department) && (userId === "all" || event.user_id === userId) && (!myOnly || event.user_id === profile.id));
  const visibleMonths = Array.from({ length: months + previousMonths }, (_, index) => addMonths(firstMonth, index));

  return (
    <div>
      <section className="card sticky top-[73px] z-30 mb-5 p-4">
        <div className="flex flex-wrap items-center gap-4">
          <strong className="text-sm">표시 항목</strong>
          {types.map((type) => <label key={type} className="flex items-center gap-1.5 text-sm font-semibold"><input type="checkbox" checked={enabled[type]} onChange={(e) => setEnabled((value) => ({ ...value, [type]: e.target.checked }))} /> {EVENT_TYPE_LABELS[type]}</label>)}
          <select className="input max-w-44 py-2" value={department} onChange={(e) => setDepartment(e.target.value)}><option value="all">전체 부서</option>{departments.map((d) => <option key={d}>{d}</option>)}</select>
          <select className="input max-w-44 py-2" value={userId} onChange={(e) => setUserId(e.target.value)}><option value="all">전체 사용자</option>{profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
          <label className="flex items-center gap-1.5 text-sm font-semibold"><input type="checkbox" checked={myOnly} onChange={(e) => setMyOnly(e.target.checked)} /> 내 일정만</label>
          <button className="btn-secondary ml-auto text-sm" onClick={() => setPreviousMonths((value) => Math.min(value + 3, 12))}>이전 달 추가</button>
        </div>
      </section>

      {loading && <p className="mb-4 text-sm font-semibold text-slate-500">달력을 불러오는 중...</p>}
      <div className="space-y-7">
        {visibleMonths.map((month) => {
          const days = eachDayOfInterval({ start: startOfWeek(startOfMonth(month), { weekStartsOn: 0 }), end: endOfWeek(endOfMonth(month), { weekStartsOn: 0 }) });
          return (
            <section key={month.toISOString()} className="card overflow-hidden">
              <h2 className="border-b border-slate-200 px-5 py-4 text-xl font-black">{format(month, "yyyy년 M월", { locale: ko })}</h2>
              <div className="grid grid-cols-7 bg-slate-50 text-center text-xs font-bold text-slate-500">{["일","월","화","수","목","금","토"].map((day, i) => <div key={day} className={`p-2 ${i === 0 ? "text-rose-600" : i === 6 ? "text-blue-600" : ""}`}>{day}</div>)}</div>
              <div className="grid grid-cols-7">
                {days.map((day) => {
                  const iso = format(day, "yyyy-MM-dd");
                  const dayEvents = filtered.filter((event) => event.start_date <= iso && event.end_date >= iso);
                  return (
                    <button key={iso} onClick={() => setSelectedDate(iso)} className={`min-h-28 border-r border-t border-slate-200 p-1.5 text-left align-top hover:bg-blue-50 sm:min-h-32 ${!isSameMonth(day, month) ? "bg-slate-50 text-slate-300" : "bg-white"}`}>
                      <span className={`inline-flex h-7 w-7 items-center justify-center rounded-full text-sm font-bold ${isToday(day) ? "bg-blue-700 text-white" : day.getDay() === 0 ? "text-rose-600" : day.getDay() === 6 ? "text-blue-600" : ""}`}>{format(day, "d")}</span>
                      <div className="mt-1 space-y-1">
                        {dayEvents.slice(0, 3).map((event) => <div key={event.id} className={`truncate rounded border px-1.5 py-1 text-[10px] font-bold sm:text-xs ${EVENT_TYPE_STYLES[event.event_type]}`}>[{EVENT_TYPE_LABELS[event.event_type]}] {event.profile?.display_name} {event.title}{event.status === "pending" ? " (대기)" : ""}</div>)}
                        {dayEvents.length > 3 && <div className="text-[11px] font-bold text-slate-500">외 {dayEvents.length - 3}건</div>}
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
      <div ref={sentinel} className="h-12" />
      {selectedDate && <EventFormModal date={selectedDate} events={filtered.filter((event) => event.start_date <= selectedDate && event.end_date >= selectedDate)} onClose={() => setSelectedDate(null)} onSaved={load} />}
    </div>
  );
}
