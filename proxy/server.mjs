import http from "node:http";
import WebTorrent from "webtorrent";

const VIDEO_RE = /\.(mp4|webm|mkv|m4v|mov|avi|ogv|ogg)$/i;
const NATIVE_PLAYABLE_RE = /\.(mp4|webm|ogv|ogg|m4v)$/i;
const DEFAULT_ANNOUNCE = [
  "udp://tracker.opentrackr.org:1337/announce",
  "udp://tracker.openbittorrent.com:80/announce",
  "udp://tracker.internetwarriors.net:1337/announce",
  "udp://tracker.leechers-paradise.org:6969/announce",
  "https://tracker1.520.jp:443/announce",
  "https://tracker.torrent.eu.org:443/announce",
];

function getContentType(name) {
  const lower = String(name).toLowerCase();
  if (lower.endsWith(".mp4") || lower.endsWith(".m4v")) return "video/mp4";
  if (lower.endsWith(".webm")) return "video/webm";
  if (lower.endsWith(".ogv") || lower.endsWith(".ogg")) return "video/ogg";
  if (lower.endsWith(".mkv")) return "video/x-matroska";
  if (lower.endsWith(".mov")) return "video/quicktime";
  if (lower.endsWith(".avi")) return "video/x-msvideo";
  return "application/octet-stream";
}

function pickVideoFile(torrent) {
  const videoFiles = (torrent.files ?? []).filter((f) => VIDEO_RE.test(f.name));
  if (videoFiles.length === 0) return null;
  const playable = videoFiles.filter((f) => NATIVE_PLAYABLE_RE.test(f.name));
  const src = playable.length ? playable : videoFiles;
  return src.reduce((best, f) => (!best || f.length > best.length ? f : best), null);
}

function parseRange(rangeHeader, size) {
  if (!rangeHeader) return null;
  const match = /^bytes=(\d*)-(\d*)$/i.exec(String(rangeHeader).trim());
  if (!match) return null;

  const startRaw = match[1];
  const endRaw = match[2];

  let start = startRaw ? Number(startRaw) : 0;
  let end = endRaw ? Number(endRaw) : size - 1;

  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  if (start < 0) start = 0;
  if (end >= size) end = size - 1;
  if (end < start) return null;

  return { start, end };
}

function waitForReady(torrent) {
  if (torrent.ready) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const onReady = () => {
      cleanup();
      resolve();
    };
    const onError = (err) => {
      cleanup();
      reject(err);
    };
    const cleanup = () => {
      torrent.off("ready", onReady);
      torrent.off("error", onError);
    };
    torrent.on("ready", onReady);
    torrent.on("error", onError);
  });
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("content-length", Buffer.byteLength(body));
  res.end(body);
}

function setCors(res) {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "GET,OPTIONS");
  res.setHeader("access-control-allow-headers", "range,content-type");
  res.setHeader("access-control-expose-headers", "accept-ranges,content-range,content-length,content-type");
}

const client = new WebTorrent({ dht: true });
const torrents = new Map();

function cleanupTorrents() {
  const now = Date.now();
  const maxIdleMs = 10 * 60 * 1000;
  const maxDoneMs = 30 * 60 * 1000;

  for (const [key, t] of torrents.entries()) {
    const lastAccess = typeof t.__lastAccess === "number" ? t.__lastAccess : now;
    const doneAt = typeof t.__doneAt === "number" ? t.__doneAt : 0;
    const idleMs = now - lastAccess;
    const doneMs = doneAt ? now - doneAt : 0;
    if (idleMs > maxIdleMs || (doneAt && doneMs > maxDoneMs)) {
      try {
        t.destroy();
      } catch {}
      torrents.delete(key);
    }
  }

  const maxEntries = 3;
  if (torrents.size > maxEntries) {
    const entries = [...torrents.entries()].sort(
      (a, b) => (a[1].__lastAccess ?? 0) - (b[1].__lastAccess ?? 0),
    );
    for (const [key, t] of entries.slice(0, torrents.size - maxEntries)) {
      try {
        t.destroy();
      } catch {}
      torrents.delete(key);
    }
  }
}

const port = Number(process.env.PORT || 8787);

const server = http.createServer(async (req, res) => {
  try {
    setCors(res);
    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      res.end();
      return;
    }

    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    if (req.method !== "GET") {
      sendJson(res, 405, { error: "method_not_allowed" });
      return;
    }

    if (url.pathname === "/health") {
      sendJson(res, 200, { ok: true });
      return;
    }

    if (url.pathname !== "/stream") {
      sendJson(res, 404, { error: "not_found" });
      return;
    }

    const magnet = url.searchParams.get("magnet") || "";
    if (!magnet.startsWith("magnet:?") || magnet.length > 8192) {
      sendJson(res, 400, { error: "invalid_magnet" });
      return;
    }

    cleanupTorrents();

    let torrent = torrents.get(magnet);
    if (!torrent) {
      torrent = client.add(magnet, { announce: DEFAULT_ANNOUNCE });
      torrent.__lastAccess = Date.now();
      torrents.set(magnet, torrent);
      torrent.on("done", () => {
        torrent.__doneAt = Date.now();
      });
    } else {
      torrent.__lastAccess = Date.now();
    }

    await waitForReady(torrent);

    const file = pickVideoFile(torrent);
    if (!file) {
      sendJson(res, 422, { error: "no_video_file" });
      return;
    }

    const total = Number(file.length) || 0;
    if (!total) {
      sendJson(res, 500, { error: "unknown_length" });
      return;
    }

    const range = parseRange(req.headers.range, total);
    let start = 0;
    let end = total - 1;

    res.setHeader("accept-ranges", "bytes");
    res.setHeader("cache-control", "no-store");
    res.setHeader("content-type", getContentType(file.name));

    if (range) {
      start = range.start;
      end = range.end;
      res.statusCode = 206;
      res.setHeader("content-range", `bytes ${start}-${end}/${total}`);
      res.setHeader("content-length", String(end - start + 1));
    } else {
      res.statusCode = 200;
      res.setHeader("content-length", String(total));
    }

    const stream = file.createReadStream({ start, end });
    stream.on("error", () => {
      try {
        res.destroy();
      } catch {}
    });
    stream.pipe(res);
  } catch (err) {
    try {
      sendJson(res, 500, { error: "internal_error" });
    } catch {}
  }
});

server.listen(port, "0.0.0.0", () => {
  process.stdout.write(`proxy listening on http://localhost:${port}\n`);
});

