import localforage from "localforage";

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

const KEY = "items";

export async function getAll(): Promise<LibraryItem[]> {
  const items = (await store.getItem<LibraryItem[]>(KEY)) ?? [];
  return items;
}

export async function saveAll(items: LibraryItem[]) {
  await store.setItem(KEY, items);
}

export async function upsert(item: LibraryItem) {
  const items = await getAll();
  const idx = items.findIndex((i) => i.id === item.id);
  if (idx >= 0) items[idx] = { ...items[idx], ...item };
  else items.unshift(item);
  await saveAll(items);
  return items;
}

export async function remove(id: string) {
  const items = (await getAll()).filter((i) => i.id !== id);
  await saveAll(items);
  return items;
}

export async function update(id: string, patch: Partial<LibraryItem>) {
  const items = await getAll();
  const idx = items.findIndex((i) => i.id === id);
  if (idx >= 0) {
    items[idx] = { ...items[idx], ...patch };
    await saveAll(items);
  }
  return items;
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
