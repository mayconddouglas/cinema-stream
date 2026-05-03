import http from "node:http";
import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import WebTorrent from "webtorrent";
import Database from "better-sqlite3";

const API_SECRET = process.env.API_SECRET ?? "";
const XTREAM_USER = process.env.XTREAM_USER ?? "buffet";
const XTREAM_PASS = process.env.XTREAM_PASS ?? "buffet123";
const XTREAM_HOST = process.env.XTREAM_HOST ?? "";

const DATA_DIR = process.env.DATA_DIR ?? "/data";
try {
  fs.mkdirSync(DATA_DIR, { recursive: true });
} catch {
  void 0;
}

const db = new Database(`${DATA_DIR}/library.db`);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.exec(`
  CREATE TABLE IF NOT EXISTS movies (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    magnet TEXT NOT NULL,
    file_index INTEGER,
    poster TEXT,
    backdrop TEXT,
    description TEXT,
    year TEXT,
    tmdb_id INTEGER,
    imdb_id TEXT,
    favorite INTEGER DEFAULT 0,
    progress REAL DEFAULT 0,
    duration REAL DEFAULT 0,
    last_played_at INTEGER DEFAULT 0,
    added_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS series (
    tmdb_id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    original_title TEXT,
    overview TEXT,
    year TEXT,
    poster TEXT,
    backdrop TEXT,
    added_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS episodes (
    id TEXT PRIMARY KEY,
    show_tmdb_id INTEGER NOT NULL,
    season INTEGER NOT NULL,
    episode INTEGER NOT NULL,
    name TEXT NOT NULL,
    overview TEXT,
    still TEXT,
    runtime INTEGER,
    magnet TEXT,
    file_index INTEGER,
    progress REAL DEFAULT 0,
    duration REAL DEFAULT 0,
    last_played_at INTEGER DEFAULT 0,
    added_at INTEGER NOT NULL,
    FOREIGN KEY (show_tmdb_id) REFERENCES series(tmdb_id)
  );

  CREATE INDEX IF NOT EXISTS idx_episodes_show ON episodes(show_tmdb_id);
  CREATE INDEX IF NOT EXISTS idx_movies_added ON movies(added_at DESC);
`);

// ── MOVIES ──────────────────────────────────────────

function dbGetAllMovies() {
  return db.prepare("SELECT * FROM movies ORDER BY added_at DESC").all();
}

function dbGetMovieById(id) {
  return db.prepare("SELECT * FROM movies WHERE id = ?").get(id) ?? null;
}

function dbUpsertMovie(movie) {
  db.prepare(
    `
      INSERT INTO movies (id, title, magnet, file_index, poster, backdrop, description, year, tmdb_id, imdb_id, favorite, progress, duration, last_played_at, added_at)
      VALUES (@id, @title, @magnet, @file_index, @poster, @backdrop, @description, @year, @tmdb_id, @imdb_id, @favorite, @progress, @duration, @last_played_at, @added_at)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        magnet = excluded.magnet,
        file_index = COALESCE(excluded.file_index, file_index),
        poster = COALESCE(excluded.poster, poster),
        backdrop = COALESCE(excluded.backdrop, backdrop),
        description = COALESCE(excluded.description, description),
        year = COALESCE(excluded.year, year),
        tmdb_id = COALESCE(excluded.tmdb_id, tmdb_id),
        imdb_id = COALESCE(excluded.imdb_id, imdb_id),
        favorite = excluded.favorite,
        added_at = COALESCE(excluded.added_at, added_at)
    `,
  ).run({
    id: movie.id,
    title: movie.title,
    magnet: movie.magnet,
    file_index: movie.fileIndex ?? movie.file_index ?? null,
    poster: movie.poster ?? null,
    backdrop: movie.backdrop ?? null,
    description: movie.description ?? null,
    year: movie.year ?? null,
    tmdb_id: movie.tmdbId ?? movie.tmdb_id ?? null,
    imdb_id: movie.imdbId ?? movie.imdb_id ?? null,
    favorite: movie.favorite ? 1 : 0,
    progress: movie.progress ?? 0,
    duration: movie.duration ?? 0,
    last_played_at: movie.lastPlayedAt ?? movie.last_played_at ?? 0,
    added_at: movie.addedAt ?? movie.added_at ?? Date.now(),
  });
  return dbGetMovieById(movie.id);
}

