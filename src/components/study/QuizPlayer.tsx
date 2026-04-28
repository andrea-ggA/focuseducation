import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { CheckCircle2, XCircle, ArrowRight, Trophy, RotateCcw, Clock, Zap, Shield } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { motion, AnimatePresence } from "framer-motion";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { playCorrectSound, playWrongSound, playCompletionSound, fireCorrectConfetti, fireCompletionConfetti, playComboUpSound, playHyperActivateSound, playComboBreakSound } from "@/lib/soundEffects";
import QuizQuestionFeedback from "@/components/study/QuizQuestionFeedback";
import { awardUserXp, recordQuestionProgress, recordQuizAttempt } from "@/lib/progression";
import { getLocalDateString } from "@/lib/datetime";

interface Question {
  id: string;
  question: string;
  options: string[];
  correct_answer: number;
  explanation: string;
  topic: string;
  points: number;
  time_limit_seconds: number;
  sort_order: number;
  source_reference: string | null;
}

interface QuizPlayerProps {
  quizId: string;
  isGamified?: boolean;
  selectedTopics?: string[] | null;
  customTimerSeconds?: number;
  xpBet?: number;
  onBack: () => void;
}

interface ActivePowerUps {
  xp_boost_2x: boolean;
  extra_time: boolean;
  streak_multiplier: boolean;
}

