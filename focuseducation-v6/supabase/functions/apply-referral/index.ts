/**
 * apply-referral Edge Function
 * FIX: la logica di applicazione referral (incremento times_used + bonus crediti)
 * è ora delegata a una funzione SQL SECURITY DEFINER con FOR UPDATE lock
 * che previene la race condition precedente (due utenti che usavano lo stesso
 * codice contemporaneamente potevano entrambi superare il check max_uses).
 */
import { serve } from "https://deno.land/std@0.220.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "No authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const supabaseUrl   = Deno.env.get("SUPABASE_URL")!;
    const userClient    = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { code } = await req.json();
    if (!code || typeof code !== "string") {
      return new Response(JSON.stringify({ error: "Missing referral code" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // FIX: Delega all'RPC atomica (definita nella migration) che usa FOR UPDATE lock
    const supabaseAdmin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data, error } = await supabaseAdmin.rpc("apply_referral_code_atomic", {
      _code:    code.toUpperCase().trim(),
      _user_id: user.id,
    });

    if (error) {
      console.error("apply_referral_code_atomic error:", error);
      return new Response(JSON.stringify({ error: "Errore nell'applicazione del codice" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const result = data as { success: boolean; error?: string; discount?: number };

    if (!result.success) {
      const messages: Record<string, string> = {
        not_found:        "Codice referral non valido",
        self_use:         "Non puoi usare il tuo stesso codice",
        exhausted:        "Codice referral esaurito",
        already_used:     "Hai già utilizzato un codice referral",
      };
      return new Response(
        JSON.stringify({ error: messages[result.error || ""] || "Codice non valido" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(JSON.stringify({
      success: true, discount: result.discount,
      message: `Codice applicato! Hai ottenuto ${result.discount}% di sconto e 5 crediti bonus.`,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("apply-referral error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
