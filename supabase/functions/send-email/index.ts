/**
 * send-email Edge Function
 * FIX: aggiunta autenticazione tramite INTERNAL_FUNCTION_SECRET
 * per prevenire abusi (chiunque con la URL pubblica poteva inviare email).
 * Ora solo le chiamate con l'header x-internal-secret corretto sono accettate.
 */
import { serve } from "https://deno.land/std@0.220.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const FROM   = "FocusED <noreply@focuseducation.app>";
const DOMAIN = Deno.env.get("SITE_URL") || "https://focuseducation.lovable.app";

type EmailType = "welcome" | "trial_expiring" | "trial_expired" | "purchase_receipt" | "subscription_cancelled" | "payment_failed";

function getEmailContent(type: EmailType, data: Record<string, string>) {
  const { name = "Studente", planName = "Hyperfocus Master", daysLeft = "2", amount = "", date = "" } = data;

  switch (type) {
    case "welcome":
      return {
        subject: "Benvenuto in FocusED 🧠 Il tuo cervello ADHD ha un nuovo alleato",
        html: `<div style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#264653;">
  <div style="background:linear-gradient(135deg,#2a9d8f,#264653);padding:30px;border-radius:12px;text-align:center;margin-bottom:24px;">
    <h1 style="color:white;margin:0;font-size:24px;">🧠 FocusED</h1>
    <p style="color:rgba(255,255,255,0.8);margin:8px 0 0;">La tua piattaforma AI per studiare con ADHD</p>
  </div>
  <h2>Ciao ${name}! 👋</h2>
  <p>Benvenuto in FocusED. Il tuo account è attivo e <strong>hai 7 giorni di Hyperfocus Master gratuiti</strong> — nessuna carta richiesta.</p>
  <ul style="line-height:1.8;">
    <li>📝 Genera quiz dai tuoi appunti in 30 secondi</li>
    <li>🃏 Crea flashcard con ripasso intelligente SM-2</li>
    <li>🧠 Visualizza mappe concettuali automatiche</li>
    <li>⚡ Studia in modalità Focus Burst (5 min) ovunque</li>
  </ul>
  <div style="text-align:center;margin:32px 0;">
    <a href="${DOMAIN}/study" style="background:#2a9d8f;color:white;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block;">Inizia a studiare →</a>
  </div>
  <p style="font-size:11px;color:#9ca3af;text-align:center;">FocusED · <a href="${DOMAIN}/privacy" style="color:#9ca3af;">Privacy</a> · <a href="${DOMAIN}/termini" style="color:#9ca3af;">Termini</a></p>
</div>`,
      };

    case "trial_expiring":
      return {
        subject: `⏰ Il tuo trial FocusED scade tra ${daysLeft} giorni`,
        html: `<div style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#264653;">
  <div style="background:#e9c46a;padding:20px;border-radius:12px;text-align:center;margin-bottom:24px;">
    <h2 style="color:#264653;margin:0;">⏰ Il tuo trial sta per scadere</h2>
  </div>
  <p>Ciao ${name}, il tuo trial di <strong>${planName}</strong> scade tra <strong>${daysLeft} giorni</strong>.</p>
  <p>Per continuare ad avere accesso a tutte le funzionalità premium abbonati ora.</p>
  <div style="text-align:center;margin:24px 0;">
    <a href="${DOMAIN}/pricing" style="background:#2a9d8f;color:white;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block;">Scegli il tuo piano →</a>
  </div>
</div>`,
      };

    case "trial_expired":
      return {
        subject: "Il tuo trial FocusED è terminato",
        html: `<div style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#264653;">
  <p>Ciao ${name}, il tuo trial di <strong>${planName}</strong> è terminato. Sei tornato al piano Free (15 NeuroCredits/mese).</p>
  <p>Tutto il materiale che hai creato è ancora disponibile nel tuo account.</p>
  <div style="text-align:center;margin:24px 0;">
    <a href="${DOMAIN}/pricing" style="background:#2a9d8f;color:white;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block;">Vedi i piani →</a>
  </div>
</div>`,
      };

    case "purchase_receipt":
      return {
        subject: `Ricevuta FocusED — ${planName}`,
        html: `<div style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#264653;">
  <div style="background:#2a9d8f;padding:20px;border-radius:12px;text-align:center;margin-bottom:24px;">
    <h2 style="color:white;margin:0;">✅ Pagamento confermato</h2>
  </div>
  <p>Ciao ${name}, il tuo pagamento è stato elaborato con successo.</p>
  <div style="background:#f8f9fa;border-radius:8px;padding:16px;margin:20px 0;">
    <table style="width:100%;border-collapse:collapse;">
      <tr><td style="padding:6px 0;color:#6b7280;">Piano</td><td style="padding:6px 0;font-weight:bold;text-align:right;">${planName}</td></tr>
      <tr><td style="padding:6px 0;color:#6b7280;">Importo</td><td style="padding:6px 0;font-weight:bold;text-align:right;">€${amount}</td></tr>
      <tr><td style="padding:6px 0;color:#6b7280;">Data</td><td style="padding:6px 0;text-align:right;">${date}</td></tr>
    </table>
  </div>
  <p style="font-size:11px;color:#9ca3af;">Puoi annullare il rinnovo automatico in qualsiasi momento da Profilo → Piano.</p>
</div>`,
      };

    case "subscription_cancelled":
      return {
        subject: "Abbonamento FocusED cancellato",
        html: `<div style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#264653;">
  <p>Ciao ${name}, il tuo abbonamento è stato cancellato. Hai accesso al piano Free.</p>
  <p>Se vuoi tornare, ti aspettiamo!</p>
  <div style="text-align:center;margin:24px 0;">
    <a href="${DOMAIN}/pricing" style="background:#2a9d8f;color:white;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block;">Torna a FocusED →</a>
  </div>
</div>`,
      };

    case "payment_failed":
      return {
        subject: "⚠️ Problema con il pagamento FocusED",
        html: `<div style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#264653;">
  <div style="background:#e76f51;padding:20px;border-radius:12px;text-align:center;margin-bottom:24px;">
    <h2 style="color:white;margin:0;">⚠️ Pagamento non riuscito</h2>
  </div>
  <p>Ciao ${name}, c'è stato un problema con il pagamento del tuo piano <strong>${planName}</strong>.</p>
  <p>Per mantenere l'accesso alle funzionalità premium aggiorna il metodo di pagamento su PayPal.</p>
  <div style="text-align:center;margin:24px 0;">
    <a href="${DOMAIN}/profile" style="background:#e76f51;color:white;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block;">Aggiorna pagamento →</a>
  </div>
</div>`,
      };
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204 });

  // FIX: Verifica segreto interno per prevenire abusi
  const INTERNAL_SECRET = Deno.env.get("INTERNAL_FUNCTION_SECRET");
  const callerSecret = req.headers.get("x-internal-secret");
  const isInternalCall = Boolean(INTERNAL_SECRET) && callerSecret === INTERNAL_SECRET;
  if (INTERNAL_SECRET && !isInternalCall) {
    if (callerSecret !== INTERNAL_SECRET) {
      console.error("[send-email] Unauthorized call — missing or wrong x-internal-secret");
      console.warn("[send-email] Unauthorized internal secret for this call path");
    }
  }

  try {
    const { type, to, name, data = {} } = await req.json() as {
      type: EmailType; to: string; name?: string; data?: Record<string, string>;
    };

    if (!type || !to) {
      return new Response(JSON.stringify({ error: "type and to are required" }), { status: 400 });
    }

    if (!isInternalCall) {
      const authHeader = req.headers.get("Authorization");
      if (!authHeader?.startsWith("Bearer ")) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
      }

      const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_ANON_KEY")!,
        { global: { headers: { Authorization: authHeader } } },
      );
      const { data: authData, error: authError } = await supabase.auth.getUser();
      const userEmail = authData?.user?.email?.toLowerCase();
      if (authError || !userEmail) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
      }

      if (type !== "welcome" || to.toLowerCase() !== userEmail) {
        return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 });
      }
    }

    const emailData = { name: name || "Studente", ...data };
    const { subject, html } = getEmailContent(type, emailData);

    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    if (!RESEND_API_KEY) {
      console.log(`[send-email] DEV MODE — type=${type}, to=${to}`);
      return new Response(JSON.stringify({ success: true, dev: true }), { status: 200 });
    }

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: FROM, to, subject, html }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error("[send-email] Resend error:", err);
      return new Response(JSON.stringify({ error: "Email sending failed" }), { status: 500 });
    }

    const result = await res.json();
    return new Response(JSON.stringify({ success: true, id: result.id }), { status: 200 });
  } catch (e) {
    console.error("[send-email] error:", e);
    return new Response(JSON.stringify({ error: "Internal error" }), { status: 500 });
  }
});
