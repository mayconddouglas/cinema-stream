import localforage from "localforage";

export type Series = {
  tmdbId: number;
  title: string;
  originalTitle?: string | null;
  overview?: string | null;
  year?: string | null;
  poster?: string | null;
  backdrop?: string | null;
  addedAt: number;
};

export type Episode = {
  id: string;
  showTmdbId: number;
  season: number;
  episode: number;
  name: string;
  overview?: string | null;
  still?: string | null;
  runtime?: number | null;
  magnet?: string | null;
  fileIndex?: number | null;
  addedAt: number;
  progress?: number;
  duration?: number;
  lastPlayedAt?: number;
};

const store = localforage.createInstance({
  name: "buffet-video",
  storeName: "series",
});

const SERIES_KEY = "series";
const EPISODES_KEY = "episodes";

export function episodeId(showTmdbId: number, season: number, episode: number) {
  return `${showTmdbId}-s${String(season).padStart(2, "0")}e${String(episode).padStart(2, "0")}`;
}

export function parseEpisodeFromName(name: string) {
  const raw = String(name);
  const lower = raw.toLowerCase();

  // Padrão SxxExx ou SxExx americano — S01E11, S1E5
  const m1 = /(^|[.\-_\s])s(\d{1,2})e(\d{1,3})([.\-_\s]|$)/i.exec(lower);
  if (m1) return { season: Number(m1[2]), episode: Number(m1[3]) };

  // Padrão TxxExx brasileiro — T01E11, T1E5, T01E011
  const m2 = /(^|[.\-_\s])t(\d{1,2})e(\d{1,3})([.\-_\s]|$)/i.exec(lower);
  if (m2) return { season: Number(m2[2]), episode: Number(m2[3]) };

  // Padrão NxNN americano — 1x11, 2x05
  const m3 = /(^|[.\-_\s])(\d{1,2})x(\d{1,3})([.\-_\s]|$)/i.exec(lower);
  if (m3) return { season: Number(m3[2]), episode: Number(m3[3]) };

  // Padrão "Season X Episode Y" por extenso — season 1 episode 11
  const m4 = /season[.\-_\s]?(\d{1,2}).*?episode[.\-_\s]?(\d{1,3})/i.exec(lower);
  if (m4) return { season: Number(m4[1]), episode: Number(m4[2]) };

  // Padrão "Temporada X Episodio Y" por extenso em português
  const m5 = /temporada[.\-_\s]?(\d{1,2}).*?epis[oó]dio[.\-_\s]?(\d{1,3})/i.exec(lower);
  if (m5) return { season: Number(m5[1]), episode: Number(m5[2]) };

  // Padrão NNNN compacto 4 dígitos — 0111 = T01E11, 0105 = T01E05
  // Só aplica se o número aparecer isolado entre separadores para evitar falsos positivos
  const m6 = /(^|[.\-_\s])(\d{2})(\d{2})([.\-_\s]|$)/.exec(lower);
  if (m6) {
    const season = Number(m6[2]);
    const episode = Number(m6[3]);
    // Descarta se temporada ou episódio for 0 ou temporada > 30
    if (season > 0 && season <= 30 && episode > 0) {
      return { season, episode };
    }
  }

  // Padrão ep/ep. isolado sem temporada — ep11, ep.05 → assume temporada 1
  const m7 = /(^|[.\-_\s])ep[.\-_\s]?(\d{1,3})([.\-_\s]|$)/i.exec(lower);
  if (m7) return { season: 1, episode: Number(m7[2]) };

  return null;
}

export async function getSeriesAll(): Promise<Series[]> {
  return ((await store.getItem<Series[]>(SERIES_KEY)) ?? []).filter(
    (s) => typeof s?.tmdbId === "number",
  );
}

export async function upsertSeries(series: Series) {
  const all = await getSeriesAll();
  const idx = all.findIndex((s) => s.tmdbId === series.tmdbId);
  if (idx >= 0) all[idx] = { ...all[idx], ...series };
  else all.unshift(series);
  await store.setItem(SERIES_KEY, all);
  return all;
}

export async function getEpisodesAll(): Promise<Episode[]> {
  return ((await store.getItem<Episode[]>(EPISODES_KEY)) ?? []).filter(
    (e) => typeof e?.id === "string",
  );
}

export async function getEpisodesForShow(showTmdbId: number) {
  const all = await getEpisodesAll();
  return all.filter((e) => e.showTmdbId === showTmdbId);
}

export async function upsertEpisodesBulk(showTmdbId: number, episodes: Episode[]) {
  const all = await getEpisodesAll();
  const keep = all.filter((e) => e.showTmdbId !== showTmdbId);
  const next = [...episodes, ...keep];
  await store.setItem(EPISODES_KEY, next);
  return next.filter((e) => e.showTmdbId === showTmdbId);
}

export async function patchEpisode(id: string, patch: Partial<Episode>) {
  const all = await getEpisodesAll();
  const idx = all.findIndex((e) => e.id === id);
  if (idx >= 0) {
    all[idx] = { ...all[idx], ...patch };
    await store.setItem(EPISODES_KEY, all);
  }
  return all[idx] ?? null;
}
