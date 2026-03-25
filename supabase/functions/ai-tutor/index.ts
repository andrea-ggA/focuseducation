import { serve } from "https://deno.land/std@0.220.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ error: "Non autorizzato" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user: authUser }, error: authError } = await supabase.auth.getUser();
    if (authError || !authUser) {
      return new Response(
        JSON.stringify({ error: "Non autorizzato" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const userId = authUser.id;

    // FIX: limit raw body size before parsing to prevent OOM from huge documentContext
    const rawText = await req.text();
    if (rawText.length > 2_000_000) {
      return new Response(
        JSON.stringify({ error: "Richiesta troppo grande (max 2MB)" }),
        { status: 413, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const body = JSON.parse(rawText);
    let messages: any[];
    if (Array.isArray(body.messages)) {
      messages = body.messages;
    } else if (typeof body.message === "string") {
      messages = [{ role: "user", content: body.message }];
    } else if (Array.isArray(body)) {
      messages = body;
    } else {
      messages = [{ role: "user", content: JSON.stringify(body) }];
    }

    // Optional document context for document Q&A
    // FIX: trim documentContext to safe size before using
    const rawDocCtx = typeof body.documentContext === "string" ? body.documentContext : null;
    const documentContext = rawDocCtx ? rawDocCtx.slice(0, 80_000) : null;

    if (!Array.isArray(messages) || messages.length === 0 || messages.length > 50) {
      return new Response(
        JSON.stringify({ error: "Messaggio non valido" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    for (const msg of messages) {
      if (!msg.role || typeof msg.role !== "string") {
        return new Response(
          JSON.stringify({ error: "Formato messaggio non valido" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (typeof msg.content === "string" && msg.content.length > 15000) {
        return new Response(
          JSON.stringify({ error: "Messaggio troppo lungo (max 15000 caratteri)" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    const GEMINI_API_KEY = Deno.env.get("GOOGLE_GEMINI_API_KEY");
    if (!GEMINI_API_KEY) throw new Error("GOOGLE_GEMINI_API_KEY is not configured");

    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${GEMINI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gemini-2.5-flash",
          messages: [
            {
              role: "system",
              content: `Il tuo nome è FocusEd. Sei stato creato dal team di FocusEd. Se qualcuno ti chiede chi ti ha creato, rispondi che sei stato creato da FocusEd.
Sei un tutor AI empatico e paziente specializzato per studenti con ADHD.

REGOLA LINGUA CRITICA: Rileva AUTOMATICAMENTE la lingua in cui lo studente ti scrive e rispondi SEMPRE nella STESSA lingua. Se scrive in inglese, rispondi in inglese. Se scrive in spagnolo, rispondi in spagnolo. Se scrive in tedesco, rispondi in tedesco. Se scrive in francese, rispondi in francese. Se scrive in italiano, rispondi in italiano. Adatta la lingua a quella dello studente.

Usa un tono incoraggiante, supportivo e mai giudicante.
Spezza le spiegazioni in punti brevi e chiari.
Usa emoji per rendere il contenuto più coinvolgente.
Se lo studente sembra frustrato, offri supporto emotivo prima di continuare con il contenuto.
Adatta la complessità delle risposte al livello dello studente.
Usa analogie e esempi pratici per spiegare concetti difficili.
Mantieni le risposte concise — evita muri di testo.
Formatta le risposte usando Markdown: usa **grassetto**, *corsivo*, elenchi puntati e intestazioni quando appropriato.${documentContext ? `

CONTESTO DOCUMENTO: Lo studente sta leggendo il seguente documento. Usa ESCLUSIVAMENTE questo contenuto per rispondere alle domande. Se la domanda non è pertinente al documento, fallo notare gentilmente.

---DOCUMENTO---
${documentContext.slice(0, 60000)}
---FINE DOCUMENTO---` : ""}`,
            },
            ...messages,
          ],
          stream: true,
        }),
      }
    );

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Troppe richieste, riprova tra poco." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "Crediti AI esauriti." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const text = await response.text();
      console.error("AI gateway error:", response.status, text);
      return new Response(
        JSON.stringify({ error: "Errore del servizio AI" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(response.body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (e) {
    console.error("ai-tutor error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Errore sconosciuto" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
