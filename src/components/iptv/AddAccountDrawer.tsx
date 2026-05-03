import { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import {
  Drawer,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function AddAccountDrawer({
  open,
  onOpenChange,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (payload: {
    name: string;
    baseUrl: string;
    username: string;
    password: string;
  }) => Promise<void>;
}) {
  const [step, setStep] = useState<1 | 2>(1);
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const canStep1 = useMemo(() => baseUrl.trim().length > 4, [baseUrl]);
  const canSave = useMemo(
    () => baseUrl.trim().length > 4 && username.trim() && password.trim(),
    [baseUrl, username, password],
  );

  const close = () => {
    onOpenChange(false);
    setStep(1);
    setSaving(false);
    setName("");
    setBaseUrl("");
    setUsername("");
    setPassword("");
  };

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      await onSave({ name, baseUrl, username, password });
      close();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Drawer open={open} onOpenChange={(o) => (o ? onOpenChange(true) : close())}>
      <DrawerContent className="rounded-t-3xl border-border/40 bg-background/95 backdrop-blur-xl">
        <DrawerHeader className="text-left">
          <DrawerTitle className="font-display text-2xl tracking-wide">Adicionar conta</DrawerTitle>
        </DrawerHeader>
        <div className="px-4 pb-2 space-y-4">
          {step === 1 ? (
            <div className="space-y-3">
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Nome (opcional)</p>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ex: Minha IPTV"
                />
              </div>
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">URL base</p>
                <Input
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder="https://provedor.com:80"
                />
              </div>
              <div className="rounded-2xl border border-border/40 bg-white/5 px-4 py-3 text-xs text-muted-foreground leading-relaxed">
                Essa conta será importada (Ao vivo + Filmes) e ficará disponível em todos os
                dispositivos.
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Usuário</p>
                <Input
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Usuário"
                />
              </div>
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Senha</p>
                <Input
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Senha"
                  type="password"
                />
              </div>
            </div>
          )}
        </div>
        <DrawerFooter className="gap-2">
          {step === 1 ? (
            <Button
              onClick={() => setStep(2)}
              disabled={!canStep1}
              className="w-full h-12 rounded-2xl"
            >
              Continuar
            </Button>
          ) : (
            <>
              <Button
                onClick={handleSave}
                disabled={!canSave || saving}
                className="w-full h-12 rounded-2xl"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Salvar e sincronizar
              </Button>
              <Button
                variant="secondary"
                onClick={() => setStep(1)}
                disabled={saving}
                className="w-full h-12 rounded-2xl"
              >
                Voltar
              </Button>
            </>
          )}
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
