/**
 * WeakTopicsQuizPlayer — quiz inline che usa domande filtrate per ID
 * (non un quizId completo — usa le domande sbagliate dell'utente).
 * Riusa la UI di QuizPlayer ma con un dataset personalizzato.
 */
import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { CheckCircle2, XCircle, ArrowRight, Trophy, RotateCcw, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { playCorrectSound, playWrongSound, playCompletionSound, fireCompletionConfetti } from "@/lib/soundEffects";
import { recordQuestionProgress } from "@/lib/progression";

interface Question {
  quiz_id: string;
  id: string; question: string; options: string[];
  correct_answer: number; explanation: string; topic: string; points: number;
}

interface WeakTopicsQuizPlayerProps {
  questionIds: string[];
  onBack: () => void;
}

export default function WeakTopicsQuizPlayer({ questionIds, onBack }: WeakTopicsQuizPlayerProps) {
  const { user }                        = useAuth();
  const [questions, setQuestions]       = useState<Question[]>([]);
  const [current, setCurrent]           = useState(0);
  const [selected, setSelected]         = useState<number | null>(null);
  const [showResult, setShowResult]     = useState(false);
  const [score, setScore]               = useState(0);
  const [correct, setCorrect]           = useState(0);
  const [finished, setFinished]         = useState(false);
  const [loading, setLoading]           = useState(true);

  useEffect(() => {
    if (questionIds.length === 0) return;
    supabase
      .from("quiz_questions")
      .select("id, quiz_id, question, options, correct_answer, explanation, topic, points")
      .in("id", questionIds)
      .limit(20)
      .then(({ data }) => {
        if (data) {
          // Shuffle
          const shuffled = [...data].sort(() => Math.random() - 0.5) as Question[];
          setQuestions(shuffled);
        }
        setLoading(false);
      });
  }, [questionIds]);

  const handleAnswer = useCallback(async (idx: number) => {
    if (selected !== null || !user) return;
    const q = questions[current];
    setSelected(idx);
    setShowResult(true);

    const isCorrect = idx === q.correct_answer;
    if (isCorrect) {
      playCorrectSound();
      setScore(s => s + (q.points || 10));
      setCorrect(c => c + 1);
    } else {
      playWrongSound();
    }

    // Record progress
    await recordQuestionProgress({
      userId: user.id,
      quizId: q.quiz_id,
      questionId: q.id,
      isCorrect,
      selectedAnswer: idx,
    }).catch((err) => {
      console.warn("[WeakTopicsQuizPlayer] Failed to record progress:", err);
    });
  }, [selected, questions, current, user]);

  const next = useCallback(() => {
    if (current >= questions.length - 1) {
      setFinished(true);
      playCompletionSound();
      fireCompletionConfetti();
    } else {
      setCurrent(c => c + 1);
      setSelected(null);
      setShowResult(false);
    }
  }, [current, questions.length]);

  if (loading) return (
    <div className="flex items-center justify-center py-20">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
    </div>
  );

  if (questions.length === 0) return (
    <div className="text-center py-16">
      <p className="text-muted-foreground">Nessuna domanda trovata. Genera prima dei quiz!</p>
      <Button onClick={onBack} className="mt-4">Torna alla Dashboard</Button>
    </div>
  );

  if (finished) {
    const pct = Math.round((correct / questions.length) * 100);
    return (
      <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
        className="text-center space-y-6 py-8">
        <div className="text-6xl">{pct >= 70 ? "🏆" : pct >= 50 ? "💪" : "📚"}</div>
        <div>
          <p className="text-2xl font-bold text-foreground">{correct}/{questions.length} corrette</p>
          <p className="text-muted-foreground mt-1">
            {pct >= 70 ? "Ottimo miglioramento sui tuoi punti deboli!" : "Continua a esercitarti su questi argomenti."}
          </p>
        </div>
        <div className="flex gap-3 justify-center flex-wrap">
          <Button onClick={() => { setCurrent(0); setSelected(null); setShowResult(false); setFinished(false); setScore(0); setCorrect(0); }} variant="outline" className="gap-2">
            <RotateCcw className="h-4 w-4" /> Rifai
          </Button>
          <Button onClick={onBack} className="gap-2">
            <Trophy className="h-4 w-4" /> Fine
          </Button>
        </div>
      </motion.div>
    );
  }

  const q = questions[current];
  const progressPct = (current / questions.length) * 100;

  return (
    <div className="space-y-6">
      {/* Progress */}
      <div className="space-y-2">
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>{current + 1} / {questions.length}</span>
          <Badge variant="outline" className="text-xs">{q.topic}</Badge>
          <span>{score} pts</span>
        </div>
        <Progress value={progressPct} className="h-1.5" />
      </div>

      {/* Question */}
      <motion.div
        key={current}
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        className="bg-card rounded-xl border border-border p-5"
      >
        <p className="text-base font-semibold text-card-foreground leading-relaxed">{q.question}</p>
      </motion.div>

      {/* Options */}
      <div className="space-y-2.5">
        {q.options.map((opt, idx) => {
          const isSelected = selected === idx;
          const isCorrect = idx === q.correct_answer;
          const showFeedback = showResult;
          return (
            <motion.button
              key={idx}
              whileTap={!showFeedback ? { scale: 0.98 } : {}}
              onClick={() => handleAnswer(idx)}
              disabled={!!showFeedback}
              className={`w-full text-left px-4 py-3.5 rounded-xl border text-sm font-medium transition-all ${
                !showFeedback
                  ? "border-border hover:border-primary/50 hover:bg-secondary/50 active:bg-secondary"
                  : isCorrect
                  ? "border-green-500/50 bg-green-500/10 text-green-700 dark:text-green-400"
                  : isSelected
                  ? "border-destructive/50 bg-destructive/10 text-destructive"
                  : "border-border opacity-50"
              }`}
            >
              <div className="flex items-center gap-3">
                <span className={`h-6 w-6 rounded-full border flex items-center justify-center text-xs shrink-0 font-bold ${
                  !showFeedback ? "border-border text-muted-foreground"
                  : isCorrect ? "border-green-500 text-green-600"
                  : isSelected ? "border-destructive text-destructive"
                  : "border-border text-muted-foreground"
                }`}>
                  {["A","B","C","D"][idx]}
                </span>
                <span>{opt}</span>
                {showFeedback && isCorrect && <CheckCircle2 className="h-4 w-4 text-green-500 ml-auto shrink-0" />}
                {showFeedback && isSelected && !isCorrect && <XCircle className="h-4 w-4 text-destructive ml-auto shrink-0" />}
              </div>
            </motion.button>
          );
        })}
      </div>

      {/* Explanation + Next */}
      <AnimatePresence>
        {showResult && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
            className="space-y-3">
            {q.explanation && (
              <div className="bg-secondary/50 rounded-xl p-3">
                <p className="text-xs text-muted-foreground font-medium mb-1">💡 Spiegazione</p>
                <p className="text-sm text-card-foreground">{q.explanation}</p>
              </div>
            )}
            <Button onClick={next} className="w-full gap-2 h-11">
              {current >= questions.length - 1 ? (
                <><Trophy className="h-4 w-4" /> Vedi risultati</>
              ) : (
                <>Prossima <ArrowRight className="h-4 w-4" /></>
              )}
            </Button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
