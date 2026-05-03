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

function authHeaders(): Record<string, string> {
  const secret = getApiSecret();
  return secret
    ? { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" }
    : { "Content-Type": "application/json" };
}

export async function apiGetAllMovies() {
  const res = await fetch(`${getProxyBase()}/api/movies`);
  if (!res.ok) throw new Error("api_error");
  return res.json();
}

export async function apiUpsertMovie(movie: unknown) {
  const res = await fetch(`${getProxyBase()}/api/movies`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(movie),
  });
  if (!res.ok) throw new Error("api_error");
  return res.json();
}

export async function apiPatchMovie(id: string, patch: Record<string, unknown>) {
  const res = await fetch(`${getProxyBase()}/api/movies/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: authHeaders(),
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error("api_error");
  return res.json();
}

export async function apiDeleteMovie(id: string) {
  const res = await fetch(`${getProxyBase()}/api/movies/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error("api_error");
  return res.json();
}

export async function apiGetAllSeries() {
  const res = await fetch(`${getProxyBase()}/api/series`);
  if (!res.ok) throw new Error("api_error");
  return res.json();
}

export async function apiUpsertSeries(series: unknown) {
  const res = await fetch(`${getProxyBase()}/api/series`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(series),
  });
  if (!res.ok) throw new Error("api_error");
  return res.json();
}

export async function apiGetEpisodes(tmdbId: number) {
  const res = await fetch(`${getProxyBase()}/api/series/${tmdbId}/episodes`);
  if (!res.ok) throw new Error("api_error");
  return res.json();
}

export async function apiUpsertEpisodesBulk(tmdbId: number, episodes: unknown[]) {
  const res = await fetch(`${getProxyBase()}/api/series/${tmdbId}/episodes/bulk`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(episodes),
  });
  if (!res.ok) throw new Error("api_error");
  return res.json();
}

export async function apiPatchEpisode(id: string, patch: Record<string, unknown>) {
  const res = await fetch(`${getProxyBase()}/api/episodes/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: authHeaders(),
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error("api_error");
  return res.json();
}
