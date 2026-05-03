import { useMemo, useState } from "react";
import { Film, Loader2, Plus } from "lucide-react";
import { parseMagnet, upsert, type LibraryItem } from "@/lib/storage";
import { tmdbMovie, tmdbSearch, type TmdbSearchItem } from "@/lib/tmdb";

type DetectedFile = {
  index: number;
  name: string;
  length: number;
  cleanTitle: string;
  tmdbResult: TmdbSearchItem | null;
  tmdbLoading: boolean;
  customTitle: string;
  poster: string;
  backdrop: string;
  year: string;
  description: string;
  tmdbId: number | null;
};

function getProxyBase(): string {
  const env = (import.meta as unknown as { env?: { VITE_TORRENT_PROXY_URL?: string } }).env;
  const raw = env?.VITE_TORRENT_PROXY_URL;
  return typeof raw === "string" ? raw.trim().replace(/\/+$/, "") : "";
}

function cleanTitleFromFilename(filename: string): string {
  let name = filename;
  name = name.replace(/\.[^.]+$/, "");
  name = name.replace(
    /\b(1080p|720p|480p|4k|2160p|bluray|bdrip|brrip|webrip|web-dl|webdl|hdtv|dvdrip|xvid|x264|x265|hevc|avc|aac|mp3|ac3|dts|hdr|sdr|remux|proper|repack|extended|theatrical|directors\.cut|unrated|www\.[^\s]+)\b/gi,
    "",
  );
  name = name.replace(/[[(](19|20)\d{2}[)\]]/g, "");
  name = name
    .replace(/[._-]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
  return name.replace(/\b\w/g, (c) => c.toUpperCase()).trim();
}

export function AddMagnetDialog({
  open,
  onClose,
  onAdded,
}: {
  open: boolean;
  onClose: () => void;
  onAdded: (items: LibraryItem[]) => void;
}) {
  const [magnet, setMagnet] = useState("");
  const [title, setTitle] = useState("");
  const [poster, setPoster] = useState("");
  const [backdrop, setBackdrop] = useState("");
  const [description, setDescription] = useState("");
  const [year, setYear] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [imdbId, setImdbId] = useState("");
  const [tmdbResults, setTmdbResults] = useState<TmdbSearchItem[]>([]);
  const [tmdbLoading, setTmdbLoading] = useState(false);
  const [tmdbSelectedId, setTmdbSelectedId] = useState<number | null>(null);
  const [probeLoading, setProbeLoading] = useState(false);
  const [detectedFiles, setDetectedFiles] = useState<DetectedFile[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<Set<number>>(new Set());
  const [mode, setMode] = useState<"single" | "pack">("single");
  const [packImporting, setPackImporting] = useState(false);

  const parsedMagnet = useMemo(() => parseMagnet(magnet), [magnet]);

  if (!open) return null;

  const VIDEO_FILE_RE = /\.(mp4|webm|mkv|m4v|mov|avi|ogv|ogg|ts|m2ts|mpg|mpeg|wmv|flv)$/i;

  const searchTmdbForFile = async (query: string, fileArrayIndex: number) => {
    setDetectedFiles((prev) =>
      prev.map((f, i) => (i === fileArrayIndex ? { ...f, tmdbLoading: true } : f)),
    );

    try {
      const results = await tmdbSearch(query, undefined, "pt-BR");
      const best = results[0] ?? null;

      if (best) {
        try {
          const details = await tmdbMovie(best.id, "pt-BR");
          setDetectedFiles((prev) =>
            prev.map((f, i) =>
              i === fileArrayIndex
                ? {
                    ...f,
                    tmdbResult: best,
                    tmdbLoading: false,
                    customTitle: details.title || f.cleanTitle,
                    poster: details.poster || "",
                    backdrop: details.backdrop || "",
                    year: details.year || "",
                    description: details.overview || "",
                    tmdbId: details.id ?? null,
                  }
                : f,
            ),
          );
        } catch {
          setDetectedFiles((prev) =>
            prev.map((f, i) =>
              i === fileArrayIndex ? { ...f, tmdbResult: best, tmdbLoading: false } : f,
            ),
          );
        }
      } else {
        setDetectedFiles((prev) =>
          prev.map((f, i) => (i === fileArrayIndex ? { ...f, tmdbLoading: false } : f)),
        );
      }
    } catch {
      setDetectedFiles((prev) =>
        prev.map((f, i) => (i === fileArrayIndex ? { ...f, tmdbLoading: false } : f)),
      );
    }
  };

  const probeAndDetect = async (magnetValue: string) => {
    const base = getProxyBase();
    if (!base) {
      setError("Proxy não configurado. Verifique VITE_TORRENT_PROXY_URL na Vercel.");
      return;
    }
    if (!magnetValue.trim().startsWith("magnet:?")) return;

    setProbeLoading(true);
    setDetectedFiles([]);
    setSelectedFiles(new Set());
    setMode("single");
    setError(null);

    try {
      const ctrl = new AbortController();
      const timeout = setTimeout(() => ctrl.abort(), 35_000);
      const res = await fetch(`${base}/meta?magnet=${encodeURIComponent(magnetValue.trim())}`, {
        signal: ctrl.signal,
      });
      clearTimeout(timeout);

      if (!res.ok) {
        try {
          const body = (await res.json()) as { error?: unknown };
          const code = typeof body?.error === "string" ? body.error : "";
          if (code === "metadata_timeout") {
            setError(
              "Não foi possível ler os arquivos do torrent (sem peers). Tente novamente em alguns segundos.",
            );
          } else if (code === "invalid_magnet") {
            setError("Magnet inválido.");
          } else {
            setError(`Falha ao analisar o torrent (proxy retornou ${res.status}).`);
          }
        } catch {
          setError(`Falha ao analisar o torrent (proxy retornou ${res.status}).`);
        }
        return;
      }

      const meta = (await res.json()) as {
        bestVideoIndex?: number | null;
        files?: { index: number; name: string; length: number; kind: string }[];
      };

      const videoFiles = (meta.files ?? [])
        .filter(
          (f) =>
            typeof f.name === "string" &&
            (f.kind === "video" || VIDEO_FILE_RE.test(String(f.name))),
        )
        .map((f) => {
          const cleanTitle = cleanTitleFromFilename(String(f.name));
          return {
            index: Number(f.index),
            name: String(f.name),
            length: Number(f.length) || 0,
            cleanTitle,
            tmdbResult: null,
            tmdbLoading: false,
            customTitle: cleanTitle,
            poster: "",
            backdrop: "",
            year: "",
            description: "",
            tmdbId: null,
          } satisfies DetectedFile;
        });

      if (videoFiles.length <= 1) {
        setMode("single");
        setDetectedFiles([]);
        return;
      }

      setMode("pack");
      setDetectedFiles(videoFiles);
      setSelectedFiles(new Set(videoFiles.map((f) => f.index)));

      videoFiles.forEach((file, i) => {
        void searchTmdbForFile(file.cleanTitle, i);
      });
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") {
        setError("Análise do torrent demorou demais. Tente novamente.");
      }
    } finally {
      setProbeLoading(false);
    }
  };

  const handleMagnetChange = (v: string) => {
    setMagnet(v);
    setMode("single");
    setDetectedFiles([]);
    setSelectedFiles(new Set());
    const parsed = parseMagnet(v);
    if (parsed.name && !title) setTitle(parsed.name);
    if (v.trim().startsWith("magnet:?")) {
      clearTimeout((handleMagnetChange as { _t?: ReturnType<typeof setTimeout> })._t);
      (handleMagnetChange as { _t?: ReturnType<typeof setTimeout> })._t = setTimeout(() => {
        void probeAndDetect(v);
      }, 800);
    }
  };

  const searchOnTmdb = async () => {
    setError(null);
    setTmdbResults([]);
    setTmdbSelectedId(null);
    const q = title.trim() || parsedMagnet.name || "";
    if (!q) return;

    setTmdbLoading(true);
    try {
      const results = await tmdbSearch(q, year.trim() || undefined, "pt-BR");
      setTmdbResults(results);
      if (results.length === 0) setError("Nenhum resultado encontrado no TMDB.");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Falha ao buscar no TMDB.";
      if (msg === "tmdb_not_configured") {
        setError("TMDB não configurado no servidor. Configure TMDB_API_KEY na Railway (proxy).");
      } else if (msg === "proxy_not_configured") {
        setError("Proxy não configurado. Verifique VITE_TORRENT_PROXY_URL na Vercel.");
      } else {
        setError("Falha ao buscar no TMDB.");
      }
    } finally {
      setTmdbLoading(false);
    }
  };

  const applyTmdb = async (id: number) => {
    setError(null);
    setTmdbSelectedId(id);
    try {
      const details = await tmdbMovie(id, "pt-BR");
      if (details.title) setTitle(details.title);
      if (details.year) setYear(details.year);
      if (details.overview) setDescription(details.overview);
      if (details.poster) setPoster(details.poster);
      if (details.backdrop) setBackdrop(details.backdrop);
      if (details.imdbId) setImdbId(details.imdbId);
    } catch {
      setError("Falha ao carregar detalhes do TMDB.");
    }
  };

  const submitPack = async () => {
    const toImport = detectedFiles.filter((f) => selectedFiles.has(f.index));
    if (toImport.length === 0) return;

    const parsed = parseMagnet(magnet);
    if (!parsed.infoHash) {
      setError("Magnet inválido.");
      return;
    }

    setPackImporting(true);
    setError(null);

    try {
      let allItems: LibraryItem[] = [];

      for (const file of toImport) {
        const itemId = `${parsed.infoHash}-f${file.index}`;
        const item: LibraryItem = {
          id: itemId,
          title: file.customTitle || file.cleanTitle,
          magnet: magnet.trim(),
          fileIndex: file.index,
          poster: file.poster || undefined,
          backdrop: file.backdrop || undefined,
          description: file.description || undefined,
          year: file.year || undefined,
          tmdbId: file.tmdbId ?? undefined,
          addedAt: Date.now(),
        };
        allItems = await upsert(item);
      }

      onAdded(allItems);
      setMagnet("");
      setTitle("");
      setPoster("");
      setBackdrop("");
      setImdbId("");
      setDescription("");
      setYear("");
      setTmdbResults([]);
      setTmdbSelectedId(null);
      setDetectedFiles([]);
      setSelectedFiles(new Set());
      setMode("single");
      onClose();
    } catch {
      setError("Falha ao salvar os filmes. Tente novamente.");
    } finally {
      setPackImporting(false);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const parsed = parseMagnet(magnet);
    if (!parsed.infoHash) {
      setError("Magnet link inválido. Cole um link no formato magnet:?xt=urn:btih:...");
      return;
    }
    const finalTitle = title.trim() || parsed.name || "Sem título";
    const item: LibraryItem = {
      id: parsed.infoHash,
      title: finalTitle,
      magnet,
      poster: poster.trim() || undefined,
      backdrop: backdrop.trim() || undefined,
      description: description.trim() || undefined,
      year: year.trim() || undefined,
      tmdbId: tmdbSelectedId ?? undefined,
      imdbId: imdbId.trim() || undefined,
      addedAt: Date.now(),
    };
    const items = await upsert(item);
    onAdded(items);
    setMagnet("");
    setTitle("");
    setPoster("");
    setBackdrop("");
    setImdbId("");
    setDescription("");
    setYear("");
    setTmdbResults([]);
    setTmdbSelectedId(null);
    onClose();
  };

  const handleSubmit = (e: React.FormEvent) => {
    if (mode !== "single") {
      e.preventDefault();
      return;
    }
    void submit(e);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-scale-in"
      onClick={onClose}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
        className="w-full max-w-lg rounded-xl bg-card border border-border shadow-card p-6 space-y-4"
      >
        <div>
          <h2 className="font-display text-3xl text-primary">Adicionar à biblioteca</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Cole um magnet link de conteúdo do qual você tem direito (vídeos próprios, domínio
            público, Creative Commons, screeners autorizados).
          </p>
        </div>

        <Field label="Magnet link *">
          <textarea
            required
            rows={3}
            value={magnet}
            onChange={(e) => handleMagnetChange(e.target.value)}
            placeholder="magnet:?xt=urn:btih:..."
            className="w-full rounded-md bg-input border border-border px-3 py-2 text-sm font-mono text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-ring resize-none"
          />
        </Field>

        {probeLoading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
            Analisando torrent...
          </div>
        )}

        {mode === "pack" && detectedFiles.length > 0 && (
          <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="space-y-0.5">
                <p className="text-sm font-medium text-foreground">
                  {detectedFiles.length} filmes detectados neste torrent
                </p>
                <p className="text-xs text-muted-foreground">
                  Selecione quais deseja adicionar à biblioteca
                </p>
              </div>
              <div className="flex gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => setSelectedFiles(new Set(detectedFiles.map((f) => f.index)))}
                  className="text-xs text-primary hover:underline"
                >
                  Todos
                </button>
                <span className="text-muted-foreground text-xs">·</span>
                <button
                  type="button"
                  onClick={() => setSelectedFiles(new Set())}
                  className="text-xs text-muted-foreground hover:underline"
                >
                  Nenhum
                </button>
              </div>
            </div>

            <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
              {detectedFiles.map((file, i) => (
                <div
                  key={file.index}
                  onClick={() => {
                    setSelectedFiles((prev) => {
                      const next = new Set(prev);
                      if (next.has(file.index)) next.delete(file.index);
                      else next.add(file.index);
                      return next;
                    });
                  }}
                  className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 cursor-pointer transition select-none ${
                    selectedFiles.has(file.index)
                      ? "border-primary bg-primary/10"
                      : "border-border/40 bg-background/40 hover:bg-background/60"
                  }`}
                >
                  <div
                    className={`h-4 w-4 shrink-0 rounded border-2 flex items-center justify-center transition ${
                      selectedFiles.has(file.index)
                        ? "bg-primary border-primary"
                        : "border-muted-foreground/40"
                    }`}
                  >
                    {selectedFiles.has(file.index) && (
                      <svg viewBox="0 0 10 8" className="h-2.5 w-2.5 fill-primary-foreground">
                        <path
                          d="M1 4l3 3 5-6"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          fill="none"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    )}
                  </div>

                  <div className="h-12 w-9 shrink-0 rounded overflow-hidden bg-secondary">
                    {file.tmdbLoading ? (
                      <div className="h-full w-full flex items-center justify-center">
                        <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                      </div>
                    ) : file.poster ? (
                      <img src={file.poster} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <div className="h-full w-full bg-secondary flex items-center justify-center">
                        <Film className="h-4 w-4 text-muted-foreground/30" />
                      </div>
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    {file.tmdbLoading ? (
                      <div className="space-y-1.5">
                        <div className="h-3 w-3/4 bg-muted-foreground/20 rounded animate-pulse" />
                        <div className="h-2.5 w-1/3 bg-muted-foreground/10 rounded animate-pulse" />
                      </div>
                    ) : (
                      <>
                        <p className="text-sm font-medium text-foreground line-clamp-1">
                          {file.customTitle || file.cleanTitle}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {file.year && <span>{file.year} · </span>}
                          {(file.length / (1024 * 1024 * 1024)).toFixed(1)} GB
                        </p>
                      </>
                    )}
                  </div>

                  {selectedFiles.has(file.index) && !file.tmdbLoading && (
                    <input
                      value={file.customTitle}
                      onChange={(e) => {
                        e.stopPropagation();
                        const val = e.target.value;
                        setDetectedFiles((prev) =>
                          prev.map((f, idx) => (idx === i ? { ...f, customTitle: val } : f)),
                        );
                      }}
                      onClick={(e) => e.stopPropagation()}
                      placeholder="Título personalizado"
                      className="w-28 rounded-md bg-background/60 border border-border/40 px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring shrink-0"
                    />
                  )}
                </div>
              ))}
            </div>

            <button
              type="button"
              onClick={() => void submitPack()}
              disabled={packImporting || selectedFiles.size === 0}
              className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-primary py-3 text-sm font-medium text-primary-foreground hover:brightness-110 transition disabled:opacity-50 min-h-[48px]"
            >
              {packImporting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
              Adicionar{" "}
              {selectedFiles.size > 0
                ? `${selectedFiles.size} filme${selectedFiles.size > 1 ? "s" : ""}`
                : ""}{" "}
              à biblioteca
            </button>
          </div>
        )}

        {mode === "single" && (
          <>
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <Field label="Título">
                  <input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className="w-full rounded-md bg-input border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </Field>
              </div>
              <Field label="Ano">
                <input
                  value={year}
                  onChange={(e) => setYear(e.target.value)}
                  placeholder="2024"
                  className="w-full rounded-md bg-input border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </Field>
            </div>

            <div className="rounded-lg border border-border/40 bg-secondary/30 p-3 space-y-2">
              <div className="flex items-center justify-between gap-3">
                <div className="text-xs uppercase tracking-wider text-muted-foreground">
                  Buscar no TMDB
                </div>
                <button
                  type="button"
                  onClick={searchOnTmdb}
                  disabled={tmdbLoading || !(title.trim() || parsedMagnet.name)}
                  className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:brightness-110 transition disabled:opacity-50"
                >
                  {tmdbLoading ? "Buscando..." : "Buscar"}
                </button>
              </div>

              {tmdbResults.length > 0 && (
                <div className="grid gap-2 max-h-56 overflow-auto">
                  {tmdbResults.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => applyTmdb(r.id)}
                      className={`flex items-start gap-3 rounded-md border px-3 py-2 text-left transition ${
                        tmdbSelectedId === r.id
                          ? "border-primary bg-primary/10"
                          : "border-border/40 bg-background/40 hover:bg-background/60"
                      }`}
                    >
                      <div className="h-14 w-10 shrink-0 rounded bg-secondary overflow-hidden">
                        {r.poster ? (
                          <img src={r.poster} alt="" className="h-full w-full object-cover" />
                        ) : (
                          <div className="h-full w-full bg-secondary" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-foreground line-clamp-1">
                          {r.title}{" "}
                          {r.year ? (
                            <span className="text-muted-foreground">({r.year})</span>
                          ) : null}
                        </div>
                        {r.overview && (
                          <div className="text-xs text-muted-foreground line-clamp-2">
                            {r.overview}
                          </div>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <Field label="URL do poster (opcional)">
              <input
                value={poster}
                onChange={(e) => setPoster(e.target.value)}
                placeholder="https://..."
                className="w-full rounded-md bg-input border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </Field>

            <Field label="Descrição (opcional)">
              <textarea
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full rounded-md bg-input border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-none"
              />
            </Field>
          </>
        )}

        {error && (
          <p className="text-sm text-destructive bg-destructive/10 rounded px-3 py-2">{error}</p>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-4 py-2 text-sm hover:bg-secondary transition"
          >
            Cancelar
          </button>
          {mode === "single" && (
            <button
              type="submit"
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:brightness-110 transition"
            >
              Adicionar
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs uppercase tracking-wider text-muted-foreground mb-1.5 block">
        {label}
      </span>
      {children}
    </label>
  );
}
