import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { AuthDialog } from "@/components/AuthDialog";
import { openVlcFromMagnet } from "@/lib/vlc";

type AuthContextValue = {
  user: User | null;
  session: Session | null;
  isAllowed: boolean;
  accessDenied: boolean;
  dismissAccessDenied: () => void;
  requireAuth: (action: () => void | Promise<void>) => void;
  openVlcWithAuth: (opts: {
    magnet: string;
    fileIndex?: number | null;
    startSeconds?: number;
  }) => void;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

type PendingAction = {
  id: string;
  run: () => void | Promise<void>;
};

type PendingStoredAction =
  | {
      type: "open_vlc";
      payload: { magnet: string; fileIndex?: number | null; startSeconds?: number };
    }
  | { type: "none" };

const PENDING_KEY = "acervos_pending_action_v1";

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [isAllowed, setIsAllowed] = useState(false);
  const [accessDenied, setAccessDenied] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [pending, setPending] = useState<PendingAction | null>(null);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session ?? null);
      setUser(data.session?.user ?? null);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
    });
    return () => {
      data.subscription.unsubscribe();
    };
  }, []);

  const checkAllow = useCallback(async (u: User | null) => {
    if (!supabase) return false;
    const email = typeof u?.email === "string" ? u.email : "";
    if (!email) return false;
    const { data, error } = await supabase
      .from("allowed_emails")
      .select("email")
      .eq("email", email)
      .maybeSingle();
    if (error) return false;
    return !!data?.email;
  }, []);

  useEffect(() => {
    if (!supabase) return;
    if (!user) {
      setIsAllowed(false);
      return;
    }
    checkAllow(user).then(async (ok) => {
      setIsAllowed(ok);
      if (!ok) {
        setAccessDenied(true);
        setAuthOpen(true);
        await supabase.auth.signOut();
      } else {
        setAccessDenied(false);
      }
    });
  }, [checkAllow, user]);

  const signOut = useCallback(async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
    setAuthOpen(false);
    setPending(null);
    setAccessDenied(false);
  }, []);

  const dismissAccessDenied = useCallback(() => {
    setAccessDenied(false);
    setAuthOpen(false);
  }, []);

  const tryRunPending = useCallback(async () => {
    if (!pending) return;
    if (!user || !isAllowed) return;
    const toRun = pending;
    setPending(null);
    setAuthOpen(false);
    await toRun.run();
  }, [isAllowed, pending, user]);

  useEffect(() => {
    void tryRunPending();
  }, [tryRunPending]);

  const requireAuth = useCallback(
    (action: () => void | Promise<void>) => {
      if (!supabase) {
        toast.error("Supabase não configurado.");
        return;
      }
      if (user && isAllowed) {
        void action();
        return;
      }
      setPending({ id: crypto.randomUUID(), run: action });
      setAuthOpen(true);
    },
    [isAllowed, user],
  );

  const openVlcWithAuth = useCallback(
    (opts: { magnet: string; fileIndex?: number | null; startSeconds?: number }) => {
      try {
        const stored: PendingStoredAction = { type: "open_vlc", payload: opts };
        localStorage.setItem(PENDING_KEY, JSON.stringify(stored));
      } catch {
        void 0;
      }
      requireAuth(async () => {
        try {
          localStorage.removeItem(PENDING_KEY);
        } catch {
          void 0;
        }
        await openVlcFromMagnet(opts);
      });
    },
    [requireAuth],
  );

  useEffect(() => {
    if (!user || !isAllowed) return;
    let raw = "";
    try {
      raw = localStorage.getItem(PENDING_KEY) ?? "";
    } catch {
      raw = "";
    }
    if (!raw) return;
    let parsed: PendingStoredAction | null = null;
    try {
      parsed = JSON.parse(raw) as PendingStoredAction;
    } catch {
      parsed = null;
    }
    if (!parsed || parsed.type !== "open_vlc") return;
    try {
      localStorage.removeItem(PENDING_KEY);
    } catch {
      void 0;
    }
    openVlcFromMagnet(parsed.payload).catch(() => toast.error("Não foi possível abrir no VLC."));
  }, [isAllowed, user]);

  const value = useMemo(
    () => ({
      user,
      session,
      isAllowed,
      accessDenied,
      dismissAccessDenied,
      requireAuth,
      openVlcWithAuth,
      signOut,
    }),
    [
      isAllowed,
      accessDenied,
      dismissAccessDenied,
      openVlcWithAuth,
      requireAuth,
      session,
      signOut,
      user,
    ],
  );

  return (
    <AuthContext.Provider value={value}>
      {children}
      <AuthDialog
        open={authOpen}
        onOpenChange={setAuthOpen}
        onAuthed={tryRunPending}
        accessDenied={accessDenied}
        dismissAccessDenied={dismissAccessDenied}
      />
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("auth_context_missing");
  return ctx;
}
