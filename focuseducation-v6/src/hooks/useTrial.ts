import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useSubscription } from "@/hooks/useSubscription";

export interface TrialInfo {
  isOnTrial:    boolean;
  daysLeft:     number;
  hoursLeft:    number;
  trialEndAt:   string | null;
  planName:     string;
  expired:      boolean;
}

export function useTrial(): TrialInfo {
  // FIX: tick every 60s so `expired` updates in real-time without a page refresh
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  const { subscription } = useSubscription();

  if (!subscription?.is_trial || !subscription.trial_end_at) {
    return { isOnTrial: false, daysLeft: 0, hoursLeft: 0, trialEndAt: null, planName: "", expired: false };
  }

  const now      = Date.now();
  const end      = new Date(subscription.trial_end_at).getTime();
  const diffMs   = end - now;
  const expired  = diffMs <= 0;
  const daysLeft = Math.max(0, Math.floor(diffMs / 86_400_000));
  const hoursLeft = Math.max(0, Math.floor((Math.max(0, diffMs) % 86_400_000) / 3_600_000));

  return {
    isOnTrial:  true,
    daysLeft,
    hoursLeft,
    trialEndAt: subscription.trial_end_at,
    planName:   subscription.plan_name,
    expired,
  };
}

/** Activate a 7-day trial via the SQL function */
export async function activateTrial(userId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("activate_trial", {
    _user_id:   userId,
    _plan_name: "Hyperfocus Master",
    _days:      7,
  });
  if (error) { console.error("[activateTrial]", error); return false; }
  return !!data;
}
