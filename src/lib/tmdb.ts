export type TmdbSearchItem = {
  id: number;
  title: string;
  originalTitle: string | null;
  overview: string | null;
  year: string | null;
  poster: string | null;
  backdrop: string | null;
};

export type TmdbMovieDetails = {
  id: number;
  imdbId: string | null;
  title: string;
  originalTitle: string | null;
  overview: string | null;
  year: string | null;
  poster: string | null;
  backdrop: string | null;
  runtime: number | null;
  genres: { id: number; name: string }[];
};

function getProxyBase() {
  const raw = (import.meta as any).env?.VITE_TORRENT_PROXY_URL as string | undefined;
  const base = typeof raw === "string" ? raw.trim().replace(/\/+$/, "") : "";
  return base;
}

export async function tmdbSearch(query: string, year?: string, language = "pt-BR") {
  const base = getProxyBase();
  if (!base) throw new Error("proxy_not_configured");

  const url = new URL(`${base}/tmdb/search`);
  url.searchParams.set("query", query);
  if (year) url.searchParams.set("year", year);
  if (language) url.searchParams.set("language", language);

  const res = await fetch(url.toString());
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const msg = typeof body?.error === "string" ? body.error : "tmdb_search_failed";
    throw new Error(msg);
  }

  const data = (await res.json()) as any;
  return (Array.isArray(data?.results) ? data.results : []) as TmdbSearchItem[];
}

export async function tmdbMovie(id: number, language = "pt-BR") {
  const base = getProxyBase();
  if (!base) throw new Error("proxy_not_configured");

  const url = new URL(`${base}/tmdb/movie`);
  url.searchParams.set("id", String(id));
  if (language) url.searchParams.set("language", language);

  const res = await fetch(url.toString());
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const msg = typeof body?.error === "string" ? body.error : "tmdb_movie_failed";
    throw new Error(msg);
  }

  return (await res.json()) as TmdbMovieDetails;
}

