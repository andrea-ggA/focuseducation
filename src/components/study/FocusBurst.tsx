import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Zap, X, Clock, Trophy, Brain, ChevronRight, Layers } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { sm2, QUALITY_OPTIONS } from "@/lib/spacedRepetition";
import { playCorrectSound, playWrongSound, playCompletionSound, fireCompletionConfetti } from "@/lib/soundEffects";
import { recordFlashcardReview } from "@/lib/progression";
import { useToast } from "@/hooks/use-toast";

const BURST_DURATION = 5 * 60;
const MAX_CARDS      = 8;
const MAX_QUESTIONS  = 4;

interface BurstCard {
  type: "flashcard";
  id: string; front: string; back: string; topic: string | null;
  deck_id: string; mastery_level: number; easiness_factor: number; next_review_at: string | null;
}
interface BurstQuestion {
  type: "question";
  id: string; question: string; options: string[];
  correct_answer: number; explanation: string; topic: string;
}
type BurstItem = BurstCard | BurstQuestion;
interface DeckIdRow { id: string; }
interface QuizIdRow { id: string; }
interface BurstCardRow {
  id: string;
  front: string;
  back: string;
  topic: string | null;
  deck_id: string;
  mastery_level: number;
  easiness_factor: number | null;
  next_review_at: string | null;
}
interface QuizQuestionRow {
  id: string;
  question: string;
  options: unknown;
  correct_answer: number;
  explanation: string;
  topic: string;
}

interface FocusBurstProps {
  onClose:    () => void;
  onComplete: (stats: { cards: number; questions: number; score: number }) => void;
}

