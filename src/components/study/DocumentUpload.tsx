// ╔══════════════════════════════════════════════════════════════════════════════╗
// ║  DocumentUpload.tsx                                                          ║
// ║                                                                              ║
// ║  SEZIONI:                                                                    ║
// ║  § 1  IMPORTS                                                                ║
// ║  § 2  COSTANTI & TIPI  → SUPPORTED_EXTENSIONS, MAX_IMAGES, UploadedImage    ║
// ║  § 3  FILE HELPERS     → extractTextFromPdf, extractTextFromDocx,            ║
// ║                          readFileAsDataURL                                   ║
// ║  § 4  PROPS            → DocumentUploadProps interface                       ║
// ║  § 5  COMPONENT STATE  → useState, useRef, timer YouTube                     ║
// ║  § 6  HANDLER: FILE    → handleFileSelect                                    ║
// ║  § 7  HANDLER: IMMAGINI → handleImageSelect, removeImage                    ║
// ║  § 8  HANDLER: YOUTUBE → handleYoutubeImport                                ║
// ║  § 9  HANDLER: GENERA  → generate (quiz/flashcard)                           ║
// ║  § 10 HANDLER: TOOLS   → handleDecompose, handleMindMap, handleSummary       ║
// ║  § 11 RENDER           → JSX del componente                                  ║
// ╚══════════════════════════════════════════════════════════════════════════════╝

import { useState, useRef, useEffect, useCallback } from "react";
import { Upload, FileText, Loader2, Sparkles, BookOpen, Zap, Brain, Map, Lock, Camera, X, ScrollText, BookMarked, Youtube } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { useCredits, CREDIT_COSTS } from "@/hooks/useCredits";
import { useSubscription } from "@/hooks/useSubscription";
import { motion, AnimatePresence } from "framer-motion";
import { Slider } from "@/components/ui/slider";
import * as pdfjsLib from "pdfjs-dist";
import pdfWorkerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import mammoth from "mammoth";
import VoiceNotes from "@/components/study/VoiceNotes";
import { Link } from "react-router-dom";
import { isSafeYouTubeUrl } from "@/lib/security";
import {
  generateQuizOrFlashcards,
  generateQuizOrFlashcardsFromImages,
  generateSummary,
  generateMindmap,
  generateMicroTasks,
  saveSummaryResult,
  saveMindmapResult,
  saveMicroTaskResult,
  fetchYoutubeTranscript,
  getAuthToken,
} from "@/lib/backendApi";
import {
  ACTIVE_GENERATION_JOB_STATUSES,
  GENERATION_JOB_STATUS,
  isActiveGenerationJobStatus,
  normalizeGenerationJobStatus,
} from "@/lib/generationJobState";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerSrc;


// ═══ § 2 COSTANTI & TIPI ═══════════════════════════════════════════════════════
const SUPPORTED_EXTENSIONS = [".txt", ".md", ".csv", ".pdf", ".docx", ".doc", ".json"];
const ALLOWED_IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const ALLOWED_IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);

const MAX_IMAGES = 5;
const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB

interface UploadedImage {
  file: File;
  preview: string;
  base64: string;
}

interface PdfTextItem {
  str?: string;
  transform?: number[];
  width?: number;
}

const getErrorMessage = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback;

interface GenerationProgressJob {
  id: string;
  status: string;
  content_type: string;
  title: string | null;
  result_id: string | null;
  error: string | null;
  progress_message: string | null;
  progress_pct: number | null;
}

interface ActiveGenerationProgress {
  jobId: string;
  status: string;
  contentType: string;
  title: string;
  resultId: string | null;
  error: string | null;
  message: string;
  progressPct: number;
}

const GENERATION_TYPE_LABELS: Record<string, string> = {
  quiz: "Quiz",
  flashcards: "Flashcard",
};

const clampProgress = (value: number | null | undefined) =>
  Math.max(0, Math.min(100, typeof value === "number" && Number.isFinite(value) ? value : 0));

const buildGenerationProgress = (job: GenerationProgressJob): ActiveGenerationProgress => {
  const status = normalizeGenerationJobStatus(job.status) ?? job.status;
  const typeLabel = GENERATION_TYPE_LABELS[job.content_type] || job.content_type || "contenuto";
  const fallbackMessage =
    status === GENERATION_JOB_STATUS.PENDING
      ? "Preparazione generazione..."
      : status === GENERATION_JOB_STATUS.COMPLETED
        ? `${typeLabel} pronto. Apertura in corso...`
        : status === GENERATION_JOB_STATUS.ERROR
          ? job.error || "Generazione fallita."
          : `Generazione ${typeLabel.toLowerCase()} in corso...`;

  return {
    jobId: job.id,
    status,
    contentType: job.content_type,
    title: job.title || "Studio",
    resultId: job.result_id,
    error: job.error,
    message: job.progress_message || fallbackMessage,
    progressPct: status === GENERATION_JOB_STATUS.COMPLETED ? 100 : clampProgress(job.progress_pct),
  };
};


// ═══ § 3 FILE HELPERS ══════════════════════════════════════════════════════════
async function extractTextFromPdf(arrayBuffer: ArrayBuffer): Promise<string> {
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const pageTexts: string[] = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page    = await pdf.getPage(i);
    const content = await page.getTextContent();

    // Ricostruisce il testo rispettando la struttura originale:
    // - raggruppa item per riga (stesso Y approssimativo)
    // - aggiunge spazio solo se c'è un gap significativo tra item sulla stessa riga
    // - aggiunge a capo tra righe diverse
    const items = content.items as PdfTextItem[];
    if (items.length === 0) continue;

    let pageText = "";
    let lastY    = items[0]?.transform?.[5] ?? 0;
    let lastX    = 0;
    let lineBuffer = "";

    for (const item of items) {
      const str  = item.str || "";
      const x    = item.transform?.[4] ?? 0;
      const y    = item.transform?.[5] ?? 0;
      const yDiff = Math.abs(y - lastY);

      if (yDiff > 3) {
        // Nuova riga
        if (lineBuffer.trim()) pageText += lineBuffer.trim() + "\n";
        lineBuffer = str;
        lastY = y;
        lastX = x + (item.width || 0);
      } else {
        // Stessa riga — aggiungi spazio se c'è un gap orizzontale
        const gap = x - lastX;
        if (gap > 4 && lineBuffer && !lineBuffer.endsWith(" ")) lineBuffer += " ";
        lineBuffer += str;
        lastX = x + (item.width || 0);
      }
    }
    if (lineBuffer.trim()) pageText += lineBuffer.trim();
    if (pageText.trim()) pageTexts.push(pageText);
  }

  return pageTexts.join("\n\n");
}

