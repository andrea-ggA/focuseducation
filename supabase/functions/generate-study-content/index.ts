import { serve } from "https://deno.land/std@0.220.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ╔══════════════════════════════════════════════════════════════════════════════╗
// ║  generate-study-content — Edge Function                                     ║
// ║                                                                              ║
// ║  SEZIONI (cerca il titolo per saltarci direttamente):                        ║
// ║  § 1  CORS                                                                   ║
// ║  § 2  CONFIG          → modello AI, soglie chunk, concorrenza                ║
// ║  § 3  TEXT CLEANING   → cleanText, removePageArtifacts                       ║
// ║  § 4  CHUNKING        → chunkBySentences                                     ║
// ║  § 5  PARALLEL        → parallelLimit                                        ║
// ║  § 6  AI CALL         → callAI (timeout 45s, retry), sleep, updateJob       ║
// ║  § 7  JSON PARSING    → extractJsonFromText (partial recovery)               ║
// ║  § 8  QUIZ HELPERS    → balanceCorrectAnswers, deduplicateItems              ║
// ║  § 9  LANGUAGE        → LANG_SIGNATURES, detectLanguageHeuristic             ║
// ║  § 10 TOPICS          → extractTopicOutline, consolidateTopics               ║
// ║  § 11 HANDLER: AUTH   → autenticazione, rate limit, parsing body             ║
// ║  § 12 HANDLER: ASYNC  → asyncMode background job                             ║
// ║  § 13 HANDLER: IMAGES → path immagini multimodali                            ║
// ║  § 14 HANDLER: TEXT   → pipeline testo (lang+topics, chunking, AI, dedup)   ║
// ║  § 15 HANDLER: SAVE   → salvataggio quiz/flashcard su Supabase               ║
// ║  § 16 HANDLER: ERRORS → catch globale, aggiornamento job in errore           ║
// ╚══════════════════════════════════════════════════════════════════════════════╝

// ═══════════════════════════════════════════════════════════════════════════════
// § 1 CORS
// ═══════════════════════════════════════════════════════════════════════════════
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ═══════════════════════════════════════════════════════════════════════════════
// § 2 CONFIG
// Per cambiare modello modifica SOLO FAST_MODEL.
// Per cambiare velocità/quantità: MAX_CHUNKS, CONCURRENCY, ITEMS_PER_CHUNK.
// ═══════════════════════════════════════════════════════════════════════════════
// Modelli supportati dall'API Gemini corrente.
// La serie 1.5 è stata rimossa e causava 404 -> risposta non-2xx della function.
const FAST_MODEL: string = "gemini-2.5-flash";
const FALLBACK_MODEL: string = "gemini-2.0-flash";
// CHUNK_MAX_CHARS: ridotto 28k→6k. Con 28k un doc da 42k dava 2 chunk×15=30 domande.
// Con 6k: 42k doc→8 chunk×25=200 domande | 80k→16×25=400 | 10k→2×25=50.
// Timing: 16 chunk × ~5s (gemini-2.5-flash, concurrency 4) = ~20s. Sicuro.
const CHUNK_MAX_CHARS = 6_000;
const CHUNK_OVERLAP = 400; // ridotto proporzionalmente (era 800 per chunk da 28k)
const MAX_CHUNKS = 16; // alzato 8→16 per coprire doc grandi
const CONCURRENCY = 4;
const ITEMS_PER_CHUNK = 25; // alzato 15→25 per più domande per chunk

// ═══════════════════════════════════════════════════════════════════════════════
// § 3 TEXT CLEANING
// cleanText: ligature, trattini fine riga, ctrl chars, whitespace.
// removePageArtifacts: righe corte ripetute ≥3 volte = header/footer.
// ═══════════════════════════════════════════════════════════════════════════════
function cleanText(raw: string): string {
  return raw
    .replace(/ﬁ/g, "fi")
    .replace(/ﬂ/g, "fl")
    .replace(/ﬀ/g, "ff")
    .replace(/ﬃ/g, "ffi")
    .replace(/ﬄ/g, "ffl")
    .replace(/ﬅ/g, "st")
    .replace(/-\n(\S)/g, "$1")
    .replace(/\n\s*(?:Page|Pagina|Pag\.?|p\.)\s*\d+\s*\n/gi, "\n")
    .replace(/\n\s*\d{1,4}\s*\n/g, "\n")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, " ")
    .replace(/\uFFFD/g, " ")
    .replace(/[\u200B-\u200F]/g, "")
    .replace(/\u00AD/g, "")
    .replace(/\.{4,}/g, "…")
    .replace(/-{3,}/g, "—")
    .replace(/_{3,}/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n")
    .map((l: string) => l.trim())
    .join("\n")
    .trim();
}

function removePageArtifacts(text: string): string {
  const lines = text.split("\n");
  const freq = new Map<string, number>();
  for (const line of lines) {
    const t = line.trim();
    if (t.length > 0 && t.length <= 50) freq.set(t, (freq.get(t) || 0) + 1);
  }
  const artifacts = new Set<string>();
  for (const [line, count] of freq.entries()) {
    if (count >= 3) artifacts.add(line);
  }
  return lines
    .filter((line) => {
      const t = line.trim();
      if (artifacts.has(t)) return false;
      if (/^(?:Pagina?\.?\s*)?\d{1,4}$/.test(t)) return false;
      if (/^[|=\-_.•◦▪▸►●○]{4,}$/.test(t)) return false;
      if (/^https?:\/\/\S+$/.test(t)) return false;
      return true;
    })
    .join("\n");
}

