import { useState, useRef, useEffect, useCallback } from "react";
import { Upload, FileText, Loader2, Sparkles, BookOpen, Zap, Brain, Map, Lock, Camera, X, ScrollText, BookMarked, Youtube } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { useCredits, CREDIT_COSTS } from "@/hooks/useCredits";
import { useSubscription } from "@/hooks/useSubscription";
import { motion, AnimatePresence } from "framer-motion";
import { Slider } from "@/components/ui/slider";
import * as pdfjsLib from "pdfjs-dist";
import mammoth from "mammoth";
import VoiceNotes from "@/components/study/VoiceNotes";
import { Link } from "react-router-dom";
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
} from "@/lib/backendApi";

pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

const SUPPORTED_EXTENSIONS = [".txt", ".md", ".csv", ".pdf", ".docx", ".doc", ".json", ".xml", ".html"];

const MAX_IMAGES = 5;
const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB

interface UploadedImage {
  file: File;
  preview: string;
  base64: string;
}

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
    const items = content.items as any[];
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

interface DocumentUploadProps {
  onQuizGenerated: (quizId: string) => void;
  onFlashcardsGenerated: (deckId: string) => void;
  hasFullAccess: boolean;
  hasGamified: boolean;
  onTextContentSet?: (text: string) => void;
  onDecompose?: () => void;
  onMindMap?: (nodes: any[], edges: any[]) => void;
  onInsufficientCredits?: (action?: string, creditsNeeded?: number) => void;
  onSummaryGenerated?: (content: string, format: string, title: string) => void;
}

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
  const youtubeTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
      if (!f.type.startsWith("image/")) {
        toast({ title: "Formato non valido", description: `${f.name} non è un'immagine.`, variant: "destructive" });
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

  const handleYoutubeImport = async () => {
    if (!youtubeUrl.trim() || !user) return;
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
    } catch (err: any) {
      console.error("YouTube import error:", err);
      toast({ title: "Errore import YouTube", description: err.message || "Impossibile trascrivere il video.", variant: "destructive" });
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
  const generate = async (type: "quiz" | "flashcards" | "quiz_gamified") => {
    if (!hasContent || !user) {
      toast({ title: "Nessun contenuto", description: "Carica un documento, incolla del testo o aggiungi delle foto.", variant: "destructive" });
      return;
    }

    const creditAction = "quiz" as const;
    if (totalCredits < CREDIT_COSTS[creditAction]) { onInsufficientCredits?.(type === "flashcards" ? "flashcards" : "quiz"); return; }
    const spent = await spendCredits(creditAction);
    if (!spent) { onInsufficientCredits?.(type === "flashcards" ? "flashcards" : "quiz"); return; }

    setGenerating(type);

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

      // Crea job per tracking
      const { data: job } = await supabase.from("generation_jobs")
        .insert({ user_id: user.id, content_type: isFlash ? "flashcards" : "quiz", title: docTitle, document_id: documentId || null, status: "processing" })
        .select("id").single();
      const jobId = job?.id ?? crypto.randomUUID();

      toast({ title: "🚀 Generazione avviata", description: `Spesi ${CREDIT_COSTS[creditAction]} cr. Elaborazione in corso...` });

      // ── Prepara contenuto e chiama l'Edge Function ────────────────────────
      const inputText = `[LIVELLO_DISTRAZIONE:${distractionLevel}]\n${textContent}`;
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
        const content = textContent.trim() ? inputText : "";
        if (!content) throw new Error("Nessun testo da elaborare");
        result = await generateQuizOrFlashcards(type, content, jobId, documentId, docTitle);
      }

      // ── Gestisci risultato ────────────────────────────────────────────────
      if (result.mode === "sync_edge") {
        // Edge Function ha già salvato — usa l'ID direttamente
        const resultId = result.quizId || result.deckId;
        if (resultId) {
          if (job?.id) await supabase.from("generation_jobs").update({ status: "completed", result_id: resultId, completed_at: new Date().toISOString(), error: null }).eq("id", job.id);
          if (isFlash) onFlashcardsGenerated(resultId);
          else         onQuizGenerated(resultId);
        }
        toast({ title: "✅ Generazione completata!", description: "I contenuti sono pronti nella tua libreria." });
        setGenerating(null);

      } else if (result.mode === "async_edge") {
        // Documento grande — elaborazione in background, ascolto via Realtime
        toast({ title: "⏳ Documento grande in elaborazione", description: "La generazione continua in background. Ti avviseremo al termine." });

        const ch = supabase.channel(`job_${result.jobId}`)
          .on("postgres_changes", { event: "UPDATE", schema: "public", table: "generation_jobs", filter: `id=eq.${result.jobId}` }, async (payload) => {
            const upd = payload.new as any;
            if (upd.status === "completed" && upd.result_id) {
              supabase.removeChannel(ch);
              if (isFlash) onFlashcardsGenerated(upd.result_id);
              else         onQuizGenerated(upd.result_id);
              toast({ title: "✅ Generazione completata!", description: "I contenuti sono pronti nella tua libreria." });
              setGenerating(null);
            } else if (upd.status === "error") {
              supabase.removeChannel(ch);
              toast({ title: "Generazione fallita", description: upd.error || "Errore. Riprova.", variant: "destructive" });
              await refreshCredits();
              setGenerating(null);
            }
          })
          .subscribe();

        // Safety timeout: 10 minuti
        setTimeout(async () => {
          supabase.removeChannel(ch);
          const { data: jc } = await supabase.from("generation_jobs").select("status, result_id").eq("id", result.jobId).single();
          if (jc?.status === "completed" && jc?.result_id) {
            if (isFlash) onFlashcardsGenerated(jc.result_id);
            else         onQuizGenerated(jc.result_id);
          } else {
            toast({ title: "Timeout generazione", description: "Controlla la libreria tra qualche minuto.", variant: "destructive" });
          }
          setGenerating(null);
        }, 10 * 60 * 1000);
      }

    } catch (err: any) {
      console.error("[generate] error:", err);
      toast({ title: "Errore generazione", description: err.message || "Generazione fallita. Riprova.", variant: "destructive" });
      await refreshCredits();
      setGenerating(null);
    }
  };

  // ──────────────────────────────────────────────────────────────────────────
  // SCOMPONI IN MICRO-TASK
  // ──────────────────────────────────────────────────────────────────────────
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
    } catch (err: any) {
      console.error("[decompose] error:", err);
      toast({ title: "Errore", description: err.message || "Scomposizione fallita.", variant: "destructive" });
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
    } catch (err: any) {
      console.error("[mindmap] error:", err);
      toast({ title: "Errore", description: err.message || "Generazione mappa fallita.", variant: "destructive" });
      await refreshCredits();
    } finally {
      setGenerating(null);
    }
  };

  // ──────────────────────────────────────────────────────────────────────────
  // RIASSUNTO / SCHEMA / APPUNTI SMART
  // ──────────────────────────────────────────────────────────────────────────
  const handleSummary = async (format: "summary" | "outline" | "smart_notes") => {
    if (!hasContent || !user) {
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

      const resultId = await saveSummaryResult(user.id, markdown, format, docTitle);

      // Notifica il parent component
      const summaryData = { content: markdown, format, title: docTitle };
      onSummaryGenerated?.(markdown, format, docTitle);

      toast({ title: `✅ ${formatLabels[format]} completato!`, description: "Disponibile nella tua libreria." });
    } catch (err: any) {
      console.error("[summary] error:", err);
      toast({ title: "Errore", description: err.message || "Generazione fallita.", variant: "destructive" });
      await refreshCredits();
    } finally {
      setGenerating(null);
    }
  };
    if (!hasContent || !user) {
      toast({ title: "Nessun contenuto", description: "Carica un documento, incolla del testo o aggiungi delle foto.", variant: "destructive" });
      return;
    }

    const creditAction = "quiz" as const;
    if (totalCredits < CREDIT_COSTS[creditAction]) {
      onInsufficientCredits?.(type === "flashcards" ? "flashcards" : "quiz");
      return;
    }
    const spent = await spendCredits(creditAction);
    if (!spent) {
      onInsufficientCredits?.(type === "flashcards" ? "flashcards" : "quiz");
      return;
    }

    setGenerating(type);

    try {
      const token     = await getAuthToken();
      const docTitle  = file?.name || (hasImages ? "Foto appunti" : "Studio");
      const isFlash   = type === "flashcards";

      // Upload file su Supabase Storage (opzionale, per storico)
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

      // Crea job per tracking progresso
      const { data: job } = await supabase.from("generation_jobs")
        .insert({
          user_id:      user.id,
          content_type: isFlash ? "flashcards" : "quiz",
          title:        docTitle,
          document_id:  documentId || null,
          status:       "processing",
        })
        .select("id").single();

      const jobId = job?.id ?? crypto.randomUUID();

      toast({
        title:       "🚀 Generazione avviata",
        description: `Spesi ${CREDIT_COSTS[creditAction]} cr. Elaborazione in corso...`,
      });




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
            <input ref={fileRef} type="file" accept=".txt,.md,.pdf,.doc,.docx,.csv,.json,.xml,.html" onChange={handleFileSelect} className="hidden" />
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
            <input ref={imageRef} type="file" accept="image/*" multiple onChange={handleImageSelect} className="hidden" />

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
