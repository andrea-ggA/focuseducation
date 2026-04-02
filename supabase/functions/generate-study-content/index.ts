import { serve } from "https://deno.land/std@0.220.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ═══════════════════════════════════════════════════════════════════════════════
// TEXT CLEANING
// Rimuove artefatti PDF che causano "domande false" (numeri di pagina,
// intestazioni ripetute, ligature Unicode, trattini a fine riga, ecc.)
// ═══════════════════════════════════════════════════════════════════════════════
function cleanText(raw: string): string {
  return raw
    // Ligature Unicode comuni nei PDF (ﬁne → fine, ﬀort → ffort, ecc.)
    .replace(/ﬁ/g, "fi").replace(/ﬂ/g, "fl").replace(/ﬀ/g, "ff")
    .replace(/ﬃ/g, "ffi").replace(/ﬄ/g, "ffl").replace(/ﬅ/g, "st")
    // Parola spezzata a fine riga: "infor-\nmatica" → "informatica"
    .replace(/-\n(\S)/g, "$1")
    // Numeri di pagina isolati: "\n47\n", "\nPage 12\n"
    .replace(/\n\s*(?:Page|Pagina|Pag\.?|p\.)\s*\d+\s*\n/gi, "\n")
    .replace(/\n\s*\d{1,4}\s*\n/g, "\n")
    // Caratteri di controllo e replacement character (PDF mal codificato)
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, " ")
    .replace(/\uFFFD/g, " ")
    .replace(/[\u200B-\u200F]/g, "")   // zero-width spaces
    .replace(/\u00AD/g, "")            // soft hyphen
    // Sequenze di punteggiatura garbage
    .replace(/\.{4,}/g, "…")
    .replace(/-{3,}/g, "—")
    .replace(/_{3,}/g, " ")
    // Whitespace
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n").map((l: string) => l.trim()).join("\n")
    .trim();
}

/**
 * Rimuove righe che sono quasi certamente artefatti (header, footer, num. pagina).
 * Tecnica: righe corte (≤40 chars) che appaiono ≥3 volte nel documento
 * sono probabilmente intestazioni o piè di pagina ripetuti.
 */
function removePageArtifacts(text: string): string {
  const lines = text.split("\n");

  // Conta frequenza delle righe corte
  const freq = new Map<string, number>();
  for (const line of lines) {
    const t = line.trim();
    if (t.length > 0 && t.length <= 50) freq.set(t, (freq.get(t) || 0) + 1);
  }

  const artifacts = new Set<string>();
  for (const [line, count] of freq.entries()) {
    if (count >= 3) artifacts.add(line); // ripetuto ≥3 volte = artefatto
  }

  return lines.filter(line => {
    const t = line.trim();
    if (artifacts.has(t)) return false;
    if (/^(?:Pagina?\.?\s*)?\d{1,4}$/.test(t)) return false;          // numero di pagina
    if (/^[|=\-_.•◦▪▸►●○]{4,}$/.test(t)) return false;              // riga di simboli
    if (/^https?:\/\/\S+$/.test(t)) return false;                     // URL isolato
    return true;
  }).join("\n");
}

// ═══════════════════════════════════════════════════════════════════════════════
// CHUNKING A CONFINI DI FRASE
// Elimina la causa principale dei "caratteri falsi": domande generate su frasi
// troncate a metà. Ogni chunk termina a un punto fermo, a capo o paragrafo.
// Overlap di 800 chars tra chunk consecutivi per mantenere il contesto.
// ═══════════════════════════════════════════════════════════════════════════════
function chunkBySentences(text: string, maxChars = 28_000, overlap = 800): string[] {
  if (text.length <= maxChars) return [text];

  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    let end = Math.min(start + maxChars, text.length);

    if (end < text.length) {
      const segment = text.substring(start, end);

      // 1. Fine paragrafo (doppio a capo)
      const lastDouble = segment.lastIndexOf("\n\n");
      if (lastDouble > maxChars * 0.55) {
        end = start + lastDouble + 2;
      } else {
        // 2. Fine frase: trova l'ULTIMO ". " / "! " / "? " nel segmento
        let lastSentence = -1;
        const re = /[.!?]\s+/g;
        let m;
        while ((m = re.exec(segment)) !== null) {
          if (m.index > maxChars * 0.45) lastSentence = m.index + m[0].length;
        }
        if (lastSentence > 0) {
          end = start + lastSentence;
        } else {
          // 3. Fallback: ultimo spazio (non taglia a metà parola)
          const lastSpace = segment.lastIndexOf(" ");
          if (lastSpace > maxChars * 0.65) end = start + lastSpace + 1;
        }
      }
    }

    const chunk = text.substring(start, end).trim();
    if (chunk.length > 100) chunks.push(chunk);

    if (end >= text.length) break;

    // Avanza con overlap per mantenere contesto tra chunk,
    // evitando loop quasi infiniti sugli ultimi caratteri.
    const nextStart = Math.max(0, end - overlap);
    start = nextStart <= start ? end : nextStart;
  }

  return chunks;
}

