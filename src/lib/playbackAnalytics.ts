import { supabase } from "@/lib/supabase";

type SessionStartInput = {
  sessionId: string;
  libraryItemId?: string;
  title?: string;
  streamMode?: "browser" | "vlc" | "external";
  device?: string;
  network?: string;
};

async function getUserId(): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

export async function startPlaybackSession(input: SessionStartInput): Promise<void> {
  if (!supabase) return;
  const userId = await getUserId();
  if (!userId) return;
  await supabase.from("playback_sessions").upsert(
    {
      id: input.sessionId,
      user_id: userId,
      library_item_id: input.libraryItemId ?? null,
      title: input.title ?? null,
      stream_mode: input.streamMode ?? "browser",
      status: "started",
      device: input.device ?? null,
      network: input.network ?? null,
      last_event_at: new Date().toISOString(),
      started_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "id" },
  );
}

export async function patchPlaybackSession(
  sessionId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  if (!supabase || !sessionId) return;
  await supabase
    .from("playback_sessions")
    .update({
      ...patch,
      updated_at: new Date().toISOString(),
      last_event_at: new Date().toISOString(),
    })
    .eq("id", sessionId);
}

export async function addPlaybackEvent(
  sessionId: string,
  eventType: string,
  payload: Record<string, unknown>,
  positionSeconds?: number,
): Promise<void> {
  if (!supabase || !sessionId) return;
  const userId = await getUserId();
  if (!userId) return;
  await supabase.from("playback_events").insert({
    session_id: sessionId,
    user_id: userId,
    event_type: eventType,
    payload,
    position_seconds: Number.isFinite(positionSeconds) ? positionSeconds : null,
  });
}
