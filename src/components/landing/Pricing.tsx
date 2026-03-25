import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useTranslation } from "react-i18next";

const LandingPricing = () => {
  const navigate = useNavigate();
  const { t } = useTranslation();

  return (
    <section id="prezzi" className="py-20 md:py-28 bg-background">
      <div className="container mx-auto px-4 text-center">
        <h2 className="text-3xl md:text-4xl font-bold text-foreground">{t("landingPricing.title")}</h2>
        <p className="mt-4 text-lg text-muted-foreground max-w-xl mx-auto">{t("landingPricing.subtitle")}</p>
        <Button size="lg" className="mt-8" onClick={() => navigate("/pricing")}>{t("landingPricing.cta")}</Button>
      </div>
    </section>
  );
};

export default LandingPricing;
