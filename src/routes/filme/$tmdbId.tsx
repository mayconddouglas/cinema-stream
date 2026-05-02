import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ExternalLink, Play } from "lucide-react";
import { Header } from "@/components/Header";
import { AddMagnetDialog } from "@/components/AddMagnetDialog";
import { Player } from "@/components/Player";
import { getAll, update, type LibraryItem } from "@/lib/storage";
import { tmdbMovie, type TmdbSearchItem } from "@/lib/tmdb";

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
  const [tab, setTab] = useState<Tab>("about");
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [playing, setPlaying] = useState<LibraryItem | null>(null);

  useEffect(() => {
    getAll().then(setItems);
  }, []);

  const inLibrary = useMemo(() => items.find((i) => i.tmdbId === data.id) ?? null, [items, data.id]);
  const backdrop = data.backdrop ?? data.poster;

  const year = data.year ?? "";
  const runtime = typeof data.runtime === "number" && data.runtime > 0 ? `${data.runtime} min` : "";
  const genres = Array.isArray(data.genres) ? data.genres.map((g) => g.name).filter(Boolean) : [];

  const openTrailer = () => {
    if (!data.trailer || data.trailer.site !== "YouTube") return;
    window.open(`https://www.youtube.com/watch?v=${encodeURIComponent(data.trailer.key)}`, "_blank", "noopener,noreferrer");
  };

  const handleProgress = async (id: string, patch: Partial<LibraryItem>) => {
    const updated = await update(id, patch);
    setItems(updated);
  };

  const goBack = () => {
    navigate({ to: "/" });
  };

  return (
    <div className="min-h-screen">
      <Header onAdd={() => setShowAdd(true)} />

      <section className="relative overflow-hidden border-b border-border/40">
        <div className="relative h-[55vh] min-h-[420px]">
          {backdrop ? (
            <>
              <img src={backdrop} alt="" aria-hidden className="absolute inset-0 h-full w-full object-cover" />
              <div className="absolute inset-0" style={{ background: "var(--gradient-hero)" }} />
            </>
          ) : (
            <div className="absolute inset-0 bg-gradient-to-br from-secondary to-black" />
          )}

          <div className="container mx-auto h-full flex items-end px-6 pb-12 relative">
            <div className="max-w-3xl space-y-4 animate-fade-up">
              <button
                onClick={goBack}
                className="inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition"
              >
                <ArrowLeft className="h-4 w-4" />
                Voltar
              </button>

              <h1 className="font-display text-5xl md:text-7xl leading-none text-cream">{data.title}</h1>

              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                {year && <span>{year}</span>}
                {runtime && <span>{runtime}</span>}
                {genres.slice(0, 3).map((g) => (
                  <span key={g} className="rounded-full border border-border/50 bg-black/30 px-2 py-0.5">
                    {g}
                  </span>
                ))}
              </div>

              {data.overview && (
                <p className="text-base text-muted-foreground line-clamp-3 max-w-2xl">{data.overview}</p>
              )}

              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => inLibrary && setPlaying(inLibrary)}
                  disabled={!inLibrary}
                  className="inline-flex items-center gap-2 rounded-md bg-primary px-6 py-3 text-sm font-medium text-primary-foreground shadow-glow hover:brightness-110 transition disabled:opacity-50"
                >
                  <Play className="h-4 w-4 fill-current" />
                  {inLibrary?.progress && inLibrary?.duration ? "Continuar" : "Assistir"}
                </button>

                <button
                  onClick={() => setShowAdd(true)}
                  className="inline-flex items-center gap-2 rounded-md bg-secondary px-6 py-3 text-sm font-medium text-foreground hover:bg-secondary/80 transition"
                >
                  + Adicionar magnet
                </button>

                {data.trailer && data.trailer.site === "YouTube" && (
                  <button
                    onClick={openTrailer}
                    className="inline-flex items-center gap-2 rounded-md border border-border/60 bg-background/20 px-6 py-3 text-sm font-medium text-foreground hover:bg-background/30 transition"
                  >
                    <ExternalLink className="h-4 w-4" />
                    Trailer
                  </button>
                )}
              </div>

              {!inLibrary && (
                <div className="text-xs text-muted-foreground">
                  Para assistir aqui, adicione um magnet desse filme à sua biblioteca.
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      <main className="container mx-auto px-6 py-10 space-y-6">
        <div className="flex gap-1 bg-card/60 backdrop-blur border border-border/40 rounded-lg p-1 w-fit">
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
              <h2 className="font-display text-3xl text-cream">Sinopse</h2>
              <p className="text-sm text-muted-foreground leading-relaxed">
                {data.overview || "Sem descrição disponível."}
              </p>
            </div>
            <div className="space-y-3 rounded-xl bg-card/60 backdrop-blur border border-border/40 p-4">
              <div className="text-xs uppercase tracking-wider text-muted-foreground">Informações</div>
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
            <h2 className="font-display text-3xl text-cream">Elenco</h2>
            {data.cast.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sem elenco disponível.</p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
                {data.cast.map((c) => (
                  <div key={c.id} className="rounded-lg overflow-hidden bg-card/60 border border-border/40">
                    <div className="aspect-[2/3] bg-secondary">
                      {c.profile ? (
                        <img src={c.profile} alt={c.name} className="h-full w-full object-cover" loading="lazy" />
                      ) : (
                        <div className="h-full w-full bg-secondary" />
                      )}
                    </div>
                    <div className="p-2 space-y-0.5">
                      <div className="text-sm text-cream line-clamp-1">{c.name}</div>
                      {c.character && <div className="text-[11px] text-muted-foreground line-clamp-1">{c.character}</div>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === "similar" && (
          <div className="space-y-3">
            <h2 className="font-display text-3xl text-cream">Similares</h2>
            {data.recommendations.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhuma recomendação disponível.</p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
                {data.recommendations.map((r: TmdbSearchItem) => (
                  <Link
                    key={r.id}
                    to="/filme/$tmdbId"
                    params={{ tmdbId: String(r.id) }}
                    className="group rounded-lg overflow-hidden bg-card/60 border border-border/40 hover:border-primary/50 transition"
                  >
                    <div className="aspect-[2/3] bg-secondary">
                      {r.poster ? (
                        <img src={r.poster} alt={r.title} className="h-full w-full object-cover" loading="lazy" />
                      ) : (
                        <div className="h-full w-full bg-secondary" />
                      )}
                    </div>
                    <div className="p-2">
                      <div className="text-sm text-cream line-clamp-2 group-hover:text-primary transition">{r.title}</div>
                      {r.year && <div className="text-[11px] text-muted-foreground">{r.year}</div>}
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        )}
      </main>

      <AddMagnetDialog open={showAdd} onClose={() => setShowAdd(false)} onAdded={setItems} />
      {playing && <Player item={playing} onClose={() => setPlaying(null)} onProgress={handleProgress} />}
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
      className={`inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm transition ${
        active ? "bg-primary text-primary-foreground shadow-glow" : "text-muted-foreground hover:text-foreground hover:bg-secondary"
      }`}
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
