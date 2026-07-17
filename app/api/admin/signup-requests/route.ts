import { requireAdmin, authErrorResponse } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
export async function GET() { try { await requireAdmin(); const admin = createAdminClient(); const { data, error } = await admin.from("signup_requests").select("*").order("created_at", { ascending: false }); if (error) return Response.json({ error: error.message }, { status: 400 }); return Response.json({ requests: data ?? [] }); } catch (error) { return authErrorResponse(error); } }
