import { useState, useEffect, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { motion, AnimatePresence } from "framer-motion";
import { CheckCircle2, XCircle, ArrowRight, Trophy, RotateCcw, Sparkles, BookOpen } from "lucide-react";

interface Question {
  id: string;
  question: string;
  options: string[];
  correct_answer: number;
  explanation: string;
  topic: string;
  points: number;
  sort_order: number;
}

const SharedQuiz = () => {
  const { token } = useParams<{ token: string }>();
  const [quizTitle, setQuizTitle] = useState("");
  const [questions, setQuestions] = useState<Question[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [started, setStarted] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState<number | null>(null);
  const [showResult, setShowResult] = useState(false);
  const [score, setScore] = useState(0);
  const [correctCount, setCorrectCount] = useState(0);
  const [finished, setFinished] = useState(false);
  const [startTime, setStartTime] = useState(0);
  const [creatorName, setCreatorName] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    const fetchQuiz = async () => {
      const { data: quiz } = await supabase
        .from("quizzes")
        .select("id, title, total_questions, user_id")
        .eq("share_token", token)
        .maybeSingle();

      if (!quiz) { setNotFound(true); setLoading(false); return; }

      setQuizTitle(quiz.title);

      // Fetch creator name
      const { data: profile } = await supabase
        .from("profiles")
        .select("full_name")
        .eq("user_id", quiz.user_id)
        .maybeSingle();
      if (profile?.full_name) setCreatorName(profile.full_name);

      const { data: qs } = await supabase
        .from("quiz_questions")
        .select("id, question, options, correct_answer, explanation, topic, points, sort_order")
        .eq("quiz_id", quiz.id)
        .order("sort_order");

      if (qs) {
        const shuffled = [...qs].sort(() => Math.random() - 0.5) as Question[];
        setQuestions(shuffled);
      }
      setLoading(false);
    };
    fetchQuiz();
  }, [token]);

  const handleStart = () => {
    setStarted(true);
    setStartTime(Date.now());
  };

  const handleAnswer = useCallback((index: number) => {
    if (showResult || questions.length === 0) return;
    setSelectedAnswer(index);
    setShowResult(true);
    const q = questions[currentIndex];
    if (index === q.correct_answer) {
      setScore(p => p + q.points);
      setCorrectCount(p => p + 1);
    }
  }, [showResult, questions, currentIndex]);

  const nextQuestion = () => {
    if (currentIndex + 1 >= questions.length) {
      setFinished(true);
      return;
    }
    setCurrentIndex(p => p + 1);
    setSelectedAnswer(null);
    setShowResult(false);
  };

  if (loading) return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
    </div>
  );

  if (notFound) return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <div className="text-center max-w-md">
        <BookOpen className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
        <h1 className="text-2xl font-bold text-foreground mb-2">Quiz non trovato</h1>
        <p className="text-muted-foreground mb-6">Questo link non è valido o il quiz non è più condiviso.</p>
        <Button asChild><Link to="/">Vai alla home</Link></Button>
      </div>
    </div>
  );

  // Landing page before starting
  if (!started) return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="max-w-md w-full text-center">
        <div className="bg-card rounded-2xl border border-border shadow-lg p-8 space-y-6">
          <div className="bg-primary/10 rounded-full w-16 h-16 flex items-center justify-center mx-auto">
            <Sparkles className="h-8 w-8 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-card-foreground">{quizTitle}</h1>
            {creatorName && <p className="text-sm text-muted-foreground mt-1">Condiviso da {creatorName}</p>}
            <div className="flex items-center justify-center gap-3 mt-3">
              <Badge variant="secondary">{questions.length} domande</Badge>
            </div>
          </div>
          <Button size="lg" className="w-full text-base" onClick={handleStart}>
            <Trophy className="h-5 w-5 mr-2" /> Inizia il Quiz
          </Button>
          <p className="text-xs text-muted-foreground">Generato con <span className="font-semibold text-primary">FocusEd</span> — AI per lo studio</p>
        </div>
      </motion.div>
    </div>
  );

  // Finished — show results + CTA
  if (finished) {
    const percentage = Math.round((correctCount / questions.length) * 100);
    const timeTaken = Math.round((Date.now() - startTime) / 1000);
    const minutes = Math.floor(timeTaken / 60);
    const seconds = timeTaken % 60;

    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4">
        <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="max-w-md w-full">
          <div className="bg-card rounded-2xl border border-border shadow-lg p-8 text-center space-y-6">
            <Trophy className="h-12 w-12 text-primary mx-auto" />
            <h2 className="text-2xl font-bold text-card-foreground">Quiz completato!</h2>
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-secondary rounded-xl p-3">
                <p className="text-xl font-bold text-card-foreground">{correctCount}/{questions.length}</p>
                <p className="text-xs text-muted-foreground">Corrette</p>
              </div>
              <div className="bg-secondary rounded-xl p-3">
                <p className="text-xl font-bold text-primary">{percentage}%</p>
                <p className="text-xs text-muted-foreground">Precisione</p>
              </div>
              <div className="bg-secondary rounded-xl p-3">
                <p className="text-xl font-bold text-card-foreground">{score}</p>
                <p className="text-xs text-muted-foreground">Punti</p>
              </div>
              <div className="bg-secondary rounded-xl p-3">
                <p className="text-xl font-bold text-card-foreground">{minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`}</p>
                <p className="text-xs text-muted-foreground">Tempo</p>
              </div>
            </div>

            <Button variant="outline" onClick={() => {
              setStarted(false);
              setCurrentIndex(0);
              setSelectedAnswer(null);
              setShowResult(false);
              setScore(0);
              setCorrectCount(0);
              setFinished(false);
              setQuestions(prev => [...prev].sort(() => Math.random() - 0.5));
            }} className="w-full">
              <RotateCcw className="h-4 w-4 mr-2" /> Rigioca
            </Button>

            {/* CTA Registration */}
            <div className="bg-primary/5 border border-primary/20 rounded-xl p-5 space-y-3">
              <h3 className="font-semibold text-card-foreground">Ti è piaciuto? Crea i tuoi quiz con l'AI! 🚀</h3>
              <p className="text-sm text-muted-foreground">
                Carica qualsiasi documento e FocusEd genera quiz, flashcard, riassunti e mappe concettuali automaticamente.
              </p>
              <Button asChild className="w-full">
                <Link to="/auth">
                  <Sparkles className="h-4 w-4 mr-2" /> Registrati gratis
                </Link>
              </Button>
            </div>
          </div>
        </motion.div>
      </div>
    );
  }

  // Active quiz
  const q = questions[currentIndex];
  const progress = ((currentIndex + 1) / questions.length) * 100;

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4 py-8">
      <div className="max-w-lg w-full space-y-6">
        {/* Header */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>{quizTitle}</span>
            <span>{currentIndex + 1}/{questions.length}</span>
          </div>
          <Progress value={progress} className="h-2" />
        </div>

        {/* Question */}
        <AnimatePresence mode="wait">
          <motion.div key={currentIndex} initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.2 }}>
            <div className="bg-card rounded-2xl border border-border shadow-lg p-6 space-y-5">
              {q.topic && <Badge variant="secondary" className="text-xs">{q.topic}</Badge>}
              <h2 className="text-lg font-semibold text-card-foreground leading-snug">{q.question}</h2>
              <div className="space-y-2.5">
                {(q.options as string[]).map((opt, i) => {
                  const isSelected = selectedAnswer === i;
                  const isCorrect = i === q.correct_answer;
                  let variant = "outline" as "outline" | "default" | "destructive";
                  let extraClass = "justify-start text-left h-auto py-3 px-4 text-sm font-normal";

                  if (showResult) {
                    if (isCorrect) {
                      variant = "default";
                      extraClass += " bg-primary text-primary-foreground";
                    } else if (isSelected && !isCorrect) {
                      variant = "destructive";
                    }
                  } else if (isSelected) {
                    extraClass += " border-primary ring-2 ring-primary/20";
                  }

                  return (
                    <Button
                      key={i}
                      variant={variant}
                      className={`w-full ${extraClass}`}
                      onClick={() => !showResult && handleAnswer(i)}
                      disabled={showResult}
                    >
                      <span className="mr-2 font-semibold text-xs opacity-60">{String.fromCharCode(65 + i)}.</span>
                      {opt}
                      {showResult && isCorrect && <CheckCircle2 className="h-4 w-4 ml-auto shrink-0" />}
                      {showResult && isSelected && !isCorrect && <XCircle className="h-4 w-4 ml-auto shrink-0" />}
                    </Button>
                  );
                })}
              </div>

              {/* Explanation */}
              {showResult && q.explanation && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }}
                  className="bg-secondary rounded-xl p-4 text-sm text-muted-foreground">
                  <p className="font-medium text-card-foreground mb-1">Spiegazione:</p>
                  {q.explanation}
                </motion.div>
              )}

              {showResult && (
                <Button onClick={nextQuestion} className="w-full">
                  {currentIndex + 1 >= questions.length ? "Vedi risultati" : "Prossima domanda"}
                  <ArrowRight className="h-4 w-4 ml-2" />
                </Button>
              )}
            </div>
          </motion.div>
        </AnimatePresence>

        <p className="text-center text-xs text-muted-foreground">
          Generato con <Link to="/" className="text-primary font-medium hover:underline">FocusEd</Link>
        </p>
      </div>
    </div>
  );
};

export default SharedQuiz;