// ═══════════════════════════════════════════════════════════════════════════════
// PARALLEL EXECUTION
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
// AI CALL — retry con backoff esponenziale
// ═══════════════════════════════════════════════════════════════════════════════
async function callAI(
  apiKey: string, messages: any[], model = "gemini-2.5-flash",
  retries = 3, maxTokens = 16000,
): Promise<any> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model, messages, max_tokens: maxTokens }),
      });
      if (!res.ok) {
        const t = await res.text();
        console.error(`AI error (attempt ${attempt + 1}):`, res.status, t.substring(0, 150));
        if (res.status === 429) {
          if (attempt < retries) { await sleep(3000 * (attempt + 1)); continue; }
          throw { status: 429, message: "Rate limit. Riprova tra poco." };
        }
        if (res.status === 402) throw { status: 402, message: "Crediti AI esauriti." };
        if (attempt < retries) { await sleep(2000 * (attempt + 1)); continue; }
        throw new Error("AI generation failed: " + res.status);
      }
      return await res.json();
    } catch (e: any) {
      if (e.status === 402 || e.status === 429) throw e;
      console.error(`AI network error (attempt ${attempt + 1}):`, e.message || e);
      if (attempt < retries) { await sleep(2000 * (attempt + 1)); continue; }
      throw e;
    }
  }
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function updateJob(
  supabase: ReturnType<typeof createClient>,
  jobId: string | undefined,
  updates: Record<string, unknown>,
) {
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

  const { error: fallbackError } = await supabase.from("generation_jobs").update(fallback).eq("id", jobId);
  if (fallbackError) console.warn("generation_jobs fallback update failed:", fallbackError.message);
}

