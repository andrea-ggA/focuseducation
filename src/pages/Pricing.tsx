import { useState } from "react";
import { motion } from "framer-motion";
import { Check, X, Loader2, ArrowLeft, Zap, Crown, Sparkles, ShoppingCart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "react-i18next";
import AppHeader from "@/components/AppHeader";
import LanguageSelector from "@/components/LanguageSelector";

const planConfigs = [
  {
    nameKey: "Free", monthlyPrice: "0", yearlyPrice: null, yearlyMonthly: null,
    descKey: "freePlanDesc", credits: 15, featuresKey: "free_features",
    popular: false, icon: Zap, planIds: { monthly: "free", yearly: null },
  },
  {
    nameKey: "Focus Pro", monthlyPrice: "8,99", yearlyPrice: "89,99", yearlyMonthly: "7,50",
    descKey: "proDesc", credits: 250, featuresKey: "pro_features",
    popular: true, icon: Crown, planIds: { monthly: "focus_pro_monthly", yearly: "focus_pro_yearly" },
  },
  {
    nameKey: "Hyperfocus Master", monthlyPrice: "14,99", yearlyPrice: "149,99", yearlyMonthly: "12,50",
    descKey: "masterDesc", credits: 700, featuresKey: "master_features",
    popular: false, icon: Sparkles, planIds: { monthly: "hyperfocus_monthly", yearly: "hyperfocus_yearly" },
  },
];

const creditPacks = [
  { amount: 50, price: "2,99", emoji: "⚡" },
  { amount: 150, price: "6,99", emoji: "🔋", popular: true },
  { amount: 500, price: "19,99", emoji: "🚀" },
];

const matrixKeys = [
  { key: "pomodoroTimer", free: true, pro: true, master: true },
  { key: "taskManager", free: true, pro: true, master: true },
  { key: "basicQuiz", free: true, pro: true, master: true },
  { key: "aiTutor", free: true, pro: true, master: true },
  { key: "creditsMonth", free: "15", pro: "250", master: "700" },
  { key: "docUpload", free: "onePerDay", pro: "unlimited", master: "unlimited" },
  { key: "creditRollover", free: false, pro: true, master: true },
  { key: "aiFlashcards", free: true, pro: true, master: true },
  { key: "mindMaps", free: false, pro: true, master: true },
  { key: "youtubeImport", free: false, pro: true, master: true },
  { key: "pdfExport", free: false, pro: true, master: true },
  { key: "tutorDocs", free: false, pro: false, master: true },
  { key: "gamifiedQuiz", free: false, pro: false, master: true },
  
  { key: "summaries", free: false, pro: false, master: true },
  { key: "outlines", free: false, pro: false, master: true },
  { key: "smartNotes", free: false, pro: false, master: true },
  { key: "xpBoost", free: false, pro: false, master: true },
  { key: "prioritySupport", free: false, pro: false, master: true },
];

const creditActions = [
  { key: "youtubeTranscript", cost: 15, emoji: "🎬" },
  { key: "mindMap", cost: 10, emoji: "🧠" },
  { key: "aiQuiz", cost: 5, emoji: "📝" },
  { key: "summaryGen", cost: 5, emoji: "📄" },
  { key: "audioTranscription", cost: 5, emoji: "🎙️" },
  { key: "taskDecomposition", cost: 2, emoji: "📋" },
  { key: "tutorMessage", cost: 1, emoji: "💬" },
];

const Pricing = () => {
  const [yearly, setYearly] = useState(false);
  const [loadingPlan, setLoadingPlan] = useState<string | null>(null);
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { t } = useTranslation();

  const handleSubscribe = async (plan: typeof planConfigs[0]) => {
    if (plan.nameKey === "Free") return;
    if (!user) { navigate("/auth"); return; }
    const planId = yearly ? plan.planIds.yearly : plan.planIds.monthly;
    if (!planId) return;
    setLoadingPlan(planId);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await supabase.functions.invoke("paypal-create-subscription", {
        body: { plan_id: planId },
        headers: { Authorization: `Bearer ${session?.access_token}` },
      });
      if (res.error) throw new Error(res.error.message);
      const { approval_url } = res.data;
      if (approval_url) window.location.href = approval_url;
      else throw new Error("No approval URL returned");
    } catch (error) {
      console.error("Subscription error:", error);
      toast({ title: t("pricing.errorTitle"), description: t("pricing.errorDesc"), variant: "destructive" });
    } finally {
      setLoadingPlan(null);
    }
  };

  const handleBuyCredits = (amount: number) => {
    toast({
      title: t("pricing.comingSoon"),
      description: t("pricing.comingSoonDesc", { amount }),
    });
  };

  const renderCellValue = (val: boolean | string) => {
    if (val === true) return <Check className="h-4 w-4 text-primary mx-auto" />;
    if (val === false) return <X className="h-4 w-4 text-muted-foreground/40 mx-auto" />;
    // Handle special translation keys
    if (val === "onePerDay" || val === "unlimited") {
      return <span className="text-xs font-medium text-card-foreground">{t(`pricing.matrix.${val}`)}</span>;
    }
    return <span className="text-xs font-medium text-card-foreground">{val}</span>;
  };

  return (
    <div className="min-h-screen bg-background">
      {user ? <AppHeader /> : (
        <nav className="sticky top-0 z-50 bg-background/80 backdrop-blur-lg border-b border-border/50">
          <div className="container mx-auto flex items-center justify-between h-16 px-4">
            <Link to="/" className="flex items-center gap-2 font-display font-bold text-xl text-foreground">
              <Zap className="h-7 w-7 text-primary" />
              <span>FocusED</span>
            </Link>
            <div className="flex items-center gap-3">
              <LanguageSelector />
              <Button variant="ghost" size="sm" asChild>
                <Link to="/">{t("pricing.home")}</Link>
              </Button>
              <Button size="sm" asChild>
                <Link to="/auth">{t("nav.tryFree")}</Link>
              </Button>
            </div>
          </div>
        </nav>
      )}

      <main className="container mx-auto px-4 py-12 max-w-5xl">
        {user && (
          <div className="mb-6">
            <Button variant="ghost" size="sm" asChild>
              <Link to="/dashboard"><ArrowLeft className="h-4 w-4 mr-2" /> {t("pricing.dashboard")}</Link>
            </Button>
          </div>
        )}

        <div className="text-center max-w-2xl mx-auto mb-12">
          <h1 className="text-3xl md:text-4xl font-bold text-foreground">{t("pricing.title")}</h1>
          <p className="mt-4 text-lg text-muted-foreground">{t("pricing.subtitle")}</p>

          <div className="mt-8 inline-flex items-center gap-3 rounded-full bg-secondary p-1 relative">
            <button onClick={() => setYearly(false)}
              className={`rounded-full px-5 py-2 text-sm font-medium transition-all ${!yearly ? "bg-primary text-primary-foreground shadow-soft" : "text-muted-foreground hover:text-foreground"}`}>
              {t("pricing.monthly")}
            </button>
            <button onClick={() => setYearly(true)}
              className={`rounded-full px-5 py-2 text-sm font-medium transition-all ${yearly ? "bg-primary text-primary-foreground shadow-soft" : "text-muted-foreground hover:text-foreground"}`}>
              {t("pricing.yearly")}
            </button>
            {yearly && (
              <Badge className="absolute -top-3 -right-2 bg-accent text-accent-foreground text-[10px] px-2 py-0.5 animate-pulse">{t("pricing.yearlyBadge")}</Badge>
            )}
          </div>
          {yearly && <p className="text-xs text-accent font-medium mt-3">{t("pricing.yearlySave")}</p>}
        </div>

        {/* Plans */}
        <div className="grid md:grid-cols-3 gap-6">
          {planConfigs.map((plan, i) => {
            const currentPlanId = yearly ? plan.planIds.yearly : plan.planIds.monthly;
            const isLoading = loadingPlan === currentPlanId;
            const isFree = plan.nameKey === "Free";
            const Icon = plan.icon;
            const features = t(`pricing.${plan.featuresKey}`, { returnObjects: true }) as string[];
            return (
              <motion.div key={plan.nameKey} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.1, duration: 0.5 }}
                className={`relative rounded-2xl border p-6 flex flex-col ${plan.popular ? "border-primary bg-card shadow-soft scale-[1.03]" : "border-border bg-card"}`}>
                {plan.popular && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-accent px-4 py-1 text-xs font-bold text-accent-foreground">{t("pricing.mostPopular")}</div>
                )}
                <div className="flex items-center gap-2 mb-1">
                  <Icon className={`h-5 w-5 ${plan.popular ? "text-primary" : "text-muted-foreground"}`} />
                  <h3 className="text-xl font-bold text-card-foreground">{plan.nameKey}</h3>
                </div>
                <p className="text-sm text-muted-foreground">{t(`pricing.${plan.descKey}`)}</p>
                <div className="mt-6 mb-2">
                  <span className="text-4xl font-extrabold text-card-foreground">€{isFree ? "0" : yearly && plan.yearlyMonthly ? plan.yearlyMonthly : plan.monthlyPrice}</span>
                  {!isFree && <span className="text-sm text-muted-foreground">{t("pricing.perMonth")}</span>}
                  {yearly && plan.yearlyPrice && <p className="text-xs text-muted-foreground mt-1">€{plan.yearlyPrice} {t("pricing.billedYearly")}</p>}
                </div>
                <div className="mb-6"><Badge variant="secondary" className="text-xs"><Zap className="h-3 w-3 mr-1" />{plan.credits} {t("pricing.creditsPerMonth")}</Badge></div>
                <ul className="space-y-3 mb-8 flex-1">
                  {Array.isArray(features) && features.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-sm text-card-foreground"><Check className="h-4 w-4 text-primary mt-0.5 shrink-0" />{f}</li>
                  ))}
                </ul>
                <Button className="w-full" variant={plan.popular ? "default" : "outline"} onClick={() => handleSubscribe(plan)} disabled={isLoading || isFree}>
                  {isFree ? t("pricing.currentPlan") : isLoading ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />{t("pricing.redirecting")}</> : t("pricing.tryFree7")}
                </Button>
                {!isFree && (
                  <p className="text-[10px] text-muted-foreground text-center mt-2">{t("pricing.paymentNote")}</p>
                )}
                {!isFree && (
                  <p className="text-[10px] text-muted-foreground text-center mt-1">
                    <a href="/termini#rimborsi" className="underline underline-offset-2 hover:text-foreground transition-colors">
                      Politica di rimborso
                    </a>
                    {" · "}
                    <a href="/termini" className="underline underline-offset-2 hover:text-foreground transition-colors">
                      Termini
                    </a>
                  </p>
                )}
              </motion.div>
            );
          })}
        </div>

        {/* Feature comparison table */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 }} className="mt-16">
          <h2 className="text-2xl font-bold text-foreground text-center mb-8">{t("pricing.comparePlans")}</h2>
          <div className="bg-card rounded-2xl border border-border overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-secondary/30">
                    <th className="text-left p-4 font-medium text-muted-foreground">{t("pricing.featureCol")}</th>
                    <th className="text-center p-4 font-semibold text-card-foreground">Free</th>
                    <th className="text-center p-4 font-semibold text-primary">Focus Pro</th>
                    <th className="text-center p-4 font-semibold text-card-foreground">Hyperfocus</th>
                  </tr>
                </thead>
                <tbody>
                  {matrixKeys.map((row, i) => (
                    <tr key={row.key} className={`border-b border-border/50 ${i % 2 === 0 ? "" : "bg-secondary/10"}`}>
                      <td className="p-4 text-card-foreground font-medium">{t(`pricing.matrix.${row.key}`)}</td>
                      <td className="p-4 text-center">{renderCellValue(row.free)}</td>
                      <td className="p-4 text-center">{renderCellValue(row.pro)}</td>
                      <td className="p-4 text-center">{renderCellValue(row.master)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </motion.div>

        {/* Credit Recharge Section */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }} className="mt-16" id="ricarica">
          <div className="text-center mb-8">
            <h2 className="text-2xl font-bold text-foreground flex items-center justify-center gap-2">
              <ShoppingCart className="h-6 w-6 text-primary" /> {t("pricing.rechargeTitle")}
            </h2>
            <p className="text-sm text-muted-foreground mt-2">{t("pricing.rechargeSubtitle")}</p>
          </div>
          <div className="grid sm:grid-cols-3 gap-4 max-w-2xl mx-auto">
            {creditPacks.map((pack) => (
              <div key={pack.amount}
                className={`relative rounded-2xl border p-6 text-center bg-card transition-all hover:border-primary/50 ${pack.popular ? "border-primary shadow-soft" : "border-border"}`}>
                {pack.popular && (
                  <Badge className="absolute -top-2.5 left-1/2 -translate-x-1/2 bg-accent text-accent-foreground text-[10px]">{t("pricing.mostChosen")}</Badge>
                )}
                <p className="text-3xl mb-1">{pack.emoji}</p>
                <p className="text-2xl font-extrabold text-card-foreground">{pack.amount}</p>
                <p className="text-xs text-muted-foreground mb-3">NeuroCredits</p>
                <p className="text-lg font-bold text-card-foreground mb-4">€{pack.price}</p>
                <Button className="w-full" variant={pack.popular ? "default" : "outline"} onClick={() => handleBuyCredits(pack.amount)}>
                  <Zap className="h-4 w-4 mr-1" /> {t("pricing.buy")}
                </Button>
              </div>
            ))}
          </div>
        </motion.div>

        {/* Credit cost table */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }} className="mt-16 max-w-lg mx-auto">
          <h3 className="text-lg font-bold text-foreground text-center mb-4">{t("pricing.creditCostTitle")}</h3>
          <div className="bg-card rounded-xl border border-border p-4 space-y-2">
            {creditActions.map((item) => (
              <div key={item.key} className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-secondary/50">
                <span className="text-sm text-card-foreground">{item.emoji} {t(`pricing.creditActions.${item.key}`)}</span>
                <Badge variant="outline" className="text-xs">{item.cost} cr</Badge>
              </div>
            ))}
          </div>
        </motion.div>
      </main>
    </div>
  );
};

export default Pricing;
