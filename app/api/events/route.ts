import { z } from "zod";
import { requireUser, authErrorResponse } from "@/lib/auth/guards";
import { DEPARTMENTS, EVENT_TYPE_VALUES } from "@/lib/constants";
import { createAdminClient } from "@/lib/supabase/admin";
import type { CalendarEvent } from "@/types";

const createSchema = z.object({
  eventType: z.enum(EVENT_TYPE_VALUES),
  title: z.string().min(1).max(100),
  startDate: z.string().date(),
  endDate: z.string().date(),
  allDay: z.boolean(),
  startTime: z.string().nullable().optional(),
  endTime: z.string().nullable().optional(),
  description: z.string().max(2000).nullable().optional(),
  publicNote: z.string().max(500).nullable().optional(),
  adminNote: z.string().max(500).nullable().optional(),
});

function birthdayDate(year: number, birthDate: string) {
  const [, month, day] = birthDate.split("-");
  const value = `${year}-${month}-${day}`;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : value;
}

function eventDepartment(event: CalendarEvent) {
  return event.profile?.department ?? "";
}

export async function GET(request: Request) {
  try {
    const { profile } = await requireUser();
    const admin = createAdminClient();
    const url = new URL(request.url);
    const start = url.searchParams.get("start");
    const end = url.searchParams.get("end");
    const view = url.searchParams.get("view");
    const allowedDepartments = profile.role === "admin" ? [...DEPARTMENTS] : [profile.department];

    let query = admin
      .from("calendar_events")
      .select("*, profile:profiles!calendar_events_user_id_fkey(display_name,department,role)")
      .order("start_date", { ascending: true });

    if (view === "calendar") query = query.eq("status", "approved");
    if (start) query = query.gte("end_date", start);
    if (end) query = query.lte("start_date", end);

    const [{ data, error }, { data: activeProfiles, error: profileCountError }] = await Promise.all([
      query,
      admin
        .from("profiles")
        .select("id,display_name,department,birth_date,role")
        .eq("account_status", "active")
        .in("department", allowedDepartments),
    ]);

    if (error) return Response.json({ error: error.message }, { status: 400 });
    if (profileCountError) return Response.json({ error: profileCountError.message }, { status: 400 });

    const departmentCounts = Object.fromEntries(
      allowedDepartments.map((department) => [
        department,
        (activeProfiles ?? []).filter((item) => item.department === department).length,
      ]),
    );

    const events = ((data ?? []) as CalendarEvent[]).filter((event) =>
      allowedDepartments.includes(eventDepartment(event)),
    );

    if (view === "calendar" && start && end) {
      const startYear = Number(start.slice(0, 4));
      const endYear = Number(end.slice(0, 4));
      for (const birthdayProfile of activeProfiles ?? []) {
        if (!birthdayProfile.birth_date) continue;
        for (let year = startYear; year <= endYear; year += 1) {
          const date = birthdayDate(year, birthdayProfile.birth_date);
          if (!date || date < start || date > end) continue;
          events.push({
            id: `birthday-${birthdayProfile.id}-${year}`,
            user_id: birthdayProfile.id,
            event_type: "anniversary",
            title: "생일",
            start_date: date,
            end_date: date,
            all_day: true,
            start_time: null,
            end_time: null,
            description: null,
            public_note: null,
            admin_note: null,
            status: "approved",
            rejection_reason: null,
            approved_by: null,
            approved_at: null,
            created_at: `${year}-01-01T00:00:00.000Z`,
            updated_at: `${year}-01-01T00:00:00.000Z`,
            is_system_generated: true,
            profile: {
              display_name: birthdayProfile.display_name,
              department: birthdayProfile.department,
              role: birthdayProfile.role,
            },
          });
        }
      }
      events.sort((a, b) => a.start_date.localeCompare(b.start_date));
    }

    return Response.json({ events, departmentCounts });
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const parsed = createSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return Response.json({ error: "일정 입력값을 확인하세요." }, { status: 400 });
    const value = parsed.data;
    if (value.endDate < value.startDate) return Response.json({ error: "종료일은 시작일보다 빠를 수 없습니다." }, { status: 400 });
    if (!value.allDay && (!value.startTime || !value.endTime || value.endTime <= value.startTime)) {
      return Response.json({ error: "시간 일정을 올바르게 입력하세요." }, { status: 400 });
    }
    const { data, error } = await supabase.from("calendar_events").insert({
      user_id: user.id, event_type: value.eventType, title: value.title.trim(), start_date: value.startDate,
      end_date: value.endDate, all_day: value.allDay, start_time: value.allDay ? null : value.startTime,
      end_time: value.allDay ? null : value.endTime, description: value.description || null,
      public_note: value.publicNote || null, admin_note: value.adminNote || null, status: "pending",
    }).select().single();
    if (error) return Response.json({ error: error.message }, { status: 400 });
    return Response.json({
      event: data,
      message: "일정 추가 요청이 접수되었습니다. 관리자의 승인이 완료될 때까지 기다려 주세요.",
    }, { status: 201 });
  } catch (error) { return authErrorResponse(error); }
}
