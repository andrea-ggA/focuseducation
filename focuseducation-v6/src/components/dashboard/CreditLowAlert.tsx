/**
 * CreditLowAlert — notifica contestuale quando i crediti scendono sotto
 * una soglia (default: 20% del piano attuale).
 *
 * Appare inline nella Dashboard, non come toast (meno invasivo).
 * Dismissibile per 24h. Su mobile mostra solo l'essenziale.
 *
 * Impatto revenue: intercetta l'utente nel momento di massima
 * consapevolezza del valore (sta per rimanere senza crediti).
 */
import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Zap, X, ArrowRight, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { useCredits, PLAN_CREDITS } from "@/hooks/useCredits";
import { useSubscription } from "@/hooks/useSubscription";

const DISMISS_KEY = "credit_alert_dismissed_until";
const ALERT_THRESHOLD_PCT = 0.20; // alert at 20% remaining

export default function CreditLowAlert() {
  const { totalCredits, loading: creditsLoading } = useCredits();
  const { subscription, isPro, loading: subLoading } = useSubscription();
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const until = localStorage.getItem(DISMISS_KEY);
    if (until && Date.now() < Number(until)) setDismissed(true);
  }, []);

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, String(Date.now() + 24 * 3_600_000));
    setDismissed(true);
  };

  if (creditsLoading || subLoading || dismissed) return null;

  // Calculate plan allowance
  const planKey = subscription?.plan_name === "Focus Pro" ? "focus_pro"
                : subscription?.plan_name === "Hyperfocus Master" ? "hyperfocus_master"
                : "free";
  const planAllowance = PLAN_CREDITS[planKey] ?? PLAN_CREDITS.free;
  const threshold = Math.ceil(planAllowance * ALERT_THRESHOLD_PCT);

  if (totalCredits > threshold) return null;

  // Don't show for Hyperfocus Master (already on top plan)
  if (planKey === "hyperfocus_master") return null;

  const nextPlan = planKey === "free" ? { name: "Focus Pro", price: "8,99", credits: 250 }
                                      : { name: "Hyperfocus Master", price: "14,99", credits: 700 };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -6 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -6 }}
        className="rounded-xl border border-orange-400/30 bg-orange-400/5 p-3 flex items-center gap-3"
      >
        <div className="h-8 w-8 rounded-lg bg-orange-400/15 flex items-center justify-center shrink-0">
          <Zap className="h-4 w-4 text-orange-500" />
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-card-foreground">
            Solo <span className="text-orange-500">{totalCredits} NeuroCredits</span> rimasti
          </p>
          <p className="text-xs text-muted-foreground hidden sm:block">
            {nextPlan.name}: {nextPlan.credits} cr/mese · €{nextPlan.price}/mese
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Button
            size="sm"
            className="bg-orange-500 hover:bg-orange-600 text-white gap-1 h-8 text-xs font-semibold"
            asChild
          >
            <Link to="/pricing">
              <Sparkles className="h-3 w-3" />
              <span className="hidden sm:inline">Ricarica</span>
              <ArrowRight className="h-3 w-3" />
            </Link>
          </Button>
          <button onClick={dismiss} className="text-muted-foreground hover:text-foreground p-1">
            <X className="h-4 w-4" />
          </button>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
