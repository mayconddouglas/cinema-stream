import { useState } from "react";
import { parseMagnet, upsert, type LibraryItem } from "@/lib/storage";

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
  const [description, setDescription] = useState("");
  const [year, setYear] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const handleMagnetChange = (v: string) => {
    setMagnet(v);
    const parsed = parseMagnet(v);
    if (parsed.name && !title) setTitle(parsed.name);
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
      description: description.trim() || undefined,
      year: year.trim() || undefined,
      addedAt: Date.now(),
    };
    const items = await upsert(item);
    onAdded(items);
    setMagnet("");
    setTitle("");
    setPoster("");
    setDescription("");
    setYear("");
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-scale-in"
      onClick={onClose}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        className="w-full max-w-lg rounded-xl bg-card border border-border shadow-card p-6 space-y-4"
      >
        <div>
          <h2 className="font-display text-3xl text-primary">Adicionar à biblioteca</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Cole um magnet link de conteúdo do qual você tem direito (vídeos próprios,
            domínio público, Creative Commons, screeners autorizados).
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
          <button
            type="submit"
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:brightness-110 transition"
          >
            Adicionar
          </button>
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
