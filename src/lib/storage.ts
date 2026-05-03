import localforage from "localforage";
import { apiDeleteMovie, apiGetAllMovies, apiPatchMovie, apiUpsertMovie } from "@/lib/api";

export type LibraryItem = {
  id: string;
  title: string;
  magnet: string;
  poster?: string;
  backdrop?: string;
  year?: string;
  description?: string;
  tmdbId?: number;
  imdbId?: string;
  addedAt: number;
  favorite?: boolean;
  progress?: number; // seconds
  duration?: number; // seconds
  fileIndex?: number;
  lastPlayedAt?: number;
};

const store = localforage.createInstance({
  name: "buffet-video",
  storeName: "library",
});
const CACHE_KEY = "items_cache";

async function setCache(items: LibraryItem[]) {
  try {
    await store.setItem(CACHE_KEY, items);
  } catch {
    void 0;
  }
}

async function getCache(): Promise<LibraryItem[]> {
  try {
    return (await store.getItem<LibraryItem[]>(CACHE_KEY)) ?? [];
  } catch {
    return [];
  }
}

export async function getAll(): Promise<LibraryItem[]> {
  try {
    const items = (await apiGetAllMovies()) as LibraryItem[];
    void setCache(items);
    return items;
  } catch {
    return getCache();
  }
}

export async function upsert(item: LibraryItem): Promise<LibraryItem[]> {
  await apiUpsertMovie(item);
  return getAll();
}

export async function update(id: string, patch: Partial<LibraryItem>): Promise<LibraryItem[]> {
  const apiPatch: Record<string, unknown> = {};
  if (patch.progress !== undefined) apiPatch.progress = patch.progress;
  if (patch.duration !== undefined) apiPatch.duration = patch.duration;
  if (patch.lastPlayedAt !== undefined) apiPatch.lastPlayedAt = patch.lastPlayedAt;
  if (patch.favorite !== undefined) apiPatch.favorite = patch.favorite;
  if (patch.title !== undefined) apiPatch.title = patch.title;
  if (patch.fileIndex !== undefined) apiPatch.fileIndex = patch.fileIndex;
  await apiPatchMovie(id, apiPatch);
  return getAll();
}

export async function remove(id: string): Promise<LibraryItem[]> {
  await apiDeleteMovie(id);
  return getAll();
}

export function parseMagnet(magnet: string): { name?: string; infoHash?: string } {
  try {
    const url = new URL(magnet);
    const dn = url.searchParams.get("dn") ?? undefined;
    const xt = url.searchParams.get("xt") ?? "";
    const infoHash = xt.startsWith("urn:btih:") ? xt.slice(9).toLowerCase() : undefined;
    return {
      name: dn ? decodeURIComponent(dn.replace(/\+/g, " ")) : undefined,
      infoHash,
    };
  } catch {
    return {};
  }
}
