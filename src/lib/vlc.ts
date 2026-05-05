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

  const shorten = async (magnet: string, fileIndex: number) => {
    try {
      const res = await fetch(`${base}/shorten`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ magnet, fileIndex }),
      });
      if (!res.ok) throw new Error("shorten_failed");
      const data = (await res.json()) as { url?: string };
      if (typeof data?.url === "string" && data.url.startsWith("http")) {
        return data.url;
      }
      throw new Error("shorten_failed");
    } catch {
      return `${base}/stream?magnet=${encodeURIComponent(magnet)}&index=${fileIndex}`;
    }
  };

  const rankedCandidates = await Promise.all(
    candidates.map(async (magnet) => ({ magnet, score: await getSwarmHealth(magnet) })),
  );
  rankedCandidates.sort((a, b) => b.score - a.score);

  let lastError = "stream_resolve_failed";
  for (const { magnet } of rankedCandidates) {
    await prewarmMagnet(magnet);

    if (typeof opts.fileIndex === "number") {
      return {
        streamUrl: await shorten(magnet, opts.fileIndex),
        fileIndex: opts.fileIndex,
      };
    }

    const result = await fetchMetaWithRetry(base, magnet, { maxAttempts: 3 });
    if (!result.ok) {
      lastError = result.error;
      continue;
    }

    const bestIndex =
      typeof result.meta.bestVideoIndex === "number" ? result.meta.bestVideoIndex : 0;

    return {
      streamUrl: await shorten(magnet, bestIndex),
      fileIndex: bestIndex,
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
