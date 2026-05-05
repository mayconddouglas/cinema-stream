import { withTmdbCache } from "@/lib/tmdbCache";

export type TmdbSearchItem = {
  id: number;
  title: string;
  originalTitle: string | null;
  overview: string | null;
  year: string | null;
  poster: string | null;
  backdrop: string | null;
};

const TTL_SEARCH_SECONDS = 10 * 60;
const TTL_TRENDING_SECONDS = 15 * 60;
const TTL_DETAILS_SECONDS = 24 * 60 * 60;

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
  cast: { id: number; name: string; character: string | null; profile: string | null }[];
  trailer: { site: string; key: string; name: string | null } | null;
  recommendations: TmdbSearchItem[];
};

export type TmdbTvDetails = {
  id: number;
  imdbId: string | null;
  title: string;
  originalTitle: string | null;
  overview: string | null;
  year: string | null;
  poster: string | null;
  backdrop: string | null;
  genres: { id: number; name: string }[];
  seasons: {
    seasonNumber: number;
    name: string | null;
    episodeCount: number | null;
    poster: string | null;
    year: string | null;
  }[];
  cast: { id: number; name: string; character: string | null; profile: string | null }[];
  trailer: { site: string; key: string; name: string | null } | null;
};

export type TmdbTvEpisode = {
  season: number;
  episode: number;
  name: string | null;
  overview: string | null;
  still: string | null;
  runtime: number | null;
  airDate: string | null;
};

function getProxyBase() {
  const env = (import.meta as unknown as { env?: { VITE_TORRENT_PROXY_URL?: string } }).env;
  const raw = env?.VITE_TORRENT_PROXY_URL;
  const base = typeof raw === "string" ? raw.trim().replace(/\/+$/, "") : "";
  return base;
}

export async function tmdbSearch(query: string, year?: string, language = "pt-BR") {
  const q = query.trim();
  const cacheKey = `tmdb:search:movie:${language}:${year ?? ""}:${q.toLowerCase()}`;
  return withTmdbCache(cacheKey, TTL_SEARCH_SECONDS, async () => {
    const base = getProxyBase();
    if (!base) throw new Error("proxy_not_configured");

    const url = new URL(`${base}/tmdb/search`);
    url.searchParams.set("query", q);
    if (year) url.searchParams.set("year", year);
    if (language) url.searchParams.set("language", language);

    const res = await fetch(url.toString());
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: unknown };
      const msg = typeof body?.error === "string" ? body.error : "tmdb_search_failed";
      throw new Error(msg);
    }

    const data = (await res.json()) as { results?: unknown };
    return (Array.isArray(data?.results) ? data.results : []) as TmdbSearchItem[];
  });
}

export async function tmdbSearchTv(query: string, year?: string, language = "pt-BR") {
  const q = query.trim();
  const cacheKey = `tmdb:search:tv:${language}:${year ?? ""}:${q.toLowerCase()}`;
  return withTmdbCache(cacheKey, TTL_SEARCH_SECONDS, async () => {
    const base = getProxyBase();
    if (!base) throw new Error("proxy_not_configured");

    const url = new URL(`${base}/tmdb/tv/search`);
    url.searchParams.set("query", q);
    if (year) url.searchParams.set("year", year);
    if (language) url.searchParams.set("language", language);

    const res = await fetch(url.toString());
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: unknown };
      const msg = typeof body?.error === "string" ? body.error : "tmdb_tv_search_failed";
      throw new Error(msg);
    }

    const data = (await res.json()) as { results?: unknown };
    return (Array.isArray(data?.results) ? data.results : []) as TmdbSearchItem[];
  });
}

export async function tmdbMovie(id: number, language = "pt-BR") {
  const cacheKey = `tmdb:movie:${language}:${id}`;
  return withTmdbCache(cacheKey, TTL_DETAILS_SECONDS, async () => {
    const base = getProxyBase();
    if (!base) throw new Error("proxy_not_configured");

    const url = new URL(`${base}/tmdb/movie`);
    url.searchParams.set("id", String(id));
    if (language) url.searchParams.set("language", language);

    const res = await fetch(url.toString());
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: unknown };
      const msg = typeof body?.error === "string" ? body.error : "tmdb_movie_failed";
      throw new Error(msg);
    }

    return (await res.json()) as TmdbMovieDetails;
  });
}