async function extractTextFromDocx(arrayBuffer: ArrayBuffer): Promise<string> {
  const result = await mammoth.extractRawText({ arrayBuffer });
  return result.value;
}

function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Errore lettura immagine"));
    reader.readAsDataURL(file);
  });
}


// ═══ § 4 PROPS ═════════════════════════════════════════════════════════════════
interface DocumentUploadProps {
  onQuizGenerated: (quizId: string) => void;
  onFlashcardsGenerated: (deckId: string) => void;
  hasFullAccess: boolean;
  hasGamified: boolean;
  onTextContentSet?: (text: string) => void;
  onDecompose?: () => void;
  onMindMap?: (nodes: unknown[], edges: unknown[]) => void;
  onInsufficientCredits?: (action?: string, creditsNeeded?: number) => void;
  onSummaryGenerated?: (content: string, format: string, title: string) => void;
}


// ═══ § 5 COMPONENT STATE ═══════════════════════════════════════════════════════
const DocumentUpload = ({ onQuizGenerated, onFlashcardsGenerated, hasFullAccess, hasGamified, onTextContentSet, onDecompose, onMindMap, onInsufficientCredits, onSummaryGenerated }: DocumentUploadProps) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const { totalCredits, spendCredits, refreshCredits } = useCredits();
  const { canUseFlashcards, canUseMindMaps, canUseSummaries, canUseYouTubeImport } = useSubscription();
  const fileRef = useRef<HTMLInputElement>(null);
  const imageRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [textContent, setTextContent] = useState("");
  const [generating, setGenerating] = useState<string | null>(null);
  const [inputMode, setInputMode] = useState<"file" | "text" | "images" | "youtube">("file");
  const [extracting, setExtracting] = useState(false);
  const [distractionLevel, setDistractionLevel] = useState(3);
  const [images, setImages] = useState<UploadedImage[]>([]);
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [youtubeTitle, setYoutubeTitle] = useState<string | null>(null);
  const [loadingYoutube, setLoadingYoutube] = useState(false);
  const [youtubeElapsed, setYoutubeElapsed] = useState(0);
  const [activeGeneration, setActiveGeneration] = useState<ActiveGenerationProgress | null>(null);
  const youtubeTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const completedGenerationIdsRef = useRef<Set<string>>(new Set());

  // Cleanup blob URLs on unmount to prevent memory leaks
  useEffect(() => {
    return () => {
      images.forEach(img => {
        if (img.preview) URL.revokeObjectURL(img.preview);
      });
    };
  }, [images]);

  // Timer for YouTube import elapsed time
  useEffect(() => {
    if (loadingYoutube) {
      setYoutubeElapsed(0);
      youtubeTimerRef.current = setInterval(() => setYoutubeElapsed(prev => prev + 1), 1000);
    } else {
      if (youtubeTimerRef.current) clearInterval(youtubeTimerRef.current);
    }
    return () => { if (youtubeTimerRef.current) clearInterval(youtubeTimerRef.current); };
  }, [loadingYoutube]);

  const formatTime = useCallback((s: number) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`, []);

  useEffect(() => {
    if (!user || !activeGeneration?.jobId) return;

    let isMounted = true;
    const jobId = activeGeneration.jobId;

    const applyJob = (job: GenerationProgressJob) => {
      if (!isMounted) return;

      const nextProgress = buildGenerationProgress(job);
      setActiveGeneration(nextProgress);

      if (
        nextProgress.status === GENERATION_JOB_STATUS.COMPLETED &&
        nextProgress.resultId &&
        !completedGenerationIdsRef.current.has(nextProgress.jobId)
      ) {
        completedGenerationIdsRef.current.add(nextProgress.jobId);
        setGenerating(null);
        toast({ title: "Generazione completata", description: "I contenuti sono pronti. Apertura in corso..." });
        if (nextProgress.contentType === "flashcards") onFlashcardsGenerated(nextProgress.resultId);
        else onQuizGenerated(nextProgress.resultId);
        window.setTimeout(() => {
          if (isMounted) setActiveGeneration(null);
        }, 1500);
        return;
      }

      if (
        nextProgress.status === GENERATION_JOB_STATUS.ERROR ||
        nextProgress.status === GENERATION_JOB_STATUS.CANCELLED
      ) {
        setGenerating(null);
      }
    };

    const fetchJob = async () => {
      const { data, error } = await supabase
        .from("generation_jobs")
        .select("id,status,content_type,title,result_id,error,progress_message,progress_pct")
        .eq("id", jobId)
        .eq("user_id", user.id)
        .single();

      if (!isMounted || error || !data) return;
      applyJob(data as GenerationProgressJob);
    };

    void fetchJob();

    const channel = supabase
      .channel(`upload_generation_progress:${jobId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "generation_jobs", filter: `id=eq.${jobId}` },
        (payload) => {
          if (payload.new) applyJob(payload.new as GenerationProgressJob);
        },
      )
      .subscribe();

    const pollId = window.setInterval(fetchJob, 2500);

    return () => {
      isMounted = false;
      window.clearInterval(pollId);
      supabase.removeChannel(channel);
    };
  }, [activeGeneration?.jobId, onFlashcardsGenerated, onQuizGenerated, toast, user]);


  // ─── § 6 HANDLER: FILE ──────────────────────────────────────────────────────
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 50 * 1024 * 1024) {
      toast({ title: "File troppo grande", description: "Massimo 50MB.", variant: "destructive" });
      return;
    }
    const ext = f.name.toLowerCase().substring(f.name.lastIndexOf("."));
    if (!SUPPORTED_EXTENSIONS.includes(ext) && !f.type.startsWith("text/")) {
      toast({ title: "Formato non supportato", description: `Formati: ${SUPPORTED_EXTENSIONS.join(", ")}`, variant: "destructive" });
      return;
    }
    setFile(f);
    setExtracting(true);
    try {
      let text = "";
      if (ext === ".pdf") text = await extractTextFromPdf(await f.arrayBuffer());
      else if (ext === ".docx" || ext === ".doc") text = await extractTextFromDocx(await f.arrayBuffer());
      else text = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (ev) => resolve(ev.target?.result as string || "");
        reader.onerror = () => reject(new Error("Errore lettura file"));
        reader.readAsText(f);
      });
      if (text.trim().length < 50) {
        toast({ title: "Contenuto insufficiente", description: "Il documento sembra vuoto o troppo corto.", variant: "destructive" });
        setFile(null); return;
      }
      setTextContent(text);
      toast({ title: "Documento caricato ✅", description: `${text.length.toLocaleString()} caratteri estratti da ${f.name}` });
    } catch (err) {
      console.error("File extraction error:", err);
      toast({ title: "Errore estrazione testo", description: "Prova a incollare il testo manualmente.", variant: "destructive" });
      setFile(null);
    } finally {
      setExtracting(false);
    }
  };


  // ─── § 7 HANDLER: IMMAGINI ─────────────────────────────────────────────────
  const handleImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    const remaining = MAX_IMAGES - images.length;
    if (remaining <= 0) {
      toast({ title: "Limite raggiunto", description: `Massimo ${MAX_IMAGES} immagini.`, variant: "destructive" });
      return;
    }

    const newFiles = Array.from(files).slice(0, remaining);
    const newImages: UploadedImage[] = [];

    for (const f of newFiles) {
      const ext = f.name.toLowerCase().substring(f.name.lastIndexOf("."));
      const mime = f.type.toLowerCase();
      const isAllowedImage = ALLOWED_IMAGE_MIME_TYPES.has(mime) || (!mime && ALLOWED_IMAGE_EXTENSIONS.has(ext));
      if (!isAllowedImage) {
        toast({ title: "Formato non valido", description: `${f.name}: formato immagine non consentito (JPG/PNG/WEBP).`, variant: "destructive" });
        continue;
      }
      if (f.size > MAX_IMAGE_SIZE) {
        toast({ title: "Immagine troppo grande", description: `${f.name}: massimo 5MB per immagine.`, variant: "destructive" });
        continue;
      }
      try {
        const base64 = await readFileAsDataURL(f);
        newImages.push({ file: f, preview: URL.createObjectURL(f), base64 });
      } catch {
        toast({ title: "Errore", description: `Impossibile leggere ${f.name}.`, variant: "destructive" });
      }
    }

    if (newImages.length > 0) {
      setImages(prev => [...prev, ...newImages]);
      toast({ title: "Foto aggiunte 📸", description: `${newImages.length} immagini caricate.` });
    }

    // Reset input
    if (imageRef.current) imageRef.current.value = "";
  };

  const removeImage = (index: number) => {
    setImages(prev => {
      const removed = prev[index];
      if (removed) URL.revokeObjectURL(removed.preview);
      return prev.filter((_, i) => i !== index);
    });
  };


  // ─── § 8 HANDLER: YOUTUBE ──────────────────────────────────────────────────
  const handleYoutubeImport = async () => {
    if (!youtubeUrl.trim() || !user) return;
    if (!isSafeYouTubeUrl(youtubeUrl)) {
      toast({
        title: "URL YouTube non valido",
        description: "Incolla un link YouTube valido (youtube.com o youtu.be).",
        variant: "destructive",
      });
      return;
    }
    if (!canUseYouTubeImport) {
      toast({ title: "Funzione Pro", description: "L'import da YouTube è disponibile con i piani Focus Pro e Hyperfocus Master.", variant: "destructive" });
      return;
    }
    if (totalCredits < CREDIT_COSTS.youtube) {
      onInsufficientCredits?.("youtube");
      return;
    }
    const spent = await spendCredits("youtube");
    if (!spent) {
      onInsufficientCredits?.("youtube");
      return;
    }

    setLoadingYoutube(true);
    try {
      const token = await getAuthToken();
      const data = await fetchYoutubeTranscript(youtubeUrl.trim(), token);

      const { transcript, title, method, notice } = data;

      if (!transcript || transcript.length < 30) {
        throw new Error("Trascrizione troppo corta o vuota.");
      }

      setTextContent(transcript);
      setYoutubeTitle(title || "Video YouTube");
      setInputMode("text");

      const isAiGenerated = method === "ai_generated" || method === "video_analysis";
      toast({
        title: method === "video_analysis" ? "🎥 Video analizzato dall'AI!" : isAiGenerated ? "🤖 Contenuto AI generato!" : "🎬 Video trascritto!",
        description: method === "video_analysis"
          ? `"${title}" — ${transcript.length.toLocaleString()} caratteri estratti dall'analisi video. Spesi ${CREDIT_COSTS.youtube} cr. Ora genera quiz, flashcard o riassunti!`
          : isAiGenerated
          ? `"${title}" — ${transcript.length.toLocaleString()} caratteri generati dall'AI. Spesi ${CREDIT_COSTS.youtube} cr.`
          : `"${title}" — ${transcript.length.toLocaleString()} caratteri estratti. Spesi ${CREDIT_COSTS.youtube} cr. Ora genera quiz, flashcard o riassunti!`,
      });
    } catch (err: unknown) {
      console.error("YouTube import error:", err);
      toast({
        title: "Errore import YouTube",
        description: getErrorMessage(err, "Impossibile trascrivere il video."),
        variant: "destructive",
      });
      await refreshCredits();
    } finally {
      setLoadingYoutube(false);
    }
  };

  const hasContent = file || textContent.trim() || images.length > 0;
  const hasImages  = images.length > 0;

  // ──────────────────────────────────────────────────────────────────────────
  // GENERA QUIZ / FLASHCARD
  // ──────────────────────────────────────────────────────────────────────────

  // ─── § 9 HANDLER: GENERA (quiz / flashcard) ───────────────────────────────
  const generate = async (type: "quiz" | "flashcards" | "quiz_gamified") => {
    const normalizedText = textContent.trim();
    if ((!hasImages && !normalizedText) || !user) {
      toast({ title: "Nessun contenuto", description: "Carica un documento, incolla del testo o aggiungi delle foto.", variant: "destructive" });
      return;
    }

    const creditAction = "quiz" as const;
    if (totalCredits < CREDIT_COSTS[creditAction]) { onInsufficientCredits?.(type === "flashcards" ? "flashcards" : "quiz"); return; }
    const spent = await spendCredits(creditAction);
    if (!spent) { onInsufficientCredits?.(type === "flashcards" ? "flashcards" : "quiz"); return; }

    setGenerating(type);
    let createdJobId: string | null = null;

    try {
      const docTitle = file?.name || (hasImages ? "Foto appunti" : "Studio");
      const isFlash  = type === "flashcards";

      // Upload file opzionale per storico
      let documentId: string | undefined;
      if (file) {
        const filePath = `${user.id}/${Date.now()}_${file.name}`;
        const { error: uploadErr } = await supabase.storage.from("documents").upload(filePath, file);
        if (!uploadErr) {
          const { data: doc } = await supabase.from("documents")
            .insert({ user_id: user.id, title: file.name, file_type: file.type, file_url: filePath })
            .select("id").single();
          documentId = doc?.id;
        }
      }

      // Chiudi eventuali job attivi precedenti dello stesso tipo prima di crearne uno nuovo.
      // Evita spinner multipli sovrapposti se si riprova.
      await supabase
        .from("generation_jobs")
        .update({
          status: GENERATION_JOB_STATUS.CANCELLED,
          error: "Sostituito da nuova generazione",
          completed_at: new Date().toISOString(),
        })
        .eq("user_id", user.id)
        .eq("content_type", isFlash ? "flashcards" : "quiz")
        .in("status", [...ACTIVE_GENERATION_JOB_STATUSES]);

      // Crea job per tracking
      // Fix 6: se l'insert fallisce, lanciamo un errore esplicito invece di usare
      // crypto.randomUUID() come fallback — un UUID non esistente nel DB causa
      // Realtime subscription silente e spinner infinito.
      const { data: job, error: jobError } = await supabase
        .from("generation_jobs")
        .insert({
          user_id: user.id,
          content_type: isFlash ? "flashcards" : "quiz",
          title: docTitle,
          document_id: documentId || null,
          status: GENERATION_JOB_STATUS.PENDING,
          error: null,
          completed_at: null,
        })
        .select("id").single();
      if (jobError || !job?.id) throw new Error("Impossibile avviare il job di generazione. Riprova.");
      const jobId = job.id;
      createdJobId = jobId;
      completedGenerationIdsRef.current.delete(jobId);
      setActiveGeneration({
        jobId,
        status: GENERATION_JOB_STATUS.PENDING,
        contentType: isFlash ? "flashcards" : "quiz",
        title: docTitle,
        resultId: null,
        error: null,
        message: "Preparazione generazione...",
        progressPct: 0,
      });

      await supabase
        .from("generation_jobs")
        .update({ status: GENERATION_JOB_STATUS.PROCESSING, error: null })
        .eq("id", jobId)
        .in("status", [GENERATION_JOB_STATUS.PENDING]);

      setActiveGeneration((prev) =>
        prev?.jobId === jobId
          ? { ...prev, status: GENERATION_JOB_STATUS.PROCESSING, message: "Generazione avviata...", progressPct: 2 }
          : prev,
      );

      toast({ title: "Generazione avviata", description: `Spesi ${CREDIT_COSTS[creditAction]} cr. Puoi seguire il progresso qui sotto.` });

      // Il livello distrazione viene passato come parametro separato, non nel testo.
      // In precedenza veniva preposto come "[LIVELLO_DISTRAZIONE:X]\n" al testo —
      // causava domande sull'artefatto stesso se la strip nel backend non era deployata.
      let result;

      if (hasImages && !textContent.trim()) {
        // Immagini → Edge Function multimodale
        const dataUrls = await Promise.all(
          images.map(img => new Promise<string>((ok, err) => {
            const r = new FileReader();
            r.onload  = () => ok(r.result as string);
            r.onerror = err;
            r.readAsDataURL(img.file);
          }))
        );
        result = await generateQuizOrFlashcardsFromImages(dataUrls, type, jobId, documentId, docTitle);
      } else {
        // Testo (estratto da file o incollato) → Edge Function
        const content = normalizedText;
        if (!content) throw new Error("Nessun testo da elaborare");
        result = await generateQuizOrFlashcards(type, content, jobId, documentId, docTitle);
      }

      // ── Gestisci risultato ────────────────────────────────────────────────
      if (result.mode === "sync_edge") {
        const resultId = result.quizId || result.deckId;
        if (resultId) {
          if (!isFlash) {
            const { count, error: countError } = await supabase
              .from("quiz_questions")
              .select("id", { count: "exact", head: true })
              .eq("quiz_id", resultId);

            if (countError) {
              throw new Error("Il quiz è stato creato ma non è stato possibile verificarne le domande. Riprova.");
            }

            if (!count || count <= 0) {
              if (job.id) {
                await supabase
                  .from("generation_jobs")
                  .update({
                    status: GENERATION_JOB_STATUS.ERROR,
                    error: "Quiz creato senza domande. Riprova.",
                    completed_at: new Date().toISOString(),
                  })
                  .eq("id", job.id);
              }
              await supabase.from("quizzes").delete().eq("id", resultId);
              throw new Error("Il quiz generato era vuoto: l'ho bloccato automaticamente. Riprova.");
            }
          }

          if (job.id) {
            await supabase
              .from("generation_jobs")
              .update({
                status: GENERATION_JOB_STATUS.COMPLETED,
                result_id: resultId,
                completed_at: new Date().toISOString(),
                error: null,
                progress_pct: 100,
                progress_message: "Generazione completata",
              })
              .eq("id", job.id)
              .in("status", [...ACTIVE_GENERATION_JOB_STATUSES]);
          }
          completedGenerationIdsRef.current.add(job.id);
          setActiveGeneration((prev) =>
            prev?.jobId === job.id
              ? {
                  ...prev,
                  status: GENERATION_JOB_STATUS.COMPLETED,
                  resultId,
                  message: "Generazione completata",
                  progressPct: 100,
                }
              : prev,
          );
          if (isFlash) onFlashcardsGenerated(resultId);
          else         onQuizGenerated(resultId);
          toast({ title: "✅ Generazione completata!", description: "I contenuti sono pronti nella tua libreria." });
        } else {
          throw new Error("Nessuna domanda generata. Il documento potrebbe essere troppo corto o in un formato non supportato. Riprova.");
        }
        setGenerating(null);

      } else if (result.mode === "async_edge") {
        // Percorso async: il backend continua a lavorare e questa card resta
        // agganciata al job via Realtime + polling fallback.
        toast({ title: "Generazione in corso", description: "Puoi seguire il progresso in tempo reale nella barra qui sotto." });

        // Safety: dopo 8 minuti ricarica lo stato crediti e lascia la decisione finale
        // al backend/notifier, evitando di forzare errori lato client su job ancora vivi.
        setTimeout(async () => {
          const { data: jc } = await supabase.from("generation_jobs").select("status, result_id").eq("id", result.jobId).single();
          if (!jc || isActiveGenerationJobStatus(jc.status)) {
            await refreshCredits();
          } else if (
            jc.status === GENERATION_JOB_STATUS.COMPLETED &&
            jc.result_id &&
            !completedGenerationIdsRef.current.has(result.jobId)
          ) {
            completedGenerationIdsRef.current.add(result.jobId);
            if (isFlash) onFlashcardsGenerated(jc.result_id);
            else         onQuizGenerated(jc.result_id);
          }
        }, 8 * 60 * 1000);
      }

    } catch (err: unknown) {
      console.error("[generate] error:", err);
      const errorMessage = getErrorMessage(err, "Generazione fallita");
      if (createdJobId) {
        await supabase.from("generation_jobs").update({
          status: GENERATION_JOB_STATUS.ERROR,
          error: errorMessage,
          completed_at: new Date().toISOString(),
        })
          .eq("id", createdJobId)
          .in("status", [...ACTIVE_GENERATION_JOB_STATUSES]);
      }
      toast({ title: "Errore generazione", description: getErrorMessage(err, "Generazione fallita. Riprova."), variant: "destructive" });
      await refreshCredits();
      setGenerating(null);
    }
  };

  // ──────────────────────────────────────────────────────────────────────────
  // SCOMPONI IN MICRO-TASK
  // ──────────────────────────────────────────────────────────────────────────

  // ─── § 10 HANDLER: TOOLS (decompose, mindmap, summary) ────────────────────
  const handleDecompose = async () => {
    if (!textContent.trim() || !user) {
      toast({ title: "Nessun contenuto", description: "Carica un documento o incolla del testo.", variant: "destructive" });
      return;
    }
    if (totalCredits < CREDIT_COSTS.decompose) { onInsufficientCredits?.("decompose"); return; }
    const spent = await spendCredits("decompose");
    if (!spent) { onInsufficientCredits?.("decompose"); return; }

    setGenerating("decompose");
    try {
      const { tasks } = await generateMicroTasks(textContent);
      const result = await saveMicroTaskResult(user.id, tasks, file?.name || "Studio");
      toast({ title: "📋 Piano creato!", description: `${result.totalTasks} micro-task generati. Spesi ${CREDIT_COSTS.decompose} cr.` });
      onDecompose?.();
    } catch (err: unknown) {
      console.error("[decompose] error:", err);
      toast({
        title: "Errore",
        description: getErrorMessage(err, "Scomposizione fallita."),
        variant: "destructive",
      });
      await refreshCredits();
    } finally {
      setGenerating(null);
    }
  };

  // ──────────────────────────────────────────────────────────────────────────
  // MAPPA CONCETTUALE
  // ──────────────────────────────────────────────────────────────────────────
  const handleMindMap = async () => {
    if (!textContent.trim() || !user) {
      toast({ title: "Nessun contenuto", description: "Carica un documento o incolla del testo.", variant: "destructive" });
      return;
    }
    if (totalCredits < CREDIT_COSTS.mindmap) { onInsufficientCredits?.("mindmap"); return; }
    const spent = await spendCredits("mindmap");
    if (!spent) { onInsufficientCredits?.("mindmap"); return; }

    setGenerating("mindmap");
    try {
      const { nodes, edges } = await generateMindmap(textContent);
      const title = file?.name || textContent.trim().substring(0, 60);
      await saveMindmapResult(user.id, nodes, edges, title);
      toast({ title: "🧠 Mappa creata e salvata!", description: `${nodes.length} concetti estratti. Spesi ${CREDIT_COSTS.mindmap} cr.` });
      onMindMap?.(nodes, edges);
    } catch (err: unknown) {
      console.error("[mindmap] error:", err);
      toast({
        title: "Errore",
        description: getErrorMessage(err, "Generazione mappa fallita."),
        variant: "destructive",
      });
      await refreshCredits();
    } finally {
      setGenerating(null);
    }
  };

  // ──────────────────────────────────────────────────────────────────────────
  // RIASSUNTO / SCHEMA / APPUNTI SMART
  // ──────────────────────────────────────────────────────────────────────────
  const handleSummary = async (format: "summary" | "outline" | "smart_notes") => {
    if ((!hasImages && !textContent.trim()) || !user) {
      toast({ title: "Nessun contenuto", description: "Carica un documento, incolla del testo o aggiungi delle foto.", variant: "destructive" });
      return;
    }
    if (!canUseSummaries) {
      toast({ title: "Funzione Hyperfocus Master", description: "Riassunti, schemi e appunti smart richiedono il piano Hyperfocus Master.", variant: "destructive" });
      return;
    }
    if (totalCredits < CREDIT_COSTS.summary) { onInsufficientCredits?.("summary"); return; }
    const spent = await spendCredits("summary");
    if (!spent) { onInsufficientCredits?.("summary"); return; }

    setGenerating(format);
    const formatLabels = { summary: "Riassunto", outline: "Schema", smart_notes: "Appunti Smart" };
    try {
      const docTitle = file?.name || (hasImages ? "Foto appunti" : "Studio");
      toast({ title: `🚀 ${formatLabels[format]} in generazione`, description: `Spesi ${CREDIT_COSTS.summary} cr.` });

      let markdown: string;

      if (hasImages && !textContent.trim()) {
        // Immagini → Edge Function
        const dataUrls = await Promise.all(
          images.map(img => new Promise<string>((ok, err) => {
            const r = new FileReader();
            r.onload  = () => ok(r.result as string);
            r.onerror = err;
            r.readAsDataURL(img.file);
          }))
        );
        markdown = await generateSummary(format, "", dataUrls);
      } else {
        markdown = await generateSummary(format, textContent.trim() || "");
      }

      await saveSummaryResult(user.id, markdown, format, docTitle);

      // Notifica il parent component
      onSummaryGenerated?.(markdown, format, docTitle);

      toast({ title: `✅ ${formatLabels[format]} completato!`, description: "Disponibile nella tua libreria." });
    } catch (err: unknown) {
      console.error("[summary] error:", err);
      toast({
        title: "Errore",
        description: getErrorMessage(err, "Generazione fallita."),
        variant: "destructive",
      });
      await refreshCredits();
    } finally {
      setGenerating(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Credit indicator */}
      <div className="flex items-center justify-between bg-secondary/50 rounded-lg px-4 py-2">
        <span className="text-xs text-muted-foreground">NeuroCredits disponibili</span>
        <span className={`text-sm font-bold flex items-center gap-1 ${totalCredits < 10 ? "text-destructive" : "text-primary"}`}>
          <Zap className="h-3 w-3" /> {totalCredits}
        </span>
      </div>

      <div className="flex gap-1 bg-secondary rounded-lg p-1">
        <button onClick={() => setInputMode("file")}
          className={`flex-1 text-xs sm:text-sm font-medium py-2 rounded-md transition-all ${inputMode === "file" ? "bg-primary text-primary-foreground shadow-soft" : "text-muted-foreground hover:text-foreground"}`}>
          📄 File
        </button>
        <button onClick={() => setInputMode("text")}
          className={`flex-1 text-xs sm:text-sm font-medium py-2 rounded-md transition-all ${inputMode === "text" ? "bg-primary text-primary-foreground shadow-soft" : "text-muted-foreground hover:text-foreground"}`}>
          ✏️ Testo
        </button>
        <button onClick={() => setInputMode("images")}
          className={`flex-1 text-xs sm:text-sm font-medium py-2 rounded-md transition-all ${inputMode === "images" ? "bg-primary text-primary-foreground shadow-soft" : "text-muted-foreground hover:text-foreground"}`}>
          📸 Foto
        </button>
        <button onClick={() => setInputMode("youtube")}
          className={`flex-1 text-xs sm:text-sm font-medium py-2 rounded-md transition-all relative ${inputMode === "youtube" ? "bg-primary text-primary-foreground shadow-soft" : "text-muted-foreground hover:text-foreground"} ${!canUseYouTubeImport ? "opacity-60" : ""}`}>
          🎬 YouTube
          {!canUseYouTubeImport && <Lock className="h-2.5 w-2.5 absolute top-1 right-1" />}
        </button>
      </div>

      <AnimatePresence mode="wait">
        {inputMode === "file" ? (
          <motion.div key="file" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
            <input ref={fileRef} type="file" accept=".txt,.md,.pdf,.doc,.docx,.csv,.json" onChange={handleFileSelect} className="hidden" />
            <div onClick={() => !extracting && fileRef.current?.click()}
              className={`border-2 border-dashed border-border rounded-xl p-8 text-center cursor-pointer hover:border-primary/50 hover:bg-secondary/30 transition-all ${extracting ? "pointer-events-none opacity-70" : ""}`}>
              {extracting ? (
                <div className="flex flex-col items-center gap-3">
                  <Loader2 className="h-10 w-10 text-primary animate-spin" />
                  <p className="text-sm font-medium text-card-foreground">Estrazione testo in corso...</p>
                </div>
              ) : file ? (
                <div className="flex items-center justify-center gap-3">
                  <FileText className="h-8 w-8 text-primary" />
                  <div className="text-left">
                    <p className="font-medium text-card-foreground">{file.name}</p>
                    <p className="text-xs text-muted-foreground">{(file.size / 1024).toFixed(1)} KB · {textContent.length.toLocaleString()} caratteri</p>
                  </div>
                </div>
              ) : (
                <>
                  <Upload className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
                  <p className="text-sm font-medium text-card-foreground">Trascina un documento qui</p>
                  <p className="text-xs text-muted-foreground mt-1">PDF, DOCX, TXT, MD, CSV — max 50MB</p>
                </>
              )}
            </div>
          </motion.div>
        ) : inputMode === "text" ? (
          <motion.div key="text" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
            <textarea value={textContent} onChange={(e) => setTextContent(e.target.value)}
              placeholder="Incolla qui il testo dei tuoi appunti, capitoli o lezioni..."
              className="w-full h-48 rounded-xl border border-border bg-card p-4 text-sm text-card-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:ring-2 focus:ring-ring" />
            <p className="text-xs text-muted-foreground mt-1">{textContent.length.toLocaleString()} caratteri</p>
          </motion.div>
        ) : inputMode === "images" ? (
          <motion.div key="images" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
            <input ref={imageRef} type="file" accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" multiple onChange={handleImageSelect} className="hidden" />

            {images.length > 0 && (
              <div className="grid grid-cols-3 sm:grid-cols-5 gap-3 mb-4">
                {images.map((img, idx) => (
                  <div key={idx} className="relative group aspect-square rounded-lg overflow-hidden border border-border bg-secondary/30">
                    <img src={img.preview} alt={`Foto ${idx + 1}`} className="w-full h-full object-cover" />
                    <button
                      onClick={() => removeImage(idx)}
                      className="absolute top-1 right-1 bg-destructive text-destructive-foreground rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                    <span className="absolute bottom-1 left-1 text-[10px] bg-background/80 text-foreground px-1 rounded">
                      {(img.file.size / 1024).toFixed(0)}KB
                    </span>
                  </div>
                ))}
              </div>
            )}

            <div
              onClick={() => images.length < MAX_IMAGES && imageRef.current?.click()}
              className={`border-2 border-dashed border-border rounded-xl p-8 text-center transition-all ${images.length < MAX_IMAGES ? "cursor-pointer hover:border-primary/50 hover:bg-secondary/30" : "opacity-50 cursor-not-allowed"}`}
            >
              <Camera className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-sm font-medium text-card-foreground">
                {images.length === 0 ? "Carica foto di appunti, slide o lavagna" : `${images.length}/${MAX_IMAGES} foto caricate`}
              </p>
              <p className="text-xs text-muted-foreground mt-1">JPG, PNG, WEBP — max 5MB ciascuna, fino a {MAX_IMAGES} foto</p>
            </div>
          </motion.div>
        ) : (
          <motion.div key="youtube" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
            {!canUseYouTubeImport ? (
              <div className="border-2 border-dashed border-border rounded-xl p-8 text-center">
                <Lock className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
                <p className="text-sm font-medium text-card-foreground">Funzione disponibile con Focus Pro o Hyperfocus Master</p>
                <p className="text-xs text-muted-foreground mt-1">Trascrivi video YouTube e genera quiz, flashcard e riassunti automaticamente.</p>
                <Button variant="outline" size="sm" className="mt-4" asChild>
                  <Link to="/pricing">Scopri i piani</Link>
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex gap-2">
                  <Input
                    value={youtubeUrl}
                    onChange={(e) => setYoutubeUrl(e.target.value)}
                    placeholder="https://youtube.com/watch?v=..."
                    className="flex-1"
                    disabled={loadingYoutube}
                  />
                  <Button onClick={handleYoutubeImport} disabled={loadingYoutube || !youtubeUrl.trim()}>
                    {loadingYoutube ? <Loader2 className="h-4 w-4 animate-spin" /> : <Youtube className="h-4 w-4" />}
                    <span className="ml-2 hidden sm:inline">Trascrivi</span>
                  </Button>
                </div>
                {youtubeTitle && (
                  <div className="flex items-center gap-2 bg-secondary/50 rounded-lg px-3 py-2">
                    <Youtube className="h-4 w-4 text-destructive shrink-0" />
                    <span className="text-sm text-card-foreground truncate">{youtubeTitle}</span>
                    <span className="text-xs text-muted-foreground shrink-0">{textContent.length.toLocaleString()} car.</span>
                  </div>
                )}
                {loadingYoutube && (
                  <div className="bg-secondary/30 rounded-xl p-4 space-y-3">
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span className="flex items-center gap-1.5">
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                        {youtubeElapsed < 8 ? "Estrazione sottotitoli..." : youtubeElapsed < 20 ? "Analisi video con AI..." : "Generazione contenuti..."}
                      </span>
                      <span className="font-mono">{formatTime(youtubeElapsed)}</span>
                    </div>
                    <div className="w-full bg-secondary rounded-full h-1.5 overflow-hidden">
                      <motion.div
                        className="h-full bg-primary rounded-full"
                        initial={{ width: "0%" }}
                        animate={{ width: youtubeElapsed < 10 ? `${youtubeElapsed * 5}%` : youtubeElapsed < 30 ? `${50 + (youtubeElapsed - 10) * 1.5}%` : "85%" }}
                        transition={{ duration: 0.5 }}
                      />
                    </div>
                    <p className="text-[10px] text-muted-foreground text-center">
                      ⏱ Tempo stimato: ~30-60 sec (sottotitoli) · ~1-2 min (analisi video AI)
                    </p>
                  </div>
                )}
                {!loadingYoutube && (
                <div className="bg-secondary/30 rounded-xl p-4 text-center">
                  <Youtube className="h-10 w-10 text-muted-foreground mx-auto mb-2 opacity-50" />
                  <p className="text-sm text-card-foreground font-medium">Incolla un link YouTube</p>
                  <p className="text-xs text-muted-foreground mt-1">Il sistema estrarrà i sottotitoli o analizzerà il video con l'AI.</p>
                  <p className="text-[10px] text-accent font-medium mt-2">⚡ Costo: {CREDIT_COSTS.youtube} NeuroCredits</p>
                </div>
                )}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {hasContent && !extracting && (
        <>
          {/* Generation buttons with credit costs */}
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Button onClick={() => generate("quiz")} disabled={!!generating} className="h-auto py-4 flex flex-col items-center gap-2">
              {generating === "quiz" ? <Loader2 className="h-5 w-5 animate-spin" /> : <Sparkles className="h-5 w-5" />}
              <span className="text-sm font-medium">Genera Quiz</span>
              <span className="text-[10px] opacity-70">{CREDIT_COSTS.quiz} cr · Domande per argomento</span>
            </Button>
            <Button onClick={() => generate("flashcards")} disabled={!!generating} variant="outline" className="h-auto py-4 flex flex-col items-center gap-2">
              {generating === "flashcards" ? <Loader2 className="h-5 w-5 animate-spin" /> : <BookOpen className="h-5 w-5" />}
              <span className="text-sm font-medium">Crea Flashcard</span>
              <span className="text-[10px] opacity-70">{CREDIT_COSTS.quiz} cr · Studio attivo</span>
            </Button>
            <Button onClick={() => generate("quiz_gamified")} disabled={!!generating || !hasGamified} variant="outline"
              className={`h-auto py-4 flex flex-col items-center gap-2 ${hasGamified ? "border-accent text-accent hover:bg-accent hover:text-accent-foreground" : "opacity-50"}`}>
              {generating === "quiz_gamified" ? <Loader2 className="h-5 w-5 animate-spin" /> : <Zap className="h-5 w-5" />}
              <span className="text-sm font-medium">Quiz ADHD 🎮</span>
              <span className="text-[10px] opacity-70">{hasGamified ? `${CREDIT_COSTS.quiz} cr · Gamificato` : "Piano ADHD+"}</span>
            </Button>
          </motion.div>

          {activeGeneration && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="rounded-xl border border-primary/25 bg-primary/5 p-4 shadow-soft"
            >
              <div className="flex items-start gap-3">
                {activeGeneration.status === GENERATION_JOB_STATUS.ERROR ? (
                  <X className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
                ) : (
                  <Loader2 className="mt-0.5 h-5 w-5 shrink-0 animate-spin text-primary" />
                )}
                <div className="min-w-0 flex-1 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-card-foreground">
                        {GENERATION_TYPE_LABELS[activeGeneration.contentType] || "Generazione"} in lavorazione
                      </p>
                      <p className="truncate text-xs text-muted-foreground">{activeGeneration.title}</p>
                    </div>
                    <span className="shrink-0 rounded-full bg-background px-2 py-1 text-xs font-semibold text-primary">
                      {activeGeneration.progressPct}%
                    </span>
                  </div>
                  <Progress value={activeGeneration.progressPct} className="h-2" />
                  <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-xs text-card-foreground">{activeGeneration.message}</p>
                    <p className="text-[11px] text-muted-foreground">
                      Aggiornamento live: puoi restare qui, apriremo il risultato appena pronto.
                    </p>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {/* ADHD Tools row - only show when text content available */}
          {textContent.trim() && (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Button onClick={handleDecompose} disabled={!!generating} variant="outline" className="h-auto py-3 flex items-center gap-3">
                {generating === "decompose" ? <Loader2 className="h-5 w-5 animate-spin" /> : <Brain className="h-5 w-5 text-primary" />}
                <div className="text-left">
                  <span className="text-sm font-medium block">Scomponi in micro-task</span>
                  <span className="text-[10px] text-muted-foreground">{CREDIT_COSTS.decompose} cr · Piano ADHD-friendly</span>
                </div>
              </Button>
              <Button onClick={() => canUseMindMaps ? handleMindMap() : toast({ title: "Funzione Pro", description: "Le mappe concettuali sono disponibili con un piano a pagamento." })} disabled={!!generating} variant="outline" className={`h-auto py-3 flex items-center gap-3 relative ${!canUseMindMaps ? "opacity-60" : ""}`}>
                {!canUseMindMaps && <Lock className="h-3 w-3 absolute top-2 right-2 text-muted-foreground" />}
                {generating === "mindmap" ? <Loader2 className="h-5 w-5 animate-spin" /> : <Map className="h-5 w-5 text-primary" />}
                <div className="text-left">
                  <span className="text-sm font-medium block">Mappa concettuale</span>
                  <span className="text-[10px] text-muted-foreground">{canUseMindMaps ? `${CREDIT_COSTS.mindmap} cr · Visualizza concetti` : "Piano Pro"}</span>
                </div>
              </Button>
            </motion.div>
          )}

          {/* Summary/Outline/Smart Notes - Hyperfocus Master only */}
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 }} className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground flex items-center gap-1">
              ✨ Strumenti Hyperfocus Master
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Button
                onClick={() => handleSummary("summary")}
                disabled={!!generating}
                variant="outline"
                className={`h-auto py-3 flex flex-col items-center gap-1.5 relative ${!canUseSummaries ? "opacity-50" : "border-accent/30"}`}
              >
                {!canUseSummaries && <Lock className="h-3 w-3 absolute top-2 right-2 text-muted-foreground" />}
                {generating === "summary" ? <Loader2 className="h-5 w-5 animate-spin" /> : <FileText className="h-5 w-5 text-accent" />}
                <span className="text-sm font-medium">Riassunto</span>
                <span className="text-[10px] text-muted-foreground">{canUseSummaries ? `${CREDIT_COSTS.summary} cr` : "Master"}</span>
              </Button>
              <Button
                onClick={() => handleSummary("outline")}
                disabled={!!generating}
                variant="outline"
                className={`h-auto py-3 flex flex-col items-center gap-1.5 relative ${!canUseSummaries ? "opacity-50" : "border-accent/30"}`}
              >
                {!canUseSummaries && <Lock className="h-3 w-3 absolute top-2 right-2 text-muted-foreground" />}
                {generating === "outline" ? <Loader2 className="h-5 w-5 animate-spin" /> : <ScrollText className="h-5 w-5 text-accent" />}
                <span className="text-sm font-medium">Schema</span>
                <span className="text-[10px] text-muted-foreground">{canUseSummaries ? `${CREDIT_COSTS.summary} cr` : "Master"}</span>
              </Button>
              <Button
                onClick={() => handleSummary("smart_notes")}
                disabled={!!generating}
                variant="outline"
                className={`h-auto py-3 flex flex-col items-center gap-1.5 relative ${!canUseSummaries ? "opacity-50" : "border-accent/30"}`}
              >
                {!canUseSummaries && <Lock className="h-3 w-3 absolute top-2 right-2 text-muted-foreground" />}
                {generating === "smart_notes" ? <Loader2 className="h-5 w-5 animate-spin" /> : <BookMarked className="h-5 w-5 text-accent" />}
                <span className="text-sm font-medium">Appunti Smart</span>
                <span className="text-[10px] text-muted-foreground">{canUseSummaries ? `${CREDIT_COSTS.summary} cr` : "Master"}</span>
              </Button>
            </div>
          </motion.div>

          {/* Distraction slider */}
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1 }}
            className="bg-secondary/50 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium text-card-foreground">🧠 Livello distrazione</span>
              <span className="font-bold text-primary">{distractionLevel}/5</span>
            </div>
            <Slider
              value={[distractionLevel]}
              onValueChange={([v]) => setDistractionLevel(v)}
              min={1}
              max={5}
              step={1}
              className="w-full"
            />
            <div className="flex justify-between text-[10px] text-muted-foreground">
              <span>Concentrato</span>
              <span>Buffer +{Math.round(distractionLevel * 20)}%</span>
              <span>Molto distratto</span>
            </div>
          </motion.div>
        </>
      )}

      {hasGamified && (
        <div className="border-t border-border pt-6">
          <VoiceNotes onNotesGenerated={(text) => { setTextContent(text); setInputMode("text"); }} />
        </div>
      )}
    </div>
  );
};

export default DocumentUpload;
