/**
 * trial-expiry-check Edge Function
 *
 * Checks for trials expiring in 2 days and sends warning emails.
 * Also handles trials that just expired and sends expiry notification.
 *
 * Call this daily via a Supabase scheduled function or a cron job.
 * Setup: Supabase Dashboard → Database → Extensions → enable pg_cron
 * Then run: SELECT cron.schedule('trial-check', '0 9 * * *',
 *   $$SELECT net.http_post('https://xxxx.supabase.co/functions/v1/trial-expiry-check',
 *   '{}', '{"Authorization":"Bearer SERVICE_ROLE_KEY"}')$$);
 */
import { serve } from "https://deno.land/std@0.220.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const internalSecret = Deno.env.get("INTERNAL_FUNCTION_SECRET");
  const providedSecret = req.headers.get("x-internal-secret");
  if (!internalSecret || providedSecret !== internalSecret) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const now         = new Date();
  const in2days     = new Date(now.getTime() + 2 * 86_400_000);
  const in2daysEnd  = new Date(now.getTime() + 2 * 86_400_000 + 3_600_000); // 1h window

  let warningsSent = 0;
  let expiredSent  = 0;

  // 1. Trials expiring in exactly ~2 days → send warning email
  const { data: expiringSoon } = await supabase
    .from("subscriptions")
    .select("user_id, plan_name, trial_end_at")
    .eq("is_trial", true)
    .eq("status", "trialing")
    .gte("trial_end_at", in2days.toISOString())
    .lte("trial_end_at", in2daysEnd.toISOString());

  for (const sub of expiringSoon || []) {
    try {
      const { data: authUser } = await supabase.auth.admin.getUserById(sub.user_id);
      const { data: profile   } = await supabase.from("profiles")
        .select("full_name").eq("user_id", sub.user_id).maybeSingle();

      if (authUser?.user?.email) {
        await supabase.functions.invoke("send-email", {
          headers: { "x-internal-secret": internalSecret },
          body: {
            type: "trial_expiring",
            to:   authUser.user.email,
            name: profile?.full_name?.split(" ")[0] || "Studente",
            data: { planName: sub.plan_name, daysLeft: "2" },
          },
        });
        warningsSent++;
      }
    } catch (e) {
      console.error("[trial-expiry-check] warning email error:", e);
    }
  }

  // 2. Trials that just expired (within last hour) → downgrade + send expiry email
  const { data: justExpired } = await supabase
    .from("subscriptions")
    .select("user_id, plan_name, trial_end_at")
    .eq("is_trial", true)
    .eq("status", "trialing")
    .lt("trial_end_at", now.toISOString())
    .gte("trial_end_at", new Date(now.getTime() - 3_600_000).toISOString()); // last hour

  for (const sub of justExpired || []) {
    try {
      // Downgrade to expired
      await supabase
        .from("subscriptions")
        .update({ status: "expired" })
        .eq("user_id", sub.user_id)
        .eq("is_trial", true);

      const { data: authUser } = await supabase.auth.admin.getUserById(sub.user_id);
      const { data: profile   } = await supabase.from("profiles")
        .select("full_name").eq("user_id", sub.user_id).maybeSingle();

      if (authUser?.user?.email) {
        await supabase.functions.invoke("send-email", {
          headers: { "x-internal-secret": internalSecret },
          body: {
            type: "trial_expired",
            to:   authUser.user.email,
            name: profile?.full_name?.split(" ")[0] || "Studente",
            data: { planName: sub.plan_name },
          },
        });
        expiredSent++;
      }
    } catch (e) {
      console.error("[trial-expiry-check] expired email error:", e);
    }
  }

  return new Response(
    JSON.stringify({ success: true, warningsSent, expiredSent, checkedAt: now.toISOString() }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
