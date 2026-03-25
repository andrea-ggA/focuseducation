/**
 * WeakTopicsQuiz — Widget "Quiz sui miei errori"
 *
 * Trova i topic su cui l'utente sbaglia di più, mostra un riassunto
 * e offre un quiz filtrato su quelle domande. Dati già disponibili
 * in user_question_progress — zero AI, zero crediti.
 *
 * Mobile: full-width, tap-friendly, max 3 topic pills visibili.
 */
import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Brain, Play, ChevronRight, Target, TrendingDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

interface WeakTopic {
  topic: string;
  wrongCount: number;
  totalCount: number;
  errorRate: number;
}

interface WeakTopicsQuizProps {
  onStartQuiz: (questionIds: string[]) => void;
}

export default function WeakTopicsQuiz({ onStartQuiz }: WeakTopicsQuizProps) {
  const { user }                          = useAuth();
  const [weakTopics, setWeakTopics]       = useState<WeakTopic[]>([]);
  const [loading, setLoading]             = useState(true);
  const [questionIds, setQuestionIds]     = useState<string[]>([]);
  const [totalWrong, setTotalWrong]       = useState(0);

  const load = useCallback(async () => {
    if (!user) return;
    try {
      // Fetch last 60 days of answers
      const since = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
      const { data } = await supabase
        .from("user_question_progress")
        .select("question_id, is_correct")
        .eq("user_id", user.id)
        .gte("answered_at", since)
        .order("answered_at", { ascending: false })
        .limit(500);

      if (!data || data.length === 0) { setLoading(false); return; }

      // Aggregate by topic — topic comes from quiz_questions via question_id
      // Since topic is not on user_question_progress, we fetch questions separately
      const questionIds = [...new Set(data.map((r: any) => r.question_id))];
      const { data: questionsData } = await supabase
        .from("quiz_questions")
        .select("id, topic")
        .in("id", questionIds);
      const topicMap: Record<string, string> = {};
      for (const q of (questionsData || []) as any[]) {
        topicMap[q.id] = q.topic || "Generale";
      }

      const topicStats: Record<string, { wrong: number; total: number; wrongIds: string[] }> = {};
      for (const row of data as any[]) {
        const t = topicMap[row.question_id] || "Generale";
        if (!topicStats[t]) topicStats[t] = { wrong: 0, total: 0, wrongIds: [] };
        topicStats[t].total++;
        if (!row.is_correct) {
          topicStats[t].wrong++;
          topicStats[t].wrongIds.push(row.question_id);
        }
      }

      // Sort by error rate (min 3 attempts to be meaningful)
      const sorted = Object.entries(topicStats)
        .filter(([, s]) => s.total >= 3)
        .map(([topic, s]) => ({
          topic,
          wrongCount: s.wrong,
          totalCount: s.total,
          errorRate: s.wrong / s.total,
        }))
        .sort((a, b) => b.errorRate - a.errorRate)
        .slice(0, 5);

      setWeakTopics(sorted);
      setTotalWrong(data.filter(r => !r.is_correct).length);

      // Collect question IDs from the weakest 3 topics
      const ids: string[] = [];
      for (const [, s] of Object.entries(topicStats)
        .filter(([, s]) => s.total >= 3)
        .sort(([, a], [, b]) => (b.wrong / b.total) - (a.wrong / a.total))
        .slice(0, 3)) {
        ids.push(...s.wrongIds.slice(0, 10));
      }
      setQuestionIds([...new Set(ids)].slice(0, 30));
    } catch (e) {
      console.error("[WeakTopicsQuiz]", e);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { load(); }, [load]);

  // Don't render if not enough errors (< 5 wrong answers total)
  if (loading || totalWrong < 5 || weakTopics.length === 0) return null;

  const top3 = weakTopics.slice(0, 3);
  const canStart = questionIds.length >= 3;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.1 }}
      className="bg-card rounded-xl border border-destructive/20 p-4 space-y-3"
    >
      {/* Header */}
      <div className="flex items-center gap-2">
        <div className="h-8 w-8 rounded-lg bg-destructive/10 flex items-center justify-center shrink-0">
          <TrendingDown className="h-4 w-4 text-destructive" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-card-foreground">Quiz sui tuoi punti deboli</p>
          <p className="text-xs text-muted-foreground">{totalWrong} errori negli ultimi 60 giorni</p>
        </div>
        <Badge variant="destructive" className="text-[10px] shrink-0">
          {weakTopics.length} topic
        </Badge>
      </div>

      {/* Weak topics pills */}
      <div className="flex flex-wrap gap-1.5">
        {top3.map((t) => (
          <div
            key={t.topic}
            className="flex items-center gap-1 bg-destructive/5 border border-destructive/20 rounded-full px-2.5 py-1"
          >
            <span className="text-xs font-medium text-card-foreground truncate max-w-[120px]">{t.topic}</span>
            <span className="text-[10px] text-destructive font-bold shrink-0">
              {Math.round(t.errorRate * 100)}% err.
            </span>
          </div>
        ))}
        {weakTopics.length > 3 && (
          <div className="flex items-center px-2.5 py-1 bg-secondary/50 rounded-full">
            <span className="text-xs text-muted-foreground">+{weakTopics.length - 3} altri</span>
          </div>
        )}
      </div>

      {/* CTA */}
      <Button
        size="sm"
        variant="outline"
        className="w-full border-destructive/30 text-destructive hover:bg-destructive/5 hover:text-destructive gap-2"
        disabled={!canStart}
        onClick={() => onStartQuiz(questionIds)}
      >
        <Target className="h-3.5 w-3.5" />
        Allenati sugli errori ({Math.min(questionIds.length, 30)} domande)
        <ChevronRight className="h-3.5 w-3.5 ml-auto" />
      </Button>
    </motion.div>
  );
}
