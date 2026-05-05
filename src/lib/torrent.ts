export type MetaFile = {
  index: number;
  name: string;
  length: number;
  kind: string;
};

export type TorrentMeta = {
  bestVideoIndex: number | null;
  files: MetaFile[];
};

export type MetaResult =
  | { ok: true; meta: TorrentMeta }
  | {
      ok: false;
      retryable: boolean;
      suggestImportWithoutMeta: boolean;
      error: string;
    };

function abortSignalAny(signals: AbortSignal[]): AbortSignal {
  if (typeof AbortSignal.any === "function") return AbortSignal.any(signals);
  const ctrl = new AbortController();
  for (const s of signals) {
    if (s.aborted) {
      ctrl.abort();
      break;
    }
    s.addEventListener("abort", () => ctrl.abort(), { once: true });
  }
  return ctrl.signal;
}

export async function fetchMetaWithRetry(
  proxyBase: string,
  magnet: string,
  opts?: {
    maxAttempts?: number;
    onAttempt?: (attempt: number, max: number) => void;
    signal?: AbortSignal;
    timeoutMs?: number;
  },
): Promise<MetaResult> {
  const maxAttempts = opts?.maxAttempts ?? 3;
  const timeoutMs = opts?.timeoutMs ?? 40_000;
  const m = magnet.trim();

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (opts?.signal?.aborted) {
      return {
        ok: false,
        retryable: false,
        suggestImportWithoutMeta: false,
        error: "Cancelado.",
      };
    }

    opts?.onAttempt?.(attempt, maxAttempts);

    try {
      const ctrl = new AbortController();
      const timeout = setTimeout(() => ctrl.abort(), timeoutMs);

      const combinedSignal = opts?.signal
        ? abortSignalAny([ctrl.signal, opts.signal])
        : ctrl.signal;

      const res = await fetch(`${proxyBase}/meta?magnet=${encodeURIComponent(m)}`, {
        signal: combinedSignal,
      });
      clearTimeout(timeout);

      if (res.ok) {
        const meta = (await res.json()) as TorrentMeta;
        return { ok: true, meta };
      }

      let retryable = true;
      let suggestImportWithoutMeta = false;
      let errorMsg = `Proxy retornou ${res.status}.`;

      try {
        const body = (await res.json()) as {
          error?: string;
          retryable?: boolean;
          suggestImportWithoutMeta?: boolean;
          message?: string;
        };

        if (body.error === "metadata_timeout") {
          errorMsg = `Sem peers disponíveis (tentativa ${attempt}/${maxAttempts}).`;
          retryable = body.retryable ?? true;
          suggestImportWithoutMeta = body.suggestImportWithoutMeta ?? true;
        } else if (body.error === "invalid_magnet") {
          errorMsg = "Magnet inválido.";
          retryable = false;
        } else if (body.message) {
          errorMsg = body.message;
        }
      } catch {
        void 0;
      }

      if (!retryable || attempt === maxAttempts) {
        return { ok: false, retryable, suggestImportWithoutMeta, error: errorMsg };
      }

      await new Promise((resolve) => setTimeout(resolve, attempt * 2000));
    } catch (e) {
      const isAbort = e instanceof Error && e.name === "AbortError";
      if (isAbort || attempt === maxAttempts) {
        return {
          ok: false,
          retryable: !isAbort,
          suggestImportWithoutMeta: true,
          error: isAbort ? "Análise cancelada." : "Falha de conexão com o proxy.",
        };
      }
      await new Promise((resolve) => setTimeout(resolve, attempt * 2000));
    }
  }

  return {
    ok: false,
    retryable: false,
    suggestImportWithoutMeta: true,
    error: "Falha após todas as tentativas.",
  };
}
