/**
 * backendApi.ts
 *
 * SEZIONI:
 * § 1  CONFIG & TIPI     → BACKEND_URL, ASYNC_THRESHOLD, GenerationResult
 * § 2  AUTH              → getAuthToken, helper url/key
 * § 3  FETCH HELPERS     → fetchWithTimeout, safeJson
 * § 4  AI TUTOR          → streamTutorChat (SSE streaming)
 * § 5  TRASCRIZIONE AUDIO → transcribeAudio
 * § 6  YOUTUBE           → fetchYoutubeTranscript
 * § 7  QUIZ / FLASHCARD  → generateQuizOrFlashcards (sync/async)
 * § 8  IMMAGINI          → generateQuizOrFlashcardsFromImages
 * § 9  SOMMARI           → generateSummary
 * § 10 MINDMAP           → generateMindmap
 * § 11 MICRO-TASK        → generateMicroTasks
 * § 12 SAVE HELPERS      → saveQuizResult, saveFlashcardResult,
 *                           saveSummaryResult, saveMindmapResult,
 *                           saveMicroTaskResult
 * § 13 LEGACY ALIASES    → generateFromText (retrocompatibilità)
 */

import { supabase } from "@/integrations/supabase/client";

// ═══════════════════════════════════════════════════════════════════════════════
// § 1 CONFIG & TIPI
// BACKEND_URL: Cloud Run. ASYNC_THRESHOLD: sopra questa soglia usa asyncMode.
// ═══════════════════════════════════════════════════════════════════════════════
const BACKEND_URL = (() => {
  const v = import.meta.env.VITE_BACKEND_URL as string | undefined;
  if (!v) return "https://focuseducation-backend-fixed-87505598703.europe-west1.run.app";
  return v.includes("focuseducation-backend-87505598703")
    ? "https://focuseducation-backend-fixed-87505598703.europe-west1.run.app"
    : v;
})();

// Oltre ~30k caratteri la generazione quiz può richiedere diversi minuti.
// In questi casi usiamo il job in background per evitare che il browser chiuda
// la richiesta con "Failed to send a request to the Edge Function".
// Alzato 30k→100k: allineato con ASYNC_MODE_THRESHOLD nell'Edge Function.
// File ≤100k → sync (risultato immediato). File >100k → async + GenerationNotifier.
export const ASYNC_THRESHOLD = 100_000;

export type GenerationResult =
  | { mode: "sync_edge";  quizId?: string; deckId?: string; summaryId?: string; data?: any }
  | { mode: "async_edge"; jobId: string };

// ═══════════════════════════════════════════════════════════════════════════════
// § 2 AUTH
// ═══════════════════════════════════════════════════════════════════════════════
export async function getAuthToken(): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Sessione scaduta. Effettua il login.");
  return session.access_token;
}

function supabaseUrl() { return (import.meta.env.VITE_SUPABASE_URL as string) ?? ""; }
function anonKey()     { return (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string) ?? ""; }

// ═══════════════════════════════════════════════════════════════════════════════
// § 3 FETCH HELPERS
// fetchWithTimeout: aggiunge AbortController con timeout ms.
// safeJson: legge il body come testo e fa JSON.parse con errore leggibile.
// ═══════════════════════════════════════════════════════════════════════════════
async function fetchWithTimeout(url: string, opts: RequestInit, ms: number): Promise<Response> {
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, { ...opts, signal: ctrl.signal }); }
  finally { clearTimeout(timer); }
}

async function safeJson(res: Response): Promise<any> {
  const text = await res.text();
  try { return JSON.parse(text); }
  catch { throw new Error(`Errore del server (${res.status})`); }
}

