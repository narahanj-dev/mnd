import { z } from "zod";
import { requireUser, authErrorResponse } from "@/lib/auth/guards";
const schema = z.object({ isRead: z.boolean().optional(), isArchived: z.boolean().optional() });
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { supabase, user } = await requireUser(); const { id } = await context.params;
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return Response.json({ error: "요청을 확인하세요." }, { status: 400 });
    const update: Record<string, unknown> = {};
    if (typeof parsed.data.isRead === "boolean") { update.is_read = parsed.data.isRead; update.read_at = parsed.data.isRead ? new Date().toISOString() : null; }
    if (typeof parsed.data.isArchived === "boolean") update.is_archived = parsed.data.isArchived;
    const { error } = await supabase.from("messages").update(update).eq("id", id).eq("recipient_id", user.id);
    if (error) return Response.json({ error: error.message }, { status: 400 });
    return Response.json({ ok: true });
  } catch (error) { return authErrorResponse(error); }
}
