import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BottomNav, type IptvNavKey } from "@/components/iptv/BottomNav";
import { AccountDrawer, type IptvAccount } from "@/components/iptv/AccountDrawer";
import { AddAccountDrawer } from "@/components/iptv/AddAccountDrawer";
import { HeroCarousel, type HeroSlide } from "@/components/iptv/HeroCarousel";
import { PlayerOverlay, type PlayerItem } from "@/components/iptv/PlayerOverlay";
import { Row, type RowItem } from "@/components/iptv/Row";
import {
  iptvActivateAccount,
  iptvCreateAccount,
  iptvGetAccounts,
  iptvGetActiveStatus,
  iptvGetLiveCategories,
  iptvGetLiveStreams,
  iptvGetRecent,
  iptvGetVodCategories,
  iptvGetVodStreams,
  iptvLiveRelayUrl,
  iptvSetFavorite,
  iptvTouchRecent,
  iptvVodRelayUrl,
} from "@/lib/api";

type IptvCategory = { category_id: string; category_name: string };

type IptvLiveStream = {
  stream_id: number;
  name: string;
  category_id?: string | null;
  stream_icon?: string | null;
  favorite: number;
};

type IptvVodStream = {
  stream_id: number;
  name: string;
  category_id?: string | null;
  stream_icon?: string | null;
  favorite: number;
};

