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

const ACTIVE_SUBSCRIPTION_STATUSES = ["active", "trialing", "ACTIVE", "TRIALING"];

const normalizePlanName = (planName?: string | null) => {
  const normalized = planName?.trim().toLowerCase().replace(/[_-]+/g, " ");
  if (normalized === "hyperfocus master" || normalized === "hyperfocus") return "Hyperfocus Master";
  if (normalized === "focus pro" || normalized === "pro") return "Focus Pro";
  if (normalized === "free") return "Free";
  return planName?.trim() || null;
};

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
      const { data, error } = await supabase
        .from("subscriptions")
        .select("id, plan_name, status, current_period_end, trial_end_at, is_trial")
        .eq("user_id", user.id)
        .in("status", ACTIVE_SUBSCRIPTION_STATUSES)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        console.error("[useSubscription] fetch error:", error);
        setSubscription(null);
      } else {
        setSubscription(data ? { ...data, plan_name: normalizePlanName(data.plan_name) || data.plan_name } : null);
      }
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
          if (updated && ACTIVE_SUBSCRIPTION_STATUSES.includes(updated.status)) {
            setSubscription({ ...updated, plan_name: normalizePlanName(updated.plan_name) || updated.plan_name });
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
