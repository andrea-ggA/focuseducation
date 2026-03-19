import { motion } from "framer-motion";
import { ArrowRight, Sparkles, Brain, Zap, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import heroImage from "@/assets/hero-illustration.png";

const Hero = () => {
  const { t } = useTranslation();

  return (
    <section className="relative pt-24 pb-16 md:pt-32 md:pb-24 bg-gradient-hero overflow-hidden">
      <div className="container mx-auto px-4">
        <div className="grid lg:grid-cols-2 gap-12 items-center">
          <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, ease: "easeOut" }} className="text-center lg:text-left">
            <div className="inline-flex items-center gap-2 rounded-full bg-secondary px-4 py-1.5 text-xs font-semibold text-secondary-foreground mb-6">
              <Sparkles className="h-3.5 w-3.5" />
              {t("hero.badge")}
            </div>

            <h1 className="text-4xl md:text-5xl lg:text-6xl font-extrabold leading-tight tracking-tight text-foreground">
              {t("hero.title")}{" "}
              <span className="text-gradient-primary">{t("hero.titleHighlight")}</span>
            </h1>

            <p className="mt-6 text-lg md:text-xl text-muted-foreground max-w-xl mx-auto lg:mx-0 leading-relaxed">
              {t("hero.subtitle")}
            </p>

            <div className="mt-8 flex flex-col sm:flex-row gap-4 justify-center lg:justify-start">
              <Button size="lg" className="shadow-soft group text-base px-8" asChild>
                <Link to="/auth">
                  {t("hero.cta")}
                  <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
                </Link>
              </Button>
              <Button variant="outline" size="lg" className="text-base" onClick={() => document.getElementById("funzionalita")?.scrollIntoView({ behavior: "smooth" })}>
                {t("hero.ctaSecondary")}
              </Button>
            </div>

            <p className="mt-4 text-xs text-muted-foreground">
              {t("hero.noCreditCard")}
            </p>

            {/* Trust badges */}
            <div className="mt-8 flex flex-wrap items-center gap-6 justify-center lg:justify-start">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Brain className="h-4 w-4 text-primary" />
                <span className="text-xs font-medium">Progettato per ADHD</span>
              </div>
              <div className="flex items-center gap-2 text-muted-foreground">
                <Zap className="h-4 w-4 text-accent" />
                <span className="text-xs font-medium">Quiz in 30 secondi</span>
              </div>
              <div className="flex items-center gap-2 text-muted-foreground">
                <Shield className="h-4 w-4 text-primary" />
                <span className="text-xs font-medium">100% in italiano</span>
              </div>
            </div>
          </motion.div>

          <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.8, delay: 0.2, ease: "easeOut" }} className="flex justify-center">
            <img src={heroImage} alt={t("hero.heroAlt")} className="w-full max-w-lg rounded-2xl shadow-card animate-float" />
          </motion.div>
        </div>
      </div>
    </section>
  );
};

export default Hero;