function getVlcDeepLink(streamUrl: string): string {
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  const isAndroid = /android/i.test(ua);
  if (isAndroid) {
    return `intent:${streamUrl}#Intent;package=org.videolan.vlc;action=android.intent.action.VIEW;type=video/*;end`;
  }
  return streamUrl.replace(/^https?:\/\//, "vlc://");
}

export const Route = createFileRoute("/iptv")({
  head: () => ({
    meta: [{ title: "Acervos de Filmes — IPTV" }],
  }),
  component: IptvPage,
});

function IptvPage() {
  const [nav, setNav] = useState<IptvNavKey>("home");

  const [accounts, setAccounts] = useState<IptvAccount[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [loading, setLoading] = useState(true);

  const [accountDrawerOpen, setAccountDrawerOpen] = useState(false);
  const [addDrawerOpen, setAddDrawerOpen] = useState(false);

  const [liveCategories, setLiveCategories] = useState<IptvCategory[]>([]);
  const [vodCategories, setVodCategories] = useState<IptvCategory[]>([]);
  const [liveCategory, setLiveCategory] = useState<string>("");
  const [vodCategory, setVodCategory] = useState<string>("");

  const [liveQuery, setLiveQuery] = useState("");
  const [vodQuery, setVodQuery] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  const [homeRecentLive, setHomeRecentLive] = useState<IptvLiveStream[]>([]);
  const [homeRecentVod, setHomeRecentVod] = useState<IptvVodStream[]>([]);
  const [homeFavLive, setHomeFavLive] = useState<IptvLiveStream[]>([]);
  const [homeFavVod, setHomeFavVod] = useState<IptvVodStream[]>([]);
  const [homeLive, setHomeLive] = useState<IptvLiveStream[]>([]);
  const [homeVod, setHomeVod] = useState<IptvVodStream[]>([]);

  const [liveList, setLiveList] = useState<IptvLiveStream[]>([]);
  const [vodList, setVodList] = useState<IptvVodStream[]>([]);
  const [listLive, setListLive] = useState<IptvLiveStream[]>([]);
  const [listVod, setListVod] = useState<IptvVodStream[]>([]);

  const [player, setPlayer] = useState<PlayerItem | null>(null);

  const activeAccount = useMemo(
    () => accounts.find((a) => a.id === activeId) ?? null,
    [accounts, activeId],
  );

  const refreshStatus = useCallback(async () => {
    const [acc, status] = await Promise.all([iptvGetAccounts(), iptvGetActiveStatus()]);
    setAccounts(acc as IptvAccount[]);
    const active = (status as { active?: { id?: number } | null }).active;
    setActiveId(active?.id ?? null);
    setSyncing(Boolean((status as { syncing?: boolean }).syncing));
    return {
      activeId: active?.id ?? null,
      syncing: Boolean((status as { syncing?: boolean }).syncing),
    };
  }, []);

  const waitSync = useCallback(async (tries = 90) => {
    for (let i = 0; i < tries; i++) {
      const status = (await iptvGetActiveStatus()) as {
        syncing?: boolean;
        active?: { id?: number } | null;
      };
      const s = Boolean(status.syncing);
      setSyncing(s);
      if (!s) return;
      await new Promise((r) => setTimeout(r, 2000));
    }
  }, []);

  const loadCategories = useCallback(async () => {
    const [lc, vc] = await Promise.all([iptvGetLiveCategories(), iptvGetVodCategories()]);
    const liveCats = lc as IptvCategory[];
    const vodCats = vc as IptvCategory[];
    setLiveCategories(liveCats);
    setVodCategories(vodCats);
    setLiveCategory((prev) => prev || liveCats[0]?.category_id || "");
    setVodCategory((prev) => prev || vodCats[0]?.category_id || "");
  }, []);

  const loadHome = useCallback(async () => {
    const [recentLive, recentVod, favLive, favVod, anyLive, anyVod] = await Promise.all([
      iptvGetRecent({ type: "live", limit: 18 }),
      iptvGetRecent({ type: "vod", limit: 18 }),
      iptvGetLiveStreams({ onlyFavorites: true }),
      iptvGetVodStreams({ onlyFavorites: true }),
      iptvGetLiveStreams({}),
      iptvGetVodStreams({}),
    ]);
    setHomeRecentLive(recentLive as IptvLiveStream[]);
    setHomeRecentVod(recentVod as IptvVodStream[]);
    setHomeFavLive((favLive as IptvLiveStream[]).slice(0, 18));
    setHomeFavVod((favVod as IptvVodStream[]).slice(0, 18));
    setHomeLive((anyLive as IptvLiveStream[]).slice(0, 18));
    setHomeVod((anyVod as IptvVodStream[]).slice(0, 18));
  }, []);

  const loadLists = useCallback(async () => {
    const [live, vod, favLive, favVod] = await Promise.all([
      iptvGetLiveStreams({ categoryId: liveCategory, q: liveQuery }),
      iptvGetVodStreams({ categoryId: vodCategory, q: vodQuery }),
      iptvGetLiveStreams({ onlyFavorites: true }),
      iptvGetVodStreams({ onlyFavorites: true }),
    ]);
    setLiveList(live as IptvLiveStream[]);
    setVodList(vod as IptvVodStream[]);
    setListLive(favLive as IptvLiveStream[]);
    setListVod(favVod as IptvVodStream[]);
  }, [liveCategory, liveQuery, vodCategory, vodQuery]);

  const activateAccount = useCallback(
    async (id: number) => {
      setAccountDrawerOpen(false);
      setSyncing(true);
      await iptvActivateAccount(id);
      setActiveId(id);
      await waitSync();
      await Promise.all([loadCategories(), loadHome(), loadLists()]);
    },
    [loadCategories, loadHome, loadLists, waitSync],
  );

  const createAccount = useCallback(
    async (payload: { name: string; baseUrl: string; username: string; password: string }) => {
      await iptvCreateAccount(payload);
      const { activeId, syncing } = await refreshStatus();
      if (syncing) await waitSync();
      if (activeId) {
        await Promise.all([loadCategories(), loadHome(), loadLists()]);
      }
    },
    [loadCategories, loadHome, loadLists, refreshStatus, waitSync],
  );

  const toggleFavorite = useCallback(
    async (type: "live" | "vod", itemId: number, next: boolean) => {
      await iptvSetFavorite({ type, itemId: String(itemId), value: next });
      await Promise.all([loadHome(), loadLists()]);
    },
    [loadHome, loadLists],
  );

  const openVod = useCallback(
    async (m: IptvVodStream) => {
      const url = iptvVodRelayUrl(m.stream_id);
      await iptvTouchRecent({ type: "vod", itemId: String(m.stream_id) });
      setPlayer({
        title: m.name,
        image: m.stream_icon ?? "",
        streamUrl: url,
        vlcUrl: getVlcDeepLink(url),
        favorite: m.favorite === 1,
        onToggleFavorite: () => void toggleFavorite("vod", m.stream_id, m.favorite !== 1),
        onClose: () => setPlayer(null),
      });
    },
    [toggleFavorite],
  );

  const openLive = useCallback(
    async (c: IptvLiveStream) => {
      const url = iptvLiveRelayUrl(c.stream_id);
      await iptvTouchRecent({ type: "live", itemId: String(c.stream_id) });
      setPlayer({
        title: c.name,
        image: c.stream_icon ?? "",
        streamUrl: url,
        vlcUrl: getVlcDeepLink(url),
        favorite: c.favorite === 1,
        onToggleFavorite: () => void toggleFavorite("live", c.stream_id, c.favorite !== 1),
        onClose: () => setPlayer(null),
      });
    },
    [toggleFavorite],
  );

  const slides = useMemo(() => {
    const slides: HeroSlide[] = [];
    const pickVod = homeRecentVod[0] ?? homeVod[0] ?? null;
    const pickLive = homeRecentLive[0] ?? homeLive[0] ?? null;
    if (pickVod) {
      slides.push({
        key: `vod-${pickVod.stream_id}`,
        title: pickVod.name,
        subtitle: "Filme em destaque",
        image: pickVod.stream_icon ?? "",
        badge: "Filmes",
        onPlay: () => void openVod(pickVod),
        onVlc: () => {
          const u = iptvVodRelayUrl(pickVod.stream_id);
          window.location.href = getVlcDeepLink(u);
        },
      });
    }
    if (pickLive) {
      slides.push({
        key: `live-${pickLive.stream_id}`,
        title: pickLive.name,
        subtitle: "Ao vivo agora",
        image: pickLive.stream_icon ?? "",
        badge: "Ao vivo",
        onPlay: () => void openLive(pickLive),
        onVlc: () => {
          const u = iptvLiveRelayUrl(pickLive.stream_id);
          window.location.href = getVlcDeepLink(u);
        },
      });
    }
    const moreVod = homeVod.slice(0, 3);
    for (const m of moreVod) {
      if (slides.some((s) => s.key === `vod-${m.stream_id}`)) continue;
      slides.push({
        key: `vod-${m.stream_id}`,
        title: m.name,
        subtitle: "Recomendado",
        image: m.stream_icon ?? "",
        badge: "Filmes",
        onPlay: () => void openVod(m),
        onVlc: () => {
          const u = iptvVodRelayUrl(m.stream_id);
          window.location.href = getVlcDeepLink(u);
        },
      });
      if (slides.length >= 5) break;
    }
    return slides;
  }, [homeRecentVod, homeVod, homeRecentLive, homeLive, openLive, openVod]);

  const homeRows = useMemo(() => {
    const rows: Array<{ title: string; action?: IptvNavKey; items: RowItem[] }> = [];

    rows.push({
      title: "Continuar assistindo",
      action: "vod",
      items: homeRecentVod.map((m) => ({
        key: `rv-${m.stream_id}`,
        title: m.name,
        image: m.stream_icon,
        kind: "vod",
        favorite: m.favorite === 1,
        onPlay: () => void openVod(m),
        onToggleFavorite: () => void toggleFavorite("vod", m.stream_id, m.favorite !== 1),
      })),
    });

    rows.push({
      title: "Ao vivo — recentes",
      action: "live",
      items: homeRecentLive.map((c) => ({
        key: `rl-${c.stream_id}`,
        title: c.name,
        image: c.stream_icon,
        kind: "live",
        favorite: c.favorite === 1,
        onPlay: () => void openLive(c),
        onToggleFavorite: () => void toggleFavorite("live", c.stream_id, c.favorite !== 1),
      })),
    });

    rows.push({
      title: "Favoritos",
      action: "list",
      items: [
        ...homeFavVod.slice(0, 10).map((m) => ({
          key: `fv-${m.stream_id}`,
          title: m.name,
          image: m.stream_icon,
          kind: "vod" as const,
          favorite: true,
          onPlay: () => void openVod(m),
          onToggleFavorite: () => void toggleFavorite("vod", m.stream_id, false),
        })),
        ...homeFavLive.slice(0, 10).map((c) => ({
          key: `fl-${c.stream_id}`,
          title: c.name,
          image: c.stream_icon,
          kind: "live" as const,
          favorite: true,
          onPlay: () => void openLive(c),
          onToggleFavorite: () => void toggleFavorite("live", c.stream_id, false),
        })),
      ],
    });

    rows.push({
      title: "Ao vivo — para explorar",
      action: "live",
      items: homeLive.map((c) => ({
        key: `l-${c.stream_id}`,
        title: c.name,
        image: c.stream_icon,
        kind: "live",
        favorite: c.favorite === 1,
        onPlay: () => void openLive(c),
        onToggleFavorite: () => void toggleFavorite("live", c.stream_id, c.favorite !== 1),
      })),
    });

    rows.push({
      title: "Filmes — para explorar",
      action: "vod",
      items: homeVod.map((m) => ({
        key: `v-${m.stream_id}`,
        title: m.name,
        image: m.stream_icon,
        kind: "vod",
        favorite: m.favorite === 1,
        onPlay: () => void openVod(m),
        onToggleFavorite: () => void toggleFavorite("vod", m.stream_id, m.favorite !== 1),
      })),
    });

    return rows.filter((r) => r.items.length > 0);
  }, [
    homeRecentVod,
    homeRecentLive,
    homeFavVod,
    homeFavLive,
    homeLive,
    homeVod,
    openLive,
    openVod,
    toggleFavorite,
  ]);

  useEffect(() => {
    setLoading(true);
    refreshStatus()
      .then(async ({ activeId, syncing }) => {
        if (!activeId) return;
        if (syncing) await waitSync();
        await Promise.all([loadCategories(), loadHome(), loadLists()]);
      })
      .finally(() => setLoading(false));
  }, [loadCategories, loadHome, loadLists, refreshStatus, waitSync]);

  useEffect(() => {
    if (!activeId) return;
    if (nav === "live") void loadLists();
    if (nav === "vod") void loadLists();
    if (nav === "list") void loadLists();
  }, [activeId, loadLists, nav]);

  useEffect(() => {
    if (!activeId) return;
    const t = setTimeout(() => {
      if (nav === "live") void loadLists();
      if (nav === "vod") void loadLists();
    }, 350);
    return () => clearTimeout(t);
  }, [activeId, liveQuery, loadLists, nav, vodQuery]);

  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return { live: [], vod: [] };
    const live = homeLive.filter((s) => s.name.toLowerCase().includes(q)).slice(0, 20);
    const vod = homeVod.filter((m) => m.name.toLowerCase().includes(q)).slice(0, 20);
    return { live, vod };
  }, [searchQuery, homeLive, homeVod]);

  return (
    <div className="min-h-screen pb-[92px]">
      <div className="sticky top-0 z-30 border-b border-border/40 bg-background/70 backdrop-blur-xl">
        <div className="mx-auto max-w-xl px-4 py-4 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">Acervos de</p>
            <h1 className="font-display text-3xl leading-none tracking-wide text-foreground truncate">
              Filmes
            </h1>
          </div>

          <button
            onClick={() => setAccountDrawerOpen(true)}
            className="shrink-0 rounded-2xl border border-border/40 bg-white/5 px-4 py-2 text-left hover:bg-white/10 transition min-h-[44px]"
          >
            <div className="flex items-center gap-2">
              <div className="min-w-0">
                <p className="text-[10px] text-muted-foreground leading-none">Conta</p>
                <p className="text-xs text-foreground truncate">
                  {activeAccount?.name ?? "Selecionar"}
                </p>
              </div>
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            </div>
          </button>
        </div>
      </div>

      <main className="mx-auto max-w-xl px-4 py-6 space-y-6">
        {loading ? (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Carregando...
          </div>
        ) : accounts.length === 0 ? (
          <div className="rounded-3xl border border-border/40 bg-white/5 p-6 space-y-4">
            <h2 className="font-display text-3xl text-foreground">Adicionar conta IPTV</h2>
            <p className="text-sm text-muted-foreground">
              Conecte seu provedor Xtream para importar canais ao vivo e filmes.
            </p>
            <Button onClick={() => setAddDrawerOpen(true)} size="lg" className="w-full rounded-2xl">
              <Plus className="h-4 w-4" />
              Importar conta
            </Button>
          </div>
        ) : !activeId ? (
          <div className="rounded-3xl border border-border/40 bg-white/5 p-6 space-y-4">
            <h2 className="font-display text-3xl text-foreground">Selecione uma conta</h2>
            <p className="text-sm text-muted-foreground">
              Abra “Conta” no topo para escolher qual catálogo usar.
            </p>
            <Button
              onClick={() => setAccountDrawerOpen(true)}
              size="lg"
              className="w-full rounded-2xl"
            >
              Selecionar conta
            </Button>
          </div>
        ) : (
          <>
            {syncing ? (
              <div className="rounded-2xl border border-primary/20 bg-primary/10 px-4 py-3 text-sm text-primary flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Sincronizando catálogo...
              </div>
            ) : null}

            {nav === "home" ? (
              <div className="space-y-10">
                <HeroCarousel slides={slides} />
                {homeRows.map((r) => (
                  <Row
                    key={r.title}
                    title={r.title}
                    actionLabel={r.action ? "Ver tudo" : undefined}
                    onAction={r.action ? () => setNav(r.action!) : undefined}
                    items={r.items}
                  />
                ))}
              </div>
            ) : null}

            {nav === "live" ? (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Input
                    value={liveQuery}
                    onChange={(e) => setLiveQuery(e.target.value)}
                    placeholder="Buscar canal..."
                  />
                  <div className="-mx-4 px-4 overflow-x-auto">
                    <div className="flex gap-2">
                      {liveCategories.slice(0, 16).map((c) => (
                        <button
                          key={c.category_id}
                          onClick={() => setLiveCategory(c.category_id)}
                          className={
                            c.category_id === liveCategory
                              ? "shrink-0 rounded-full bg-primary/15 text-primary px-4 h-10 text-xs font-medium border border-primary/20"
                              : "shrink-0 rounded-full bg-white/5 text-muted-foreground px-4 h-10 text-xs font-medium border border-border/40 hover:text-foreground hover:bg-white/10 transition"
                          }
                        >
                          {c.category_name}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="space-y-2">
                  {liveList.slice(0, 80).map((c) => (
                    <button
                      key={c.stream_id}
                      onClick={() => void openLive(c)}
                      className="w-full rounded-2xl border border-border/40 bg-white/5 px-4 py-3 text-left hover:bg-white/10 transition"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm text-foreground truncate">{c.name}</p>
                          <p className="text-xs text-muted-foreground">Ao vivo</p>
                        </div>
                        <div className="shrink-0 rounded-full bg-primary/90 px-2 py-0.5 text-[10px] font-semibold text-primary-foreground">
                          LIVE
                        </div>
                      </div>
                    </button>
                  ))}
                  {liveList.length === 0 ? (
                    <div className="text-sm text-muted-foreground">Nenhum canal encontrado.</div>
                  ) : null}
                </div>
              </div>
            ) : null}

            {nav === "vod" ? (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Input
                    value={vodQuery}
                    onChange={(e) => setVodQuery(e.target.value)}
                    placeholder="Buscar filme..."
                  />
                  <div className="-mx-4 px-4 overflow-x-auto">
                    <div className="flex gap-2">
                      {vodCategories.slice(0, 16).map((c) => (
                        <button
                          key={c.category_id}
                          onClick={() => setVodCategory(c.category_id)}
                          className={
                            c.category_id === vodCategory
                              ? "shrink-0 rounded-full bg-primary/15 text-primary px-4 h-10 text-xs font-medium border border-primary/20"
                              : "shrink-0 rounded-full bg-white/5 text-muted-foreground px-4 h-10 text-xs font-medium border border-border/40 hover:text-foreground hover:bg-white/10 transition"
                          }
                        >
                          {c.category_name}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  {vodList.slice(0, 60).map((m) => (
                    <button
                      key={m.stream_id}
                      onClick={() => void openVod(m)}
                      className="overflow-hidden rounded-2xl border border-border/40 bg-white/5 text-left hover:bg-white/10 transition"
                    >
                      <div className="aspect-[2/3]">
                        {m.stream_icon ? (
                          <img src={m.stream_icon} alt="" className="h-full w-full object-cover" />
                        ) : (
                          <div className="h-full w-full bg-secondary/40" />
                        )}
                      </div>
                      <div className="p-2">
                        <p className="text-xs text-foreground line-clamp-2">{m.name}</p>
                      </div>
                    </button>
                  ))}
                </div>
                {vodList.length === 0 ? (
                  <div className="text-sm text-muted-foreground">Nenhum filme encontrado.</div>
                ) : null}
              </div>
            ) : null}

            {nav === "search" ? (
              <div className="space-y-4">
                <Input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Buscar canais e filmes..."
                />
                <div className="space-y-6">
                  {searchResults.live.length > 0 ? (
                    <Row
                      title="Canais"
                      items={searchResults.live.map((c) => ({
                        key: `sl-${c.stream_id}`,
                        title: c.name,
                        image: c.stream_icon,
                        kind: "live",
                        favorite: c.favorite === 1,
                        onPlay: () => void openLive(c),
                        onToggleFavorite: () =>
                          void toggleFavorite("live", c.stream_id, c.favorite !== 1),
                      }))}
                    />
                  ) : null}
                  {searchResults.vod.length > 0 ? (
                    <Row
                      title="Filmes"
                      items={searchResults.vod.map((m) => ({
                        key: `sv-${m.stream_id}`,
                        title: m.name,
                        image: m.stream_icon,
                        kind: "vod",
                        favorite: m.favorite === 1,
                        onPlay: () => void openVod(m),
                        onToggleFavorite: () =>
                          void toggleFavorite("vod", m.stream_id, m.favorite !== 1),
                      }))}
                    />
                  ) : null}
                  {searchQuery.trim() &&
                  searchResults.live.length === 0 &&
                  searchResults.vod.length === 0 ? (
                    <div className="text-sm text-muted-foreground">Nada encontrado.</div>
                  ) : null}
                </div>
              </div>
            ) : null}

            {nav === "list" ? (
              <div className="space-y-8">
                <Row
                  title="Filmes salvos"
                  items={listVod.map((m) => ({
                    key: `lv-${m.stream_id}`,
                    title: m.name,
                    image: m.stream_icon,
                    kind: "vod",
                    favorite: m.favorite === 1,
                    onPlay: () => void openVod(m),
                    onToggleFavorite: () =>
                      void toggleFavorite("vod", m.stream_id, m.favorite !== 1),
                  }))}
                />
                <Row
                  title="Canais salvos"
                  items={listLive.map((c) => ({
                    key: `ll-${c.stream_id}`,
                    title: c.name,
                    image: c.stream_icon,
                    kind: "live",
                    favorite: c.favorite === 1,
                    onPlay: () => void openLive(c),
                    onToggleFavorite: () =>
                      void toggleFavorite("live", c.stream_id, c.favorite !== 1),
                  }))}
                />
                {listLive.length === 0 && listVod.length === 0 ? (
                  <div className="rounded-3xl border border-border/40 bg-white/5 p-6 text-sm text-muted-foreground">
                    Você ainda não salvou nada. Toque no ⭐ para adicionar.
                  </div>
                ) : null}
              </div>
            ) : null}
          </>
        )}
      </main>

      <BottomNav active={nav} onChange={setNav} />

      <AccountDrawer
        open={accountDrawerOpen}
        onOpenChange={setAccountDrawerOpen}
        accounts={accounts}
        onActivate={(id) => void activateAccount(id)}
        onAdd={() => {
          setAccountDrawerOpen(false);
          setAddDrawerOpen(true);
        }}
      />

      <AddAccountDrawer
        open={addDrawerOpen}
        onOpenChange={setAddDrawerOpen}
        onSave={createAccount}
      />

      <PlayerOverlay item={player} />
    </div>
  );
}