export async function tmdbTv(id: number, language = "pt-BR") {
  const cacheKey = `tmdb:tv:${language}:${id}`;
  return withTmdbCache(cacheKey, TTL_DETAILS_SECONDS, async () => {
    const base = getProxyBase();
    if (!base) throw new Error("proxy_not_configured");

    const url = new URL(`${base}/tmdb/tv`);
    url.searchParams.set("id", String(id));
    if (language) url.searchParams.set("language", language);

    const res = await fetch(url.toString());
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: unknown };
      const msg = typeof body?.error === "string" ? body.error : "tmdb_tv_failed";
      throw new Error(msg);
    }

    return (await res.json()) as TmdbTvDetails;
  });
}

export async function tmdbTvSeason(id: number, season: number, language = "pt-BR") {
  const cacheKey = `tmdb:tv:season:${language}:${id}:${season}`;
  return withTmdbCache(cacheKey, TTL_DETAILS_SECONDS, async () => {
    const base = getProxyBase();
    if (!base) throw new Error("proxy_not_configured");

    const url = new URL(`${base}/tmdb/tv/season`);
    url.searchParams.set("id", String(id));
    url.searchParams.set("season", String(season));
    if (language) url.searchParams.set("language", language);

    const res = await fetch(url.toString());
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: unknown };
      const msg = typeof body?.error === "string" ? body.error : "tmdb_tv_season_failed";
      throw new Error(msg);
    }

    const data = (await res.json()) as { episodes?: unknown };
    return (Array.isArray(data?.episodes) ? data.episodes : []) as TmdbTvEpisode[];
  });
}

export async function tmdbTrending(language = "pt-BR") {
  const cacheKey = `tmdb:trending:movie:${language}`;
  return withTmdbCache(cacheKey, TTL_TRENDING_SECONDS, async () => {
    const base = getProxyBase();
    if (!base) throw new Error("proxy_not_configured");

    const url = new URL(`${base}/tmdb/trending`);
    if (language) url.searchParams.set("language", language);

    const res = await fetch(url.toString());
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: unknown };
      const msg = typeof body?.error === "string" ? body.error : "tmdb_trending_failed";
      throw new Error(msg);
    }

    const data = (await res.json()) as { results?: unknown };
    return (Array.isArray(data?.results) ? data.results : []) as TmdbSearchItem[];
  });
}

export async function tmdbTrendingTv(language = "pt-BR") {
  const cacheKey = `tmdb:trending:tv:${language}`;
  return withTmdbCache(cacheKey, TTL_TRENDING_SECONDS, async () => {
    const base = getProxyBase();
    if (!base) throw new Error("proxy_not_configured");

    const url = new URL(`${base}/tmdb/trending/tv`);
    if (language) url.searchParams.set("language", language);

    const res = await fetch(url.toString());
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: unknown };
      const msg = typeof body?.error === "string" ? body.error : "tmdb_trending_failed";
      throw new Error(msg);
    }

    const data = (await res.json()) as { results?: unknown };
    return (Array.isArray(data?.results) ? data.results : []) as TmdbSearchItem[];
  });
}

export async function tmdbPopular(language = "pt-BR") {
  const cacheKey = `tmdb:popular:movie:${language}`;
  return withTmdbCache(cacheKey, TTL_TRENDING_SECONDS, async () => {
    const base = getProxyBase();
    if (!base) throw new Error("proxy_not_configured");

    const url = new URL(`${base}/tmdb/popular`);
    if (language) url.searchParams.set("language", language);

    const res = await fetch(url.toString());
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: unknown };
      const msg = typeof body?.error === "string" ? body.error : "tmdb_popular_failed";
      throw new Error(msg);
    }

    const data = (await res.json()) as { results?: unknown };
    return (Array.isArray(data?.results) ? data.results : []) as TmdbSearchItem[];
  });
}

export async function tmdbPopularTv(language = "pt-BR") {
  const cacheKey = `tmdb:popular:tv:${language}`;
  return withTmdbCache(cacheKey, TTL_TRENDING_SECONDS, async () => {
    const base = getProxyBase();
    if (!base) throw new Error("proxy_not_configured");

    const url = new URL(`${base}/tmdb/popular/tv`);
    if (language) url.searchParams.set("language", language);

    const res = await fetch(url.toString());
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: unknown };
      const msg = typeof body?.error === "string" ? body.error : "tmdb_popular_failed";
      throw new Error(msg);
    }

    const data = (await res.json()) as { results?: unknown };
    return (Array.isArray(data?.results) ? data.results : []) as TmdbSearchItem[];
  });
}
