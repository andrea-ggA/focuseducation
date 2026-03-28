/**
 * backendApi.ts — routing intelligente con fallback e supporto async:
 *
 * Contenuto piccolo (<40k chars): Cloud Run sync (veloce, ~20-30s)
 * Contenuto grande (>=40k chars): Edge Function async (background, nessun timeout)
 *
 * Se Cloud Run restituisce dati grezzi → frontend salva su Supabase
 * Se Edge Function ha già salvato → usa direttamente quiz_id/deck_id
 * Se Edge Function async → ascolta Realtime sul jobId
 */

import { supabase } from "@/integrations/supabase/client";

const FIXED_BACKEND_URL  = "https://focuseducation-backend-fixed-87505598703.europe-west1.run.app";
const LEGACY_BACKEND_URL = "https://focuseducation-backend-87505598703.europe-west1.run.app";

function normalizeBackendUrl(url?: string): string {
  if (!url) return FIXED_BACKEND_URL;
  return url.includes(LEGACY_BACKEND_URL) ? FIXED_BACKEND_URL : url;
}

const BACKEND_URL = normalizeBackendUrl(import.meta.env.VITE_BACKEND_URL as string | undefined);

// Soglia: sopra questa dimensione usiamo Edge Function async
export const ASYNC_THRESHOLD = 40_000;

// Timeout per Cloud Run (documenti piccoli)
const SYNC_TIMEOUT_MS = 90_000;

// ── Auth ──────────────────────────────────────────────────────────────────────
export async function getAuthToken(): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) throw new Error("Sessione scaduta. Effettua il login.");
  return token;
}

function supabaseUrl() { return (import.meta.env.VITE_SUPABASE_URL as string) ?? ""; }
function anonKey()     { return (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string) ?? ""; }

async function fetchWithTimeout(url: string, opts: RequestInit, timeoutMs: number): Promise<Response> {
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try { return await fetch(url, { ...opts, signal: ctrl.signal }); }
  finally { clearTimeout(timer); }
}

async function safeJsonParse(res: Response): Promise<any> {
  const text = await res.text();
  try { return JSON.parse(text); }
  catch { throw new Error(`Errore del server (${res.status})`); }
}

// ── Tipo risultato generazione ────────────────────────────────────────────────
export type GenerationResult =
  | { mode: "sync_backend"; data: any }
  | { mode: "sync_edge";    quizId?: string; deckId?: string }
  | { mode: "async_edge";   jobId: string };

// ══════════════════════════════════════════════════════════════════════════════
// AI TUTOR — streaming SSE
// ══════════════════════════════════════════════════════════════════════════════
export async function streamTutorChat(
  messages: Array<{ role: string; content: string }>,
  token: string,
  documentContext?: string | null,
): Promise<Response> {
  const body: any = { messages };
  if (documentContext) body.documentContext = documentContext;

  try {
    const res = await fetchWithTimeout(`${BACKEND_URL}/ai-tutor`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    }, 60_000);
    if (res.ok || res.status === 429 || res.status === 402) return res;
  } catch (e) {
    console.warn("[backendApi] ai-tutor fallback:", e);
  }

  return fetch(`${supabaseUrl()}/functions/v1/ai-tutor`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      apikey: anonKey(),
    },
    body: JSON.stringify(body),
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// TRASCRIZIONE AUDIO
// ══════════════════════════════════════════════════════════════════════════════
export async function transcribeAudio(audioFile: File, token: string): Promise<string> {
  try {
    const formData = new FormData();
    formData.append("file", audioFile);
    const res = await fetchWithTimeout(`${BACKEND_URL}/voice-to-notes`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    }, 60_000);
    if (res.ok) { const d = await safeJsonParse(res); return d.notes || ""; }
  } catch (e) { console.warn("[backendApi] voice-to-notes fallback:", e); }

  const base64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve((reader.result as string).split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(audioFile);
  });
  const { data, error } = await supabase.functions.invoke("voice-to-notes", {
    body: { audioBase64: base64, mimeType: audioFile.type },
  });
  if (error || !data?.notes) throw new Error(error?.message || "Trascrizione fallita");
  return data.notes as string;
}

// ══════════════════════════════════════════════════════════════════════════════
// YOUTUBE TRANSCRIPT
// ══════════════════════════════════════════════════════════════════════════════
export async function fetchYoutubeTranscript(
  url: string, token: string,
): Promise<{ transcript: string; title: string; method: string; notice?: string }> {
  try {
    const res = await fetchWithTimeout(`${BACKEND_URL}/youtube-transcript`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ url }),
    }, 90_000);
    if (res.ok) return await safeJsonParse(res);
  } catch (e) { console.warn("[backendApi] youtube-transcript fallback:", e); }

  const { data, error } = await supabase.functions.invoke("youtube-transcript", { body: { url } });
  if (error) throw new Error(error.message || "Impossibile trascrivere il video");
  if (!data?.transcript) throw new Error("Nessuna trascrizione disponibile");
  return data as { transcript: string; title: string; method: string; notice?: string };
}

