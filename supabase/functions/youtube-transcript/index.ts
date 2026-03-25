import { serve } from "https://deno.land/std@0.220.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function extractVideoId(url: string): string | null {
  const m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/);
  return m ? m[1] : null;
}

async function getTranscriptViaInnertube(videoId: string): Promise<{ transcript: string; title: string }> {
  // Step 1: Use YouTube innertube API to get player response (works server-side, no scraping)
  const playerRes = await fetch("https://www.youtube.com/youtubei/v1/player", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      videoId,
      context: {
        client: {
          clientName: "WEB",
          clientVersion: "2.20240101.00.00",
          hl: "it",
          gl: "IT",
        },
      },
    }),
  });

  if (!playerRes.ok) throw new Error("Impossibile contattare YouTube.");
  const playerData = await playerRes.json();

  const title = playerData?.videoDetails?.title || `Video ${videoId}`;
  const captionTracks = playerData?.captions?.playerCaptionsTracklistRenderer?.captionTracks;

  if (!captionTracks || captionTracks.length === 0) {
    // Try alternative: fetch the watch page HTML for auto-generated captions
    return await getTranscriptViaPage(videoId);
  }

  return await fetchCaptionTrack(captionTracks, title);
}

async function getTranscriptViaPage(videoId: string): Promise<{ transcript: string; title: string }> {
  const pageRes = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept-Language": "it-IT,it;q=0.9,en;q=0.8",
    },
  });

  if (!pageRes.ok) throw new Error("Impossibile accedere alla pagina YouTube.");
  const html = await pageRes.text();

  // Extract title
  const titleMatch = html.match(/<title>(.+?)<\/title>/);
  const title = titleMatch ? titleMatch[1].replace(" - YouTube", "").trim() : `Video ${videoId}`;

  // Try ytInitialPlayerResponse
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

  if (!captionTracks || captionTracks.length === 0) {
    throw new Error("NO_CAPTIONS");
  }

  return await fetchCaptionTrack(captionTracks, title);
}

async function fetchCaptionTrack(captionTracks: any[], title: string): Promise<{ transcript: string; title: string }> {
  // Prefer: Italian manual → English manual → Italian auto → English auto → first available
  const track =
    captionTracks.find((t: any) => t.languageCode === "it" && !t.kind) ||
    captionTracks.find((t: any) => t.languageCode === "en" && !t.kind) ||
    captionTracks.find((t: any) => t.languageCode === "it") ||
    captionTracks.find((t: any) => t.languageCode === "en") ||
    captionTracks[0];

  // Fetch caption XML
  const captionRes = await fetch(track.baseUrl + "&fmt=srv3");
  if (!captionRes.ok) {
    // Retry without fmt parameter
    const retryRes = await fetch(track.baseUrl);
    if (!retryRes.ok) throw new Error("Impossibile scaricare i sottotitoli.");
    const retryText = await retryRes.text();
    return { transcript: parseCaptionXml(retryText), title };
  }

  const captionXml = await captionRes.text();
  return { transcript: parseCaptionXml(captionXml), title };
}

function parseCaptionXml(xml: string): string {
  const rawSegments: string[] = [];

  // Try XML format (most common)
  const regex = /<text[^>]*>([\s\S]*?)<\/text>/g;
  let match;
  while ((match = regex.exec(xml)) !== null) {
    let text = match[1]
      .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
      .replace(/<[^>]+>/g, "")   // strip any inner HTML tags (e.g. <font>)
      .replace(/\n/g, " ").trim();
    if (text) rawSegments.push(text);
  }

  // Try JSON format (srv3)
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

  // Post-processing: deduplica segmenti consecutivi identici
  // (common in auto-generated captions where segments overlap)
  const deduped: string[] = [];
  for (const seg of rawSegments) {
    if (deduped.length === 0 || seg !== deduped[deduped.length - 1]) {
      deduped.push(seg);
    }
  }

  // Unisci in testo continuo, aggiungendo punto se il segmento sembra finire una frase
  const parts: string[] = [];
  for (let i = 0; i < deduped.length; i++) {
    const seg  = deduped[i];
    const next = deduped[i + 1] || "";
    // Aggiungi spazio; se il segmento finisce con punteggiatura lascialo, altrimenti aggiungi spazio
    parts.push(seg);
    if (next && !seg.match(/[.!?,;:]$/) && next.match(/^[A-ZÁÀÈÉÌÍÓÒÚÙÂÊÎÔÛÄËÏÖÜ]/)) {
      parts.push(" "); // nuova frase: inizia con maiuscola
    } else if (next) {
      parts.push(" ");
    }
  }

  return parts.join("").replace(/\s{2,}/g, " ").trim();
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const url = body.url || body.videoUrl;

    if (!url) {
      return new Response(
        JSON.stringify({ error: "URL YouTube richiesto." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const videoId = extractVideoId(url);
    if (!videoId) {
      return new Response(
        JSON.stringify({ error: "URL YouTube non valido." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Extracting transcript for video: ${videoId}`);

    try {
      const result = await getTranscriptViaInnertube(videoId);

      if (!result.transcript || result.transcript.length < 30) {
        throw new Error("NO_CAPTIONS");
      }

      console.log(`Transcript extracted: ${result.transcript.length} chars, title: "${result.title}"`);

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
        console.log("No captions found, attempting Gemini video analysis...");

        const geminiKey = Deno.env.get("GOOGLE_GEMINI_API_KEY");
        if (!geminiKey) {
          return new Response(
            JSON.stringify({ error: "Servizio di analisi video AI non disponibile." }),
            { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // Get video info
        const infoRes = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`);
        let videoTitle = `Video ${videoId}`;
        if (infoRes.ok) {
          const info = await infoRes.json();
          videoTitle = info.title || videoTitle;
        }

        // Use Gemini native API with video file_data to actually watch the video
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
                    {
                      fileData: {
                        mimeType: "video/mp4",
                        fileUri: youtubeVideoUrl,
                      },
                    },
                    {
                      text: `Analizza questo video YouTube in modo approfondito. Genera una trascrizione dettagliata e completa del contenuto parlato nel video. 
Se il video contiene presentazioni, slide o testo visuale, includi anche quei contenuti.
La trascrizione deve essere:
- Fedele al contenuto originale del video
- Completa e dettagliata (trascrivi tutto ciò che viene detto)
- Strutturata con paragrafi e sezioni logiche
- In italiano (traduci se il video è in un'altra lingua)
- Adatta per generare quiz, flashcard, mappe concettuali e riassunti

Fornisci SOLO la trascrizione/contenuto testuale, senza commenti o prefissi.`,
                    },
                  ],
                },
              ],
              generationConfig: {
                temperature: 0.3,
                maxOutputTokens: 16000,
              },
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

        console.log(`Video analyzed by Gemini: ${aiContent.length} chars for "${videoTitle}"`);

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
