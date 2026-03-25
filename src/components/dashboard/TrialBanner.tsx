import { motion, AnimatePresence } from "framer-motion";
import { Crown, ArrowRight, X, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { useTrial } from "@/hooks/useTrial";
import { useState, useEffect } from "react";

const DISMISSED_KEY = "trial_banner_dismissed_until";

export default function TrialBanner() {
  const trial                         = useTrial();
  const [dismissed, setDismissed]     = useState(false);

  // Persist dismissal in localStorage — expires after 24h so urgent banner reappears
  useEffect(() => {
    const until = localStorage.getItem(DISMISSED_KEY);
    if (until && Date.now() < Number(until)) setDismissed(true);
  }, []);

  const dismiss = () => {
    // Urgent (last day) banner cannot be permanently dismissed
    if (trial.daysLeft !== null && trial.daysLeft <= 1) return;
    // Regular dismiss: hide for 24h
    localStorage.setItem(DISMISSED_KEY, String(Date.now() + 24 * 3_600_000));
    setDismissed(true);
  };

  // Re-show if trial becomes urgent even if previously dismissed
  const isUrgent = trial.daysLeft !== null && trial.daysLeft <= 1;
  const visible  = trial.isOnTrial && (!dismissed || isUrgent);

  if (!visible) return null;

  const label = trial.daysLeft === 0
    ? `${trial.hoursLeft}h rimaste`
    : trial.daysLeft === 1
    ? "Ultimo giorno!"
    : `${trial.daysLeft} giorni rimasti`;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, height: 0 }}
        className={`rounded-xl border p-3 flex items-center gap-3 mb-4 ${
          isUrgent
            ? "bg-destructive/5 border-destructive/30"
            : "bg-primary/5 border-primary/30"
        }`}
      >
        <Crown className={`h-5 w-5 shrink-0 ${isUrgent ? "text-destructive" : "text-primary"}`} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-card-foreground flex items-center gap-2 flex-wrap">
            Trial {trial.planName}
            <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
              isUrgent ? "bg-destructive/15 text-destructive" : "bg-primary/15 text-primary"
            }`}>
              <Clock className="h-3 w-3 inline mr-0.5" />{label}
            </span>
          </p>
          <p className="text-xs text-muted-foreground">
            {isUrgent
              ? "Il tuo trial sta per scadere — abbonati per non perdere i progressi"
              : "Stai usando tutte le funzionalità premium gratuitamente"}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button size="sm" asChild className={isUrgent ? "bg-destructive hover:bg-destructive/90" : ""}>
            <Link to="/pricing">
              Abbonati <ArrowRight className="h-3.5 w-3.5 ml-1" />
            </Link>
          </Button>
          {!isUrgent && (
            <button onClick={dismiss} className="text-muted-foreground hover:text-foreground p-1">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
