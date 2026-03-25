import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, RotateCcw, CheckCircle2, Brain, ChevronLeft, Layers } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { sm2, QUALITY_OPTIONS } from "@/lib/spacedRepetition";
import { useDueCards, type DueCard } from "@/hooks/useDueCards";
import { playCorrectSound, playWrongSound, playCompletionSound, fireCompletionConfetti } from "@/lib/soundEffects";

interface QuickReviewSessionProps {
  onClose:    () => void;
  onComplete: (reviewed: number) => void;
}

export default function QuickReviewSession({ onClose, onComplete }: QuickReviewSessionProps) {
  const { user }                              = useAuth();
  const { loadDueCards, refresh: refreshCount } = useDueCards();
  const [cards, setCards]                     = useState<DueCard[]>([]);
  const [current, setCurrent]                 = useState(0);
  const [flipped, setFlipped]                 = useState(false);
  const [loading, setLoading]                 = useState(true);
  const [done, setDone]                       = useState(false);
  const [started, setStarted]                 = useState(false);
  const [deckList, setDeckList]               = useState<{id:string;title:string;card_count:number;topic:string|null}[]>([]);
  const [selectedDeck, setSelectedDeck]       = useState<string>("all");
  const [loadingDecks, setLoadingDecks]       = useState(true);
  const [stats, setStats]                     = useState({ easy: 0, good: 0, hard: 0, again: 0 });

  // Load deck list for selector
  useEffect(() => {
    if (!user) return;
    supabase.from("flashcard_decks").select("id,title,card_count,topic")
      .eq("user_id", user.id).order("created_at", { ascending: false })
      .then(({ data }) => { setDeckList(data || []); setLoadingDecks(false); });
  }, [user]);

  // Load cards only after user taps Start
  const startReview = () => {
    setStarted(true);
    setLoading(true);
    loadDueCards(20, selectedDeck !== "all" ? selectedDeck : undefined)
      .then((c) => { setCards(c); setLoading(false); });
  };

  const rateCard = useCallback(async (quality: number) => {
    if (!user || current >= cards.length) return;
    const card   = cards[current];
    const result = sm2(quality, card.mastery_level, card.easiness_factor ?? 2.5,
      card.next_review_at ? new Date(card.next_review_at) : null);

    await supabase.from("flashcards").update({
      mastery_level:   result.newMasteryLevel,
      easiness_factor: result.newEasinessFactor,
      next_review_at:  result.nextReviewAt.toISOString(),
    }).eq("id", card.id);

    await supabase.from("flashcard_reviews").insert({
      user_id: user.id, card_id: card.id, deck_id: card.deck_id, quality,
    });

    if (quality >= 4) playCorrectSound(); else playWrongSound();

    if (quality === 5) setStats((s) => ({ ...s, easy: s.easy + 1 }));
    else if (quality === 4) setStats((s) => ({ ...s, good: s.good + 1 }));
    else if (quality === 2) setStats((s) => ({ ...s, hard: s.hard + 1 }));
    else setStats((s) => ({ ...s, again: s.again + 1 }));

    setFlipped(false);
    setTimeout(() => {
      if (current + 1 < cards.length) setCurrent((p) => p + 1);
      else { playCompletionSound(); fireCompletionConfetti(); setDone(true); refreshCount(); onComplete(cards.length); }
    }, 200);
  }, [user, current, cards, refreshCount, onComplete]);

  if (loading) return (
    <div className="fixed inset-0 z-50 bg-background/95 backdrop-blur flex items-center justify-center">
      <Brain className="h-8 w-8 animate-spin text-primary" />
    </div>
  );

  if (cards.length === 0) return (
    <div className="fixed inset-0 z-50 bg-background/95 backdrop-blur flex flex-col items-center justify-center gap-4 p-6">
      <div className="text-5xl">🎉</div>
      <h2 className="text-xl font-bold text-foreground text-center">Nessuna carta da ripassare!</h2>
      <p className="text-muted-foreground text-sm text-center">Torna più tardi per il prossimo ripasso.</p>
      <Button onClick={onClose} className="w-full max-w-xs">Chiudi</Button>
    </div>
  );

  if (done) {
    const total    = stats.easy + stats.good + stats.hard + stats.again;
    const mastered = stats.easy + stats.good;
    return (
      <div className="fixed inset-0 z-50 bg-background/95 backdrop-blur flex flex-col items-center justify-center gap-5 p-6">
        <div className="text-6xl">🏆</div>
        <div className="text-center">
          <h2 className="text-2xl font-bold text-foreground mb-1">Ripasso completato!</h2>
          <p className="text-muted-foreground">{total} carte ripassate oggi</p>
        </div>
        <div className="grid grid-cols-4 gap-2 w-full max-w-sm">
          {[
            { label: "Facile",    value: stats.easy,  color: "text-primary",     bg: "bg-primary/10" },
            { label: "Bene",      value: stats.good,  color: "text-emerald-600", bg: "bg-emerald-500/10" },
            { label: "Difficile", value: stats.hard,  color: "text-orange-500",  bg: "bg-orange-500/10" },
            { label: "Riprova",   value: stats.again, color: "text-destructive",  bg: "bg-destructive/10" },
          ].map((s) => (
            <div key={s.label} className={`${s.bg} rounded-xl p-2 sm:p-3 text-center`}>
              <p className={`text-xl sm:text-2xl font-bold ${s.color}`}>{s.value}</p>
              <p className="text-[10px] text-muted-foreground">{s.label}</p>
            </div>
          ))}
        </div>
        <p className="text-sm text-muted-foreground text-center max-w-xs">
          {mastered >= total * 0.8 ? "🌟 Ottima sessione!" : "💪 Continua così!"}
        </p>
        <Button onClick={onClose} size="lg" className="w-full max-w-xs">
          <CheckCircle2 className="h-4 w-4 mr-2" /> Fatto
        </Button>
      </div>
    );
  }

  const card     = cards[current];
  const progress = Math.round((current / cards.length) * 100);

  return (
    <div className="fixed inset-0 z-50 bg-background flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-3 border-b border-border safe-top">
        <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0" onClick={onClose}>
          <X className="h-5 w-5" />
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-xs text-muted-foreground">{current + 1}/{cards.length}</span>
            {card.deck_title && <Badge variant="secondary" className="text-[10px] h-4">{card.deck_title}</Badge>}
          </div>
          <Progress value={progress} className="h-1.5" />
        </div>
        <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0"
          onClick={() => { setFlipped(false); setCurrent(0); }}>
          <RotateCcw className="h-4 w-4" />
        </Button>
      </div>

      {/* Card area — flex-1 scrollable */}
      <div className="flex-1 overflow-y-auto flex flex-col items-center justify-start sm:justify-center px-4 py-6 max-w-lg mx-auto w-full">
        {card.topic && (
          <Badge variant="outline" className="mb-4 text-xs">{card.topic}</Badge>
        )}

        <AnimatePresence mode="wait">
          <motion.div
            key={`${current}-${flipped}`}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="w-full"
          >
            <div
              className="bg-card border border-border rounded-2xl p-6 sm:p-8 text-center cursor-pointer min-h-[160px] sm:min-h-[200px] flex flex-col items-center justify-center gap-3 shadow-card active:scale-[0.99] transition-transform"
              onClick={() => !flipped && setFlipped(true)}
            >
              {!flipped ? (
                <>
                  <p className="text-base sm:text-lg font-semibold text-card-foreground">{card.front}</p>
                  <p className="text-xs text-muted-foreground">Tocca per girare</p>
                </>
              ) : (
                <>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium mb-1">Risposta</p>
                  <p className="text-sm sm:text-base text-card-foreground">{card.back}</p>
                </>
              )}
            </div>
          </motion.div>
        </AnimatePresence>

        <AnimatePresence>
          {flipped ? (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
              className="grid grid-cols-4 gap-2 mt-5 w-full">
              {QUALITY_OPTIONS.map((opt) => (
                <Button key={opt.value} variant="outline"
                  className="flex flex-col h-auto py-3 gap-1 active:scale-95 transition-transform"
                  onClick={() => rateCard(opt.value)}>
                  <span className="text-xl">{opt.emoji}</span>
                  <span className="text-[10px] text-muted-foreground leading-tight">{opt.label}</span>
                </Button>
              ))}
            </motion.div>
          ) : (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="w-full mt-5">
              <Button className="w-full" onClick={() => setFlipped(true)}>
                Mostra risposta
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
