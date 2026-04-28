import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { invokeEdgeFunction } from "@/lib/backendApi";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { motion, AnimatePresence } from "framer-motion";
import { Skeleton } from "@/components/ui/skeleton";
import {
  CalendarDays,
  Brain,
  Sparkles,
  ChevronRight,
  ChevronLeft,
  RefreshCw,
  Clock,
  Lightbulb,
  CheckCircle2,
  Circle,
} from "lucide-react";

interface Activity {
  type: string;
  title: string;
  description: string;
  duration_minutes: number;
  priority: string;
  emoji: string;
  done?: boolean;
}

interface DayPlan {
  day_name: string;
  day_number: number;
  theme: string;
  emoji: string;
  activities: Activity[];
  tip: string;
}

interface StudyPlan {
  weekly_summary: string;
  weekly_goal: string;
  total_estimated_minutes: number;
  days: DayPlan[];
}

interface GenerateStudyPlanResponse {
  success?: boolean;
  plan?: StudyPlan;
  error?: string;
}

interface EnergyProfileRow {
  energy_level?: string | null;
}

const PRIORITY_COLORS: Record<string, string> = {
  high: "border-destructive/30 bg-destructive/5",
  medium: "border-primary/30 bg-primary/5",
  low: "border-muted-foreground/20 bg-secondary/50",
};

const TYPE_ICONS: Record<string, string> = {
  quiz: "📝",
  flashcards: "🃏",
  focus: "⏱️",
  task: "✅",
  break: "☕",
  review: "🔄",
};

interface StudyPlanAIProps {
  initialPlan?: StudyPlan | null;   // piano pre-caricato dal Dashboard (evita doppia fetch)
  preloaded?:         boolean;      // true = Dashboard ha già tentato il fetch
  onPlanGenerated?: (plan: StudyPlan) => void;
}

