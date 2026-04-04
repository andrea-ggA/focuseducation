import { useEffect, useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Loader2, X, XCircle } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";

interface Job {
  id:               string;
  status:           string;
  content_type:     string;
  title:            string | null;
  total_items:      number | null;
  error:            string | null;
  created_at:       string;
  progress_message?: string | null;
  progress_pct?:     number | null;
}

// FIX: ora usa progress_message (colonna dedicata) invece di error
// Manteniamo il parsing dal campo error per retrocompatibilità con job creati prima della migration
function parseProgress(progressMessage: string | null, errorField: string | null) {
  const text = progressMessage || errorField;
  if (!text) return null;
  const m = text.match(/sezione\s+(\d+)\s+di\s+(\d+).*?(\d+)\s+elementi/i);
  if (!m) return null;
  const etaMatch = text.match(/~(\d+)s/i);
  return {
    section: parseInt(m[1]),
    total:   parseInt(m[2]),
    items:   parseInt(m[3]),
    eta:     etaMatch ? `~${etaMatch[1]}s` : null,
  };
}

const TYPE_LABELS: Record<string, string> = {
  flashcards:  "Flashcard",
  quiz:        "Quiz",
  summary:     "Riassunto",
  outline:     "Schema",
  smart_notes: "Appunti Smart",
};

/**
 * GenerationNotifier — rewritten with Supabase Realtime.
 * Previous implementation polled the DB every 3s (40 queries/min per user).
 * This version uses zero queries while idle and receives push updates.
 */
