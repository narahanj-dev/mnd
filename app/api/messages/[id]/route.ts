import { z } from "zod";
import { requireUser, authErrorResponse } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { assertSameOrigin } from "@/lib/security/request";
import { SecurityError } from "@/lib/security/errors";

const schema = z.object({ isRead: z.boolean().optional(), isArchived: z.boolean().optional() });

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const { user } = await requireUser();
    const { id } = await context.params;
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new SecurityError("INVALID_INPUT", 400, "요청을 확인하세요.");
    const update: Record<string, unknown> = {};
    if (typeof parsed.data.isRead === "boolean") { update.is_read = parsed.data.isRead; update.read_at = parsed.data.isRead ? new Date().toISOString() : null; }
    if (typeof parsed.data.isArchived === "boolean") update.is_archived = parsed.data.isArchived;
    const { data, error } = await createAdminClient().from("messages").update(update).eq("id", id).eq("recipient_id", user.id).select("id").maybeSingle();
    if (error) throw error;
    if (!data) throw new SecurityError("NOT_FOUND", 404, "쪽지를 찾을 수 없습니다.");
    return Response.json({ ok: true });
  } catch (error) { return authErrorResponse(error); }
}
