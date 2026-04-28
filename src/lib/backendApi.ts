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
import { isSafeYouTubeUrl } from "@/lib/security";

const DEFAULT_BACKEND_URL = "https://focuseducation-backend-fixed-87505598703.europe-west1.run.app";

function normalizeBackendUrl(raw: string | undefined): string {
  if (!raw) return DEFAULT_BACKEND_URL;
  const patched = raw.includes("focuseducation-backend-87505598703")
    ? DEFAULT_BACKEND_URL
    : raw;

  try {
    const parsed = new URL(patched);
    const isLocalHttp = parsed.protocol === "http:" && /^(localhost|127\.0\.0\.1)$/i.test(parsed.hostname);
    const isHttps = parsed.protocol === "https:";
    if (isHttps || isLocalHttp) return parsed.toString().replace(/\/$/, "");
  } catch {
    // Fall back to known-safe backend URL below.
  }
  return DEFAULT_BACKEND_URL;
}

// ═══════════════════════════════════════════════════════════════════════════════
// § 1 CONFIG & TIPI
// BACKEND_URL: Cloud Run. ASYNC_THRESHOLD: sopra questa soglia usa asyncMode.
// ═══════════════════════════════════════════════════════════════════════════════
const BACKEND_URL = normalizeBackendUrl(import.meta.env.VITE_BACKEND_URL as string | undefined);

// Oltre ~30k caratteri la generazione quiz può richiedere diversi minuti.
// In questi casi usiamo il job in background per evitare che il browser chiuda
// la richiesta con "Failed to send a request to the Edge Function".
// Alzato 30k→100k: allineato con ASYNC_MODE_THRESHOLD nell'Edge Function.
// File ≤100k → sync (risultato immediato). File >100k → async + GenerationNotifier.
export const ASYNC_THRESHOLD = 100_000;

type UnknownRecord = Record<string, unknown>;

interface StudyContentResponse {
  accepted?: boolean;
  jobId?: string;
  quiz_id?: string;
  deck_id?: string;
  success?: boolean;
  error?: string;
}

interface SummaryResponse {
  content?: string;
  markdown?: string;
  result?: {
    markdown?: string;
  };
}

interface MindmapResponse {
  success?: boolean;
  nodes?: unknown[];
  edges?: unknown[];
}

interface MicroTasksResponse {
  tasks?: unknown[];
}

interface QuizQuestionInput {
  question?: string;
  options?: string[];
  correct_answer?: number;
  explanation?: string | null;
  topic?: string | null;
  points?: number;
  source_reference?: string | null;
}

interface QuizResultInput {
  title?: string;
  topic?: string | null;
  questions?: QuizQuestionInput[];
}

interface FlashcardInput {
  front?: string;
  back?: string;
  topic?: string | null;
  difficulty?: string | null;
  source_reference?: string | null;
}

interface FlashcardResultInput {
  title?: string;
  topic?: string | null;
  cards?: FlashcardInput[];
  flashcards?: FlashcardInput[];
}

interface MicroTaskInput {
  title?: string;
  description?: string | null;
  estimated_minutes?: number;
  priority?: string;
}

export type GenerationResult =
  | { mode: "sync_edge";  quizId?: string; deckId?: string; summaryId?: string; data?: unknown }
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
function isValidEdgeFunctionName(name: string): boolean {
  return /^[a-z0-9-]{2,64}$/.test(name);
}

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

async function safeJson<T = unknown>(res: Response): Promise<T> {
  const text = await res.text();
  try { return JSON.parse(text) as T; }
  catch { throw new Error(`Errore del server (${res.status})`); }
}

function isEdgeTransportError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return err.name === "AbortError"
    || err.message.includes("Failed to fetch")
    || err.message.includes("NetworkError")
    || err.message.includes("Load failed")
    || err.message.includes("Failed to send a request to the Edge Function");
}

type EdgeRequestResult<T> = {
  data: T | null;
  rawText: string;
  status: number;
};

async function parseEdgeResponse<T>(res: Response): Promise<EdgeRequestResult<T>> {
  const rawText = await res.text();
  if (!rawText) return { data: null, rawText: "", status: res.status };

  try {
    return { data: JSON.parse(rawText) as T, rawText, status: res.status };
  } catch {
    return { data: null, rawText, status: res.status };
  }
}

