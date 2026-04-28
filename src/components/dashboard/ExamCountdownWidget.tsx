import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Calendar, Target, ChevronDown, ChevronUp, Pencil, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { useExamCountdown } from "@/hooks/useExamCountdown";

const URGENCY_COLORS = {
  safe:    "border-primary/30    bg-primary/5    text-primary",
  warning: "border-orange-400/30 bg-orange-400/5 text-orange-500",
  urgent:  "border-destructive/30 bg-destructive/5 text-destructive",
  today:   "border-accent/30     bg-accent/5     text-accent",
};

const URGENCY_EMOJIS = {
  safe:    "📅",
  warning: "⚡",
  urgent:  "🔥",
  today:   "🎯",
};

export default function ExamCountdownWidget() {
  const { examInfo, countdown, loading: examLoading, saveExam } = useExamCountdown();
  // FIX: initializzazione asincrona — editing parte false, useEffect la aggiorna
  // quando i dati sono caricati (prima apriva sempre il form perché examInfo era null)
  const [editing, setEditing]                = useState(false);
  const [dateInput, setDateInput]            = useState("");
  const [subjectInput, setSubjectInput]      = useState("");
  const [saving, setSaving]                  = useState(false);
  const [expanded, setExpanded]              = useState(true);

  // FIX: sync form fields and editing state once examInfo loads from DB
  useEffect(() => {
    if (examInfo?.exam_date) {
      setDateInput(examInfo.exam_date);
      setSubjectInput(examInfo.exam_subject ?? "");
      setEditing(false); // data exists → show countdown, not form
    } else if (examInfo !== null) {
      // examInfo loaded but no exam set → show form
      setEditing(true);
    }
  }, [examInfo]);

  const handleSave = async () => {
    if (!dateInput) return;
    setSaving(true);
    await saveExam(dateInput, subjectInput);
    setSaving(false);
    setEditing(false);
  };

  // Mostra skeleton mentre i dati caricano (evita il flash del form sbagliato)
  if (examLoading) {
    return (
      <div className="bg-card rounded-xl border border-border p-4 flex items-center gap-3 animate-pulse">
        <div className="h-5 w-5 bg-secondary rounded-full shrink-0" />
        <div className="flex-1 space-y-2">
          <div className="h-3 bg-secondary rounded w-1/3" />
          <div className="h-2 bg-secondary rounded w-1/2" />
        </div>
      </div>
    );
  }

  // No exam set + not editing → show prompt
  if (!examInfo?.exam_date && !editing) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-card rounded-xl border border-dashed border-border p-4 cursor-pointer hover:border-primary/50 transition-colors"
        onClick={() => setEditing(true)}
      >
        <div className="flex items-center gap-3">
          <Calendar className="h-5 w-5 text-muted-foreground" />
          <div>
            <p className="text-sm font-medium text-card-foreground">Aggiungi la data del tuo esame</p>
            <p className="text-xs text-muted-foreground">Il piano di studio si adatterà alla scadenza</p>
          </div>
          <Button variant="outline" size="sm" className="ml-auto shrink-0">Aggiungi</Button>
        </div>
      </motion.div>
    );
  }

  // Edit form
  if (editing) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-card rounded-xl border border-border p-4 space-y-3"
      >
        <p className="text-sm font-semibold text-card-foreground flex items-center gap-2">
          <Target className="h-4 w-4 text-primary" /> Imposta il tuo esame
        </p>
        <Input
          type="text"
          placeholder="Materia (es. Anatomia, Diritto Privato...)"
          value={subjectInput}
          onChange={(e) => setSubjectInput(e.target.value)}
        />
        <Input
          type="date"
          value={dateInput}
          onChange={(e) => setDateInput(e.target.value)}
          min={new Date().toISOString().split("T")[0]}
        />
        <div className="flex gap-2">
          <Button size="sm" onClick={handleSave} disabled={!dateInput || saving} className="flex-1">
            {saving ? "Salvando..." : <><CheckCircle2 className="h-3.5 w-3.5 mr-1" />Salva</>}
          </Button>
          {examInfo?.exam_date && (
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Annulla</Button>
          )}
        </div>
      </motion.div>
    );
  }

  if (!countdown) return null;

  const urgency     = countdown.urgency;
  const colorClass  = URGENCY_COLORS[urgency];
  const emoji       = URGENCY_EMOJIS[urgency];

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={`rounded-xl border p-4 ${colorClass.split(" ").slice(0, 2).join(" ")} border-opacity-30`}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-lg">{emoji}</span>
          <div>
            <p className="text-sm font-semibold text-card-foreground">
              {examInfo?.exam_subject || "Esame"}
            </p>
            <p className="text-xs text-muted-foreground">
              {new Date(examInfo!.exam_date!).toLocaleDateString("it-IT", {
                weekday: "long", day: "numeric", month: "long",
              })}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditing(true)}>
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setExpanded((p) => !p)}>
            {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </Button>
        </div>
      </div>

      {/* Days remaining — big number */}
      <div className="text-center my-3">
        {countdown.daysLeft !== null && countdown.daysLeft >= 0 ? (
          <>
            <p className={`text-4xl font-bold ${colorClass.split(" ").slice(2).join(" ")}`}>
              {countdown.daysLeft}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {countdown.daysLeft === 0 ? "È oggi! In bocca al lupo 🍀" :
               countdown.daysLeft === 1 ? "giorno rimanente" :
               `giorni rimanenti · ${countdown.weeksLeft} ${countdown.weeksLeft === 1 ? "settimana" : "settimane"}`}
            </p>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">Esame passato</p>
        )}
      </div>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            {/* Weekly study goal */}
            <div className="mt-3 space-y-1.5">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Obiettivo settimanale</span>
                <span className="font-medium">
                  {countdown.weeklyProgress}/{countdown.weeklyGoal} min
                </span>
              </div>
              <Progress value={countdown.weeklyPercent} className="h-2" />
              <p className="text-[10px] text-muted-foreground">
                {countdown.weeklyPercent >= 100
                  ? "🎉 Obiettivo settimanale raggiunto!"
                  : `${countdown.weeklyGoal - countdown.weeklyProgress} minuti al tuo obiettivo di questa settimana`}
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
