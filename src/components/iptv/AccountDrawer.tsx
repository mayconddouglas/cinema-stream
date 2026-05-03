import { Check, Plus } from "lucide-react";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";

export type IptvAccount = {
  id: number;
  name: string;
  baseUrl: string;
  username: string;
  isActive: boolean;
};

export function AccountDrawer({
  open,
  onOpenChange,
  accounts,
  onActivate,
  onAdd,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accounts: IptvAccount[];
  onActivate: (id: number) => void;
  onAdd: () => void;
}) {
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="rounded-t-3xl border-border/40 bg-background/95 backdrop-blur-xl">
        <DrawerHeader className="text-left">
          <DrawerTitle className="font-display text-2xl tracking-wide">Contas IPTV</DrawerTitle>
        </DrawerHeader>
        <div className="px-4 pb-4 space-y-3">
          <div className="space-y-2">
            {accounts.map((acc) => (
              <button
                key={acc.id}
                onClick={() => onActivate(acc.id)}
                className="w-full rounded-2xl border border-border/40 bg-white/5 px-4 py-3 text-left hover:bg-white/10 transition"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm text-foreground truncate">{acc.name}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {acc.username} • {acc.baseUrl}
                    </p>
                  </div>
                  {acc.isActive ? (
                    <div className="shrink-0 inline-flex items-center gap-1 rounded-full bg-primary/15 px-3 py-1 text-xs text-primary">
                      <Check className="h-3.5 w-3.5" />
                      Ativa
                    </div>
                  ) : null}
                </div>
              </button>
            ))}
            {accounts.length === 0 ? (
              <div className="rounded-2xl border border-border/40 bg-white/5 px-4 py-4 text-sm text-muted-foreground">
                Nenhuma conta cadastrada.
              </div>
            ) : null}
          </div>
          <Button onClick={onAdd} className="w-full h-12 rounded-2xl">
            <Plus className="h-4 w-4" />
            Adicionar conta
          </Button>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
