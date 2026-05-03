import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Check, Copy, Loader2, Play, Plus, Star, Tv, X } from "lucide-react";
import { Header } from "@/components/Header";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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

type IptvAccount = {
  id: number;
  name: string;
  baseUrl: string;
  username: string;
  isActive: boolean;
  lastSyncAt: number;
};

type IptvCategory = { category_id: string; category_name: string; parent_id?: string | null };

type IptvLiveStream = {
  stream_id: number;
  name: string;
  category_id?: string | null;
  stream_icon?: string | null;
  favorite: number;
  added_at?: number | null;
  last_played_at?: number | null;
};

type IptvVodStream = {
  stream_id: number;
  name: string;
  category_id?: string | null;
  stream_icon?: string | null;
  favorite: number;
  added_at?: number | null;
  last_played_at?: number | null;
};

type ActivePlayer = {
  type: "live" | "vod";
  id: number;
  name: string;
  logo?: string | null;
};

function getVlcDeepLink(streamUrl: string): string {
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  const isAndroid = /android/i.test(ua);
  if (isAndroid) {
    return `intent:${streamUrl}#Intent;package=org.videolan.vlc;action=android.intent.action.VIEW;type=video/*;end`;
  }
  return streamUrl.replace(/^https?:\/\//, "vlc://");
}

function nowIso(ts: number): string {
  if (!ts) return "";
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return "";
  }
}

type HomeRowItem = {
  key: string;
  title: string;
  image: string;
  aspect: "wide" | "poster";
  favorite: boolean;
  onPlay: () => void;
  onToggleFavorite: () => void;
};