function dbPatchMovie(id, patch) {
  const allowed = [
    "title",
    "poster",
    "backdrop",
    "description",
    "year",
    "favorite",
    "progress",
    "duration",
    "last_played_at",
    "file_index",
  ];
  const fields = Object.keys(patch).filter((k) => allowed.includes(k));
  if (fields.length === 0) return dbGetMovieById(id);
  const sets = fields.map((f) => `${f} = @${f}`).join(", ");
  db.prepare(`UPDATE movies SET ${sets} WHERE id = @id`).run({ ...patch, id });
  return dbGetMovieById(id);
}

function dbDeleteMovie(id) {
  db.prepare("DELETE FROM movies WHERE id = ?").run(id);
}

// ── SERIES ──────────────────────────────────────────

function dbGetAllSeries() {
  return db.prepare("SELECT * FROM series ORDER BY added_at DESC").all();
}

function dbUpsertSeries(series) {
  db.prepare(
    `
      INSERT INTO series (tmdb_id, title, original_title, overview, year, poster, backdrop, added_at)
      VALUES (@tmdb_id, @title, @original_title, @overview, @year, @poster, @backdrop, @added_at)
      ON CONFLICT(tmdb_id) DO UPDATE SET
        title = excluded.title,
        original_title = COALESCE(excluded.original_title, original_title),
        overview = COALESCE(excluded.overview, overview),
        year = COALESCE(excluded.year, year),
        poster = COALESCE(excluded.poster, poster),
        backdrop = COALESCE(excluded.backdrop, backdrop)
    `,
  ).run({
    tmdb_id: series.tmdbId ?? series.tmdb_id,
    title: series.title,
    original_title: series.originalTitle ?? series.original_title ?? null,
    overview: series.overview ?? null,
    year: series.year ?? null,
    poster: series.poster ?? null,
    backdrop: series.backdrop ?? null,
    added_at: series.addedAt ?? series.added_at ?? Date.now(),
  });
}

function dbGetSeriesById(tmdbId) {
  return db.prepare("SELECT * FROM series WHERE tmdb_id = ?").get(tmdbId) ?? null;
}

// ── EPISODES ────────────────────────────────────────

function dbGetEpisodesByShow(showTmdbId) {
  return db
    .prepare("SELECT * FROM episodes WHERE show_tmdb_id = ? ORDER BY season, episode")
    .all(showTmdbId);
}

function dbUpsertEpisode(ep) {
  db.prepare(
    `
      INSERT INTO episodes (id, show_tmdb_id, season, episode, name, overview, still, runtime, magnet, file_index, progress, duration, last_played_at, added_at)
      VALUES (@id, @show_tmdb_id, @season, @episode, @name, @overview, @still, @runtime, @magnet, @file_index, @progress, @duration, @last_played_at, @added_at)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        overview = COALESCE(excluded.overview, overview),
        still = COALESCE(excluded.still, still),
        runtime = COALESCE(excluded.runtime, runtime),
        magnet = COALESCE(excluded.magnet, magnet),
        file_index = COALESCE(excluded.file_index, file_index),
        added_at = COALESCE(added_at, excluded.added_at)
    `,
  ).run({
    id: ep.id,
    show_tmdb_id: ep.showTmdbId ?? ep.show_tmdb_id,
    season: ep.season,
    episode: ep.episode,
    name: ep.name,
    overview: ep.overview ?? null,
    still: ep.still ?? null,
    runtime: ep.runtime ?? null,
    magnet: ep.magnet ?? null,
    file_index: ep.fileIndex ?? ep.file_index ?? null,
    progress: ep.progress ?? 0,
    duration: ep.duration ?? 0,
    last_played_at: ep.lastPlayedAt ?? ep.last_played_at ?? 0,
    added_at: ep.addedAt ?? ep.added_at ?? Date.now(),
  });
}

function dbUpsertEpisodesBulk(showTmdbId, episodes) {
  const upsertMany = db.transaction((eps) => {
    for (const ep of eps) dbUpsertEpisode(ep);
  });
  upsertMany(episodes);
  return dbGetEpisodesByShow(showTmdbId);
}

