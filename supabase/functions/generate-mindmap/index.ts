import { serve } from "https://deno.land/std@0.220.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { cleanText, removePageArtifacts } from "../_shared/textUtils.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface MindmapNode {
  id: string;
  label: string;
  description: string;
  group: string;
  importance?: number;
}

interface MindmapEdge {
  from: string;
  to: string;
  label?: string;
}

interface MindmapPayload {
  nodes: MindmapNode[];
  edges: MindmapEdge[];
}

interface ErrorWithStatus {
  status?: number;
}

const getErrorMessage = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing authorization");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
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

    const body = await req.json();
    const rawContent = body.text || body.content;
    if (!rawContent || typeof rawContent !== "string") throw new Error("Missing content");

    // Pulizia artefatti PDF — era assente, causava nodi di mappa su "Pag. 47" ecc.
    const content = removePageArtifacts(cleanText(rawContent));
    console.log(`Mindmap clean: ${rawContent.length} → ${content.length} chars`);

    const GEMINI_API_KEY = Deno.env.get("GOOGLE_GEMINI_API_KEY");
    if (!GEMINI_API_KEY) throw new Error("GOOGLE_GEMINI_API_KEY not configured");

    // Limite aumentato: 25.000 → 50.000 chars
    // La mappa concettuale è una singola chiamata AI — Gemini 2.5 Flash
    // gestisce contesti lunghi senza problemi di qualità
    const textPreview = content.substring(0, 50_000);

    const res = await fetch("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${GEMINI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gemini-2.5-flash",
        messages: [{ role: "user", content: `You are an expert concept mapper specialized in ADHD-friendly visual knowledge structures.

Analyze the following text and create a HIERARCHICAL concept mind map.

CRITICAL LANGUAGE RULE: Detect the language of the text and generate ALL labels, descriptions, and relationship labels in the SAME language.

CONTENT RULES:
- Base the map ONLY on concepts actually present in the text.
- IGNORE: page numbers, headers, footers, bibliography references, figure captions, URLs, author names.
- Focus on CONCEPTUAL content, not document structure.

STRUCTURE RULES (ADHD-optimized):
1. ONE central concept → root node (importance: 3)
2. 3-6 primary branches → major themes (importance: 2)
3. Supporting details → connected to branches (importance: 1)
4. Labels SHORT (max 3 words) — ADHD brains scan, not read
5. Simple, concrete language. Descriptions: ELI5, 1 sentence max.
6. Group by color/theme for visual chunking.
7. Relationship labels: max 3 words showing HOW concepts connect.

Create 10-20 nodes. Root: exactly 1 node. Importance-2: 3-6 nodes.

--- TEXT ---
${textPreview}
--- END ---` }],
        tools: [{
          type: "function",
          function: {
            name: "create_mindmap",
            description: "Create ADHD-friendly concept mind map",
            parameters: {
              type: "object",
              properties: {
                nodes: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      id:          { type: "string" },
                      label:       { type: "string" },
                      description: { type: "string" },
                      group:       { type: "string" },
                      importance:  { type: "number", description: "3=root, 2=primary, 1=detail" },
                    },
                    required: ["id", "label", "description", "group", "importance"],
                  },
                },
                edges: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      from:  { type: "string" },
                      to:    { type: "string" },
                      label: { type: "string" },
                    },
                    required: ["from", "to"],
                  },
                },
              },
              required: ["nodes", "edges"],
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "create_mindmap" } },
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
    let mindmap: MindmapPayload = { nodes: [], edges: [] };

    if (toolCall?.function?.arguments) {
      mindmap = JSON.parse(toolCall.function.arguments);
    } else {
      const text    = aiData.choices?.[0]?.message?.content || "";
      const cleaned = text.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
      const s = cleaned.indexOf("{"), e = cleaned.lastIndexOf("}");
      if (s !== -1 && e !== -1) mindmap = JSON.parse(cleaned.substring(s, e + 1));
    }

    mindmap.nodes = mindmap.nodes.map((node) => ({ ...node, importance: node.importance || 1 }));
    if (!mindmap.nodes?.length) throw new Error("Nessun concetto estratto");

    console.log(`Mindmap: ${mindmap.nodes.length} nodes, ${mindmap.edges?.length || 0} edges`);

    return new Response(JSON.stringify({ success: true, ...mindmap }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: unknown) {
    const errorWithStatus = e as ErrorWithStatus;
    console.error("generate-mindmap error:", e);
    return new Response(JSON.stringify({ error: getErrorMessage(e, "Unknown error") }), {
      status: errorWithStatus.status || 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
