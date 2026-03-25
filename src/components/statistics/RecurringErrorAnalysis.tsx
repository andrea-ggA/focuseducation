import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Brain, ChevronDown, ChevronUp, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import ReactMarkdown from "react-markdown";

const MIN_WRONG_ANSWERS = 10; // minimum wrong answers needed for meaningful analysis

export default function RecurringErrorAnalysis() {
  const { user }                    = useAuth();
  const [wrongCount, setWrongCount] = useState(0);
  const [analysis, setAnalysis]     = useState<string | null>(null);
  const [loading, setLoading]       = useState(false);
  const [expanded, setExpanded]     = useState(false);
  const [checkedCount, setCheckedCount] = useState(false);

  // Count wrong answers on mount
  useEffect(() => {
    if (!user) return;
    supabase
      .from("user_question_progress")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("is_correct", false)
      .then(({ count }) => {
        setWrongCount(count ?? 0);
        setCheckedCount(true);
      });
  }, [user]);

  // Don't render if not enough data
  if (!checkedCount || wrongCount < MIN_WRONG_ANSWERS) return null;

  const runAnalysis = async () => {
    if (!user || loading) return;
    setLoading(true);
    setExpanded(true);

    try {
      // Fetch wrong answers with topics
      const { data: wrongAnswers } = await supabase
        .from("user_question_progress")
        .select("topic, quiz_id")
        .eq("user_id", user.id)
        .eq("is_correct", false)
        .order("answered_at", { ascending: false })
        .limit(100);

      if (!wrongAnswers || wrongAnswers.length === 0) {
        setAnalysis("Nessun dato sufficiente per l'analisi.");
        return;
      }

      // Aggregate by topic
      const topicCounts: Record<string, number> = {};
      for (const row of wrongAnswers as any[]) {
        const t = (row as any).topic || "Generale";
        topicCounts[t] = (topicCounts[t] || 0) + 1;
      }
      const topicSummary = Object.entries(topicCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([topic, count]) => `- ${topic}: ${count} errori`)
        .join("\n");

      // FIX: usa supabase.functions.invoke invece di VITE_BACKEND_URL (non configurato in Lovable)
      const { data: fnData, error: fnError } = await supabase.functions.invoke("generate-summary", {
        body: {
          content: `Analizza questi errori ricorrenti di uno studente nei quiz e fornisci:
1. I 3 argomenti più critici da ripassare (con spiegazione breve del perché)
2. Una strategia specifica per migliorare in ciascun argomento (max 2 righe per argomento)
3. Un piano d'azione concreto per questa settimana (3-5 azioni specifiche)
4. Un messaggio motivazionale ADHD-friendly

Sii conciso, pratico e incoraggiante. Usa emoji. Rispondi in italiano.

Errori per argomento:
${topicSummary}

Totale errori analizzati: ${wrongAnswers.length}`,
          format: "smart_notes",
          title: "Analisi errori ricorrenti",
        },
      });
      const res = { ok: !fnError && fnData };

      if (res.ok) {
        const data = await res.json();
        const content = data?.result?.markdown || data?.result?.content || "";
        setAnalysis(content || "Analisi completata.");
      } else {
        setAnalysis("Impossibile generare l'analisi. Riprova più tardi.");
      }
    } catch (e) {
      console.error("[RecurringErrorAnalysis]", e);
      setAnalysis("Errore durante l'analisi. Controlla la connessione.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-card rounded-xl border border-border shadow-card overflow-hidden"
    >
      <button
        className="w-full flex items-center justify-between p-4 hover:bg-secondary/30 transition-colors"
        onClick={() => { setExpanded((p) => !p); if (!analysis && !loading) runAnalysis(); }}
      >
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-lg bg-accent/10 flex items-center justify-center">
            <Brain className="h-4 w-4 text-accent" />
          </div>
          <div className="text-left">
            <p className="text-sm font-semibold text-card-foreground">Analisi errori AI</p>
            <p className="text-xs text-muted-foreground">{wrongCount} errori analizzati · Consigli personalizzati</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {!analysis && !loading && (
            <span className="text-[10px] bg-accent/10 text-accent px-2 py-0.5 rounded-full font-medium">Nuovo</span>
          )}
          {expanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
        </div>
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden border-t border-border"
          >
            <div className="p-4">
              {loading && (
                <div className="flex items-center gap-2 py-4 justify-center">
                  <Loader2 className="h-5 w-5 animate-spin text-accent" />
                  <span className="text-sm text-muted-foreground">Analisi in corso...</span>
                </div>
              )}

              {analysis && !loading && (
                <div className="prose prose-sm dark:prose-invert max-w-none text-sm">
                  <ReactMarkdown>{analysis}</ReactMarkdown>
                </div>
              )}

              {analysis && (
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-4 gap-1.5"
                  onClick={runAnalysis}
                  disabled={loading}
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  Rigenera analisi
                </Button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