const QuizPlayer = ({ quizId, isGamified = false, selectedTopics, customTimerSeconds, xpBet, onBack }: QuizPlayerProps) => {
  const { user } = useAuth();
  const [questions, setQuestions] = useState<Question[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState<number | null>(null);
  const [showResult, setShowResult] = useState(false);
  const [score, setScore] = useState(0);
  const [correctCount, setCorrectCount] = useState(0);
  const [finished, setFinished] = useState(false);
  const [loading, setLoading] = useState(true);
  const [timeLeft, setTimeLeft] = useState(0);
  const [startTime] = useState(Date.now());
  const [combo, setCombo] = useState(0);
  const [maxCombo, setMaxCombo] = useState(0);
  const [quizTitle, setQuizTitle] = useState("");
  const [scoreAnimation, setScoreAnimation] = useState<number | null>(null);
  const [activePowerUps, setActivePowerUps] = useState<ActivePowerUps>({
    xp_boost_2x: false,
    extra_time: false,
    streak_multiplier: false,
  });
  const [streakCount, setStreakCount] = useState(0);
  const [hyperMode, setHyperMode] = useState(false);
  const [comboTier, setComboTier] = useState(0); // 0=none, 1=x2, 2=x3, 3=hyper
  const [scorePulse, setScorePulse] = useState(false);

  const useTimed = isGamified || !!customTimerSeconds;
  const extraTimeBonus = activePowerUps.extra_time ? 15 : 0;
  const getTimerForQuestion = useCallback((q: Question) =>
    (customTimerSeconds || (isGamified ? (q.time_limit_seconds || 30) : 0)) + extraTimeBonus,
  [customTimerSeconds, extraTimeBonus, isGamified]);

  // Load active power-ups
  useEffect(() => {
    if (!user) return;
    const loadPowerUps = async () => {
      const [powerupsRes, profileRes] = await Promise.all([
        supabase
          .from("user_powerups")
          .select("powerup_type, quantity")
          .eq("user_id", user.id)
          .in("powerup_type", ["xp_boost_2x", "extra_time", "streak_multiplier"]),
        supabase
          .from("profiles")
          .select("streak_count")
          .eq("user_id", user.id)
          .single(),
      ]);

      if (powerupsRes.data) {
        const pups: ActivePowerUps = { xp_boost_2x: false, extra_time: false, streak_multiplier: false };
        powerupsRes.data.forEach((p) => {
          if (p.quantity > 0 && p.powerup_type in pups) {
            pups[p.powerup_type as keyof ActivePowerUps] = true;
          }
        });
        setActivePowerUps(pups);
      }
      if (profileRes.data) {
        setStreakCount(profileRes.data.streak_count || 0);
      }
    };
    loadPowerUps();
  }, [user]);

  useEffect(() => {
    const fetchQuiz = async () => {
      const [quizRes, questionsRes] = await Promise.all([
        supabase.from("quizzes").select("title").eq("id", quizId).single(),
        supabase.from("quiz_questions").select("*").eq("quiz_id", quizId).order("sort_order"),
      ]);
      if (quizRes.data) setQuizTitle(quizRes.data.title);
      if (questionsRes.data) {
        let filtered = questionsRes.data as Question[];
        if (selectedTopics && selectedTopics.length > 0) {
          filtered = filtered.filter((q) => selectedTopics.includes(q.topic));
        }
        // FIX: rimosso client-side shuffle — la Edge Function già applica
        // Fisher-Yates shuffle + balanceCorrectAnswers server-side.
        // Un secondo shuffle distruggerebbe il bilanciamento delle risposte corrette.
        setQuestions(filtered);
        if (filtered.length > 0 && useTimed) {
          setTimeLeft(getTimerForQuestion(filtered[0]));
        }
      }
      setLoading(false);
    };
    fetchQuiz();
  }, [quizId, selectedTopics, useTimed, getTimerForQuestion]);

  // Combo tier helpers (gamified only)
  const getComboTier = (c: number) => {
    if (c >= 7) return 3; // hyper
    if (c >= 5) return 2; // x3
    if (c >= 3) return 1; // x2
    return 0;
  };
  const getComboMultiplierValue = (tier: number) => {
    if (tier >= 3) return 3; // hyper = x3 base + bonus
    if (tier >= 2) return 3;
    if (tier >= 1) return 2;
    return 1;
  };

  const handleAnswer = useCallback((index: number) => {
    if (showResult || questions.length === 0) return;
    setSelectedAnswer(index);
    setShowResult(true);
    const q = questions[currentIndex];
    if (!q) return;
    const isCorrect = index === q.correct_answer;
    if (isCorrect) {
      const newCombo = combo + 1;
      const prevTier = isGamified ? getComboTier(combo) : 0;
      const newTier = isGamified ? getComboTier(newCombo) : 0;

      // Scoring: gamified uses combo tiers, normal unchanged
      let comboMultiplier: number;
      if (isGamified) {
        comboMultiplier = getComboMultiplierValue(newTier);
      } else {
        comboMultiplier = 1;
      }
      const timeBonus = useTimed ? Math.round(timeLeft * 0.5) : 0;
      let points = Math.round(q.points * comboMultiplier) + timeBonus;
      // Hyper mode bonus
      if (isGamified && newTier >= 3) points += 15;

      setScore((p) => p + points);
      setCorrectCount((p) => p + 1);
      setCombo(newCombo);
      setMaxCombo((p) => Math.max(p, newCombo));
      setScoreAnimation(points);
      setTimeout(() => setScoreAnimation(null), 1000);

      // Pulse score
      if (isGamified) {
        setScorePulse(true);
        setTimeout(() => setScorePulse(false), 500);
      }

      // Update combo tier & play sounds (gamified only)
      if (isGamified) {
        setComboTier(newTier);
        if (newTier >= 3 && prevTier < 3) {
          setHyperMode(true);
          playHyperActivateSound();
        } else if (newTier > prevTier && newTier > 0) {
          playComboUpSound();
        } else {
          playCorrectSound();
        }
        fireCorrectConfetti();
      } else {
        playCorrectSound();
        fireCorrectConfetti();
      }
    } else {
      // Wrong answer
      if (isGamified && combo >= 3) {
        playComboBreakSound();
      } else {
        playWrongSound();
      }
      setCombo(0);
      if (isGamified) {
        setComboTier(0);
        setHyperMode(false);
      }
    }

    if (user && q.id) {
      recordQuestionProgress({
        userId: user.id,
        quizId,
        questionId: q.id,
        selectedAnswer: index,
        isCorrect,
        timeTakenSeconds: useTimed ? (getTimerForQuestion(q) - timeLeft) : null,
      }).catch((err) => {
        console.error("[QuizPlayer] Failed to record question progress:", err);
      });

      const today = getLocalDateString();
      supabase.rpc("increment_daily_questions_completed", {
        _user_id: user.id,
        _objective_date: today,
      }).then(() => {});
    }
  }, [showResult, questions, currentIndex, combo, isGamified, timeLeft, useTimed, user, quizId, getTimerForQuestion]);

  useEffect(() => {
    if (!useTimed || showResult || finished || loading || questions.length === 0) return;
    if (timeLeft <= 0) { handleAnswer(-1); return; }
    const t = setTimeout(() => setTimeLeft((p) => p - 1), 1000);
    return () => clearTimeout(t);
  }, [timeLeft, useTimed, showResult, finished, loading, questions.length, handleAnswer]);

  // Consume power-ups at quiz end
  const consumePowerUps = async () => {
    if (!user) return;
    const toConsume = Object.entries(activePowerUps)
      .filter(([, active]) => active)
      .map(([type]) => type);

    for (const type of toConsume) {
      const { data } = await supabase
        .from("user_powerups")
        .select("quantity")
        .eq("user_id", user.id)
        .eq("powerup_type", type)
        .maybeSingle();
      if (data && data.quantity > 0) {
        await supabase
          .from("user_powerups")
          .update({ quantity: data.quantity - 1 })
          .eq("user_id", user.id)
          .eq("powerup_type", type);
      }
    }
  };

  const nextQuestion = async () => {
    if (currentIndex + 1 >= questions.length) {
      setFinished(true);
      playCompletionSound();
      fireCompletionConfetti();
      if (user) {
        const totalPoints = questions.reduce((s, q) => s + q.points, 0);
        const timeTaken = Math.round((Date.now() - startTime) / 1000);

        // Calculate XP with power-up multipliers
        let xpMultiplier = isGamified ? 1.5 : 0.5;
        if (activePowerUps.xp_boost_2x) xpMultiplier *= 2;
        if (activePowerUps.streak_multiplier && streakCount >= 3) xpMultiplier *= 1.5;

        const baseXpEarned = Math.round(score * xpMultiplier);
        let finalXpEarned = baseXpEarned;

        // XP Betting logic
        const accuracy = questions.length > 0 ? correctCount / questions.length : 0;
        let betResult = 0;
        if (xpBet && xpBet > 0) {
          if (accuracy >= 0.8) {
            betResult = xpBet * 2; // Win: double the bet
          } else {
            betResult = -xpBet; // Lose: subtract bet
          }
        }
        finalXpEarned = Math.max(0, baseXpEarned + betResult);

        await recordQuizAttempt({
          userId: user.id,
          quizId,
          score,
          totalPoints,
          correctAnswers: correctCount,
          totalAnswered: questions.length,
          timeTakenSeconds: timeTaken,
          xpEarned: finalXpEarned,
          xpBet: xpBet || null,
        });
        if (finalXpEarned > 0 || betResult !== 0) {
          try {
            await awardUserXp({
              userId: user.id,
              amount: finalXpEarned,
              source: isGamified ? "gamified_quiz" : "standard_quiz",
              sourceId: quizId,
              dedupeBySourceId: true,
              quizzesCompletedDelta: 1,
              perfectScoresDelta: correctCount === questions.length ? 1 : 0,
            });
          } catch (err) {
            console.error("[QuizPlayer] XP write failed:", err);
          }
        }

        // Consume active power-ups after quiz
        await consumePowerUps();
      }
      return;
    }
    const nextIdx = currentIndex + 1;
    setCurrentIndex(nextIdx);
    setSelectedAnswer(null);
    setShowResult(false);
    if (useTimed) setTimeLeft(getTimerForQuestion(questions[nextIdx]));
  };

  if (loading) return <div className="flex items-center justify-center py-20"><div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" /></div>;

  if (questions.length === 0) return (
    <div className="text-center py-12">
      <p className="text-muted-foreground">Nessuna domanda trovata.</p>
      <Button variant="outline" onClick={onBack} className="mt-4">Torna indietro</Button>
    </div>
  );

  // Calculate XP multiplier for display
  const getXpMultiplier = () => {
    let mult = isGamified ? 1.5 : 0.5;
    if (activePowerUps.xp_boost_2x) mult *= 2;
    if (activePowerUps.streak_multiplier && streakCount >= 3) mult *= 1.5;
    return mult;
  };

  if (finished) {
    const percentage = Math.round((correctCount / questions.length) * 100);
    const timeTaken = Math.round((Date.now() - startTime) / 1000);
    const minutes = Math.floor(timeTaken / 60);
    const seconds = timeTaken % 60;
    const baseXpEarned = Math.round(score * getXpMultiplier());
    const hasAnyPowerUp = activePowerUps.xp_boost_2x || activePowerUps.extra_time || (activePowerUps.streak_multiplier && streakCount >= 3);
    const betWon = xpBet ? percentage >= 80 : false;
    const betResult = xpBet ? (betWon ? xpBet * 2 : -xpBet) : 0;
    const xpEarned = Math.max(0, baseXpEarned + betResult);

    return (
      <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="text-center py-8">
        <h2 className="text-2xl font-bold text-card-foreground mb-2">Quiz completato!</h2>
        <p className="text-muted-foreground mb-6">{quizTitle}</p>
        <div className="grid grid-cols-2 gap-4 max-w-sm mx-auto mb-8">
          <div className="bg-secondary rounded-xl p-4"><p className="text-2xl font-bold text-card-foreground">{correctCount}/{questions.length}</p><p className="text-xs text-muted-foreground">Risposte corrette</p></div>
          <div className="bg-secondary rounded-xl p-4"><p className="text-2xl font-bold text-primary">{score}</p><p className="text-xs text-muted-foreground">Punti totali</p></div>
          <div className="bg-secondary rounded-xl p-4"><p className="text-2xl font-bold text-card-foreground">{percentage}%</p><p className="text-xs text-muted-foreground">Precisione</p></div>
          <div className="bg-secondary rounded-xl p-4"><p className="text-2xl font-bold text-card-foreground">{minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`}</p><p className="text-xs text-muted-foreground">Tempo</p></div>
        </div>
        <div className={`rounded-xl p-4 max-w-sm mx-auto mb-6 space-y-2 ${isGamified ? "bg-primary/10" : "bg-secondary"}`}>
          <p className="text-sm font-medium text-primary">
            +{xpEarned} XP guadagnati!
            {!isGamified && !hasAnyPowerUp && <span className="text-xs text-muted-foreground ml-1">(quiz standard: 0.5x)</span>}
          </p>
          {isGamified && <p className="text-xs text-muted-foreground">Combo massima: x{maxCombo}</p>}
          {/* XP Bet result */}
          {xpBet && xpBet > 0 && (
            <div className={`rounded-lg p-2 mt-2 ${betWon ? "bg-primary/10 border border-primary/20" : "bg-destructive/10 border border-destructive/20"}`}>
              <p className={`text-sm font-bold ${betWon ? "text-primary" : "text-destructive"}`}>
                {betWon ? `🎰 Scommessa vinta! +${betResult} XP` : `🎰 Scommessa persa: ${betResult} XP`}
              </p>
              <p className="text-[10px] text-muted-foreground">
                {betWon ? `Accuratezza ${percentage}% ≥ 80%` : `Accuratezza ${percentage}% < 80%`}
              </p>
            </div>
          )}
          {/* Show power-up bonuses */}
          {hasAnyPowerUp && (
            <div className="flex flex-wrap gap-1.5 justify-center mt-2">
              {activePowerUps.xp_boost_2x && (
                <Badge variant="default" className="text-[10px] bg-amber-500/20 text-amber-600 border-amber-500/30">
                  <Zap className="h-3 w-3 mr-0.5" /> XP Boost 2x
                </Badge>
              )}
              {activePowerUps.extra_time && (
                <Badge variant="default" className="text-[10px] bg-blue-500/20 text-blue-600 border-blue-500/30">
                  <Clock className="h-3 w-3 mr-0.5" /> +15s/domanda
                </Badge>
              )}
              {activePowerUps.streak_multiplier && streakCount >= 3 && (
                <Badge variant="default" className="text-[10px] bg-orange-500/20 text-orange-600 border-orange-500/30">
                  <Shield className="h-3 w-3 mr-0.5" /> Streak Bonus +50%
                </Badge>
              )}
            </div>
          )}
        </div>
        <div className="flex gap-3 justify-center">
          <Button variant="outline" onClick={onBack}><RotateCcw className="h-4 w-4 mr-2" /> Torna indietro</Button>
        </div>
      </motion.div>
    );
  }

  const q = questions[currentIndex];
  const progress = ((currentIndex + 1) / questions.length) * 100;
  const maxTime = getTimerForQuestion(q);
  const timerPercentage = useTimed && maxTime ? (timeLeft / maxTime) * 100 : 100;
  const hasAnyActivePowerUp = activePowerUps.xp_boost_2x || activePowerUps.extra_time || (activePowerUps.streak_multiplier && streakCount >= 3);

  // Combo progress for gamified: 0-7 mapped to percentage
  const comboProgress = isGamified ? Math.min((combo / 7) * 100, 100) : 0;
  const comboGlow = isGamified && comboTier > 0;
  const comboLabel = isGamified
    ? hyperMode ? "🔥🔥🔥 HYPER MODE" : comboTier === 2 ? "🔥🔥 x3" : comboTier === 1 ? "🔥 x2" : null
    : null;

  return (
    <div className={`space-y-6 transition-all duration-500 ease-in-out rounded-2xl p-4 ${
      hyperMode ? "bg-gradient-to-br from-primary/5 via-accent/5 to-primary/5 animate-[pulse_4s_ease-in-out_infinite]" : ""
    }`}>
      {/* Combo indicator (gamified only) */}
      {isGamified && comboLabel && (
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.4, ease: "easeInOut" }}
          className={`text-center py-2 px-4 rounded-xl font-bold text-sm ${
            hyperMode
              ? "bg-primary/15 text-primary border border-primary/30"
              : comboTier === 2
              ? "bg-amber-500/10 text-amber-600 border border-amber-500/20"
              : "bg-orange-500/10 text-orange-600 border border-orange-500/20"
          }`}
        >
          {comboLabel}
        </motion.div>
      )}

      {/* Combo progress bar (gamified only) */}
      {isGamified && combo > 0 && (
        <div className="space-y-1">
          <div className="flex justify-between text-[10px] text-muted-foreground">
            <span>Combo {combo}</span>
            <span>{combo < 3 ? "x2 a 3" : combo < 5 ? "x3 a 5" : combo < 7 ? "HYPER a 7" : "MAX"}</span>
          </div>
          <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
            <motion.div
              className={`h-full rounded-full transition-colors duration-300 ${
                hyperMode ? "bg-primary" : comboTier === 2 ? "bg-amber-500" : comboTier === 1 ? "bg-orange-500" : "bg-muted-foreground"
              }`}
              initial={{ width: 0 }}
              animate={{ width: `${comboProgress}%` }}
              transition={{ duration: 0.4, ease: "easeInOut" }}
            />
          </div>
        </div>
      )}

      {/* Active power-ups indicator */}
      {hasAnyActivePowerUp && currentIndex === 0 && !showResult && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex flex-wrap gap-1.5 justify-center"
        >
          {activePowerUps.xp_boost_2x && (
            <Badge className="text-[10px] bg-amber-500/10 text-amber-600 border border-amber-500/30">
              <Zap className="h-3 w-3 mr-0.5" /> XP Boost 2x attivo
            </Badge>
          )}
          {activePowerUps.extra_time && (
            <Badge className="text-[10px] bg-blue-500/10 text-blue-600 border border-blue-500/30">
              <Clock className="h-3 w-3 mr-0.5" /> +15s/domanda attivo
            </Badge>
          )}
          {activePowerUps.streak_multiplier && streakCount >= 3 && (
            <Badge className="text-[10px] bg-orange-500/10 text-orange-600 border border-orange-500/30">
              <Shield className="h-3 w-3 mr-0.5" /> Streak Bonus attivo
            </Badge>
          )}
        </motion.div>
      )}

      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-muted-foreground">{q.topic}</p>
          <p className="text-sm font-medium text-card-foreground">Domanda {currentIndex + 1} di {questions.length}</p>
        </div>
        <div className="flex items-center gap-3">
          {isGamified && combo > 1 && (
            <span className="text-xs font-bold text-primary bg-primary/10 px-2 py-1 rounded-full">x{combo} combo</span>
          )}
          {(isGamified || useTimed) && (
            <motion.span
              className="text-sm font-bold text-primary"
              animate={scorePulse ? { scale: [1, 1.3, 1] } : {}}
              transition={{ duration: 0.4, ease: "easeInOut" }}
            >
              {score} pts
            </motion.span>
          )}
          {useTimed && (
            <div className={`flex items-center gap-1 text-sm font-mono rounded-full px-2 py-1 ${
              timeLeft <= 5 ? "text-destructive bg-destructive/10 animate-pulse" :
              timeLeft <= 10 ? "text-amber-500 bg-amber-500/10" : "text-muted-foreground bg-secondary"
            }`}>
              <Clock className="h-3.5 w-3.5" /> {timeLeft}s
            </div>
          )}
        </div>
      </div>

      <Progress value={progress} className="h-1.5" />
      {useTimed && <Progress value={timerPercentage} className={`h-1 ${timeLeft <= 5 ? "[&>div]:bg-destructive" : timeLeft <= 10 ? "[&>div]:bg-amber-500" : "[&>div]:bg-primary"}`} />}

      <AnimatePresence>
        {scoreAnimation !== null && (
          <motion.div initial={{ opacity: 1, y: 0 }} animate={{ opacity: 0, y: -40 }} exit={{ opacity: 0 }}
            className="fixed top-1/3 left-1/2 -translate-x-1/2 z-50 text-2xl font-bold text-primary">+{scoreAnimation}</motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence mode="wait">
        <motion.div key={currentIndex} initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}
          className={`transition-shadow duration-400 ease-in-out rounded-xl ${comboGlow ? "shadow-[0_0_20px_-4px_hsl(var(--primary)/0.25)]" : ""}`}>
          <h3 className={`text-lg font-semibold text-card-foreground mb-6 ${comboGlow ? "p-3" : ""}`}>{q.question}</h3>
          <div className="space-y-3">
            {(q.options as string[]).map((opt, i) => {
              let style = "border-border hover:border-primary/50 hover:bg-secondary/50";
              if (showResult) {
                if (i === q.correct_answer) style = "border-primary bg-primary/10";
                else if (i === selectedAnswer && i !== q.correct_answer) style = "border-destructive bg-destructive/10";
                else style = "border-border opacity-50";
              } else if (selectedAnswer === i) style = "border-primary bg-primary/5";
              return (
                <button key={i} onClick={() => !showResult && handleAnswer(i)} disabled={showResult}
                  className={`w-full text-left p-4 rounded-xl border-2 transition-all flex items-center gap-3 ${style}`}>
                  <span className="h-7 w-7 rounded-full bg-secondary flex items-center justify-center text-xs font-bold text-secondary-foreground shrink-0">{String.fromCharCode(65 + i)}</span>
                  <span className="text-sm text-card-foreground flex-1">{opt}</span>
                  {showResult && i === q.correct_answer && <CheckCircle2 className="h-5 w-5 text-primary shrink-0" />}
                  {showResult && i === selectedAnswer && i !== q.correct_answer && <XCircle className="h-5 w-5 text-destructive shrink-0" />}
                </button>
              );
            })}
          </div>

          {showResult && q.explanation && (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mt-4 p-4 bg-secondary rounded-xl">
              <p className="text-sm text-secondary-foreground"><strong>Spiegazione:</strong> {q.explanation}</p>
              {q.source_reference && (
                <p className="text-xs text-muted-foreground mt-2 italic border-l-2 border-primary pl-2">📄 Fonte: "{q.source_reference}"</p>
              )}
              <div className="flex items-center justify-between mt-3 pt-2 border-t border-border/50">
                <span className="text-[10px] text-muted-foreground">Questa domanda è utile?</span>
                <QuizQuestionFeedback questionId={q.id} />
              </div>
            </motion.div>
          )}
        </motion.div>
      </AnimatePresence>

      {showResult && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          <Button onClick={nextQuestion} className="w-full">
            {currentIndex + 1 >= questions.length ? <><Trophy className="h-4 w-4 mr-2" /> Vedi risultati</> : <><ArrowRight className="h-4 w-4 mr-2" /> Prossima domanda</>}
          </Button>
        </motion.div>
      )}
    </div>
  );
};

export default QuizPlayer;