// ═══════════════════════════════════════════════════════════════════════════════
// JSON EXTRACTION — con partial recovery
// ═══════════════════════════════════════════════════════════════════════════════
function extractJsonFromText(text: string): any {
  let cleaned = text.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
  const start = cleaned.search(/[\{\[]/);
  if (start === -1) throw new Error("No JSON found");
  const isArray = cleaned[start] === "[";
  const end = cleaned.lastIndexOf(isArray ? "]" : "}");
  if (end === -1) throw new Error("No JSON end found");
  cleaned = cleaned.substring(start, end + 1);

  try { return JSON.parse(cleaned); } catch {}
  const basic = cleaned
    .replace(/,\s*}/g, "}").replace(/,\s*]/g, "]")
    .replace(/[\x00-\x1F\x7F]/g, "")
    .replace(/\\(?!["\\/bfnrtu])/g, "\\\\");
  try { return JSON.parse(basic); } catch {}

  // Partial recovery
  const itemKey       = cleaned.includes('"question"') ? "question" : "front";
  const collectionKey = cleaned.includes('"questions"') ? "questions" : "cards";
  const titleMatch    = cleaned.match(/"title"\s*:\s*"([^"]+)"/);
  const arrayStart    = cleaned.indexOf("[");
  if (arrayStart === -1) throw new Error("Cannot recover JSON");

  const items: any[] = [];
  let depth = 0, objStart = -1;
  const arr = cleaned.substring(arrayStart + 1);
  for (let i = 0; i < arr.length; i++) {
    if (arr[i] === "{") { if (depth === 0) objStart = i; depth++; }
    else if (arr[i] === "}") {
      depth--;
      if (depth === 0 && objStart !== -1) {
        try { const o = JSON.parse(arr.substring(objStart, i + 1)); if (o[itemKey]) items.push(o); } catch {}
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
// BALANCE CORRECT ANSWERS — A/B/C/D distribuiti uniformemente
// ═══════════════════════════════════════════════════════════════════════════════
function balanceCorrectAnswers(rows: any[]): any[] {
  if (rows.length <= 1) return rows;
  const counts = [0, 0, 0, 0];
  rows.forEach(r => { if (r.correct_answer >= 0 && r.correct_answer <= 3) counts[r.correct_answer]++; });
  const maxPerSlot = Math.ceil(rows.length / 4) + 1;

  for (let i = 0; i < rows.length; i++) {
    const curr = rows[i].correct_answer;
    if (counts[curr] <= maxPerSlot) continue;
    const target = counts.indexOf(Math.min(...counts));
    if (target === curr || target < 0 || target > 3) continue;
    const opts = [...rows[i].options];
    [opts[curr], opts[target]] = [opts[target], opts[curr]];
    rows[i] = { ...rows[i], options: opts, correct_answer: target };
    counts[curr]--; counts[target]++;
  }
  for (let i = 1; i < rows.length; i++) {
    if (rows[i].correct_answer !== rows[i - 1].correct_answer) continue;
    const isTriple = i >= 2 && rows[i - 2].correct_answer === rows[i].correct_answer;
    if (!isTriple && Math.random() > 0.5) continue;
    const curr      = rows[i].correct_answer;
    const candidates = [0, 1, 2, 3].filter(s => s !== curr && counts[s] <= maxPerSlot);
    if (!candidates.length) continue;
    const target = candidates[Math.floor(Math.random() * candidates.length)];
    const opts = [...rows[i].options];
    [opts[curr], opts[target]] = [opts[target], opts[curr]];
    rows[i] = { ...rows[i], options: opts, correct_answer: target };
    counts[curr]--; counts[target]++;
  }
  return rows;
}

// ═══════════════════════════════════════════════════════════════════════════════
// DEDUPLICATION — semantica, ignora parole comuni
// ═══════════════════════════════════════════════════════════════════════════════
function deduplicateItems<T extends Record<string, any>>(items: T[], key: string): T[] {
  const seen = new Set<string>();
  const stop = new Set(["il","la","lo","le","gli","un","una","dei","delle","degli",
    "che","non","per","con","del","della","and","the","of","in","to","a","is","are",
    "di","da","su","al","nel","nella","dal","dalla","come","quando","perché"]);

  return items.filter(item => {
    const sig = String(item[key] || "").toLowerCase()
      .replace(/[^\w\s]/g, " ").split(/\s+/)
      .filter(w => w.length > 2 && !stop.has(w))
      .sort().slice(0, 8).join("|");
    if (seen.has(sig)) return false;
    seen.add(sig);
    return true;
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// LANGUAGE DETECTION — euristica veloce (no AI), AI solo come fallback
// ═══════════════════════════════════════════════════════════════════════════════
const LANG_SIGNATURES: Record<string, string[]> = {
  italiano: ["della","delle","degli","nella","sono","anche","questo","questa","come","quando","però","quindi","tuttavia"],
  english:  ["the","and","that","this","with","from","they","their","have","been","which","would","could"],
  español:  ["que","una","para","con","por","los","las","del","este","esta","como","también","pero"],
  français: ["les","des","une","pour","dans","avec","sur","par","mais","comme","cette","aussi","plus"],
  deutsch:  ["die","der","das","und","ist","mit","von","ein","eine","auch","nicht","werden","haben"],
};

function detectLanguageHeuristic(sample: string): string {
  const words   = sample.toLowerCase().split(/\s+/).slice(0, 200);
  const wordSet = new Set(words);
  let bestLang  = "";
  let bestScore = 0;
  for (const [lang, sigs] of Object.entries(LANG_SIGNATURES)) {
    const score = sigs.filter(w => wordSet.has(w)).length;
    if (score > bestScore) { bestScore = score; bestLang = lang; }
  }
  return bestScore >= 4 ? bestLang : ""; // richiede ≥4 parole firma per essere sicuri
}

// ═══════════════════════════════════════════════════════════════════════════════
// TOPIC OUTLINE EXTRACTION
// ═══════════════════════════════════════════════════════════════════════════════
async function extractTopicOutline(apiKey: string, text: string, language: string): Promise<string[]> {
  const sample   = text.substring(0, 20_000); // campione più ampio per migliore struttura
  const langNote = language === "italiano"
    ? "Rispondi SOLO in italiano."
    : `Respond in ${language}.`;

  try {
    const data = await callAI(apiKey, [
      { role: "system", content: `You are an expert academic content analyst. ${langNote}` },
      { role: "user", content: `Analyze this academic text and identify the 5 to 15 MAIN topics/chapters.

RULES:
- Each topic: BROAD chapter-level concept (2-5 words max).
- MUTUALLY EXCLUSIVE (no overlaps). CLEAR academic terminology.
- Order by appearance. IGNORE: page numbers, headers, bibliography, URLs.

Return ONLY a JSON array. Example: ["Cell Biology", "DNA Replication"]

--- TEXT ---
${sample}
--- END ---
JSON array only.` },
    ], "gemini-2.5-flash", 2, 1500);

    const txt = data.choices?.[0]?.message?.content || "";
    const cl  = txt.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
    const s   = cl.indexOf("["), e = cl.lastIndexOf("]");
    if (s !== -1 && e !== -1) {
      const topics = JSON.parse(cl.substring(s, e + 1));
      if (Array.isArray(topics) && topics.length > 0) {
        console.log(`Topics (${topics.length}): ${topics.join(", ")}`);
        return topics.slice(0, 20);
      }
    }
  } catch (e: any) { console.warn("Topic outline failed:", e.message); }
  return [];
}

// ═══════════════════════════════════════════════════════════════════════════════
// TOPIC CONSOLIDATION
// ═══════════════════════════════════════════════════════════════════════════════
function normCmp(s: string) { return s.toLowerCase().replace(/[^a-zà-ÿ0-9\s]/g, "").replace(/\s+/g, " ").trim(); }
function overlap(a: string, b: string) {
  const wa = normCmp(a).split(" "), wb = normCmp(b).split(" ");
  const sb = new Set(wb);
  const shared = wa.filter(w => w.length > 2 && sb.has(w)).length;
  const union  = new Set([...wa, ...wb]).size;
  return union > 0 ? shared / union : 0;
}

function consolidateTopics<T extends Record<string, any>>(items: T[], outline: string[] = [], max = 18): T[] {
  if (!items.length) return items;
  if (outline.length > 0) {
    items = items.map((item: T) => {
      const t = (item.topic || "Generale").trim();
      if (outline.find(ot => normCmp(ot) === normCmp(t))) return item;
      let best = "", bestScore = 0;
      for (const ot of outline) {
        const s = overlap(t, ot);
        if (s > bestScore) { bestScore = s; best = ot; }
      }
      if (bestScore < 0.15) {
        for (const ot of outline) {
          if (normCmp(t).includes(normCmp(ot)) || normCmp(ot).includes(normCmp(t))) {
            best = ot; bestScore = 0.5; break;
          }
        }
      }
      return bestScore >= 0.15 ? { ...item, topic: best } : item;
    });
  }
  const freq = new Map<string, number>();
  items.forEach((i: T) => { const t = (i.topic||"Generale").trim(); freq.set(t,(freq.get(t)||0)+1); });
  if (freq.size <= max) return items;
  const sorted  = [...freq.entries()].sort((a,b)=>b[1]-a[1]);
  const kept    = sorted.slice(0, max);
  const mapping = new Map<string, string>();
  for (const [topic] of sorted.slice(max)) {
    let best = kept[0][0], bestS = 0;
    for (const [kt] of kept) { const s=overlap(topic,kt); if(s>bestS){bestS=s;best=kt;} }
    if (bestS < 0.1) for (const [kt] of kept) {
      if (normCmp(topic).includes(normCmp(kt)) || normCmp(kt).includes(normCmp(topic))) { best=kt; break; }
    }
    mapping.set(topic, best);
  }
  console.log(`Consolidation: ${freq.size} → ${kept.length} topics`);
  return items.map((i: T) => { const t=(i.topic||"Generale").trim(); return mapping.has(t)?{...i,topic:mapping.get(t)}:i; });
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN HANDLER
// ═══════════════════════════════════════════════════════════════════════════════
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing authorization");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabase    = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const anonClient  = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user: authUser }, error: authError } = await anonClient.auth.getUser();
    if (authError || !authUser) throw new Error("Unauthorized");
    const user = { id: authUser.id };

    const { data: allowed } = await supabase.rpc("check_and_increment_rate_limit", {
      _user_id: user.id, _max_per_min: 5,
    });
    if (allowed === false) {
      return new Response(JSON.stringify({ error: "Troppe richieste. Attendi un minuto." }), {
        status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { content, type, documentId, title, jobId, images, asyncMode, internalRun } = await req.json();
    const hasImages = Array.isArray(images) && images.length > 0;
    console.log(`[gen] type=${type} len=${content?.length||0} imgs=${hasImages?images.length:0} job=${jobId||"none"}`);

    if (!content && !hasImages) throw new Error("Missing content or images");
    if (!type) throw new Error("Missing type");

    // ── Async mode ────────────────────────────────────────────────────────────
    if (asyncMode && !internalRun) {
      await updateJob(supabase, jobId, {
        status: "processing", progress_message: "Avvio in background…",
      });

      (globalThis as any).EdgeRuntime?.waitUntil((async () => {
        try {
          const r = await fetch(`${supabaseUrl}/functions/v1/generate-study-content`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: authHeader, apikey: Deno.env.get("SUPABASE_ANON_KEY")! },
            body: JSON.stringify({ content, type, documentId, title, jobId, images, asyncMode: false, internalRun: true }),
          });
          if (!r.ok) await updateJob(supabase, jobId, {
            status: "error", error: `Errore avvio (${r.status})`, completed_at: new Date().toISOString(),
          });
        } catch (err: any) {
          await updateJob(supabase, jobId, {
            status: "error", error: err?.message || "Errore", completed_at: new Date().toISOString(),
          });
        }
      })());

      return new Response(JSON.stringify({ success: true, accepted: true, jobId }), {
        status: 202, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (content && typeof content !== "string") throw new Error("Content must be a string");

    // ── Pulizia testo ─────────────────────────────────────────────────────────
    const cleanedContent = content ? removePageArtifacts(cleanText(content)) : "";
    const cleanedLen     = cleanedContent.length;
    if (content) console.log(`Clean: ${content.length} → ${cleanedLen} (-${content.length - cleanedLen} artefatti)`);

    if (!hasImages && cleanedLen < 50)
      return new Response(JSON.stringify({ error: "Contenuto troppo corto" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    if (cleanedLen > 2_000_000)  // limite aumentato 500KB → 2MB
      return new Response(JSON.stringify({ error: "Contenuto troppo grande (max 2MB)" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    if (!["quiz", "quiz_gamified", "flashcards"].includes(type))
      return new Response(JSON.stringify({ error: "Tipo non valido" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const GEMINI_API_KEY = Deno.env.get("GOOGLE_GEMINI_API_KEY");
    if (!GEMINI_API_KEY) throw new Error("GOOGLE_GEMINI_API_KEY not configured");

    await updateJob(supabase, jobId, { status: "processing" });

    // ═════════════════════════════════════════════════════════════════════════
    // PATH IMMAGINI
    // ═════════════════════════════════════════════════════════════════════════
    if (hasImages) {
      await updateJob(supabase, jobId, { progress_message: "Analisi immagini…" });
      const N    = 20;
      const lang = "Genera nella lingua del testo visibile. Default: italiano.";
      const isQuiz = type !== "flashcards";

      const prompt = isQuiz
        ? `Analizza le immagini e genera ${N} domande a risposta multipla.
REGOLE: Solo contenuto effettivamente visibile. IGNORA: numeri pagina, intestazioni, URL, bibliografie.
4 opzioni per domanda. correct_answer 0-3 distribuito. explanation max 120 chars. topic max 4 parole.
Mix: facile 10pts/15s, medio 20pts/30s, difficile 30pts/45s.${type==="quiz_gamified"?" ADHD: domande brevi, dirette.":""}
${cleanedContent?`\nTesto extra:\n${cleanedContent.substring(0,12000)}`:""}
Output: {"title":"...","questions":[{"question":"...","options":["A","B","C","D"],"correct_answer":0,"explanation":"...","topic":"...","points":10,"time_limit_seconds":30}]}
${lang} ESATTAMENTE ${N} domande. SOLO JSON.`
        : `Analizza le immagini e genera ${N} flashcard.
REGOLE: Solo contenuto effettivamente visibile. IGNORA: numeri pagina, intestazioni, URL, bibliografie.
front max 110 chars. back max 190 chars. topic max 4 parole. difficulty easy/medium/hard.
${cleanedContent?`\nTesto extra:\n${cleanedContent.substring(0,12000)}`:""}
Output: {"title":"...","cards":[{"front":"...","back":"...","topic":"...","difficulty":"medium"}]}
${lang} ESATTAMENTE ${N} flashcard. SOLO JSON.`;

      const parts: any[] = [{ type:"text", text:prompt }];
      for (const url of images) parts.push({ type:"image_url", image_url:{ url } });

      const aiData      = await callAI(GEMINI_API_KEY, [
        { role:"system", content:`Professional academic educator. ${lang}` },
        { role:"user",   content:parts },
      ], "gemini-2.5-flash", 3, 16000);

      const parsed = extractJsonFromText(aiData.choices?.[0]?.message?.content || "");
      const genTitle = parsed.title || title || "Foto appunti";
      let resultId = "", totalItems = 0;

      if (isQuiz) {
        const finalQ = deduplicateItems(parsed.questions || [], "question");
        if (!finalQ.length) throw new Error("Nessuna domanda generata.");
        const topics = [...new Set(finalQ.map((q:any)=>q.topic).filter(Boolean))];
        const { data:quiz, error:qErr } = await supabase.from("quizzes").insert({
          user_id:user.id, document_id:documentId||null, title:genTitle,
          quiz_type:type==="quiz_gamified"?"gamified_adhd":"standard",
          total_questions:finalQ.length, topic:topics.slice(0,10).join(", "),
        }).select("id").single();
        if (qErr) throw qErr;
        const rows = finalQ.map((q:any,i:number)=>{
          const opts=[...(q.options||[])]; const ct=opts[q.correct_answer??0];
          for(let j=opts.length-1;j>0;j--){const k=Math.floor(Math.random()*(j+1));[opts[j],opts[k]]=[opts[k],opts[j]];}
          return{quiz_id:quiz.id,question:q.question,options:opts,correct_answer:opts.indexOf(ct),
            explanation:q.explanation||"",topic:q.topic||"Generale",points:q.points||10,
            time_limit_seconds:q.time_limit_seconds||30,sort_order:i,source_reference:null};
        });
        await supabase.from("quiz_questions").insert(balanceCorrectAnswers(rows));
        resultId=quiz.id; totalItems=rows.length;
      } else {
        const finalC = deduplicateItems(parsed.cards || [], "front");
        if (!finalC.length) throw new Error("Nessuna flashcard generata.");
        const topics = [...new Set(finalC.map((c:any)=>c.topic).filter(Boolean))];
        const { data:deck, error:dErr } = await supabase.from("flashcard_decks").insert({
          user_id:user.id, document_id:documentId||null, title:genTitle,
          card_count:finalC.length, topic:topics.slice(0,10).join(", "),
        }).select("id").single();
        if (dErr) throw dErr;
        await supabase.from("flashcards").insert(finalC.map((c:any,i:number)=>({
          deck_id:deck.id,front:c.front,back:c.back,topic:c.topic||"Generale",
          difficulty:c.difficulty||"medium",sort_order:i,source_reference:null,
        })));
        resultId=deck.id; totalItems=finalC.length;
      }

      await updateJob(supabase, jobId, {
        status:"completed", result_id:resultId, total_items:totalItems,
        completed_at:new Date().toISOString(), error:null,
      });

      return new Response(JSON.stringify(isQuiz
        ? {success:true,quiz_id:resultId,total_questions:totalItems,from_images:true}
        : {success:true,deck_id:resultId,total_cards:totalItems,from_images:true}),
        { headers:{...corsHeaders,"Content-Type":"application/json"} });
    }

    // ═════════════════════════════════════════════════════════════════════════
    // PATH TESTO — pipeline ottimizzato
    // ═════════════════════════════════════════════════════════════════════════

    await updateJob(supabase, jobId, {
      progress_message: "Analisi documento…",
    });

    // ── STEP 0: Language detection + Topic outline IN PARALLELO ──────────────
    // Risparmio: ~4-6 secondi rispetto all'esecuzione sequenziale precedente.
    const heuristicLang = detectLanguageHeuristic(cleanedContent.substring(0, 1000));
    console.log(`Lang heuristic: "${heuristicLang || "inconclusive — using AI"}"`);

    const [docLanguage, topicOutline] = await Promise.all([
      heuristicLang
        ? Promise.resolve(heuristicLang)
        : callAI(GEMINI_API_KEY,
            [{ role:"user", content:`Detect language. ONE word only (italiano/english/español/français/deutsch). Text: "${cleanedContent.substring(0,400)}"` }],
            "gemini-2.5-flash", 2, 15,
          ).then(d => {
            const det = d.choices?.[0]?.message?.content?.trim().toLowerCase() || "";
            return det && det.length < 25 ? det : "italiano";
          }).catch(() => "italiano"),
      extractTopicOutline(GEMINI_API_KEY, cleanedContent, heuristicLang || "italiano"),
    ]);

    console.log(`Language: ${docLanguage}, Topics: ${topicOutline.length}`);

    const langInstruction = docLanguage === "italiano"
      ? "Genera TUTTO il contenuto in italiano."
      : `Generate ALL content in ${docLanguage}. Do NOT translate.`;

    const topicInstruction = topicOutline.length > 0
      ? `\nAVAILABLE TOPICS — assign EVERY item to one of these ONLY: ${JSON.stringify(topicOutline)}\nDo NOT invent new topic names.`
      : "";

    // ── STEP 1: Chunking a confini di frase ───────────────────────────────────
    // 28000 chars/chunk (+55% vs 4500 parole prima), overlap 800 chars
    // MAX_CHUNKS 20 (era 12), CONCURRENCY 6 (era 3)
    const MAX_CHARS    = 28_000;
    const OVERLAP      = 800;
    const MAX_CHUNKS   = 20;
    const CONCURRENCY  = 6;
    const ITEMS_PER_CHUNK = 30; // era 25 max

    const allChunks     = chunkBySentences(cleanedContent, MAX_CHARS, OVERLAP);
    const nChunks       = Math.min(allChunks.length, MAX_CHUNKS);
    const chunks        = allChunks.slice(0, nChunks);
    const startTime     = Date.now();

    console.log(`Chunks: ${allChunks.length} total → processing ${nChunks} at concurrency ${CONCURRENCY}`);

    const allQuestions: any[] = [];
    const allCards:     any[] = [];
    let generatedTitle = title || "Studio";
    let completedCount = 0;

    const chunkTasks = chunks.map((chunk, idx) => async () => {
      const isFirst  = idx === 0;
      const chunkNum = idx + 1;
      const isQ      = type !== "flashcards";

      const systemMsg = `You are a professional academic ${isQ?"examiner":"educator"}. Extract EVERY important concept. Generate EXACTLY ${ITEMS_PER_CHUNK} ${isQ?"questions":"flashcards"}. Respond ONLY with valid JSON. ${langInstruction}`;

      const prompt = isQ
        ? `Generate EXACTLY ${ITEMS_PER_CHUNK} multiple-choice questions from fragment ${chunkNum}/${nChunks}.

CRITICAL RULES:
1. Questions based ONLY on THIS fragment's content.
2. IGNORE: page numbers, headers, footers, bibliography, figure captions, URLs, references like "Fig. 3.2".
3. 4 plausible options of similar length each.
4. correct_answer: index 0-3, distribute evenly (≈25% each).
5. explanation: WHY correct (max 120 chars).
6. topic: BROAD chapter concept (max 4 words).${topicInstruction}
7. Mix: easy 25% (10pts/15s), medium 40% (20pts/30s), hard 35% (30pts/45s).
8. Cover: definitions, relationships, cause-effect, applications, comparisons.
9. Never repeat questions from other fragments.${type==="quiz_gamified"?"\n10. ADHD: short, punchy, direct.":""}

${isFirst?`Output: {"title":"descriptive title","questions":[...]}`:`Output: {"questions":[...]}`}
Each: {"question":"...","options":["A","B","C","D"],"correct_answer":0,"explanation":"...","topic":"...","points":10,"time_limit_seconds":30}

--- FRAGMENT ${chunkNum}/${nChunks} ---
${chunk}
--- END ---
EXACTLY ${ITEMS_PER_CHUNK} questions. ONLY valid JSON.`

        : `Generate EXACTLY ${ITEMS_PER_CHUNK} flashcards from fragment ${chunkNum}/${nChunks}.

CRITICAL RULES:
1. Flashcards based ONLY on THIS fragment's content.
2. IGNORE: page numbers, headers, footers, bibliography, figure captions, URLs.
3. front: clear question/concept prompt (max 110 chars).
4. back: complete answer with key details (max 190 chars).
5. topic: BROAD chapter concept (max 4 words).${topicInstruction}
6. difficulty: easy (~25%), medium (~40%), hard (~35%).
7. Cover: definitions, key concepts, cause-effect, comparisons, applications.
8. Never repeat flashcards from other fragments.

${isFirst?`Output: {"title":"descriptive title","cards":[...]}`:`Output: {"cards":[...]}`}
Each: {"front":"...","back":"...","topic":"...","difficulty":"medium"}

--- FRAGMENT ${chunkNum}/${nChunks} ---
${chunk}
--- END ---
EXACTLY ${ITEMS_PER_CHUNK} flashcards. ONLY valid JSON.`;

      try {
        const aiData = await callAI(GEMINI_API_KEY,
          [{ role:"system", content:systemMsg }, { role:"user", content:prompt }],
          "gemini-2.5-flash", 3, 16000);

        const txt = aiData.choices?.[0]?.message?.content || "";
        if (!txt) { console.warn(`Chunk ${chunkNum}: empty`); return { chunkNum, title:null, questions:[], cards:[] }; }

        const parsed     = extractJsonFromText(txt);
        const chunkTitle = isFirst && parsed.title ? parsed.title : null;

        if (!isQ) {
          const cards = parsed.cards || parsed.questions || [];
          console.log(`Chunk ${chunkNum}/${nChunks}: +${cards.length} cards`);
          return { chunkNum, title:chunkTitle, questions:[], cards };
        } else {
          const qs = parsed.questions || [];
          console.log(`Chunk ${chunkNum}/${nChunks}: +${qs.length} questions`);
          return { chunkNum, title:chunkTitle, questions:qs, cards:[] };
        }
      } catch (err: any) {
        console.error(`Chunk ${chunkNum} failed:`, err.message || err);
        return { chunkNum, title:null, questions:[], cards:[] };
      }
    });

    // Progress bar mentre i chunk vengono elaborati
    let progressInterval: ReturnType<typeof setInterval>|null = null;
    if (jobId) {
      progressInterval = setInterval(async () => {
        try {
          const soFar   = type === "flashcards" ? allCards.length : allQuestions.length;
          const elapsed = Date.now() - startTime;
          const etaMs   = completedCount > 0
            ? Math.round((elapsed / completedCount) * (nChunks - completedCount)) : null;
          const eta     = etaMs ? ` · ~${Math.max(1, Math.ceil(etaMs/1000))}s` : "";
          await updateJob(supabase, jobId, {
            total_items:      soFar,
            progress_message: `Sezione ${Math.min(completedCount+1,nChunks)} di ${nChunks}… ${soFar} elementi${eta}`,
            progress_pct:     Math.round((completedCount / nChunks) * 100),
          });
        } catch { /* non critico */ }
      }, 2500);
    }

    const wrappedTasks = chunkTasks.map(fn => async () => { const r = await fn(); completedCount++; return r; });
    const results      = await parallelLimit(wrappedTasks, CONCURRENCY);
    if (progressInterval) clearInterval(progressInterval);

    for (const r of results) {
      if (r.title && generatedTitle === (title||"Studio")) generatedTitle = r.title;
      allQuestions.push(...r.questions);
      allCards.push(...r.cards);
    }

    const elapsed = Math.round((Date.now() - startTime) / 1000);
    console.log(`Done: ${elapsed}s · ${allQuestions.length} questions · ${allCards.length} cards`);

    // ── STEP 3: Dedup + consolidazione ────────────────────────────────────────
    const dedupQ = deduplicateItems(allQuestions, "question");
    const dedupC = deduplicateItems(allCards, "front");
    if (allQuestions.length - dedupQ.length > 0) console.log(`Dedup Q: -${allQuestions.length-dedupQ.length}`);
    if (allCards.length - dedupC.length > 0)     console.log(`Dedup C: -${allCards.length-dedupC.length}`);

    const finalQ = consolidateTopics(dedupQ, topicOutline, 18);
    const finalC = consolidateTopics(dedupC, topicOutline, 18);

    // ── STEP 4: Salva ─────────────────────────────────────────────────────────
    let resultId = "", totalItems = 0;

    if (type !== "flashcards") {
      if (!finalQ.length) throw new Error("Nessuna domanda generata. Riprova.");
      const topics = [...new Set(finalQ.map((q:any)=>q.topic).filter(Boolean))];
      const { data:quiz, error:qErr } = await supabase.from("quizzes").insert({
        user_id:user.id, document_id:documentId||null, title:generatedTitle,
        quiz_type:type==="quiz_gamified"?"gamified_adhd":"standard",
        total_questions:finalQ.length, topic:topics.slice(0,10).join(", "),
      }).select("id").single();
      if (qErr) throw qErr;

      const rows = finalQ.map((q:any,i:number)=>{
        const opts=[...(q.options||[])];
        const ct=opts[typeof q.correct_answer==="number"?q.correct_answer:0];
        for(let j=opts.length-1;j>0;j--){const k=Math.floor(Math.random()*(j+1));[opts[j],opts[k]]=[opts[k],opts[j]];}
        return{quiz_id:quiz.id,question:q.question,options:opts,correct_answer:opts.indexOf(ct),
          explanation:q.explanation||"",topic:q.topic||"Generale",points:q.points||10,
          time_limit_seconds:q.time_limit_seconds||30,sort_order:i,
          source_reference:q.source_context||q.source_reference||null};
      });

      const balanced = balanceCorrectAnswers(rows);
      for (let i = 0; i < balanced.length; i += 100) {
        const { error } = await supabase.from("quiz_questions").insert(balanced.slice(i, i+100));
        if (error) throw error;
      }
      resultId=quiz.id; totalItems=balanced.length;
      console.log(`Quiz: ${quiz.id} · ${balanced.length} questions · ${topics.length} topics`);
    } else {
      if (!finalC.length) throw new Error("Nessuna flashcard generata. Riprova.");
      const topics = [...new Set(finalC.map((c:any)=>c.topic).filter(Boolean))];
      const { data:deck, error:dErr } = await supabase.from("flashcard_decks").insert({
        user_id:user.id, document_id:documentId||null, title:generatedTitle,
        card_count:finalC.length, topic:topics.slice(0,10).join(", "),
      }).select("id").single();
      if (dErr) throw dErr;

      const rows = finalC.map((c:any,i:number)=>({
        deck_id:deck.id,front:c.front,back:c.back,topic:c.topic||"Generale",
        difficulty:c.difficulty||"medium",sort_order:i,
        source_reference:c.source_context||c.source_reference||null,
      }));
      for (let i = 0; i < rows.length; i += 100) {
        const { error } = await supabase.from("flashcards").insert(rows.slice(i, i+100));
        if (error) throw error;
      }
      resultId=deck.id; totalItems=rows.length;
      console.log(`Deck: ${deck.id} · ${rows.length} cards`);
    }

    await updateJob(supabase, jobId, {
      status:"completed", result_id:resultId, total_items:totalItems,
      completed_at:new Date().toISOString(), error:null, progress_pct:100, progress_message:null,
    });

    return new Response(JSON.stringify(type==="flashcards"
      ? {success:true,deck_id:resultId,total_cards:totalItems,chunks_processed:nChunks,elapsed_seconds:elapsed}
      : {success:true,quiz_id:resultId,total_questions:totalItems,chunks_processed:nChunks,elapsed_seconds:elapsed}),
      { headers:{...corsHeaders,"Content-Type":"application/json"} });

  } catch (e: any) {
    console.error("generate-study-content error:", e);
    try {
      const body = await req.clone().json().catch(() => ({}));
      if (body.jobId) {
        const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
        await updateJob(sb, body.jobId, {
          status:"error", error:e.message||"Errore sconosciuto", completed_at:new Date().toISOString(),
        });
      }
    } catch {}
    return new Response(JSON.stringify({ error: e.message||"Unknown error" }), {
      status: e.status||500, headers:{...corsHeaders,"Content-Type":"application/json"},
    });
  }
});