export async function requestEdgeFunction<T = unknown>(
  functionName: string,
  body: unknown,
  timeoutMs = 120_000,
): Promise<EdgeRequestResult<T>> {
  if (!isValidEdgeFunctionName(functionName)) {
    throw new Error("Nome funzione Edge non valido");
  }
  const token = await getAuthToken();
  const url = `${supabaseUrl()}/functions/v1/${functionName}`;

  try {
    const res = await fetchWithTimeout(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        apikey: anonKey(),
      },
      body: JSON.stringify(body),
    }, timeoutMs);

    return await parseEdgeResponse<T>(res);
  } catch (err) {
    if (!isEdgeTransportError(err)) throw err;
    console.warn(`[backendApi] direct edge call failed for ${functionName}, retrying with sdk invoke`);
  }

  const { data, error } = await supabase.functions.invoke(functionName, { body });
  if (error) throw new Error(error.message || `Errore chiamando ${functionName}`);

  return { data: (data ?? null) as T | null, rawText: "", status: 200 };
}

export async function invokeEdgeFunction<T = unknown>(
  functionName: string,
  body: unknown,
  timeoutMs = 120_000,
): Promise<T> {
  const result = await requestEdgeFunction<T>(functionName, body, timeoutMs);

  if (result.status >= 200 && result.status < 300) {
    return (result.data ?? {}) as T;
  }

  const payload = result.data as UnknownRecord | null;
  throw new Error(payload?.error || payload?.message || result.rawText || `Errore del server (${result.status})`);
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
  const sanitizedMessages = messages
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .map((m) => ({ role: m.role, content: m.content.slice(0, 15_000) }))
    .slice(-40);

  const body: UnknownRecord = { messages: sanitizedMessages };
  if (documentContext) {
    const trimmedDocumentContext = documentContext.slice(0, 80_000);
    body.documentContext = trimmedDocumentContext;
    body.ctx = trimmedDocumentContext;
  }
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
    if (res.ok) {
      const data = await safeJson<{ notes?: string }>(res);
      return data.notes || "";
    }
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
  if (!isSafeYouTubeUrl(url)) {
    throw new Error("URL YouTube non valido");
  }
  try {
    const res = await fetchWithTimeout(`${BACKEND_URL}/youtube-transcript`, {
      method:  "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body:    JSON.stringify({ url }),
    }, 90_000);
    if (res.ok) return await safeJson<{ transcript: string; title: string; method: string; notice?: string }>(res);
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
    const data = await invokeEdgeFunction<StudyContentResponse>("generate-study-content", {
      content,
      type: edgeType,
      jobId,
      documentId: documentId || null,
      title: title || null,
      asyncMode: false,
    }, 150_000);
    if (data?.accepted && data?.jobId) return { mode: "async_edge", jobId: data.jobId };
    if (data?.quiz_id) return { mode: "sync_edge", quizId: data.quiz_id };
    if (data?.deck_id) return { mode: "sync_edge", deckId: data.deck_id };
    if (data?.success) return { mode: "sync_edge" };
    throw new Error(data?.error || "Risposta inattesa dall'Edge Function");
  }

  // Async: asyncMode:true + Realtime
  const data = await invokeEdgeFunction<StudyContentResponse>("generate-study-content", {
    content,
    type: edgeType,
    jobId,
    documentId: documentId || null,
    title: title || null,
    asyncMode: true,
  }, 30_000);
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
  const data = await invokeEdgeFunction<StudyContentResponse>("generate-study-content", {
    images:     imageDataUrls,
    type:       typeMap[type] || type,
    jobId,
    documentId: documentId || null,
    title:      title || null,
    asyncMode:  false,
  }, 150_000);
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
  const body: UnknownRecord = { format, content };
  if (images && images.length > 0) body.images = images;
  const data = await invokeEdgeFunction<SummaryResponse>("generate-summary", body, 180_000);
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
): Promise<{ nodes: unknown[]; edges: unknown[] }> {
  const data = await invokeEdgeFunction<MindmapResponse>("generate-mindmap", { content, text: content }, 120_000);
  if (!data?.success) throw new Error("Generazione mappa fallita");
  return { nodes: data.nodes || [], edges: data.edges || [] };
}

// ═══════════════════════════════════════════════════════════════════════════════
// § 11 MICRO-TASK
// Edge Function sync. Restituisce { tasks: [...] }.
// ═══════════════════════════════════════════════════════════════════════════════
export async function generateMicroTasks(
  content: string,
): Promise<{ tasks: unknown[] }> {
  const data = await invokeEdgeFunction<MicroTasksResponse>("decompose-tasks", { content }, 120_000);
  return { tasks: data?.tasks || [] };
}

