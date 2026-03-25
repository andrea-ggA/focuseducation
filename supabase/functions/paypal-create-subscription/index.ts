import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const PAYPAL_API = Deno.env.get("PAYPAL_ENV") === "live"
  ? "https://api-m.paypal.com"
  : "https://api-m.sandbox.paypal.com";

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
    // Authenticate user
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user: authUser }, error: claimsError } = await supabase.auth.getUser();
    if (claimsError || !authUser) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userId = authUser.id;
    const { plan_id } = await req.json();

    if (!plan_id) {
      return new Response(JSON.stringify({ error: "plan_id is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Plan mapping
    const planMap: Record<string, string> = {
      focus_pro_monthly: "Focus Pro",
      focus_pro_yearly: "Focus Pro",
      hyperfocus_monthly: "Hyperfocus Master",
      hyperfocus_yearly: "Hyperfocus Master",
    };

    const planName = planMap[plan_id] || plan_id;

    const accessToken = await getPayPalAccessToken();

    // Create PayPal subscription
    const subscriptionRes = await fetch(`${PAYPAL_API}/v1/billing/subscriptions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify({
        plan_id,
        plan: {
          billing_cycles: [
            {
              frequency: { interval_unit: "DAY", interval_count: 7 },
              tenure_type: "TRIAL",
              sequence: 1,
              total_cycles: 1,
              pricing_scheme: { fixed_price: { value: "0", currency_code: "EUR" } },
            },
          ],
        },
        application_context: {
          brand_name: "FocusED",
          locale: "it-IT",
          shipping_preference: "NO_SHIPPING",
          user_action: "SUBSCRIBE_NOW",
          return_url: `${req.headers.get("origin") || "https://focused.app"}/dashboard?subscription=success`,
          cancel_url: `${req.headers.get("origin") || "https://focused.app"}/#prezzi`,
        },
      }),
    });

    const subscription = await subscriptionRes.json();
    if (!subscriptionRes.ok) {
      console.error("PayPal subscription creation failed:", subscription);
      throw new Error(`PayPal error: ${JSON.stringify(subscription)}`);
    }

    // Save subscription to DB
    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    await serviceClient.from("subscriptions").insert({
      user_id: userId,
      paypal_subscription_id: subscription.id,
      plan_name: planName,
      status: "trialing",
    });

    // Find the approval link
    const approvalUrl = subscription.links?.find(
      (l: { rel: string; href: string }) => l.rel === "approve"
    )?.href;

    return new Response(
      JSON.stringify({
        subscription_id: subscription.id,
        approval_url: approvalUrl,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
