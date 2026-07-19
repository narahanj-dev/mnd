import { z } from "zod";
import { requireUser, authErrorResponse } from "@/lib/auth/guards";
import { DEPARTMENTS, EVENT_TYPE_VALUES, isValidEventTitle } from "@/lib/constants";
import { createAdminClient } from "@/lib/supabase/admin";
import type { CalendarEvent, Profile } from "@/types";
import { decryptProfile, maskDisplayName } from "@/lib/security/pii";
import { decryptCalendarEvents, encryptCalendarEventFields } from "@/lib/security/secure-fields";
import { assertSameOrigin, clientIp, keyedDigest } from "@/lib/security/request";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { SecurityError } from "@/lib/security/errors";
import { writeAuditLog, writeAuditLogBestEffort } from "@/lib/security/audit";
import { requireAal2 } from "@/lib/security/mfa";
import { assertCalendarRange, assertEventDuration, parseIsoDate } from "@/lib/security/date-limits";

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

type CalendarProfile = Pick<Profile, "id" | "display_name" | "department" | "birth_month_day" | "role">;
type CalendarRow = Pick<
  CalendarEvent,
  "id" | "user_id" | "event_type" | "title" | "start_date" | "end_date" | "all_day" | "start_time" | "end_time"
>;

function birthdayDate(year: number, monthDay: string) {
  const [month, day] = monthDay.split("-");
  const value = `${year}-${month}-${day}`;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : value;
}

function publicUserId(viewerId: string, targetId: string) {
  return viewerId === targetId ? targetId : `calendar-user-${keyedDigest("calendar-user", targetId).slice(0, 24)}`;
}

function publicEventId(eventId: string) {
  return `calendar-event-${keyedDigest("calendar-event", eventId).slice(0, 24)}`;
}

function noStoreJson(body: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", "no-store, max-age=0");
  return Response.json(body, { ...init, headers });
}