// ═══════════════════════════════════════════════════════════════════════════════
// § 12 SAVE HELPERS
// Usati solo se i dati RAW arrivano dall'esterno (non da Edge Function).
// Per quiz/flashcard via Edge Function, l'ID è già salvato — non servono.
// ═══════════════════════════════════════════════════════════════════════════════
export async function saveQuizResult(userId: string, data: UnknownRecord, documentId?: string, title?: string): Promise<string> {
  const qd = (data.quiz || data.result || data) as QuizResultInput | undefined;
  if (!qd) throw new Error("Dati quiz mancanti");
  
  const questions = Array.isArray(qd.questions) ? qd.questions : [];
  if (questions.length === 0) throw new Error("Il quiz non contiene domande valide");

  const { data: quiz, error } = await supabase.from("quizzes").insert({
    user_id: userId, title: qd.title || title || "Quiz",
    topic: qd.topic || null, total_questions: questions.length,
    quiz_type: "standard", document_id: documentId || null,
  }).select("id").single();
  
  if (error) throw error;
  
  const { error: e2 } = await supabase.from("quiz_questions").insert(
    questions.map((q: QuizQuestionInput, i: number) => ({
      quiz_id: quiz.id, question: q.question || "Domanda senza testo", 
      options: Array.isArray(q.options) ? q.options : [],
      correct_answer: typeof q.correct_answer === "number" ? q.correct_answer : 0, 
      explanation: q.explanation || null,
      topic: q.topic || null, sort_order: i, points: q.points || 10,
      source_reference: q.source_reference || null,
    }))
  );
  if (e2) {
    await supabase.from("quizzes").delete().eq("id", quiz.id); // Cleanup
    throw e2;
  }
  
  return quiz.id;
}

export async function saveFlashcardResult(userId: string, data: UnknownRecord, documentId?: string, title?: string): Promise<string> {
  const dd = (data.result || data) as FlashcardResultInput | undefined;
  if (!dd) throw new Error("Dati flashcard mancanti");

  const cards = Array.isArray(dd.cards) ? dd.cards : Array.isArray(dd.flashcards) ? dd.flashcards : [];
  if (cards.length === 0) throw new Error("Il deck non contiene flashcard valide");

  const { data: deck, error } = await supabase.from("flashcard_decks").insert({
    user_id: userId, title: dd.title || title || "Flashcard",
    topic: dd.topic || null, card_count: cards.length, document_id: documentId || null,
  }).select("id").single();
  
  if (error) throw error;
  
  const { error: e2 } = await supabase.from("flashcards").insert(
    cards.map((c: FlashcardInput, i: number) => ({
      deck_id: deck.id, front: c.front || "Fronte vuoto", back: c.back || "Retro vuoto",
      topic: c.topic || null, difficulty: c.difficulty || null,
      sort_order: i, easiness_factor: 2.5, source_reference: c.source_reference || null,
    }))
  );
  if (e2) {
    await supabase.from("flashcard_decks").delete().eq("id", deck.id); // Cleanup
    throw e2;
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

export async function saveMindmapResult(userId: string, nodes: unknown[], edges: unknown[], title?: string): Promise<void> {
  await supabase.from("generated_content").insert({
    user_id: userId, content_type: "mindmap",
    title: title || "Mappa concettuale", content: { nodes, edges },
  });
}

export async function saveMicroTaskResult(userId: string, tasks: MicroTaskInput[], title?: string): Promise<{ parentId: string; totalTasks: number }> {
  const { data: parent, error } = await supabase.from("tasks").insert({
    user_id: userId, title: `📚 ${title || "Studio"} — Piano micro-task`,
    description: `${tasks.length} micro-obiettivi generati`, priority: "high",
    estimated_minutes: Math.round(tasks.reduce((s: number, t: MicroTaskInput) => s + (t.estimated_minutes || 10), 0)),
  }).select("id").single();
  if (error) throw error;
  if (tasks.length > 0) {
    await supabase.from("tasks").insert(
      tasks.map((t: MicroTaskInput) => ({
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
export async function generateFromText(type: string, inputData: string, _token: string): Promise<unknown> {
  if (type === "decompose") return generateMicroTasks(inputData);
  if (type === "mindmap") {
    const { nodes, edges } = await generateMindmap(inputData);
    return { success: true, nodes, edges };
  }
  if (["summary", "outline", "smart_notes"].includes(type)) {
    const md = await generateSummary(type as "summary" | "outline" | "smart_notes", inputData);
    return { result: { markdown: md }, content: md };
  }
  throw new Error(`generateFromText: tipo '${type}' non supportato. Usa generateQuizOrFlashcards().`);
}
