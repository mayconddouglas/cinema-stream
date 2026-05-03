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

export async function getAll(): Promise<LibraryItem[]> {
  try {
    return await apiGetAllMovies();
  } catch {
    return [];
  }
}

export async function upsert(item: LibraryItem): Promise<LibraryItem[]> {
  await apiUpsertMovie(item);
  return getAll();
}

export async function update(id: string, patch: Partial<LibraryItem>): Promise<LibraryItem[]> {
  await apiPatchMovie(id, patch as Record<string, unknown>);
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
    return { name: dn ? decodeURIComponent(dn.replace(/\+/g, " ")) : undefined, infoHash };
  } catch {
    return {};
  }
}