export async function GET(request: Request) {
  try {
    const { profile, user, supabase } = await requireUser();
    if (profile.role !== "user") await requireAal2(supabase);

    const url = new URL(request.url);
    const start = url.searchParams.get("start");
    const end = url.searchParams.get("end");
    const view = url.searchParams.get("view");
    if (view !== "calendar" || !start || !end) {
      throw new SecurityError("INVALID_CALENDAR_QUERY", 400, "달력 조회 기간을 확인하세요.");
    }
    parseIsoDate(start, "조회 시작일");
    parseIsoDate(end, "조회 종료일");
    assertCalendarRange(start, end);

    const allowedDepartments = profile.role === "admin" ? [...DEPARTMENTS] : [profile.department];
    const admin = createAdminClient();
    const { data: activeProfileRows, error: profileError } = await admin
      .from("profiles")
      .select("id,display_name,department,birth_month_day,role")
      .eq("account_status", "active")
      .in("department", allowedDepartments);
    if (profileError) throw profileError;

    const activeProfiles = (activeProfileRows ?? []).map((item) => decryptProfile(item) as CalendarProfile);
    const profileById = new Map(activeProfiles.map((item) => [item.id, item]));
    const visibleUserIds = activeProfiles.map((item) => item.id);
    const departmentCounts = Object.fromEntries(
      allowedDepartments.map((department) => [
        department,
        activeProfiles.filter((item) => item.department === department).length,
      ]),
    );

    let rows: CalendarRow[] = [];
    if (visibleUserIds.length > 0) {
      const { data, error } = await admin
        .from("calendar_events")
        .select("id,user_id,event_type,title,start_date,end_date,all_day,start_time,end_time")
        .eq("status", "approved")
        .in("user_id", visibleUserIds)
        .gte("end_date", start)
        .lte("start_date", end)
        .order("start_date", { ascending: true })
        .returns<CalendarRow[]>();
      if (error) throw error;
      rows = decryptCalendarEvents(data ?? []) as CalendarRow[];
    }

    const events = rows.flatMap((event) => {
      const eventProfile = profileById.get(event.user_id);
      if (!eventProfile) return [];
      const safeUserId = publicUserId(user.id, event.user_id);
      return [{
        id: publicEventId(event.id),
        user_id: safeUserId,
        event_type: event.event_type,
        title: event.title,
        start_date: event.start_date,
        end_date: event.end_date,
        all_day: event.all_day,
        start_time: event.start_time,
        end_time: event.end_time,
        status: "approved",
        profile: {
          display_name: maskDisplayName(String(eventProfile.display_name || "사용자")),
          department: eventProfile.department,
          role: eventProfile.role,
        },
      } as CalendarEvent];
    });

    const startYear = Number(start.slice(0, 4));
    const endYear = Number(end.slice(0, 4));
    for (const birthdayProfile of activeProfiles) {
      if (!birthdayProfile.birth_month_day) continue;
      for (let year = startYear; year <= endYear; year += 1) {
        const date = birthdayDate(year, String(birthdayProfile.birth_month_day));
        if (!date || date < start || date > end) continue;
        const safeUserId = publicUserId(user.id, birthdayProfile.id);
        events.push({
          id: `birthday-${safeUserId}-${year}`,
          user_id: safeUserId,
          event_type: "anniversary",
          title: "생일",
          start_date: date,
          end_date: date,
          all_day: true,
          start_time: null,
          end_time: null,
          status: "approved",
          is_system_generated: true,
          profile: {
            display_name: maskDisplayName(String(birthdayProfile.display_name || "사용자")),
            department: birthdayProfile.department,
            role: birthdayProfile.role,
          },
        } as CalendarEvent);
      }
    }
    events.sort((a, b) => a.start_date.localeCompare(b.start_date));

    return noStoreJson({ events, departmentCounts });
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function POST(request: Request) {
  let actorId: string | null = null;
  try {
    assertSameOrigin(request);
    const { user, profile, supabase } = await requireUser();
    actorId = user.id;
    if (profile.role !== "user") await requireAal2(supabase);
    await enforceRateLimit({ purpose: "event-create", identity: `${user.id}:${clientIp(request)}`, limit: 20, windowSeconds: 600 });
    const parsed = createSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new SecurityError("INVALID_INPUT", 400, "일정 입력값을 확인하세요.");
    const value = parsed.data;
    if (!isValidEventTitle(value.eventType, value.title.trim())) throw new SecurityError("INVALID_EVENT_TYPE", 400, "선택한 표시 항목의 종류를 확인하세요.");
    assertEventDuration(value.startDate, value.endDate);
    if (!value.allDay && (!value.startTime || !value.endTime || value.endTime <= value.startTime)) throw new SecurityError("INVALID_TIME", 400, "시간 일정을 올바르게 입력하세요.");

    const insert = encryptCalendarEventFields({
      user_id: user.id,
      event_type: value.eventType,
      title: value.title.trim(),
      start_date: value.startDate,
      end_date: value.endDate,
      all_day: value.allDay,
      start_time: value.allDay ? null : value.startTime,
      end_time: value.allDay ? null : value.endTime,
      description: value.description || null,
      public_note: value.publicNote || null,
      admin_note: profile.role === "user" ? null : value.adminNote || null,
      status: "pending",
    });
    const { data, error } = await createAdminClient().from("calendar_events").insert(insert).select("id,status").single();
    if (error) throw error;
    await writeAuditLog({ request, action: "event.create", actorId: user.id, targetUserId: user.id, targetResourceId: data.id, success: true });
    return noStoreJson({ event: data, message: "일정 추가 요청이 접수되었습니다. 관리자의 승인이 완료될 때까지 기다려 주세요." }, { status: 201 });
  } catch (error) {
    await writeAuditLogBestEffort({ request, action: "event.create", actorId, targetUserId: actorId, success: false });
    return authErrorResponse(error);
  }
}
