import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { cleanText, removePageArtifacts, chunkBySentences, detectLanguageHeuristic, parallelLimit } from "../_shared/textUtils.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

interface ErrorWithStatus {
  status?: number;
}

type ChatRole = "system" | "user" | "assistant";
type ChatVisionPart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };
type ChatMessage = { role: ChatRole; content: string | ChatVisionPart[] };

const getErrorMessage = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback;

async function callAI(apiKey: string, messages: ChatMessage[], model = "gemini-2.5-flash", retries = 3, maxTokens = 65536): Promise<Record<string, unknown>> {
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
        if (res.status === 429 && attempt < retries) { await sleep(3000 * (attempt + 1)); continue; }
        if (res.status === 402) throw { status: 402, message: "Crediti AI esauriti." };
        if (attempt < retries) { await sleep(2000 * (attempt + 1)); continue; }
        throw new Error("AI generation failed: " + res.status);
      }
      return await res.json() as Record<string, unknown>;
    } catch (e: unknown) {
      const errorWithStatus = e as ErrorWithStatus;
      if (errorWithStatus.status === 402) throw e;
      if (attempt < retries) { await sleep(2000 * (attempt + 1)); continue; }
      throw e;
    }
  }
  throw new Error("AI request failed");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing authorization");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabase    = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const anonClient  = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });

    const { data: { user: authUser }, error: authError } = await anonClient.auth.getUser();
    if (authError || !authUser) throw new Error("Unauthorized");

    // Rate limiting: max 10 req/min per utente (protezione budget AI)
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );
    const { data: allowed } = await supabaseAdmin.rpc("check_and_increment_rate_limit", {
      _user_id: authUser.id, _max_per_min: 10,
    });
    if (allowed === false) {
      return new Response(JSON.stringify({ error: "Troppe richieste. Attendi un minuto." }), {
        status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verifica piano Hyperfocus Master (accetta anche lowercase/uppercase per fix PayPal)
    const { data: sub } = await supabase
      .from("subscriptions")
      .select("plan_name, status")
      .eq("user_id", authUser.id)
      .in("status", ["active", "trialing", "ACTIVE", "TRIALING"])
      .maybeSingle();

    if (!sub || sub.plan_name !== "Hyperfocus Master") {
      return new Response(JSON.stringify({ error: "Questa funzione è riservata al piano Hyperfocus Master." }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { content, format, title, images, jobId, asyncMode, internalRun } = await req.json();
    const hasImages = Array.isArray(images) && images.length > 0;

    if (!content && !hasImages) throw new Error("Missing content");
    if (!format || !["summary", "outline", "smart_notes"].includes(format)) throw new Error("Invalid format");

    // ── Async mode ────────────────────────────────────────────────────────────
    if (asyncMode && !internalRun) {
      if (jobId) await supabase.from("generation_jobs").update({
        status: "processing", progress_message: "Avvio in background…",
      }).eq("id", jobId);

      const edgeRuntime = globalThis as typeof globalThis & { EdgeRuntime?: { waitUntil?: (promise: Promise<unknown>) => void } };
      edgeRuntime.EdgeRuntime?.waitUntil?.((async () => {
        try {
          const r = await fetch(`${supabaseUrl}/functions/v1/generate-summary`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: authHeader, apikey: Deno.env.get("SUPABASE_ANON_KEY")! },
            body: JSON.stringify({ content, format, title, images, jobId, asyncMode: false, internalRun: true }),
          });
          if (!r.ok && jobId) await supabase.from("generation_jobs").update({
            status: "error", error: `Errore avvio (${r.status})`, completed_at: new Date().toISOString(),
          }).eq("id", jobId);
        } catch (err: unknown) {
          if (jobId) await supabase.from("generation_jobs").update({
            status: "error", error: getErrorMessage(err, "Errore"), completed_at: new Date().toISOString(),
          }).eq("id", jobId);
        }
      })());

      return new Response(JSON.stringify({ success: true, accepted: true, jobId }), {
        status: 202, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const GEMINI_API_KEY = Deno.env.get("GOOGLE_GEMINI_API_KEY");
    if (!GEMINI_API_KEY) throw new Error("GOOGLE_GEMINI_API_KEY not configured");

    if (jobId) await supabase.from("generation_jobs").update({ status: "processing" }).eq("id", jobId);

    // ── Pulizia testo ─────────────────────────────────────────────────────────
    const cleanedContent = content ? removePageArtifacts(cleanText(content)) : "";
    if (content) console.log(`Clean: ${content.length} → ${cleanedContent.length} chars`);

    // ── Prompt per formato ────────────────────────────────────────────────────
    const FORMAT_NAMES: Record<string, string> = {
      summary:     "RIASSUNTO STRUTTURATO",
      outline:     "SCHEMA GERARCHICO",
      smart_notes: "APPUNTI SMART",
    };

    const formatInstructions: Record<string, string> = {
      summary: `Genera un RIASSUNTO STRUTTURATO completo.
REGOLE:
1. Sezioni chiare con titoli markdown (## sezioni, ### sotto-sezioni).
2. Elenchi puntati per i dettagli importanti.
3. **Termini chiave** in grassetto.
4. Sezione finale "## Punti Chiave" con i 5-10 concetti più importanti.
5. ~30-40% della lunghezza originale. Mantieni precisione di dati, date, formule.
6. IGNORA: numeri di pagina, intestazioni, piè di pagina, URL, riferimenti bibliografici.`,

      outline: `Genera uno SCHEMA GERARCHICO completo.
REGOLE:
1. Struttura ad albero: # Titolo → ## Sezioni → ### Sotto-sezioni → - Punti chiave.
2. Ogni nodo: max 1-2 righe. **Concetti chiave** in grassetto.
3. Tutti gli argomenti trattati, in ordine logico/cronologico.
4. Sezione finale "## Concetti Trasversali" se ci sono temi che collegano sezioni.
5. IGNORA: numeri di pagina, intestazioni, piè di pagina, URL, riferimenti bibliografici.`,

      smart_notes: `Genera APPUNTI SMART organizzati.
REGOLE:
1. Sezioni per argomento (##). Per ogni argomento:
   📝 **Definizioni** — termini chiave precisi
   🔑 **Concetti chiave** — punti più importanti
   📐 **Formule/Regole** — in blocco codice se matematiche
   🔗 **Collegamenti** — relazioni con altri concetti
   ⚡ **Da ricordare** — mnemonici, punti critici per l'esame
2. **Grassetto** per tutto ciò che può essere oggetto d'esame.
3. Sezione finale "## 🎯 Riassunto Lampo" ultra-sintetico.
4. IGNORA: numeri di pagina, intestazioni, piè di pagina, URL, riferimenti bibliografici.`,
    };

    let finalContent = "";

    // ── PATH IMMAGINI ─────────────────────────────────────────────────────────
    if (hasImages && !cleanedContent) {
      if (jobId) await supabase.from("generation_jobs").update({ progress_message: "Analisi immagini…" }).eq("id", jobId);

      const parts: ChatVisionPart[] = [{ type: "text", text: `${formatInstructions[format]}\n\nAnalizza le immagini e genera il ${FORMAT_NAMES[format]}. IGNORA numeri di pagina, intestazioni, URL.\nGenera nella lingua del testo visibile. Default: italiano.` }];
      for (const url of images) parts.push({ type: "image_url", image_url: { url } });

      const aiData = await callAI(GEMINI_API_KEY, [
        { role: "system", content: "Expert academic educator. Generate structured study materials." },
        { role: "user", content: parts },
      ]);
      finalContent = aiData.choices?.[0]?.message?.content || "";
    }
    // ── PATH TESTO ────────────────────────────────────────────────────────────
    else {
      // Language detection + first chunk setup IN PARALLELO
      if (jobId) await supabase.from("generation_jobs").update({ progress_message: "Analisi documento…" }).eq("id", jobId);

      const heuristicLang = detectLanguageHeuristic(cleanedContent.substring(0, 1000));
      const docLanguage = heuristicLang || await callAI(GEMINI_API_KEY,
        [{ role: "user", content: `Detect language. ONE word only (italiano/english/español/français/deutsch). Text: "${cleanedContent.substring(0, 400)}"` }],
        "gemini-2.5-flash", 2, 15,
      ).then(d => d.choices?.[0]?.message?.content?.trim().toLowerCase() || "italiano").catch(() => "italiano");

      const langNote = docLanguage === "italiano"
        ? "Rispondi TUTTO in italiano."
        : `Respond entirely in ${docLanguage}.`;

      console.log(`Language: ${docLanguage}`);

      // Chunking a confini di frase (era word-based)
      // Summary: chunk più grandi (40k) perché il modello vede contesto maggiore
      const MAX_CHARS   = 40_000;
      const OVERLAP     = 1200; // overlap più ampio per continuità del riassunto
      const CONCURRENCY = 4;    // 4 chunk in parallelo per summary

      const chunks = chunkBySentences(cleanedContent, MAX_CHARS, OVERLAP);
      console.log(`Chunks: ${chunks.length} (concurrency ${CONCURRENCY})`);

      const systemPrompt = `You are an expert academic educator specializing in study materials. ${langNote}`;
      const startTime = Date.now();

      if (chunks.length === 1) {
        // Documento breve: una sola chiamata
        const aiData = await callAI(GEMINI_API_KEY, [
          { role: "system", content: systemPrompt },
          { role: "user", content: `${formatInstructions[format]}\n\n${langNote}\n\n--- TESTO ---\n${cleanedContent}\n--- FINE ---` },
        ]);
        finalContent = aiData.choices?.[0]?.message?.content || "";
      } else {
        // Documento lungo: chunk in PARALLELO (era sequenziale — grande speedup)
        let completedCount = 0;

        const chunkTasks = chunks.map((chunk, idx) => async () => {
          const chunkNum = idx + 1;
          const isFirst  = idx === 0;

          const chunkPrompt = isFirst
            ? `${formatInstructions[format]}\n\n${langNote}\n\nQuesto è il frammento ${chunkNum} di ${chunks.length}. Genera il ${FORMAT_NAMES[format]} per QUESTO frammento.\n\n--- TESTO (${chunkNum}/${chunks.length}) ---\n${chunk}\n--- FINE ---`
            : `Continua il ${FORMAT_NAMES[format]} per il frammento successivo. Stesso stile e formato del precedente.\n${langNote}\n\n--- TESTO (${chunkNum}/${chunks.length}) ---\n${chunk}\n--- FINE ---`;

          try {
            const aiData = await callAI(GEMINI_API_KEY, [
              { role: "system", content: systemPrompt },
              { role: "user", content: chunkPrompt },
            ]);
            const result = aiData.choices?.[0]?.message?.content || "";
            console.log(`Chunk ${chunkNum}/${chunks.length}: ${result.length} chars`);
            return { idx, content: result };
          } catch (err: unknown) {
            console.error(`Chunk ${chunkNum} failed:`, getErrorMessage(err, "Errore sconosciuto"));
            return { idx, content: "" };
          }
        });

        // Progress updates
        let progressInterval: ReturnType<typeof setInterval> | null = null;
        if (jobId) {
          progressInterval = setInterval(async () => {
            try {
              const elapsed = Date.now() - startTime;
              const etaMs   = completedCount > 0
                ? Math.round((elapsed / completedCount) * (chunks.length - completedCount)) : null;
              const eta     = etaMs ? ` · ~${Math.max(1, Math.ceil(etaMs/1000))}s` : "";
              await supabase.from("generation_jobs").update({
                progress_message: `Sezione ${Math.min(completedCount+1,chunks.length)} di ${chunks.length}…${eta}`,
                progress_pct:     Math.round((completedCount / chunks.length) * 100),
              }).eq("id", jobId);
            } catch {}
          }, 2500);
        }

        const wrappedTasks = chunkTasks.map(fn => async () => {
          const r = await fn(); completedCount++; return r;
        });

        const results = await parallelLimit(wrappedTasks, CONCURRENCY);
        if (progressInterval) clearInterval(progressInterval);

        // Merge in ordine
        const chunkResults = results
          .sort((a, b) => a.idx - b.idx)
          .map(r => r.content)
          .filter(Boolean);

        const elapsed = Math.round((Date.now() - startTime) / 1000);
        console.log(`Parallel generation: ${elapsed}s for ${chunks.length} chunks`);

        if (chunkResults.length === 0) throw new Error("Nessun contenuto generato.");

        if (chunkResults.length === 1) {
          finalContent = chunkResults[0];
        } else {
          // Consolida i chunk in un documento coerente
          const merged = chunkResults.join("\n\n---\n\n");

          if (jobId) await supabase.from("generation_jobs").update({
            progress_message: "Consolidamento finale…", progress_pct: 90,
          }).eq("id", jobId);

          if (merged.length < 150_000) {
            const mergeData = await callAI(GEMINI_API_KEY, [
              { role: "system", content: systemPrompt },
              { role: "user", content: `Unifica questi ${chunkResults.length} frammenti di ${FORMAT_NAMES[format]} in un unico documento coerente.\nRimuovi ripetizioni, mantieni struttura e ordine logico. NON troncare. ${langNote}\n\n${merged}` },
            ]);
            finalContent = mergeData.choices?.[0]?.message?.content || merged;
          } else {
            // Troppo grande per consolidare: concatena pulendo le separazioni
            finalContent = chunkResults.join("\n\n");
          }
        }
      }
    }

    if (!finalContent) throw new Error("Contenuto vuoto generato dall'AI.");

    const docTitle = title || ({ summary: "Riassunto", outline: "Schema", smart_notes: "Appunti Smart" } as Record<string, string>)[format] || "Documento";

    const { data: saved, error: saveErr } = await supabase.from("generated_content").insert({
      user_id:      authUser.id,
      content_type: format,
      title:        docTitle,
      content:      { markdown: finalContent, format },
    }).select("id").single();
    if (saveErr) throw saveErr;

    if (jobId) await supabase.from("generation_jobs").update({
      status: "completed", result_id: saved.id, error: null,
      completed_at: new Date().toISOString(), progress_pct: 100, progress_message: null,
    }).eq("id", jobId);

    return new Response(JSON.stringify({ success: true, id: saved.id, content: finalContent, format, title: docTitle }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (e: unknown) {
    const errorWithStatus = e as ErrorWithStatus;
    console.error("generate-summary error:", e);
    try {
      const body = await req.clone().json().catch(() => ({}));
      if (body.jobId) {
        const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
        await sb.from("generation_jobs").update({
          status: "error", error: getErrorMessage(e, "Errore"), completed_at: new Date().toISOString(),
        }).eq("id", body.jobId);
      }
    } catch {}
    return new Response(JSON.stringify({ error: getErrorMessage(e, "Unknown error") }), {
      status: errorWithStatus.status || 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
