import { useState, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Flame, X, CheckCircle2, ChevronDown, ChevronUp, Loader2, Zap, Brain } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useExamCountdown } from "@/hooks/useExamCountdown";
import { useToast } from "@/hooks/use-toast";
import ReactMarkdown from "react-markdown";

interface SprintStep {
  id: number; title: string; description: string;
  duration: string; type: "review"|"quiz"|"summary"|"break"; completed: boolean;
}
const STEP_EMOJIS: Record<string, string> = { review:"🃏", quiz:"📝", summary:"📄", break:"☕" };

interface CrisisModeProps { open: boolean; onClose: () => void; }

export default function CrisisMode({ open, onClose }: CrisisModeProps) {
  const { user }                       = useAuth();
  const { toast }                      = useToast();
  const { examInfo, countdown }        = useExamCountdown();
  const [steps, setSteps]              = useState<SprintStep[]>([]);
  const [advice, setAdvice]            = useState("");
  const [loading, setLoading]          = useState(false);
  const [expandedStep, setExpandedStep]= useState<number | null>(0);
  const [sessionId, setSessionId]      = useState<string | null>(null);
  const [loadingExisting, setLoadingExisting] = useState(true);

  // FIX: carica il piano salvato quando il modal si apre
  // Prima: il piano era perso alla chiusura del modal
  useEffect(() => {
    if (!open || !user) return;
    setLoadingExisting(true);
    supabase
      .from("crisis_sessions")
      .select("id, plan_content, completed_steps, total_steps, exam_subject, expires_at")
      .eq("user_id", user.id)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        if (data && data.plan_content) {
          const plan = data.plan_content as unknown as { advice: string; steps: SprintStep[] };
          if (plan.steps?.length > 0) {
            setSteps(plan.steps);
            setAdvice(plan.advice || "");
            setSessionId(data.id);
          }
        }
        setLoadingExisting(false);
      });
  }, [open, user]);

  const completedCount = steps.filter(s => s.completed).length;
  const progressPct    = steps.length > 0 ? Math.round((completedCount/steps.length)*100) : 0;

  const generatePlan = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const [errorsRes, decksRes] = await Promise.allSettled([
        supabase.from("user_question_progress").select("topic")
          .eq("user_id", user.id).eq("is_correct", false)
          .order("answered_at", { ascending: false }).limit(50),
        supabase.from("flashcard_decks").select("title,card_count")
          .eq("user_id", user.id).order("created_at", { ascending: false }).limit(5),
      ]);
      const errors    = errorsRes.status==="fulfilled" ? errorsRes.value.data??[] : [];
      const decks     = decksRes.status==="fulfilled"  ? decksRes.value.data??[]  : [];
      const topicCounts: Record<string,number> = {};
      for (const e of errors as any[]) {
        const t = e.topic||"Generale"; topicCounts[t]=(topicCounts[t]||0)+1;
      }
      const weakTopics = Object.entries(topicCounts).sort((a,b)=>b[1]-a[1]).slice(0,5)
        .map(([t,c])=>`${t} (${c} errori)`).join(", ");
      const deckList   = (decks as any[]).map(d=>`"${d.title}" (${d.card_count} carte)`).join(", ");
      const hoursAvailable = countdown?.daysLeft===0 ? 12 : 48;
      const subject = examInfo?.exam_subject||"l'esame";

      // FIX: usa supabase.functions.invoke invece di VITE_BACKEND_URL (non configurato in Lovable)
      const { data: fnData, error: fnError } = await supabase.functions.invoke("generate-summary", {
        body: {
          content: `Sei un coach di studio ADHD. Crea piano sprint emergenza per ${subject}.
Ore disponibili: ${hoursAvailable}h
Argomenti deboli: ${weakTopics||"n/d"}
Materiale disponibile: ${deckList||"n/d"}
GENERA: piano orario (sessioni 25min+pause 5min), cosa fare esattamente, priorità assolute (5 cose da sapere), trucchi ADHD, messaggio motivazionale.
Sii CONCRETO e BREVE. Usa emoji. In italiano. Max 500 parole.`,
          format: "smart_notes",
          title: `Piano Crisi — ${subject}`,
        },
      });
      const res = { ok: !fnError && fnData };
      if (res.ok) {
        const content = fnData?.content || "";
        setAdvice(content);
        const builtSteps: SprintStep[] = [
          { id:1, title:"Revisione argomenti deboli",   description:`Ripassa: ${weakTopics||"argomenti principali"}`, duration:"25 min", type:"review",  completed:false },
          { id:2, title:"Quiz rapido",                   description:"15 domande sui temi più probabili",               duration:"20 min", type:"quiz",    completed:false },
          { id:3, title:"Pausa attiva",                  description:"Muoviti, bevi acqua, respira",                    duration:"5 min",  type:"break",   completed:false },
          { id:4, title:"Flashcard intensive",           description:`Ripassa: ${deckList||"il tuo materiale"}`,        duration:"25 min", type:"review",  completed:false },
          { id:5, title:"Quiz finale",                   description:"Test completo per misurare il livello",           duration:"20 min", type:"quiz",    completed:false },
          { id:6, title:"Ripasso definizioni chiave",    description:"Memorizza le 10 definizioni più importanti",      duration:"15 min", type:"summary", completed:false },
          { id:7, title:"Pausa lunga",                   description:"15 min di riposo, niente telefono",               duration:"15 min", type:"break",   completed:false },
          { id:8, title:"Simulazione esame",             description:"Rispondi a domande a tempo senza aiuti",          duration:"30 min", type:"quiz",    completed:false },
        ].slice(0, hoursAvailable<=12 ? 5 : 8);
        setSteps(builtSteps);
        const { data: session } = await supabase.from("crisis_sessions").insert({
          user_id: user.id, exam_subject: subject, hours_available: hoursAvailable,
          plan_content: { advice: content, steps: builtSteps }, total_steps: builtSteps.length,
          expires_at: new Date(Date.now()+hoursAvailable*3_600_000).toISOString(),
        }).select("id").single();
        if (session) setSessionId(session.id);
      } else {
        toast({ title:"Errore", description: funcErr?.message || "Riprova tra un momento.", variant:"destructive" });
      }
    } catch(e) {
      toast({ title:"Errore", description:"Impossibile generare il piano.", variant:"destructive" });
    } finally {
      setLoading(false);
    }
  }, [user, examInfo, countdown, toast]);

  const toggleStep = async (id: number) => {
    const updated = steps.map(s => s.id===id ? {...s, completed:!s.completed} : s);
    setSteps(updated);
    const done = updated.filter(s=>s.completed).length;
    if (sessionId) await supabase.from("crisis_sessions").update({ completed_steps:done }).eq("id",sessionId);
    if (done===updated.length) setTimeout(()=>toast({ title:"🎯 Piano completato!", description:"In bocca al lupo! 🍀" }),300);
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div initial={{ opacity:0 }} animate={{ opacity:1 }} exit={{ opacity:0 }}
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center"
          onClick={onClose}>
          <motion.div
            initial={{ y:100, opacity:0 }} animate={{ y:0, opacity:1 }}
            exit={{ y:100, opacity:0 }}
            transition={{ type:"spring", damping:25, stiffness:260 }}
            onClick={e=>e.stopPropagation()}
            className="bg-card w-full sm:max-w-xl rounded-t-3xl sm:rounded-2xl border border-border shadow-2xl flex flex-col"
            style={{ maxHeight:"90dvh" }}>

            {/* Handle bar — mobile */}
            <div className="flex justify-center pt-2 pb-1 sm:hidden">
              <div className="w-10 h-1 rounded-full bg-border" />
            </div>

            {/* Header */}
            <div className="bg-gradient-to-r from-destructive/20 via-orange-500/10 to-destructive/20 border-b border-destructive/20 px-4 py-3 flex items-center gap-3 shrink-0 rounded-t-3xl sm:rounded-t-2xl">
              <div className="h-9 w-9 rounded-xl bg-destructive/20 flex items-center justify-center shrink-0">
                <Flame className="h-5 w-5 text-destructive animate-pulse" />
              </div>
              <div className="flex-1 min-w-0">
                <h2 className="text-sm font-bold text-card-foreground flex items-center gap-2 flex-wrap">
                  Modalità Crisi 🔥
                  {countdown && (
                    <Badge variant="destructive" className="text-[10px]">
                      {countdown.daysLeft===0 ? "OGGI" : `${countdown.daysLeft}g`}
                    </Badge>
                  )}
                </h2>
                <p className="text-xs text-muted-foreground truncate">
                  Piano sprint · {examInfo?.exam_subject||"esame imminente"}
                </p>
              </div>
              <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-1 shrink-0">
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Scrollable body */}
            <div className="overflow-y-auto flex-1 px-4 py-4 space-y-4 overscroll-contain">
              {loadingExisting && steps.length===0 && (
                <div className="text-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-destructive mx-auto" />
                </div>
              )}

              {!loadingExisting && !loading && steps.length===0 && (
                <div className="text-center py-6 space-y-4">
                  <div className="text-5xl">⚡</div>
                  <div>
                    <p className="font-semibold text-card-foreground mb-1">Piano sprint personalizzato</p>
                    <p className="text-sm text-muted-foreground">L'AI analizza i tuoi errori e crea un piano per le prossime ore</p>
                  </div>
                  <Button onClick={generatePlan} size="lg"
                    className="bg-destructive hover:bg-destructive/90 gap-2 w-full sm:w-auto">
                    <Flame className="h-4 w-4" /> Genera piano di emergenza
                  </Button>
                </div>
              )}

              {loading && (
                <div className="text-center py-8 space-y-3">
                  <Loader2 className="h-8 w-8 animate-spin text-destructive mx-auto" />
                  <p className="text-sm text-muted-foreground">Analisi errori + generazione piano...</p>
                </div>
              )}

              {steps.length > 0 && (
                <>
                  <div className="bg-secondary/50 rounded-xl p-3 space-y-2">
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>Progresso sprint</span>
                      <span className="font-bold text-card-foreground">{completedCount}/{steps.length}</span>
                    </div>
                    <Progress value={progressPct} className="h-2" />
                  </div>

                  <div className="space-y-2">
                    {steps.map(step => (
                      <motion.div key={step.id}
                        className={`border rounded-xl overflow-hidden ${step.completed ? "border-primary/30 bg-primary/5" : "border-border bg-card"}`}>
                        <button className="w-full flex items-center gap-3 p-3 text-left min-h-[52px]"
                          onClick={() => setExpandedStep(expandedStep===step.id ? null : step.id)}>
                          <span className="text-lg shrink-0">{STEP_EMOJIS[step.type]}</span>
                          <div className="flex-1 min-w-0">
                            <p className={`text-sm font-medium truncate ${step.completed ? "line-through text-muted-foreground" : "text-card-foreground"}`}>
                              {step.title}
                            </p>
                            <p className="text-xs text-muted-foreground">{step.duration}</p>
                          </div>
                          <button
                            onClick={e => { e.stopPropagation(); toggleStep(step.id); }}
                            className={`h-7 w-7 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors ${
                              step.completed ? "border-primary bg-primary text-primary-foreground" : "border-border hover:border-primary active:scale-95"
                            }`}>
                            {step.completed && <CheckCircle2 className="h-4 w-4" />}
                          </button>
                          {expandedStep===step.id
                            ? <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" />
                            : <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />}
                        </button>
                        <AnimatePresence>
                          {expandedStep===step.id && (
                            <motion.div initial={{ height:0 }} animate={{ height:"auto" }} exit={{ height:0 }} className="overflow-hidden">
                              <p className="px-3 pb-3 text-xs text-muted-foreground border-t border-border pt-2">{step.description}</p>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </motion.div>
                    ))}
                  </div>

                  {advice && (
                    <div className="border border-destructive/20 rounded-xl overflow-hidden">
                      <div className="bg-destructive/5 px-3 py-2 flex items-center gap-2">
                        <Brain className="h-4 w-4 text-destructive" />
                        <span className="text-xs font-semibold text-card-foreground">Piano dettagliato AI</span>
                      </div>
                      <div className="p-3 prose prose-sm dark:prose-invert max-w-none text-xs">
                        <ReactMarkdown>{advice}</ReactMarkdown>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Footer CTA */}
            {steps.length > 0 && (
              <div className="border-t border-border p-3 shrink-0 safe-bottom">
                <Button className="w-full bg-destructive hover:bg-destructive/90 gap-2 h-12" onClick={onClose}>
                  <Zap className="h-4 w-4" /> Inizia il primo blocco
                </Button>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
