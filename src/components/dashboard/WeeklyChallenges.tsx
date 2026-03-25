import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

import { useToast } from "@/hooks/use-toast";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { motion, AnimatePresence } from "framer-motion";
import { Trophy, Clock, Gift, CheckCircle2, Flame } from "lucide-react";

interface Challenge {
  id: string;
  title: string;
  description: string;
  challenge_type: string;
  target_value: number;
  xp_reward: number;
  icon: string;
  week_end: string;
}

interface ChallengeProgress {
  challenge_id: string;
  current_value: number;
  completed: boolean;
  reward_claimed: boolean;
}

const WeeklyChallenges = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [progressMap, setProgressMap] = useState<Record<string, ChallengeProgress>>({});
  const [loading, setLoading] = useState(true);
  const [timeLeft, setTimeLeft] = useState("");

  const fetchChallenges = useCallback(async () => {
    if (!user) return;
    const today = new Date().toISOString().split("T")[0];

    const [challengesRes, progressRes] = await Promise.all([
      supabase
        .from("weekly_challenges")
        .select("*")
        .lte("week_start", today)
        .gte("week_end", today),
      supabase
        .from("user_challenge_progress")
        .select("*")
        .eq("user_id", user.id),
    ]);

    if (challengesRes.data) setChallenges(challengesRes.data as unknown as Challenge[]);
    if (progressRes.data) {
      const map: Record<string, ChallengeProgress> = {};
      (progressRes.data as unknown as ChallengeProgress[]).forEach((p) => {
        map[p.challenge_id] = p;
      });
      setProgressMap(map);
    }
    setLoading(false);
  }, [user]);

  // Calculate real progress from actual data
  const syncProgress = useCallback(async () => {
    if (!user || challenges.length === 0) return;

    // FIX: calcola lunedì della settimana corrente esplicitamente (non dipendere da week_end)
    const now = new Date();
    const daysToMonday = (now.getDay() + 6) % 7;
    const monday = new Date(now);
    monday.setDate(now.getDate() - daysToMonday);
    monday.setHours(0, 0, 0, 0);
    const weekStart = monday.toISOString();

    const [quizRes, focusRes, tasksRes] = await Promise.all([
      supabase
        .from("quiz_attempts")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id)
        .gte("completed_at", weekStart),
      supabase
        .from("focus_sessions")
        .select("duration_minutes")
        .eq("user_id", user.id)
        .eq("completed", true)
        .gte("started_at", weekStart),
      supabase
        .from("tasks")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id)
        .eq("completed", true)
        .gte("updated_at", weekStart),
    ]);

    const actuals: Record<string, number> = {
      quiz_count: quizRes.count || 0,
      focus_minutes: focusRes.data?.reduce((s, r) => s + (r.duration_minutes || 0), 0) || 0,
      tasks_completed: tasksRes.count || 0,
      flashcard_reviews: 0, // Will be tracked incrementally
    };

    for (const ch of challenges) {
      const val = actuals[ch.challenge_type] ?? 0;
      const existing = progressMap[ch.id];
      const completed = val >= ch.target_value;

      if (!existing) {
        await supabase.from("user_challenge_progress").upsert({
          user_id: user.id,
          challenge_id: ch.id,
          current_value: val,
          completed,
          completed_at: completed ? new Date().toISOString() : null,
        }, { onConflict: "user_id,challenge_id" });
      } else if (existing.current_value !== val) {
        await supabase.from("user_challenge_progress")
          .update({
            current_value: val,
            completed,
            completed_at: completed && !existing.completed ? new Date().toISOString() : existing.completed ? undefined : null,
          })
          .eq("user_id", user.id)
          .eq("challenge_id", ch.id);
      }
    }

    fetchChallenges();
  }, [user, challenges, progressMap, fetchChallenges]);

  useEffect(() => {
    fetchChallenges();
  }, [fetchChallenges]);

  useEffect(() => {
    if (challenges.length > 0) {
      syncProgress();
    }
  }, [challenges.length]);

  // Countdown timer
  useEffect(() => {
    if (challenges.length === 0) return;
    const weekEnd = new Date(challenges[0].week_end + "T23:59:59");

    const tick = () => {
      const now = new Date();
      const diff = weekEnd.getTime() - now.getTime();
      if (diff <= 0) {
        setTimeLeft("Scaduta!");
        return;
      }
      const days = Math.floor(diff / 86400000);
      const hours = Math.floor((diff % 86400000) / 3600000);
      const mins = Math.floor((diff % 3600000) / 60000);
      setTimeLeft(days > 0 ? `${days}g ${hours}h` : `${hours}h ${mins}m`);
    };

    tick();
    const interval = setInterval(tick, 60000);
    return () => clearInterval(interval);
  }, [challenges]);

  const claimReward = async (challenge: Challenge) => {
    if (!user) return;
    const progress = progressMap[challenge.id];
    if (!progress?.completed || progress.reward_claimed) return;

    // FIX: claim atomico server-side — previene double-claim e verifica condizioni
    const { data, error } = await supabase.rpc("claim_weekly_challenge", {
      _user_id:      user.id,
      _challenge_id: challenge.id,
    });

    if (error || !data?.success) {
      const msg = data?.error === "already_claimed" ? "Premio già riscosso"
                : data?.error === "not_completed"   ? "Sfida non ancora completata"
                : "Errore nel riscuotere il premio";
      toast({ title: "Errore", description: msg, variant: "destructive" });
      return;
    }

    setProgressMap((prev) => ({
      ...prev,
      [challenge.id]: { ...prev[challenge.id], reward_claimed: true },
    }));

    toast({
      title: "🎉 Premio riscosso!",
      description: `Hai guadagnato ${data.xp_awarded} XP per "${challenge.title}"!`,
    });
  };

  const completedCount = challenges.filter((c) => progressMap[c.id]?.completed).length;

  if (loading || challenges.length === 0) return null;

  return (
    <div className="bg-card rounded-xl border border-border shadow-card p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Trophy className="h-5 w-5 text-accent" />
          <h2 className="text-lg font-semibold text-card-foreground">Sfide Settimanali</h2>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Clock className="h-3.5 w-3.5" />
          <span>{timeLeft}</span>
        </div>
      </div>

      {/* Overall progress */}
      <div className="flex items-center gap-2 mb-4 text-xs text-muted-foreground">
        <Flame className="h-3.5 w-3.5 text-accent" />
        <span>{completedCount}/{challenges.length} completate</span>
        <Progress value={(completedCount / challenges.length) * 100} className="h-1.5 flex-1" />
      </div>

      {/* Challenge cards */}
      <div className="space-y-3">
        <AnimatePresence>
          {challenges.map((ch, i) => {
            const progress = progressMap[ch.id];
            const current = progress?.current_value ?? 0;
            const pct = Math.min(100, (current / ch.target_value) * 100);
            const isCompleted = progress?.completed;
            const isClaimed = progress?.reward_claimed;

            return (
              <motion.div
                key={ch.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                className={`rounded-lg border p-3 transition-all ${
                  isCompleted
                    ? isClaimed
                      ? "border-primary/20 bg-primary/5 opacity-70"
                      : "border-accent/40 bg-accent/5 shadow-sm"
                    : "border-border hover:border-primary/30"
                }`}
              >
                <div className="flex items-start gap-3">
                  <span className="text-xl">{ch.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <p className={`text-sm font-medium ${isCompleted ? "text-primary" : "text-card-foreground"}`}>
                        {ch.title}
                      </p>
                      <span className="text-xs font-semibold text-accent shrink-0">+{ch.xp_reward} XP</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{ch.description}</p>
                    <div className="flex items-center gap-2 mt-2">
                      <Progress value={pct} className="h-1.5 flex-1" />
                      <span className="text-[10px] text-muted-foreground shrink-0">
                        {current}/{ch.target_value}
                      </span>
                    </div>
                  </div>

                  {/* Claim button */}
                  {isCompleted && !isClaimed && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="shrink-0 border-accent text-accent hover:bg-accent hover:text-accent-foreground"
                      onClick={() => claimReward(ch)}
                    >
                      <Gift className="h-3.5 w-3.5 mr-1" />
                      Riscuoti
                    </Button>
                  )}
                  {isClaimed && (
                    <CheckCircle2 className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                  )}
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </div>
  );
};

export default WeeklyChallenges;
