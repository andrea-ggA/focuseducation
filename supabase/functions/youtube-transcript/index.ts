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
    // FIX #4: Added authentication check — previously anyone could call this endpoint
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

    // FIX #9: Added rate limiting (previously missing)
    const supabaseAdmin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: allowed } = await supabaseAdmin.rpc("check_and_increment_rate_limit", {
      _user_id: authUser.id,
      _max_per_min: 10,
    });
    if (allowed === false) {
      return new Response(
        JSON.stringify({ error: "Troppe richieste. Attendi un minuto." }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const body = await req.json();
    const url = body.url || body.videoUrl;

    if (!url) {
      return new Response(
        JSON.stringify({ error: "URL YouTube richiesto." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── existing logic unchanged below ──
    function extractVideoId(url: string): string | null {
      const m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/);
      return m ? m[1] : null;
    }

    const videoId = extractVideoId(url);
    if (!videoId) {
      return new Response(
        JSON.stringify({ error: "URL YouTube non valido." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Extracting transcript for video: ${videoId}`);

    async function getTranscriptViaInnertube(vid: string): Promise<{ transcript: string; title: string }> {
      const playerRes = await fetch("https://www.youtube.com/youtubei/v1/player", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          videoId: vid,
          context: { client: { clientName: "WEB", clientVersion: "2.20240101.00.00", hl: "it", gl: "IT" } },
        }),
      });
      if (!playerRes.ok) throw new Error("Impossibile contattare YouTube.");
      const playerData = await playerRes.json();
      const title = playerData?.videoDetails?.title || `Video ${vid}`;
      const captionTracks = playerData?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
      if (!captionTracks || captionTracks.length === 0) return await getTranscriptViaPage(vid);
      return await fetchCaptionTrack(captionTracks, title);
    }

    async function getTranscriptViaPage(vid: string): Promise<{ transcript: string; title: string }> {
      const pageRes = await fetch(`https://www.youtube.com/watch?v=${vid}`, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Accept-Language": "it-IT,it;q=0.9,en;q=0.8",
        },
      });
      if (!pageRes.ok) throw new Error("Impossibile accedere alla pagina YouTube.");
      const html = await pageRes.text();
      const titleMatch = html.match(/<title>(.+?)<\/title>/);
      const title = titleMatch ? titleMatch[1].replace(" - YouTube", "").trim() : `Video ${vid}`;
      const playerStart = html.indexOf("ytInitialPlayerResponse");
      if (playerStart === -1) throw new Error("Impossibile analizzare la pagina YouTube.");
      const jsonStart = html.indexOf("{", playerStart);
      let depth = 0, jsonEnd = jsonStart;
      for (let i = jsonStart; i < html.length && i < jsonStart + 500000; i++) {
        if (html[i] === "{") depth++;
        else if (html[i] === "}") depth--;
        if (depth === 0) { jsonEnd = i + 1; break; }
      }
      const playerResponse = JSON.parse(html.substring(jsonStart, jsonEnd));
      const captionTracks = playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
      if (!captionTracks || captionTracks.length === 0) throw new Error("NO_CAPTIONS");
      return await fetchCaptionTrack(captionTracks, title);
    }

    async function fetchCaptionTrack(captionTracks: any[], title: string): Promise<{ transcript: string; title: string }> {
      const track =
        captionTracks.find((t: any) => t.languageCode === "it" && !t.kind) ||
        captionTracks.find((t: any) => t.languageCode === "en" && !t.kind) ||
        captionTracks.find((t: any) => t.languageCode === "it") ||
        captionTracks.find((t: any) => t.languageCode === "en") ||
        captionTracks[0];
      const captionRes = await fetch(track.baseUrl + "&fmt=srv3");
      if (!captionRes.ok) {
        const retryRes = await fetch(track.baseUrl);
        if (!retryRes.ok) throw new Error("Impossibile scaricare i sottotitoli.");
        return { transcript: parseCaptionXml(await retryRes.text()), title };
      }
      return { transcript: parseCaptionXml(await captionRes.text()), title };
    }

    function parseCaptionXml(xml: string): string {
      const rawSegments: string[] = [];
      const regex = /<text[^>]*>([\s\S]*?)<\/text>/g;
      let match;
      while ((match = regex.exec(xml)) !== null) {
        let text = match[1]
          .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
          .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
          .replace(/<[^>]+>/g, "")
          .replace(/\n/g, " ").trim();
        if (text) rawSegments.push(text);
      }
      if (rawSegments.length === 0) {
        try {
          const json = JSON.parse(xml);
          if (json.events) {
            for (const event of json.events) {
              if (event.segs) {
                const segText = event.segs.map((s: any) => s.utf8 || "").join("").trim();
                if (segText && segText !== "\n") rawSegments.push(segText);
              }
            }
          }
        } catch (_) { /* not JSON */ }
      }
      if (rawSegments.length === 0) return "";
      const deduped: string[] = [];
      for (const seg of rawSegments) {
        if (deduped.length === 0 || seg !== deduped[deduped.length - 1]) deduped.push(seg);
      }
      const parts: string[] = [];
      for (let i = 0; i < deduped.length; i++) {
        const seg = deduped[i];
        const next = deduped[i + 1] || "";
        parts.push(seg);
        if (next && !seg.match(/[.!?,;:]$/) && next.match(/^[A-ZÁÀÈÉÌÍÓÒÚÙÂÊÎÔÛÄËÏÖÜ]/)) {
          parts.push(" ");
        } else if (next) {
          parts.push(" ");
        }
      }
      return parts.join("").replace(/\s{2,}/g, " ").trim();
    }

    try {
      const result = await getTranscriptViaInnertube(videoId);
      if (!result.transcript || result.transcript.length < 30) throw new Error("NO_CAPTIONS");

      return new Response(
        JSON.stringify({
          transcript: result.transcript,
          title: result.title,
          videoId,
          charCount: result.transcript.length,
          method: "captions",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    } catch (captionErr: any) {
      if (captionErr.message === "NO_CAPTIONS" || captionErr.message?.includes("sottotitoli")) {
        const geminiKey = Deno.env.get("GOOGLE_GEMINI_API_KEY");
        if (!geminiKey) {
          return new Response(
            JSON.stringify({ error: "Servizio di analisi video AI non disponibile." }),
            { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const infoRes = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`);
        let videoTitle = `Video ${videoId}`;
        if (infoRes.ok) {
          const info = await infoRes.json();
          videoTitle = info.title || videoTitle;
        }

        const youtubeVideoUrl = `https://www.youtube.com/watch?v=${videoId}`;
        const geminiRes = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [
                {
                  parts: [
                    { fileData: { mimeType: "video/mp4", fileUri: youtubeVideoUrl } },
                    {
                      text: `Analizza questo video YouTube in modo approfondito. Genera una trascrizione dettagliata e completa del contenuto parlato nel video. Se il video contiene presentazioni, slide o testo visuale, includi anche quei contenuti. La trascrizione deve essere fedele, completa, strutturata con paragrafi e sezioni logiche, in italiano. Fornisci SOLO la trascrizione, senza commenti o prefissi.`,
                    },
                  ],
                },
              ],
              generationConfig: { temperature: 0.3, maxOutputTokens: 16000 },
            }),
          }
        );

        if (!geminiRes.ok) {
          const errText = await geminiRes.text();
          console.error("Gemini video analysis error:", geminiRes.status, errText);
          return new Response(
            JSON.stringify({ error: "Impossibile analizzare il video. Riprova più tardi." }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const geminiData = await geminiRes.json();
        const aiContent = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || "";

        if (aiContent.length < 100) {
          return new Response(
            JSON.stringify({ error: "L'analisi del video ha prodotto contenuto insufficiente." }),
            { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        return new Response(
          JSON.stringify({
            transcript: aiContent,
            title: videoTitle,
            videoId,
            charCount: aiContent.length,
            method: "video_analysis",
            notice: "Contenuto generato dall'analisi AI del video originale (sottotitoli non disponibili).",
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      throw captionErr;
    }
  } catch (e) {
    console.error("youtube-transcript error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Errore sconosciuto" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
