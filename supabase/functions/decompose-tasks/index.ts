import { serve } from "https://deno.land/std@0.220.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { cleanText, removePageArtifacts } from "../_shared/textUtils.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
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
    const user = { id: authUser.id };

    const { content, title, distractionLevel = 3 } = await req.json();
    if (!content || typeof content !== "string") throw new Error("Missing content");

    // Pulizia artefatti PDF — era assente
    const cleaned = removePageArtifacts(cleanText(content));
    console.log(`Tasks clean: ${content.length} → ${cleaned.length} chars`);

    const GEMINI_API_KEY = Deno.env.get("GOOGLE_GEMINI_API_KEY");
    if (!GEMINI_API_KEY) throw new Error("GOOGLE_GEMINI_API_KEY not configured");

    // Limite aumentato: 30.000 → 50.000 chars
    const textPreview = cleaned.substring(0, 50_000);
    const bufferMult  = (1 + 0.2 * distractionLevel).toFixed(1);

    const res = await fetch("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${GEMINI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gemini-2.5-flash",
        messages: [{ role: "user", content: `You are an ADHD-friendly task planner. Break down this study material into actionable micro-goals.

CRITICAL LANGUAGE RULE: Detect the language of the material and generate ALL task titles and descriptions in that SAME language.

CONTENT RULES:
- Base tasks ONLY on actual study content.
- IGNORE: page numbers, headers, footers, bibliography, figure captions, URLs.
- Tasks must refer to real concepts/chapters present in the text.

TASK RULES:
- Each task: specific, actionable, completable in 10-15 min.
- Logically ordered: simple → complex.
- User distraction level: ${distractionLevel}/5
${distractionLevel >= 4 ? "- High distraction: VERY short tasks (5-8 min), extremely specific." : ""}
${distractionLevel <= 2 ? "- Low distraction: slightly longer tasks (12-15 min)." : ""}
- Time buffer multiplier: ${bufferMult}x (ADHD accommodation).
- Generate 5-20 micro-tasks.

Reply with tool call create_micro_tasks.

--- MATERIAL ---
${textPreview}
--- END ---` }],
        tools: [{
          type: "function",
          function: {
            name: "create_micro_tasks",
            description: "Create ADHD-friendly micro-tasks from study material",
            parameters: {
              type: "object",
              properties: {
                tasks: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      title:              { type: "string" },
                      description:        { type: "string" },
                      estimated_minutes:  { type: "number" },
                      priority:           { type: "string", description: "Task priority. Prefer one of: high, medium, low." },
                    },
                    required: ["title","estimated_minutes","priority"],
                  },
                },
              },
              required: ["tasks"],
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "create_micro_tasks" } },
      }),
    });

    if (!res.ok) {
      const t = await res.text();
      console.error("AI error:", res.status, t.substring(0, 200));
      if (res.status === 429) throw { status: 429, message: "Rate limit. Riprova tra poco." };
      if (res.status === 402) throw { status: 402, message: "Crediti AI esauriti." };
      throw new Error("AI error: " + res.status);
    }

    const aiData  = await res.json();
    const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
    let tasks: any[] = [];

    if (toolCall?.function?.arguments) {
      tasks = JSON.parse(toolCall.function.arguments).tasks || [];
    } else {
      const text    = aiData.choices?.[0]?.message?.content || "";
      const cl      = text.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
      const s = cl.indexOf("{"), e = cl.lastIndexOf("}");
      if (s !== -1 && e !== -1) tasks = JSON.parse(cl.substring(s, e + 1)).tasks || [];
    }

    if (!tasks.length) throw new Error("No micro-tasks generated");

    const { data: parentTask, error: parentErr } = await supabase.from("tasks").insert({
      user_id:           user.id,
      title:             `📚 ${title || "Studio"} — Piano micro-task`,
      description:       `${tasks.length} micro-obiettivi · distrazione ${distractionLevel}/5`,
      priority:          "high",
      estimated_minutes: Math.round(tasks.reduce((s: number, t: any) => s + (t.estimated_minutes || 10), 0) * parseFloat(bufferMult)),
    }).select("id").single();
    if (parentErr) throw parentErr;

    const childRows = tasks.map((t: any) => ({
      user_id:           user.id,
      title:             t.title,
      description:       t.description || null,
      estimated_minutes: Math.round((t.estimated_minutes || 10) * parseFloat(bufferMult)),
      priority:          t.priority || "medium",
      parent_task_id:    parentTask.id,
    }));

    const { error: childErr } = await supabase.from("tasks").insert(childRows);
    if (childErr) throw childErr;

    console.log(`Tasks: ${tasks.length} micro-tasks created`);

    return new Response(JSON.stringify({
      success: true,
      parent_task_id: parentTask.id,
      total_tasks: tasks.length,
      total_estimated_minutes: childRows.reduce((s, t) => s + (t.estimated_minutes || 10), 0),
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (e: any) {
    console.error("decompose-tasks error:", e);
    return new Response(JSON.stringify({ error: e.message || "Unknown error" }), {
      status: e.status || 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
