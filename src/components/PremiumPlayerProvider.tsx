import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { LibraryItem } from "@/lib/storage";
import { Player } from "@/components/Player";
import { update } from "@/lib/storage";

type PremiumPlayerContextValue = {
  openPlayer: (
    item: LibraryItem,
    opts?: {
      fileIndex?: number;
      onProgress?: (
        id: string,
        patch: { progress?: number; duration?: number; lastPlayedAt?: number },
      ) => void | Promise<void>;
    },
  ) => void;
  closePlayer: () => void;
  minimizePlayer: () => void;
  expandPlayer: () => void;
  isOpen: boolean;
  isMinimized: boolean;
  item: LibraryItem | null;
};

const PremiumPlayerContext = createContext<PremiumPlayerContextValue | null>(null);

export function PremiumPlayerProvider({ children }: { children: React.ReactNode }) {
  const [item, setItem] = useState<LibraryItem | null>(null);
  const [fileIndex, setFileIndex] = useState<number | undefined>(undefined);
  const [minimized, setMinimized] = useState(false);
  const [progressHandler, setProgressHandler] = useState<
    | ((
        id: string,
        patch: { progress?: number; duration?: number; lastPlayedAt?: number },
      ) => void | Promise<void>)
    | null
  >(null);

  const openPlayer = useCallback(
    (
      item: LibraryItem,
      opts?: {
        fileIndex?: number;
        onProgress?: (
          id: string,
          patch: { progress?: number; duration?: number; lastPlayedAt?: number },
        ) => void | Promise<void>;
      },
    ) => {
      setItem(item);
      setFileIndex(typeof opts?.fileIndex === "number" ? opts.fileIndex : undefined);
      setProgressHandler(() => opts?.onProgress ?? null);
      setMinimized(false);
    },
    [],
  );

  const closePlayer = useCallback(() => {
    setItem(null);
    setFileIndex(undefined);
    setMinimized(false);
    setProgressHandler(null);
  }, []);

  const minimizePlayer = useCallback(() => setMinimized(true), []);
  const expandPlayer = useCallback(() => setMinimized(false), []);

  const value = useMemo(
    () => ({
      openPlayer,
      closePlayer,
      minimizePlayer,
      expandPlayer,
      isOpen: !!item,
      isMinimized: minimized,
      item,
    }),
    [openPlayer, closePlayer, minimizePlayer, expandPlayer, item, minimized],
  );

  return (
    <PremiumPlayerContext.Provider value={value}>
      {children}
      {item ? (
        <Player
          item={item}
          fileIndex={fileIndex}
          minimized={minimized}
          onMinimize={minimizePlayer}
          onExpand={expandPlayer}
          onClose={closePlayer}
          onProgress={async (id, patch) => {
            if (progressHandler) {
              await progressHandler(id, patch);
              return;
            }
            await update(id, patch);
          }}
        />
      ) : null}
    </PremiumPlayerContext.Provider>
  );
}

export function usePremiumPlayer() {
  const ctx = useContext(PremiumPlayerContext);
  if (!ctx) throw new Error("premium_player_context_missing");
  return ctx;
}
