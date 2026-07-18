import { z } from "zod";
import { requireAdmin, requireUser, authErrorResponse } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { decryptProfileRelation } from "@/lib/security/pii";

export async function GET(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const url = new URL(request.url);
    const archived = url.searchParams.get("archived") === "true";
    const unread = url.searchParams.get("unread") === "true";
    const admin = createAdminClient();
    const expiresBefore = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString();
    const { error: cleanupError } = await admin
      .from("messages")
      .delete()
      .eq("is_archived", false)
      .lt("created_at", expiresBefore);
    if (cleanupError) console.error("만료 쪽지 자동 삭제 실패:", cleanupError.message);
    let query = supabase.from("messages").select("*, sender:profiles!messages_sender_id_fkey(display_name)").eq("recipient_id", user.id).eq("is_archived", archived).order("created_at", { ascending: false });
    if (unread) query = query.eq("is_read", false);
    const { data, error } = await query;
    if (error) return Response.json({ error: error.message }, { status: 400 });
    const messages = (data ?? []).map((message) => ({
      ...message,
      sender: decryptProfileRelation(message.sender as Record<string, unknown> | Record<string, unknown>[] | null),
    }));
    return Response.json({ messages });
  } catch (error) { return authErrorResponse(error); }
}

const sendSchema = z.object({ recipientId: z.string().uuid(), title: z.string().min(1).max(150), content: z.string().min(1).max(3000), relatedEventId: z.string().uuid().nullable().optional() });
export async function POST(request: Request) {
  try {
    const { user } = await requireAdmin();
    const parsed = sendSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return Response.json({ error: "쪽지 내용을 확인하세요." }, { status: 400 });
    const admin = createAdminClient();
    const { error } = await admin.from("messages").insert({ sender_id: user.id, recipient_id: parsed.data.recipientId, title: parsed.data.title, content: parsed.data.content, related_event_id: parsed.data.relatedEventId ?? null, message_type: "admin" });
    if (error) return Response.json({ error: error.message }, { status: 400 });
    return Response.json({ ok: true });
  } catch (error) { return authErrorResponse(error); }
}
