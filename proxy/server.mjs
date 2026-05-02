import http from "node:http";
import WebTorrent from "webtorrent";

const VIDEO_RE = /\.(mp4|webm|mkv|m4v|mov|avi|ogv|ogg)$/i;
const NATIVE_PLAYABLE_RE = /\.(mp4|webm|ogv|ogg|m4v)$/i;
const SUB_RE = /\.(vtt|srt|ass|ssa)$/i;
const DEFAULT_ANNOUNCE = [
  "udp://tracker.opentrackr.org:1337/announce",
  "udp://tracker.openbittorrent.com:80/announce",
  "udp://tracker.internetwarriors.net:1337/announce",
  "udp://tracker.leechers-paradise.org:6969/announce",
  "https://tracker1.520.jp:443/announce",
  "https://tracker.torrent.eu.org:443/announce",
];
const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p";

function getContentType(name) {
  const lower = String(name).toLowerCase();
  if (lower.endsWith(".mp4") || lower.endsWith(".m4v")) return "video/mp4";
  if (lower.endsWith(".webm")) return "video/webm";
  if (lower.endsWith(".ogv") || lower.endsWith(".ogg")) return "video/ogg";
  if (lower.endsWith(".mkv")) return "video/x-matroska";
  if (lower.endsWith(".mov")) return "video/quicktime";
  if (lower.endsWith(".avi")) return "video/x-msvideo";
  if (lower.endsWith(".vtt")) return "text/vtt; charset=utf-8";
  if (lower.endsWith(".srt")) return "application/x-subrip; charset=utf-8";
  if (lower.endsWith(".ass") || lower.endsWith(".ssa")) return "text/plain; charset=utf-8";
  return "application/octet-stream";
}

