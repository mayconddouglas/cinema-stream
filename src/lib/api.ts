function getProxyBase(): string {
  const env = (import.meta as unknown as { env?: { VITE_TORRENT_PROXY_URL?: string } }).env;
  const raw = env?.VITE_TORRENT_PROXY_URL;
  return typeof raw === "string" ? raw.trim().replace(/\/+$/, "") : "";
}

function getApiSecret(): string {
  const env = (import.meta as unknown as { env?: { VITE_API_SECRET?: string } }).env;
  const raw = env?.VITE_API_SECRET;
  return typeof raw === "string" ? raw.trim() : "";
}

function getXtreamUser(): string {
  const env = (import.meta as unknown as { env?: { VITE_XTREAM_USER?: string } }).env;
  return (env?.VITE_XTREAM_USER ?? "buffet").trim();
}

function getXtreamPass(): string {
  const env = (import.meta as unknown as { env?: { VITE_XTREAM_PASS?: string } }).env;
  return (env?.VITE_XTREAM_PASS ?? "").trim();
}

export function getIptvCredentials() {
  const base = getProxyBase();
  const user = getXtreamUser();
  const pass = getXtreamPass();
  return {
    host: base,
    username: user,
    password: pass,
    m3uUrl: `${base}/playlist.m3u?username=${encodeURIComponent(user)}&password=${encodeURIComponent(pass)}`,
    xtreamUrl: base,
  };
}

function authHeaders(): Record<string, string> {
  const secret = getApiSecret();
  return {
    "Content-Type": "application/json",
    ...(secret ? { Authorization: `Bearer ${secret}` } : {}),
  };
}

// ── MOVIES ──────────────────────────────────────────────────────

export async function apiGetAllMovies(): Promise<unknown[]> {
  const res = await fetch(`${getProxyBase()}/api/movies`);
  if (!res.ok) throw new Error(`api_movies_${res.status}`);
  return res.json() as Promise<unknown[]>;
}

export async function apiUpsertMovie(movie: unknown): Promise<unknown> {
  const res = await fetch(`${getProxyBase()}/api/movies`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(movie),
  });
  if (!res.ok) throw new Error(`api_upsert_movie_${res.status}`);
  return res.json();
}

export async function apiPatchMovie(id: string, patch: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(`${getProxyBase()}/api/movies/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: authHeaders(),
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`api_patch_movie_${res.status}`);
  return res.json();
}

export async function apiDeleteMovie(id: string): Promise<void> {
  const res = await fetch(`${getProxyBase()}/api/movies/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`api_delete_movie_${res.status}`);
}

// ── SERIES ──────────────────────────────────────────────────────

export async function apiGetAllSeries(): Promise<unknown[]> {
  const res = await fetch(`${getProxyBase()}/api/series`);
  if (!res.ok) throw new Error(`api_series_${res.status}`);
  return res.json() as Promise<unknown[]>;
}

export async function apiUpsertSeries(series: unknown): Promise<unknown> {
  const res = await fetch(`${getProxyBase()}/api/series`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(series),
  });
  if (!res.ok) throw new Error(`api_upsert_series_${res.status}`);
  return res.json();
}

// ── EPISODES ────────────────────────────────────────────────────

export async function apiGetEpisodes(tmdbId: number): Promise<unknown[]> {
  const res = await fetch(`${getProxyBase()}/api/series/${tmdbId}/episodes`);
  if (!res.ok) throw new Error(`api_episodes_${res.status}`);
  return res.json() as Promise<unknown[]>;
}

export async function apiUpsertEpisodesBulk(
  tmdbId: number,
  episodes: unknown[],
): Promise<unknown[]> {
  const res = await fetch(`${getProxyBase()}/api/series/${tmdbId}/episodes/bulk`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(episodes),
  });
  if (!res.ok) throw new Error(`api_bulk_episodes_${res.status}`);
  return res.json() as Promise<unknown[]>;
}

export async function apiPatchEpisode(
  id: string,
  patch: Record<string, unknown>,
): Promise<unknown> {
  const res = await fetch(`${getProxyBase()}/api/episodes/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: authHeaders(),
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`api_patch_episode_${res.status}`);
  return res.json();
}

// ── MIGRATION: importar localStorage para o servidor ────────────

export async function migrateLocalStorageToServer(): Promise<{
  movies: number;
  series: number;
  episodes: number;
}> {
  let movies = 0;
  let series = 0;
  let episodes = 0;

  try {
    const raw = localStorage.getItem("buffet-video/library/items");
    if (raw) {
      const items = JSON.parse(raw) as unknown[];
      for (const item of items) {
        try {
          await apiUpsertMovie(item);
          movies++;
        } catch {
          void 0;
        }
      }
    }
  } catch {
    void 0;
  }

  try {
    const rawSeries = localStorage.getItem("buffet-video/series/series");
    if (rawSeries) {
      const seriesList = JSON.parse(rawSeries) as unknown[];
      for (const s of seriesList) {
        try {
          await apiUpsertSeries(s);
          series++;
        } catch {
          void 0;
        }
      }
    }
  } catch {
    void 0;
  }

  try {
    const rawEpisodes = localStorage.getItem("buffet-video/series/episodes");
    if (rawEpisodes) {
      const allEps = JSON.parse(rawEpisodes) as Array<{
        showTmdbId?: number;
        show_tmdb_id?: number;
      }>;
      const grouped = new Map<number, unknown[]>();
      for (const ep of allEps) {
        const id = ep.showTmdbId ?? ep.show_tmdb_id ?? 0;
        if (!id) continue;
        if (!grouped.has(id)) grouped.set(id, []);
        grouped.get(id)!.push(ep);
      }
      for (const [tmdbId, eps] of grouped) {
        try {
          await apiUpsertEpisodesBulk(tmdbId, eps);
          episodes += eps.length;
        } catch {
          void 0;
        }
      }
    }
  } catch {
    void 0;
  }

  return { movies, series, episodes };
}
