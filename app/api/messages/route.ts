import { z } from "zod";
import { requireAdmin, requireUser, authErrorResponse } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { decryptProfileRelation } from "@/lib/security/pii";
import { decryptMessages, encryptMessageFields } from "@/lib/security/secure-fields";
import { assertSameOrigin, clientIp } from "@/lib/security/request";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { SecurityError } from "@/lib/security/errors";
import { writeAuditLog } from "@/lib/security/audit";

export async function GET(request: Request) {
  try {
    const { user } = await requireUser();
    const url = new URL(request.url);
    const archived = url.searchParams.get("archived") === "true";
    const unread = url.searchParams.get("unread") === "true";
    const admin = createAdminClient();
    const expiresBefore = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString();
    const { error: cleanupError } = await admin.from("messages").delete().eq("is_archived", false).lt("created_at", expiresBefore);
    if (cleanupError) console.error("[message-cleanup]", cleanupError);

    let query = admin.from("messages")
      .select("id,sender_id,recipient_id,related_event_id,title,content,message_type,is_read,is_archived,created_at,read_at,sender:profiles!messages_sender_id_fkey(display_name)")
      .eq("recipient_id", user.id).eq("is_archived", archived).order("created_at", { ascending: false });
    if (unread) query = query.eq("is_read", false);
    const { data, error } = await query;
    if (error) throw error;
    const messages = decryptMessages(data ?? []).map((message) => ({
      ...message,
      sender: decryptProfileRelation(message.sender as Record<string, unknown> | Record<string, unknown>[] | null),
    }));
    return Response.json({ messages });
  } catch (error) { return authErrorResponse(error); }
}

const sendSchema = z.object({
  recipientId: z.string().uuid(),
  title: z.string().min(1).max(150),
  content: z.string().min(1).max(3000),
  relatedEventId: z.string().uuid().nullable().optional(),
});

export async function POST(request: Request) {
  let actorId: string | null = null;
  try {
    assertSameOrigin(request);
    const { user } = await requireAdmin();
    actorId = user.id;
    await enforceRateLimit({ purpose: "message-send", identity: `${user.id}:${clientIp(request)}`, limit: 30, windowSeconds: 600 });
    const parsed = sendSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new SecurityError("INVALID_INPUT", 400, "쪽지 내용을 확인하세요.");
    const admin = createAdminClient();
    const { data: recipient } = await admin.from("profiles").select("id").eq("id", parsed.data.recipientId).eq("account_status", "active").maybeSingle();
    if (!recipient) throw new SecurityError("RECIPIENT_NOT_FOUND", 404, "받는 사용자를 찾을 수 없습니다.");
    const { data, error } = await admin.from("messages").insert(encryptMessageFields({
      sender_id: user.id,
      recipient_id: parsed.data.recipientId,
      title: parsed.data.title,
      content: parsed.data.content,
      related_event_id: parsed.data.relatedEventId ?? null,
      message_type: "admin",
    })).select("id").single();
    if (error) throw error;
    await writeAuditLog({ request, action: "message.send", actorId: user.id, targetUserId: parsed.data.recipientId, targetResourceId: data.id, success: true });
    return Response.json({ ok: true });
  } catch (error) {
    await writeAuditLog({ request, action: "message.send", actorId, success: false });
    return authErrorResponse(error);
  }
}
