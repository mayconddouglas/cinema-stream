import http from "node:http";
import { execFile, spawn } from "node:child_process";
import WebTorrent from "webtorrent";

let FFMPEG_AVAILABLE = false;

async function checkFfmpeg() {
  try {
    await new Promise((resolve, reject) => {
      execFile("ffprobe", ["-version"], { timeout: 5000 }, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    FFMPEG_AVAILABLE = true;
  } catch {
    console.warn("[ffmpeg] não encontrado — extração de trilhas desativada");
    FFMPEG_AVAILABLE = false;
  }
}

void checkFfmpeg();

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

function parseResolution(name) {
  const lower = String(name).toLowerCase();
  const match = /(^|[.\-_ ])(\d{3,4})p([.\-_ ]|$)/i.exec(lower);
  if (match) {
    const n = Number(match[2]);
    if (Number.isFinite(n) && n > 0) return n;
  }
  if (/(^|[.\-_ ])4k([.\-_ ]|$)/i.test(lower)) return 2160;
  return 0;
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
  res.setHeader(
    "access-control-expose-headers",
    "accept-ranges,content-range,content-length,content-type",
  );
}

const client = new WebTorrent({ dht: true });
const torrents = new Map();
const torrentMetaCache = new Map();
const torrentProbeCache = new Map();
const subtitleExtractCache = new Map();

function getCachedTorrentMeta(magnet) {
  const entry = torrentMetaCache.get(magnet);
  if (!entry) return null;
  const ts = typeof entry.ts === "number" ? entry.ts : 0;
  if (!ts) return null;
  const ttlMs = 30 * 60 * 1000;
  if (Date.now() - ts > ttlMs) {
    torrentMetaCache.delete(magnet);
    return null;
  }
  return entry.data ?? null;
}

function setCachedTorrentMeta(magnet, data) {
  torrentMetaCache.set(magnet, { ts: Date.now(), data });
}

function getMagnetHash(magnet) {
  try {
    const url = new URL(magnet);
    const xt = url.searchParams.get("xt") ?? "";
    if (xt.startsWith("urn:btih:")) return xt.slice(9).toLowerCase().slice(0, 40);
    return "";
  } catch {
    return "";
  }
}

function getCachedProbe(magnet) {
  const key = getMagnetHash(magnet);
  if (!key) return null;
  const entry = torrentProbeCache.get(key);
  if (!entry) return null;
  const ts = typeof entry.ts === "number" ? entry.ts : 0;
  const ttlMs = 30 * 60 * 1000;
  if (!ts || Date.now() - ts > ttlMs) {
    torrentProbeCache.delete(key);
    return null;
  }
  return entry.data ?? null;
}

function setCachedProbe(magnet, data) {
  const key = getMagnetHash(magnet);
  if (!key) return;
  torrentProbeCache.set(key, { ts: Date.now(), data });
}

function getCachedExtractedSubtitle(magnet, trackIndex) {
  const key = getMagnetHash(magnet);
  if (!key) return null;
  const k = `${key}:${trackIndex}`;
  const entry = subtitleExtractCache.get(k);
  if (!entry) return null;
  const ts = typeof entry.ts === "number" ? entry.ts : 0;
  const ttlMs = 60 * 60 * 1000;
  if (!ts || Date.now() - ts > ttlMs) {
    subtitleExtractCache.delete(k);
    return null;
  }
  return typeof entry.data === "string" ? entry.data : null;
}

function setCachedExtractedSubtitle(magnet, trackIndex, vtt) {
  const key = getMagnetHash(magnet);
  if (!key) return;
  const k = `${key}:${trackIndex}`;
  subtitleExtractCache.set(k, { ts: Date.now(), data: vtt });
}

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
      sendJson(res, 200, { ok: true, ffmpegAvailable: FFMPEG_AVAILABLE });
      return;
    }

    if (
      url.pathname !== "/stream" &&
      url.pathname !== "/meta" &&
      url.pathname !== "/file" &&
      url.pathname !== "/probe" &&
      url.pathname !== "/extract-audio" &&
      url.pathname !== "/extract-subtitle" &&
      url.pathname !== "/tmdb/search" &&
      url.pathname !== "/tmdb/movie" &&
      url.pathname !== "/tmdb/trending" &&
      url.pathname !== "/tmdb/popular" &&
      url.pathname !== "/tmdb/tv/search" &&
      url.pathname !== "/tmdb/tv" &&
      url.pathname !== "/tmdb/tv/season" &&
      url.pathname !== "/tmdb/trending/tv" &&
      url.pathname !== "/tmdb/popular/tv"
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

        if (url.pathname === "/tmdb/tv/search") {
          const query = url.searchParams.get("query") || "";
          const firstAirYear = url.searchParams.get("year") || "";
          const language = url.searchParams.get("language") || "pt-BR";

          if (!query || query.trim().length < 2 || query.length > 120) {
            sendJson(res, 400, { error: "invalid_query" });
            return;
          }

          const data = await tmdbFetch("/search/tv", {
            query,
            include_adult: "false",
            language,
            first_air_date_year: firstAirYear,
          });

          const results = Array.isArray(data?.results) ? data.results : [];
          const mapped = results.slice(0, 12).map((r) => ({
            id: r.id,
            title: r.name,
            originalTitle: r.original_name,
            overview: r.overview,
            year: r.first_air_date ? String(r.first_air_date).slice(0, 4) : null,
            poster: r.poster_path ? `${TMDB_IMAGE_BASE}/w500${r.poster_path}` : null,
            backdrop: r.backdrop_path ? `${TMDB_IMAGE_BASE}/w780${r.backdrop_path}` : null,
          }));

          sendJson(res, 200, { results: mapped });
          return;
        }

        if (url.pathname === "/tmdb/trending") {
          const language = url.searchParams.get("language") || "pt-BR";
          const data = await tmdbFetch("/trending/movie/day", { language });
          const results = Array.isArray(data?.results) ? data.results : [];
          const mapped = results.slice(0, 24).map((r) => ({
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

        if (url.pathname === "/tmdb/trending/tv") {
          const language = url.searchParams.get("language") || "pt-BR";
          const data = await tmdbFetch("/trending/tv/day", { language });
          const results = Array.isArray(data?.results) ? data.results : [];
          const mapped = results.slice(0, 24).map((r) => ({
            id: r.id,
            title: r.name,
            originalTitle: r.original_name,
            overview: r.overview,
            year: r.first_air_date ? String(r.first_air_date).slice(0, 4) : null,
            poster: r.poster_path ? `${TMDB_IMAGE_BASE}/w500${r.poster_path}` : null,
            backdrop: r.backdrop_path ? `${TMDB_IMAGE_BASE}/w780${r.backdrop_path}` : null,
          }));
          sendJson(res, 200, { results: mapped });
          return;
        }

        if (url.pathname === "/tmdb/popular") {
          const language = url.searchParams.get("language") || "pt-BR";
          const page = url.searchParams.get("page") || "1";
          const data = await tmdbFetch("/movie/popular", { language, page });
          const results = Array.isArray(data?.results) ? data.results : [];
          const mapped = results.slice(0, 24).map((r) => ({
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

        if (url.pathname === "/tmdb/popular/tv") {
          const language = url.searchParams.get("language") || "pt-BR";
          const page = url.searchParams.get("page") || "1";
          const data = await tmdbFetch("/tv/popular", { language, page });
          const results = Array.isArray(data?.results) ? data.results : [];
          const mapped = results.slice(0, 24).map((r) => ({
            id: r.id,
            title: r.name,
            originalTitle: r.original_name,
            overview: r.overview,
            year: r.first_air_date ? String(r.first_air_date).slice(0, 4) : null,
            poster: r.poster_path ? `${TMDB_IMAGE_BASE}/w500${r.poster_path}` : null,
            backdrop: r.backdrop_path ? `${TMDB_IMAGE_BASE}/w780${r.backdrop_path}` : null,
          }));
          sendJson(res, 200, { results: mapped });
          return;
        }

        if (url.pathname === "/tmdb/tv") {
          const idRaw = url.searchParams.get("id") || "";
          const language = url.searchParams.get("language") || "pt-BR";
          const id = Number(idRaw);
          if (!Number.isFinite(id) || id <= 0) {
            sendJson(res, 400, { error: "invalid_id" });
            return;
          }

          const data = await tmdbFetch(`/tv/${id}`, {
            language,
            append_to_response: "external_ids,credits,videos,recommendations",
          });

          const castSrc = Array.isArray(data?.credits?.cast) ? data.credits.cast : [];
          const cast = castSrc.slice(0, 12).map((c) => ({
            id: c.id,
            name: c.name,
            character: c.character ?? null,
            profile: c.profile_path ? `${TMDB_IMAGE_BASE}/w185${c.profile_path}` : null,
          }));

          const vids = Array.isArray(data?.videos?.results) ? data.videos.results : [];
          const yt = vids.filter((v) => v?.site === "YouTube" && typeof v?.key === "string");
          const trailer =
            yt.find((v) => v?.type === "Trailer" && v?.official) ??
            yt.find((v) => v?.type === "Trailer") ??
            yt.find((v) => v?.type === "Teaser") ??
            null;

          const seasonsSrc = Array.isArray(data?.seasons) ? data.seasons : [];
          const seasons = seasonsSrc
            .filter((s) => typeof s?.season_number === "number")
            .map((s) => ({
              seasonNumber: s.season_number,
              name: s.name ?? null,
              episodeCount: s.episode_count ?? null,
              poster: s.poster_path ? `${TMDB_IMAGE_BASE}/w342${s.poster_path}` : null,
              year: s.air_date ? String(s.air_date).slice(0, 4) : null,
            }));

          sendJson(res, 200, {
            id: data.id,
            imdbId: data?.external_ids?.imdb_id ?? null,
            title: data.name,
            originalTitle: data.original_name,
            overview: data.overview,
            year: data.first_air_date ? String(data.first_air_date).slice(0, 4) : null,
            poster: data.poster_path ? `${TMDB_IMAGE_BASE}/w500${data.poster_path}` : null,
            backdrop: data.backdrop_path ? `${TMDB_IMAGE_BASE}/w1280${data.backdrop_path}` : null,
            genres: Array.isArray(data.genres)
              ? data.genres.map((g) => ({ id: g.id, name: g.name }))
              : [],
            seasons,
            cast,
            trailer: trailer
              ? {
                  site: trailer.site,
                  key: trailer.key,
                  name: trailer.name ?? null,
                }
              : null,
          });
          return;
        }

        if (url.pathname === "/tmdb/tv/season") {
          const idRaw = url.searchParams.get("id") || "";
          const seasonRaw = url.searchParams.get("season") || "";
          const language = url.searchParams.get("language") || "pt-BR";
          const id = Number(idRaw);
          const season = Number(seasonRaw);
          if (!Number.isFinite(id) || id <= 0 || !Number.isFinite(season) || season < 0) {
            sendJson(res, 400, { error: "invalid_id" });
            return;
          }

          const data = await tmdbFetch(`/tv/${id}/season/${season}`, { language });
          const eps = Array.isArray(data?.episodes) ? data.episodes : [];
          const episodes = eps
            .filter((e) => typeof e?.episode_number === "number")
            .map((e) => ({
              season: e.season_number ?? season,
              episode: e.episode_number,
              name: e.name ?? null,
              overview: e.overview ?? null,
              still: e.still_path ? `${TMDB_IMAGE_BASE}/w780${e.still_path}` : null,
              runtime: e.runtime ?? null,
              airDate: e.air_date ?? null,
            }));

          sendJson(res, 200, {
            id,
            season,
            episodes,
          });
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
            append_to_response: "external_ids,credits,videos,recommendations",
          });

          const castSrc = Array.isArray(data?.credits?.cast) ? data.credits.cast : [];
          const cast = castSrc.slice(0, 12).map((c) => ({
            id: c.id,
            name: c.name,
            character: c.character ?? null,
            profile: c.profile_path ? `${TMDB_IMAGE_BASE}/w185${c.profile_path}` : null,
          }));

          const vids = Array.isArray(data?.videos?.results) ? data.videos.results : [];
          const yt = vids.filter((v) => v?.site === "YouTube" && typeof v?.key === "string");
          const trailer =
            yt.find((v) => v?.type === "Trailer" && v?.official) ??
            yt.find((v) => v?.type === "Trailer") ??
            yt.find((v) => v?.type === "Teaser") ??
            null;

          const recSrc = Array.isArray(data?.recommendations?.results)
            ? data.recommendations.results
            : [];
          const recommendations = recSrc.slice(0, 12).map((r) => ({
            id: r.id,
            title: r.title,
            originalTitle: r.original_title,
            overview: r.overview,
            year: r.release_date ? String(r.release_date).slice(0, 4) : null,
            poster: r.poster_path ? `${TMDB_IMAGE_BASE}/w500${r.poster_path}` : null,
            backdrop: r.backdrop_path ? `${TMDB_IMAGE_BASE}/w780${r.backdrop_path}` : null,
          }));

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
            genres: Array.isArray(data.genres)
              ? data.genres.map((g) => ({ id: g.id, name: g.name }))
              : [],
            cast,
            trailer: trailer
              ? {
                  site: trailer.site,
                  key: trailer.key,
                  name: trailer.name ?? null,
                }
              : null,
            recommendations,
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

    if (url.pathname === "/meta") {
      const cached = getCachedTorrentMeta(magnet);
      if (cached) {
        sendJson(res, 200, cached);
        return;
      }
    }

    if (url.pathname === "/probe") {
      if (!FFMPEG_AVAILABLE) {
        sendJson(res, 503, { error: "ffmpeg_unavailable" });
        return;
      }
      const cached = getCachedProbe(magnet);
      if (cached) {
        sendJson(res, 200, cached);
        return;
      }
    }

    if (url.pathname === "/extract-subtitle") {
      if (!FFMPEG_AVAILABLE) {
        sendJson(res, 503, { error: "ffmpeg_unavailable" });
        return;
      }
      const trackIndexRaw = url.searchParams.get("trackIndex") || "";
      const trackIndex = Number(trackIndexRaw);
      if (!Number.isFinite(trackIndex) || trackIndex < 0) {
        sendJson(res, 400, { error: "invalid_track_index" });
        return;
      }
      const cached = getCachedExtractedSubtitle(magnet, trackIndex);
      if (cached) {
        res.statusCode = 200;
        res.setHeader("cache-control", "no-store");
        res.setHeader("content-type", "text/vtt; charset=utf-8");
        res.end(cached);
        return;
      }
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

    if (url.pathname === "/probe") {
      if (!FFMPEG_AVAILABLE) {
        sendJson(res, 503, { error: "ffmpeg_unavailable" });
        return;
      }
      const cached = getCachedProbe(magnet);
      if (cached) {
        sendJson(res, 200, cached);
        return;
      }

      const file = pickVideoFile(torrent);
      if (!file) {
        sendJson(res, 422, { error: "no_video_file" });
        return;
      }

      const proc = spawn(
        "ffprobe",
        ["-v", "quiet", "-print_format", "json", "-show_streams", "-i", "pipe:0"],
        {
          stdio: ["pipe", "pipe", "pipe"],
        },
      );

      const chunks = [];
      proc.stdout.on("data", (d) => chunks.push(d));
      proc.stderr.on("data", () => {});

      const stream = file.createReadStream();
      stream.on("error", () => {
        try {
          proc.kill("SIGKILL");
        } catch {}
      });

      req.on("close", () => {
        try {
          stream.destroy();
        } catch {}
        try {
          proc.kill("SIGKILL");
        } catch {}
      });

      stream.pipe(proc.stdin);

      const code = await new Promise((resolve) => {
        proc.on("close", (code) => resolve(code ?? 1));
      });

      if (code !== 0) {
        sendJson(res, 502, { error: "ffprobe_failed" });
        return;
      }

      let parsed = null;
      try {
        parsed = JSON.parse(Buffer.concat(chunks).toString("utf-8"));
      } catch {
        sendJson(res, 502, { error: "ffprobe_invalid_json" });
        return;
      }

      const streams = Array.isArray(parsed?.streams) ? parsed.streams : [];
      const audioTracks = streams
        .filter((s) => s?.codec_type === "audio")
        .map((s) => ({
          index: typeof s.index === "number" ? s.index : null,
          codec: typeof s.codec_name === "string" ? s.codec_name : null,
          lang: typeof s.tags?.language === "string" ? s.tags.language : null,
          label: typeof s.tags?.language === "string" ? s.tags.language : null,
          channels: typeof s.channels === "number" ? s.channels : null,
          default: !!s.disposition?.default,
        }))
        .filter((t) => typeof t.index === "number");

      const subtitleTracks = streams
        .filter((s) => s?.codec_type === "subtitle")
        .map((s) => ({
          index: typeof s.index === "number" ? s.index : null,
          codec: typeof s.codec_name === "string" ? s.codec_name : null,
          lang: typeof s.tags?.language === "string" ? s.tags.language : null,
          label: typeof s.tags?.language === "string" ? s.tags.language : null,
          forced: !!s.disposition?.forced,
        }))
        .filter((t) => typeof t.index === "number");

      const payload = { audioTracks, subtitleTracks };
      setCachedProbe(magnet, payload);
      sendJson(res, 200, payload);
      return;
    }

    if (url.pathname === "/extract-audio") {
      if (!FFMPEG_AVAILABLE) {
        sendJson(res, 503, { error: "ffmpeg_unavailable" });
        return;
      }
      const trackIndexRaw = url.searchParams.get("trackIndex") || "";
      const trackIndex = Number(trackIndexRaw);
      if (!Number.isFinite(trackIndex) || trackIndex < 0) {
        sendJson(res, 400, { error: "invalid_track_index" });
        return;
      }

      const file = pickVideoFile(torrent);
      if (!file) {
        sendJson(res, 422, { error: "no_video_file" });
        return;
      }

      const proc = spawn(
        "ffmpeg",
        [
          "-i",
          "pipe:0",
          "-map",
          `0:${trackIndex}`,
          "-vn",
          "-acodec",
          "aac",
          "-b:a",
          "192k",
          "-f",
          "adts",
          "pipe:1",
        ],
        { stdio: ["pipe", "pipe", "pipe"] },
      );

      res.statusCode = 200;
      res.setHeader("cache-control", "no-store");
      res.setHeader("content-type", "audio/aac");
      res.setHeader("transfer-encoding", "chunked");

      const stream = file.createReadStream();
      stream.on("error", () => {
        try {
          res.destroy();
        } catch {}
        try {
          proc.kill("SIGKILL");
        } catch {}
      });

      req.on("close", () => {
        try {
          stream.destroy();
        } catch {}
        try {
          proc.kill("SIGKILL");
        } catch {}
      });

      stream.pipe(proc.stdin);
      proc.stdout.pipe(res);

      proc.on("close", () => {
        try {
          res.end();
        } catch {}
      });

      return;
    }

    if (url.pathname === "/extract-subtitle") {
      if (!FFMPEG_AVAILABLE) {
        sendJson(res, 503, { error: "ffmpeg_unavailable" });
        return;
      }
      const trackIndexRaw = url.searchParams.get("trackIndex") || "";
      const trackIndex = Number(trackIndexRaw);
      if (!Number.isFinite(trackIndex) || trackIndex < 0) {
        sendJson(res, 400, { error: "invalid_track_index" });
        return;
      }

      const cached = getCachedExtractedSubtitle(magnet, trackIndex);
      if (cached) {
        res.statusCode = 200;
        res.setHeader("cache-control", "no-store");
        res.setHeader("content-type", "text/vtt; charset=utf-8");
        res.end(cached);
        return;
      }

      const file = pickVideoFile(torrent);
      if (!file) {
        sendJson(res, 422, { error: "no_video_file" });
        return;
      }

      const proc = spawn(
        "ffmpeg",
        ["-i", "pipe:0", "-map", `0:${trackIndex}`, "-f", "webvtt", "pipe:1"],
        {
          stdio: ["pipe", "pipe", "pipe"],
        },
      );

      const chunks = [];
      proc.stdout.on("data", (d) => chunks.push(d));
      proc.stderr.on("data", () => {});

      const stream = file.createReadStream();
      stream.on("error", () => {
        try {
          proc.kill("SIGKILL");
        } catch {}
      });

      req.on("close", () => {
        try {
          stream.destroy();
        } catch {}
        try {
          proc.kill("SIGKILL");
        } catch {}
      });

      stream.pipe(proc.stdin);

      const code = await new Promise((resolve) => {
        proc.on("close", (code) => resolve(code ?? 1));
      });

      if (code !== 0) {
        sendJson(res, 502, { error: "ffmpeg_failed" });
        return;
      }

      const vtt = Buffer.concat(chunks).toString("utf-8");
      setCachedExtractedSubtitle(magnet, trackIndex, vtt);

      res.statusCode = 200;
      res.setHeader("cache-control", "no-store");
      res.setHeader("content-type", "text/vtt; charset=utf-8");
      res.end(vtt);
      return;
    }

    if (url.pathname === "/meta") {
      const files = (torrent.files ?? []).map((f, index) => {
        const kind = VIDEO_RE.test(f.name) ? "video" : SUB_RE.test(f.name) ? "subtitle" : "other";
        const lang = kind === "subtitle" ? guessLang(f.name) : null;
        const resolution = kind === "video" ? parseResolution(f.name) : null;
        return {
          index,
          name: f.name,
          length: Number(f.length) || 0,
          kind,
          lang: lang?.lang ?? null,
          label: lang?.label ?? null,
          resolution,
        };
      });
      const video = pickVideoFile(torrent);
      const bestVideoIndex = video
        ? (files.find((x) => x.kind === "video" && x.name === video.name)?.index ?? null)
        : null;
      const payload = { bestVideoIndex, files };
      setCachedTorrentMeta(magnet, payload);
      sendJson(res, 200, payload);
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

    const indexRaw = url.searchParams.get("index");
    const index = indexRaw ? Number(indexRaw) : NaN;
    const indexedFile =
      Number.isFinite(index) && index >= 0 && index < (torrent.files?.length ?? 0)
        ? torrent.files[index]
        : null;

    const file =
      indexedFile && VIDEO_RE.test(indexedFile.name) ? indexedFile : pickVideoFile(torrent);
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
