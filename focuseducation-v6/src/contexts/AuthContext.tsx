import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

interface AuthContextType {
  session: Session | null;
  user: User | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  session: null,
  user: null,
  loading: true,
  signOut: async () => {},
});

export const useAuth = () => useContext(AuthContext);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Get the initial session first, THEN listen for changes.
    // This prevents a race condition where onAuthStateChange fires
    // with session=null before the persisted session is restored.
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        setSession(session);
        
        // Apply pending referral code after first sign-in
        if (session?.user && _event === "SIGNED_IN") {
          // Welcome email on first sign-in (new user)
          // FIX: use welcome_email_sent flag instead of fragile 60s check
          const welcomeSent = session.user.user_metadata?.welcome_email_sent;
          if (!welcomeSent) {
            try {
              const name = session.user.user_metadata?.full_name?.split(" ")[0] || "Studente";
              await supabase.functions.invoke("send-email", {
                body: { type: "welcome", to: session.user.email, name },
              });
              // Mark as sent to prevent duplicates
              await supabase.auth.updateUser({ data: { welcome_email_sent: true } });
            } catch (e) { console.error("Welcome email error:", e); }
          }

          const pendingCode = localStorage.getItem("pending_referral_code");
          if (pendingCode) {
            localStorage.removeItem("pending_referral_code");
            try {
              await supabase.functions.invoke("apply-referral", {
                body: { code: pendingCode },
              });
            } catch (e) {
              console.error("Failed to apply referral:", e);
            }
          }
        }
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  const signOut = async () => {
    // FIX: clean up localStorage before sign out to prevent data leaking between users
    const keysToRemove = Object.keys(localStorage).filter(k =>
      k.startsWith("study-plan-done-") ||
      k.startsWith("gen_dismissed") ||
      k === "pending_referral_code"
    );
    keysToRemove.forEach(k => localStorage.removeItem(k));
    sessionStorage.removeItem("gen_dismissed");
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider value={{ session, user: session?.user ?? null, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  );
};
