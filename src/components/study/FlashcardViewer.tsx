import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { RotateCcw, ChevronLeft, ChevronRight, BookOpen, Clock, Volume2, VolumeX } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { motion, AnimatePresence } from "framer-motion";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { sm2, isDueForReview, QUALITY_OPTIONS } from "@/lib/spacedRepetition";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { awardUserXp, recordFlashcardReview } from "@/lib/progression";

interface Flashcard {
  id:               string;
  front:            string;
  back:             string;
  topic:            string;
  difficulty:       string;
  mastery_level:    number;
  easiness_factor:  number;   // SM-2: persisted per card (default 2.5)
  next_review_at:   string | null;
}

interface FlashcardViewerProps {
  deckId: string;
  selectedTopics?: string[] | null;
  reviewMode?: boolean; // prioritize due cards
  onBack: () => void;
}

const FlashcardViewer = ({ deckId, selectedTopics, reviewMode, onBack }: FlashcardViewerProps) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [cards, setCards] = useState<Flashcard[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [loading, setLoading] = useState(true);
  const [deckTitle, setDeckTitle] = useState("");
  const [stats, setStats] = useState({ easy: 0, good: 0, hard: 0, again: 0 });
  const [speaking, setSpeaking] = useState(false);

  const [xpAwarded, setXpAwarded] = useState(false);

  useEffect(() => {
    setXpAwarded(false);
  }, [deckId, selectedTopics, reviewMode]);

  // Award XP once when the session is completed
  useEffect(() => {
    if (currentIndex >= cards.length && cards.length > 0 && !xpAwarded && user) {
      const awardXp = async () => {
        const amount = Math.min(50, cards.length * 2); // 2 XP per card, max 50
        await awardUserXp({
          userId: user.id,
          amount,
          source: "flashcard_session",
          sourceId: deckId,
          dedupeBySourceId: true,
        });
        
        setXpAwarded(true);
        toast({ title: `+${amount} XP! ✨`, description: "Sessione flashcard completata!" });
      };
      awardXp();
    }
  }, [currentIndex, cards.length, xpAwarded, user, deckId, toast]);

  // Web Speech API — migliorata euristica lingua
  const speak = useCallback((text: string) => {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    if (speaking) { setSpeaking(false); return; }

    const utterance = new SpeechSynthesisUtterance(text);
    
    // Euristica più robusta: se contiene molte parole comuni inglesi o pattern specifici
    const englishPatterns = /\b(the|is|are|was|were|will|be|of|and|to|in|it|that|for|with|as|on)\b/i;
    const isEnglish = englishPatterns.test(text);
    
    utterance.lang = isEnglish ? "en-US" : "it-IT";
    utterance.rate = 0.95;
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    setSpeaking(true);
    window.speechSynthesis.speak(utterance);
  }, [speaking]);

  // Stop speech when card changes o unmount
  useEffect(() => {
    return () => {
      window.speechSynthesis?.cancel();
    };
  }, []);

  useEffect(() => {
    window.speechSynthesis?.cancel();
    setSpeaking(false);
  }, [currentIndex]);

  useEffect(() => {
    const fetch = async () => {
      const [deckRes, cardsRes] = await Promise.all([
        supabase.from("flashcard_decks").select("title").eq("id", deckId).single(),
        supabase.from("flashcards").select("*").eq("deck_id", deckId).order("sort_order"),
      ]);
      if (deckRes.data) setDeckTitle(deckRes.data.title);
      if (cardsRes.data) {
        let filtered = cardsRes.data as Flashcard[];
        if (selectedTopics && selectedTopics.length > 0) {
          filtered = filtered.filter((c) => selectedTopics.includes(c.topic));
        }
        if (reviewMode) {
          // Sort: due cards first, then by next_review_at ascending
          filtered = filtered
            .filter((c) => isDueForReview(c.next_review_at))
            .sort((a, b) => {
              const aTime = a.next_review_at ? new Date(a.next_review_at).getTime() : 0;
              const bTime = b.next_review_at ? new Date(b.next_review_at).getTime() : 0;
              return aTime - bTime;
            });
        }
        setCards(filtered);
      }
      setLoading(false);
    };
    fetch();
  }, [deckId, reviewMode, selectedTopics]);

  const rateCard = async (quality: number) => {
    if (!user || currentIndex >= cards.length) return;
    const card   = cards[currentIndex];
    const result = sm2(
      quality,
      card.mastery_level,
      card.easiness_factor ?? 2.5,  // pass persisted EF
    );

    setCards((prev) =>
      prev.map((c, i) =>
        i === currentIndex
          ? {
              ...c,
              mastery_level:   result.newMasteryLevel,
              easiness_factor: result.newEasinessFactor,  // update in state
              next_review_at:  result.nextReviewAt.toISOString(),
            }
          : c,
      ),
    );

    if (quality === 5) setStats((s) => ({ ...s, easy:  s.easy  + 1 }));
    else if (quality === 4) setStats((s) => ({ ...s, good:  s.good  + 1 }));
    else if (quality === 2) setStats((s) => ({ ...s, hard:  s.hard  + 1 }));
    else                    setStats((s) => ({ ...s, again: s.again + 1 }));

    // FIX: persist to DB — if it fails, revert the state update to stay consistent
    try {
      await recordFlashcardReview({
        userId: user.id,
        cardId: card.id,
        deckId: deckId,
        quality,
        masteryLevel: result.newMasteryLevel,
        easinessFactor: result.newEasinessFactor,
        nextReviewAt: result.nextReviewAt,
      });
    } catch (dbError) {
      console.error("[FlashcardViewer] Failed to persist review:", dbError);
      // Revert state to previous values to keep UI consistent with DB
      setCards((prev) =>
        prev.map((c, i) =>
          i === currentIndex
            ? { ...c, mastery_level: card.mastery_level, easiness_factor: card.easiness_factor, next_review_at: card.next_review_at }
            : c
        )
      );
      return;
    }

    // Next card
    setFlipped(false);
    setTimeout(() => {
      if (currentIndex + 1 < cards.length) {
        setCurrentIndex((p) => p + 1);
      }
    }, 200);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  if (cards.length === 0) {
    return (
      <div className="text-center py-12">
        {reviewMode ? (
          <>
            <div className="text-5xl mb-4">🎉</div>
            <h3 className="text-lg font-semibold text-card-foreground mb-2">Nessuna carta da ripassare!</h3>
            <p className="text-sm text-muted-foreground mb-4">Hai ripassato tutte le carte in scadenza. Torna più tardi.</p>
          </>
        ) : (
          <>
            <BookOpen className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground">Nessuna flashcard trovata.</p>
          </>
        )}
        <Button variant="outline" onClick={onBack} className="mt-4">Torna indietro</Button>
      </div>
    );
  }

  if (currentIndex >= cards.length) {
    const total = stats.easy + stats.good + stats.hard + stats.again;
    return (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center py-8">
        <div className="text-5xl mb-4">🎉</div>
        <h2 className="text-2xl font-bold text-card-foreground mb-2">Sessione completata!</h2>
        <p className="text-muted-foreground mb-6">{deckTitle}</p>
        <div className="grid grid-cols-4 gap-3 max-w-sm mx-auto mb-8">
          {[
            { label: "Facile", value: stats.easy, emoji: "🎯" },
            { label: "Bene", value: stats.good, emoji: "😊" },
            { label: "Difficile", value: stats.hard, emoji: "😓" },
            { label: "Da rifare", value: stats.again, emoji: "😵" },
          ].map((s) => (
            <div key={s.label} className="bg-secondary/50 rounded-xl p-3">
              <p className="text-xl mb-1">{s.emoji}</p>
              <p className="text-lg font-bold text-card-foreground">{s.value}</p>
              <p className="text-[10px] text-muted-foreground">{s.label}</p>
            </div>
          ))}
        </div>
        <div className="flex gap-3 justify-center">
          <Button variant="outline" onClick={() => { setCurrentIndex(0); setFlipped(false); setStats({ easy: 0, good: 0, hard: 0, again: 0 }); }}>
            <RotateCcw className="h-4 w-4 mr-2" /> Rifai
          </Button>
          <Button onClick={onBack}>Torna indietro</Button>
        </div>
      </motion.div>
    );
  }

  const card = cards[currentIndex];
  const progress = ((currentIndex + 1) / cards.length) * 100;

  // Mastery indicator
  const masteryLabels = ["Nuova", "Apprendimento", "Ripasso", "Buona", "Ottima", "Padroneggiata"];
  const safeMasteryLevel = Math.max(0, Math.min(card.mastery_level || 0, masteryLabels.length - 1));
  
  const masteryColors = [
    "bg-muted text-muted-foreground",
    "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
    "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400",
    "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
    "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
    "bg-primary/10 text-primary",
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-muted-foreground">{card.topic}</p>
          <p className="text-sm font-medium text-card-foreground">
            {currentIndex + 1} di {cards.length}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge className={`text-[10px] ${masteryColors[safeMasteryLevel]}`} variant="secondary">
            {masteryLabels[safeMasteryLevel]}
          </Badge>
          {card.next_review_at && (
            <span className="text-[10px] text-muted-foreground flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {isDueForReview(card.next_review_at) ? "Ora" : new Date(card.next_review_at).toLocaleDateString("it-IT")}
            </span>
          )}
        </div>
      </div>

      <Progress value={progress} className="h-1.5" />

      {/* Flashcard */}
      <div className="perspective-1000" style={{ perspective: "1000px" }}>
        <motion.div
          onClick={() => setFlipped(!flipped)}
          className="relative w-full cursor-pointer"
          style={{ transformStyle: "preserve-3d" }}
          animate={{ rotateY: flipped ? 180 : 0 }}
          transition={{ duration: 0.4 }}
        >
          {/* Front */}
          <div
            className={`w-full min-h-[250px] rounded-2xl border-2 border-border p-8 flex flex-col items-center justify-center text-center ${flipped ? "invisible" : ""}`}
            style={{ backfaceVisibility: "hidden" }}
          >
            <p className="text-lg font-semibold text-card-foreground">{card.front}</p>
            <p className="text-xs text-muted-foreground mt-4">Tocca per girare</p>
          </div>

          {/* Back */}
          <div
            className={`w-full min-h-[250px] rounded-2xl border-2 border-primary/30 bg-primary/5 p-8 flex flex-col items-center justify-center text-center absolute top-0 left-0 ${!flipped ? "invisible" : ""}`}
            style={{ backfaceVisibility: "hidden", transform: "rotateY(180deg)" }}
          >
            <p className="text-lg text-card-foreground">{card.back}</p>
          </div>
        </motion.div>
      </div>

      {/* SM-2 Quality Rating Buttons */}
      {flipped && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-2">
          <p className="text-xs text-muted-foreground text-center">Quanto bene la sapevi?</p>
          <div className="grid grid-cols-4 gap-2">
            {QUALITY_OPTIONS.map((opt) => (
              <Button
                key={opt.value}
                variant={opt.color}
                size="sm"
                className="flex flex-col items-center gap-0.5 h-auto py-2.5"
                onClick={() => rateCard(opt.value)}
              >
                <span className="text-base">{opt.emoji}</span>
                <span className="text-[10px] leading-tight">{opt.label}</span>
              </Button>
            ))}
          </div>
        </motion.div>
      )}

      {/* Navigation */}
      <div className="flex justify-between">
        <Button
          variant="ghost"
          size="sm"
          disabled={currentIndex === 0}
          onClick={() => { setCurrentIndex((p) => p - 1); setFlipped(false); }}
        >
          <ChevronLeft className="h-4 w-4 mr-1" /> Precedente
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={currentIndex >= cards.length - 1}
          onClick={() => { setCurrentIndex((p) => p + 1); setFlipped(false); }}
        >
          Successiva <ChevronRight className="h-4 w-4 ml-1" />
        </Button>
      </div>
    </div>
  );
};

export default FlashcardViewer;