function dbPatchEpisode(id, patch) {
  const allowed = ["progress", "duration", "last_played_at", "magnet", "file_index", "name"];
  const fields = Object.keys(patch).filter((k) => allowed.includes(k));
  if (fields.length === 0) return null;
  const sets = fields.map((f) => `${f} = @${f}`).join(", ");
  db.prepare(`UPDATE episodes SET ${sets} WHERE id = @id`).run({ ...patch, id });
  return db.prepare("SELECT * FROM episodes WHERE id = ?").get(id) ?? null;
}

// ── HELPER: converter snake_case do DB para camelCase do frontend ──

function movieToClient(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    magnet: row.magnet,
    fileIndex: row.file_index ?? undefined,
    poster: row.poster ?? undefined,
    backdrop: row.backdrop ?? undefined,
    description: row.description ?? undefined,
    year: row.year ?? undefined,
    tmdbId: row.tmdb_id ?? undefined,
    imdbId: row.imdb_id ?? undefined,
    favorite: row.favorite === 1,
    progress: row.progress ?? 0,
    duration: row.duration ?? 0,
    lastPlayedAt: row.last_played_at ?? 0,
    addedAt: row.added_at,
  };
}

function episodeToClient(row) {
  if (!row) return null;
  return {
    id: row.id,
    showTmdbId: row.show_tmdb_id,
    season: row.season,
    episode: row.episode,
    name: row.name,
    overview: row.overview ?? null,
    still: row.still ?? null,
    runtime: row.runtime ?? null,
    magnet: row.magnet ?? null,
    fileIndex: row.file_index ?? null,
    progress: row.progress ?? 0,
    duration: row.duration ?? 0,
    lastPlayedAt: row.last_played_at ?? 0,
    addedAt: row.added_at,
  };
}

function seriesToClient(row) {
  if (!row) return null;
  return {
    tmdbId: row.tmdb_id,
    title: row.title,
    originalTitle: row.original_title ?? null,
    overview: row.overview ?? null,
    year: row.year ?? null,
    poster: row.poster ?? null,
    backdrop: row.backdrop ?? null,
    addedAt: row.added_at,
  };
}

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

const VIDEO_RE = /\.(mp4|webm|mkv|m4v|mov|avi|ogv|ogg|ts|m2ts|mpg|mpeg|wmv|flv)$/i;
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
const EXTRA_TRACKERS = [
  "udp://tracker.opentrackr.org:1337/announce",
  "udp://open.stealth.si:80/announce",
  "udp://tracker.torrent.eu.org:451/announce",
  "udp://tracker.openbittorrent.com:6969/announce",
  "udp://explodie.org:6969/announce",
  "https://tracker.tamersunion.org:443/announce",
];
const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p";

function getMimeType(filename) {
  const ext = String(filename).toLowerCase().split(".").pop();
  const types = {
    mp4: "video/mp4",
    mkv: "video/x-matroska",
    avi: "video/x-msvideo",
    mov: "video/quicktime",
    wmv: "video/x-ms-wmv",
    webm: "video/webm",
    ts: "video/mp2t",
    m2ts: "video/mp2t",
    mpg: "video/mpeg",
    mpeg: "video/mpeg",
    flv: "video/x-flv",
    mp3: "audio/mpeg",
    aac: "audio/aac",
    flac: "audio/flac",
  };
  return types[ext] ?? "application/octet-stream";
}

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

function needsTransmux(filename) {
  const lower = String(filename).toLowerCase();
  return (
    lower.endsWith(".mkv") ||
    lower.endsWith(".avi") ||
    lower.endsWith(".mov") ||
    lower.endsWith(".wmv") ||
    lower.endsWith(".flv")
  );
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

function json(res, data, status = 200) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  });
  res.end(body);
}

function xtreamAuth(searchParams) {
  const user = searchParams.get("username");
  const pass = searchParams.get("password");
  return user === XTREAM_USER && pass === XTREAM_PASS;
}

function xtreamUnauthorized(res) {
  return json(res, { user_info: { auth: 0 } }, 401);
}

