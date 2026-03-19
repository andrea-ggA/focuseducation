import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { motion } from "framer-motion";
import { Layers, Brain } from "lucide-react";
import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis,
  ResponsiveContainer, Tooltip,
} from "recharts";

interface TopicStat {
  topic:       string;
  total:       number;
  mastered:    number;
  successRate: number;
  avgEF:       number;
}

export default function FlashcardTopicStats() {
  const { user }              = useAuth();
  const [stats, setStats]     = useState<TopicStat[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;

    const load = async () => {
      // BUG FIX: two-step query instead of unreliable joined .eq() filter.
      // Step 1: get deck IDs owned by this user
      const { data: decks } = await supabase
        .from("flashcard_decks")
        .select("id")
        .eq("user_id", user.id);

      if (!decks || decks.length === 0) { setLoading(false); return; }

      const deckIds = decks.map((d: any) => d.id);

      // Step 2: get flashcards in those decks
      const { data } = await supabase
        .from("flashcards")
        .select("topic, mastery_level, easiness_factor")
        .in("deck_id", deckIds)
        .not("topic", "is", null);

      if (!data) { setLoading(false); return; }

      const byTopic: Record<string, { total: number; mastered: number; efSum: number }> = {};
      for (const card of data as any[]) {
        const t = card.topic || "Generale";
        if (!byTopic[t]) byTopic[t] = { total: 0, mastered: 0, efSum: 0 };
        byTopic[t].total++;
        if (card.mastery_level >= 4) byTopic[t].mastered++;
        byTopic[t].efSum += card.easiness_factor ?? 2.5;
      }

      const computed: TopicStat[] = Object.entries(byTopic)
        .map(([topic, s]) => ({
          topic:       topic.length > 18 ? topic.substring(0, 16) + "…" : topic,
          total:       s.total,
          mastered:    s.mastered,
          successRate: Math.round((s.mastered / s.total) * 100),
          avgEF:       Math.round((s.efSum / s.total) * 100) / 100,
        }))
        .filter((s) => s.total >= 2)
        .sort((a, b) => a.successRate - b.successRate)
        .slice(0, 10);

      setStats(computed);
      setLoading(false);
    };

    load();
  }, [user]);

  if (loading) return null;

  if (stats.length < 3) {
    return (
      <div className="bg-card rounded-xl border border-border shadow-card p-5">
        <h3 className="text-sm font-semibold text-card-foreground mb-3 flex items-center gap-2">
          <Layers className="h-4 w-4 text-primary" /> Padronanza per argomento
        </h3>
        <p className="text-sm text-muted-foreground text-center py-6">
          Ripassa almeno 3 argomenti per vedere le statistiche dettagliate.
        </p>
      </div>
    );
  }

  const weakest = [...stats].sort((a, b) => a.successRate - b.successRate).slice(0, 3);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-card rounded-xl border border-border shadow-card p-5 space-y-4"
    >
      <h3 className="text-sm font-semibold text-card-foreground flex items-center gap-2">
        <Layers className="h-4 w-4 text-primary" /> Padronanza per argomento
      </h3>

      <ResponsiveContainer width="100%" height={240}>
        <RadarChart data={stats}>
          <PolarGrid stroke="hsl(var(--border))" />
          <PolarAngleAxis
            dataKey="topic"
            tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
          />
          <Radar
            name="Padronanza %"
            dataKey="successRate"
            stroke="hsl(var(--primary))"
            fill="hsl(var(--primary))"
            fillOpacity={0.25}
            strokeWidth={2}
          />
          <Tooltip
            formatter={(v: number) => [`${v}%`, "Padronanza"]}
            contentStyle={{
              backgroundColor: "hsl(var(--card))",
              border: "1px solid hsl(var(--border))",
              borderRadius: "8px",
              fontSize: "12px",
            }}
          />
        </RadarChart>
      </ResponsiveContainer>

      {weakest.length > 0 && (
        <div className="bg-destructive/5 border border-destructive/20 rounded-lg p-3">
          <p className="text-xs font-medium text-card-foreground flex items-center gap-1.5 mb-2">
            <Brain className="h-3.5 w-3.5 text-destructive" />
            Argomenti da ripassare prioritariamente
          </p>
          <div className="flex flex-wrap gap-2">
            {weakest.map((t) => (
              <span key={t.topic}
                className="text-[11px] bg-destructive/10 text-destructive px-2 py-0.5 rounded-full font-medium">
                {t.topic} — {t.successRate}%
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-2">
        {stats.slice().reverse().map((s) => (
          <div key={s.topic} className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground w-32 truncate shrink-0">{s.topic}</span>
            <div className="flex-1 bg-secondary rounded-full h-1.5 overflow-hidden">
              <div className="h-full rounded-full transition-all" style={{
                width: `${s.successRate}%`,
                backgroundColor: s.successRate >= 80 ? "hsl(var(--primary))"
                  : s.successRate >= 50 ? "hsl(43 96% 56%)"
                  : "hsl(var(--destructive))",
              }} />
            </div>
            <span className="text-xs font-medium w-9 text-right text-card-foreground shrink-0">
              {s.successRate}%
            </span>
          </div>
        ))}
      </div>
    </motion.div>
  );
}