function HomeRow({ title, items }: { title: string; items: HomeRowItem[] }) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-foreground">{title}</h3>
      </div>
      <div className="-mx-6 px-6 overflow-x-auto pb-2">
        <div className="flex gap-3 snap-x snap-mandatory">
          {items.map((it) => (
            <div
              key={it.key}
              className={`snap-start shrink-0 ${
                it.aspect === "poster" ? "w-[120px] sm:w-[150px]" : "w-[220px] sm:w-[260px]"
              }`}
            >
              <div className="relative">
                <button
                  onClick={it.onPlay}
                  className={`block w-full overflow-hidden rounded-xl border border-border/40 bg-secondary/30 ${
                    it.aspect === "poster" ? "aspect-[2/3]" : "aspect-video"
                  }`}
                >
                  {it.image ? (
                    <img src={it.image} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <div className="h-full w-full bg-secondary/40" />
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/0 to-black/0" />
                  <div className="absolute bottom-0 left-0 right-0 p-2">
                    <p className="text-xs text-foreground line-clamp-2">{it.title}</p>
                  </div>
                </button>
                <button
                  onClick={it.onToggleFavorite}
                  className="absolute top-2 right-2 rounded-full bg-black/50 border border-border/40 p-2 hover:bg-black/60 transition"
                  title="Favoritar"
                >
                  <Star
                    className={`h-4 w-4 ${it.favorite ? "text-yellow-400" : "text-muted-foreground"}`}
                  />
                </button>
              </div>
            </div>
          ))}
          {items.length === 0 ? (
            <div className="py-6 text-sm text-muted-foreground">Nada para mostrar.</div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

export const Route = createFileRoute("/iptv")({
  head: () => ({
    meta: [{ title: "IPTV — Buffet de Vídeo" }],
  }),
  component: IptvPage,
});

function IptvPage() {
  const [view, setView] = useState<"home" | "live" | "vod">("home");
  const [accounts, setAccounts] = useState<IptvAccount[]>([]);
  const [activeAccountId, setActiveAccountId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  const [homeRecentLive, setHomeRecentLive] = useState<IptvLiveStream[]>([]);
  const [homeRecentVod, setHomeRecentVod] = useState<IptvVodStream[]>([]);
  const [homeFavLive, setHomeFavLive] = useState<IptvLiveStream[]>([]);
  const [homeFavVod, setHomeFavVod] = useState<IptvVodStream[]>([]);
  const [homeLive, setHomeLive] = useState<IptvLiveStream[]>([]);
  const [homeVod, setHomeVod] = useState<IptvVodStream[]>([]);

  const [liveCategories, setLiveCategories] = useState<IptvCategory[]>([]);
  const [liveCategoryId, setLiveCategoryId] = useState<string>("");
  const [liveQuery, setLiveQuery] = useState("");
  const [liveOnlyFav, setLiveOnlyFav] = useState(false);
  const [liveStreams, setLiveStreams] = useState<IptvLiveStream[]>([]);

  const [vodCategories, setVodCategories] = useState<IptvCategory[]>([]);
  const [vodCategoryId, setVodCategoryId] = useState<string>("");
  const [vodQuery, setVodQuery] = useState("");
  const [vodOnlyFav, setVodOnlyFav] = useState(false);
  const [vodStreams, setVodStreams] = useState<IptvVodStream[]>([]);

  const [addOpen, setAddOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newBaseUrl, setNewBaseUrl] = useState("");
  const [newUser, setNewUser] = useState("");
  const [newPass, setNewPass] = useState("");
  const [saving, setSaving] = useState(false);

  const [player, setPlayer] = useState<ActivePlayer | null>(null);
  const [copied, setCopied] = useState(false);
  const [playerLoading, setPlayerLoading] = useState(false);
  const [playerError, setPlayerError] = useState(false);

  const activeAccount = useMemo(
    () => accounts.find((a) => a.id === activeAccountId) ?? null,
    [accounts, activeAccountId],
  );

  const refreshLists = async () => {
    const [acc, status] = await Promise.all([iptvGetAccounts(), iptvGetActiveStatus()]);
    const parsedAcc = (acc as IptvAccount[]).map((a) => ({
      ...a,
      baseUrl:
        (a.baseUrl as unknown as string) || (a as unknown as { base_url?: string }).base_url || "",
    }));
    setAccounts(parsedAcc);
    const active = (status as { active?: IptvAccount | null }).active ?? null;
    setActiveAccountId(active?.id ?? null);
    setSyncing(Boolean((status as { syncing?: boolean }).syncing));
    setSyncError(((status as { error?: string | null }).error as string | null) ?? null);
    return {
      activeId: active?.id ?? null,
      syncing: Boolean((status as { syncing?: boolean }).syncing),
    };
  };

  const loadLive = async (accountId: number) => {
    const cats = (await iptvGetLiveCategories()) as IptvCategory[];
    setLiveCategories(cats);
    const first = liveCategoryId || cats[0]?.category_id || "";
    setLiveCategoryId(first);
    const list = (await iptvGetLiveStreams({
      categoryId: first,
      q: liveQuery,
      onlyFavorites: liveOnlyFav,
    })) as IptvLiveStream[];
    setLiveStreams(list);
    void accountId;
  };

  const loadVod = async (accountId: number) => {
    const cats = (await iptvGetVodCategories()) as IptvCategory[];
    setVodCategories(cats);
    const first = vodCategoryId || cats[0]?.category_id || "";
    setVodCategoryId(first);
    const list = (await iptvGetVodStreams({
      categoryId: first,
      q: vodQuery,
      onlyFavorites: vodOnlyFav,
    })) as IptvVodStream[];
    setVodStreams(list);
    void accountId;
  };

  const loadHome = async () => {
    const [recentLive, recentVod, favLive, favVod, liveAll, vodAll] = await Promise.all([
      iptvGetRecent({ type: "live", limit: 20 }),
      iptvGetRecent({ type: "vod", limit: 20 }),
      iptvGetLiveStreams({ onlyFavorites: true }),
      iptvGetVodStreams({ onlyFavorites: true }),
      iptvGetLiveStreams({}),
      iptvGetVodStreams({}),
    ]);

    setHomeRecentLive(recentLive as IptvLiveStream[]);
    setHomeRecentVod(recentVod as IptvVodStream[]);
    setHomeFavLive((favLive as IptvLiveStream[]).slice(0, 20));
    setHomeFavVod((favVod as IptvVodStream[]).slice(0, 20));
    setHomeLive((liveAll as IptvLiveStream[]).slice(0, 20));
    setHomeVod((vodAll as IptvVodStream[]).slice(0, 20));
  };

  const waitSync = async (tries = 90) => {
    for (let i = 0; i < tries; i++) {
      const status = (await iptvGetActiveStatus()) as {
        syncing?: boolean;
        error?: string | null;
        active?: { id?: number } | null;
      };
      setSyncing(Boolean(status.syncing));
      setSyncError((status.error as string | null) ?? null);
      if (!status.syncing) return;
      await new Promise((r) => setTimeout(r, 2000));
    }
  };

  const activate = async (id: number) => {
    setSyncError(null);
    setSyncing(true);
    await iptvActivateAccount(id);
    setActiveAccountId(id);
    await waitSync();
    await Promise.all([loadHome(), loadLive(id), loadVod(id)]);
  };

  useEffect(() => {
    setLoading(true);
    refreshLists()
      .then(async ({ activeId, syncing }) => {
        if (!activeId) return;
        if (syncing) await waitSync();
        await Promise.all([loadHome(), loadLive(activeId), loadVod(activeId)]);
      })
      .catch(() => void 0)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!activeAccountId) return;
    if (view === "live") {
      iptvGetLiveStreams({
        categoryId: liveCategoryId,
        q: liveQuery,
        onlyFavorites: liveOnlyFav,
      })
        .then((r) => setLiveStreams(r as IptvLiveStream[]))
        .catch(() => void 0);
      return;
    }
    if (view === "vod") {
      iptvGetVodStreams({
        categoryId: vodCategoryId,
        q: vodQuery,
        onlyFavorites: vodOnlyFav,
      })
        .then((r) => setVodStreams(r as IptvVodStream[]))
        .catch(() => void 0);
    }
  }, [
    activeAccountId,
    view,
    liveCategoryId,
    liveQuery,
    liveOnlyFav,
    vodCategoryId,
    vodQuery,
    vodOnlyFav,
  ]);

  const handleSaveAccount = async () => {
    setSaving(true);
    try {
      const payload = { name: newName, baseUrl: newBaseUrl, username: newUser, password: newPass };
      await iptvCreateAccount(payload);
      setAddOpen(false);
      setNewName("");
      setNewBaseUrl("");
      setNewUser("");
      setNewPass("");
      const { activeId } = await refreshLists();
      if (activeId) {
        await waitSync();
        await Promise.all([loadHome(), loadLive(activeId), loadVod(activeId)]);
      }
    } catch {
      void 0;
    } finally {
      setSaving(false);
    }
  };

  const openPlayer = async (next: ActivePlayer) => {
    setPlayer(next);
    setCopied(false);
    setPlayerLoading(true);
    setPlayerError(false);
    const id = String(next.id);
    await iptvTouchRecent({ type: next.type, itemId: id });
    void loadHome();
  };

  const streamUrl = useMemo(() => {
    if (!player) return "";
    return player.type === "live" ? iptvLiveRelayUrl(player.id) : iptvVodRelayUrl(player.id);
  }, [player]);

  const vlcUrl = useMemo(() => (streamUrl ? getVlcDeepLink(streamUrl) : ""), [streamUrl]);

  const featured = useMemo(() => {
    const vod = homeRecentVod[0] ?? homeVod[0] ?? null;
    if (vod) {
      const url = iptvVodRelayUrl(vod.stream_id);
      return {
        type: "vod" as const,
        title: vod.name,
        image: vod.stream_icon ?? "",
        player: {
          type: "vod" as const,
          id: vod.stream_id,
          name: vod.name,
          logo: vod.stream_icon,
        },
        vlcUrl: getVlcDeepLink(url),
      };
    }
    const live = homeRecentLive[0] ?? homeLive[0] ?? null;
    if (live) {
      const url = iptvLiveRelayUrl(live.stream_id);
      return {
        type: "live" as const,
        title: live.name,
        image: live.stream_icon ?? "",
        player: {
          type: "live" as const,
          id: live.stream_id,
          name: live.name,
          logo: live.stream_icon,
        },
        vlcUrl: getVlcDeepLink(url),
      };
    }
    return null;
  }, [homeRecentLive, homeRecentVod, homeLive, homeVod]);

  const copyUrl = async () => {
    if (!streamUrl) return;
    try {
      await navigator.clipboard.writeText(streamUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      void 0;
    }
  };

  const toggleFavorite = async (type: "live" | "vod", streamId: number, next: boolean) => {
    try {
      await iptvSetFavorite({ type, itemId: String(streamId), value: next });
      if (type === "live") {
        setLiveStreams((prev) =>
          prev.map((s) => (s.stream_id === streamId ? { ...s, favorite: next ? 1 : 0 } : s)),
        );
      } else {
        setVodStreams((prev) =>
          prev.map((s) => (s.stream_id === streamId ? { ...s, favorite: next ? 1 : 0 } : s)),
        );
      }
      void loadHome();
    } catch {
      void 0;
    }
  };

  return (
    <div className="min-h-screen">
      <Header />

      <main className="container mx-auto px-6 py-8 space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <h1 className="font-display text-3xl text-cream flex items-center gap-2">
              <Tv className="h-5 w-5 text-primary" />
              IPTV
            </h1>
            <p className="text-sm text-muted-foreground">
              Conta ativa: {activeAccount?.name ?? "nenhuma"}{" "}
              {activeAccount?.lastSyncAt
                ? `• Última sync: ${nowIso(activeAccount.lastSyncAt)}`
                : ""}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <select
              value={activeAccountId ?? ""}
              onChange={(e) => void activate(Number(e.target.value))}
              disabled={!accounts.length || syncing}
              className="h-11 rounded-lg bg-secondary/50 border border-border/40 px-3 text-sm"
            >
              <option value="" disabled>
                Selecione a conta
              </option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
            <button
              onClick={() => setAddOpen(true)}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground hover:brightness-110 transition min-h-[44px]"
            >
              <Plus className="h-4 w-4" />
              <span className="hidden sm:inline">Adicionar</span>
            </button>
          </div>
        </div>

        {syncError && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            Falha ao sincronizar. Verifique usuário/senha/URL do provedor e tente novamente.
          </div>
        )}

        {loading ? (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Carregando...
          </div>
        ) : !accounts.length ? (
          <div className="rounded-xl border border-border/40 bg-card p-6 space-y-3">
            <p className="text-sm text-muted-foreground">Nenhuma conta IPTV cadastrada.</p>
            <button
              onClick={() => setAddOpen(true)}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground hover:brightness-110 transition"
            >
              <Plus className="h-4 w-4" />
              Adicionar conta
            </button>
          </div>
        ) : !activeAccountId ? (
          <div className="rounded-xl border border-border/40 bg-card p-6">
            <p className="text-sm text-muted-foreground">
              Selecione uma conta para sincronizar e visualizar os canais/filmes.
            </p>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={() => setView("home")}
                className={`rounded-lg px-4 py-2 text-sm border transition ${
                  view === "home"
                    ? "bg-primary text-primary-foreground border-primary/40"
                    : "bg-secondary/30 text-muted-foreground border-border/40 hover:bg-secondary/50 hover:text-foreground"
                }`}
              >
                Home
              </button>
              <button
                onClick={() => setView("live")}
                className={`rounded-lg px-4 py-2 text-sm border transition ${
                  view === "live"
                    ? "bg-primary text-primary-foreground border-primary/40"
                    : "bg-secondary/30 text-muted-foreground border-border/40 hover:bg-secondary/50 hover:text-foreground"
                }`}
              >
                Ao vivo
              </button>
              <button
                onClick={() => setView("vod")}
                className={`rounded-lg px-4 py-2 text-sm border transition ${
                  view === "vod"
                    ? "bg-primary text-primary-foreground border-primary/40"
                    : "bg-secondary/30 text-muted-foreground border-border/40 hover:bg-secondary/50 hover:text-foreground"
                }`}
              >
                Filmes
              </button>
              {syncing && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground ml-2">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Sincronizando...
                </div>
              )}
            </div>

            {view === "home" ? (
              <div className="space-y-10">
                <div className="-mx-6 overflow-hidden rounded-3xl border border-border/40 bg-card">
                  <div className="relative h-[58vh] min-h-[420px] max-h-[620px]">
                    {featured?.image ? (
                      <img
                        src={featured.image}
                        alt=""
                        className="absolute inset-0 h-full w-full object-cover opacity-90"
                      />
                    ) : (
                      <div className="absolute inset-0 bg-secondary/40" />
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-black via-black/70 to-black/10" />
                    <div className="absolute inset-0 px-6 pb-8 pt-10 flex flex-col justify-end">
                      <div className="space-y-4 max-w-xl">
                        <div className="inline-flex items-center gap-2 rounded-full bg-black/40 border border-border/40 px-3 py-1 text-xs text-muted-foreground w-fit">
                          <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
                          {featured?.type === "live" ? "Ao vivo" : "Filme"}
                        </div>
                        <h2 className="font-display text-4xl sm:text-5xl leading-[0.95] text-cream">
                          {featured?.title ?? "IPTV"}
                        </h2>
                        <p className="text-sm text-muted-foreground line-clamp-2">
                          Explore canais ao vivo e filmes com uma experiência estilo catálogo.
                        </p>
                        <div className="flex gap-2 flex-wrap">
                          <button
                            onClick={() => (featured ? void openPlayer(featured.player) : void 0)}
                            className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-medium text-primary-foreground hover:brightness-110 transition min-h-[48px]"
                          >
                            <Play className="h-4 w-4" />
                            Assistir
                          </button>
                          <a
                            href={featured?.vlcUrl ?? ""}
                            className="inline-flex items-center gap-2 rounded-xl bg-secondary/50 border border-border/40 px-5 py-3 text-sm text-foreground hover:bg-secondary/70 transition min-h-[48px]"
                          >
                            Abrir no VLC
                          </a>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {homeRecentLive.length > 0 ? (
                  <HomeRow
                    title="Ao vivo — recentes"
                    items={homeRecentLive.map((s) => ({
                      key: `rl-${s.stream_id}`,
                      title: s.name,
                      image: s.stream_icon ?? "",
                      aspect: "wide",
                      favorite: s.favorite === 1,
                      onPlay: () =>
                        void openPlayer({
                          type: "live",
                          id: s.stream_id,
                          name: s.name,
                          logo: s.stream_icon,
                        }),
                      onToggleFavorite: () =>
                        void toggleFavorite("live", s.stream_id, s.favorite !== 1),
                    }))}
                  />
                ) : null}

                {homeRecentVod.length > 0 ? (
                  <HomeRow
                    title="Continuar assistindo"
                    items={homeRecentVod.map((m) => ({
                      key: `rv-${m.stream_id}`,
                      title: m.name,
                      image: m.stream_icon ?? "",
                      aspect: "poster",
                      favorite: m.favorite === 1,
                      onPlay: () =>
                        void openPlayer({
                          type: "vod",
                          id: m.stream_id,
                          name: m.name,
                          logo: m.stream_icon,
                        }),
                      onToggleFavorite: () =>
                        void toggleFavorite("vod", m.stream_id, m.favorite !== 1),
                    }))}
                  />
                ) : null}

                {homeFavLive.length > 0 ? (
                  <HomeRow
                    title="Canais favoritos"
                    items={homeFavLive.map((s) => ({
                      key: `fl-${s.stream_id}`,
                      title: s.name,
                      image: s.stream_icon ?? "",
                      aspect: "wide",
                      favorite: s.favorite === 1,
                      onPlay: () =>
                        void openPlayer({
                          type: "live",
                          id: s.stream_id,
                          name: s.name,
                          logo: s.stream_icon,
                        }),
                      onToggleFavorite: () =>
                        void toggleFavorite("live", s.stream_id, s.favorite !== 1),
                    }))}
                  />
                ) : null}

                {homeFavVod.length > 0 ? (
                  <HomeRow
                    title="Filmes favoritos"
                    items={homeFavVod.map((m) => ({
                      key: `fv-${m.stream_id}`,
                      title: m.name,
                      image: m.stream_icon ?? "",
                      aspect: "poster",
                      favorite: m.favorite === 1,
                      onPlay: () =>
                        void openPlayer({
                          type: "vod",
                          id: m.stream_id,
                          name: m.name,
                          logo: m.stream_icon,
                        }),
                      onToggleFavorite: () =>
                        void toggleFavorite("vod", m.stream_id, m.favorite !== 1),
                    }))}
                  />
                ) : null}

                {homeLive.length > 0 ? (
                  <HomeRow
                    title="Ao vivo — para explorar"
                    items={homeLive.map((s) => ({
                      key: `l-${s.stream_id}`,
                      title: s.name,
                      image: s.stream_icon ?? "",
                      aspect: "wide",
                      favorite: s.favorite === 1,
                      onPlay: () =>
                        void openPlayer({
                          type: "live",
                          id: s.stream_id,
                          name: s.name,
                          logo: s.stream_icon,
                        }),
                      onToggleFavorite: () =>
                        void toggleFavorite("live", s.stream_id, s.favorite !== 1),
                    }))}
                  />
                ) : null}

                {homeVod.length > 0 ? (
                  <HomeRow
                    title="Filmes — para explorar"
                    items={homeVod.map((m) => ({
                      key: `v-${m.stream_id}`,
                      title: m.name,
                      image: m.stream_icon ?? "",
                      aspect: "poster",
                      favorite: m.favorite === 1,
                      onPlay: () =>
                        void openPlayer({
                          type: "vod",
                          id: m.stream_id,
                          name: m.name,
                          logo: m.stream_icon,
                        }),
                      onToggleFavorite: () =>
                        void toggleFavorite("vod", m.stream_id, m.favorite !== 1),
                    }))}
                  />
                ) : null}
              </div>
            ) : view === "live" ? (
              <div className="space-y-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                  <select
                    value={liveCategoryId}
                    onChange={(e) => setLiveCategoryId(e.target.value)}
                    className="h-11 rounded-lg bg-secondary/50 border border-border/40 px-3 text-sm"
                  >
                    {liveCategories.map((c) => (
                      <option key={c.category_id} value={c.category_id}>
                        {c.category_name}
                      </option>
                    ))}
                  </select>
                  <Input
                    value={liveQuery}
                    onChange={(e) => setLiveQuery(e.target.value)}
                    placeholder="Buscar canal..."
                    className="h-11"
                  />
                  <button
                    onClick={() => setLiveOnlyFav((p) => !p)}
                    className={`h-11 rounded-lg px-4 text-sm border transition ${
                      liveOnlyFav
                        ? "bg-primary text-primary-foreground border-primary/40"
                        : "bg-secondary/30 text-muted-foreground border-border/40 hover:bg-secondary/50 hover:text-foreground"
                    }`}
                  >
                    ⭐ Favoritos
                  </button>
                </div>

                <div className="rounded-xl border border-border/40 bg-card overflow-hidden">
                  <div className="max-h-[70vh] overflow-auto divide-y divide-border/40">
                    {liveStreams.map((s) => (
                      <div key={s.stream_id} className="flex items-center gap-3 px-4 py-3">
                        {s.stream_icon ? (
                          <img
                            src={s.stream_icon}
                            alt=""
                            className="h-10 w-10 rounded-md object-cover"
                          />
                        ) : (
                          <div className="h-10 w-10 rounded-md bg-secondary/40" />
                        )}
                        <button
                          onClick={() =>
                            void openPlayer({
                              type: "live",
                              id: s.stream_id,
                              name: s.name,
                              logo: s.stream_icon,
                            })
                          }
                          className="flex-1 text-left text-sm text-foreground hover:underline"
                        >
                          {s.name}
                        </button>
                        <button
                          onClick={() => void toggleFavorite("live", s.stream_id, s.favorite !== 1)}
                          className="rounded-md p-2 hover:bg-secondary/40 transition"
                          title="Favoritar"
                        >
                          <Star
                            className={`h-4 w-4 ${s.favorite === 1 ? "text-yellow-400" : "text-muted-foreground"}`}
                          />
                        </button>
                      </div>
                    ))}
                    {liveStreams.length === 0 && (
                      <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                        Nenhum canal encontrado.
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                  <select
                    value={vodCategoryId}
                    onChange={(e) => setVodCategoryId(e.target.value)}
                    className="h-11 rounded-lg bg-secondary/50 border border-border/40 px-3 text-sm"
                  >
                    {vodCategories.map((c) => (
                      <option key={c.category_id} value={c.category_id}>
                        {c.category_name}
                      </option>
                    ))}
                  </select>
                  <Input
                    value={vodQuery}
                    onChange={(e) => setVodQuery(e.target.value)}
                    placeholder="Buscar filme..."
                    className="h-11"
                  />
                  <button
                    onClick={() => setVodOnlyFav((p) => !p)}
                    className={`h-11 rounded-lg px-4 text-sm border transition ${
                      vodOnlyFav
                        ? "bg-primary text-primary-foreground border-primary/40"
                        : "bg-secondary/30 text-muted-foreground border-border/40 hover:bg-secondary/50 hover:text-foreground"
                    }`}
                  >
                    ⭐ Favoritos
                  </button>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
                  {vodStreams.map((m) => (
                    <div
                      key={m.stream_id}
                      className="rounded-xl border border-border/40 bg-card overflow-hidden"
                    >
                      <button
                        onClick={() =>
                          void openPlayer({
                            type: "vod",
                            id: m.stream_id,
                            name: m.name,
                            logo: m.stream_icon,
                          })
                        }
                        className="block w-full text-left"
                      >
                        {m.stream_icon ? (
                          <img src={m.stream_icon} alt="" className="h-56 w-full object-cover" />
                        ) : (
                          <div className="h-56 w-full bg-secondary/40" />
                        )}
                        <div className="p-3">
                          <p className="text-sm text-foreground line-clamp-2">{m.name}</p>
                        </div>
                      </button>
                      <div className="px-3 pb-3 flex justify-end">
                        <button
                          onClick={() => void toggleFavorite("vod", m.stream_id, m.favorite !== 1)}
                          className="rounded-md p-2 hover:bg-secondary/40 transition"
                          title="Favoritar"
                        >
                          <Star
                            className={`h-4 w-4 ${m.favorite === 1 ? "text-yellow-400" : "text-muted-foreground"}`}
                          />
                        </button>
                      </div>
                    </div>
                  ))}
                  {vodStreams.length === 0 && (
                    <div className="col-span-full text-center text-sm text-muted-foreground py-10">
                      Nenhum filme encontrado.
                    </div>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </main>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Adicionar conta IPTV</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Nome da conta"
            />
            <Input
              value={newBaseUrl}
              onChange={(e) => setNewBaseUrl(e.target.value)}
              placeholder="URL base (ex: https://provedor.com:80)"
            />
            <Input
              value={newUser}
              onChange={(e) => setNewUser(e.target.value)}
              placeholder="Usuário"
            />
            <Input
              value={newPass}
              onChange={(e) => setNewPass(e.target.value)}
              placeholder="Senha"
              type="password"
            />
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setAddOpen(false)}
                className="rounded-lg bg-secondary/60 px-4 py-2 text-sm hover:bg-secondary transition min-h-[44px]"
              >
                Cancelar
              </button>
              <button
                onClick={() => void handleSaveAccount()}
                disabled={saving}
                className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground hover:brightness-110 transition min-h-[44px] disabled:opacity-60"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Salvar
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {player ? (
        <div className="fixed inset-0 z-50 bg-black/90 backdrop-blur-sm">
          <div className="absolute inset-0 bg-gradient-to-t from-black via-black/60 to-black/10" />
          <div className="relative h-full w-full">
            <div className="absolute top-0 left-0 right-0 z-10 px-4 pt-4">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground">IPTV</p>
                  <p className="text-sm text-foreground truncate">{player.name}</p>
                </div>
                <button
                  onClick={() => setPlayer(null)}
                  className="rounded-full bg-black/50 border border-border/40 p-2 hover:bg-black/60 transition min-h-[44px] min-w-[44px] flex items-center justify-center"
                  title="Fechar"
                >
                  <X className="h-4 w-4 text-foreground" />
                </button>
              </div>
            </div>

            <div className="h-full w-full flex flex-col justify-center px-4 pb-6 pt-20">
              <div className="w-full max-w-5xl mx-auto space-y-4">
                <div className="relative w-full overflow-hidden rounded-2xl border border-border/40 bg-black">
                  <div className="aspect-video">
                    {streamUrl ? (
                      <video
                        src={streamUrl}
                        controls
                        autoPlay
                        playsInline
                        className="h-full w-full"
                        onLoadStart={() => {
                          setPlayerLoading(true);
                          setPlayerError(false);
                        }}
                        onCanPlay={() => setPlayerLoading(false)}
                        onError={() => {
                          setPlayerLoading(false);
                          setPlayerError(true);
                        }}
                      />
                    ) : null}
                  </div>

                  {playerLoading ? (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Carregando...
                      </div>
                    </div>
                  ) : null}

                  {playerError ? (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/70 p-6 text-center">
                      <div className="space-y-4 max-w-md">
                        <p className="text-base text-foreground">
                          Não foi possível reproduzir no navegador.
                        </p>
                        <p className="text-sm text-muted-foreground">
                          Tente abrir no VLC (recomendado) ou copie a URL.
                        </p>
                        <div className="flex flex-col sm:flex-row gap-2 justify-center">
                          <a
                            href={vlcUrl}
                            className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-medium text-primary-foreground hover:brightness-110 transition min-h-[48px]"
                          >
                            Abrir no VLC
                          </a>
                          <button
                            onClick={() => void copyUrl()}
                            className="inline-flex items-center justify-center gap-2 rounded-xl bg-secondary/50 border border-border/40 px-5 py-3 text-sm text-foreground hover:bg-secondary/70 transition min-h-[48px]"
                          >
                            {copied ? (
                              <Check className="h-4 w-4 text-green-400" />
                            ) : (
                              <Copy className="h-4 w-4" />
                            )}
                            Copiar URL
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>

                <div className="flex flex-wrap gap-2 justify-between items-center">
                  <div className="flex gap-2">
                    <a
                      href={vlcUrl}
                      className="inline-flex items-center gap-2 rounded-xl bg-secondary/50 border border-border/40 px-4 py-3 text-sm text-foreground hover:bg-secondary/70 transition min-h-[48px]"
                    >
                      Abrir no VLC
                    </a>
                    <button
                      onClick={() => void copyUrl()}
                      className="inline-flex items-center gap-2 rounded-xl bg-secondary/50 border border-border/40 px-4 py-3 text-sm text-foreground hover:bg-secondary/70 transition min-h-[48px]"
                    >
                      {copied ? (
                        <Check className="h-4 w-4 text-green-400" />
                      ) : (
                        <Copy className="h-4 w-4" />
                      )}
                      Copiar URL
                    </button>
                  </div>
                  <div className="text-xs text-muted-foreground truncate max-w-full">
                    {activeAccount ? `${activeAccount.name} • ${activeAccount.baseUrl}` : ""}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
