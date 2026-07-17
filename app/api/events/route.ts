import { z } from "zod";
import { requireUser, authErrorResponse } from "@/lib/auth/guards";

const createSchema = z.object({
  eventType: z.enum(["leave", "outing", "schedule", "anniversary"]),
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

export async function GET(request: Request) {
  try {
    const { supabase } = await requireUser();
    const url = new URL(request.url);
    const start = url.searchParams.get("start");
    const end = url.searchParams.get("end");
    let query = supabase
      .from("calendar_events")
      .select("*, profile:profiles!calendar_events_user_id_fkey(display_name,department)")
      .order("start_date", { ascending: true });
    if (start) query = query.gte("end_date", start);
    if (end) query = query.lte("start_date", end);
    const { data, error } = await query;
    if (error) return Response.json({ error: error.message }, { status: 400 });
    return Response.json({ events: data ?? [] });
  } catch (error) { return authErrorResponse(error); }
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
    return Response.json({ event: data }, { status: 201 });
  } catch (error) { return authErrorResponse(error); }
}