const GenerationNotifier = () => {
  const { user }              = useAuth();
  const { toast }             = useToast();
  const [activeJobs, setActiveJobs] = useState<Job[]>([]);
  // FIX: persist dismissed jobs in sessionStorage so they survive component remounts
  const dismissedRef = useRef<Set<string>>(
    new Set((() => {
      try { return JSON.parse(sessionStorage.getItem("gen_dismissed") || "[]"); }
      catch { return []; }
    })())
  );

  useEffect(() => {
    if (!user) return;

    // Allineato con il safety timeout di DocumentUpload (3 min).
    // Un job più vecchio di 3 minuti senza completarsi è sicuramente hung.
    const STALE_MINUTES = 3;

    // Carica job attivi al mount — pulisce automaticamente gli zombie
    supabase
      .from("generation_jobs")
      .select("*")
      .eq("user_id", user.id)
      .in("status", ["pending", "processing"])
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        const jobs = (data ?? []) as unknown as Job[];
        if (jobs.length === 0) return;

        const now    = Date.now();
        const fresh: Job[] = [];
        const stale:  string[] = [];

        for (const j of jobs) {
          const ageMs = now - new Date(j.created_at).getTime();
          if (ageMs > STALE_MINUTES * 60 * 1000) {
            stale.push(j.id);
          } else if (!dismissedRef.current.has(j.id)) {
            fresh.push(j);
          }
        }

        // Marca i job zombie come errore in modo silenzioso
        if (stale.length > 0) {
          supabase.from("generation_jobs").update({
            status: "error",
            error: "Generazione interrotta (timeout o riavvio pagina)",
            completed_at: new Date().toISOString(),
          }).in("id", stale).then(() => {});
        }

        setActiveJobs(fresh);
      });

    // Realtime: zero polling — DB notifies us on every change
    const channel = supabase
      .channel(`gen_jobs:${user.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "generation_jobs", filter: `user_id=eq.${user.id}` },
        (payload) => {
          const job    = payload.new as Job | undefined;
          const oldJob = payload.old as Job | undefined;

          if (!job) {
            if (oldJob?.id) setActiveJobs((p) => p.filter((j) => j.id !== oldJob.id));
            return;
          }

          if (job.status === "completed") {
            setActiveJobs((p) => p.filter((j) => j.id !== job.id));
            const label = TYPE_LABELS[job.content_type] || job.content_type;
            toast({
              title:       `✅ ${label} pronto!`,
              description: `"${job.title}" generato con successo. ${
                ["summary", "outline", "smart_notes"].includes(job.content_type)
                  ? "Vai alla Libreria per visualizzarlo."
                  : `${job.total_items} elementi. Vai allo Studio AI.`
              }`,
            });
            return;
          }

          if (job.status === "error") {
            setActiveJobs((p) => p.filter((j) => j.id !== job.id));
            toast({ title: "Generazione fallita", description: job.error || "Si è verificato un errore.", variant: "destructive" });
            return;
          }

          if (job.status === "cancelled") {
            setActiveJobs((p) => p.filter((j) => j.id !== job.id));
            return;
          }

          // pending / processing: upsert
          if (!dismissedRef.current.has(job.id)) {
            setActiveJobs((prev) => {
              const exists = prev.some((j) => j.id === job.id);
              return exists
                ? prev.map((j) => (j.id === job.id ? { ...j, ...job } : j))
                : [job, ...prev];
            });
          }
        },
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [user, toast]);

  const cancelJob = async (jobId: string) => {
    await supabase
      .from("generation_jobs")
      .update({ status: "cancelled", error: "Annullato dall'utente", completed_at: new Date().toISOString() })
      .eq("id", jobId);
    toast({ title: "Generazione annullata" });
  };

  const dismissJob = (jobId: string) => {
    dismissedRef.current.add(jobId);
    // FIX: persist dismissal in sessionStorage
    try { sessionStorage.setItem("gen_dismissed", JSON.stringify([...dismissedRef.current])); }
    catch { /* ignore quota errors */ }
    setActiveJobs((p) => p.filter((j) => j.id !== jobId));
  };

  if (activeJobs.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 space-y-2">
      <AnimatePresence>
        {activeJobs.map((job) => {
          const progress = parseProgress(job.progress_message ?? null, job.error);
          const progressPct = Math.max(
            0,
            Math.min(
              100,
              typeof job.progress_pct === "number"
                ? job.progress_pct
                : progress
                  ? Math.round((progress.section / progress.total) * 100)
                  : 0,
            ),
          );
          const hasDeterminateProgress = typeof job.progress_pct === "number" || !!progress;
          const statusLabel = progress
            ? `Analisi sezione ${progress.section} di ${progress.total}...`
            : job.progress_message || `Generando ${TYPE_LABELS[job.content_type] || job.content_type}...`;

          return (
            <motion.div
              key={job.id}
              initial={{ opacity: 0, y: 20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0,  scale: 1    }}
              exit={{   opacity: 0, scale: 0.9           }}
              className="bg-card border border-border rounded-xl shadow-card p-4 min-w-[320px] max-w-[400px]"
            >
              <div className="flex items-start gap-3">
                <Loader2 className="h-5 w-5 text-primary animate-spin shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-card-foreground truncate">
                    {statusLabel}
                  </p>
                  <p className="text-xs text-muted-foreground truncate mt-0.5">
                    {job.title || "In elaborazione"}
                    {progress?.items ? ` · ${progress.items} elementi` : ""}
                    {progress?.eta   ? ` · ${progress.eta}`           : ""}
                  </p>
                  {hasDeterminateProgress ? (
                    <div className="mt-2 space-y-1">
                      <Progress value={progressPct} className="h-1.5" />
                      <p className="text-[10px] text-muted-foreground">{progressPct}% completato</p>
                    </div>
                  ) : (
                    <div className="mt-2 h-1.5 bg-secondary rounded-full overflow-hidden">
                      <motion.div
                        className="h-full bg-primary rounded-full w-1/3"
                        animate={{ x: ["0%", "200%", "0%"] }}
                        transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
                      />
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:bg-destructive/10" onClick={() => cancelJob(job.id)} title="Annulla">
                    <XCircle className="h-4 w-4" />
                  </Button>
                  <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:bg-secondary" onClick={() => dismissJob(job.id)} title="Chiudi">
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
};

export default GenerationNotifier;
