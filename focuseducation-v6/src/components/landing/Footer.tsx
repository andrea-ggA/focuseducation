import { Brain } from "lucide-react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";

const Footer = () => {
  const { t } = useTranslation();

  return (
    <footer className="border-t border-border bg-card py-12">
      <div className="container mx-auto px-4">
        <div className="flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-2 font-display font-bold text-lg text-card-foreground">
            <Brain className="h-6 w-6 text-primary" />
            FocusED
          </div>

          <div className="flex flex-wrap items-center gap-6 text-sm text-muted-foreground">
            <a href="#funzionalita" className="hover:text-foreground transition-colors">{t("footer.features")}</a>
            <a href="#prezzi" className="hover:text-foreground transition-colors">{t("footer.pricing")}</a>
            <Link to="/privacy" className="hover:text-foreground transition-colors">{t("footer.privacy")}</Link>
            <Link to="/termini" className="hover:text-foreground transition-colors">{t("footer.terms")}</Link>
            <Link to="/termini#rimborsi" className="hover:text-foreground transition-colors">Rimborsi</Link>
          </div>

          <p className="text-xs text-muted-foreground">{t("footer.copyright")}</p>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
