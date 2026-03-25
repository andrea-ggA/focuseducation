import { serve } from "https://deno.land/std@0.220.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Webhook è server-to-server: NO CORS headers necessari
async function verifyPayPalWebhook(req: Request, body: string): Promise<boolean> {
  const PAYPAL_CLIENT_ID  = Deno.env.get("PAYPAL_CLIENT_ID");
  const PAYPAL_SECRET     = Deno.env.get("PAYPAL_SECRET");
  const PAYPAL_WEBHOOK_ID = Deno.env.get("PAYPAL_WEBHOOK_ID");
  const PAYPAL_API        = Deno.env.get("PAYPAL_ENV") === "live"
    ? "https://api-m.paypal.com"
    : "https://api-m.sandbox.paypal.com";

  if (!PAYPAL_CLIENT_ID || !PAYPAL_SECRET || !PAYPAL_WEBHOOK_ID) {
    console.error("Missing PayPal credentials for webhook verification");
    return false;
  }

  const transmissionId  = req.headers.get("paypal-transmission-id");
  const transmissionTime = req.headers.get("paypal-transmission-time");
  const transmissionSig  = req.headers.get("paypal-transmission-sig");
  const certUrl          = req.headers.get("paypal-cert-url");
  const authAlgo         = req.headers.get("paypal-auth-algo");

  if (!transmissionId || !transmissionTime || !transmissionSig || !certUrl || !authAlgo) {
    console.error("Missing PayPal webhook signature headers");
    return false;
  }

  const tokenRes = await fetch(`${PAYPAL_API}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${PAYPAL_CLIENT_ID}:${PAYPAL_SECRET}`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  if (!tokenRes.ok) return false;
  const { access_token } = await tokenRes.json();

  const verifyRes = await fetch(`${PAYPAL_API}/v1/notifications/verify-webhook-signature`, {
    method: "POST",
    headers: { Authorization: `Bearer ${access_token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      auth_algo: authAlgo, cert_url: certUrl,
      transmission_id: transmissionId, transmission_sig: transmissionSig,
      transmission_time: transmissionTime, webhook_id: PAYPAL_WEBHOOK_ID,
      webhook_event: JSON.parse(body),
    }),
  });

  if (!verifyRes.ok) return false;
  const verifyData = await verifyRes.json();
  return verifyData.verification_status === "SUCCESS";
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204 });

  try {
    const bodyText = await req.text();
    const isValid  = await verifyPayPalWebhook(req, bodyText);
    if (!isValid) {
      console.error("Invalid PayPal webhook signature - rejecting");
      return new Response(JSON.stringify({ error: "Invalid webhook signature" }), { status: 401 });
    }

    const body      = JSON.parse(bodyText);
    const eventType = body.event_type;
    const resource  = body.resource;
    console.log("PayPal webhook event (verified):", eventType);

    if (!resource?.id) {
      return new Response(JSON.stringify({ received: true }), { status: 200 });
    }

    const supabase       = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const subscriptionId = resource.id;

    switch (eventType) {
      case "BILLING.SUBSCRIPTION.ACTIVATED": {
        // FIX: status in lowercase
        await supabase.from("subscriptions").update({
          status:               "active",
          current_period_start: resource.start_time,
          current_period_end:   resource.billing_info?.next_billing_time,
        }).eq("paypal_subscription_id", subscriptionId);

        try {
          const { data: subRow } = await supabase.from("subscriptions")
            .select("user_id, plan_name").eq("paypal_subscription_id", subscriptionId).maybeSingle();
          if (subRow) {
            const { data: profile  } = await supabase.from("profiles").select("full_name").eq("user_id", subRow.user_id).maybeSingle();
            const { data: authUser } = await supabase.auth.admin.getUserById(subRow.user_id);
            if (authUser?.user?.email) {
              await supabase.functions.invoke("send-email", {
                body: {
                  type: "purchase_receipt", to: authUser.user.email,
                  name: profile?.full_name?.split(" ")[0] || "Studente",
                  data: {
                    planName: subRow.plan_name,
                    amount:   subRow.plan_name === "Hyperfocus Master" ? "14,99" : "8,99",
                    date:     new Date().toLocaleDateString("it-IT", { day: "numeric", month: "long", year: "numeric" }),
                  },
                },
              });
            }
          }
        } catch (emailErr) { console.error("Receipt email error (non-fatal):", emailErr); }
        break;
      }

      case "BILLING.SUBSCRIPTION.CANCELLED": {
        await supabase.from("subscriptions").update({ status: "cancelled" }).eq("paypal_subscription_id", subscriptionId);
        try {
          const { data: subRow } = await supabase.from("subscriptions").select("user_id").eq("paypal_subscription_id", subscriptionId).maybeSingle();
          if (subRow) {
            const { data: profile  } = await supabase.from("profiles").select("full_name").eq("user_id", subRow.user_id).maybeSingle();
            const { data: authUser } = await supabase.auth.admin.getUserById(subRow.user_id);
            if (authUser?.user?.email) {
              await supabase.functions.invoke("send-email", {
                body: { type: "subscription_cancelled", to: authUser.user.email, name: profile?.full_name?.split(" ")[0] || "Studente" },
              });
            }
          }
        } catch (e) { console.error("Cancel email error:", e); }
        break;
      }

      case "BILLING.SUBSCRIPTION.SUSPENDED":
        await supabase.from("subscriptions").update({ status: "suspended" }).eq("paypal_subscription_id", subscriptionId);
        break;

      case "BILLING.SUBSCRIPTION.EXPIRED":
        await supabase.from("subscriptions").update({ status: "expired" }).eq("paypal_subscription_id", subscriptionId);
        break;

      // FIX: Handle payment failure → mark as past_due + send dunning email
      case "BILLING.SUBSCRIPTION.PAYMENT.FAILED": {
        await supabase.from("subscriptions").update({ status: "past_due" }).eq("paypal_subscription_id", subscriptionId);
        try {
          const { data: subRow } = await supabase.from("subscriptions").select("user_id, plan_name").eq("paypal_subscription_id", subscriptionId).maybeSingle();
          if (subRow) {
            const { data: authUser } = await supabase.auth.admin.getUserById(subRow.user_id);
            const { data: profile  } = await supabase.from("profiles").select("full_name").eq("user_id", subRow.user_id).maybeSingle();
            if (authUser?.user?.email) {
              await supabase.functions.invoke("send-email", {
                body: { type: "payment_failed", to: authUser.user.email, name: profile?.full_name?.split(" ")[0] || "Studente", data: { planName: subRow.plan_name } },
              });
            }
          }
        } catch (e) { console.error("Payment failed email error:", e); }
        break;
      }

      case "PAYMENT.SALE.COMPLETED": {
        // FIX: also update current_period_end when a recurring payment completes
        const billingAgreementId = resource.billing_agreement_id;
        if (billingAgreementId) {
          await supabase.from("subscriptions").update({
            status: "active",
            current_period_end: resource.create_time
              ? new Date(new Date(resource.create_time).getTime() + 30 * 24 * 60 * 60 * 1000).toISOString()
              : undefined,
          }).eq("paypal_subscription_id", billingAgreementId);
        }
        break;
      }

      default:
        console.log("Unhandled event type:", eventType);
    }

    return new Response(JSON.stringify({ received: true }), { status: 200 });
  } catch (error) {
    console.error("Webhook error:", error);
    return new Response(JSON.stringify({ error: "Webhook processing failed" }), { status: 500 });
  }
});
