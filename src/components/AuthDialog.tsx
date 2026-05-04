import { useMemo, useState } from "react";
import { Loader2, Mail } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";

export function AuthDialog({
  open,
  onOpenChange,
  onAuthed,
  accessDenied,
  dismissAccessDenied,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAuthed: () => void;
  accessDenied?: boolean;
  dismissAccessDenied?: () => void;
}) {
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const disabled = useMemo(() => sending || !email.trim().includes("@"), [email, sending]);

  const sendMagicLink = async () => {
    if (!supabase) {
      setError("Supabase não configurado.");
      return;
    }
    setSending(true);
    setError(null);
    try {
      const redirectTo = `${window.location.origin}/`;
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: { emailRedirectTo: redirectTo },
      });
      if (error) throw error;
      setSent(true);
    } catch {
      setError("Não foi possível enviar o link. Tente novamente.");
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o && accessDenied && dismissAccessDenied) {
          dismissAccessDenied();
        } else {
          onOpenChange(o);
        }
        if (!o) {
          setError(null);
          setSending(false);
          setSent(false);
        }
      }}
    >
      <DialogContent
        className="rounded-3xl border-border/40 bg-background/95 backdrop-blur-xl"
        onInteractOutside={(e) => {
          if (accessDenied) e.preventDefault();
        }}
        onEscapeKeyDown={(e) => {
          if (accessDenied) e.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle className="font-display text-3xl tracking-wide">
            {accessDenied ? "Acesso não autorizado" : "Entrar"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {accessDenied ? (
            <div className="space-y-4">
              <div className="rounded-3xl border border-destructive/40 bg-destructive/10 p-4 space-y-2">
                <p className="text-sm text-foreground">
                  Seu email não está na lista de acesso aprovado. Entre em contato com o
                  administrador.
                </p>
              </div>
              <Button onClick={dismissAccessDenied} size="lg" className="w-full rounded-2xl h-12">
                Fechar
              </Button>
            </div>
          ) : !sent ? (
            <>
              <div className="rounded-3xl border border-border/40 bg-white/5 p-4 space-y-2">
                <p className="text-sm text-foreground">
                  Para abrir no VLC, faça login com seu email aprovado.
                </p>
                <p className="text-xs text-muted-foreground">
                  Você vai receber um link mágico para entrar sem senha.
                </p>
              </div>

              <div className="relative">
                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Seu email"
                  className="pl-11"
                  inputMode="email"
                  autoComplete="email"
                />
              </div>

              {error ? (
                <div className="rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                  {error}
                </div>
              ) : null}

              <Button
                onClick={() => void sendMagicLink()}
                disabled={disabled}
                size="lg"
                className="w-full rounded-2xl h-12"
              >
                {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Enviar link mágico
              </Button>
            </>
          ) : (
            <div className="space-y-3">
              <div className="rounded-3xl border border-border/40 bg-white/5 p-4 space-y-2">
                <p className="text-sm text-foreground">Link enviado!</p>
                <p className="text-xs text-muted-foreground">
                  Abra o email no mesmo dispositivo e toque no link para entrar.
                </p>
              </div>
              <Button onClick={onAuthed} size="lg" className="w-full rounded-2xl h-12">
                Já entrei
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
