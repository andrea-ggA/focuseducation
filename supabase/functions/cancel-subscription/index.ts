import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// FIX #7: Use PAYPAL_ENV instead of hardcoded sandbox URL
const PAYPAL_API =
  Deno.env.get("PAYPAL_ENV") === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";

async function getPayPalAccessToken(): Promise<string> {
  const clientId = Deno.env.get("PAYPAL_CLIENT_ID");
  const secret = Deno.env.get("PAYPAL_SECRET");
  if (!clientId || !secret) throw new Error("PayPal credentials not configured");

  const res = await fetch(`${PAYPAL_API}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${clientId}:${secret}`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  const data = await res.json();
  if (!res.ok) throw new Error(`PayPal auth failed: ${JSON.stringify(data)}`);
  return data.access_token;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });

    const {
      data: { user: authUser },
      error: userError,
    } = await supabase.auth.getUser();
    if (userError || !authUser) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const user = { id: authUser.id };

    const { data: sub, error: subError } = await supabase
      .from("subscriptions")
      .select("id, paypal_subscription_id, status")
      .eq("user_id", user.id)
      .in("status", ["active", "trialing", "ACTIVE", "APPROVAL_PENDING"])
      .maybeSingle();

    if (subError || !sub) {
      return new Response(JSON.stringify({ error: "No active subscription found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (sub.paypal_subscription_id) {
      const accessToken = await getPayPalAccessToken();
      const cancelRes = await fetch(`${PAYPAL_API}/v1/billing/subscriptions/${sub.paypal_subscription_id}/cancel`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ reason: "User requested cancellation from website" }),
      });

      if (!cancelRes.ok && cancelRes.status !== 204) {
        const err = await cancelRes.text();
        console.error("PayPal cancel failed:", err);
        throw new Error("Failed to cancel PayPal subscription");
      }
    }

    const serviceClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    await serviceClient.from("subscriptions").update({ status: "cancelled" }).eq("id", sub.id);

    return new Response(JSON.stringify({ success: true, message: "Subscription cancelled" }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
