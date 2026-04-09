import { serve } from "https://deno.land/std@0.220.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// FIX #9: Added rate limiting (previously missing — exposed to Gemini API abuse)
async function checkRateLimit(supabaseAdmin: any, userId: string): Promise<boolean> {
  const { data: allowed } = await supabaseAdmin.rpc("check_and_increment_rate_limit", {
    _user_id: userId,
    _max_per_min: 10,
  });
  return allowed !== false;
}

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

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user: authUser }, error: authError } = await anonClient.auth.getUser();
    if (authError || !authUser) {
      return new Response(
        JSON.stringify({ error: "Non autorizzato" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const user = { id: authUser.id };

    // FIX #9: Check rate limit before processing
    const supabaseAdmin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const rateOk = await checkRateLimit(supabaseAdmin, user.id);
    if (!rateOk) {
      return new Response(
        JSON.stringify({ error: "Troppe richieste. Attendi un minuto." }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { audioBase64, mimeType } = await req.json();

    if (!audioBase64) throw new Error("Missing audio data");

    // FIX #6: Validate that audioBase64 is actually valid base64
    if (typeof audioBase64 !== "string" || audioBase64.length > 10000000) {
      return new Response(
        JSON.stringify({ error: "File audio troppo grande (max ~5MB base64)" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!/^[A-Za-z0-9+/=]+$/.test(audioBase64.slice(0, 100))) {
      return new Response(
        JSON.stringify({ error: "Formato audio non valido" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("Received audio. MIME:", mimeType, "Base64 length:", audioBase64.length);

    const GEMINI_API_KEY = Deno.env.get("GOOGLE_GEMINI_API_KEY");
    if (!GEMINI_API_KEY) throw new Error("GOOGLE_GEMINI_API_KEY not configured");

    let format = "wav";
    if (mimeType?.includes("webm")) format = "webm";
    else if (mimeType?.includes("ogg")) format = "ogg";
    else if (mimeType?.includes("mp3") || mimeType?.includes("mpeg")) format = "mp3";
    else if (mimeType?.includes("mp4") || mimeType?.includes("m4a")) format = "mp4";
    else if (mimeType?.includes("wav")) format = "wav";

    console.log("Using format:", format);

    const response = await fetch("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", {
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
            content: `You are an expert assistant that transforms audio from university lectures and voice notes into structured, complete and well-organized study notes.

CRITICAL LANGUAGE RULE: Detect the language spoken in the audio and produce ALL notes in the SAME language as the audio. If the speaker talks in English, write notes in English. If in Spanish, write in Spanish. If in German, write in German. If in French, write in French. If in Italian, write in Italian. Match the audio language exactly.

CRITICAL INSTRUCTIONS:
1. LISTEN CAREFULLY to all audio from start to finish.
2. FAITHFULLY TRANSCRIBE what is said, without inventing or adding content.
3. If the audio contains a lecture, organize the content by topics/sections.
4. Use a clear structure with:
   - Main title based on the lecture topic
   - Sections and subsections with bold titles (## and ###)
   - Bullet points for key concepts
   - Highlighted definitions
   - Examples reported faithfully
5. Fix grammar errors in the transcription but DO NOT change the meaning.
6. If there are formulas, theorems or specific data, report them accurately.
7. At the end, add a "Key Concepts" section with a summary of the main points.
8. If the audio is not comprehensible or too short, clearly indicate what you could understand and flag the issue.
9. DO NOT generate random content if you cannot understand the audio.`,
          },
          {
            role: "user",
            content: [
              {
                type: "input_audio",
                input_audio: {
                  data: audioBase64,
                  format: format,
                },
              },
              {
                type: "text",
                text: "Faithfully transcribe this audio and create structured, organized study notes. Do not invent anything, only report what is actually said in the audio.",
              },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit. Riprova tra poco." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "Crediti AI esauriti." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const text = await response.text();
      console.error("AI error:", response.status, text);
      throw new Error(`AI transcription failed: ${response.status}`);
    }

    const data = await response.json();
    const notes = data.choices?.[0]?.message?.content || "";

    if (!notes || notes.trim().length < 10) {
      return new Response(JSON.stringify({
        error: "Non è stato possibile trascrivere l'audio. Assicurati che la registrazione contenga parlato chiaro e riprova."
      }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log("Notes generated successfully, length:", notes.length);

    return new Response(JSON.stringify({ notes }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("voice-to-notes error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