// ══════════════════════════════════════════════════════════════════════════════
// GENERAZIONE DA TESTO — routing intelligente
// ══════════════════════════════════════════════════════════════════════════════
export async function generateContent(
  type:        string,
  inputData:   string,
  token:       string,
  jobId:       string,
  documentId?: string,
  title?:      string,
): Promise<GenerationResult> {
  const isLarge = inputData.length >= ASYNC_THRESHOLD;

  // ── Cloud Run sync — solo per contenuti piccoli ───────────────────────────
  if (!isLarge) {
    try {
      const res = await fetchWithTimeout(`${BACKEND_URL}/generate-content`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ type, inputData }),
      }, SYNC_TIMEOUT_MS);

      if (res.ok) return { mode: "sync_backend", data: await safeJsonParse(res) };
      console.warn(`[backendApi] Cloud Run failed (${res.status}), switching to Edge Function async`);
    } catch (e: any) {
      console.warn("[backendApi] Cloud Run unreachable:", e.message);
    }
  } else {
    console.log(`[backendApi] Large content (${inputData.length} chars), using Edge Function async directly`);
  }

  // ── Edge Function async ───────────────────────────────────────────────────
  const typeMap: Record<string, string> = {
    quiz: "quiz", flashcards: "flashcards", quiz_gamified: "quiz_gamified",
    summary: "summary", outline: "outline", smart_notes: "smart_notes",
    decompose: "decompose", mindmap: "mindmap",
    flashcard: "flashcards", mappa_concettuale: "mindmap",
    riassunto: "summary", schema: "outline", appunti: "smart_notes",
    quiz_adhd: "quiz_gamified", micro_task: "decompose",
  };
  const edgeType = typeMap[type] || type;

  // Casi speciali non-async
  if (edgeType === "decompose") {
    const { data, error } = await supabase.functions.invoke("decompose-tasks", { body: { content: inputData } });
    if (error) throw new Error(error.message || "Scomposizione fallita");
    return { mode: "sync_backend", data };
  }
  if (edgeType === "mindmap") {
    const { data, error } = await supabase.functions.invoke("generate-mindmap", { body: { content: inputData, text: inputData } });
    if (error || !data?.success) throw new Error(error?.message || "Generazione mappa fallita");
    return { mode: "sync_backend", data };
  }
  if (["summary", "outline", "smart_notes"].includes(edgeType)) {
    const { data, error } = await supabase.functions.invoke("generate-summary", { body: { content: inputData, format: edgeType } });
    if (error) throw new Error(error.message || "Generazione sommario fallita");
    return { mode: "sync_backend", data: { result: { markdown: data?.content }, content: data?.content } };
  }

  // Quiz / flashcards → Edge Function async
  const { data, error } = await supabase.functions.invoke("generate-study-content", {
    body: {
      content:    inputData,
      type:       edgeType,
      jobId,
      documentId: documentId || null,
      title:      title || null,
      asyncMode:  true,
    },
  });

  if (error) throw new Error(error.message || "Avvio generazione fallito");

  // 202 async
  if (data?.accepted && data?.jobId) return { mode: "async_edge", jobId: data.jobId };
  // Sync completato (file corto)
  if (data?.quiz_id)  return { mode: "sync_edge", quizId: data.quiz_id };
  if (data?.deck_id)  return { mode: "sync_edge", deckId: data.deck_id };
  if (data?.success)  return { mode: "sync_edge" };

  throw new Error("Risposta inattesa dall'Edge Function");
}

// ══════════════════════════════════════════════════════════════════════════════
// GENERAZIONE DA FILE
// ══════════════════════════════════════════════════════════════════════════════
export async function generateFromFile(
  file:        File | Blob,
  type:        string,
  token:       string,
  jobId:       string,
  documentId?: string,
  title?:      string,
): Promise<GenerationResult> {
  const isImage = file.type.startsWith("image/");

  // File non-immagine → prova Cloud Run prima
  if (!isImage) {
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("type", type);
      const res = await fetchWithTimeout(`${BACKEND_URL}/generate-from-file`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      }, SYNC_TIMEOUT_MS);
      if (res.ok) return { mode: "sync_backend", data: await safeJsonParse(res) };
      console.warn(`[backendApi] Cloud Run generate-from-file failed (${res.status})`);
    } catch (e: any) {
      console.warn("[backendApi] Cloud Run generate-from-file unreachable:", e.message);
    }
  }

  // Fallback/immagini → Edge Function con base64
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  const typeMap: Record<string, string> = {
    quiz: "quiz", flashcards: "flashcards", quiz_gamified: "quiz_gamified",
    summary: "summary", outline: "outline", smart_notes: "smart_notes",
  };
  const edgeType = typeMap[type] || type;

  if (["summary", "outline", "smart_notes"].includes(edgeType)) {
    const { data, error } = await supabase.functions.invoke("generate-summary", {
      body: { images: [dataUrl], format: edgeType },
    });
    if (error) throw new Error(error.message || "Generazione sommario da immagine fallita");
    return { mode: "sync_backend", data: { result: { markdown: data?.content }, content: data?.content } };
  }

  const { data, error } = await supabase.functions.invoke("generate-study-content", {
    body: {
      images:     [dataUrl],
      type:       edgeType,
      jobId,
      documentId: documentId || null,
      title:      title || null,
      asyncMode:  true,
    },
  });

  if (error) throw new Error(error.message || "Generazione da file fallita");
  if (data?.accepted && data?.jobId) return { mode: "async_edge", jobId: data.jobId };
  if (data?.quiz_id)  return { mode: "sync_edge", quizId: data.quiz_id };
  if (data?.deck_id)  return { mode: "sync_edge", deckId: data.deck_id };
  if (data?.success)  return { mode: "sync_edge" };

  throw new Error("Risposta inattesa dall'Edge Function");
}

