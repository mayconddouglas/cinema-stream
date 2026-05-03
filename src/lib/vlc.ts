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

export async function resolveStreamUrl(opts: {
  magnet: string;
  fileIndex?: number | null;
}): Promise<{ streamUrl: string; fileIndex: number }> {
  const base = getProxyBase();
  if (!base) throw new Error("proxy_not_configured");
  const magnet = opts.magnet.trim();
  if (!magnet.startsWith("magnet:?")) throw new Error("invalid_magnet");

  if (typeof opts.fileIndex === "number") {
    return {
      streamUrl: `${base}/stream?magnet=${encodeURIComponent(magnet)}&index=${opts.fileIndex}`,
      fileIndex: opts.fileIndex,
    };
  }

  const result = await fetchMetaWithRetry(base, magnet, { maxAttempts: 3 });
  if (!result.ok) throw new Error(result.error);

  const bestIndex = typeof result.meta.bestVideoIndex === "number" ? result.meta.bestVideoIndex : 0;

  return {
    streamUrl: `${base}/stream?magnet=${encodeURIComponent(magnet)}&index=${bestIndex}`,
    fileIndex: bestIndex,
  };
}

export async function openVlcFromMagnet(opts: {
  magnet: string;
  fileIndex?: number | null;
  startSeconds?: number;
}) {
  const { streamUrl } = await resolveStreamUrl({ magnet: opts.magnet, fileIndex: opts.fileIndex });
  window.location.href = getVlcDeepLink(streamUrl, opts.startSeconds);
}