async function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(data));
      } catch {
        resolve({});
      }
    });
    req.on("error", reject);
  });
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
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Range, Content-Type");
  res.setHeader(
    "Access-Control-Expose-Headers",
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
    const method = req.method || "GET";
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const pathname = url.pathname;

    if (method === "OPTIONS") {
      if (pathname.startsWith("/api/")) {
        res.writeHead(204, {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
          "Access-Control-Max-Age": "86400",
        });
        res.end();
        return;
      }

      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
        "Access-Control-Allow-Headers": "Range, Content-Type",
        "Access-Control-Expose-Headers": "Content-Length, Content-Range, Accept-Ranges",
        "Access-Control-Max-Age": "86400",
      });
      res.end();
      return;
    }

    if (pathname === "/player_api.php" || pathname === "/get.php") {
      const params = url.searchParams;
      if (!xtreamAuth(params)) return xtreamUnauthorized(res);

      const action = params.get("action") ?? "";

      if (!action) {
        const host = XTREAM_HOST || `http://${req.headers.host}`;
        return json(res, {
          user_info: {
            username: XTREAM_USER,
            password: XTREAM_PASS,
            message: "Buffet de Vídeo",
            auth: 1,
            status: "Active",
            exp_date: "9999999999",
            is_trial: "0",
            active_cons: "1",
            created_at: "1700000000",
            max_connections: "10",
            allowed_output_formats: ["mkv", "mp4", "ts"],
          },
          server_info: {
            url: host,
            port: "80",
            https_port: "443",
            server_protocol: host.startsWith("https") ? "https" : "http",
            rtmp_port: "1935",
            timezone: "America/Sao_Paulo",
            timestamp_now: Math.floor(Date.now() / 1000),
            time_now: new Date().toISOString(),
          },
        });
      }

      if (action === "get_vod_categories") {
        return json(res, [{ category_id: "1", category_name: "Filmes", parent_id: 0 }]);
      }

      if (action === "get_series_categories") {
        return json(res, [{ category_id: "2", category_name: "Séries", parent_id: 0 }]);
      }

      if (action === "get_vod_streams") {
        const host = XTREAM_HOST || `http://${req.headers.host}`;
        const movies = dbGetAllMovies();
        return json(
          res,
          movies.map((m) => ({
            num: String(m.id).slice(0, 8),
            name: m.title,
            stream_type: "movie",
            stream_id: encodeURIComponent(m.id),
            stream_icon: m.poster ?? "",
            rating: "8",
            rating_5based: "4",
            added: String(Math.floor((m.added_at ?? Date.now()) / 1000)),
            category_id: "1",
            container_extension: "mkv",
            custom_sid: "",
            direct_source: `${host}/xtream/movie/${XTREAM_USER}/${XTREAM_PASS}/${encodeURIComponent(m.id)}.mkv`,
          })),
        );
      }

      if (action === "get_series") {
        const list = dbGetAllSeries();
        return json(
          res,
          list.map((s) => ({
            num: s.tmdb_id,
            name: s.title,
            series_id: s.tmdb_id,
            cover: s.poster ?? "",
            plot: s.overview ?? "",
            cast: "",
            director: "",
            genre: "Drama",
            releaseDate: s.year ?? "",
            last_modified: String(Math.floor((s.added_at ?? Date.now()) / 1000)),
            rating: "8",
            rating_5based: "4",
            backdrop_path: [s.backdrop ?? ""],
            youtube_trailer: "",
            episode_run_time: "45",
            category_id: "2",
          })),
        );
      }

      if (action === "get_series_info") {
        const seriesId = Number(params.get("series_id"));
        const host = XTREAM_HOST || `http://${req.headers.host}`;
        const series = dbGetSeriesById(seriesId);
        if (!series) return json(res, { error: "not_found" }, 404);

        const episodes = dbGetEpisodesByShow(seriesId);
        const seasons = {};

        for (const ep of episodes) {
          if (!ep.magnet) continue;
          const sKey = String(ep.season);
          if (!seasons[sKey]) seasons[sKey] = [];
          seasons[sKey].push({
            id: ep.id,
            episode_num: ep.episode,
            title: ep.name,
            container_extension: "mkv",
            info: {
              movie_image: ep.still ?? "",
              plot: ep.overview ?? "",
              duration_secs: ep.runtime ? ep.runtime * 60 : 0,
              duration: ep.runtime
                ? `${Math.floor(ep.runtime / 60)}:${String(ep.runtime % 60).padStart(2, "0")}:00`
                : "00:45:00",
              releasedate: "",
            },
            added: String(Math.floor((ep.added_at ?? Date.now()) / 1000)),
            season: ep.season,
            direct_source: `${host}/xtream/series/${XTREAM_USER}/${XTREAM_PASS}/${encodeURIComponent(ep.id)}.mkv`,
            custom_sid: "",
          });
        }

        return json(res, {
          info: {
            name: series.title,
            cover: series.poster ?? "",
            plot: series.overview ?? "",
            cast: "",
            director: "",
            genre: "",
            releaseDate: series.year ?? "",
            backdrop_path: [series.backdrop ?? ""],
            rating_5based: "4",
            youtube_trailer: "",
            episode_run_time: "45",
            category_id: "2",
          },
          episodes: seasons,
        });
      }

      if (action === "get_vod_info") {
        const streamId = decodeURIComponent(params.get("vod_id") ?? "");
        const movie = dbGetMovieById(streamId);
        if (!movie) return json(res, { error: "not_found" }, 404);
        return json(res, {
          info: {
            name: movie.title,
            o_name: movie.title,
            cover_big: movie.poster ?? "",
            movie_image: movie.poster ?? "",
            releasedate: movie.year ?? "",
            youtube_trailer: "",
            director: "",
            actors: "",
            cast: "",
            description: movie.description ?? "",
            plot: movie.description ?? "",
            genre: "",
            duration_secs: movie.duration ?? 0,
            duration: "120:00",
            bitrate: 0,
            rating: "8",
            backdrop_path: [movie.backdrop ?? ""],
          },
          movie_data: {
            stream_id: encodeURIComponent(movie.id),
            name: movie.title,
            added: String(Math.floor((movie.added_at ?? Date.now()) / 1000)),
            category_id: "1",
            container_extension: "mkv",
            custom_sid: "",
            direct_source: "",
          },
        });
      }

      return json(res, { error: "unknown_action" }, 400);
    }

    if (/^\/xtream\/movie\/[^/]+\/[^/]+\/[^/]+$/.test(pathname)) {
      const parts = pathname.split("/");
      const user = parts[3];
      const pass = parts[4];
      const movieIdRaw = parts[5].replace(/\.(mkv|mp4|avi|ts)$/i, "");
      const movieId = decodeURIComponent(movieIdRaw);

      if (user !== XTREAM_USER || pass !== XTREAM_PASS) {
        res.writeHead(401);
        res.end("Unauthorized");
        return;
      }

      const movie = dbGetMovieById(movieId);
      if (!movie) {
        res.writeHead(404);
        res.end("Not found");
        return;
      }

      const streamUrl = `/stream?magnet=${encodeURIComponent(movie.magnet)}&index=${movie.file_index ?? 0}`;
      res.writeHead(302, { Location: streamUrl });
      res.end();
      return;
    }

    if (/^\/xtream\/series\/[^/]+\/[^/]+\/[^/]+$/.test(pathname)) {
      const parts = pathname.split("/");
      const user = parts[3];
      const pass = parts[4];
      const epIdRaw = parts[5].replace(/\.(mkv|mp4|avi|ts)$/i, "");
      const epId = decodeURIComponent(epIdRaw);

      if (user !== XTREAM_USER || pass !== XTREAM_PASS) {
        res.writeHead(401);
        res.end("Unauthorized");
        return;
      }

      const ep = db.prepare("SELECT * FROM episodes WHERE id = ?").get(epId);
      if (!ep || !ep.magnet) {
        res.writeHead(404);
        res.end("Not found");
        return;
      }

      const streamUrl = `/stream?magnet=${encodeURIComponent(ep.magnet)}&index=${ep.file_index ?? 0}`;
      res.writeHead(302, { Location: streamUrl });
      res.end();
      return;
    }

    if (pathname === "/playlist.m3u") {
      const params = url.searchParams;
      if (!xtreamAuth(params)) {
        res.writeHead(401);
        res.end("Unauthorized");
        return;
      }

      const host = XTREAM_HOST || `http://${req.headers.host}`;
      const movies = dbGetAllMovies();
      const episodes = db
        .prepare(
          "SELECT e.*, s.title as show_title FROM episodes e JOIN series s ON e.show_tmdb_id = s.tmdb_id WHERE e.magnet IS NOT NULL",
        )
        .all();

      let m3u = "#EXTM3U\n";

      for (const m of movies) {
        const streamUrl = `${host}/xtream/movie/${XTREAM_USER}/${XTREAM_PASS}/${encodeURIComponent(m.id)}.mkv`;
        m3u += `#EXTINF:-1 tvg-logo="${m.poster ?? ""}" group-title="Filmes",${m.title}${m.year ? ` (${m.year})` : ""}\n`;
        m3u += `${streamUrl}\n`;
      }

      for (const ep of episodes) {
        const streamUrl = `${host}/xtream/series/${XTREAM_USER}/${XTREAM_PASS}/${encodeURIComponent(ep.id)}.mkv`;
        const label = `${ep.show_title} S${String(ep.season).padStart(2, "0")}E${String(ep.episode).padStart(2, "0")} - ${ep.name}`;
        m3u += `#EXTINF:-1 tvg-logo="${ep.still ?? ""}" group-title="${ep.show_title}",${label}\n`;
        m3u += `${streamUrl}\n`;
      }

      res.writeHead(200, {
        "Content-Type": "audio/x-mpegurl; charset=utf-8",
        "Content-Disposition": 'attachment; filename="buffet.m3u"',
        "Access-Control-Allow-Origin": "*",
      });
      res.end(m3u);
      return;
    }

    if (pathname.startsWith("/api/")) {
      if (["POST", "PATCH", "DELETE"].includes(method)) {
        const auth = req.headers["authorization"] ?? "";
        const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
        if (API_SECRET && token !== API_SECRET) {
          return json(res, { error: "unauthorized" }, 401);
        }
      }

      if (method === "GET" && pathname === "/api/movies") {
        return json(res, dbGetAllMovies().map(movieToClient));
      }

      if (method === "POST" && pathname === "/api/movies") {
        const body = await readBody(req);
        if (!body.id || !body.title || !body.magnet) {
          return json(res, { error: "missing_fields" }, 400);
        }
        const row = dbUpsertMovie(body);
        return json(res, movieToClient(row), 201);
      }

      if (method === "PATCH" && /^\/api\/movies\/[^/]+$/.test(pathname)) {
        const id = pathname.split("/")[3];
        const body = await readBody(req);
        const patch = {};
        if (body.progress !== undefined) patch.progress = body.progress;
        if (body.duration !== undefined) patch.duration = body.duration;
        if (body.lastPlayedAt !== undefined) patch.last_played_at = body.lastPlayedAt;
        if (body.favorite !== undefined) patch.favorite = body.favorite ? 1 : 0;
        if (body.title !== undefined) patch.title = body.title;
        if (body.fileIndex !== undefined) patch.file_index = body.fileIndex;
        const row = dbPatchMovie(id, patch);
        if (!row) return json(res, { error: "not_found" }, 404);
        return json(res, movieToClient(row));
      }

      if (method === "DELETE" && /^\/api\/movies\/[^/]+$/.test(pathname)) {
        const id = pathname.split("/")[3];
        dbDeleteMovie(id);
        return json(res, { ok: true });
      }

      if (method === "GET" && pathname === "/api/series") {
        return json(res, dbGetAllSeries().map(seriesToClient));
      }

      if (method === "POST" && pathname === "/api/series") {
        const body = await readBody(req);
        if (!body.tmdbId && !body.tmdb_id) return json(res, { error: "missing_tmdb_id" }, 400);
        dbUpsertSeries(body);
        const row = dbGetSeriesById(body.tmdbId ?? body.tmdb_id);
        return json(res, seriesToClient(row), 201);
      }

      if (method === "GET" && /^\/api\/series\/\d+\/episodes$/.test(pathname)) {
        const tmdbId = Number(pathname.split("/")[3]);
        return json(res, dbGetEpisodesByShow(tmdbId).map(episodeToClient));
      }

      if (method === "POST" && /^\/api\/series\/\d+\/episodes\/bulk$/.test(pathname)) {
        const tmdbId = Number(pathname.split("/")[3]);
        const body = await readBody(req);
        const episodes = Array.isArray(body) ? body : (body.episodes ?? []);
        const rows = dbUpsertEpisodesBulk(tmdbId, episodes);
        return json(res, rows.map(episodeToClient), 201);
      }

      if (method === "PATCH" && /^\/api\/episodes\/[^/]+$/.test(pathname)) {
        const id = decodeURIComponent(pathname.split("/").slice(3).join("/"));
        const body = await readBody(req);
        const patch = {};
        if (body.progress !== undefined) patch.progress = body.progress;
        if (body.duration !== undefined) patch.duration = body.duration;
        if (body.lastPlayedAt !== undefined) patch.last_played_at = body.lastPlayedAt;
        if (body.magnet !== undefined) patch.magnet = body.magnet;
        if (body.fileIndex !== undefined) patch.file_index = body.fileIndex;
        const row = dbPatchEpisode(id, patch);
        if (!row) return json(res, { error: "not_found" }, 404);
        return json(res, episodeToClient(row));
      }

      if (method === "GET" && pathname === "/api/library") {
        const movies = dbGetAllMovies().map(movieToClient);
        const series = dbGetAllSeries().map(seriesToClient);
        const allEpisodes = series.flatMap((s) =>
          dbGetEpisodesByShow(s.tmdbId).map(episodeToClient),
        );
        return json(res, { movies, series, episodes: allEpisodes });
      }

      return json(res, { error: "not_found" }, 404);
    }

    setCors(res);
    const isHead = method === "HEAD";
    if (method !== "GET" && method !== "HEAD") {
      sendJson(res, 405, { error: "method_not_allowed" });
      return;
    }

    if (pathname === "/health") {
      sendJson(res, 200, { ok: true, ffmpegAvailable: FFMPEG_AVAILABLE });
      return;
    }

    if (
      pathname !== "/stream" &&
      pathname !== "/stream-audio" &&
      pathname !== "/meta" &&
      pathname !== "/file" &&
      pathname !== "/probe" &&
      pathname !== "/extract-audio" &&
      pathname !== "/extract-subtitle" &&
      pathname !== "/tmdb/search" &&
      pathname !== "/tmdb/movie" &&
      pathname !== "/tmdb/trending" &&
      pathname !== "/tmdb/popular" &&
      pathname !== "/tmdb/tv/search" &&
      pathname !== "/tmdb/tv" &&
      pathname !== "/tmdb/tv/season" &&
      pathname !== "/tmdb/trending/tv" &&
      pathname !== "/tmdb/popular/tv"
    ) {
      sendJson(res, 404, { error: "not_found" });
      return;
    }

    if (pathname.startsWith("/tmdb/")) {
      try {
        res.setHeader("cache-control", "no-store");

        if (pathname === "/tmdb/search") {
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
      const announce = Array.from(new Set([...DEFAULT_ANNOUNCE, ...EXTRA_TRACKERS]));
      torrent = client.add(magnet, { announce });
      torrent.__lastAccess = Date.now();
      torrents.set(magnet, torrent);
      torrent.on("done", () => {
        torrent.__doneAt = Date.now();
      });
    } else {
      torrent.__lastAccess = Date.now();
    }

    try {
      const readyTimeout =
        url.pathname === "/stream" || url.pathname === "/stream-audio" || url.pathname === "/meta"
          ? 90_000
          : 25_000;
      await waitForReady(torrent, readyTimeout);
    } catch (e) {
      sendJson(res, 504, {
        error: "metadata_timeout",
        message: "Não foi possível obter metadados do torrent a tempo.",
        retryable: true,
        suggestImportWithoutMeta: true,
      });
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

      const payload = {
        audioTracks,
        subtitleTracks,
        transmuxed: needsTransmux(file.name) && FFMPEG_AVAILABLE,
      };
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
        const transmuxed = kind === "video" ? needsTransmux(f.name) && FFMPEG_AVAILABLE : false;
        return {
          index,
          name: f.name,
          length: Number(f.length) || 0,
          kind,
          lang: lang?.lang ?? null,
          label: lang?.label ?? null,
          resolution,
          transmuxed,
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

      if (isHead) {
        res.end();
        return;
      }

      const stream = file.createReadStream();
      stream.on("error", () => {
        try {
          res.destroy();
        } catch {}
      });
      stream.pipe(res);
      return;
    }

    if (url.pathname === "/stream-audio") {
      if (!FFMPEG_AVAILABLE) {
        sendJson(res, 503, { error: "ffmpeg_unavailable" });
        return;
      }

      const audioTrackRaw = url.searchParams.get("audioTrack") || "";
      const audioTrack = Number(audioTrackRaw);
      if (!Number.isFinite(audioTrack) || audioTrack < 0) {
        sendJson(res, 400, { error: "invalid_audio_track" });
        return;
      }

      const file = pickVideoFile(torrent);
      if (!file) {
        sendJson(res, 422, { error: "no_video_file" });
        return;
      }

      res.statusCode = 200;
      res.setHeader("cache-control", "no-cache");
      res.setHeader("content-type", "audio/mp4");
      res.setHeader("transfer-encoding", "chunked");

      if (isHead) {
        res.end();
        return;
      }

      const fileStream = file.createReadStream();
      const proc = spawn(
        "ffmpeg",
        [
          "-i",
          "pipe:0",
          "-map",
          `0:a:${audioTrack}`,
          "-c:a",
          "aac",
          "-b:a",
          "192k",
          "-movflags",
          "frag_keyframe+empty_moov",
          "-f",
          "mp4",
          "pipe:1",
        ],
        { stdio: ["pipe", "pipe", "pipe"] },
      );

      proc.stdin.on("error", () => {});

      req.on("close", () => {
        try {
          proc.kill("SIGKILL");
        } catch {}
        try {
          fileStream.destroy();
        } catch {}
      });

      proc.on("error", (err) => {
        console.error("[ffmpeg] stream-audio error:", err);
        try {
          if (!res.writableEnded) res.end();
        } catch {}
      });

      fileStream.on("error", (err) => {
        console.error("[torrent] stream-audio file error:", err);
        try {
          proc.kill("SIGKILL");
        } catch {}
        try {
          if (!res.writableEnded) res.end();
        } catch {}
      });

      fileStream.pipe(proc.stdin);
      proc.stdout.pipe(res);
      return;
    }

    if (url.pathname === "/stream") {
      await waitForReady(torrent, 60_000);

      const indexRaw = url.searchParams.get("index");
      const fileIndex = indexRaw ? Number(indexRaw) : NaN;
      const indexedFile =
        Number.isFinite(fileIndex) && fileIndex >= 0 && fileIndex < (torrent.files?.length ?? 0)
          ? torrent.files[fileIndex]
          : null;

      const file =
        indexedFile && VIDEO_RE.test(indexedFile.name) ? indexedFile : pickVideoFile(torrent);
      if (!file) {
        sendJson(res, 422, { error: "no_video_file" });
        return;
      }

      const fileSize = Number(file.length) || 0;
      if (!fileSize) {
        sendJson(res, 500, { error: "unknown_length" });
        return;
      }

      if (isHead) {
        res.writeHead(200, {
          "Content-Type": getMimeType(file.name),
          "Content-Length": fileSize,
          "Accept-Ranges": "bytes",
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Expose-Headers": "Content-Length, Accept-Ranges",
        });
        res.end();
        return;
      }

      const rangeHeader = req.headers["range"];

      if (!rangeHeader) {
        res.statusCode = 200;
        res.setHeader("Content-Type", getMimeType(file.name));
        res.setHeader("Content-Length", fileSize);
        res.setHeader("Accept-Ranges", "bytes");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader(
          "Access-Control-Expose-Headers",
          "Content-Length, Content-Range, Accept-Ranges",
        );
        const fileStream = file.createReadStream();
        req.on("close", () => fileStream.destroy());
        req.on("abort", () => fileStream.destroy());
        req.on("aborted", () => fileStream.destroy());
        fileStream.pipe(res);
        return;
      }

      const [startStr, endStr] = String(rangeHeader).replace("bytes=", "").split("-");
      const start = parseInt(startStr, 10);
      const end = endStr ? parseInt(endStr, 10) : fileSize - 1;

      if (!Number.isFinite(start) || !Number.isFinite(end) || start >= fileSize || start > end) {
        res.writeHead(416, { "Content-Range": `bytes */${fileSize}` });
        res.end();
        return;
      }

      const chunkSize = end - start + 1;
      res.writeHead(206, {
        "Content-Range": `bytes ${start}-${end}/${fileSize}`,
        "Accept-Ranges": "bytes",
        "Content-Length": chunkSize,
        "Content-Type": getMimeType(file.name),
        "Cache-Control": "no-cache",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Expose-Headers": "Content-Length, Content-Range, Accept-Ranges",
      });

      const fileStream = file.createReadStream({ start, end });
      req.on("close", () => fileStream.destroy());
      req.on("abort", () => fileStream.destroy());
      req.on("aborted", () => fileStream.destroy());
      fileStream.pipe(res);
      return;
    }

    sendJson(res, 404, { error: "not_found" });
  } catch (err) {
    try {
      sendJson(res, 500, { error: "internal_error" });
    } catch {}
  }
});

server.listen(port, "0.0.0.0", () => {
  process.stdout.write(`proxy listening on http://localhost:${port}\n`);
});
