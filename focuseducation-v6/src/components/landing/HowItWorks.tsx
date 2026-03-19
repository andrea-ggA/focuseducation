import { motion } from "framer-motion";
import { useTranslation } from "react-i18next";

const HowItWorks = () => {
  const { t } = useTranslation();

  const steps = [
    { number: "01", title: t("howItWorks.step1"), description: t("howItWorks.step1Desc") },
    { number: "02", title: t("howItWorks.step2"), description: t("howItWorks.step2Desc") },
    { number: "03", title: t("howItWorks.step3"), description: t("howItWorks.step3Desc") },
    { number: "04", title: t("howItWorks.step4"), description: t("howItWorks.step4Desc") },
  ];

  return (
    <section id="come-funziona" className="py-20 md:py-28 bg-secondary/40">
      <div className="container mx-auto px-4">
        <div className="text-center max-w-2xl mx-auto mb-16">
          <h2 className="text-3xl md:text-4xl font-bold text-foreground">{t("howItWorks.title")}</h2>
          <p className="mt-4 text-lg text-muted-foreground">{t("howItWorks.subtitle")}</p>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-8">
          {steps.map((step, i) => (
            <motion.div key={step.number} initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.15, duration: 0.5 }} className="text-center">
              <div className="text-5xl font-extrabold text-primary/20 mb-3 font-display">{step.number}</div>
              <h3 className="text-lg font-semibold text-foreground mb-2">{step.title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{step.description}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default HowItWorks;
