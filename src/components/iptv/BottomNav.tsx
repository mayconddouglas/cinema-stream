import { Film, Heart, Home, Search, Tv } from "lucide-react";
import { cn } from "@/lib/utils";

export type IptvNavKey = "home" | "live" | "vod" | "search" | "list";

export function BottomNav({
  active,
  onChange,
}: {
  active: IptvNavKey;
  onChange: (key: IptvNavKey) => void;
}) {
  const items: Array<{
    key: IptvNavKey;
    label: string;
    Icon: typeof Home;
  }> = [
    { key: "home", label: "Home", Icon: Home },
    { key: "live", label: "Ao vivo", Icon: Tv },
    { key: "vod", label: "Filmes", Icon: Film },
    { key: "search", label: "Buscar", Icon: Search },
    { key: "list", label: "Minha lista", Icon: Heart },
  ];

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 border-t border-border/40 bg-background/80 backdrop-blur-xl">
      <div className="mx-auto max-w-xl px-3 pb-[max(env(safe-area-inset-bottom),12px)] pt-2">
        <div className="grid grid-cols-5 gap-1">
          {items.map(({ key, label, Icon }) => {
            const isActive = key === active;
            return (
              <button
                key={key}
                onClick={() => onChange(key)}
                className={cn(
                  "flex flex-col items-center justify-center gap-1 rounded-xl px-2 py-2 transition active:scale-[0.98]",
                  isActive
                    ? "bg-primary/15 text-primary"
                    : "text-muted-foreground hover:text-foreground hover:bg-white/5",
                )}
              >
                <Icon className={cn("h-5 w-5", isActive ? "text-primary" : "")} />
                <span className="text-[10px] leading-none">{label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