const StudyPlanAI = ({ initialPlan, preloaded = false, onPlanGenerated }: StudyPlanAIProps) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [plan, setPlan] = useState<StudyPlan | null>(null);
  const [loading, setLoading] = useState(false);
  // Se preloaded=true il Dashboard ha già fatto la query → nessun flash vuoto
  const [initialLoading, setInitialLoading] = useState(!preloaded);
  const [selectedDay, setSelectedDay] = useState(() => {
    const today = new Date().getDay();
    return today === 0 ? 6 : today - 1; // Convert Sunday=0 to index 6, Monday=1 to 0
  });
  const [completedActivities, setCompletedActivities] = useState<Record<string, boolean>>({});

  // Load existing plan
  const loadPlan = useCallback(async () => {
    if (!user) return;
    const now = new Date();
    const monday = new Date(now);
    monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
    const weekStart = monday.toISOString().split("T")[0];

    const { data } = await supabase
      .from("study_plans")
      .select("*")
      .eq("user_id", user.id)
      .eq("week_start", weekStart)
      .maybeSingle();

    if (data?.plan_data) {
      const p = data.plan_data as unknown as StudyPlan;
      setPlan(p);
      onPlanGenerated?.(p);
    }
    setInitialLoading(false);
  }, [user, onPlanGenerated]);

  // Usa piano pre-caricato dal Dashboard se disponibile
  useEffect(() => {
    if (preloaded) {
      if (initialPlan) setPlan(initialPlan as unknown as StudyPlan);
      setInitialLoading(false);
    } else {
      loadPlan();
    }
  }, [preloaded, initialPlan, loadPlan]);

  // Load completed state from localStorage
  useEffect(() => {
    if (!user) return;
    const stored = localStorage.getItem(`study-plan-done-${user.id}`);
    if (stored) {
      try {
        setCompletedActivities(JSON.parse(stored));
      } catch { /* ignore */ }
    }
  }, [user]);

  const toggleActivity = (dayIdx: number, actIdx: number) => {
    const key = `${dayIdx}-${actIdx}`;
    setCompletedActivities((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      if (user) localStorage.setItem(`study-plan-done-${user.id}`, JSON.stringify(next));
      return next;
    });
  };

  const generatePlan = async () => {
    if (!user) return;
    setLoading(true);

    try {
      const { data: profile } = await supabase
        .from("profiles")
        .select("energy_level")
        .eq("user_id", user.id)
        .single();

      const data = await invokeEdgeFunction<GenerateStudyPlanResponse>("generate-study-plan", {
        energy_level: (profile as EnergyProfileRow | null)?.energy_level || "balanced",
        language: navigator.language?.split("-")[0] || "it",
      });

      if (data?.error) throw new Error(data.error);

      if (data?.plan) {
        setPlan(data.plan);
        setCompletedActivities({});
        if (user) localStorage.removeItem(`study-plan-done-${user.id}`);
        toast({ title: "📚 Piano generato!", description: "Il tuo piano settimanale è pronto." });
      }
    } catch (e: unknown) {
      console.error("Generate plan error:", e);
      const message = e instanceof Error ? e.message : "Impossibile generare il piano.";
      toast({
        title: "Errore",
        description: message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const currentDay = plan?.days?.[selectedDay];
  const totalActivities = plan?.days?.reduce((s, d) => s + d.activities.length, 0) ?? 0;
  const doneCount = Object.values(completedActivities).filter(Boolean).length;

  if (initialLoading) {
    return (
      <div className="bg-card rounded-xl border border-border shadow-card p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Skeleton className="h-5 w-5 rounded" />
          <Skeleton className="h-5 w-32" />
        </div>
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-2 w-full rounded-full" />
        <div className="grid grid-cols-7 gap-1">
          {Array.from({length:7}).map((_,i) => <Skeleton key={i} className="h-8 rounded" />)}
        </div>
        <Skeleton className="h-24 w-full rounded-xl" />
      </div>
    );
  }

  // No plan yet - show CTA
  if (!plan) {
    return (
      <div className="bg-card rounded-xl border border-border shadow-card p-6">
        <div className="text-center py-4">
          <div className="h-14 w-14 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
            <CalendarDays className="h-7 w-7 text-primary" />
          </div>
          <h3 className="text-lg font-semibold text-card-foreground mb-2">Piano di Studio AI</h3>
          <p className="text-sm text-muted-foreground mb-4 max-w-sm mx-auto">
            Genera un piano settimanale personalizzato basato sui tuoi progressi, materiali e livello di energia.
          </p>
          <Button onClick={generatePlan} disabled={loading} className="gap-2">
            {loading ? (
              <>
                <Brain className="h-4 w-4 animate-spin" />
                Generazione in corso...
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4" />
                Genera il mio piano
              </>
            )}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-card rounded-xl border border-border shadow-card p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <CalendarDays className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold text-card-foreground">Piano Settimanale</h2>
        </div>
        <Button variant="ghost" size="sm" onClick={generatePlan} disabled={loading} className="gap-1 text-xs">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          Rigenera
        </Button>
      </div>

      {/* Weekly summary */}
      <p className="text-xs text-muted-foreground mb-2">{plan.weekly_summary}</p>

      {/* Weekly progress */}
      <div className="flex items-center gap-2 mb-4 text-xs text-muted-foreground">
        <Sparkles className="h-3.5 w-3.5 text-primary" />
        <span>🎯 {plan.weekly_goal}</span>
      </div>
      <div className="flex items-center gap-2 mb-4">
        <Progress value={totalActivities > 0 ? (doneCount / totalActivities) * 100 : 0} className="h-1.5 flex-1" />
        <span className="text-[10px] text-muted-foreground">{doneCount}/{totalActivities}</span>
      </div>

      {/* Day selector pills */}
      <div className="flex gap-1 mb-4 overflow-x-auto pb-1 -mx-1 px-1">
        {plan.days.map((day, i) => {
          const dayDoneCount = day.activities.filter((_, ai) => completedActivities[`${i}-${ai}`]).length;
          const allDone = dayDoneCount === day.activities.length;
          const isToday = i === selectedDay;

          return (
            <button
              key={i}
              onClick={() => setSelectedDay(i)}
              className={`shrink-0 flex flex-col items-center gap-0.5 px-2.5 py-1.5 rounded-lg text-xs transition-all ${
                isToday
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : allDone
                  ? "bg-primary/10 text-primary"
                  : "bg-secondary/50 text-muted-foreground hover:bg-secondary"
              }`}
            >
              <span>{day.emoji}</span>
              <span className="font-medium text-[10px]">{day.day_name.slice(0, 3)}</span>
              {allDone && <CheckCircle2 className="h-2.5 w-2.5" />}
            </button>
          );
        })}
      </div>

      {/* Selected day content */}
      <AnimatePresence mode="wait">
        {currentDay && (
          <motion.div
            key={selectedDay}
            initial={{ opacity: 0, x: 10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -10 }}
            transition={{ duration: 0.15 }}
          >
            {/* Day header */}
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="text-sm font-semibold text-card-foreground">
                  {currentDay.emoji} {currentDay.day_name} — {currentDay.theme}
                </h3>
              </div>
              <div className="flex gap-1">
                <Button
                  variant="ghost" size="icon" className="h-7 w-7"
                  onClick={() => setSelectedDay(Math.max(0, selectedDay - 1))}
                  disabled={selectedDay === 0}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost" size="icon" className="h-7 w-7"
                  onClick={() => setSelectedDay(Math.min((plan?.days?.length ?? 1) - 1, selectedDay + 1))}
                  disabled={selectedDay === (plan?.days?.length ?? 1) - 1}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {/* Activities */}
            <div className="space-y-2 mb-3">
              {currentDay.activities.map((act, ai) => {
                const isDone = completedActivities[`${selectedDay}-${ai}`];
                return (
                  <motion.div
                    key={ai}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: ai * 0.04 }}
                    onClick={() => toggleActivity(selectedDay, ai)}
                    className={`rounded-lg border p-3 cursor-pointer transition-all ${
                      isDone
                        ? "border-primary/20 bg-primary/5 opacity-60"
                        : PRIORITY_COLORS[act.priority] || PRIORITY_COLORS.medium
                    }`}
                  >
                    <div className="flex items-start gap-2.5">
                      {isDone ? (
                        <CheckCircle2 className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                      ) : (
                        <Circle className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <p className={`text-sm font-medium ${isDone ? "line-through text-muted-foreground" : "text-card-foreground"}`}>
                            {act.emoji} {act.title}
                          </p>
                          <div className="flex items-center gap-1 text-[10px] text-muted-foreground shrink-0">
                            <Clock className="h-3 w-3" />
                            {act.duration_minutes}m
                          </div>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">{act.description}</p>
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </div>

            {/* Daily tip */}
            <div className="flex items-start gap-2 rounded-lg bg-accent/5 border border-accent/20 p-3">
              <Lightbulb className="h-4 w-4 text-accent shrink-0 mt-0.5" />
              <p className="text-xs text-muted-foreground">{currentDay.tip}</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default StudyPlanAI;
