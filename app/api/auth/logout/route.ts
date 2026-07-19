import { createClient } from "@/lib/supabase/server";
import { assertSameOrigin } from "@/lib/security/request";
import { clearAppSession } from "@/lib/security/session";
import { safeErrorResponse } from "@/lib/security/errors";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const supabase = await createClient();
    await supabase.auth.signOut();
    await clearAppSession();
    return Response.json({ ok: true });
  } catch (error) {
    return safeErrorResponse(error, "logout");
  }
}
