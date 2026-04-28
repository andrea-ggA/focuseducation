import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Brain, Sparkles, BookOpen, Timer, Target, ArrowRight, X, Calendar, Zap } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import confetti from "canvas-confetti";
import { activateTrial } from "@/hooks/useTrial";

interface OnboardingTourProps {
  onComplete: () => void;
}

const STUDY_LEVELS = [
  { value: "liceo",        label: "Liceo / Superiori",    emoji: "🏫" },
  { value: "universita",   label: "Università",           emoji: "🎓" },
  { value: "post_laurea",  label: "Post-laurea / Master", emoji: "📜" },
  { value: "professionale",label: "Formazione professionale", emoji: "💼" },
  { value: "autodidatta",  label: "Autodidatta",          emoji: "🌱" },
];

const ADHD_LEVELS = [
  { value: "low",    label: "Raramente",   desc: "Mi concentro abbastanza bene",    emoji: "😌" },
  { value: "medium", label: "A volte",     desc: "Ho alti e bassi nella giornata",  emoji: "🌊" },
  { value: "high",   label: "Spesso",      desc: "La distrazione è una sfida costante", emoji: "⚡" },
];

export default function OnboardingTour({ onComplete }: OnboardingTourProps) {
  const { user } = useAuth();
  const [step, setStep]               = useState(0);
  const [studyLevel, setStudyLevel]   = useState("");
  const [adhdLevel, setAdhdLevel]     = useState("");
  const [examSubject, setExamSubject] = useState("");
  const [examDate, setExamDate]       = useState("");
  const [saving, setSaving]           = useState(false);

  const TOTAL_STEPS = 5;
  const progress = ((step + 1) / TOTAL_STEPS) * 100;

  const handleFinish = async () => {
    setSaving(true);
    try {
      const updates: Record<string, boolean | string | string[] | null> = {
        onboarding_completed: true,
        study_level: studyLevel || null,
        adhd_traits: adhdLevel ? [adhdLevel] : null,
      };
      if (examSubject) updates.exam_subject = examSubject;
      if (examDate)    updates.exam_date    = examDate;

      if (user) {
        await supabase.from("profiles").update(updates).eq("user_id", user.id);
      }

      // Activate 7-day trial automatically for new users
      if (user) {
        await activateTrial(user.id).catch(() => {
          // Trial may already exist for this account.
        });
      }
      confetti({ particleCount: 80, spread: 70, origin: { y: 0.6 }, colors: ["#2a9d8f", "#e9c46a", "#f4a261"] });
    } catch (e) {
      console.error("[Onboarding]", e);
    } finally {
      setSaving(false);
      onComplete();
    }
  };

  const canAdvance = [
    true,              // step 0 — welcome, always ok
    !!studyLevel,      // step 1 — need study level
    true,              // step 2 — adhd level optional
    true,              // step 3 — exam optional
    true,              // step 4 — quick win, always ok
  ][step] ?? true;

  const steps = [
    /* ── Step 0: Welcome ── */
    <motion.div key="welcome" initial={{ opacity: 0, x: 40 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -40 }} className="space-y-6 text-center">
      <div className="relative inline-block">
        <div className="h-24 w-24 rounded-3xl bg-primary/10 flex items-center justify-center mx-auto">
          <Brain className="h-12 w-12 text-primary" />
        </div>
        {[...Array(6)].map((_, i) => (
          <motion.div key={i} className="absolute w-2 h-2 rounded-full bg-primary/50"
            style={{ top: "50%", left: "50%" }}
            animate={{ x: Math.cos(i * 60 * Math.PI / 180) * 55, y: Math.sin(i * 60 * Math.PI / 180) * 55, opacity: [0, 1, 0] }}
            transition={{ duration: 2, delay: i * 0.2, repeat: Infinity, repeatDelay: 0.5 }}
          />
        ))}
      </div>
      <div>
        <h2 className="text-2xl font-bold text-foreground mb-2">Benvenuto in FocusED! 🎉</h2>
        <p className="text-muted-foreground leading-relaxed">
          La piattaforma AI progettata <strong>specificamente per studenti con ADHD</strong>.<br />
          30 secondi per personalizzarla per te.
        </p>
      </div>
      <div className="grid grid-cols-3 gap-3 text-center">
        {[
          { icon: Sparkles, label: "Quiz AI",        desc: "Dal tuo materiale" },
          { icon: BookOpen, label: "Flashcard SM-2", desc: "Ripasso intelligente" },
          { icon: Timer,    label: "Pomodoro ADHD",  desc: "Focus adattivo" },
        ].map(({ icon: Icon, label, desc }) => (
          <div key={label} className="bg-secondary/50 rounded-xl p-3">
            <Icon className="h-5 w-5 text-primary mx-auto mb-1.5" />
            <p className="text-xs font-semibold text-card-foreground">{label}</p>
            <p className="text-[10px] text-muted-foreground">{desc}</p>
          </div>
        ))}
      </div>
    </motion.div>,

    /* ── Step 1: Study level ── */
    <motion.div key="level" initial={{ opacity: 0, x: 40 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -40 }} className="space-y-4">
      <div className="text-center mb-2">
        <h2 className="text-xl font-bold text-foreground">Qual è il tuo livello?</h2>
        <p className="text-sm text-muted-foreground mt-1">FocusED adatterà il linguaggio e la difficoltà</p>
      </div>
      <div className="space-y-2">
        {STUDY_LEVELS.map((l) => (
          <button
            key={l.value}
            onClick={() => setStudyLevel(l.value)}
            className={`w-full flex items-center gap-3 p-3.5 rounded-xl border text-left transition-all ${
              studyLevel === l.value
                ? "border-primary bg-primary/5 shadow-sm"
                : "border-border hover:border-primary/40 bg-card"
            }`}
          >
            <span className="text-2xl">{l.emoji}</span>
            <span className="text-sm font-medium text-card-foreground">{l.label}</span>
            {studyLevel === l.value && <span className="ml-auto text-primary text-sm">✓</span>}
          </button>
        ))}
      </div>
    </motion.div>,

    /* ── Step 2: ADHD level ── */
    <motion.div key="adhd" initial={{ opacity: 0, x: 40 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -40 }} className="space-y-4">
      <div className="text-center mb-2">
        <h2 className="text-xl font-bold text-foreground">Quanto ti distrai?</h2>
        <p className="text-sm text-muted-foreground mt-1">Non ci sono risposte giuste — siamo qui per aiutarti</p>
      </div>
      <div className="space-y-2">
        {ADHD_LEVELS.map((l) => (
          <button
            key={l.value}
            onClick={() => setAdhdLevel(l.value)}
            className={`w-full flex items-center gap-3 p-3.5 rounded-xl border text-left transition-all ${
              adhdLevel === l.value
                ? "border-primary bg-primary/5 shadow-sm"
                : "border-border hover:border-primary/40 bg-card"
            }`}
          >
            <span className="text-2xl">{l.emoji}</span>
            <div className="flex-1">
              <p className="text-sm font-medium text-card-foreground">{l.label}</p>
              <p className="text-xs text-muted-foreground">{l.desc}</p>
            </div>
            {adhdLevel === l.value && <span className="text-primary text-sm">✓</span>}
          </button>
        ))}
      </div>
      <button onClick={() => setAdhdLevel("")} className="text-xs text-muted-foreground hover:text-foreground transition-colors w-full text-center">
        Preferisco non dirlo — salta
      </button>
    </motion.div>,

    /* ── Step 4: Quick win — generate something NOW ── */
    <motion.div key="quickwin" initial={{ opacity: 0, x: 40 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -40 }} className="space-y-4">
      <div className="text-center mb-2">
        <div className="h-14 w-14 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-3">
          <Sparkles className="h-7 w-7 text-primary" />
        </div>
        <h2 className="text-xl font-bold text-foreground">Pronto a vedere la magia? ✨</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Vai subito in Studio AI e carica il tuo primo documento — vedrai cosa genera FocusED in 30 secondi.
        </p>
      </div>
      <div className="space-y-2">
        {[
          { emoji: "📄", label: "Un PDF delle tue dispense" },
          { emoji: "📝", label: "Un documento Word dei tuoi appunti" },
          { emoji: "🎬", label: "Un link YouTube di una lezione" },
          { emoji: "✍️", label: "Testo incollato direttamente" },
        ].map((item) => (
          <div key={item.label} className="flex items-center gap-3 p-3 bg-secondary/50 rounded-xl">
            <span className="text-2xl">{item.emoji}</span>
            <span className="text-sm text-card-foreground">{item.label}</span>
          </div>
        ))}
      </div>
      <div className="bg-primary/5 border border-primary/20 rounded-xl p-3 text-center">
        <p className="text-xs text-muted-foreground">
          Clicca <strong>Inizia a studiare</strong> e sarai portato direttamente in Studio AI.
          I tuoi primi 15 NeuroCredits ti aspettano! 🎯
        </p>
      </div>
    </motion.div>,

  /* ── Step 3: Exam date ── */
    <motion.div key="exam" initial={{ opacity: 0, x: 40 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -40 }} className="space-y-4">
      <div className="text-center mb-2">
        <div className="h-14 w-14 rounded-2xl bg-accent/10 flex items-center justify-center mx-auto mb-3">
          <Target className="h-7 w-7 text-accent" />
        </div>
        <h2 className="text-xl font-bold text-foreground">Hai un esame in arrivo?</h2>
        <p className="text-sm text-muted-foreground mt-1">Il countdown ti aiuterà a pianificare lo studio settimana per settimana</p>
      </div>
      <div className="space-y-3">
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Materia</label>
          <Input
            placeholder="Es. Anatomia, Diritto Privato, Analisi 2..."
            value={examSubject}
            onChange={(e) => setExamSubject(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
            <Calendar className="h-3.5 w-3.5" /> Data esame
          </label>
          <Input
            type="date"
            value={examDate}
            onChange={(e) => setExamDate(e.target.value)}
            min={new Date().toISOString().split("T")[0]}
          />
        </div>
      </div>

      {examDate && examSubject && (
        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
          className="bg-primary/5 border border-primary/20 rounded-xl p-3 flex items-center gap-3">
          <Zap className="h-4 w-4 text-primary shrink-0" />
          <p className="text-xs text-card-foreground">
            {(() => {
              const days = Math.round((new Date(examDate).getTime() - Date.now()) / 86400000);
              return days > 0
                ? `${days} giorni a ${examSubject}. Inizia a studiare oggi! 💪`
                : "Esame oggi — in bocca al lupo! 🍀";
            })()}
          </p>
        </motion.div>
      )}

      <button
        onClick={() => { setExamSubject(""); setExamDate(""); }}
        className="text-xs text-muted-foreground hover:text-foreground transition-colors w-full text-center"
      >
        Non ho esami in programma — salta
      </button>
    </motion.div>,

    /* ── Step 4: Quick Win — carica un documento ── */
    <motion.div key="quickwin" initial={{ opacity: 0, x: 40 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -40 }} className="space-y-5">
      <div className="text-center mb-2">
        <div className="text-5xl mb-3">🚀</div>
        <h2 className="text-xl font-bold text-foreground">Tutto pronto!</h2>
        <p className="text-sm text-muted-foreground mt-1">
          In 30 secondi puoi già avere il tuo primo quiz.
        </p>
      </div>

      {/* Trial badge */}
      <div className="bg-primary/5 border border-primary/20 rounded-xl p-4 flex items-start gap-3">
        <span className="text-2xl shrink-0">🎁</span>
        <div>
          <p className="text-sm font-semibold text-card-foreground">Trial Hyperfocus Master attivato!</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            7 giorni con 700 NeuroCredits, tutte le funzionalità premium, nessuna carta richiesta.
          </p>
        </div>
      </div>

      {/* What to do first */}
      <div className="space-y-2">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Cosa fare adesso</p>
        {[
          { emoji: "📄", title: "Carica un tuo appunto o PDF",    desc: "Anche solo una pagina — basta per iniziare" },
          { emoji: "⚡", title: "Clicca 'Genera Quiz'",           desc: "L'AI crea domande in 30 secondi" },
          { emoji: "🃏", title: "Oppure genera Flashcard",        desc: "Per studiare con il metodo SM-2" },
        ].map((s) => (
          <div key={s.title} className="flex items-start gap-3 p-3 bg-secondary/40 rounded-xl">
            <span className="text-lg shrink-0">{s.emoji}</span>
            <div>
              <p className="text-sm font-medium text-card-foreground">{s.title}</p>
              <p className="text-xs text-muted-foreground">{s.desc}</p>
            </div>
          </div>
        ))}
      </div>
    </motion.div>,
  ];

  return (
    <div className="fixed inset-0 z-50 bg-background/90 backdrop-blur-sm flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="bg-card rounded-2xl shadow-2xl border border-border w-full max-w-md overflow-hidden"
      >
        {/* Header bar */}
        <div className="px-6 pt-5 pb-0">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs text-muted-foreground font-medium">
              {step + 1} / {TOTAL_STEPS}
            </span>
            <button onClick={onComplete} className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded">
              <X className="h-4 w-4" />
            </button>
          </div>
          <Progress value={progress} className="h-1.5 mb-5" />
        </div>

        {/* Content */}
        <div className="px-6 pb-2 min-h-[360px]">
          <AnimatePresence mode="wait">
            {steps[step]}
          </AnimatePresence>
        </div>

        {/* Footer buttons */}
        <div className="px-6 pb-6 pt-4 flex gap-3">
          {step > 0 && (
            <Button variant="outline" onClick={() => setStep((p) => p - 1)} className="flex-shrink-0">
              Indietro
            </Button>
          )}
          <Button
            className="flex-1 gap-1.5"
            disabled={!canAdvance || saving}
            onClick={() => {
              if (step < TOTAL_STEPS - 1) setStep((p) => p + 1);
              else handleFinish();
            }}
          >
            {saving ? "Salvataggio..." : step === TOTAL_STEPS - 1 ? "Vai a Studio AI 🚀" : (
              <><span>Avanti</span><ArrowRight className="h-4 w-4" /></>
            )}
          </Button>
        </div>
      </motion.div>
    </div>
  );
}
