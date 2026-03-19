/**
 * CrisisSuggestBanner — compare automaticamente quando:
 * - L'utente ha impostato una data esame in profilo
 * - L'esame è tra ≤ 48 ore
 * - CrisisMode non è già aperto
 *
 * Dismissibile per la giornata (localStorage).
 * Mobile-first: full-width, testo breve, CTA grande.
 */
import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Flame, X, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useExamCountdown } from "@/hooks/useExamCountdown";

const DISMISS_KEY = "crisis_banner_dismissed_until";

interface CrisisSuggestBannerProps {
  onActivate: () => void; // opens CrisisMode
}

export default function CrisisSuggestBanner({ onActivate }: CrisisSuggestBannerProps) {
  const { countdown, examInfo }  = useExamCountdown();
  const [dismissed, setDismissed] = useState(false);

  // Check localStorage for dismissal
  useEffect(() => {
    const until = localStorage.getItem(DISMISS_KEY);
    if (until && Date.now() < Number(until)) setDismissed(true);
  }, []);

  const dismiss = () => {
    // Dismiss for 6 hours (so it re-appears if they come back later)
    localStorage.setItem(DISMISS_KEY, String(Date.now() + 6 * 3_600_000));
    setDismissed(true);
  };

  const isUrgent =
    countdown !== null &&
    countdown.daysLeft !== null &&
    countdown.daysLeft <= 2 &&
    countdown.urgency !== "safe";

  if (!isUrgent || dismissed || !examInfo?.exam_subject) return null;

  const label = countdown?.daysLeft === 0
    ? "Il tuo esame è OGGI 🎯"
    : countdown?.daysLeft === 1
    ? "Il tuo esame è domani ⚡"
    : `Il tuo esame è tra 2 giorni 🔥`;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, scale: 0.97 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.97 }}
        className="rounded-xl border border-accent/40 bg-gradient-to-r from-accent/10 to-orange-500/5 p-4 flex items-center gap-3"
      >
        <Flame className="h-6 w-6 text-accent shrink-0 animate-pulse" />

        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-card-foreground">{label}</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {examInfo.exam_subject} · Attiva il piano di studio emergenza
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Button
            size="sm"
            className="bg-accent hover:bg-accent/90 text-accent-foreground gap-1 font-bold"
            onClick={onActivate}
          >
            <Zap className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Modalità Crisi</span>
            <span className="sm:hidden">Crisi</span>
          </Button>
          <button onClick={dismiss} className="text-muted-foreground hover:text-foreground p-1">
            <X className="h-4 w-4" />
          </button>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
