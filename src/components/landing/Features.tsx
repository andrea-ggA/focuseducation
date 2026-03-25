import { motion } from "framer-motion";
import { BookOpen, Brain, CalendarCheck, Timer, MessageCircle, Trophy } from "lucide-react";
import { useTranslation } from "react-i18next";

const container = { hidden: {}, show: { transition: { staggerChildren: 0.1 } } };
const item = { hidden: { opacity: 0, y: 24 }, show: { opacity: 1, y: 0, transition: { duration: 0.5 } } };

const Features = () => {
  const { t } = useTranslation();

  const features = [
    { icon: BookOpen, title: t("features.aiAssistant"), description: t("features.aiAssistantDesc") },
    { icon: Brain, title: t("features.adhdMode"), description: t("features.adhdModeDesc") },
    { icon: CalendarCheck, title: t("features.planner"), description: t("features.plannerDesc") },
    { icon: Timer, title: t("features.focusTools"), description: t("features.focusToolsDesc") },
    { icon: MessageCircle, title: t("features.aiTutor"), description: t("features.aiTutorDesc") },
    { icon: Trophy, title: t("features.gamification"), description: t("features.gamificationDesc") },
  ];

  return (
    <section id="funzionalita" className="py-20 md:py-28 bg-background">
      <div className="container mx-auto px-4">
        <div className="text-center max-w-2xl mx-auto mb-16">
          <h2 className="text-3xl md:text-4xl font-bold text-foreground">{t("features.title")}</h2>
          <p className="mt-4 text-lg text-muted-foreground">{t("features.subtitle")}</p>
        </div>

        <motion.div variants={container} initial="hidden" whileInView="show" viewport={{ once: true, amount: 0.2 }} className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {features.map((f) => (
            <motion.div key={f.title} variants={item} className="group rounded-xl border border-border bg-card p-6 hover:shadow-card transition-shadow">
              <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-secondary text-primary mb-4 group-hover:scale-110 transition-transform">
                <f.icon className="h-6 w-6" />
              </div>
              <h3 className="text-lg font-semibold text-card-foreground mb-2">{f.title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{f.description}</p>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
};

export default Features;
