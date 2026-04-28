import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Target, BookOpen, Timer, CheckCircle2 } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";
import { getLocalDateString } from "@/lib/datetime";

interface Objectives {
  id: string;
  target_questions: number;
  target_focus_minutes: number;
  questions_completed: number;
  focus_completed: number;
}

const DailyObjectives = () => {
  const { user } = useAuth();
  const [obj, setObj] = useState<Objectives | null>(null);
  const [editing, setEditing] = useState(false);
  const [targetQ, setTargetQ] = useState(20);
  const [targetF, setTargetF] = useState(30);

  useEffect(() => {
    if (!user) return;
    const fetch = async () => {
      const today = getLocalDateString();
      const { data } = await supabase
        .from("daily_objectives")
        .select("*")
        .eq("user_id", user.id)
        .eq("objective_date", today)
        .maybeSingle();

      if (data) {
        setObj(data);
        setTargetQ(data.target_questions);
        setTargetF(data.target_focus_minutes);
      } else {
        // Create today's objectives with upsert to avoid race conditions (multi-tab)
        const { data: created, error: upsertError } = await supabase
          .from("daily_objectives")
          .upsert(
            { user_id: user.id, objective_date: today, target_questions: 20, target_focus_minutes: 30 },
            { onConflict: "user_id,objective_date" }
          )
          .select("*")
          .maybeSingle();
        
        if (created) {
          setObj(created);
        } else if (upsertError) {
          // If upsert fails, try fetching again as someone might have created it
          const { data: retryData } = await supabase
            .from("daily_objectives")
            .select("*")
            .eq("user_id", user.id)
            .eq("objective_date", today)
            .maybeSingle();
          if (retryData) setObj(retryData);
        }
      }
    };
    fetch();

    const today = getLocalDateString();
    const channel = supabase
      .channel(`daily_objectives:${user.id}:${today}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "daily_objectives",
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          const row = payload.new as Partial<Objectives & { objective_date: string }> | undefined;
          if (row?.objective_date === today) {
            setObj(row as Objectives);
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user]);

  const saveTargets = async () => {
    if (!obj) return;
    await supabase.from("daily_objectives").update({
      target_questions: targetQ,
      target_focus_minutes: targetF,
    }).eq("id", obj.id);
    setObj({ ...obj, target_questions: targetQ, target_focus_minutes: targetF });
    setEditing(false);
  };

  if (!obj) return null;

  const qProgress = Math.min(100, (obj.questions_completed / obj.target_questions) * 100);
  const fProgress = Math.min(100, (obj.focus_completed / obj.target_focus_minutes) * 100);
  const allDone = qProgress >= 100 && fProgress >= 100;

  return (
    <div className="bg-card rounded-xl border border-border shadow-card p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Target className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold text-card-foreground">Obiettivi giornalieri</h2>
        </div>
        <Button variant="ghost" size="sm" onClick={() => setEditing(!editing)}>
          {editing ? "Annulla" : "Modifica"}
        </Button>
      </div>

      {editing ? (
        <div className="space-y-4">
          <div>
            <label className="text-sm text-muted-foreground">Domande da completare</label>
            <input type="number" value={targetQ} onChange={(e) => setTargetQ(Number(e.target.value))} min={5} max={200}
              className="w-full mt-1 rounded-lg border border-border bg-background p-2 text-sm text-foreground" />
          </div>
          <div>
            <label className="text-sm text-muted-foreground">Minuti di focus</label>
            <input type="number" value={targetF} onChange={(e) => setTargetF(Number(e.target.value))} min={5} max={480}
              className="w-full mt-1 rounded-lg border border-border bg-background p-2 text-sm text-foreground" />
          </div>
          <Button onClick={saveTargets} size="sm">Salva</Button>
        </div>
      ) : (
        <div className="space-y-4">
          {allDone && (
            <motion.div initial={{ scale: 0.9 }} animate={{ scale: 1 }} className="flex items-center gap-2 bg-primary/10 rounded-lg p-3">
              <CheckCircle2 className="h-5 w-5 text-primary" />
              <span className="text-sm font-medium text-primary">Obiettivi completati! 🎉</span>
            </motion.div>
          )}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-1.5 text-sm text-card-foreground">
                <BookOpen className="h-3.5 w-3.5 text-primary" />
                Domande
              </div>
              <span className="text-xs text-muted-foreground">{obj.questions_completed}/{obj.target_questions}</span>
            </div>
            <Progress value={qProgress} className="h-2" />
          </div>
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-1.5 text-sm text-card-foreground">
                <Timer className="h-3.5 w-3.5 text-primary" />
                Focus
              </div>
              <span className="text-xs text-muted-foreground">{obj.focus_completed}/{obj.target_focus_minutes} min</span>
            </div>
            <Progress value={fProgress} className="h-2" />
          </div>
        </div>
      )}
    </div>
  );
};

export default DailyObjectives;