// ══════════════════════════════════════════════════════════════════════════════
// SAVE HELPERS — usati SOLO quando Cloud Run restituisce dati grezzi
// ══════════════════════════════════════════════════════════════════════════════
export async function saveQuizResult(userId: string, data: any, documentId?: string, title?: string): Promise<string> {
  const quizData  = data.quiz || data.result || data;
  const questions = quizData.questions || [];
  const { data: quiz, error: qErr } = await supabase.from("quizzes").insert({
    user_id: userId, title: quizData.title || title || "Quiz",
    topic: quizData.topic || null, total_questions: questions.length,
    quiz_type: "standard", document_id: documentId || null,
  }).select("id").single();
  if (qErr) throw qErr;
  if (questions.length > 0) {
    const { error } = await supabase.from("quiz_questions").insert(
      questions.map((q: any, i: number) => ({
        quiz_id: quiz.id, question: q.question, options: q.options || [],
        correct_answer: q.correct_answer ?? 0, explanation: q.explanation || null,
        topic: q.topic || null, sort_order: i, points: q.points || 10,
        source_reference: q.source_reference || null,
      }))
    );
    if (error) throw error;
  }
  return quiz.id;
}

export async function saveFlashcardResult(userId: string, data: any, documentId?: string, title?: string): Promise<string> {
  const deckData = data.result || data;
  const cards    = deckData.cards || deckData.flashcards || [];
  const { data: deck, error: dErr } = await supabase.from("flashcard_decks").insert({
    user_id: userId, title: deckData.title || title || "Flashcard",
    topic: deckData.topic || null, card_count: cards.length, document_id: documentId || null,
  }).select("id").single();
  if (dErr) throw dErr;
  if (cards.length > 0) {
    const { error } = await supabase.from("flashcards").insert(
      cards.map((c: any, i: number) => ({
        deck_id: deck.id, front: c.front, back: c.back,
        topic: c.topic || null, difficulty: c.difficulty || null,
        sort_order: i, easiness_factor: 2.5,
        source_reference: c.source_reference || null,
      }))
    );
    if (error) throw error;
  }
  return deck.id;
}

export async function saveSummaryResult(userId: string, data: any, format: string, title?: string): Promise<string> {
  const content  = data.result || data.content || "";
  const markdown = typeof content === "string" ? content : content.markdown || JSON.stringify(content);
  const labels: Record<string, string> = { summary: "Riassunto", outline: "Schema", smart_notes: "Appunti Smart" };
  const { data: saved, error } = await supabase.from("generated_content").insert({
    user_id: userId, content_type: format,
    title: title || labels[format] || "Documento",
    content: { markdown, format },
  }).select("id").single();
  if (error) throw error;
  return saved.id;
}

export async function saveMindmapResult(userId: string, data: any, title?: string): Promise<{ nodes: any[]; edges: any[] }> {
  const result = data.result || data;
  const nodes  = result.nodes || [];
  const edges  = result.edges || [];
  await supabase.from("generated_content").insert({
    user_id: userId, content_type: "mindmap",
    title: title || "Mappa concettuale", content: { nodes, edges },
  });
  return { nodes, edges };
}

export async function saveMicroTaskResult(userId: string, data: any, title?: string): Promise<{ parentId: string; totalTasks: number }> {
  const result = data.result || data;
  const tasks  = result.tasks || [];
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

// Legacy alias per altri componenti che usano ancora generateFromText
export async function generateFromText(type: string, inputData: string, token: string): Promise<any> {
  const result = await generateContent(type, inputData, token, "legacy");
  if (result.mode === "sync_backend") return result.data;
  throw new Error("Usa generateContent() per il flusso completo con async support");
}
