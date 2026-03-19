/**
 * backendApi.ts — routing intelligente:
 *
 * Se VITE_BACKEND_URL è configurato (backend Node.js deployato su Cloud Run):
 *   → usa il backend Express per tutte le chiamate AI
 *   → streaming SSE nativo per AiTutor
 *   → file upload multipart per voice-to-notes
 *
 * Se VITE_BACKEND_URL NON è configurato (solo Lovable Cloud):
 *   → fallback su Supabase Edge Functions
 *
 * In entrambi i casi i save helpers chiamano Supabase direttamente.
 */

import { supabase } from "@/integrations/supabase/client";

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL as string | undefined;
const hasBackend   = Boolean(BACKEND_URL);

// ── Auth ──────────────────────────────────────────────────────────────────────
export async function getAuthToken(): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) throw new Error("Sessione scaduta. Effettua il login.");
  return token;
}

// ── Supabase Edge Function base URL (per streaming diretto) ───────────────────
function supabaseUrl() { return (import.meta.env.VITE_SUPABASE_URL as string) ?? ""; }
function anonKey()     { return (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string) ?? ""; }

// ══════════════════════════════════════════════════════════════════════════════
// AI TUTOR — streaming SSE
// ══════════════════════════════════════════════════════════════════════════════
export async function streamTutorChat(
  messages:         Array<{ role: string; content: string }>,
  token:            string,
  documentContext?: string | null,
): Promise<Response> {
  const body: any = { messages };
  if (documentContext) body.documentContext = documentContext;

  const url     = hasBackend ? `${BACKEND_URL}/ai-tutor` : `${supabaseUrl()}/functions/v1/ai-tutor`;
  const headers: Record<string, string> = {
    "Content-Type":  "application/json",
    "Authorization": `Bearer ${token}`,
  };
  if (!hasBackend) headers["apikey"] = anonKey();

  const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });

  // Lascia passare 429/402 al chiamante per messaggi friendly
  if (!res.ok && res.status !== 429 && res.status !== 402) {
    const err = await res.json().catch(() => null);
    throw new Error(err?.error || `Errore del server (${res.status})`);
  }
  return res;
}

// ══════════════════════════════════════════════════════════════════════════════
// TRASCRIZIONE AUDIO
// ══════════════════════════════════════════════════════════════════════════════
export async function transcribeAudio(audioFile: File, token: string): Promise<string> {
  if (hasBackend) {
    // Backend: multipart/form-data (qualità superiore, no conversione base64)
    const formData = new FormData();
    formData.append("file", audioFile);
    const res = await fetch(`${BACKEND_URL}/voice-to-notes`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body:   formData,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => null);
      throw new Error(err?.error || `Errore trascrizione (${res.status})`);
    }
    const data = await res.json();
    return data.notes || "";
  }

  // Fallback Edge Function: converte in base64
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
  url:    string,
  token:  string,
): Promise<{ transcript: string; title: string; method: string; notice?: string }> {
  if (hasBackend) {
    const res = await fetch(`${BACKEND_URL}/youtube-transcript`, {
      method:  "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body:    JSON.stringify({ url }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => null);
      throw new Error(err?.error || "Impossibile trascrivere il video");
    }
    return res.json();
  }

  const { data, error } = await supabase.functions.invoke("youtube-transcript", { body: { url } });
  if (error) throw new Error(error.message || "Impossibile trascrivere il video");
  if (!data?.transcript) throw new Error("Nessuna trascrizione disponibile per questo video");
  return data as { transcript: string; title: string; method: string; notice?: string };
}

// ══════════════════════════════════════════════════════════════════════════════
// GENERAZIONE DA TESTO
// ══════════════════════════════════════════════════════════════════════════════
export async function generateFromText(
  type:      string,
  inputData: string,
  token:     string,
): Promise<any> {
  if (hasBackend) {
    const res = await fetch(`${BACKEND_URL}/generate-content`, {
      method:  "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body:    JSON.stringify({ type, inputData }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => null);
      throw new Error(err?.error || `Errore generazione (${res.status})`);
    }
    return res.json();
  }

  // Fallback Edge Functions
  const typeMap: Record<string, string> = {
    quiz: "quiz", flashcards: "flashcards", quiz_gamified: "quiz_gamified",
    decompose: "decompose", mindmap: "mindmap",
    summary: "summary", outline: "outline", smart_notes: "smart_notes",
    flashcard: "flashcards", mappa_concettuale: "mindmap",
    riassunto: "summary", schema: "outline", appunti: "smart_notes",
    quiz_adhd: "quiz_gamified", micro_task: "decompose",
  };
  const edgeType = typeMap[type] || type;

  if (edgeType === "decompose") {
    const { data, error } = await supabase.functions.invoke("decompose-tasks", { body: { content: inputData } });
    if (error) throw new Error(error.message || "Scomposizione fallita");
    return data;
  }
  if (edgeType === "mindmap") {
    const { data, error } = await supabase.functions.invoke("generate-mindmap", { body: { content: inputData, text: inputData } });
    if (error || !data?.success) throw new Error(error?.message || "Generazione mappa fallita");
    return data;
  }
  if (["summary", "outline", "smart_notes"].includes(edgeType)) {
    const { data, error } = await supabase.functions.invoke("generate-summary", { body: { content: inputData, format: edgeType } });
    if (error) throw new Error(error.message || "Generazione sommario fallita");
    return { result: { markdown: data?.content }, content: data?.content };
  }
  const { data, error } = await supabase.functions.invoke("generate-study-content", { body: { content: inputData, type: edgeType } });
  if (error) throw new Error(error.message || "Generazione fallita");
  return data;
}

// ══════════════════════════════════════════════════════════════════════════════
// GENERAZIONE DA FILE
// ══════════════════════════════════════════════════════════════════════════════
export async function generateFromFile(
  file:   File | Blob,
  type:   string,
  token:  string,
): Promise<any> {
  if (hasBackend) {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("type", type);
    const res = await fetch(`${BACKEND_URL}/generate-from-file`, {
      method:  "POST",
      headers: { Authorization: `Bearer ${token}` },
      body:    formData,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => null);
      throw new Error(err?.error || `Errore generazione da file (${res.status})`);
    }
    return res.json();
  }

  // Fallback: converte in base64 per Edge Function
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
    const { data, error } = await supabase.functions.invoke("generate-summary", { body: { images: [dataUrl], format: edgeType } });
    if (error) throw new Error(error.message || "Generazione sommario da immagine fallita");
    return { result: { markdown: data?.content }, content: data?.content };
  }
  const { data, error } = await supabase.functions.invoke("generate-study-content", { body: { images: [dataUrl], type: edgeType } });
  if (error) throw new Error(error.message || "Generazione da file fallita");
  return data;
}

// ══════════════════════════════════════════════════════════════════════════════
// SAVE HELPERS — sempre su Supabase diretto (indipendente dal backend)
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
