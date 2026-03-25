import { useAuth } from "@/contexts/AuthContext";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAmbientPlayer } from "@/hooks/useAmbientPlayer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Brain, Plus, Timer, Target, Trophy, BookOpen,
  CheckCircle2, Flame, Sparkles, Star, Award, Zap, Volume2, VolumeX,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { motion, AnimatePresence } from "framer-motion";
import PomodoroTimer from "@/components/dashboard/PomodoroTimer";
import AiTutor from "@/components/dashboard/AiTutor";
import DailyObjectives from "@/components/dashboard/DailyObjectives";
import WeeklyChallenges from "@/components/dashboard/WeeklyChallenges";
import StudyPlanAI from "@/components/dashboard/StudyPlanAI";
import EnergySelector, { type EnergyLevel } from "@/components/dashboard/EnergySelector";
import ExamCountdownWidget from "@/components/dashboard/ExamCountdownWidget";
import DueCardsWidget from "@/components/dashboard/DueCardsWidget";
import FocusScoreWidget from "@/components/dashboard/FocusScoreWidget";
import QuickReviewSession from "@/components/study/QuickReviewSession";
import FocusBurst from "@/components/study/FocusBurst";
import CrisisMode from "@/components/dashboard/CrisisMode";
import TrialBanner from "@/components/dashboard/TrialBanner";
import PowerUpShop from "@/components/dashboard/PowerUpShop";
import FortuneWheel from "@/components/dashboard/FortuneWheel";

import { useSubscription } from "@/hooks/useSubscription";
import { useGamification, BADGE_DEFINITIONS } from "@/hooks/useGamification";
import { useCredits } from "@/hooks/useCredits";
import AppHeader from "@/components/AppHeader";
import MobileBottomNav from "@/components/MobileBottomNav";
import OnboardingTour from "@/components/OnboardingTour";
import WeakTopicsQuiz from "@/components/dashboard/WeakTopicsQuiz";
import CrisisSuggestBanner from "@/components/dashboard/CrisisSuggestBanner";
import CreditLowAlert from "@/components/dashboard/CreditLowAlert";
import FocusModeToggle from "@/components/dashboard/FocusModeToggle";
import WeakTopicsQuizPlayer from "@/components/dashboard/WeakTopicsQuizPlayer";
import { Link } from "react-router-dom";
import { Progress } from "@/components/ui/progress";

interface Task {
  id: string;
  title: string;
  completed: boolean;
  estimated_minutes: number | null;
  priority: string;
}

interface Profile {
  full_name: string | null;
  streak_count: number;
  onboarding_completed: boolean;
}

