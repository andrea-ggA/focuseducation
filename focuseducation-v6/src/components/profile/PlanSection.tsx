import { useSubscription } from "@/hooks/useSubscription";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Crown, Check, AlertTriangle, Zap, Loader2 } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription
} from "@/components/ui/dialog";

const PLAN_FEATURES: Record<string, string[]> = {
  "Focus Pro": [
    "250 NeuroCredits/mese",
    "Rollover crediti non usati",
    "Quiz e flashcard illimitati",
    "Tutor AI 24/7",
    "Mappe concettuali + Export",
  ],
  "Hyperfocus Master": [
    "700 NeuroCredits/mese",
    "Rollover crediti + Boost XP",
    "Tutto di Focus Pro incluso",
    "Gamificazione ADHD avanzata",
    "Piano settimanale AI personalizzato",
    "Supporto prioritario",
  ],
};

const FREE_FEATURES = [
  "15 NeuroCredits/mese",
  "Timer Pomodoro",
  "Task manager",
  "Quiz base",
  "Tutor AI (limitato)",
];

const PlanSection = () => {
  const { subscription, hasSubscription } = useSubscription();
  const { toast } = useToast();
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const cancelSubscription = async () => {
    if (!subscription) return;
    setCancelling(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await supabase.functions.invoke("cancel-subscription", {
        headers: { Authorization: `Bearer ${session?.access_token}` },
      });

      if (res.error) throw new Error(res.error.message);

      setCancelDialogOpen(false);
      toast({ title: "Abbonamento disdetto", description: "Il pagamento automatico è stato annullato immediatamente." });
      setTimeout(() => window.location.reload(), 1500);
    } catch (err: any) {
      toast({ title: "Errore", description: err.message || "Impossibile annullare l'abbonamento.", variant: "destructive" });
    } finally {
      setCancelling(false);
    }
  };

  const isTrial = subscription?.status === "trialing";
  const currentFeatures = subscription?.plan_name
    ? PLAN_FEATURES[subscription.plan_name] ?? PLAN_FEATURES["Focus Pro"]
    : FREE_FEATURES;

  return (
    <div className="space-y-6">
      <div className="bg-card rounded-xl border border-border shadow-card p-6">
        <h3 className="text-base font-semibold text-card-foreground mb-4 flex items-center gap-2">
          <Crown className="h-4 w-4 text-primary" /> Piano attuale
        </h3>

        {hasSubscription ? (
          <div className="space-y-4">
            <div className="bg-primary/5 border border-primary/20 rounded-xl p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-semibold text-card-foreground text-lg">{subscription?.plan_name}</p>
                  <p className="text-sm text-muted-foreground mt-0.5">
                    {isTrial
                      ? "Prova gratuita – 7 giorni"
                      : subscription?.current_period_end
                        ? `Rinnovo il ${new Date(subscription.current_period_end).toLocaleDateString("it-IT")}`
                        : "Attivo"}
                  </p>
                </div>
                <Badge variant="default" className="bg-primary">
                  {isTrial ? "Trial" : <><Check className="h-3 w-3 mr-1" /> Attivo</>}
                </Badge>
              </div>
            </div>

            <div className="text-sm text-muted-foreground">
              <p className="font-medium text-card-foreground mb-2">Il tuo piano include:</p>
              <ul className="space-y-1.5">
                {currentFeatures.map((feature) => (
                  <li key={feature} className="flex items-center gap-2">
                    <Check className="h-3.5 w-3.5 text-primary" /> {feature}
                  </li>
                ))}
              </ul>
            </div>

            <Separator />

            <Dialog open={cancelDialogOpen} onOpenChange={setCancelDialogOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm" className="text-destructive border-destructive/30">
                  <AlertTriangle className="h-4 w-4 mr-2" /> Disdici abbonamento
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Disdici abbonamento</DialogTitle>
                  <DialogDescription>
                    Sei sicuro di voler disdire il tuo abbonamento {subscription?.plan_name}?
                    {isTrial
                      ? " La prova gratuita verrà terminata e il pagamento automatico annullato."
                      : " Perderai l'accesso alle funzionalità premium alla fine del periodo corrente."}
                    {" "}Il pagamento automatico verrà annullato immediatamente.
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setCancelDialogOpen(false)}>Annulla</Button>
                  <Button variant="destructive" onClick={cancelSubscription} disabled={cancelling}>
                    {cancelling && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    Conferma disdetta
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="text-center py-4">
              <Zap className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
              <p className="font-medium text-card-foreground mb-1">Piano Free</p>
              <p className="text-sm text-muted-foreground mb-4">Funzionalità base. Passa a Focus Pro per sbloccare tutto!</p>
            </div>
            <div className="text-sm text-muted-foreground">
              <p className="font-medium text-card-foreground mb-2">Il tuo piano include:</p>
              <ul className="space-y-1.5">
                {FREE_FEATURES.map((feature) => (
                  <li key={feature} className="flex items-center gap-2">
                    <Check className="h-3.5 w-3.5 text-primary" /> {feature}
                  </li>
                ))}
              </ul>
            </div>
            <div className="text-center pt-2">
              <Link to="/pricing">
                <Button><Crown className="h-4 w-4 mr-2" /> Vedi i piani</Button>
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default PlanSection;
