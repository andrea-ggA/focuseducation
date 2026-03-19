import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Filter, Play, BookOpen, Loader2, ArrowLeft, CheckCheck, Clock, Timer, Coins } from "lucide-react";
import { motion } from "framer-motion";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";

interface TopicSelectorProps {
  type: "quiz" | "flashcards";
  sourceId: string;
  onStart: (selectedTopics: string[] | null, customTimerSeconds?: number, xpBet?: number) => void;
  onBack: () => void;
}

const TopicSelector = ({ type, sourceId, onStart, onBack }: TopicSelectorProps) => {
  const { user } = useAuth();
  const [topics, setTopics] = useState<{ topic: string; count: number }[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState("");
  const [timedMode, setTimedMode] = useState(false);
  const [timerSeconds, setTimerSeconds] = useState(30);
  const [betEnabled, setBetEnabled] = useState(false);
  const [betAmount, setBetAmount] = useState(20);
  const [userXp, setUserXp] = useState(0);

  useEffect(() => {
    const fetchTopics = async () => {
      if (type === "quiz") {
        const [quizRes, questionsRes] = await Promise.all([
          supabase.from("quizzes").select("title").eq("id", sourceId).single(),
          supabase.from("quiz_questions").select("topic").eq("quiz_id", sourceId),
        ]);
        if (quizRes.data) setTitle(quizRes.data.title);
        if (questionsRes.data) {
          const topicMap = new Map<string, number>();
          questionsRes.data.forEach((q) => { const t = q.topic || "Generale"; topicMap.set(t, (topicMap.get(t) || 0) + 1); });
          setTopics(Array.from(topicMap.entries()).map(([topic, count]) => ({ topic, count })).sort((a, b) => b.count - a.count));
        }
      } else {
        const [deckRes, cardsRes] = await Promise.all([
          supabase.from("flashcard_decks").select("title").eq("id", sourceId).single(),
          supabase.from("flashcards").select("topic").eq("deck_id", sourceId),
        ]);
        if (deckRes.data) setTitle(deckRes.data.title);
        if (cardsRes.data) {
          const topicMap = new Map<string, number>();
          cardsRes.data.forEach((c) => { const t = c.topic || "Generale"; topicMap.set(t, (topicMap.get(t) || 0) + 1); });
          setTopics(Array.from(topicMap.entries()).map(([topic, count]) => ({ topic, count })).sort((a, b) => b.count - a.count));
        }
      }

      // Fetch user XP for betting
      if (user) {
        const { data } = await supabase.from("user_xp").select("total_xp").eq("user_id", user.id).maybeSingle();
        if (data) setUserXp(data.total_xp);
      }

      setLoading(false);
    };
    fetchTopics();
  }, [type, sourceId, user]);

  const toggleTopic = (topic: string) => {
    setSelected((prev) => { const next = new Set(prev); if (next.has(topic)) next.delete(topic); else next.add(topic); return next; });
  };

  const selectAll = () => {
    if (selected.size === topics.length) setSelected(new Set());
    else setSelected(new Set(topics.map((t) => t.topic)));
  };

  const totalItems = selected.size === 0
    ? topics.reduce((s, t) => s + t.count, 0)
    : topics.filter((t) => selected.has(t.topic)).reduce((s, t) => s + t.count, 0);

  const noneSelected = selected.size === 0;
  const maxBet = Math.min(100, userXp);

  if (loading) return <div className="flex items-center justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;

  if (topics.length <= 1) {
    onStart(null, timedMode ? timerSeconds : undefined, betEnabled ? betAmount : undefined);
    return null;
  }

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
      <div>
        <Button variant="ghost" size="sm" onClick={onBack} className="mb-2 -ml-2">
          <ArrowLeft className="h-4 w-4 mr-1" /> Indietro
        </Button>
        <h2 className="text-xl font-bold text-card-foreground">{title}</h2>
        <p className="text-sm text-muted-foreground mt-1">Seleziona gli argomenti su cui esercitarti.</p>
      </div>

      {/* Timer config - only for quizzes */}
      {type === "quiz" && (
        <div className="bg-secondary/50 rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-medium text-card-foreground">
              <Timer className="h-4 w-4 text-primary" />
              Quiz a tempo
            </div>
            <button
              onClick={() => setTimedMode(!timedMode)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${timedMode ? "bg-primary" : "bg-border"}`}
            >
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${timedMode ? "translate-x-6" : "translate-x-1"}`} />
            </button>
          </div>
          {timedMode && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Tempo per domanda</span>
                <span className="font-bold text-primary">{timerSeconds}s</span>
              </div>
              <Slider
                value={[timerSeconds]}
                onValueChange={([v]) => setTimerSeconds(v)}
                min={10}
                max={120}
                step={5}
                className="w-full"
              />
              <div className="flex justify-between text-[10px] text-muted-foreground">
                <span>10s (veloce)</span>
                <span>60s (standard)</span>
                <span>120s (relax)</span>
              </div>
            </motion.div>
          )}
        </div>
      )}

      {/* XP Betting - only for quizzes */}
      {type === "quiz" && (
        <div className="bg-secondary/50 rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-medium text-card-foreground">
              <Coins className="h-4 w-4 text-accent" />
              Scommetti XP
            </div>
            <button
              onClick={() => userXp >= 10 && setBetEnabled(!betEnabled)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${betEnabled ? "bg-accent" : "bg-border"} ${userXp < 10 ? "opacity-50 cursor-not-allowed" : ""}`}
              disabled={userXp < 10}
            >
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${betEnabled ? "translate-x-6" : "translate-x-1"}`} />
            </button>
          </div>
          {userXp < 10 && (
            <p className="text-[10px] text-muted-foreground">Servono almeno 10 XP per scommettere.</p>
          )}
          {betEnabled && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} className="space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Quota scommessa</span>
                <span className="font-bold text-accent">{betAmount} XP</span>
              </div>
              <Slider
                value={[betAmount]}
                onValueChange={([v]) => setBetAmount(v)}
                min={10}
                max={maxBet}
                step={10}
                className="w-full"
              />
              <div className="bg-accent/10 rounded-lg p-3 space-y-1">
                <p className="text-xs font-medium text-accent">
                  🎰 Se ≥80% corretto: <span className="font-bold">+{betAmount * 2} XP</span>
                </p>
                <p className="text-xs text-muted-foreground">
                  Se &lt;80%: <span className="text-destructive font-medium">-{betAmount} XP</span>
                </p>
                <p className="text-[10px] text-muted-foreground">
                  I tuoi XP attuali: {userXp}
                </p>
              </div>
            </motion.div>
          )}
        </div>
      )}

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium text-card-foreground">
          <Filter className="h-4 w-4 text-primary" />
          {topics.length} argomenti trovati
        </div>
        <Button variant="outline" size="sm" onClick={selectAll} className="gap-1.5">
          <CheckCheck className="h-3.5 w-3.5" />
          {selected.size === topics.length ? "Deseleziona tutti" : "Seleziona tutti"}
        </Button>
      </div>

      <div className="grid gap-2">
        {topics.map((t, i) => (
          <motion.button
            key={t.topic}
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.02 }}
            onClick={() => toggleTopic(t.topic)}
            className={`w-full flex items-center gap-3 p-3.5 rounded-xl border-2 transition-all text-left ${
              selected.has(t.topic) ? "border-primary bg-primary/5 shadow-sm" :
              noneSelected ? "border-border hover:border-primary/40 hover:bg-secondary/50" :
              "border-border opacity-40 hover:opacity-70"
            }`}
          >
            <Checkbox checked={selected.has(t.topic)} className="pointer-events-none" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-card-foreground truncate">{t.topic}</p>
            </div>
            <Badge variant="secondary" className="text-[10px] shrink-0 font-mono">
              Cap. {i + 1}
            </Badge>
          </motion.button>
        ))}
      </div>

      <div className="bg-secondary/50 rounded-xl p-4 flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-card-foreground">
            {noneSelected ? "Tutti gli argomenti" : `${selected.size} argomenti selezionati`}
          </p>
          <p className="text-xs text-muted-foreground">
            {totalItems} {type === "quiz" ? "domande" : "carte"} totali
            {timedMode && ` · ${timerSeconds}s per domanda`}
            {betEnabled && ` · 🎰 ${betAmount} XP scommessi`}
          </p>
        </div>
        <Button
          onClick={() => onStart(
            selected.size > 0 && selected.size < topics.length ? Array.from(selected) : null,
            timedMode ? timerSeconds : undefined,
            betEnabled ? betAmount : undefined
          )}
          size="lg"
        >
          {type === "quiz" ? <Play className="h-4 w-4 mr-2" /> : <BookOpen className="h-4 w-4 mr-2" />}
          Inizia
        </Button>
      </div>
    </motion.div>
  );
};

export default TopicSelector;
