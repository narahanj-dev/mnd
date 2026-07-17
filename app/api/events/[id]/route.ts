import { z } from "zod";
import { requireUser, authErrorResponse } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";

const schema = z.object({
  action: z.enum(["update", "cancel", "delete"]),
  eventType: z.enum(["leave", "outing", "schedule", "anniversary"]).optional(),
  title: z.string().min(1).max(100).optional(),
  startDate: z.string().date().optional(), endDate: z.string().date().optional(), allDay: z.boolean().optional(),
  startTime: z.string().nullable().optional(), endTime: z.string().nullable().optional(),
  description: z.string().max(2000).nullable().optional(), publicNote: z.string().max(500).nullable().optional(), adminNote: z.string().max(500).nullable().optional(),
});

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { supabase, user, profile } = await requireUser();
    const { id } = await context.params;
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return Response.json({ error: "요청 내용을 확인하세요." }, { status: 400 });
    const { data: current } = await supabase.from("calendar_events").select("*").eq("id", id).single();
    if (!current) return Response.json({ error: "일정을 찾을 수 없습니다." }, { status: 404 });
    const own = current.user_id === user.id;
    if (!own && profile.role !== "admin") return Response.json({ error: "권한이 없습니다." }, { status: 403 });

    if (parsed.data.action === "cancel") {
      if (!own && profile.role !== "admin") return Response.json({ error: "권한이 없습니다." }, { status: 403 });
      const nextStatus = profile.role === "admin" ? "cancelled" : "cancellation_requested";
      const { error } = await supabase.from("calendar_events").update({ status: nextStatus }).eq("id", id);
      if (error) return Response.json({ error: error.message }, { status: 400 });
      return Response.json({ ok: true });
    }

    if (parsed.data.action === "delete") {
      if (profile.role !== "admin") return Response.json({ error: "관리자만 삭제할 수 있습니다." }, { status: 403 });
      const admin = createAdminClient();
      const { error } = await admin.from("calendar_events").delete().eq("id", id);
      if (error) return Response.json({ error: error.message }, { status: 400 });
      return Response.json({ ok: true });
    }

    if (profile.role !== "admin" && current.status !== "pending") {
      return Response.json({ error: "승인 대기 일정만 수정할 수 있습니다." }, { status: 400 });
    }
    const update = {
      event_type: parsed.data.eventType ?? current.event_type,
      title: parsed.data.title ?? current.title,
      start_date: parsed.data.startDate ?? current.start_date,
      end_date: parsed.data.endDate ?? current.end_date,
      all_day: parsed.data.allDay ?? current.all_day,
      start_time: parsed.data.allDay === true ? null : parsed.data.startTime ?? current.start_time,
      end_time: parsed.data.allDay === true ? null : parsed.data.endTime ?? current.end_time,
      description: parsed.data.description ?? current.description,
      public_note: parsed.data.publicNote ?? current.public_note,
      admin_note: parsed.data.adminNote ?? current.admin_note,
    };
    if (update.end_date < update.start_date) return Response.json({ error: "종료일을 확인하세요." }, { status: 400 });
    const { error } = await supabase.from("calendar_events").update(update).eq("id", id);
    if (error) return Response.json({ error: error.message }, { status: 400 });
    return Response.json({ ok: true });
  } catch (error) { return authErrorResponse(error); }
}