export default function FocusBurst({ onClose, onComplete }: FocusBurstProps) {
  const { user }                      = useAuth();
  const { toast }                     = useToast();
  const [items, setItems]             = useState<BurstItem[]>([]);
  const [current, setCurrent]         = useState(0);
  const [flipped, setFlipped]         = useState(false);
  const [answered, setAnswered]       = useState<number | null>(null);
  const [loading, setLoading]         = useState(false); // start false — show selector first
  const [started, setStarted]         = useState(false);
  const [decks, setDecks]             = useState<{id:string;title:string;topic:string|null}[]>([]);
  const [selectedDeckId, setSelectedDeckId] = useState<string>("all");
  const [loadingDecks, setLoadingDecks] = useState(true);
  const [timeLeft, setTimeLeft]       = useState(BURST_DURATION);
  const [done, setDone]               = useState(false);
  const [score, setScore]             = useState(0);
  const [correctCount, setCorrectCount] = useState(0);
  const timerRef                      = useRef<ReturnType<typeof setInterval>>();

  // Load decks list for selector
  useEffect(() => {
    if (!user) return;
    supabase.from("flashcard_decks").select("id,title,topic").eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .then(({ data }) => { setDecks(data || []); setLoadingDecks(false); });
  }, [user]);

  // Load cards only after user taps Start (not on mount)
  const startBurst = async () => {
    if (!user) return;
    setItems([]);
    setCurrent(0);
    setFlipped(false);
    setAnswered(null);
    setDone(false);
    setScore(0);
    setCorrectCount(0);
    setTimeLeft(BURST_DURATION);
    setLoading(true);
    setStarted(true);
    const load = async () => {
      // BUG FIX: two-step query — get deck IDs first, then filter flashcards by deck_id
      const { data: userDecks } = await supabase
        .from("flashcard_decks").select("id").eq("user_id", user.id);
      const deckIds = ((userDecks || []) as DeckIdRow[]).map((d) => d.id);

      const [cardsRes, questionsRes] = await Promise.allSettled([
        deckIds.length === 0
          ? Promise.resolve({ data: [] })
          : supabase
            .from("flashcards")
            .select("id,front,back,topic,deck_id,mastery_level,easiness_factor,next_review_at")
            .in("deck_id", selectedDeckId !== "all" ? [selectedDeckId] : deckIds)
            .or(`next_review_at.is.null,next_review_at.lte.${new Date().toISOString()}`)
            .order("easiness_factor", { ascending: true })
            .limit(MAX_CARDS),
        // BUG FIX: two-step — get quiz IDs first, then questions
        supabase
          .from("quizzes")
          .select("id")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false })
          .limit(10),
      ]);

      const burst: BurstItem[] = [];
      if (cardsRes.status === "fulfilled" && cardsRes.value.data) {
        for (const c of ((cardsRes.value.data || []) as BurstCardRow[]).slice(0, MAX_CARDS)) {
          burst.push({ type:"flashcard", id:c.id, front:c.front, back:c.back, topic:c.topic,
            deck_id:c.deck_id, mastery_level:c.mastery_level, easiness_factor:c.easiness_factor??2.5, next_review_at:c.next_review_at });
        }
      }
      if (questionsRes.status === "fulfilled" && questionsRes.value.data) {
        const quizIds = (questionsRes.value.data as QuizIdRow[]).map((q) => q.id);
        if (quizIds.length > 0) {
          // Step 2: fetch questions from those quizzes — no join filter needed
          const { data: qData } = await supabase
            .from("quiz_questions")
            .select("id,question,options,correct_answer,explanation,topic")
            .in("quiz_id", quizIds)
            .order("created_at", { ascending: false })
            .limit(MAX_QUESTIONS * 4);
          const pool = ((qData || []) as QuizQuestionRow[]).sort(() => Math.random() - 0.5).slice(0, MAX_QUESTIONS);
          for (const q of pool) {
            burst.push({ type:"question", id:q.id, question:q.question, options:Array.isArray(q.options) ? q.options.filter((opt): opt is string => typeof opt === "string") : [],
              correct_answer:q.correct_answer, explanation:q.explanation, topic:q.topic });
          }
        }
      }
      // Interleave
      const cards = burst.filter(i => i.type==="flashcard");
      const qs    = burst.filter(i => i.type==="question");
      const mixed: BurstItem[] = [];
      for (let i = 0; i < Math.max(cards.length, qs.length); i++) {
        if (cards[i]) mixed.push(cards[i]);
        if (qs[i])    mixed.push(qs[i]);
      }
      setItems(mixed);
      setLoading(false);
    };
    try {
      await load();
    } catch (error) {
      console.error("[FocusBurst] start failed:", error);
      setItems([]);
      setStarted(false);
      setLoading(false);
      toast({
        title: "Focus Burst non disponibile",
        description: "Impossibile preparare la sessione. Riprova.",
        variant: "destructive",
      });
    }
  };

  const finishBurst = useCallback(() => {
    clearInterval(timerRef.current);
    playCompletionSound(); fireCompletionConfetti();
    setDone(true);
    if (user) {
      supabase.from("focus_burst_sessions").insert({
        user_id: user.id,
        cards_reviewed: items.filter(i=>i.type==="flashcard").length,
        questions_answered: items.filter(i=>i.type==="question").length,
        duration_seconds: BURST_DURATION - timeLeft,
        completed: true,
      });
    }
  }, [user, items, timeLeft]);

  useEffect(() => {
    if (!started || loading || done) return;
    timerRef.current = setInterval(() => {
      setTimeLeft(t => { if (t <= 1) { clearInterval(timerRef.current); finishBurst(); return 0; } return t-1; });
    }, 1000);
    return () => clearInterval(timerRef.current);
  }, [started, loading, done, finishBurst]);

  const handleFlashcardRate = async (quality: number) => {
    const item = items[current] as BurstCard;
    const result = sm2(quality, item.mastery_level, item.easiness_factor);
    try {
      if (!user) throw new Error("Utente non autenticato");
      await recordFlashcardReview({
        userId: user.id,
        cardId: item.id,
        deckId: item.deck_id,
        quality,
        masteryLevel: result.newMasteryLevel,
        easinessFactor: result.newEasinessFactor,
        nextReviewAt: result.nextReviewAt,
      });
    } catch (error) {
      console.error("[FocusBurst] flashcard review failed:", error);
      toast({
        title: "Salvataggio non riuscito",
        description: "La revisione della flashcard non è stata salvata. Riprova.",
        variant: "destructive",
      });
      return;
    }
    if (quality >= 4) { playCorrectSound(); setCorrectCount(c=>c+1); setScore(s=>s+10); }
    else playWrongSound();
    setFlipped(false);
    setTimeout(() => advanceItem(), 300);
  };

  const handleQuestionAnswer = async (idx: number) => {
    if (answered !== null) return;
    const item = items[current] as BurstQuestion;
    setAnswered(idx);
    if (idx === item.correct_answer) { playCorrectSound(); setCorrectCount(c=>c+1); setScore(s=>s+15); }
    else playWrongSound();
    setTimeout(() => { setAnswered(null); advanceItem(); }, 1600);
  };

  const advanceItem = () => {
    if (current + 1 >= items.length) { finishBurst(); return; }
    setCurrent(p=>p+1); setFlipped(false);
  };

  const mins = Math.floor(timeLeft/60);
  const secs = timeLeft % 60;
  const progressPct = items.length > 0 ? Math.round((current/items.length)*100) : 0;
  const availableDecks = selectedDeckId === "all" ? decks.length : decks.filter((deck) => deck.id === selectedDeckId).length;

  if (loading) return (
    <div className="fixed inset-0 z-50 bg-background flex items-center justify-center">
      <div className="text-center space-y-3">
        <Zap className="h-10 w-10 text-primary animate-bounce mx-auto" />
        <p className="text-sm text-muted-foreground">Preparando il Focus Burst...</p>
      </div>
    </div>
  );

  if (!started) return (
    <div className="fixed inset-0 z-50 bg-background flex items-center justify-center p-6">
      <div className="bg-card border border-border rounded-2xl shadow-card p-5 w-full max-w-md space-y-4">
        <div className="text-center space-y-2">
          <div className="mx-auto h-12 w-12 rounded-2xl bg-primary/10 flex items-center justify-center">
            <Brain className="h-6 w-6 text-primary" />
          </div>
          <h2 className="text-xl font-bold text-foreground">Avvia Focus Burst</h2>
          <p className="text-sm text-muted-foreground">
            Sessione rapida da 5 minuti con flashcard e quiz, senza perdere tempo prima di iniziare.
          </p>
        </div>

        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">Deck da usare</p>
          <Select value={selectedDeckId} onValueChange={setSelectedDeckId} disabled={loadingDecks}>
            <SelectTrigger>
              <SelectValue placeholder={loadingDecks ? "Caricamento deck..." : "Seleziona deck"} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tutti i deck</SelectItem>
              {decks.map((deck) => (
                <SelectItem key={deck.id} value={deck.id}>
                  {deck.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-[11px] text-muted-foreground">
            {loadingDecks ? "Sto caricando i tuoi deck..." : `${availableDecks} deck disponibili per la sessione.`}
          </p>
        </div>

        <div className="flex gap-3">
          <Button variant="outline" className="flex-1" onClick={onClose}>Annulla</Button>
          <Button className="flex-1" onClick={startBurst} disabled={loadingDecks}>
            <Zap className="h-4 w-4 mr-2" /> Inizia
          </Button>
        </div>
      </div>
    </div>
  );

  if (items.length === 0) return (
    <div className="fixed inset-0 z-50 bg-background flex items-center justify-center p-6">
      <div className="text-center space-y-4 max-w-sm w-full">
        <div className="text-5xl">🎉</div>
        <h2 className="text-xl font-bold text-foreground">Tutto in pari!</h2>
        <p className="text-sm text-muted-foreground">Crea nuovo materiale in Studio AI.</p>
        <Button onClick={onClose} className="w-full">Chiudi</Button>
      </div>
    </div>
  );

  if (done) {
    const total    = items.length;
    const accuracy = total > 0 ? Math.round((correctCount/total)*100) : 0;
    return (
      <div className="fixed inset-0 z-50 bg-background flex flex-col items-center justify-center gap-5 p-6">
        <div className="text-5xl">{accuracy >= 80 ? "🏆" : accuracy >= 60 ? "⚡" : "💪"}</div>
        <div className="text-center">
          <h2 className="text-2xl font-bold text-foreground">Focus Burst completato!</h2>
          <p className="text-muted-foreground mt-1">{Math.round((BURST_DURATION-timeLeft)/60)} min di studio intenso</p>
        </div>
        <div className="grid grid-cols-3 gap-3 w-full max-w-xs">
          {[
            { label:"Punteggio", value:score,        suffix:"pt" },
            { label:"Accuracy",  value:accuracy,     suffix:"%" },
            { label:"Corretti",  value:correctCount,  suffix:`/${total}` },
          ].map(s => (
            <div key={s.label} className="bg-card border border-border rounded-xl p-3 text-center">
              <p className="text-xl font-bold text-primary">{s.value}<span className="text-xs text-muted-foreground">{s.suffix}</span></p>
              <p className="text-[10px] text-muted-foreground">{s.label}</p>
            </div>
          ))}
        </div>
        <Button size="lg" className="w-full max-w-xs"
          onClick={() => onComplete({ cards:items.filter(i=>i.type==="flashcard").length, questions:items.filter(i=>i.type==="question").length, score })}>
          <Trophy className="h-4 w-4 mr-2" /> Fatto
        </Button>
      </div>
    );
  }

  const item = items[current];

  return (
    <div className="fixed inset-0 z-50 bg-background flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-3 border-b border-border safe-top">
        <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0" onClick={onClose}>
          <X className="h-5 w-5" />
        </Button>
        <div className={`flex items-center gap-1.5 font-mono font-bold text-sm px-2.5 py-1 rounded-lg shrink-0 ${
          timeLeft <= 60 ? "bg-destructive/10 text-destructive" :
          timeLeft <= 120 ? "bg-orange-500/10 text-orange-500" : "bg-primary/10 text-primary"
        }`}>
          <Clock className="h-3.5 w-3.5" />
          {mins}:{secs.toString().padStart(2,"0")}
        </div>
        <div className="flex-1"><Progress value={progressPct} className="h-1.5" /></div>
        <div className="flex items-center gap-1 text-sm font-bold text-primary shrink-0">
          <Zap className="h-4 w-4" />{score}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto flex flex-col items-center justify-start sm:justify-center px-4 py-5 max-w-lg mx-auto w-full">
        <div className="flex items-center gap-2 mb-4">
          <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full ${
            item.type==="flashcard" ? "bg-primary/10 text-primary" : "bg-accent/10 text-accent"
          }`}>
            {item.type==="flashcard" ? "🃏 Flashcard" : "❓ Quiz"}
          </span>
          {item.topic && <span className="text-[10px] text-muted-foreground truncate max-w-[120px]">{item.topic}</span>}
        </div>

        <AnimatePresence mode="wait">
          {item.type === "flashcard" ? (
            <motion.div key={`${current}-${flipped}`}
              initial={{ opacity:0, y:20 }} animate={{ opacity:1, y:0 }} className="w-full">
              <div onClick={() => !flipped && setFlipped(true)}
                className="bg-card border border-border rounded-2xl p-6 text-center cursor-pointer min-h-[150px] flex flex-col items-center justify-center gap-3 shadow-card active:scale-[0.99] transition-transform">
                {!flipped ? (
                  <><p className="text-base font-semibold text-card-foreground">{(item as BurstCard).front}</p>
                  <p className="text-xs text-muted-foreground">Tocca per girare</p></>
                ) : (
                  <><p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">Risposta</p>
                  <p className="text-sm text-card-foreground">{(item as BurstCard).back}</p></>
                )}
              </div>
              {flipped ? (
                <motion.div initial={{ opacity:0, y:8 }} animate={{ opacity:1, y:0 }}
                  className="grid grid-cols-4 gap-2 mt-4">
                  {QUALITY_OPTIONS.map(opt => (
                    <Button key={opt.value} variant="outline"
                      className="flex-col h-auto py-3 gap-1 active:scale-95 transition-transform"
                      onClick={() => handleFlashcardRate(opt.value)}>
                      <span className="text-lg">{opt.emoji}</span>
                      <span className="text-[10px] text-muted-foreground">{opt.label}</span>
                    </Button>
                  ))}
                </motion.div>
              ) : (
                <Button className="w-full mt-4" onClick={() => setFlipped(true)}>Mostra risposta</Button>
              )}
            </motion.div>
          ) : (
            <motion.div key={current} initial={{ opacity:0, x:40 }} animate={{ opacity:1, x:0 }} className="w-full space-y-3">
              <div className="bg-card border border-border rounded-2xl p-5 shadow-card">
                <p className="text-sm sm:text-base font-semibold text-card-foreground text-center">
                  {(item as BurstQuestion).question}
                </p>
              </div>
              <div className="space-y-2">
                {(item as BurstQuestion).options.map((opt, idx) => {
                  const q = item as BurstQuestion;
                  const isRight = idx === q.correct_answer;
                  const isWrong = answered === idx && !isRight;
                  return (
                    <button key={idx} onClick={() => handleQuestionAnswer(idx)}
                      disabled={answered !== null}
                      className={`w-full text-left p-3 rounded-xl border text-sm transition-all active:scale-[0.99] ${
                        answered===null ? "border-border bg-card hover:border-primary/50 hover:bg-primary/5"
                        : isRight ? "border-primary bg-primary/10 text-primary font-medium"
                        : isWrong ? "border-destructive bg-destructive/10 text-destructive"
                        : "border-border bg-card opacity-50"
                      }`}>
                      <span className="font-medium mr-2">{String.fromCharCode(65+idx)}.</span>{opt}
                    </button>
                  );
                })}
              </div>
              {answered !== null && (
                <motion.p initial={{ opacity:0 }} animate={{ opacity:1 }}
                  className="text-xs text-muted-foreground bg-secondary/50 rounded-lg p-3 italic">
                  {(item as BurstQuestion).explanation}
                </motion.p>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
