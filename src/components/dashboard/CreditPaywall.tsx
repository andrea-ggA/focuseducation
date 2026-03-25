import { motion, AnimatePresence } from "framer-motion";
import { Zap, X, ArrowRight, Crown, Sparkles, Clock, Gift } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useNavigate, Link } from "react-router-dom";
import { useCredits, PLAN_CREDITS } from "@/hooks/useCredits";
import { useSubscription } from "@/hooks/useSubscription";
import { useTrial } from "@/hooks/useTrial";
import { useAuth } from "@/contexts/AuthContext";
import { activateTrial } from "@/hooks/useTrial";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";

export type PaywallAction = "quiz" | "flashcards" | "mindmap" | "summary" | "youtube" | "decompose" | "generic";

interface CreditPaywallProps {
  open:        boolean;
  onClose:     () => void;
  action?:     PaywallAction;   // what the user was trying to do
  creditsNeeded?: number;       // how many credits were needed
}

const ACTION_LABELS: Record<PaywallAction, { label: string; emoji: string }> = {
  quiz:       { label: "generare il quiz",           emoji: "📝" },
  flashcards: { label: "creare le flashcard",        emoji: "🃏" },
  mindmap:    { label: "creare la mappa concettuale",emoji: "🧠" },
  summary:    { label: "generare il riassunto",      emoji: "📄" },
  youtube:    { label: "importare da YouTube",       emoji: "🎬" },
  decompose:  { label: "scomporre in micro-task",    emoji: "📋" },
  generic:    { label: "completare l'operazione",    emoji: "⚡" },
};

const UPGRADE_PLANS = [
  {
    name: "Focus Pro", price: "8,99", credits: 250, icon: Crown,
    color: "border-blue-500/40 bg-blue-500/5", textColor: "text-blue-600 dark:text-blue-400",
    highlight: "Ideale per uso regolare",
  },
  {
    name: "Hyperfocus Master", price: "14,99", credits: 700, icon: Sparkles,
    color: "border-primary/40 bg-primary/5", textColor: "text-primary",
    highlight: "🔥 Più popolare tra gli studenti ADHD",
  },
];

const CreditPaywall = ({ open, onClose, action = "generic", creditsNeeded }: CreditPaywallProps) => {
  const navigate                      = useNavigate();
  const { totalCredits }              = useCredits();
  const { isPro, isHyperfocus }       = useSubscription();
  const trial                         = useTrial();
  const { user }                      = useAuth();
  const { toast }                     = useToast();
  const [activatingTrial, setActivatingTrial] = useState(false);

  const actionInfo    = ACTION_LABELS[action];
  const hasPaidPlan   = isPro || isHyperfocus;
  const hasUsedTrial  = trial.isOnTrial || trial.expired;
  const shortfall     = creditsNeeded ? Math.max(0, creditsNeeded - totalCredits) : null;
  const progressPct   = creditsNeeded ? Math.min(100, Math.round((totalCredits / creditsNeeded) * 100)) : 0;

  const handleActivateTrial = async () => {
    if (!user) return;
    setActivatingTrial(true);
    const ok = await activateTrial(user.id);
    setActivatingTrial(false);
    if (ok) {
      toast({ title: "🎉 Trial attivato!", description: "7 giorni di Hyperfocus Master gratuiti. Nessuna carta richiesta." });
      onClose();
    } else {
      toast({ title: "Trial non disponibile", description: "Hai già usato il periodo di prova.", variant: "destructive" });
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ y: 60, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 60, opacity: 0 }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            onClick={(e) => e.stopPropagation()}
            className="relative bg-card rounded-2xl border border-border shadow-2xl w-full max-w-md overflow-hidden"
          >
            {/* Top accent bar */}
            <div className="h-1 bg-gradient-to-r from-primary via-accent to-primary" />

            <div className="p-6">
              <button onClick={onClose} className="absolute top-4 right-4 text-muted-foreground hover:text-foreground p-1">
                <X className="h-5 w-5" />
              </button>

              {/* Header */}
              <div className="flex items-center gap-3 mb-5">
                <div className="h-12 w-12 rounded-xl bg-accent/10 flex items-center justify-center shrink-0">
                  <span className="text-2xl">{actionInfo.emoji}</span>
                </div>
                <div>
                  <h3 className="text-lg font-bold text-card-foreground">NeuroCredits insufficienti</h3>
                  <p className="text-sm text-muted-foreground">
                    Per {actionInfo.label} ti servono più crediti
                  </p>
                </div>
              </div>

              {/* Progress bar showing how close they were */}
              {creditsNeeded && (
                <div className="mb-5 bg-secondary/50 rounded-xl p-4 space-y-2">
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>Crediti disponibili</span>
                    <span className="font-medium">{totalCredits} / {creditsNeeded} richiesti</span>
                  </div>
                  <Progress value={progressPct} className="h-2" />
                  {shortfall && (
                    <p className="text-xs text-muted-foreground">
                      Mancano solo <strong className="text-destructive">{shortfall} crediti</strong> per completare l'operazione
                    </p>
                  )}
                </div>
              )}

              {/* Trial offer — only if not already on trial/paid */}
              {!hasPaidPlan && !hasUsedTrial && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.97 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="mb-4 border-2 border-primary/40 rounded-xl p-4 bg-primary/5 relative overflow-hidden"
                >
                  <div className="absolute top-2 right-2 text-[10px] bg-primary text-primary-foreground font-bold px-2 py-0.5 rounded-full">
                    GRATIS
                  </div>
                  <div className="flex items-center gap-2 mb-2">
                    <Gift className="h-5 w-5 text-primary" />
                    <span className="text-sm font-bold text-card-foreground">7 giorni di Hyperfocus Master gratis</span>
                  </div>
                  <p className="text-xs text-muted-foreground mb-3">
                    700 crediti, tutte le funzionalità premium, nessuna carta di credito richiesta.
                  </p>
                  <Button className="w-full" onClick={handleActivateTrial} disabled={activatingTrial}>
                    {activatingTrial ? "Attivazione..." : (
                      <><Sparkles className="h-4 w-4 mr-2" /> Attiva trial gratuito</>
                    )}
                  </Button>
                </motion.div>
              )}

              {/* Upgrade plans */}
              <div className="space-y-2 mb-4">
                {UPGRADE_PLANS.filter(p => {
                  if (isHyperfocus) return false;
                  if (isPro && p.name === "Focus Pro") return false;
                  return true;
                }).map((plan) => (
                  <button
                    key={plan.name}
                    onClick={() => { onClose(); navigate("/pricing"); }}
                    className={`w-full flex items-center gap-3 p-3 rounded-xl border text-left transition-all hover:scale-[1.01] ${plan.color}`}
                  >
                    <plan.icon className={`h-5 w-5 shrink-0 ${plan.textColor}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-card-foreground">{plan.name}</p>
                      <p className="text-[11px] text-muted-foreground">{plan.highlight} · {plan.credits} cr/mese</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className={`text-sm font-bold ${plan.textColor}`}>€{plan.price}</p>
                      <p className="text-[10px] text-muted-foreground">/mese</p>
                    </div>
                  </button>
                ))}
              </div>

              {/* Credits pack quick link */}
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1 text-sm" onClick={() => { onClose(); navigate("/pricing#ricarica"); }}>
                  <Zap className="h-4 w-4 mr-1.5" /> Ricarica crediti
                </Button>
                <Button variant="ghost" className="flex-1 text-sm text-muted-foreground" onClick={onClose}>
                  Chiudi
                </Button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default CreditPaywall;