const Dashboard = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [newTask, setNewTask] = useState("");
  const [loading, setLoading] = useState(true);
  const [totalFocusMinutes, setTotalFocusMinutes] = useState(0);
  const [tasksCompletedToday, setTasksCompletedToday] = useState(0);
  const [tasksTotalToday, setTasksTotalToday]         = useState(0);
  // Piano settimanale e dueCount caricati nel batch principale → appaiono subito
  const [studyPlanData, setStudyPlanData]   = useState<any | null>(null);
  const [studyPlanLoaded, setStudyPlanLoaded] = useState(false);
  const [dashboardDueCount, setDashboardDueCount] = useState<number | null>(null);
  const [totalFocusAllTime, setTotalFocusAllTime] = useState(0);
  const [totalCompletedTasks, setTotalCompletedTasks] = useState(0);
  const [quizzesToday, setQuizzesToday] = useState(0);
  const [showBadges, setShowBadges] = useState(false);
  const [showFortuneWheel, setShowFortuneWheel] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showQuickReview, setShowQuickReview] = useState(false);
  const [showFocusBurst,  setShowFocusBurst]  = useState(false);
  const [showCrisisMode,  setShowCrisisMode]  = useState(false);
  const [energyLevel, setEnergyLevel]   = useState<EnergyLevel>("balanced");
  const [focusMode, setFocusMode]         = useState(() => sessionStorage.getItem("focus_mode") === "1");
  const [weakQuizIds, setWeakQuizIds]     = useState<string[]>([]);
  const [showWeakQuiz, setShowWeakQuiz]   = useState(false);

  const toggleFocusMode = () => {
    const next = !focusMode;
    setFocusMode(next);
    sessionStorage.setItem("focus_mode", next ? "1" : "0");
  };

  // FIX: persist energy level — load from profile on mount
  useEffect(() => {
    if (!user) return;
    supabase
      .from("profiles")
      .select("energy_level")
      .eq("user_id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (data?.energy_level) {
          setEnergyLevel(data.energy_level as EnergyLevel);
        }
      });
  }, [user]);

  // Ambient sound player — extracted to shared hook, uses unified sound list
  const {
    soundId: ambientSound,
    isPlaying: ambientActive,
    toggle: toggleAmbientSound,
    changeSound: changeAmbientSound,
    sounds: AMBIENT_SOUNDS,
    loadError: ambientLoadError,
  } = useAmbientPlayer();
  const { isPro } = useSubscription(); // canUseAdhdCoaching removed — ADHD Coaching rimosso
  const { xp, achievements, streakCount, checkBadges, xpProgress, badgeCount } = useGamification();
  const { totalCredits } = useCredits();

  useEffect(() => {
    if (user) fetchData();
  }, [user]);

  useEffect(() => {
    if (profile && !profile.onboarding_completed) setShowOnboarding(true);
  }, [profile]);

  const completeOnboarding = async () => {
    setShowOnboarding(false);
    if (user) {
      await supabase.from("profiles").update({ onboarding_completed: true }).eq("user_id", user.id);
      setProfile((p) => p ? { ...p, onboarding_completed: true } : p);
      // Navigate to Study AI for the "quick win" first experience
      navigate("/study");
    }
  };

  useEffect(() => {
    if (xp && achievements) {
      checkBadges(xp, achievements, {
        focusMinutesToday: totalFocusMinutes,
        completedTasks: totalCompletedTasks,
        totalFocusMinutes: totalFocusAllTime,
      }).then((newBadges) => {
        if (newBadges && newBadges.length > 0) {
          newBadges.forEach((badge) => {
            const def = BADGE_DEFINITIONS[badge];
            if (def) {
              toast({
                title: `${def.icon} Nuovo badge sbloccato!`,
                description: `${def.name}: ${def.description}`,
              });
            }
          });
        }
      });
    }
  }, [xp, totalFocusMinutes, totalCompletedTasks]);

  // Aggiorna solo le metriche che cambiano durante la sessione (focus min, quiz, task oggi)
  // Chiamato da Pomodoro onSessionComplete, FocusBurst onComplete, QuickReview onComplete
  const refreshScoreMetrics = async () => {
    if (!user) return;
    const today = new Date().toISOString().split("T")[0];
    const [focusTodayRes, quizzesTodayRes, tasksTotalRes, tasksCompletedRes] = await Promise.all([
      supabase.from("focus_sessions").select("duration_minutes").eq("user_id", user.id).eq("completed", true).gte("started_at", `${today}T00:00:00`),
      supabase.from("quiz_attempts").select("id", { count: "exact", head: true }).eq("user_id", user.id).gte("completed_at", `${today}T00:00:00`),
      supabase.from("tasks").select("id", { count: "exact", head: true }).eq("user_id", user.id).gte("created_at", `${today}T00:00:00`),
      supabase.from("tasks").select("id", { count: "exact", head: true }).eq("user_id", user.id).eq("completed", true).gte("updated_at", `${today}T00:00:00`),
    ]);
    if (focusTodayRes.data)        setTotalFocusMinutes(focusTodayRes.data.reduce((s, r) => s + (r.duration_minutes || 0), 0));
    if (quizzesTodayRes.count != null) setQuizzesToday(quizzesTodayRes.count);
    if (tasksTotalRes.count != null)    setTasksTotalToday(tasksTotalRes.count);
    if (tasksCompletedRes.count != null) setTasksCompletedToday(tasksCompletedRes.count);
    if (studyPlanRes.data?.plan_data) setStudyPlanData(studyPlanRes.data.plan_data);
    setStudyPlanLoaded(true);
    if (typeof dueCountRes.data === "number") setDashboardDueCount(dueCountRes.data);
  };

  const fetchData = async () => {
    const today = new Date().toISOString().split("T")[0];
    const [tasksRes, profileRes, focusTodayRes, focusAllRes, completedTasksRes, energyRes, quizzesTodayRes, tasksTotalRes, tasksCompletedRes, studyPlanRes, dueCountRes] = await Promise.all([
      supabase.from("tasks").select("id, title, completed, estimated_minutes, priority").eq("user_id", user!.id).order("created_at", { ascending: false }).limit(20),
      supabase.from("profiles").select("full_name, streak_count, onboarding_completed").eq("user_id", user!.id).single(),
      supabase.from("focus_sessions").select("duration_minutes").eq("user_id", user!.id).eq("completed", true).gte("started_at", `${today}T00:00:00`),
      supabase.from("focus_sessions").select("duration_minutes").eq("user_id", user!.id).eq("completed", true),
      supabase.from("tasks").select("id", { count: "exact", head: true }).eq("user_id", user!.id).eq("completed", true),
      supabase.from("profiles").select("energy_level" as any).eq("user_id", user!.id).single(),
      supabase.from("quiz_attempts").select("id", { count: "exact", head: true }).eq("user_id", user!.id).gte("completed_at", `${today}T00:00:00`),
      supabase.from("tasks").select("id", { count: "exact", head: true }).eq("user_id", user!.id).gte("created_at", `${today}T00:00:00`),
      supabase.from("tasks").select("id", { count: "exact", head: true }).eq("user_id", user!.id).eq("completed", true).gte("updated_at", `${today}T00:00:00`),
      // Piano settimanale — caricato qui per evitare flash vuoto in StudyPlanAI
      supabase.from("study_plans").select("plan_data").eq("user_id", user!.id)
        .eq("week_start", (() => {
          const m = new Date(today); m.setDate(m.getDate() - ((m.getDay()+6)%7)); return m.toISOString().split("T")[0];
        })()).maybeSingle(),
      // Due card count — caricato qui per evitare flash vuoto in DueCardsWidget
      supabase.rpc("count_due_cards", { _user_id: user!.id }),
    ]);
    if (tasksRes.data) setTasks(tasksRes.data);
    if (profileRes.data) setProfile(profileRes.data);
    if (focusTodayRes.data) setTotalFocusMinutes(focusTodayRes.data.reduce((sum, s) => sum + (s.duration_minutes || 0), 0));
    if (focusAllRes.data) setTotalFocusAllTime(focusAllRes.data.reduce((sum, s) => sum + (s.duration_minutes || 0), 0));
    if (completedTasksRes.count != null) setTotalCompletedTasks(completedTasksRes.count);
    if (quizzesTodayRes.count != null) setQuizzesToday(quizzesTodayRes.count);
    if (tasksTotalRes.count != null) setTasksTotalToday(tasksTotalRes.count);
    if (tasksCompletedRes.count != null) setTasksCompletedToday(tasksCompletedRes.count);
    if (studyPlanRes.data?.plan_data) setStudyPlanData(studyPlanRes.data.plan_data);
    setStudyPlanLoaded(true);
    if (typeof dueCountRes.data === "number") setDashboardDueCount(dueCountRes.data);
    if (energyRes.data && (energyRes.data as any).energy_level) setEnergyLevel((energyRes.data as any).energy_level as EnergyLevel);
    setLoading(false);
  };

  const addTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTask.trim()) return;
    const { data, error } = await supabase.from("tasks").insert({ title: newTask.trim(), user_id: user!.id }).select("id, title, completed, estimated_minutes, priority").single();
    if (error) { toast({ title: "Errore", description: "Impossibile aggiungere il task.", variant: "destructive" }); return; }
    if (data) setTasks((prev) => [data, ...prev]);
    setNewTask("");
  };

  const toggleTask = async (id: string, completed: boolean) => {
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, completed: !completed } : t)));
    const { error } = await supabase.from("tasks").update({ completed: !completed }).eq("id", id);
    if (error) { setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, completed } : t))); }
    else if (!completed) { setTotalCompletedTasks((p) => p + 1); }
    else { setTotalCompletedTasks((p) => Math.max(0, p - 1)); }
  };

  const completedCount = tasks.filter((t) => t.completed).length;
  const firstName = profile?.full_name?.split(" ")[0] || "Studente";

  const stats = [
    { icon: Target, label: "Task di oggi", value: `${completedCount}/${tasks.length}`, color: "text-primary" },
    { icon: Flame, label: "Streak", value: `${streakCount} giorni`, color: "text-accent" },
    { icon: Timer, label: "Focus oggi", value: `${totalFocusMinutes} min`, color: "text-primary" },
    { icon: Trophy, label: "Badge", value: `${badgeCount}`, color: "text-accent", onClick: () => setShowBadges(!showBadges) },
  ];

  // Non blocca più il render — mostra scheletro invece di spinner full-screen
  // Questo permette all'header, nav e struttura di apparire immediatamente
  // mentre i dati caricano in background

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />

      <main className="container mx-auto px-4 py-8 pb-24 md:pb-8 max-w-6xl">
        {/* SECTION 1: Hero + Credits */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="mb-6">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div>
              <h1 className="text-2xl md:text-3xl font-bold text-foreground">Ciao, {firstName}! 👋</h1>
              <p className="text-muted-foreground mt-1">Ecco il tuo piano per oggi.</p>
            </div>
            <div className={`flex items-center gap-2 rounded-xl px-4 py-2 border ${
              totalCredits < 5 ? "bg-destructive/5 border-destructive/30" : totalCredits < 10 ? "bg-orange-500/5 border-orange-500/30" : "bg-primary/5 border-primary/30"
            }`}>
              <Zap className={`h-5 w-5 ${totalCredits < 5 ? "text-destructive" : totalCredits < 10 ? "text-orange-500" : "text-primary"}`} />
              <div>
                <p className={`text-lg font-bold ${totalCredits < 5 ? "text-destructive" : totalCredits < 10 ? "text-orange-500" : "text-primary"}`}>{totalCredits}</p>
                <p className="text-[10px] text-muted-foreground">NeuroCredits</p>
              </div>
            </div>
          </div>
        </motion.div>

        {/* XP Bar */}
        {xp && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }} className="bg-card rounded-xl border border-border p-4 shadow-card mb-4 flex items-center gap-4">
            <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
              <Star className="h-5 w-5 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-semibold text-card-foreground">Livello {xp.level}</span>
                <span className="text-xs text-muted-foreground">{xp.total_xp} XP totali</span>
              </div>
              <Progress value={xpProgress} className="h-2" />
              <p className="text-[10px] text-muted-foreground mt-0.5">{Math.round(500 - (xp.total_xp % 500))} XP al prossimo livello</p>
            </div>
          </motion.div>
        )}

        {/* Energy Level Selector */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex-1 min-w-0">
            <EnergySelector value={energyLevel} onChange={setEnergyLevel} />
          </div>
          <FocusModeToggle active={focusMode} onToggle={toggleFocusMode} />
        </div>

        {/* SECTION 2: Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          {loading
            ? Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="bg-card rounded-xl border border-border p-4 shadow-card">
                  <Skeleton className="h-5 w-5 rounded mb-2" />
                  <Skeleton className="h-7 w-16 mb-1" />
                  <Skeleton className="h-3 w-20" />
                </div>
              ))
            : stats.map((s, i) => (
                <motion.div key={s.label} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
                  onClick={s.onClick}
                  className={`bg-card rounded-xl border border-border p-4 shadow-card ${s.onClick ? "cursor-pointer hover:border-primary/50 transition-colors" : ""}`}
                >
                  <s.icon className={`h-5 w-5 ${s.color} mb-2`} />
                  <p className="text-2xl font-bold text-card-foreground">{s.value}</p>
                  <p className="text-xs text-muted-foreground">{s.label}</p>
                </motion.div>
              ))
          }
        </div>

        {/* Badge panel */}
        <AnimatePresence>
          {showBadges && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="mb-8 overflow-hidden">
              <div className="bg-card rounded-xl border border-border shadow-card p-6">
                <div className="flex items-center gap-2 mb-4">
                  <Award className="h-5 w-5 text-accent" />
                  <h2 className="text-lg font-semibold text-card-foreground">I tuoi badge</h2>
                  <span className="text-xs text-muted-foreground ml-auto">{badgeCount}/{Object.keys(BADGE_DEFINITIONS).length} sbloccati</span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                  {Object.entries(BADGE_DEFINITIONS).map(([key, def]) => {
                    const earned = achievements.some((a) => a.achievement_type === key);
                    return (
                      <div key={key} className={`rounded-xl border p-3 text-center transition-all ${earned ? "border-primary/30 bg-primary/5" : "border-border opacity-40 grayscale"}`}>
                        <div className="text-2xl mb-1">{def.icon}</div>
                        <p className="text-xs font-medium text-card-foreground">{def.name}</p>
                        <p className="text-[10px] text-muted-foreground">{def.description}</p>
                      </div>
                    );
                  })}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Trial Banner */}
        <TrialBanner />
        <CreditLowAlert />
        <CrisisSuggestBanner onActivate={() => setShowCrisisMode(true)} />

        {/* Exam Countdown + Due Cards + Focus Score */}}
        <div className="space-y-3 mb-6">
          {loading
            ? <div className="bg-card rounded-xl border border-border p-4 flex items-center gap-4">
                <Skeleton className="h-20 w-20 rounded-full shrink-0" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-3 w-32" />
                  <div className="grid grid-cols-2 gap-2 mt-2">
                    {[0,1,2,3].map(i => <Skeleton key={i} className="h-3 w-full" />)}
                  </div>
                </div>
              </div>
            : <FocusScoreWidget
                streakDays={streakCount}
                focusMinToday={totalFocusMinutes}
                tasksCompleted={tasksCompletedToday}
                tasksTotal={Math.max(tasksTotalToday, tasksCompletedToday)}
                quizzesToday={quizzesToday}
              />
          }
          <ExamCountdownWidget />
          <DueCardsWidget onStartQuickReview={() => setShowQuickReview(true)} initialCount={dashboardDueCount} />
          <WeakTopicsQuiz
            onStartQuiz={(ids) => { setWeakQuizIds(ids); setShowWeakQuiz(true); }}
          />

          {/* Focus Burst + Crisis mode quick actions */}
          <div className="flex gap-2">
            <button
              onClick={() => setShowFocusBurst(true)}
              className="flex-1 flex items-center gap-2 bg-primary/5 border border-primary/20 rounded-xl p-3 hover:border-primary/50 hover:bg-primary/10 transition-all text-left"
            >
              <span className="text-xl">⚡</span>
              <div>
                <p className="text-xs font-semibold text-card-foreground">Focus Burst</p>
                <p className="text-[10px] text-muted-foreground">Studio intenso 5 min</p>
              </div>
            </button>
            <button
              onClick={() => setShowCrisisMode(true)}
              className="flex-1 flex items-center gap-2 bg-destructive/5 border border-destructive/20 rounded-xl p-3 hover:border-destructive/40 hover:bg-destructive/10 transition-all text-left"
            >
              <span className="text-xl">🔥</span>
              <div>
                <p className="text-xs font-semibold text-card-foreground">Modalità Crisi</p>
                <p className="text-[10px] text-muted-foreground">Piano sprint 48h</p>
              </div>
            </button>
          </div>
        </div>

        {/* Study AI CTA */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="mb-8">
          <Link to="/study" id="tour-study-ai">
            <div className="bg-card rounded-xl border border-primary/30 shadow-soft p-5 flex items-center gap-4 hover:border-primary transition-colors group cursor-pointer">
              <div className="h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center shrink-0 group-hover:bg-primary/20 transition-colors">
                <Sparkles className="h-6 w-6 text-primary" />
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-card-foreground">Studio AI</h3>
                <p className="text-sm text-muted-foreground">Carica documenti e genera quiz, flashcard e mappe concettuali automaticamente</p>
              </div>
              <Button size="sm">Vai allo studio</Button>
            </div>
          </Link>
        </motion.div>

        {/* Low energy motivational banner */}
        {energyLevel === "low" && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="mb-6 bg-primary/5 border border-primary/20 rounded-xl p-4 text-center">
            <p className="text-sm text-card-foreground">🌱 <strong>Modalità Bassa Energia attiva.</strong> Fai un piccolo passo alla volta. Ce la fai! 💪</p>
          </motion.div>
        )}

        {/* Hyperfocus mode banner */}
        {energyLevel === "hyperfocus" && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
            className="mb-6 bg-accent/5 border border-accent/20 rounded-xl p-4 space-y-3">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <p className="text-sm text-card-foreground">
                🔥 <strong>Modalità Iperfocus attiva.</strong> Distrazioni nascoste · Focus totale
              </p>
              <div className="flex items-center gap-2">
                <select
                  value={ambientSound}
                  onChange={(e) => changeAmbientSound(e.target.value as any)}
                  className="text-xs bg-background border border-border rounded-md px-2 py-1.5 text-foreground"
                >
                  {AMBIENT_SOUNDS.map((s) => (
                    <option key={s.id} value={s.id}>{s.emoji} {s.label}</option>
                  ))}
                </select>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={toggleAmbientSound}
                  className={ambientActive ? "border-primary text-primary" : ""}
                  disabled={ambientSound === "none"}
                >
                  {ambientActive ? <Volume2 className="h-4 w-4 mr-2" /> : <VolumeX className="h-4 w-4 mr-2" />}
                  {ambientActive ? "Pausa" : "Riproduci"}
                </Button>
              </div>
            </div>
            {ambientLoadError && (
              <p className="text-xs text-destructive">
                ⚠️ Impossibile riprodurre il suono. Verifica la connessione o prova un altro suono.
              </p>
            )}
          </motion.div>
        )}

        {/* SECTION 3: Main content - 2 columns */}
        <div className="grid md:grid-cols-2 gap-6 mb-8">
          {/* Column 1: Tasks + Objectives */}
          <div className="space-y-6">
            <div className="bg-card rounded-xl border border-border shadow-card p-6">
              <div className="flex items-center gap-2 mb-4">
                <BookOpen className="h-5 w-5 text-primary" />
                <h2 className="text-lg font-semibold text-card-foreground">I tuoi task</h2>
              </div>
              <form onSubmit={addTask} className="flex gap-2 mb-6">
                <Input placeholder="Aggiungi un nuovo task..." value={newTask} onChange={(e) => setNewTask(e.target.value)} className="flex-1" />
                <Button type="submit" size="icon" aria-label="Aggiungi task"><Plus className="h-4 w-4" /></Button>
              </form>
              {tasks.length === 0 ? (
                <p className="text-center text-muted-foreground py-8 text-sm">Nessun task ancora. Inizia aggiungendo il tuo primo obiettivo! 🎯</p>
              ) : (
                <ul className="space-y-2 max-h-64 overflow-y-auto">
                  {tasks.map((task) => (
                    <li key={task.id} className="flex items-center gap-3 p-3 rounded-lg hover:bg-secondary/50 transition-colors">
                      <Checkbox checked={task.completed} onCheckedChange={() => toggleTask(task.id, task.completed)} />
                      <span className={`flex-1 text-sm ${task.completed ? "line-through text-muted-foreground" : "text-card-foreground"}`}>{task.title}</span>
                      {task.completed && <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <DailyObjectives />
            {!focusMode && <WeeklyChallenges />}
          </div>

          {/* Column 2: Focus + AI Tutor */}
          <div className="space-y-6">
            <div id="tour-pomodoro">
              <PomodoroTimer energyLevel={energyLevel} onSessionComplete={refreshScoreMetrics} />
            </div>

            {/* Fortune Wheel daily button */}
            <button
              onClick={() => !focusMode && setShowFortuneWheel(true)}
            style={focusMode ? { display: "none" } : undefined}
              className="w-full flex items-center gap-3 p-4 rounded-xl border border-border bg-card hover:border-primary/50 hover:bg-primary/5 transition-all group"
            >
              <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center text-xl shrink-0 group-hover:scale-110 transition-transform">
                🎡
              </div>
              <div className="flex-1 text-left">
                <p className="text-sm font-semibold text-card-foreground">Ruota della Fortuna</p>
                <p className="text-xs text-muted-foreground">Un giro gratuito ogni giorno</p>
              </div>
              <span className="text-xs bg-primary/10 text-primary font-bold px-2 py-0.5 rounded-full shrink-0">
                GRATIS
              </span>
            </button>

            {!focusMode && <PowerUpShop />}

            <AiTutor />

          </div>
        </div>

        {/* Study Plan AI - Full width */}
        <div className="mb-8">
          <StudyPlanAI initialPlan={studyPlanData} preloaded={studyPlanLoaded} onPlanGenerated={setStudyPlanData} />
        </div>
      </main>

      <MobileBottomNav />
      {showOnboarding && <OnboardingTour onComplete={completeOnboarding} />}
      <FortuneWheel open={showFortuneWheel} onClose={() => setShowFortuneWheel(false)} />
      {showFocusBurst && (
        <FocusBurst
          onClose={() => setShowFocusBurst(false)}
          onComplete={(stats) => {
            setShowFocusBurst(false);
            toast({ title: `⚡ Focus Burst completato!`, description: `${stats.cards + stats.questions} elementi · ${stats.score} punti` });
            refreshScoreMetrics();
          }}
        />
      )}
      {showCrisisMode && <CrisisMode open={showCrisisMode} onClose={() => { setShowCrisisMode(false); refreshScoreMetrics(); }} />}

      {/* Weak topics quiz — full-screen overlay usando questions filtrate per ID */}
      {showWeakQuiz && weakQuizIds.length > 0 && (
        <div className="fixed inset-0 z-50 bg-background overflow-y-auto">
          <div className="container mx-auto px-4 py-6 max-w-2xl">
            <div className="flex items-center gap-3 mb-6">
              <button
                onClick={() => setShowWeakQuiz(false)}
                className="text-muted-foreground hover:text-foreground p-2 rounded-lg hover:bg-secondary transition-colors"
              >
                ✕
              </button>
              <div>
                <h2 className="text-lg font-bold text-foreground">Quiz sui tuoi punti deboli</h2>
                <p className="text-xs text-muted-foreground">{weakQuizIds.length} domande selezionate dai tuoi errori</p>
              </div>
            </div>
            {/* Re-use Questions page pattern: filter quiz_questions by IDs */}
            <WeakTopicsQuizPlayer
              questionIds={weakQuizIds}
              onBack={() => setShowWeakQuiz(false)}
            />
          </div>
        </div>
      )}
      {showQuickReview && (
        <QuickReviewSession
          onClose={() => setShowQuickReview(false)}
          onComplete={(reviewed) => {
            setShowQuickReview(false);
            toast({ title: `✅ Ripasso completato!`, description: `${reviewed} carte ripassate. Ottimo lavoro! 🧠` });
            refreshScoreMetrics();
          }}
        />
      )}
    </div>
  );
};

export default Dashboard;
