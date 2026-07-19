import { z } from "zod";
import { requireUser, authErrorResponse } from "@/lib/auth/guards";
import { DEPARTMENTS, EVENT_TYPE_VALUES, isValidEventTitle } from "@/lib/constants";
import { createAdminClient } from "@/lib/supabase/admin";
import type { CalendarEvent } from "@/types";
import { decryptProfile, decryptProfileRelation, maskDisplayName } from "@/lib/security/pii";
import { decryptCalendarEvent, encryptCalendarEventFields } from "@/lib/security/secure-fields";
import { assertSameOrigin, clientIp } from "@/lib/security/request";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { SecurityError } from "@/lib/security/errors";
import { writeAuditLog } from "@/lib/security/audit";

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

function birthdayDate(year: number, monthDay: string) {
  const [month, day] = monthDay.split("-");
  const value = `${year}-${month}-${day}`;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : value;
}

function eventDepartment(event: CalendarEvent) { return event.profile?.department ?? ""; }

export async function GET(request: Request) {
  try {
    const { profile, user } = await requireUser();
    const admin = createAdminClient();
    const url = new URL(request.url);
    const start = url.searchParams.get("start");
    const end = url.searchParams.get("end");
    const view = url.searchParams.get("view");
    const allowedDepartments = profile.role === "admin" ? [...DEPARTMENTS] : [profile.department];

    let query = admin.from("calendar_events")
      .select("id,user_id,event_type,title,start_date,end_date,all_day,start_time,end_time,description,public_note,admin_note,status,rejection_reason,approved_by,approved_at,created_at,updated_at,profile:profiles!calendar_events_user_id_fkey(display_name,department,role)")
      .order("start_date", { ascending: true });
    if (view === "calendar") query = query.eq("status", "approved");
    if (start) query = query.gte("end_date", start);
    if (end) query = query.lte("start_date", end);

    const [{ data, error }, { data: activeProfiles, error: profileCountError }] = await Promise.all([
      query,
      admin.from("profiles").select("id,display_name,department,birth_month_day,role").eq("account_status", "active").in("department", allowedDepartments),
    ]);
    if (error) throw error;
    if (profileCountError) throw profileCountError;

    const decryptedActiveProfiles = (activeProfiles ?? []).map((item) => decryptProfile(item));
    const departmentCounts = Object.fromEntries(allowedDepartments.map((department) => [department, decryptedActiveProfiles.filter((item) => item.department === department).length]));

    const events = ((data ?? []) as unknown as CalendarEvent[]).map((rawEvent) => {
      const event = decryptCalendarEvent(rawEvent);
      const relation = decryptProfileRelation(event.profile as Record<string, unknown> | Record<string, unknown>[] | null);
      const eventProfile = Array.isArray(relation) ? relation[0] : relation;
      const safeEvent: Record<string, unknown> = {
        ...event,
        profile: eventProfile ? { ...eventProfile, display_name: maskDisplayName(String(eventProfile.display_name ?? "사용자")) } : undefined,
      };
      if (profile.role === "user") {
        delete safeEvent.admin_note;
        delete safeEvent.approved_by;
        if (event.user_id !== user.id) delete safeEvent.rejection_reason;
      }
      return safeEvent as unknown as CalendarEvent;
    }).filter((event) => allowedDepartments.includes(eventDepartment(event)));

    if (view === "calendar" && start && end) {
      const startYear = Number(start.slice(0, 4));
      const endYear = Number(end.slice(0, 4));
      for (const birthdayProfile of decryptedActiveProfiles) {
        if (!birthdayProfile.birth_month_day) continue;
        for (let year = startYear; year <= endYear; year += 1) {
          const date = birthdayDate(year, String(birthdayProfile.birth_month_day));
          if (!date || date < start || date > end) continue;
          events.push({
            id: `birthday-${birthdayProfile.id}-${year}`, user_id: birthdayProfile.id, event_type: "anniversary", title: "생일",
            start_date: date, end_date: date, all_day: true, start_time: null, end_time: null, description: null, public_note: null,
            status: "approved", rejection_reason: null, approved_by: null, approved_at: null,
            created_at: `${year}-01-01T00:00:00.000Z`, updated_at: `${year}-01-01T00:00:00.000Z`, is_system_generated: true,
            profile: { display_name: maskDisplayName(String(birthdayProfile.display_name)), department: birthdayProfile.department, role: birthdayProfile.role },
          });
        }
      }
      events.sort((a, b) => a.start_date.localeCompare(b.start_date));
    }

    return Response.json({ events, departmentCounts });
  } catch (error) { return authErrorResponse(error); }
}

export async function POST(request: Request) {
  let actorId: string | null = null;
  try {
    assertSameOrigin(request);
    const { user, profile } = await requireUser();
    actorId = user.id;
    await enforceRateLimit({ purpose: "event-create", identity: `${user.id}:${clientIp(request)}`, limit: 20, windowSeconds: 600 });
    const parsed = createSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new SecurityError("INVALID_INPUT", 400, "일정 입력값을 확인하세요.");
    const value = parsed.data;
    if (!isValidEventTitle(value.eventType, value.title.trim())) throw new SecurityError("INVALID_EVENT_TYPE", 400, "선택한 표시 항목의 종류를 확인하세요.");
    if (value.endDate < value.startDate) throw new SecurityError("INVALID_DATE", 400, "종료일은 시작일보다 빠를 수 없습니다.");
    if (!value.allDay && (!value.startTime || !value.endTime || value.endTime <= value.startTime)) throw new SecurityError("INVALID_TIME", 400, "시간 일정을 올바르게 입력하세요.");

    const insert = encryptCalendarEventFields({
      user_id: user.id, event_type: value.eventType, title: value.title.trim(), start_date: value.startDate, end_date: value.endDate,
      all_day: value.allDay, start_time: value.allDay ? null : value.startTime, end_time: value.allDay ? null : value.endTime,
      description: value.description || null, public_note: value.publicNote || null,
      admin_note: profile.role === "user" ? null : value.adminNote || null, status: "pending",
    });
    const { data, error } = await createAdminClient().from("calendar_events").insert(insert).select("id,status").single();
    if (error) throw error;
    await writeAuditLog({ request, action: "event.create", actorId: user.id, targetUserId: user.id, targetResourceId: data.id, success: true });
    return Response.json({ event: data, message: "일정 추가 요청이 접수되었습니다. 관리자의 승인이 완료될 때까지 기다려 주세요." }, { status: 201 });
  } catch (error) {
    await writeAuditLog({ request, action: "event.create", actorId, targetUserId: actorId, success: false });
    return authErrorResponse(error);
  }
}
