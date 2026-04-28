/**
 * add-credits Edge Function
 *
 * Security fix: replaces the previous pattern where addCredits() wrote
 * directly to user_credits via supabase.update() from the client.
 * That was exploitable from DevTools — any user could grant themselves
 * arbitrary credits. This function validates the action and amount server-side.
 */
import { serve } from "https://deno.land/std@0.220.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Whitelist: action → max credits allowed per call
const ALLOWED_ACTIONS: Record<string, number> = {
  xp_conversion:      10,  // FIX: aggiunto per conversione XP→crediti
  fortune_wheel:      100,
  referral_bonus:      50,
  achievement_reward:  30,
  tutor_refund:         5,
  admin_grant:       9999,
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Non autorizzato" }), { status: 401, headers: corsHeaders });
  }

  const supabaseUser = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: { user }, error: authError } = await supabaseUser.auth.getUser();
  if (authError || !user) {
    return new Response(JSON.stringify({ error: "Non autorizzato" }), { status: 401, headers: corsHeaders });
  }

  const { amount, action, description } = await req.json();

  // Validate action is in whitelist
  const maxAllowed = ALLOWED_ACTIONS[action];
  if (!maxAllowed) {
    return new Response(JSON.stringify({ error: "Azione non consentita" }), { status: 400, headers: corsHeaders });
  }

  // Validate amount
  if (typeof amount !== "number" || amount <= 0 || amount > maxAllowed) {
    return new Response(
      JSON.stringify({ error: `Importo non valido (max ${maxAllowed} per '${action}')` }),
      { status: 400, headers: corsHeaders },
    );
  }

  // For admin_grant, verify the caller is actually an admin
  if (action === "admin_grant") {
    const supabaseAdmin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: roleData } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("role", "admin")
      .maybeSingle();
    if (!roleData) {
      return new Response(JSON.stringify({ error: "Non autorizzato" }), { status: 403, headers: corsHeaders });
    }
  }

  const supabaseAdmin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // Read current balance
  const { data: credits } = await supabaseAdmin
    .from("user_credits")
    .select("balance, rollover_balance")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!credits) {
    return new Response(JSON.stringify({ error: "Record crediti non trovato" }), { status: 404, headers: corsHeaders });
  }

  const newBalance = credits.balance + amount;

  await supabaseAdmin
    .from("user_credits")
    .update({ balance: newBalance })
    .eq("user_id", user.id);

  await supabaseAdmin.from("credit_transactions").insert({
    user_id:     user.id,
    amount,
    action,
    description: description || `+${amount} NeuroCredits (${action})`,
  });

  return new Response(
    JSON.stringify({ success: true, balance: newBalance, rollover_balance: credits.rollover_balance }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