function guessLang(name) {
  const lower = String(name).toLowerCase();
  const candidates = [
    { re: /(^|[.\-_ ])pt(br)?([.\-_ ]|$)/i, lang: "pt-BR", label: "Português (Brasil)" },
    { re: /(^|[.\-_ ])pt([.\-_ ]|$)/i, lang: "pt", label: "Português" },
    { re: /(^|[.\-_ ])en(g)?([.\-_ ]|$)/i, lang: "en", label: "English" },
    { re: /(^|[.\-_ ])es(p)?([.\-_ ]|$)/i, lang: "es", label: "Español" },
    { re: /(^|[.\-_ ])fr([.\-_ ]|$)/i, lang: "fr", label: "Français" },
    { re: /(^|[.\-_ ])it([.\-_ ]|$)/i, lang: "it", label: "Italiano" },
    { re: /(^|[.\-_ ])de([.\-_ ]|$)/i, lang: "de", label: "Deutsch" },
    { re: /(^|[.\-_ ])ja(p)?([.\-_ ]|$)/i, lang: "ja", label: "日本語" },
  ];
  for (const c of candidates) {
    if (c.re.test(lower)) return { lang: c.lang, label: c.label };
  }
  return { lang: "und", label: "Desconhecido" };
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

function waitForReady(torrent, timeoutMs) {
  if (torrent.ready) return Promise.resolve();
  return new Promise((resolve, reject) => {
    let timer = null;
    const onReady = () => {
      cleanup();
      resolve();
    };
    const onError = (err) => {
      cleanup();
      reject(err);
    };
    const cleanup = () => {
      if (timer) clearTimeout(timer);
      torrent.off("ready", onReady);
      torrent.off("error", onError);
    };
    if (timeoutMs && Number.isFinite(timeoutMs) && timeoutMs > 0) {
      timer = setTimeout(() => {
        cleanup();
        reject(new Error("timeout"));
      }, timeoutMs);
    }
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

async function tmdbFetch(pathname, params) {
  const apiKey = process.env.TMDB_API_KEY || "";
  if (!apiKey) {
    const err = new Error("tmdb_not_configured");
    err.code = "tmdb_not_configured";
    throw err;
  }

  const url = new URL(`https://api.themoviedb.org/3${pathname}`);
  url.searchParams.set("api_key", apiKey);
  for (const [k, v] of Object.entries(params || {})) {
    if (v === undefined || v === null || v === "") continue;
    url.searchParams.set(k, String(v));
  }

  const res = await fetch(url.toString(), {
    headers: {
      accept: "application/json",
    },
  });

  if (!res.ok) {
    const err = new Error("tmdb_error");
    err.status = res.status;
    throw err;
  }

  return res.json();
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

    if (
      url.pathname !== "/stream" &&
      url.pathname !== "/meta" &&
      url.pathname !== "/file" &&
      url.pathname !== "/tmdb/search" &&
      url.pathname !== "/tmdb/movie"
    ) {
      sendJson(res, 404, { error: "not_found" });
      return;
    }

    if (url.pathname.startsWith("/tmdb/")) {
      try {
        res.setHeader("cache-control", "no-store");

        if (url.pathname === "/tmdb/search") {
          const query = url.searchParams.get("query") || "";
          const year = url.searchParams.get("year") || "";
          const language = url.searchParams.get("language") || "pt-BR";

          if (!query || query.trim().length < 2 || query.length > 120) {
            sendJson(res, 400, { error: "invalid_query" });
            return;
          }

          const data = await tmdbFetch("/search/movie", {
            query,
            include_adult: "false",
            language,
            year,
          });

          const results = Array.isArray(data?.results) ? data.results : [];
          const mapped = results.slice(0, 12).map((r) => ({
            id: r.id,
            title: r.title,
            originalTitle: r.original_title,
            overview: r.overview,
            year: r.release_date ? String(r.release_date).slice(0, 4) : null,
            poster: r.poster_path ? `${TMDB_IMAGE_BASE}/w500${r.poster_path}` : null,
            backdrop: r.backdrop_path ? `${TMDB_IMAGE_BASE}/w780${r.backdrop_path}` : null,
          }));

          sendJson(res, 200, { results: mapped });
          return;
        }

        if (url.pathname === "/tmdb/movie") {
          const idRaw = url.searchParams.get("id") || "";
          const language = url.searchParams.get("language") || "pt-BR";
          const id = Number(idRaw);
          if (!Number.isFinite(id) || id <= 0) {
            sendJson(res, 400, { error: "invalid_id" });
            return;
          }

          const data = await tmdbFetch(`/movie/${id}`, {
            language,
            append_to_response: "external_ids",
          });

          sendJson(res, 200, {
            id: data.id,
            imdbId: data?.external_ids?.imdb_id ?? null,
            title: data.title,
            originalTitle: data.original_title,
            overview: data.overview,
            year: data.release_date ? String(data.release_date).slice(0, 4) : null,
            poster: data.poster_path ? `${TMDB_IMAGE_BASE}/w500${data.poster_path}` : null,
            backdrop: data.backdrop_path ? `${TMDB_IMAGE_BASE}/w1280${data.backdrop_path}` : null,
            runtime: data.runtime ?? null,
            genres: Array.isArray(data.genres) ? data.genres.map((g) => ({ id: g.id, name: g.name })) : [],
          });
          return;
        }
      } catch (e) {
        if (e?.code === "tmdb_not_configured") {
          sendJson(res, 503, { error: "tmdb_not_configured" });
          return;
        }
        sendJson(res, 502, { error: "tmdb_unavailable" });
        return;
      }
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

    try {
      await waitForReady(torrent, url.pathname === "/stream" ? 90_000 : 25_000);
    } catch (e) {
      sendJson(res, 504, { error: "metadata_timeout" });
      return;
    }

    if (url.pathname === "/meta") {
      const files = (torrent.files ?? []).map((f, index) => {
        const kind = VIDEO_RE.test(f.name) ? "video" : SUB_RE.test(f.name) ? "subtitle" : "other";
        const lang = kind === "subtitle" ? guessLang(f.name) : null;
        return {
          index,
          name: f.name,
          length: Number(f.length) || 0,
          kind,
          lang: lang?.lang ?? null,
          label: lang?.label ?? null,
        };
      });
      const video = pickVideoFile(torrent);
      const bestVideoIndex = video ? files.find((x) => x.kind === "video" && x.name === video.name)?.index ?? null : null;
      sendJson(res, 200, { bestVideoIndex, files });
      return;
    }

    if (url.pathname === "/file") {
      const indexRaw = url.searchParams.get("index");
      const index = indexRaw ? Number(indexRaw) : NaN;
      if (!Number.isFinite(index) || index < 0 || index >= (torrent.files?.length ?? 0)) {
        sendJson(res, 400, { error: "invalid_index" });
        return;
      }

      const file = torrent.files[index];
      if (!file || !SUB_RE.test(file.name)) {
        sendJson(res, 404, { error: "not_found" });
        return;
      }

      const total = Number(file.length) || 0;
      if (!total) {
        sendJson(res, 500, { error: "unknown_length" });
        return;
      }

      res.statusCode = 200;
      res.setHeader("cache-control", "no-store");
      res.setHeader("content-type", getContentType(file.name));
      res.setHeader("content-length", String(total));

      const stream = file.createReadStream();
      stream.on("error", () => {
        try {
          res.destroy();
        } catch {}
      });
      stream.pipe(res);
      return;
    }

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
