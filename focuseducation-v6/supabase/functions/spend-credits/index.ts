import { serve } from "https://deno.land/std@0.220.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// FIX: whitelist azioni permesse (previene log pollution con azioni arbitrarie)
const ALLOWED_ACTIONS = new Set([
  "quiz", "flashcards", "mindmap", "youtube", "summary",
  "decompose", "tutor", "voice_notes",
]);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Non autorizzato" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const supabaseUser = createClient(
      Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user }, error: authError } = await supabaseUser.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Non autorizzato" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { action, cost, description } = await req.json();

    if (!action || typeof cost !== "number" || cost <= 0) {
      return new Response(JSON.stringify({ error: "Parametri non validi" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // FIX: rifiuta azioni non nella whitelist
    if (!ALLOWED_ACTIONS.has(action)) {
      return new Response(JSON.stringify({ error: "Azione non consentita" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const supabaseAdmin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data, error } = await supabaseAdmin.rpc("spend_credits", {
      _user_id: user.id, _cost: cost, _action: action, _description: description || null,
    });

    if (error) {
      console.error("spend_credits RPC error:", error);
      return new Response(JSON.stringify({ error: "Errore interno" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const result = data as { success: boolean; error?: string; balance?: number; rollover_balance?: number };

    if (!result.success) {
      return new Response(JSON.stringify({
        error: result.error === "insufficient_credits" ? "Crediti insufficienti" : "Errore crediti",
        code: result.error, balance: result.balance, rollover_balance: result.rollover_balance,
      }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ success: true, balance: result.balance, rollover_balance: result.rollover_balance }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("spend-credits error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Errore sconosciuto" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
