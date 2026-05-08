import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import WebSocketImpl from "ws";
import { env } from "../env.js";

// supabase-js eagerly constructs a RealtimeClient even though we never
// open a channel. On Node < 22 there's no global `WebSocket`, so the
// constructor throws "Node.js 20 detected without native WebSocket
// support". Hand it the `ws` package as the transport and the eager
// init becomes a no-op until something actually subscribes (which we
// never do).
const realtimeOptions = {
  // @types/ws's default-export type is technically `typeof WebSocket`
  // already, but supabase-js expects a `WebSocketLikeConstructor` which
  // is structurally the same — cast keeps both packages happy without
  // pulling in a runtime adapter.
  transport: WebSocketImpl as unknown as typeof WebSocket,
};

// Service-role client: bypasses RLS, used for everything the BFF does on
// behalf of an authenticated user (read/write lists & items, manage
// users via auth.admin).
export const supabaseAdmin: SupabaseClient = createClient(
  env.SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
    realtime: realtimeOptions,
  }
);

// Anon client: only used to call signInWithPassword / refreshSession on
// behalf of users (those flows want the regular auth API, not the admin
// API). It still hits the same local GoTrue.
export const supabaseAuth: SupabaseClient = createClient(
  env.SUPABASE_URL,
  env.SUPABASE_ANON_KEY,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
    realtime: realtimeOptions,
  }
);

export async function pingSupabase(): Promise<{ ok: boolean; message?: string }> {
  try {
    const { error } = await supabaseAdmin.from("profiles").select("user_id").limit(1);
    if (error) return { ok: false, message: error.message };
    return { ok: true };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}