// ═══════════════════════════════════════════════════════════════════════════════
// § 4 CHUNKING
// Spezza a confini di frase/paragrafo per evitare domande su frasi troncate.
// ═══════════════════════════════════════════════════════════════════════════════
function chunkBySentences(text: string, maxChars = CHUNK_MAX_CHARS, overlap = CHUNK_OVERLAP): string[] {
  if (text.length <= maxChars) return [text];
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + maxChars, text.length);
    if (end < text.length) {
      const segment = text.substring(start, end);
      const lastDouble = segment.lastIndexOf("\n\n");
      if (lastDouble > maxChars * 0.55) {
        end = start + lastDouble + 2;
      } else {
        let lastSentence = -1;
        const re = /[.!?]\s+/g;
        let m;
        while ((m = re.exec(segment)) !== null) {
          if (m.index > maxChars * 0.45) lastSentence = m.index + m[0].length;
        }
        if (lastSentence > 0) {
          end = start + lastSentence;
        } else {
          const lastSpace = segment.lastIndexOf(" ");
          if (lastSpace > maxChars * 0.65) end = start + lastSpace + 1;
        }
      }
    }
    const chunk = text.substring(start, end).trim();
    if (chunk.length > 100) chunks.push(chunk);
    if (end >= text.length) break;
    const nextStart = Math.max(0, end - overlap);
    start = nextStart <= start ? end : nextStart;
  }
  return chunks;
}

// ═══════════════════════════════════════════════════════════════════════════════
// § 5 PARALLEL
// ═══════════════════════════════════════════════════════════════════════════════
async function parallelLimit<T>(tasks: (() => Promise<T>)[], limit: number): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < tasks.length) {
      const idx = nextIndex++;
      results[idx] = await tasks[idx]();
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, () => worker()));
  return results;
}

// ═══════════════════════════════════════════════════════════════════════════════
// § 6 AI CALL
// callAI: AbortController 45s + retry con backoff esponenziale.
// updateJob: aggiorna generation_jobs con fallback senza campi progress.
// ═══════════════════════════════════════════════════════════════════════════════
function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function callAI(
  apiKey: string,
  messages: any[],
  model: string = FAST_MODEL,
  retries = 3,
  maxTokens = 16000,
): Promise<any> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 45_000);
      let res: Response;
      try {
        res = await fetch("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ model, messages, max_tokens: maxTokens }),
          signal: ctrl.signal,
        });
      } finally {
        clearTimeout(timer);
      }
      if (!res.ok) {
        const t = await res.text();
        console.error(`AI error (attempt ${attempt + 1}):`, res.status, t.substring(0, 150));
        if (res.status === 429) {
          if (attempt < retries) {
            await sleep(3000 * (attempt + 1));
            continue;
          }
          throw { status: 429, message: "Rate limit. Riprova tra poco." };
        }
        if (res.status === 402) throw { status: 402, message: "Crediti AI esauriti." };
        if (attempt < retries) {
          await sleep(2000 * (attempt + 1));
          continue;
        }
        throw new Error("AI generation failed: " + res.status);
      }
      return await res.json();
    } catch (e: any) {
      if (e.status === 402 || e.status === 429) throw e;
      const isTimeout = e.name === "AbortError" || e.message?.includes("aborted");
      console.error(
        `AI ${isTimeout ? "timeout" : "network"} error (attempt ${attempt + 1}/${retries + 1}):`,
        e.message || e,
      );
      if (attempt < retries) {
        await sleep(isTimeout ? 1000 : 2000 * (attempt + 1));
        continue;
      }
      // Ultimo tentativo: prova il modello fallback se diverso da quello principale
      if (model === FAST_MODEL && FAST_MODEL !== FALLBACK_MODEL) {
        console.warn(`[callAI] switching to fallback model: ${FALLBACK_MODEL}`);
        return callAI(apiKey, messages, FALLBACK_MODEL, 1, maxTokens);
      }
      throw isTimeout ? new Error("Timeout risposta AI (45s). Riprova.") : e;
    }
  }
}

type JobUpdate = Record<string, unknown>;

async function updateJob(supabase: any, jobId: string | undefined, updates: JobUpdate) {
  if (!jobId) return;
  const { error } = await supabase.from("generation_jobs").update(updates).eq("id", jobId);
  if (!error) return;
  const fallback = Object.fromEntries(
    Object.entries(updates).filter(([key]) => key !== "progress_message" && key !== "progress_pct"),
  );
  if (Object.keys(fallback).length === 0 || Object.keys(fallback).length === Object.keys(updates).length) {
    console.warn("generation_jobs update failed:", error.message);
    return;
  }
  const { error: fe } = await supabase.from("generation_jobs").update(fallback).eq("id", jobId);
  if (fe) console.warn("generation_jobs fallback update failed:", fe.message);
}

