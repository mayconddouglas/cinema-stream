import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ExternalLink, Loader2, Tv } from "lucide-react";
import { AddMagnetDialog } from "@/components/AddMagnetDialog";
import { AppBottomNav } from "@/components/AppBottomNav";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/components/AuthProvider";
import { getAll, type LibraryItem } from "@/lib/storage";
import { tmdbMovie, type TmdbSearchItem } from "@/lib/tmdb";
import { prewarmMagnet } from "@/lib/vlc";

type Tab = "about" | "cast" | "similar";

export const Route = createFileRoute("/filme/$tmdbId")({
  loader: async ({ params }) => {
    const id = Number(params.tmdbId);
    if (!Number.isFinite(id) || id <= 0) throw new Error("invalid_tmdb_id");
    return tmdbMovie(id, "pt-BR");
  },
  component: MovieDetailsPage,
});

function MovieDetailsPage() {
  const data = Route.useLoaderData();
  const navigate = useNavigate();
  const { openVlcWithAuth } = useAuth();
  const [tab, setTab] = useState<Tab>("about");
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [openingVlc, setOpeningVlc] = useState(false);
  const [vlcError, setVlcError] = useState<string | null>(null);

  useEffect(() => {
    getAll().then(setItems);
  }, []);

  const inLibrary = useMemo(
    () => items.find((i) => i.tmdbId === data.id) ?? null,
    [items, data.id],
  );

  useEffect(() => {
    if (!inLibrary?.magnet) return;
    void prewarmMagnet(inLibrary.magnet);
  }, [inLibrary?.magnet]);
  const backdrop = data.backdrop ?? data.poster;

  const year = data.year ?? "";
  const runtime = typeof data.runtime === "number" && data.runtime > 0 ? `${data.runtime} min` : "";
  const genres = Array.isArray(data.genres) ? data.genres.map((g) => g.name).filter(Boolean) : [];

  const openTrailer = () => {
    if (!data.trailer || data.trailer.site !== "YouTube") return;
    window.open(
      `https://www.youtube.com/watch?v=${encodeURIComponent(data.trailer.key)}`,
      "_blank",
      "noopener,noreferrer",
    );
  };

  const goBack = () => {
    navigate({ to: "/" });
  };

  const openVlc = async () => {
    if (!inLibrary) {
      setShowAdd(true);
      return;
    }
    setOpeningVlc(true);
    setVlcError(null);
    openVlcWithAuth({
      target: "movie",
      itemId: inLibrary.id,
      magnet: inLibrary.magnet,
      fileIndex: inLibrary.fileIndex,
      startSeconds: inLibrary.progress ?? 0,
      durationSeconds:
        typeof data.runtime === "number" && data.runtime > 0 ? data.runtime * 60 : undefined,
    });
    setTimeout(() => setOpeningVlc(false), 800);
  };

  return (
    <div className="min-h-screen pb-[92px]">
      <div className="sticky top-0 z-30 border-b border-border/40 bg-background/70 backdrop-blur-xl">
        <div className="mx-auto max-w-xl px-4 py-4 flex items-center justify-between gap-3">
          <button
            onClick={goBack}
            className="rounded-2xl border border-border/40 bg-white/5 px-3 py-2 hover:bg-white/10 transition min-h-[44px] inline-flex items-center gap-2"
          >
            <ArrowLeft className="h-4 w-4" />
            <span className="text-xs">Voltar</span>
          </button>
          <div className="min-w-0 text-right">
            <p className="text-[10px] text-muted-foreground leading-none">Acervos de</p>
            <p className="text-xs text-foreground truncate">Filmes</p>
          </div>
        </div>
      </div>

      <section className="relative overflow-hidden border-b border-border/40">
        <div className="relative h-[62vh] min-h-[460px]">
          {backdrop ? (
            <>
              <img
                src={backdrop}
                alt=""
                aria-hidden
                className="absolute inset-0 h-full w-full object-cover"
              />
              <div className="absolute inset-0" style={{ background: "var(--gradient-hero)" }} />
            </>
          ) : (
            <div className="absolute inset-0 bg-gradient-to-br from-secondary to-black" />
          )}

          <div className="mx-auto max-w-xl h-full flex items-end px-4 pb-10 relative">
            <div className="space-y-4 animate-fade-up w-full">
              <h1 className="font-display text-5xl leading-[0.92] text-foreground">{data.title}</h1>

              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                {year && <span>{year}</span>}
                {runtime && <span>{runtime}</span>}
                {genres.slice(0, 3).map((g) => (
                  <span
                    key={g}
                    className="rounded-full border border-border/50 bg-black/30 px-2 py-0.5"
                  >
                    {g}
                  </span>
                ))}
              </div>

              <p className="text-sm text-muted-foreground line-clamp-3">
                {data.overview || "Sem descrição disponível."}
              </p>

              <div className="space-y-3">
                {!inLibrary && (
                  <div className="rounded-2xl border border-orange-500/30 bg-orange-500/10 px-4 py-3 text-sm text-orange-400">
                    Nenhum magnet adicionado. Clique em 'Abrir no VLC' para adicionar.
                  </div>
                )}
                <Button
                  onClick={() => void openVlc()}
                  disabled={openingVlc}
                  size="lg"
                  className="w-full rounded-2xl h-14 bg-orange-500 text-black hover:bg-orange-400"
                >
                  {openingVlc ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Tv className="h-4 w-4" />
                  )}
                  Abrir no VLC (Recomendado)
                </Button>

                <Button
                  variant="secondary"
                  onClick={() => setShowAdd(true)}
                  size="lg"
                  className="w-full rounded-2xl h-12"
                >
                  + Adicionar magnet
                </Button>

                {data.trailer && data.trailer.site === "YouTube" ? (
                  <Button
                    onClick={openTrailer}
                    variant="outline"
                    size="lg"
                    className="w-full rounded-2xl h-12"
                  >
                    <ExternalLink className="h-4 w-4" />
                    Trailer
                  </Button>
                ) : null}
              </div>

              {vlcError ? (
                <div className="rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                  {vlcError}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </section>

      <main className="mx-auto max-w-xl px-4 py-6 space-y-6">
        <div className="flex gap-2">
          <TabBtn active={tab === "about"} onClick={() => setTab("about")}>
            Sobre
          </TabBtn>
          <TabBtn active={tab === "cast"} onClick={() => setTab("cast")}>
            Elenco
          </TabBtn>
          <TabBtn active={tab === "similar"} onClick={() => setTab("similar")}>
            Similares
          </TabBtn>
        </div>

        {tab === "about" && (
          <div className="grid gap-6 md:grid-cols-3">
            <div className="md:col-span-2 space-y-3">
              <h2 className="font-display text-3xl text-foreground">Sinopse</h2>
              <p className="text-sm text-muted-foreground leading-relaxed">
                {data.overview || "Sem descrição disponível."}
              </p>
            </div>
            <div className="space-y-3 rounded-3xl bg-white/5 border border-border/40 p-5">
              <div className="text-xs uppercase tracking-wider text-muted-foreground">
                Informações
              </div>
              <InfoRow label="TMDB" value={String(data.id)} />
              {data.imdbId && (
                <a
                  href={`https://www.imdb.com/title/${encodeURIComponent(data.imdbId)}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sm text-primary hover:underline"
                >
                  Abrir no IMDb
                </a>
              )}
              {genres.length > 0 && <InfoRow label="Gêneros" value={genres.join(", ")} />}
              {runtime && <InfoRow label="Duração" value={runtime} />}
            </div>
          </div>
        )}

        {tab === "cast" && (
          <div className="space-y-3">
            <h2 className="font-display text-3xl text-foreground">Elenco</h2>
            {data.cast.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sem elenco disponível.</p>
            ) : (
              <div className="-mx-4 px-4 overflow-x-auto">
                <div className="flex gap-3">
                  {data.cast.map((c) => (
                    <div
                      key={c.id}
                      className="w-[140px] shrink-0 rounded-2xl overflow-hidden bg-white/5 border border-border/40"
                    >
                      <div className="aspect-[2/3] bg-secondary">
                        {c.profile ? (
                          <img
                            src={c.profile}
                            alt={c.name}
                            className="h-full w-full object-cover"
                            loading="lazy"
                          />
                        ) : (
                          <div className="h-full w-full bg-secondary" />
                        )}
                      </div>
                      <div className="p-2 space-y-0.5">
                        <div className="text-sm text-foreground line-clamp-1">{c.name}</div>
                        {c.character && (
                          <div className="text-[11px] text-muted-foreground line-clamp-1">
                            {c.character}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {tab === "similar" && (
          <div className="space-y-3">
            <h2 className="font-display text-3xl text-foreground">Similares</h2>
            {data.recommendations.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhuma recomendação disponível.</p>
            ) : (
              <div className="grid grid-cols-3 gap-3">
                {data.recommendations.map((r: TmdbSearchItem) => (
                  <Link
                    key={r.id}
                    to="/filme/$tmdbId"
                    params={{ tmdbId: String(r.id) }}
                    className="group rounded-2xl overflow-hidden bg-white/5 border border-border/40 hover:border-primary/50 transition"
                  >
                    <div className="aspect-[2/3] bg-secondary">
                      {r.poster ? (
                        <img
                          src={r.poster}
                          alt={r.title}
                          className="h-full w-full object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <div className="h-full w-full bg-secondary" />
                      )}
                    </div>
                    <div className="p-2">
                      <div className="text-sm text-foreground line-clamp-2 group-hover:text-primary transition">
                        {r.title}
                      </div>
                      {r.year && <div className="text-[11px] text-muted-foreground">{r.year}</div>}
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        )}
      </main>

      <AppBottomNav />

      <AddMagnetDialog open={showAdd} onClose={() => setShowAdd(false)} onAdded={setItems} />
    </div>
  );
}

function TabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={
        active
          ? "shrink-0 rounded-full bg-primary/15 text-primary px-4 h-10 text-xs font-medium border border-primary/20"
          : "shrink-0 rounded-full bg-white/5 text-muted-foreground px-4 h-10 text-xs font-medium border border-border/40 hover:text-foreground hover:bg-white/10 transition"
      }
    >
      {children}
    </button>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-xs text-foreground font-mono">{value}</span>
    </div>
  );
}
