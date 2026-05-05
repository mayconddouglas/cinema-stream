import { patchEpisode } from "@/lib/series";
import { update } from "@/lib/storage";

type ResumeTarget = "movie" | "episode";

type VlcResumeSession = {
  target: ResumeTarget;
  id: string;
  startSeconds: number;
  startedAt: number;
  durationSeconds?: number;
};

const VLC_RESUME_KEY = "acervos_vlc_resume_v1";
const MIN_ELAPSED_TO_SAVE = 20;
const MAX_ELAPSED_TO_SAVE = 3 * 60 * 60;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function parseSession(raw: string | null): VlcResumeSession | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<VlcResumeSession>;
    if (!parsed || (parsed.target !== "movie" && parsed.target !== "episode")) return null;
    if (typeof parsed.id !== "string" || !parsed.id) return null;
    if (typeof parsed.startSeconds !== "number" || !Number.isFinite(parsed.startSeconds))
      return null;
    if (typeof parsed.startedAt !== "number" || !Number.isFinite(parsed.startedAt)) return null;
    if (
      parsed.durationSeconds !== undefined &&
      (typeof parsed.durationSeconds !== "number" || !Number.isFinite(parsed.durationSeconds))
    ) {
      return null;
    }
    return parsed as VlcResumeSession;
  } catch {
    return null;
  }
}

function readSession(): VlcResumeSession | null {
  try {
    return parseSession(localStorage.getItem(VLC_RESUME_KEY));
  } catch {
    return null;
  }
}

function clearSession() {
  try {
    localStorage.removeItem(VLC_RESUME_KEY);
  } catch {
    void 0;
  }
}

export function markVlcLaunchSession(input: {
  target: ResumeTarget;
  id: string;
  startSeconds?: number;
  durationSeconds?: number;
}) {
  const session: VlcResumeSession = {
    target: input.target,
    id: input.id,
    startSeconds: Math.max(0, Math.floor(input.startSeconds ?? 0)),
    startedAt: Date.now(),
    durationSeconds:
      typeof input.durationSeconds === "number" && input.durationSeconds > 0
        ? Math.floor(input.durationSeconds)
        : undefined,
  };
  try {
    localStorage.setItem(VLC_RESUME_KEY, JSON.stringify(session));
  } catch {
    void 0;
  }
}

export async function commitVlcResumeOnReturn() {
  const session = readSession();
  if (!session) return;

  const now = Date.now();
  const elapsed = Math.floor((now - session.startedAt) / 1000);
  if (!Number.isFinite(elapsed) || elapsed < MIN_ELAPSED_TO_SAVE) return;

  const effectiveElapsed = clamp(elapsed, MIN_ELAPSED_TO_SAVE, MAX_ELAPSED_TO_SAVE);
  const start = Math.max(0, Math.floor(session.startSeconds));
  let nextProgress = start + effectiveElapsed;

  if (typeof session.durationSeconds === "number" && session.durationSeconds > 0) {
    const maxNearEnd = Math.max(0, session.durationSeconds - 5);
    nextProgress = Math.min(nextProgress, maxNearEnd);
  }
  if (nextProgress <= start) return;

  const patch = {
    progress: nextProgress,
    duration: session.durationSeconds,
    lastPlayedAt: now,
  };

  try {
    if (session.target === "movie") {
      await update(session.id, patch);
    } else {
      await patchEpisode(session.id, patch);
    }
    clearSession();
  } catch {
    void 0;
  }
}
