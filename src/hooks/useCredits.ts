import { useEffect, useState, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useSubscription } from "@/hooks/useSubscription";
import { requestEdgeFunction } from "@/lib/backendApi";
import type { Database } from "@/integrations/supabase/types";

export interface UserCredits {
  balance:          number;
  rollover_balance: number;
}

export const CREDIT_COSTS = {
  youtube:    15,
  mindmap:    10,
  quiz:       5,
  voice_notes:5,
  summary:    5,
  decompose:  2,
  tutor:      1,
} as const;

export const PLAN_CREDITS: Record<string, number> = {
  free:              15,
  focus_pro:         250,
  hyperfocus_master: 700,
};

type CreditRow    = Database["public"]["Tables"]["user_credits"]["Row"];
type CreditUpdate = Database["public"]["Tables"]["user_credits"]["Update"];
type TxInsert     = Database["public"]["Tables"]["credit_transactions"]["Insert"];

const getPlanKey = (planName?: string | null): string => {
  if (planName === "Focus Pro")        return "focus_pro";
  if (planName === "Hyperfocus Master") return "hyperfocus_master";
  return "free";
};

export const useCredits = () => {
  const { user }                              = useAuth();
  const { subscription, loading: subLoading } = useSubscription();
  const [credits, setCredits]                 = useState<UserCredits | null>(null);
  const [loading, setLoading]                 = useState(true);
  const lastPlanRef                           = useRef<string | undefined>(undefined);

  const fetchCredits = useCallback(async () => {
    if (!user) return;

    const planKey          = getPlanKey(subscription?.plan_name);
    const monthlyAllowance = PLAN_CREDITS[planKey] ?? PLAN_CREDITS.free;

    try {
      // Step 1: atomic server-side refill (uses FOR UPDATE lock — race-condition safe).
      // The SQL function checks the month and only refills once, even with 2 tabs open.
      const { error: rpcError } = await supabase.rpc("maybe_refill_credits", {
        _user_id: user.id,
      });
      if (rpcError) console.warn("[useCredits] refill RPC error:", rpcError);

      // Step 2: read the authoritative balance after the refill
      const { data, error } = await supabase
        .from("user_credits")
        .select("balance, rollover_balance, last_refill_at")
        .eq("user_id", user.id)
        .maybeSingle();

      if (error) throw error;

      if (data) {
        // Detect genuine plan upgrade mid-month (grant the credit difference)
        const prevPlanKey = lastPlanRef.current;
        if (prevPlanKey !== undefined && prevPlanKey !== planKey) {
          const prevAllowance = PLAN_CREDITS[prevPlanKey] ?? PLAN_CREDITS.free;
          if (monthlyAllowance > prevAllowance) {
            const bonus      = monthlyAllowance - prevAllowance;
            const newBalance = data.balance + bonus;

            await supabase
              .from("user_credits")
              .update({ balance: newBalance } satisfies CreditUpdate)
              .eq("user_id", user.id);

            await supabase.from("credit_transactions").insert({
              user_id:     user.id,
              amount:      bonus,
              action:      "plan_upgrade",
              description: `Upgrade a ${subscription?.plan_name}: +${bonus} NeuroCredits`,
            } satisfies TxInsert);

            setCredits({ balance: newBalance, rollover_balance: data.rollover_balance });
            lastPlanRef.current = planKey;
            setLoading(false);
            return;
          }
        }

        setCredits({ balance: data.balance, rollover_balance: data.rollover_balance });
        lastPlanRef.current = planKey;
      } else {
        // First-time user: use upsert to prevent duplicate key error if two tabs
        // mount simultaneously (race condition fix)
        await supabase.from("user_credits").upsert(
          { user_id: user.id, balance: monthlyAllowance, rollover_balance: 0 },
          { onConflict: "user_id", ignoreDuplicates: true }
        );
        setCredits({ balance: monthlyAllowance, rollover_balance: 0 });
        lastPlanRef.current = planKey;
      }
    } catch (err) {
      console.error("[useCredits] fetchCredits error:", err);
    } finally {
      setLoading(false);
    }
  }, [user, subscription]);

  useEffect(() => {
    if (subLoading) return;
    fetchCredits();
  }, [fetchCredits, subLoading]);

  const spendCredits = useCallback(
    async (action: keyof typeof CREDIT_COSTS): Promise<boolean> => {
      if (!user || !credits) return false;
      const cost           = CREDIT_COSTS[action];
      const totalAvailable = credits.balance + credits.rollover_balance;
      if (totalAvailable < cost) return false;

      try {
        const { data, status } = await requestEdgeFunction<{
          success?: boolean;
          error?: string;
          code?: string;
          balance?: number;
          rollover_balance?: number;
        }>("spend-credits", {
          action,
          cost,
          description: `Speso ${cost} NeuroCredits per ${action}`,
        }, 30_000);

        if (status >= 400) {
          if (data?.balance !== undefined) {
            setCredits({ balance: data.balance, rollover_balance: data.rollover_balance ?? 0 });
          }
          return false;
        }

        if (!data?.success) {
          if (data?.balance !== undefined) {
            setCredits({ balance: data.balance, rollover_balance: data.rollover_balance ?? 0 });
          }
          return false;
        }

        setCredits({ balance: data.balance, rollover_balance: data.rollover_balance });
        return true;
      } catch (e) {
        console.error("[useCredits] spendCredits failed:", e);
        return false;
      }
    },
    [user, credits],
  );

  /**
   * addCredits: routes through the add-credits Edge Function for server-side
   * validation. Direct client-side writes were a security vector.
   */
  const addCredits = useCallback(
    async (amount: number, action: string, description: string) => {
      if (!user) return;
      try {
        const { data } = await supabase.functions.invoke("add-credits", {
          body: { amount, action, description },
        });
        if (data?.balance !== undefined) {
          setCredits({ balance: data.balance, rollover_balance: data.rollover_balance ?? 0 });
        }
      } catch (e) {
        console.error("[useCredits] addCredits failed:", e);
      }
    },
    [user],
  );

  const totalCredits = credits ? credits.balance + credits.rollover_balance : 0;
  const hasRollover  = subscription?.plan_name === "Focus Pro" || subscription?.plan_name === "Hyperfocus Master";

  return {
    credits,
    totalCredits,
    loading,
    spendCredits,
    addCredits,
    refreshCredits: fetchCredits,
    hasRollover,
  };
};
