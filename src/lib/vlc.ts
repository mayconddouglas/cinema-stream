import { fetchMetaWithRetry } from "@/lib/torrent";

export function getProxyBase() {
  const env = (import.meta as unknown as { env?: { VITE_TORRENT_PROXY_URL?: string } }).env;
  const raw = env?.VITE_TORRENT_PROXY_URL;
  return typeof raw === "string" ? raw.trim().replace(/\/+$/, "") : "";
}

export function getVlcDeepLink(streamUrl: string, startSeconds?: number): string {
  const timeFragment = startSeconds && startSeconds > 10 ? `#t=${Math.floor(startSeconds)}s` : "";
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  const isAndroid = /android/i.test(ua);
  if (isAndroid) {
    return `intent:${streamUrl}${timeFragment}#Intent;package=org.videolan.vlc;action=android.intent.action.VIEW;type=video/*;end`;
  }
  return `${streamUrl.replace(/^https?:\/\//, "vlc://")}${timeFragment}`;
}

export async function prewarmMagnet(magnet: string): Promise<void> {
  const base = getProxyBase();
  if (!base) return;
  try {
    await fetch(`${base}/prewarm`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ magnet }),
    });
  } catch {
    void 0;
  }
}

export async function getSwarmHealth(magnet: string): Promise<number> {
  const base = getProxyBase();
  if (!base) return -1;
  try {
    const url = new URL(`${base}/swarm-health`);
    url.searchParams.set("magnet", magnet);
    const res = await fetch(url.toString());
    if (!res.ok) return -1;
    const data = (await res.json()) as { score?: unknown };
    const score = typeof data.score === "number" ? data.score : -1;
    return Number.isFinite(score) ? score : -1;
  } catch {
    return -1;
  }
}

export async function resolveStreamUrl(opts: {
  magnet: string;
  fallbackMagnets?: string[];
  fileIndex?: number | null;
}): Promise<{ streamUrl: string; fileIndex: number }> {
  const base = getProxyBase();
  if (!base) throw new Error("proxy_not_configured");

  const candidates = [opts.magnet, ...(opts.fallbackMagnets ?? [])]
    .map((m) => m.trim())
    .filter((m, i, arr) => m.startsWith("magnet:?") && arr.indexOf(m) === i);
  if (candidates.length === 0) throw new Error("invalid_magnet");

  const buildDirectStreamUrl = (magnet: string, fileIndex: number) =>
    `${base}/stream?magnet=${encodeURIComponent(magnet)}&index=${fileIndex}`;

  const primary = candidates[0];
  // Non-blocking warmup to avoid delaying "Abrir no VLC".
  void prewarmMagnet(primary);

  // Fast path: when file index is known, open immediately on primary magnet.
  if (typeof opts.fileIndex === "number" && opts.fileIndex >= 0) {
    return {
      streamUrl: buildDirectStreamUrl(primary, opts.fileIndex),
      fileIndex: opts.fileIndex,
    };
  }

  // Fast path for unknown index: quick single metadata probe with short timeout.
  const quickMeta = await fetchMetaWithRetry(base, primary, {
    maxAttempts: 1,
    timeoutMs: 2500,
  });
  if (quickMeta.ok) {
    const bestIndex =
      typeof quickMeta.meta.bestVideoIndex === "number" ? quickMeta.meta.bestVideoIndex : 0;
    return {
      streamUrl: buildDirectStreamUrl(primary, bestIndex),
      fileIndex: bestIndex,
    };
  }

  // Fallback path: rank magnets by health and attempt a deeper resolve.
  const rankedCandidates = await Promise.all(
    candidates.map(async (magnet) => ({ magnet, score: await getSwarmHealth(magnet) })),
  );
  rankedCandidates.sort((a, b) => b.score - a.score);

  let lastError = "stream_resolve_failed";
  for (const { magnet } of rankedCandidates) {
    void prewarmMagnet(magnet);

    const result = await fetchMetaWithRetry(base, magnet, {
      maxAttempts: 2,
      timeoutMs: 10_000,
    });
    if (!result.ok) {
      lastError = result.error;
      continue;
    }

    const bestIndex =
      typeof result.meta.bestVideoIndex === "number" ? result.meta.bestVideoIndex : 0;

    return {
      streamUrl: buildDirectStreamUrl(magnet, bestIndex),
      fileIndex: bestIndex,
    };
  }

  // Last resort: open primary with index 0 to prioritize launch speed.
  if (primary) {
    return {
      streamUrl: buildDirectStreamUrl(primary, 0),
      fileIndex: 0,
    };
  }
  throw new Error(lastError);
}

export async function openVlcFromMagnet(opts: {
  magnet: string;
  fallbackMagnets?: string[];
  fileIndex?: number | null;
  startSeconds?: number;
}) {
  const { streamUrl } = await resolveStreamUrl({
    magnet: opts.magnet,
    fallbackMagnets: opts.fallbackMagnets,
    fileIndex: opts.fileIndex,
  });
  window.location.href = getVlcDeepLink(streamUrl, opts.startSeconds);
}
