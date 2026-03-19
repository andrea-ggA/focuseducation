import { motion, AnimatePresence } from "framer-motion";
import { Crown, ArrowRight, Clock, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { useTrial } from "@/hooks/useTrial";
import { useSubscription } from "@/hooks/useSubscription";

/**
 * TrialExpiredModal
 *
 * Shows a non-dismissable upgrade prompt when the trial has expired
 * and the user has no active paid subscription.
 * Placed once in App.tsx so it catches any page.
 */
export default function TrialExpiredModal() {
  const trial    = useTrial();
  const { isPro, isTrial, loading } = useSubscription();

  // Only show if: trial existed + has now expired + no paid plan
  const shouldShow = !loading && trial.expired && !isPro && !isTrial;

  return (
    <AnimatePresence>
      {shouldShow && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="fixed inset-0 z-[100] bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
        >
          <motion.div
            initial={{ y: 60, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ type: "spring", damping: 25, stiffness: 280 }}
            className="bg-card w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl border border-border shadow-2xl overflow-hidden"
            style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
          >
            {/* Gradient top bar */}
            <div className="h-1.5 bg-gradient-to-r from-primary via-accent to-primary" />

            <div className="p-6 sm:p-8 text-center space-y-4">
              <div className="h-16 w-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto">
                <Crown className="h-8 w-8 text-primary" />
              </div>

              <div>
                <h2 className="text-xl sm:text-2xl font-bold text-card-foreground mb-2">
                  Il tuo trial è scaduto
                </h2>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Hai utilizzato i 7 giorni di prova gratuita di{" "}
                  <strong>Hyperfocus Master</strong>.
                  Abbonati per continuare a studiare senza limiti.
                </p>
              </div>

              {/* Benefits reminder */}
              <div className="bg-primary/5 border border-primary/20 rounded-xl p-4 text-left space-y-2">
                {[
                  "700 NeuroCredits al mese",
                  "Quiz, flashcard, riassunti e mappe illimitate",
                  "Focus Burst, Modalità Crisi, Coaching ADHD",
                  "Ripasso SM-2 intelligente cross-deck",
                ].map((b) => (
                  <div key={b} className="flex items-center gap-2 text-sm text-card-foreground">
                    <Sparkles className="h-3.5 w-3.5 text-primary shrink-0" />
                    {b}
                  </div>
                ))}
              </div>

              <div className="space-y-2 pt-2">
                <Button asChild className="w-full gap-2" size="lg">
                  <Link to="/pricing">
                    <Crown className="h-4 w-4" /> Abbonati ora
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </Button>
                <Button asChild variant="outline" className="w-full">
                  <Link to="/pricing">Vedi tutti i piani</Link>
                </Button>
              </div>

              <p className="text-xs text-muted-foreground">
                Puoi continuare ad usare le funzionalità gratuite del piano Free.
              </p>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
