import { serve } from "https://deno.land/std@0.220.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

interface ErrorWithStatus {
  status?: number;
}

interface QuizAttemptSummary {
  score: number;
  total_points: number;
  correct_answers: number;
  total_answered: number;
  completed_at: string;
}

interface FocusSessionSummary {
  duration_minutes: number;
  completed: boolean;
  session_type: string | null;
  started_at: string;
}

interface PendingTaskSummary {
  title: string;
  completed: boolean;
  priority: string | null;
  estimated_minutes: number | null;
}

interface ErrorTopicRow {
  topic: string | null;
}

interface StudyPlanRequestBody {
  energy_level?: string;
  language?: string;
}

type AIRequestBody = Record<string, unknown>;

const getErrorMessage = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback;

async function callAIWithRetry(apiKey: string, body: AIRequestBody, retries = 3): Promise<Record<string, unknown>> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const t = await res.text();
        console.error(`AI error (attempt ${attempt + 1}):`, res.status, t.substring(0, 150));
        if (res.status === 429) {
          if (attempt < retries) { await sleep(3000 * (attempt + 1)); continue; }
          throw { status: 429, message: "Troppe richieste, riprova tra poco." };
        }
        if (res.status === 402) throw { status: 402, message: "Crediti AI esauriti." };
        if (attempt < retries) { await sleep(2000 * (attempt + 1)); continue; }
        throw new Error("AI error: " + res.status);
      }
      return await res.json() as Record<string, unknown>;
    } catch (e: unknown) {
      const errorWithStatus = e as ErrorWithStatus;
      if (errorWithStatus.status === 402 || errorWithStatus.status === 429) throw e;
      if (attempt < retries) { await sleep(2000 * (attempt + 1)); continue; }
      throw e;
    }
  }
  throw new Error("AI request failed");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Non autorizzato" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    // Usa service role per le query aggregate (più veloce, bypassa RLS)
    const supabase    = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const anonClient  = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await anonClient.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Non autorizzato" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json() as StudyPlanRequestBody;
    const energyLevel = body.energy_level || "balanced";
    const language    = body.language || "it";

    const now     = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 86_400_000).toISOString();

    // Tutte le query in parallelo — erano sequenziali prima
    const [profileRes, xpRes, quizzesRes, flashdecksRes, focusRes, tasksRes, dueCardsRes, errorsRes] =
      await Promise.allSettled([
        supabase.from("profiles")
          .select("full_name, streak_count, exam_date, exam_subject, weekly_goal_minutes")
          .eq("user_id", user.id).single(),
        supabase.from("user_xp")
          .select("total_xp, level, quizzes_completed, current_streak")
          .eq("user_id", user.id).maybeSingle(),
        supabase.from("quiz_attempts")
          .select("score, total_points, correct_answers, total_answered, completed_at")
          .eq("user_id", user.id).gte("completed_at", weekAgo)
          .order("completed_at", { ascending: false }).limit(10),
        supabase.from("flashcard_decks")
          .select("id, title, card_count, topic")
          .eq("user_id", user.id).order("created_at", { ascending: false }).limit(8),
        supabase.from("focus_sessions")
          .select("duration_minutes, completed, session_type, started_at")
          .eq("user_id", user.id).gte("started_at", weekAgo),
        supabase.from("tasks")
          .select("title, completed, priority, estimated_minutes")
          .eq("user_id", user.id).eq("completed", false)
          .order("created_at", { ascending: false }).limit(8),
        // Numero card scadute — per suggerire sessione ripasso
        supabase.rpc("count_due_cards", { _user_id: user.id }),
        // Topic con più errori — per personalizzare il piano
        supabase.from("user_question_progress")
          .select("topic")
          .eq("user_id", user.id).eq("is_correct", false)
          .gte("answered_at", new Date(now.getTime() - 30 * 86_400_000).toISOString())
          .order("answered_at", { ascending: false }).limit(100),
      ]);

    // Estrai dati (Promise.allSettled non crasha su errori individuali)
    const profile       = profileRes.status === "fulfilled" ? profileRes.value.data  : null;
    const xp            = xpRes.status === "fulfilled"      ? xpRes.value.data       : null;
    const recentQuizzes = (quizzesRes.status === "fulfilled" ? quizzesRes.value.data ?? [] : []) as QuizAttemptSummary[];
    const decks         = flashdecksRes.status === "fulfilled" ? flashdecksRes.value.data ?? [] : [];
    const focusSessions = (focusRes.status === "fulfilled"   ? focusRes.value.data ?? [] : []) as FocusSessionSummary[];
    const pendingTasks  = (tasksRes.status === "fulfilled"   ? tasksRes.value.data ?? [] : []) as PendingTaskSummary[];
    const dueCount      = dueCardsRes.status === "fulfilled" ? (dueCardsRes.value.data as number) ?? 0 : 0;
    const errorRows     = (errorsRes.status === "fulfilled"  ? errorsRes.value.data ?? [] : []) as ErrorTopicRow[];

    // Calcola statistiche
    const avgAccuracy = recentQuizzes.length > 0
      ? Math.round(recentQuizzes.reduce((s, q) =>
          s + (q.total_answered > 0 ? (q.correct_answers / q.total_answered) * 100 : 0), 0
        ) / recentQuizzes.length)
      : 0;

    const weeklyFocusMinutes = focusSessions.filter(f => f.completed)
      .reduce((s, f) => s + (f.duration_minutes || 0), 0);

    // Top topic con errori (per personalizzare il piano)
    const topicErrors: Record<string, number> = {};
    for (const row of errorRows) {
      const t = row.topic || "Generale";
      topicErrors[t] = (topicErrors[t] || 0) + 1;
    }
    const weakTopics = Object.entries(topicErrors)
      .sort((a, b) => b[1] - a[1]).slice(0, 3)
      .map(([t, c]) => `${t} (${c} errori)`).join(", ");

    // Countdown esame
    let examInfo = "";
    if (profile?.exam_date) {
      const daysToExam = Math.round(
        (new Date(profile.exam_date).getTime() - now.getTime()) / 86_400_000
      );
      if (daysToExam >= 0) {
        examInfo = `\n- Esame: "${profile.exam_subject || "Esame"}" tra ${daysToExam} giorni (${profile.exam_date})`;
      }
    }

    const userContext = `
PROFILO UTENTE:
- Nome: ${profile?.full_name || "Studente"}
- Livello: ${xp?.level || 1}, XP: ${xp?.total_xp || 0}
- Streak: ${xp?.current_streak || profile?.streak_count || 0} giorni${examInfo}
- Livello energia preferito: ${energyLevel}
- Obiettivo settimanale: ${profile?.weekly_goal_minutes || 120} minuti/settimana

STATISTICHE ULTIMA SETTIMANA:
- Quiz completati: ${recentQuizzes.length}, Accuratezza media: ${avgAccuracy}%
- Sessioni focus completate: ${focusSessions.filter(f => f.completed).length}, Totale: ${weeklyFocusMinutes} minuti
- Task in sospeso: ${pendingTasks.length}
- Flashcard da ripassare oggi: ${dueCount}
${weakTopics ? `- Argomenti deboli (ultimi 30gg): ${weakTopics}` : ""}

MATERIALE DISPONIBILE:
- Deck flashcard: ${decks.length > 0 ? decks.map(d => `"${d.title}" (${d.card_count} card, ${d.topic || "generale"})`).join(", ") : "nessuno"}
- Task in sospeso: ${pendingTasks.length > 0 ? pendingTasks.map(t => `"${t.title}" (${t.priority})`).slice(0, 5).join(", ") : "nessuno"}
`;

    const GEMINI_API_KEY = Deno.env.get("GOOGLE_GEMINI_API_KEY");
    if (!GEMINI_API_KEY) throw new Error("GOOGLE_GEMINI_API_KEY not configured");

    const langMap: Record<string, string> = {
      it: "italiano", en: "English", es: "español", fr: "français", de: "Deutsch",
    };
    const langName = langMap[language] || "italiano";

    const aiData = await callAIWithRetry(GEMINI_API_KEY, {
      model: "gemini-2.5-flash",
      messages: [{
        role: "user",
        content: `You are FocusEd, an ADHD-specialized study planner AI. Generate a personalized weekly study plan.

RESPOND IN: ${langName}

ENERGY LEVEL: "${energyLevel}"
- "low": Short sessions (10-15 min), more breaks, 2-3 activities/day, gentle goals
- "balanced": Medium sessions (20-25 min), standard load, 3-4 activities/day
- "high": Longer sessions (25-35 min), 4-5 activities/day, ambitious goals
- "hyperfocus": Deep work (40-50 min), 4-5 activities/day, maximize productivity

${userContext}

Create a 7-day plan (Monday to Sunday) that:
1. Adapts to energy level and ADHD needs (variety, short bursts, rewards)
2. Prioritizes weak topics: ${weakTopics || "none identified yet"}
3. Includes flashcard review sessions if dueCount > 0 (${dueCount} cards due)
4. ${profile?.exam_date ? `Prepares intensively for the upcoming exam` : "Builds consistent study habits"}
5. Has realistic daily goals — ADHD users need wins, not overwhelm
6. Front-loads harder tasks early in the week when motivation is higher
7. Includes explicit breaks and micro-rewards

For each day: 2-5 activities. Keep activity titles concise and actionable.`,
      }],
      tools: [{
        type: "function",
        function: {
          name: "create_study_plan",
          description: "Create personalized weekly study plan",
          parameters: {
            type: "object",
            properties: {
              weekly_summary:           { type: "string", description: "Motivational overview (2-3 sentences)" },
              weekly_goal:              { type: "string", description: "One clear measurable goal for the week" },
              total_estimated_minutes:  { type: "number" },
              days: {
                type: "array",
                description: "7 days Monday to Sunday",
                items: {
                  type: "object",
                  properties: {
                    day_name:   { type: "string" },
                    day_number: { type: "number", description: "1=Monday…7=Sunday" },
                    theme:      { type: "string", description: "Short day theme" },
                    emoji:      { type: "string" },
                    activities: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          type:               { type: "string", description: "quiz|flashcards|focus|task|break|review" },
                          title:              { type: "string" },
                          description:        { type: "string" },
                          duration_minutes:   { type: "number" },
                          priority:           { type: "string", description: "high|medium|low" },
                          emoji:              { type: "string" },
                        },
                        required: ["type","title","description","duration_minutes","priority","emoji"],
                      },
                    },
                    tip: { type: "string", description: "ADHD-friendly tip for the day" },
                  },
                  required: ["day_name","day_number","theme","emoji","activities","tip"],
                },
              },
            },
            required: ["weekly_summary","weekly_goal","total_estimated_minutes","days"],
          },
        },
      }],
      tool_choice: { type: "function", function: { name: "create_study_plan" } },
    });

    const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
    let plan: Record<string, unknown> | null = null;

    if (toolCall?.function?.arguments) {
      plan = JSON.parse(toolCall.function.arguments);
    } else {
      const text    = aiData.choices?.[0]?.message?.content || "";
      const cleaned = text.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
      const s = cleaned.indexOf("{"), e = cleaned.lastIndexOf("}");
      if (s !== -1 && e !== -1) plan = JSON.parse(cleaned.substring(s, e + 1));
    }

    if (!plan?.days) throw new Error("Impossibile generare il piano");

    // Salva in DB
    const monday = new Date(now);
    monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);

    const weekStart = monday.toISOString().split("T")[0];
    const weekEnd   = sunday.toISOString().split("T")[0];

    const { data: saved, error: saveError } = await supabase
      .from("study_plans")
      .upsert({
        user_id:      user.id,
        week_start:   weekStart,
        week_end:     weekEnd,
        plan_data:    plan,
        energy_level: energyLevel,
      }, { onConflict: "user_id,week_start" })
      .select().single();

    if (saveError) console.error("Save error:", saveError);

    console.log(`Study plan generated: ${plan.days.length} days, ${plan.total_estimated_minutes} min, energy=${energyLevel}`);

    return new Response(JSON.stringify({ success: true, plan, saved_id: saved?.id }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (e: unknown) {
    const errorWithStatus = e as ErrorWithStatus;
    console.error("generate-study-plan error:", e);
    return new Response(JSON.stringify({ error: getErrorMessage(e, "Errore sconosciuto") }), {
      status: errorWithStatus.status || 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