// ═══════════════════════════════════════════════════════════════════════════════
// § 4 AI TUTOR
// Streaming SSE. Prova Cloud Run, fallback Edge Function.
// ═══════════════════════════════════════════════════════════════════════════════
export async function streamTutorChat(
  messages:        Array<{ role: string; content: string }>,
  token:           string,
  documentContext?: string | null,
): Promise<Response> {
  const body: any = { messages };
  if (documentContext) body.documentContext = documentContext;
  try {
    const res = await fetchWithTimeout(`${BACKEND_URL}/ai-tutor`, {
      method:  "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body:    JSON.stringify(body),
    }, 60_000);
    if (res.ok || res.status === 429 || res.status === 402) return res;
  } catch (e) { console.warn("[backendApi] ai-tutor fallback:", e); }
  return fetch(`${supabaseUrl()}/functions/v1/ai-tutor`, {
    method:  "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, apikey: anonKey() },
    body:    JSON.stringify(body),
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// § 5 TRASCRIZIONE AUDIO
// Cloud Run → fallback Edge Function (base64).
// ═══════════════════════════════════════════════════════════════════════════════
export async function transcribeAudio(audioFile: File, token: string): Promise<string> {
  try {
    const fd = new FormData();
    fd.append("file", audioFile);
    const res = await fetchWithTimeout(`${BACKEND_URL}/voice-to-notes`, {
      method: "POST", headers: { Authorization: `Bearer ${token}` }, body: fd,
    }, 60_000);
    if (res.ok) { const d = await safeJson(res); return d.notes || ""; }
  } catch (e) { console.warn("[backendApi] voice-to-notes fallback:", e); }
  const base64 = await new Promise<string>((ok, err) => {
    const r = new FileReader();
    r.onload  = () => ok((r.result as string).split(",")[1]);
    r.onerror = err;
    r.readAsDataURL(audioFile);
  });
  const { data, error } = await supabase.functions.invoke("voice-to-notes", {
    body: { audioBase64: base64, mimeType: audioFile.type },
  });
  if (error || !data?.notes) throw new Error(error?.message || "Trascrizione fallita");
  return data.notes as string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// § 6 YOUTUBE
// Cloud Run → fallback Edge Function.
// ═══════════════════════════════════════════════════════════════════════════════
export async function fetchYoutubeTranscript(
  url: string, token: string,
): Promise<{ transcript: string; title: string; method: string; notice?: string }> {
  try {
    const res = await fetchWithTimeout(`${BACKEND_URL}/youtube-transcript`, {
      method:  "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body:    JSON.stringify({ url }),
    }, 90_000);
    if (res.ok) return await safeJson(res);
  } catch (e) { console.warn("[backendApi] youtube-transcript fallback:", e); }
  const { data, error } = await supabase.functions.invoke("youtube-transcript", { body: { url } });
  if (error) throw new Error(error.message || "Impossibile trascrivere il video");
  if (!data?.transcript) throw new Error("Nessuna trascrizione disponibile");
  return data as { transcript: string; title: string; method: string; notice?: string };
}

// ═══════════════════════════════════════════════════════════════════════════════
// § 7 QUIZ / FLASHCARD
// sync  (< ASYNC_THRESHOLD): aspetta risposta, usa quiz_id/deck_id direttamente.
// async (≥ ASYNC_THRESHOLD): asyncMode:true → 202 → Realtime subscription.
// ═══════════════════════════════════════════════════════════════════════════════
export async function generateQuizOrFlashcards(
  type:        "quiz" | "flashcards" | "quiz_gamified",
  content:     string,
  jobId:       string,
  documentId?: string,
  title?:      string,
): Promise<GenerationResult> {
  const isLarge  = content.length >= ASYNC_THRESHOLD;
  const typeMap: Record<string, string> = { quiz:"quiz", flashcards:"flashcards", quiz_gamified:"quiz_gamified" };
  const edgeType = typeMap[type] || type;

  if (!isLarge) {
    const { data, error } = await supabase.functions.invoke("generate-study-content", {
      body: { content, type: edgeType, jobId, documentId: documentId || null, title: title || null, asyncMode: false },
    });
    if (error) throw new Error(error.message || "Generazione fallita");
    if (data?.accepted && data?.jobId) return { mode: "async_edge", jobId: data.jobId };
    if (data?.quiz_id) return { mode: "sync_edge", quizId: data.quiz_id };
    if (data?.deck_id) return { mode: "sync_edge", deckId: data.deck_id };
    if (data?.success) return { mode: "sync_edge" };
    throw new Error(data?.error || "Risposta inattesa dall'Edge Function");
  }

  // Async: asyncMode:true + Realtime
  const { data, error } = await supabase.functions.invoke("generate-study-content", {
    body: { content, type: edgeType, jobId, documentId: documentId || null, title: title || null, asyncMode: true },
  });
  if (error) throw new Error(error.message || "Avvio generazione fallito");
  if (data?.accepted && data?.jobId) return { mode: "async_edge", jobId: data.jobId };
  if (data?.quiz_id) return { mode: "sync_edge", quizId: data.quiz_id };
  if (data?.deck_id) return { mode: "sync_edge", deckId: data.deck_id };
  throw new Error("Risposta inattesa dall'Edge Function (async)");
}

// ═══════════════════════════════════════════════════════════════════════════════
// § 8 IMMAGINI
// Sempre sync, sempre Edge Function diretta.
// ═══════════════════════════════════════════════════════════════════════════════
export async function generateQuizOrFlashcardsFromImages(
  imageDataUrls: string[],
  type:          "quiz" | "flashcards" | "quiz_gamified",
  jobId:         string,
  documentId?:   string,
  title?:        string,
): Promise<GenerationResult> {
  const typeMap: Record<string, string> = { quiz:"quiz", flashcards:"flashcards", quiz_gamified:"quiz_gamified" };
  const { data, error } = await supabase.functions.invoke("generate-study-content", {
    body: {
      images:     imageDataUrls,
      type:       typeMap[type] || type,
      jobId,
      documentId: documentId || null,
      title:      title || null,
      asyncMode:  false,
    },
  });
  if (error) throw new Error(error.message || "Generazione da immagini fallita");
  if (data?.quiz_id) return { mode: "sync_edge", quizId: data.quiz_id };
  if (data?.deck_id) return { mode: "sync_edge", deckId: data.deck_id };
  if (data?.success) return { mode: "sync_edge" };
  throw new Error(data?.error || "Risposta inattesa dall'Edge Function (immagini)");
}

// ═══════════════════════════════════════════════════════════════════════════════
// § 9 SOMMARI
// Edge Function sync. Formati: summary | outline | smart_notes.
// ═══════════════════════════════════════════════════════════════════════════════
export async function generateSummary(
  format:  "summary" | "outline" | "smart_notes",
  content: string,
  images?: string[],
): Promise<string> {
  const body: any = { format, content };
  if (images && images.length > 0) body.images = images;
  const { data, error } = await supabase.functions.invoke("generate-summary", { body });
  if (error) throw new Error(error.message || `Generazione ${format} fallita`);
  const md = data?.content || data?.markdown || data?.result?.markdown || "";
  if (!md) throw new Error("Risposta vuota dal generatore di sommari");
  return md;
}

// ═══════════════════════════════════════════════════════════════════════════════
// § 10 MINDMAP
// Edge Function sync. Restituisce { nodes, edges }.
// ═══════════════════════════════════════════════════════════════════════════════
export async function generateMindmap(
  content: string,
): Promise<{ nodes: any[]; edges: any[] }> {
  const { data, error } = await supabase.functions.invoke("generate-mindmap", {
    body: { content, text: content },
  });
  if (error || !data?.success) throw new Error(error?.message || "Generazione mappa fallita");
  return { nodes: data.nodes || [], edges: data.edges || [] };
}

// ═══════════════════════════════════════════════════════════════════════════════
// § 11 MICRO-TASK
// Edge Function sync. Restituisce { tasks: [...] }.
// ═══════════════════════════════════════════════════════════════════════════════
export async function generateMicroTasks(
  content: string,
): Promise<{ tasks: any[] }> {
  const { data, error } = await supabase.functions.invoke("decompose-tasks", { body: { content } });
  if (error) throw new Error(error.message || "Scomposizione fallita");
  return { tasks: data?.tasks || [] };
}

// ═══════════════════════════════════════════════════════════════════════════════
// § 12 SAVE HELPERS
// Usati solo se i dati RAW arrivano dall'esterno (non da Edge Function).
// Per quiz/flashcard via Edge Function, l'ID è già salvato — non servono.
// ═══════════════════════════════════════════════════════════════════════════════
export async function saveQuizResult(userId: string, data: any, documentId?: string, title?: string): Promise<string> {
  const qd        = data.quiz || data.result || data;
  const questions = qd.questions || [];
  const { data: quiz, error } = await supabase.from("quizzes").insert({
    user_id: userId, title: qd.title || title || "Quiz",
    topic: qd.topic || null, total_questions: questions.length,
    quiz_type: "standard", document_id: documentId || null,
  }).select("id").single();
  if (error) throw error;
  if (questions.length > 0) {
    const { error: e2 } = await supabase.from("quiz_questions").insert(
      questions.map((q: any, i: number) => ({
        quiz_id: quiz.id, question: q.question, options: q.options || [],
        correct_answer: q.correct_answer ?? 0, explanation: q.explanation || null,
        topic: q.topic || null, sort_order: i, points: q.points || 10,
        source_reference: q.source_reference || null,
      }))
    );
    if (e2) throw e2;
  }
  return quiz.id;
}

export async function saveFlashcardResult(userId: string, data: any, documentId?: string, title?: string): Promise<string> {
  const dd    = data.result || data;
  const cards = dd.cards || dd.flashcards || [];
  const { data: deck, error } = await supabase.from("flashcard_decks").insert({
    user_id: userId, title: dd.title || title || "Flashcard",
    topic: dd.topic || null, card_count: cards.length, document_id: documentId || null,
  }).select("id").single();
  if (error) throw error;
  if (cards.length > 0) {
    const { error: e2 } = await supabase.from("flashcards").insert(
      cards.map((c: any, i: number) => ({
        deck_id: deck.id, front: c.front, back: c.back,
        topic: c.topic || null, difficulty: c.difficulty || null,
        sort_order: i, easiness_factor: 2.5, source_reference: c.source_reference || null,
      }))
    );
    if (e2) throw e2;
  }
  return deck.id;
}

export async function saveSummaryResult(userId: string, markdown: string, format: string, title?: string): Promise<string> {
  const labels: Record<string, string> = { summary:"Riassunto", outline:"Schema", smart_notes:"Appunti Smart" };
  const { data, error } = await supabase.from("generated_content").insert({
    user_id: userId, content_type: format,
    title: title || labels[format] || "Documento",
    content: { markdown, format },
  }).select("id").single();
  if (error) throw error;
  return data.id;
}

export async function saveMindmapResult(userId: string, nodes: any[], edges: any[], title?: string): Promise<void> {
  await supabase.from("generated_content").insert({
    user_id: userId, content_type: "mindmap",
    title: title || "Mappa concettuale", content: { nodes, edges },
  });
}

export async function saveMicroTaskResult(userId: string, tasks: any[], title?: string): Promise<{ parentId: string; totalTasks: number }> {
  const { data: parent, error } = await supabase.from("tasks").insert({
    user_id: userId, title: `📚 ${title || "Studio"} — Piano micro-task`,
    description: `${tasks.length} micro-obiettivi generati`, priority: "high",
    estimated_minutes: Math.round(tasks.reduce((s: number, t: any) => s + (t.estimated_minutes || 10), 0)),
  }).select("id").single();
  if (error) throw error;
  if (tasks.length > 0) {
    await supabase.from("tasks").insert(
      tasks.map((t: any) => ({
        user_id: userId, title: t.title, description: t.description || null,
        estimated_minutes: t.estimated_minutes || 10, priority: t.priority || "medium",
        parent_task_id: parent.id,
      }))
    );
  }
  return { parentId: parent.id, totalTasks: tasks.length };
}

// ═══════════════════════════════════════════════════════════════════════════════
// § 13 LEGACY ALIASES
// generateFromText: alias per retrocompatibilità con componenti vecchi.
// Non usare per quiz/flashcard: usa generateQuizOrFlashcards().
// ═══════════════════════════════════════════════════════════════════════════════
export async function generateFromText(type: string, inputData: string, _token: string): Promise<any> {
  if (type === "decompose") return generateMicroTasks(inputData);
  if (type === "mindmap") {
    const { nodes, edges } = await generateMindmap(inputData);
    return { success: true, nodes, edges };
  }
  if (["summary", "outline", "smart_notes"].includes(type)) {
    const md = await generateSummary(type as any, inputData);
    return { result: { markdown: md }, content: md };
  }
  throw new Error(`generateFromText: tipo '${type}' non supportato. Usa generateQuizOrFlashcards().`);
}
