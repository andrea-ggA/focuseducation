import { useState, useEffect, useMemo } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Link } from "react-router-dom";
import { ArrowLeft, BarChart3, Target, Clock, TrendingUp, Brain, CalendarDays } from "lucide-react";
import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";
import AppHeader from "@/components/AppHeader";
import MobileBottomNav from "@/components/MobileBottomNav";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line, CartesianGrid, Area, AreaChart,
} from "recharts";
import StudyHeatmap from "@/components/statistics/StudyHeatmap";
import FlashcardTopicStats from "@/components/statistics/FlashcardTopicStats";
import RecurringErrorAnalysis from "@/components/statistics/RecurringErrorAnalysis";

interface FocusSession {
  duration_minutes: number;
  started_at: string;
  completed: boolean;
}

interface QuizAttempt {
  score: number;
  correct_answers: number;
  total_answered: number;
  completed_at: string;
  xp_earned: number;
}

interface QuizAttemptActivity {
  completed_at: string;
}

interface QuestionProgress {
  is_correct: boolean;
  answered_at: string;
  topic: string | null;
  quiz_id: string;
}

interface ChartTooltipPayload {
  name?: string | number;
  value?: string | number;
}

interface ChartTooltipProps {
  active?: boolean;
  payload?: ChartTooltipPayload[];
  label?: string | number;
}

const COLORS = [
  "hsl(var(--primary))",
  "hsl(var(--accent))",
  "hsl(173, 58%, 39%)",
  "hsl(43, 96%, 56%)",
  "hsl(262, 83%, 58%)",
  "hsl(12, 76%, 61%)",
];

