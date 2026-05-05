import type { LibraryItem } from "@/lib/storage";
import { getUserCache, setUserCache } from "@/lib/userCache";

export type HomeEventType = "open" | "play" | "favorite_toggle";

type ItemSignal = {
  itemId: string;
  opens: number;
  plays: number;
  favorites: number;
  lastEventAt: number;
};

export type HomeSignalsState = {
  version: 1;
  updatedAt: number;
  signals: Record<string, ItemSignal>;
};

const LOCAL_KEY = "acervos_home_signals_v1";
const USER_CACHE_KEY = "home_signals_v1";

function createEmptyState(): HomeSignalsState {
  return {
    version: 1,
    updatedAt: Date.now(),
    signals: {},
  };
}

function readLocalSignals(): HomeSignalsState {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) return createEmptyState();
    const parsed = JSON.parse(raw) as Partial<HomeSignalsState>;
    if (!parsed || parsed.version !== 1 || typeof parsed.signals !== "object") {
      return createEmptyState();
    }
    return {
      version: 1,
      updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : Date.now(),
      signals: parsed.signals as Record<string, ItemSignal>,
    };
  } catch {
    return createEmptyState();
  }
}

function mergeSignals(
  a: Record<string, ItemSignal>,
  b: Record<string, ItemSignal>,
): Record<string, ItemSignal> {
  const merged: Record<string, ItemSignal> = { ...a };
  for (const [itemId, next] of Object.entries(b)) {
    const curr = merged[itemId];
    if (!curr) {
      merged[itemId] = next;
      continue;
    }
    merged[itemId] = {
      itemId,
      opens: Math.max(curr.opens, next.opens),
      plays: Math.max(curr.plays, next.plays),
      favorites: Math.max(curr.favorites, next.favorites),
      lastEventAt: Math.max(curr.lastEventAt, next.lastEventAt),
    };
  }
  return merged;
}

export async function loadHomeSignals(): Promise<HomeSignalsState> {
  const local = readLocalSignals();
  const user = await getUserCache<HomeSignalsState>(USER_CACHE_KEY);
  if (!user || user.version !== 1 || typeof user.signals !== "object") return local;
  return {
    version: 1,
    updatedAt: Math.max(local.updatedAt, user.updatedAt ?? 0),
    signals: mergeSignals(local.signals, user.signals),
  };
}

export function registerHomeEvent(
  prev: HomeSignalsState,
  itemId: string,
  event: HomeEventType,
): HomeSignalsState {
  const now = Date.now();
  const current = prev.signals[itemId] ?? {
    itemId,
    opens: 0,
    plays: 0,
    favorites: 0,
    lastEventAt: now,
  };
  const next: ItemSignal = {
    ...current,
    opens: event === "open" ? current.opens + 1 : current.opens,
    plays: event === "play" ? current.plays + 1 : current.plays,
    favorites: event === "favorite_toggle" ? current.favorites + 1 : current.favorites,
    lastEventAt: now,
  };
  return {
    version: 1,
    updatedAt: now,
    signals: {
      ...prev.signals,
      [itemId]: next,
    },
  };
}

export async function persistHomeSignals(state: HomeSignalsState): Promise<void> {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(state));
  } catch {
    void 0;
  }
  await setUserCache<HomeSignalsState>(USER_CACHE_KEY, state);
}

export function rankItemsForUser(items: LibraryItem[], signals: HomeSignalsState): LibraryItem[] {
  return [...items]
    .map((item) => {
      const signal = signals.signals[item.id];
      const progressPct =
        item.progress && item.duration ? Math.round((item.progress / item.duration) * 100) : 0;
      const recencyHours = Math.max(1, (Date.now() - item.addedAt) / (1000 * 60 * 60));
      const recencyScore = 120 / Math.sqrt(recencyHours);
      const continueScore = progressPct > 5 && progressPct < 95 ? 28 : 0;
      const favoriteScore = item.favorite ? 30 : 0;
      const activityScore = item.lastPlayedAt ? 20 : 0;

      const signalRecencyDays = signal?.lastEventAt
        ? Math.max(1, (Date.now() - signal.lastEventAt) / (1000 * 60 * 60 * 24))
        : 30;
      const signalRecencyFactor = 1 / Math.sqrt(signalRecencyDays);
      const interactionScore = signal
        ? (signal.opens * 18 + signal.plays * 34 + signal.favorites * 16) * signalRecencyFactor
        : 0;

      const score = recencyScore + continueScore + favoriteScore + activityScore + interactionScore;
      return { item, score };
    })
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.item);
}
