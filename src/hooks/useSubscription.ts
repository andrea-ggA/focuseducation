import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export interface Subscription {
  id:                  string;
  plan_name:           string;
  status:              string;
  current_period_end:  string | null;
  trial_end_at?:       string | null;
  is_trial?:           boolean;
}

export const useSubscription = () => {
  const { user } = useAuth();
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [loading, setLoading]           = useState(true);

  useEffect(() => {
    if (!user) {
      setSubscription(null);
      setLoading(false);
      return;
    }

    // Initial fetch
    const fetchSub = async () => {
      const { data } = await supabase
        .from("subscriptions")
        .select("id, plan_name, status, current_period_end, trial_end_at, is_trial")
        .eq("user_id", user.id)
        // FIX: accetta sia lowercase (nuovo standard) che uppercase (vecchi record PayPal)
        .in("status", ["active", "trialing", "ACTIVE", "TRIALING"])
        .maybeSingle();
      setSubscription(data);
      setLoading(false);
    };

    fetchSub();

    // Realtime: picks up PayPal webhook updates without requiring a page refresh
    const channel = supabase
      .channel(`subscriptions:${user.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "subscriptions", filter: `user_id=eq.${user.id}` },
        (payload) => {
          const updated = payload.new as Subscription | undefined;
          if (updated && ["active", "trialing", "ACTIVE", "TRIALING"].includes(updated.status)) {
            setSubscription(updated);
          } else {
            setSubscription(null);
          }
        },
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [user]);

  const isHyperfocus = subscription?.plan_name === "Hyperfocus Master";
  const isPro        = subscription?.plan_name === "Focus Pro" || isHyperfocus;

  return {
    subscription,
    loading,
    isTrial:             subscription?.is_trial === true,
    isPro,
    hasSubscription:     !!subscription,
    isHyperfocus,
    canUseFlashcards:    true,
    canUseMindMaps:      isPro,
    canExportPdf:        isPro,
    canUseGamifiedQuiz:  isHyperfocus,
    canUseAdhdCoaching:  isHyperfocus,
    canUseBoostXp:       isHyperfocus,
    canUseSummaries:     isHyperfocus,
    canUseYouTubeImport: isPro,
  };
};
