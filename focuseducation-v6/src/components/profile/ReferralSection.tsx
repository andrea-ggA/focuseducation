import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import {
  Gift, Copy, Share2, Check, Users, Zap, ArrowRight,
  Twitter, MessageCircle, Mail,
} from "lucide-react";

interface ReferralData {
  code:             string;
  times_used:       number;
  max_uses:         number;
  discount_percent: number;
  credits_earned:   number;
  friends_joined:   number;
}

export default function ReferralSection() {
  const { user }              = useAuth();
  const { toast }             = useToast();
  const [data, setData]       = useState<ReferralData | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied]   = useState<"code" | "link" | null>(null);
  const [generating, setGenerating] = useState(false);

  const referralLink = data ? `${window.location.origin}/auth?ref=${data.code}` : "";

  const load = useCallback(async () => {
    if (!user) return;
    const { data: row } = await supabase
      .from("referral_codes")
      .select("code, times_used, max_uses, discount_percent, credits_earned, friends_joined")
      .eq("user_id", user.id)
      .maybeSingle();
    if (row) setData(row as ReferralData);
    setLoading(false);
  }, [user]);

  useEffect(() => { load(); }, [load]);

  const generate = async () => {
    if (!user) return;
    setGenerating(true);
    const code = `FOCUSED-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
    const { error } = await supabase.from("referral_codes").insert({
      user_id: user.id, code, discount_percent: 20, max_uses: 10,
    });
    if (!error) {
      toast({ title: "🎉 Codice creato!", description: `Il tuo codice: ${code}` });
      await load();
    }
    setGenerating(false);
  };

  const copy = async (type: "code" | "link") => {
    await navigator.clipboard.writeText(type === "code" ? data!.code : referralLink);
    setCopied(type);
    setTimeout(() => setCopied(null), 2000);
    toast({ title: type === "code" ? "Codice copiato!" : "Link copiato!" });
  };

  const shareVia = (channel: "whatsapp" | "twitter" | "email") => {
    const msg = `Studia meglio con FocusED — la piattaforma AI per studenti con ADHD! Usa il mio codice ${data?.code} e otteniamo entrambi crediti bonus 🎓`;
    const urls: Record<string, string> = {
      whatsapp: `https://wa.me/?text=${encodeURIComponent(msg + "\n" + referralLink)}`,
      twitter:  `https://twitter.com/intent/tweet?text=${encodeURIComponent(msg)}&url=${encodeURIComponent(referralLink)}`,
      email:    `mailto:?subject=Ti invito su FocusED&body=${encodeURIComponent(msg + "\n\n" + referralLink)}`,
    };
    window.open(urls[channel], "_blank");
  };

  if (loading) return <div className="h-32 animate-pulse bg-secondary rounded-xl" />;

  return (
    <div className="bg-card rounded-xl border border-border shadow-card p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-xl bg-accent/10 flex items-center justify-center">
          <Gift className="h-5 w-5 text-accent" />
        </div>
        <div>
          <h3 className="text-base font-semibold text-card-foreground">Invita i tuoi amici</h3>
          <p className="text-xs text-muted-foreground">Tu e il tuo amico ricevete 50 NeuroCredits bonus</p>
        </div>
      </div>

      {!data ? (
        /* No code yet */
        <div className="text-center py-4 space-y-3">
          <p className="text-sm text-muted-foreground">Non hai ancora un codice referral personale</p>
          <Button onClick={generate} disabled={generating} className="gap-2">
            <Gift className="h-4 w-4" />
            {generating ? "Generazione..." : "Genera il tuo codice"}
          </Button>
        </div>
      ) : (
        <>
          {/* Stats */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { icon: Users, label: "Amici invitati", value: data.friends_joined },
              { icon: Zap,   label: "Crediti guadagnati", value: data.credits_earned },
              { icon: Share2,label: "Utilizzi rimasti", value: Math.max(0, data.max_uses - data.times_used) },
            ].map((s) => (
              <div key={s.label} className="bg-secondary/50 rounded-xl p-3 text-center">
                <s.icon className="h-4 w-4 text-primary mx-auto mb-1" />
                <p className="text-xl font-bold text-card-foreground">{s.value}</p>
                <p className="text-[10px] text-muted-foreground leading-tight">{s.label}</p>
              </div>
            ))}
          </div>

          {/* Code display */}
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Il tuo codice</label>
            <div className="flex items-center gap-2 bg-secondary/50 rounded-lg p-3 border border-border">
              <code className="font-mono font-bold text-card-foreground flex-1 text-sm tracking-widest">
                {data.code}
              </code>
              <button
                onClick={() => copy("code")}
                className="text-muted-foreground hover:text-primary transition-colors p-1"
              >
                <AnimatePresence mode="wait">
                  {copied === "code"
                    ? <motion.div key="check" initial={{ scale: 0 }} animate={{ scale: 1 }}><Check className="h-4 w-4 text-primary" /></motion.div>
                    : <motion.div key="copy" initial={{ scale: 0 }} animate={{ scale: 1 }}><Copy className="h-4 w-4" /></motion.div>
                  }
                </AnimatePresence>
              </button>
            </div>
          </div>

          {/* Link */}
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Link invito</label>
            <div className="flex items-center gap-2 bg-secondary/30 rounded-lg px-3 py-2 border border-border">
              <p className="text-xs text-muted-foreground flex-1 truncate font-mono">{referralLink}</p>
              <button onClick={() => copy("link")} className="text-muted-foreground hover:text-primary transition-colors p-1 shrink-0">
                <AnimatePresence mode="wait">
                  {copied === "link"
                    ? <motion.div key="check" initial={{ scale: 0 }} animate={{ scale: 1 }}><Check className="h-3.5 w-3.5 text-primary" /></motion.div>
                    : <motion.div key="copy" initial={{ scale: 0 }} animate={{ scale: 1 }}><Copy className="h-3.5 w-3.5" /></motion.div>
                  }
                </AnimatePresence>
              </button>
            </div>
          </div>

          {/* Share buttons */}
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Condividi via</label>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" className="flex-1 gap-1.5 text-green-600 border-green-500/30 hover:bg-green-500/10" onClick={() => shareVia("whatsapp")}>
                <MessageCircle className="h-4 w-4" /> WhatsApp
              </Button>
              <Button variant="outline" size="sm" className="flex-1 gap-1.5 text-sky-500 border-sky-500/30 hover:bg-sky-500/10" onClick={() => shareVia("twitter")}>
                <Twitter className="h-4 w-4" /> Twitter
              </Button>
              <Button variant="outline" size="sm" className="flex-1 gap-1.5 text-muted-foreground" onClick={() => shareVia("email")}>
                <Mail className="h-4 w-4" /> Email
              </Button>
            </div>
          </div>

          {/* How it works */}
          <div className="bg-primary/5 border border-primary/20 rounded-xl p-3 space-y-2">
            <p className="text-xs font-semibold text-card-foreground">Come funziona</p>
            {[
              "Il tuo amico si registra con il tuo codice",
              "Entrambi ricevete 50 NeuroCredits bonus subito",
              "Ogni ulteriore upgrade del tuo amico ti dà +20 crediti",
            ].map((step, i) => (
              <div key={i} className="flex items-start gap-2">
                <span className="h-4 w-4 rounded-full bg-primary text-primary-foreground text-[9px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                  {i + 1}
                </span>
                <p className="text-xs text-muted-foreground">{step}</p>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