const Statistics = () => {
  const { user } = useAuth();
  const [focusSessions, setFocusSessions] = useState<FocusSession[]>([]);
  const [allFocusSessions, setAllFocusSessions] = useState<FocusSession[]>([]);
  const [allQuizAttempts, setAllQuizAttempts] = useState<QuizAttemptActivity[]>([]);
  const [quizAttempts, setQuizAttempts] = useState<QuizAttempt[]>([]);
  const [questionProgress, setQuestionProgress] = useState<QuestionProgress[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const sixMonthsAgo = new Date(Date.now() - 182 * 24 * 60 * 60 * 1000).toISOString();
    const load = async () => {
      const [focusRes, quizRes, progressRes, focusAllRes, quizAllRes] = await Promise.all([
        supabase
          .from("focus_sessions")
          .select("duration_minutes, started_at, completed")
          .eq("user_id", user.id)
          .eq("completed", true)
          .gte("started_at", thirtyDaysAgo)
          .order("started_at"),
        supabase
          .from("quiz_attempts")
          .select("score, correct_answers, total_answered, completed_at, xp_earned")
          .eq("user_id", user.id)
          .gte("completed_at", thirtyDaysAgo)
          .order("completed_at"),
        supabase
          .from("user_question_progress")
          .select("is_correct, answered_at, question_id, quiz_id")
          .eq("user_id", user.id)
          .gte("answered_at", thirtyDaysAgo),
        // 6-month data for heatmap
        supabase
          .from("focus_sessions")
          .select("duration_minutes, started_at, completed")
          .eq("user_id", user.id)
          .eq("completed", true)
          .gte("started_at", sixMonthsAgo)
          .order("started_at"),
        supabase
          .from("quiz_attempts")
          .select("completed_at")
          .eq("user_id", user.id)
          .gte("completed_at", sixMonthsAgo),
      ]);

      if (focusRes.data) setFocusSessions(focusRes.data);
      if (quizRes.data) setQuizAttempts(quizRes.data);
      if (focusAllRes.data) setAllFocusSessions(focusAllRes.data);
      if (quizAllRes.data) setAllQuizAttempts(quizAllRes.data as QuizAttemptActivity[]);

      // Fetch topics for questions via quiz_questions
      if (progressRes.data && progressRes.data.length > 0) {
        const questionIds = [...new Set(progressRes.data.map((p) => p.question_id))];
        // Batch fetch topics
        const { data: questionsData } = await supabase
          .from("quiz_questions")
          .select("id, topic")
          .in("id", questionIds.slice(0, 500));

        const topicMap: Record<string, string> = {};
        questionsData?.forEach((q) => {
          if (q.topic) topicMap[q.id] = q.topic;
        });

        setQuestionProgress(
          progressRes.data.map((p) => ({
            ...p,
            topic: topicMap[p.question_id] || "Altro",
          }))
        );
      }

      setLoading(false);
    };
    load();
  }, [user]);

  // 1. Focus time per day (last 7 days)
  const focusByDay = useMemo(() => {
    const days: Record<string, number> = {};
    const now = new Date();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const key = d.toISOString().split("T")[0];
      days[key] = 0;
    }
    focusSessions.forEach((s) => {
      const key = new Date(s.started_at).toISOString().split("T")[0];
      if (key in days) days[key] += s.duration_minutes;
    });
    return Object.entries(days).map(([date, minutes]) => ({
      day: new Date(date).toLocaleDateString("it-IT", { weekday: "short", day: "numeric" }),
      minuti: minutes,
    }));
  }, [focusSessions]);

  // 2. Accuracy by topic
  const accuracyByTopic = useMemo(() => {
    const topics: Record<string, { correct: number; total: number }> = {};
    questionProgress.forEach((q) => {
      const t = q.topic || "Altro";
      if (!topics[t]) topics[t] = { correct: 0, total: 0 };
      topics[t].total++;
      if (q.is_correct) topics[t].correct++;
    });
    return Object.entries(topics)
      .map(([name, data]) => ({
        name: name.length > 20 ? name.slice(0, 20) + "…" : name,
        accuracy: Math.round((data.correct / data.total) * 100),
        total: data.total,
      }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 8);
  }, [questionProgress]);

  // 3. Quiz completions per week (last 4 weeks)
  const quizByWeek = useMemo(() => {
    const weeks: { label: string; quiz: number; xp: number }[] = [];
    const now = new Date();
    for (let i = 3; i >= 0; i--) {
      const weekStart = new Date(now);
      weekStart.setDate(weekStart.getDate() - (i + 1) * 7);
      const weekEnd = new Date(now);
      weekEnd.setDate(weekEnd.getDate() - i * 7);

      const inRange = quizAttempts.filter((a) => {
        const d = new Date(a.completed_at);
        return d >= weekStart && d < weekEnd;
      });

      weeks.push({
        label: `Sett. ${4 - i}`,
        quiz: inRange.length,
        xp: inRange.reduce((s, a) => s + a.xp_earned, 0),
      });
    }
    return weeks;
  }, [quizAttempts]);

  // 4. Weekly accuracy trend
  const accuracyTrend = useMemo(() => {
    const weeks: { label: string; accuracy: number }[] = [];
    const now = new Date();
    for (let i = 3; i >= 0; i--) {
      const weekStart = new Date(now);
      weekStart.setDate(weekStart.getDate() - (i + 1) * 7);
      const weekEnd = new Date(now);
      weekEnd.setDate(weekEnd.getDate() - i * 7);

      const inRange = questionProgress.filter((q) => {
        const d = new Date(q.answered_at);
        return d >= weekStart && d < weekEnd;
      });

      const acc = inRange.length > 0
        ? Math.round((inRange.filter((q) => q.is_correct).length / inRange.length) * 100)
        : 0;

      weeks.push({ label: `Sett. ${4 - i}`, accuracy: acc });
    }
    return weeks;
  }, [questionProgress]);

  // Summary stats
  const totalFocusMinutes = focusSessions.reduce((s, f) => s + f.duration_minutes, 0);
  const totalQuizzes = quizAttempts.length;
  const totalQuestions = questionProgress.length;
  const overallAccuracy = totalQuestions > 0
    ? Math.round((questionProgress.filter((q) => q.is_correct).length / totalQuestions) * 100)
    : 0;
  const totalXP = quizAttempts.reduce((s, a) => s + a.xp_earned, 0);

  if (loading) {
    return (
      <div className="min-h-screen bg-background">
        <AppHeader />
        <div className="flex items-center justify-center py-20">
          <Brain className="h-8 w-8 animate-spin text-primary" />
        </div>
      </div>
    );
  }

  const summaryCards = [
    { icon: Clock, label: "Tempo di studio", value: `${totalFocusMinutes} min`, color: "text-primary" },
    { icon: Target, label: "Accuracy", value: `${overallAccuracy}%`, color: "text-accent" },
    { icon: BarChart3, label: "Quiz completati", value: `${totalQuizzes}`, color: "text-primary" },
    { icon: TrendingUp, label: "XP guadagnati", value: `${totalXP}`, color: "text-accent" },
  ];

  const CustomTooltip = ({ active, payload, label }: ChartTooltipProps) => {
    if (!active || !payload?.length) return null;
    return (
      <div className="bg-popover border border-border rounded-lg px-3 py-2 shadow-md text-sm">
        <p className="font-medium text-popover-foreground">{label}</p>
        {payload.map((p, i: number) => (
          <p key={i} className="text-muted-foreground">
            {p.name}: <span className="font-semibold text-popover-foreground">{p.value}</span>
          </p>
        ))}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <main className="container mx-auto px-4 py-8 pb-24 md:pb-8 max-w-5xl">
        <div className="mb-6">
          <Button variant="ghost" size="sm" asChild>
            <Link to="/dashboard"><ArrowLeft className="h-4 w-4 mr-2" /> Dashboard</Link>
          </Button>
        </div>

        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
          <h1 className="text-2xl md:text-3xl font-bold text-foreground flex items-center gap-2 mb-1">
            <BarChart3 className="h-7 w-7 text-primary" /> Statistiche
          </h1>
          <p className="text-muted-foreground mb-8">Ultimi 30 giorni di attività</p>
        </motion.div>

        {/* Summary cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          {summaryCards.map((s, i) => (
            <motion.div
              key={s.label}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              className="bg-card rounded-xl border border-border p-4 shadow-card"
            >
              <s.icon className={`h-5 w-5 ${s.color} mb-2`} />
              <p className="text-2xl font-bold text-card-foreground">{s.value}</p>
              <p className="text-xs text-muted-foreground">{s.label}</p>
            </motion.div>
          ))}
        </div>

        {/* Study Heatmap */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.08 }}
          className="mb-8"
        >
          <StudyHeatmap focusSessions={allFocusSessions} quizAttempts={allQuizAttempts} />
        </motion.div>

        {/* Flashcard topic stats + AI error analysis */}
        <div className="grid md:grid-cols-2 gap-6 mb-6">
          <FlashcardTopicStats />
          <RecurringErrorAnalysis />
        </div>

        {/* Charts grid */}
        <div className="grid md:grid-cols-2 gap-6">
          {/* Focus time per day */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="bg-card rounded-xl border border-border shadow-card p-5"
          >
            <h3 className="text-sm font-semibold text-card-foreground mb-4 flex items-center gap-2">
              <Clock className="h-4 w-4 text-primary" /> Tempo di studio (7 giorni)
            </h3>
            {focusByDay.some((d) => d.minuti > 0) ? (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={focusByDay}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="day" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                  <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey="minuti" name="Minuti" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <EmptyChart message="Nessuna sessione di focus registrata" />
            )}
          </motion.div>

          {/* Accuracy by topic */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
            className="bg-card rounded-xl border border-border shadow-card p-5"
          >
            <h3 className="text-sm font-semibold text-card-foreground mb-4 flex items-center gap-2">
              <Target className="h-4 w-4 text-accent" /> Accuracy per argomento
            </h3>
            {accuracyByTopic.length > 0 ? (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={accuracyByTopic} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                  <YAxis dataKey="name" type="category" width={100} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey="accuracy" name="Accuracy %" fill="hsl(var(--accent))" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <EmptyChart message="Nessuna domanda risolta ancora" />
            )}
          </motion.div>

          {/* Quiz completions + XP per week */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="bg-card rounded-xl border border-border shadow-card p-5"
          >
            <h3 className="text-sm font-semibold text-card-foreground mb-4 flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-primary" /> Quiz completati (4 settimane)
            </h3>
            {quizByWeek.some((w) => w.quiz > 0) ? (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={quizByWeek}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                  <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey="quiz" name="Quiz" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <EmptyChart message="Nessun quiz completato" />
            )}
          </motion.div>

          {/* Accuracy trend */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.25 }}
            className="bg-card rounded-xl border border-border shadow-card p-5"
          >
            <h3 className="text-sm font-semibold text-card-foreground mb-4 flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-accent" /> Trend accuracy (4 settimane)
            </h3>
            {accuracyTrend.some((w) => w.accuracy > 0) ? (
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={accuracyTrend}>
                  <defs>
                    <linearGradient id="accuracyGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(var(--accent))" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="hsl(var(--accent))" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                  <Tooltip content={<CustomTooltip />} />
                  <Area
                    type="monotone"
                    dataKey="accuracy"
                    name="Accuracy %"
                    stroke="hsl(var(--accent))"
                    fill="url(#accuracyGrad)"
                    strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <EmptyChart message="Nessun dato di accuracy" />
            )}
          </motion.div>
        </div>
      </main>
      <MobileBottomNav />
    </div>
  );
};

const EmptyChart = ({ message }: { message: string }) => (
  <div className="flex items-center justify-center h-[220px] text-muted-foreground text-sm">
    {message}
  </div>
);

export default Statistics;