// ═══════════════════════════════════════════════════════════════════════════════
// § 7 JSON PARSING
// Estrae JSON anche da risposte malformate. Partial recovery incluso.
// ═══════════════════════════════════════════════════════════════════════════════
function extractJsonFromText(text: string): any {
  let cleaned = text
    .replace(/```json\s*/gi, "")
    .replace(/```\s*/g, "")
    .trim();
  const start = cleaned.search(/[\{\[]/);
  if (start === -1) throw new Error("No JSON found");
  const isArray = cleaned[start] === "[";
  const end = cleaned.lastIndexOf(isArray ? "]" : "}");
  if (end === -1) throw new Error("No JSON end found");
  cleaned = cleaned.substring(start, end + 1);
  try {
    return JSON.parse(cleaned);
  } catch {}
  const basic = cleaned
    .replace(/,\s*}/g, "}")
    .replace(/,\s*]/g, "]")
    .replace(/[\x00-\x1F\x7F]/g, "")
    .replace(/\\(?!["\\/bfnrtu])/g, "\\\\");
  try {
    return JSON.parse(basic);
  } catch {}
  // Partial recovery: estrae oggetti validi uno ad uno
  const itemKey = cleaned.includes('"question"') ? "question" : "front";
  const collectionKey = cleaned.includes('"questions"') ? "questions" : "cards";
  const titleMatch = cleaned.match(/"title"\s*:\s*"([^"]+)"/);
  const arrayStart = cleaned.indexOf("[");
  if (arrayStart === -1) throw new Error("Cannot recover JSON");
  const items: any[] = [];
  let depth = 0,
    objStart = -1;
  const arr = cleaned.substring(arrayStart + 1);
  for (let i = 0; i < arr.length; i++) {
    if (arr[i] === "{") {
      if (depth === 0) objStart = i;
      depth++;
    } else if (arr[i] === "}") {
      depth--;
      if (depth === 0 && objStart !== -1) {
        try {
          const o = JSON.parse(arr.substring(objStart, i + 1));
          if (o[itemKey]) items.push(o);
        } catch {}
        objStart = -1;
      }
    }
  }
  if (items.length > 0) {
    console.log(`Partial JSON recovery: ${items.length} items`);
    const r: any = {};
    if (titleMatch) r.title = titleMatch[1];
    r[collectionKey] = items;
    return r;
  }
  throw new Error("JSON parsing failed");
}

// ═══════════════════════════════════════════════════════════════════════════════
// § 8 QUIZ HELPERS
// balanceCorrectAnswers: distribuisce A/B/C/D uniformemente nel quiz.
// deduplicateItems: rimuove domande/card semanticamente duplicate.
// ═══════════════════════════════════════════════════════════════════════════════
function balanceCorrectAnswers(rows: any[]): any[] {
  if (rows.length <= 1) return rows;
  const counts = [0, 0, 0, 0];
  const maxPerSlot = Math.ceil(rows.length / 4) + 1;
  rows.forEach((r) => {
    if (r.correct_answer >= 0 && r.correct_answer <= 3) counts[r.correct_answer]++;
  });
  for (let i = 0; i < rows.length; i++) {
    const curr = rows[i].correct_answer;
    if (counts[curr] <= maxPerSlot) continue;
    const target = counts.indexOf(Math.min(...counts));
    if (target === curr || target < 0 || target > 3) continue;
    const opts = [...rows[i].options];
    [opts[curr], opts[target]] = [opts[target], opts[curr]];
    rows[i] = { ...rows[i], options: opts, correct_answer: target };
    counts[curr]--;
    counts[target]++;
  }
  for (let i = 1; i < rows.length; i++) {
    if (rows[i].correct_answer !== rows[i - 1].correct_answer) continue;
    const isTriple = i >= 2 && rows[i - 2].correct_answer === rows[i].correct_answer;
    if (!isTriple && Math.random() > 0.5) continue;
    const curr = rows[i].correct_answer;
    const candidates = [0, 1, 2, 3].filter((s) => s !== curr && counts[s] <= maxPerSlot);
    if (!candidates.length) continue;
    const target = candidates[Math.floor(Math.random() * candidates.length)];
    const opts = [...rows[i].options];
    [opts[curr], opts[target]] = [opts[target], opts[curr]];
    rows[i] = { ...rows[i], options: opts, correct_answer: target };
    counts[curr]--;
    counts[target]++;
  }
  return rows;
}

function deduplicateItems<T extends Record<string, any>>(items: T[], key: string): T[] {
  const seen = new Set<string>();
  const stop = new Set([
    "il",
    "la",
    "lo",
    "le",
    "gli",
    "un",
    "una",
    "dei",
    "delle",
    "degli",
    "che",
    "non",
    "per",
    "con",
    "del",
    "della",
    "and",
    "the",
    "of",
    "in",
    "to",
    "a",
    "is",
    "are",
    "di",
    "da",
    "su",
    "al",
    "nel",
    "nella",
    "dal",
    "dalla",
    "come",
    "quando",
    "perché",
  ]);
  return items.filter((item) => {
    const sig = String(item[key] || "")
      .toLowerCase()
      .replace(/[^\w\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !stop.has(w))
      .sort()
      .slice(0, 8)
      .join("|");
    if (seen.has(sig)) return false;
    seen.add(sig);
    return true;
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// § 9 LANGUAGE DETECTION
// Euristica su parole firma (no AI). Fallback AI se score < 4.
// ═══════════════════════════════════════════════════════════════════════════════
const LANG_SIGNATURES: Record<string, string[]> = {
  italiano: [
    "della",
    "delle",
    "degli",
    "nella",
    "sono",
    "anche",
    "questo",
    "questa",
    "come",
    "quando",
    "però",
    "quindi",
    "tuttavia",
  ],
  english: ["the", "and", "that", "this", "with", "from", "they", "their", "have", "been", "which", "would", "could"],
  español: ["que", "una", "para", "con", "por", "los", "las", "del", "este", "esta", "como", "también", "pero"],
  français: ["les", "des", "une", "pour", "dans", "avec", "sur", "par", "mais", "comme", "cette", "aussi", "plus"],
  deutsch: ["die", "der", "das", "und", "ist", "mit", "von", "ein", "eine", "auch", "nicht", "werden", "haben"],
};

function detectLanguageHeuristic(sample: string): string {
  const words = sample.toLowerCase().split(/\s+/).slice(0, 200);
  const wordSet = new Set(words);
  let bestLang = "",
    bestScore = 0;
  for (const [lang, sigs] of Object.entries(LANG_SIGNATURES)) {
    const score = sigs.filter((w) => wordSet.has(w)).length;
    if (score > bestScore) {
      bestScore = score;
      bestLang = lang;
    }
  }
  return bestScore >= 4 ? bestLang : "";
}

// ═══════════════════════════════════════════════════════════════════════════════
// § 10 TOPICS
// extractTopicOutline: 1 chiamata AI → lista macro-argomenti del documento.
// consolidateTopics: normalizza i topic liberi dei chunk verso l'outline.
// normCmp / topicOverlap: funzioni helper per confronto stringhe topic.
// ═══════════════════════════════════════════════════════════════════════════════
async function extractTopicOutline(apiKey: string, text: string, language: string): Promise<string[]> {
  const sample = text.substring(0, 20_000);
  const langNote = language === "italiano" ? "Rispondi SOLO in italiano." : `Respond in ${language}.`;
  try {
    const data = await callAI(
      apiKey,
      [
        { role: "system", content: `You are an expert academic content analyst. ${langNote}` },
        {
          role: "user",
          content: `Analyze this academic text and identify the 5 to 15 MAIN topics/chapters.\n\nRULES:\n- Each topic: BROAD chapter-level concept (2-5 words max).\n- MUTUALLY EXCLUSIVE (no overlaps). CLEAR academic terminology.\n- Order by appearance. IGNORE: page numbers, headers, bibliography, URLs.\n\nReturn ONLY a JSON array. Example: ["Cell Biology", "DNA Replication"]\n\n--- TEXT ---\n${sample}\n--- END ---\nJSON array only.`,
        },
      ],
      FAST_MODEL,
      2,
      1500,
    ); // FAST_MODEL ovunque — nessun gemini-2.5-flash hardcoded
    const txt = data.choices?.[0]?.message?.content || "";
    const cl = txt
      .replace(/```json\s*/gi, "")
      .replace(/```\s*/g, "")
      .trim();
    const s = cl.indexOf("["),
      e = cl.lastIndexOf("]");
    if (s !== -1 && e !== -1) {
      const topics = JSON.parse(cl.substring(s, e + 1));
      if (Array.isArray(topics) && topics.length > 0) {
        console.log(`Topics (${topics.length}): ${topics.join(", ")}`);
        return topics.slice(0, 20);
      }
    }
  } catch (e: any) {
    console.warn("Topic outline failed:", e.message);
  }
  return [];
}

function normCmp(s: string) {
  return s
    .toLowerCase()
    .replace(/[^a-zà-ÿ0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
function topicOverlap(a: string, b: string) {
  const wa = normCmp(a).split(" "),
    wb = normCmp(b).split(" ");
  const sb = new Set(wb);
  const shared = wa.filter((w) => w.length > 2 && sb.has(w)).length;
  const union = new Set([...wa, ...wb]).size;
  return union > 0 ? shared / union : 0;
}

function consolidateTopics<T extends Record<string, any>>(items: T[], outline: string[] = [], max = 18): T[] {
  if (!items.length) return items;
  if (outline.length > 0) {
    items = items.map((item: T) => {
      const t = (item.topic || "Generale").trim();
      if (outline.find((ot) => normCmp(ot) === normCmp(t))) return item;
      let best = "",
        bestScore = 0;
      for (const ot of outline) {
        const s = topicOverlap(t, ot);
        if (s > bestScore) {
          bestScore = s;
          best = ot;
        }
      }
      if (bestScore < 0.15) {
        for (const ot of outline) {
          if (normCmp(t).includes(normCmp(ot)) || normCmp(ot).includes(normCmp(t))) {
            best = ot;
            bestScore = 0.5;
            break;
          }
        }
      }
      return bestScore >= 0.15 ? { ...item, topic: best } : item;
    });
  }
  const freq = new Map<string, number>();
  items.forEach((i: T) => {
    const t = (i.topic || "Generale").trim();
    freq.set(t, (freq.get(t) || 0) + 1);
  });
  if (freq.size <= max) return items;
  const sorted = [...freq.entries()].sort((a, b) => b[1] - a[1]);
  const kept = sorted.slice(0, max);
  const mapping = new Map<string, string>();
  for (const [topic] of sorted.slice(max)) {
    let best = kept[0][0],
      bestS = 0;
    for (const [kt] of kept) {
      const s = topicOverlap(topic, kt);
      if (s > bestS) {
        bestS = s;
        best = kt;
      }
    }
    if (bestS < 0.1)
      for (const [kt] of kept) {
        if (normCmp(topic).includes(normCmp(kt)) || normCmp(kt).includes(normCmp(topic))) {
          best = kt;
          break;
        }
      }
    mapping.set(topic, best);
  }
  console.log(`Consolidation: ${freq.size} → ${kept.length} topics`);
  return items.map((i: T) => {
    const t = (i.topic || "Generale").trim();
    return mapping.has(t) ? { ...i, topic: mapping.get(t) } : i;
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// § 11-16  MAIN HANDLER
// ═══════════════════════════════════════════════════════════════════════════════
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    // ── § 11 AUTH & RATE LIMIT ─────────────────────────────────────────────────
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing authorization");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabase = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const anonClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const {
      data: { user: authUser },
      error: authError,
    } = await anonClient.auth.getUser();
    if (authError || !authUser) throw new Error("Unauthorized");
    const user = { id: authUser.id };

    const { data: allowed } = await supabase.rpc("check_and_increment_rate_limit", {
      _user_id: user.id,
      _max_per_min: 10,
    });
    if (allowed === false) {
      return new Response(JSON.stringify({ error: "Troppe richieste. Attendi un minuto." }), {
        status: 429,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { content: rawContent, type, documentId, title, jobId, images, asyncMode, internalRun } = await req.json();
    const content =
      typeof rawContent === "string"
        ? rawContent.replace(/^\[LIVELLO_DISTRAZIONE:\d+\]\s*/m, "") // strip prefisso frontend
        : rawContent;
    const hasImages = Array.isArray(images) && images.length > 0;
    console.log(
      `[gen] type=${type} len=${content?.length || 0} imgs=${hasImages ? images.length : 0} job=${jobId || "none"}`,
    );

    if (!content && !hasImages) throw new Error("Missing content or images");
    if (!type) throw new Error("Missing type");

    // ── § 12 ASYNC MODE — RIMOSSO ─────────────────────────────────────────────
    // Il self-fetch fire-and-forget causava 504 sistematici e job zombie.
    // Con gemini-1.5-flash e MAX_CHUNKS=8 tutto completa in 30-60s (sync).
    // asyncMode e internalRun vengono ignorati: tutto elaborato inline.

    if (content && typeof content !== "string") throw new Error("Content must be a string");
    const cleanedContent = content ? removePageArtifacts(cleanText(content)) : "";
    const cleanedLen = cleanedContent.length;
    if (content) console.log(`Clean: ${content.length} → ${cleanedLen} (-${content.length - cleanedLen} artefatti)`);

    if (!hasImages && cleanedLen < 50)
      return new Response(JSON.stringify({ error: "Contenuto troppo corto" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    if (cleanedLen > 2_000_000)
      return new Response(JSON.stringify({ error: "Contenuto troppo grande (max 2MB)" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    if (!["quiz", "quiz_gamified", "flashcards"].includes(type))
      return new Response(JSON.stringify({ error: "Tipo non valido" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });

    const GEMINI_API_KEY = Deno.env.get("GOOGLE_GEMINI_API_KEY");
    if (!GEMINI_API_KEY) throw new Error("GOOGLE_GEMINI_API_KEY not configured");
    await updateJob(supabase, jobId, { status: "processing" });

    // ── § 13 PATH IMMAGINI ─────────────────────────────────────────────────────
    if (hasImages) {
      await updateJob(supabase, jobId, { progress_message: "Analisi immagini…" });
      const N = 20;
      const lang = "Genera nella lingua del testo visibile. Default: italiano.";
      const isQuiz = type !== "flashcards";
      const prompt = isQuiz
        ? `Analizza le immagini e genera ${N} domande a risposta multipla.\nREGOLE: Solo contenuto effettivamente visibile. IGNORA: numeri pagina, intestazioni, URL, bibliografie.\n4 opzioni. correct_answer 0-3. explanation max 120 chars. topic max 4 parole.\nMix: facile 10pts/15s, medio 20pts/30s, difficile 30pts/45s.${type === "quiz_gamified" ? " ADHD: domande brevi, dirette." : ""}\n${cleanedContent ? `\nTesto extra:\n${cleanedContent.substring(0, 12000)}` : ""}\nOutput: {"title":"...","questions":[{"question":"...","options":["A","B","C","D"],"correct_answer":0,"explanation":"...","topic":"...","points":10,"time_limit_seconds":30}]}\n${lang} ESATTAMENTE ${N} domande. SOLO JSON.`
        : `Analizza le immagini e genera ${N} flashcard.\nREGOLE: Solo contenuto effettivamente visibile. IGNORA: numeri pagina, intestazioni, URL, bibliografie.\nfront max 110 chars. back max 190 chars. topic max 4 parole. difficulty easy/medium/hard.\n${cleanedContent ? `\nTesto extra:\n${cleanedContent.substring(0, 12000)}` : ""}\nOutput: {"title":"...","cards":[{"front":"...","back":"...","topic":"...","difficulty":"medium"}]}\n${lang} ESATTAMENTE ${N} flashcard. SOLO JSON.`;
      const parts: any[] = [{ type: "text", text: prompt }];
      for (const url of images) parts.push({ type: "image_url", image_url: { url } });
      const aiData = await callAI(
        GEMINI_API_KEY,
        [
          { role: "system", content: `Professional academic educator. ${lang}` },
          { role: "user", content: parts },
        ],
        FAST_MODEL,
        3,
        16000,
      );
      const parsed = extractJsonFromText(aiData.choices?.[0]?.message?.content || "");
      const genTitle = parsed.title || title || "Foto appunti";
      let resultId = "",
        totalItems = 0;
      if (isQuiz) {
        const finalQ = deduplicateItems(parsed.questions || [], "question");
        if (!finalQ.length) throw new Error("Nessuna domanda generata.");
        const topics = [...new Set(finalQ.map((q: any) => q.topic).filter(Boolean))];
        const { data: quiz, error: qErr } = await supabase
          .from("quizzes")
          .insert({
            user_id: user.id,
            document_id: documentId || null,
            title: genTitle,
            quiz_type: type === "quiz_gamified" ? "gamified_adhd" : "standard",
            total_questions: finalQ.length,
            topic: topics.slice(0, 10).join(", "),
          })
          .select("id")
          .single();
        if (qErr) throw qErr;
        const rows = finalQ.map((q: any, i: number) => {
          const opts = [...(q.options || [])];
          const ct = opts[q.correct_answer ?? 0];
          for (let j = opts.length - 1; j > 0; j--) {
            const k = Math.floor(Math.random() * (j + 1));
            [opts[j], opts[k]] = [opts[k], opts[j]];
          }
          return {
            quiz_id: quiz.id,
            question: q.question,
            options: opts,
            correct_answer: opts.indexOf(ct),
            explanation: q.explanation || "",
            topic: q.topic || "Generale",
            points: q.points || 10,
            time_limit_seconds: q.time_limit_seconds || 30,
            sort_order: i,
            source_reference: null,
          };
        });
        await supabase.from("quiz_questions").insert(balanceCorrectAnswers(rows));
        resultId = quiz.id;
        totalItems = rows.length;
      } else {
        const finalC = deduplicateItems(parsed.cards || [], "front");
        if (!finalC.length) throw new Error("Nessuna flashcard generata.");
        const topics = [...new Set(finalC.map((c: any) => c.topic).filter(Boolean))];
        const { data: deck, error: dErr } = await supabase
          .from("flashcard_decks")
          .insert({
            user_id: user.id,
            document_id: documentId || null,
            title: genTitle,
            card_count: finalC.length,
            topic: topics.slice(0, 10).join(", "),
          })
          .select("id")
          .single();
        if (dErr) throw dErr;
        await supabase.from("flashcards").insert(
          finalC.map((c: any, i: number) => ({
            deck_id: deck.id,
            front: c.front,
            back: c.back,
            topic: c.topic || "Generale",
            difficulty: c.difficulty || "medium",
            sort_order: i,
            source_reference: null,
          })),
        );
        resultId = deck.id;
        totalItems = finalC.length;
      }
      await updateJob(supabase, jobId, {
        status: "completed",
        result_id: resultId,
        total_items: totalItems,
        completed_at: new Date().toISOString(),
        error: null,
      });
      return new Response(
        JSON.stringify(
          isQuiz
            ? { success: true, quiz_id: resultId, total_questions: totalItems, from_images: true }
            : { success: true, deck_id: resultId, total_cards: totalItems, from_images: true },
        ),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── § 14 PATH TESTO ────────────────────────────────────────────────────────
    // Step 0: language detection + topic outline in parallelo
    const heuristicLang = detectLanguageHeuristic(cleanedContent.substring(0, 1000));
    console.log(`Lang heuristic: "${heuristicLang || "inconclusive — using AI"}"`);
    const [docLanguage, topicOutline] = await Promise.all([
      heuristicLang
        ? Promise.resolve(heuristicLang)
        : callAI(
            GEMINI_API_KEY,
            [
              {
                role: "user",
                content: `Detect language. ONE word only (italiano/english/español/français/deutsch). Text: "${cleanedContent.substring(0, 400)}"`,
              },
            ],
            FAST_MODEL,
            2,
            15,
          )
            .then((d) => {
              const det = d.choices?.[0]?.message?.content?.trim().toLowerCase() || "";
              return det && det.length < 25 ? det : "italiano";
            })
            .catch(() => "italiano"),
      extractTopicOutline(GEMINI_API_KEY, cleanedContent, heuristicLang || "italiano"),
    ]);
    console.log(`Language: ${docLanguage}, Topics: ${topicOutline.length}`);

    const langInstruction =
      docLanguage === "italiano"
        ? "Genera TUTTO il contenuto in italiano."
        : `Generate ALL content in ${docLanguage}. Do NOT translate.`;
    const topicInstruction =
      topicOutline.length > 0
        ? `\nAVAILABLE TOPICS — assign EVERY item to one of these ONLY: ${JSON.stringify(topicOutline)}\nDo NOT invent new topic names.`
        : "";

    // Step 1: chunking + pipeline AI parallela
    const allChunks = chunkBySentences(cleanedContent, CHUNK_MAX_CHARS, CHUNK_OVERLAP);
    const nChunks = Math.min(allChunks.length, MAX_CHUNKS);
    const chunks = allChunks.slice(0, nChunks);
    const startTime = Date.now();
    const allQuestions: any[] = [];
    const allCards: any[] = [];
    let generatedTitle = title || "Studio";
    let completedCount = 0;
    console.log(`Chunks: ${allChunks.length} total → processing ${nChunks} at concurrency ${CONCURRENCY}`);

    const chunkTasks = chunks.map((chunk, idx) => async () => {
      const isFirst = idx === 0,
        chunkNum = idx + 1,
        isQ = type !== "flashcards";
      const systemMsg = `You are a professional academic ${isQ ? "examiner" : "educator"}. Extract EVERY important concept. Generate EXACTLY ${ITEMS_PER_CHUNK} ${isQ ? "questions" : "flashcards"}. Respond ONLY with valid JSON. ${langInstruction}`;
      const prompt = isQ
        ? `Generate EXACTLY ${ITEMS_PER_CHUNK} multiple-choice questions from fragment ${chunkNum}/${nChunks}.\n\nCRITICAL RULES:\n1. Questions based ONLY on THIS fragment.\n2. IGNORE: page numbers, headers, footers, bibliography, figure captions, URLs.\n3. 4 plausible options. correct_answer 0-3, ≈25% each.\n4. explanation: WHY correct (max 120 chars).\n5. topic: max 4 words.${topicInstruction}\n6. Mix: easy 25% (10pts/15s), medium 40% (20pts/30s), hard 35% (30pts/45s).${type === "quiz_gamified" ? "\n7. ADHD: short, punchy, direct." : ""}\n\n${isFirst ? `Output: {"title":"descriptive title","questions":[...]}` : `Output: {"questions":[...]}`}\nEach: {"question":"...","options":["A","B","C","D"],"correct_answer":0,"explanation":"...","topic":"...","points":10,"time_limit_seconds":30}\n\n--- FRAGMENT ${chunkNum}/${nChunks} ---\n${chunk}\n--- END ---\nEXACTLY ${ITEMS_PER_CHUNK} questions. ONLY valid JSON.`
        : `Generate EXACTLY ${ITEMS_PER_CHUNK} flashcards from fragment ${chunkNum}/${nChunks}.\n\nCRITICAL RULES:\n1. Flashcards based ONLY on THIS fragment.\n2. IGNORE: page numbers, headers, footers, bibliography, figure captions, URLs.\n3. front max 110 chars. back max 190 chars.\n4. topic max 4 words.${topicInstruction}\n5. difficulty: easy 25%, medium 40%, hard 35%.\n\n${isFirst ? `Output: {"title":"descriptive title","cards":[...]}` : `Output: {"cards":[...]}`}\nEach: {"front":"...","back":"...","topic":"...","difficulty":"medium"}\n\n--- FRAGMENT ${chunkNum}/${nChunks} ---\n${chunk}\n--- END ---\nEXACTLY ${ITEMS_PER_CHUNK} flashcards. ONLY valid JSON.`;
      try {
        const aiData = await callAI(
          GEMINI_API_KEY,
          [
            { role: "system", content: systemMsg },
            { role: "user", content: prompt },
          ],
          FAST_MODEL,
          3,
          16000,
        );
        const txt = aiData.choices?.[0]?.message?.content || "";
        if (!txt) {
          console.warn(`Chunk ${chunkNum}: empty`);
          return { chunkNum, title: null, questions: [], cards: [] };
        }
        const parsed = extractJsonFromText(txt);
        const chunkTitle = isFirst && parsed.title ? parsed.title : null;
        if (!isQ) {
          const cards = parsed.cards || parsed.questions || [];
          console.log(`Chunk ${chunkNum}/${nChunks}: +${cards.length} cards`);
          return { chunkNum, title: chunkTitle, questions: [], cards };
        } else {
          const qs = parsed.questions || [];
          console.log(`Chunk ${chunkNum}/${nChunks}: +${qs.length} questions`);
          return { chunkNum, title: chunkTitle, questions: qs, cards: [] };
        }
      } catch (err: any) {
        const msg = err.message || String(err);
        console.error(`Chunk ${chunkNum} failed:`, msg);
        // Salva il messaggio di errore reale per poterlo surfacciare se TUTTI i chunk falliscono
        return { chunkNum, title: null, questions: [], cards: [], error: msg };
      }
    });

    let progressInterval: ReturnType<typeof setInterval> | null = null;
    if (jobId) {
      progressInterval = setInterval(async () => {
        try {
          const soFar = type === "flashcards" ? allCards.length : allQuestions.length;
          const elapsed = Date.now() - startTime;
          const etaMs = completedCount > 0 ? Math.round((elapsed / completedCount) * (nChunks - completedCount)) : null;
          const eta = etaMs ? ` · ~${Math.max(1, Math.ceil(etaMs / 1000))}s` : "";
          await updateJob(supabase, jobId, {
            total_items: soFar,
            progress_message: `Sezione ${Math.min(completedCount + 1, nChunks)} di ${nChunks}… ${soFar} elementi${eta}`,
            progress_pct: Math.round((completedCount / nChunks) * 100),
          });
        } catch {
          /* non critico */
        }
      }, 2500);
    }

    const wrappedTasks = chunkTasks.map((fn) => async () => {
      const r = await fn();
      completedCount++;
      return r;
    });
    const results = await parallelLimit(wrappedTasks, CONCURRENCY);
    if (progressInterval) clearInterval(progressInterval);

    const chunkErrors: string[] = [];
    for (const r of results) {
      if (r.title && generatedTitle === (title || "Studio")) generatedTitle = r.title;
      allQuestions.push(...r.questions);
      allCards.push(...r.cards);
      if ((r as any).error) chunkErrors.push(`chunk ${r.chunkNum}: ${(r as any).error}`);
    }
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    console.log(
      `Done: ${elapsed}s · ${allQuestions.length} questions · ${allCards.length} cards · ${chunkErrors.length} errors`,
    );

    // Step 2: dedup + consolidazione topic
    const dedupQ = deduplicateItems(allQuestions, "question");
    const dedupC = deduplicateItems(allCards, "front");
    if (allQuestions.length - dedupQ.length > 0) console.log(`Dedup Q: -${allQuestions.length - dedupQ.length}`);
    if (allCards.length - dedupC.length > 0) console.log(`Dedup C: -${allCards.length - dedupC.length}`);
    const finalQ = consolidateTopics(dedupQ, topicOutline, 18);
    const finalC = consolidateTopics(dedupC, topicOutline, 18);

    // ── § 15 SAVE TO DB ────────────────────────────────────────────────────────
    let resultId = "",
      totalItems = 0;
    if (type !== "flashcards") {
      if (!finalQ.length) {
        const detail = chunkErrors.length > 0 ? ` Dettaglio: ${chunkErrors[0]}` : "";
        throw new Error(`Nessuna domanda generata.${detail} Riprova.`);
      }
      const topics = [...new Set(finalQ.map((q: any) => q.topic).filter(Boolean))];
      const { data: quiz, error: qErr } = await supabase
        .from("quizzes")
        .insert({
          user_id: user.id,
          document_id: documentId || null,
          title: generatedTitle,
          quiz_type: type === "quiz_gamified" ? "gamified_adhd" : "standard",
          total_questions: finalQ.length,
          topic: topics.slice(0, 10).join(", "),
        })
        .select("id")
        .single();
      if (qErr) throw qErr;
      const rows = finalQ.map((q: any, i: number) => {
        const opts = [...(q.options || [])];
        const ct = opts[typeof q.correct_answer === "number" ? q.correct_answer : 0];
        for (let j = opts.length - 1; j > 0; j--) {
          const k = Math.floor(Math.random() * (j + 1));
          [opts[j], opts[k]] = [opts[k], opts[j]];
        }
        return {
          quiz_id: quiz.id,
          question: q.question,
          options: opts,
          correct_answer: opts.indexOf(ct),
          explanation: q.explanation || "",
          topic: q.topic || "Generale",
          points: q.points || 10,
          time_limit_seconds: q.time_limit_seconds || 30,
          sort_order: i,
          source_reference: q.source_context || q.source_reference || null,
        };
      });
      const balanced = balanceCorrectAnswers(rows);
      for (let i = 0; i < balanced.length; i += 100) {
        const { error } = await supabase.from("quiz_questions").insert(balanced.slice(i, i + 100));
        if (error) throw error;
      }
      resultId = quiz.id;
      totalItems = balanced.length;
      console.log(`Quiz: ${quiz.id} · ${balanced.length} questions · ${topics.length} topics`);
    } else {
      if (!finalC.length) {
        const detail = chunkErrors.length > 0 ? ` Dettaglio: ${chunkErrors[0]}` : "";
        throw new Error(`Nessuna flashcard generata.${detail} Riprova.`);
      }
      const topics = [...new Set(finalC.map((c: any) => c.topic).filter(Boolean))];
      const { data: deck, error: dErr } = await supabase
        .from("flashcard_decks")
        .insert({
          user_id: user.id,
          document_id: documentId || null,
          title: generatedTitle,
          card_count: finalC.length,
          topic: topics.slice(0, 10).join(", "),
        })
        .select("id")
        .single();
      if (dErr) throw dErr;
      const rows = finalC.map((c: any, i: number) => ({
        deck_id: deck.id,
        front: c.front,
        back: c.back,
        topic: c.topic || "Generale",
        difficulty: c.difficulty || "medium",
        sort_order: i,
        source_reference: c.source_context || c.source_reference || null,
      }));
      for (let i = 0; i < rows.length; i += 100) {
        const { error } = await supabase.from("flashcards").insert(rows.slice(i, i + 100));
        if (error) throw error;
      }
      resultId = deck.id;
      totalItems = rows.length;
      console.log(`Deck: ${deck.id} · ${rows.length} cards`);
    }

    await updateJob(supabase, jobId, {
      status: "completed",
      result_id: resultId,
      total_items: totalItems,
      completed_at: new Date().toISOString(),
      error: null,
      progress_pct: 100,
      progress_message: null,
    });
    return new Response(
      JSON.stringify(
        type === "flashcards"
          ? {
              success: true,
              deck_id: resultId,
              total_cards: totalItems,
              chunks_processed: nChunks,
              elapsed_seconds: elapsed,
            }
          : {
              success: true,
              quiz_id: resultId,
              total_questions: totalItems,
              chunks_processed: nChunks,
              elapsed_seconds: elapsed,
            },
      ),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );

    // ── § 16 ERROR HANDLER ───────────────────────────────────────────────────────
  } catch (e: any) {
    console.error("generate-study-content error:", e);
    try {
      const body = await req
        .clone()
        .json()
        .catch(() => ({}));
      if (body.jobId) {
        const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
        await updateJob(sb, body.jobId, {
          status: "error",
          error: e.message || "Errore sconosciuto",
          completed_at: new Date().toISOString(),
        });
      }
    } catch {}
    return new Response(JSON.stringify({ error: e.message || "Unknown error" }), {
      status: e.status || 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
