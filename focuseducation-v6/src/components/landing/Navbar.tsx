import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Brain, Menu, X, Sun, Moon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { useTheme } from "next-themes";
import { useTranslation } from "react-i18next";
import LanguageSelector from "@/components/LanguageSelector";

const Navbar = () => {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { resolvedTheme, setTheme } = useTheme();
  const { t } = useTranslation();

  const navLinks = [
    { label: t("nav.features"), href: "#funzionalita" },
    { label: t("nav.pricing"), href: "#prezzi" },
    { label: t("nav.howItWorks"), href: "#come-funziona" },
  ];

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-background/80 backdrop-blur-lg border-b border-border/50">
      <div className="container mx-auto flex items-center justify-between h-16 px-4">
        <a href="/" className="flex items-center gap-2 font-display font-bold text-xl text-foreground">
          <Brain className="h-7 w-7 text-primary" />
          <span>FocusED</span>
        </a>

        {/* Desktop */}
        <div className="hidden md:flex items-center gap-8">
          {navLinks.map((l) => (
            <a key={l.href} href={l.href} className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
              {l.label}
            </a>
          ))}
        </div>

        <div className="hidden md:flex items-center gap-2">
          <LanguageSelector />
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")} aria-label="Cambia tema">
            {resolvedTheme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>
          <Button variant="ghost" size="sm" asChild>
            <Link to="/auth">{t("nav.login")}</Link>
          </Button>
          <Button size="sm" asChild>
            <Link to="/auth">{t("nav.tryFree")}</Link>
          </Button>
        </div>

        {/* Mobile toggle */}
        <button className="md:hidden text-foreground" onClick={() => setMobileOpen(!mobileOpen)} aria-label="Menu">
          {mobileOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
        </button>
      </div>

      {/* Mobile menu */}
      <AnimatePresence>
        {mobileOpen && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="md:hidden bg-background border-b border-border overflow-hidden">
            <div className="flex flex-col gap-4 p-4">
              {navLinks.map((l) => (
                <a key={l.href} href={l.href} className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors" onClick={() => setMobileOpen(false)}>
                  {l.label}
                </a>
              ))}
              <div className="flex items-center gap-2 pt-2">
                <LanguageSelector />
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}>
                  {resolvedTheme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                </Button>
              </div>
              <div className="flex gap-3 pt-2">
                <Button variant="ghost" size="sm" className="flex-1" asChild>
                  <Link to="/auth">{t("nav.login")}</Link>
                </Button>
                <Button size="sm" className="flex-1" asChild>
                  <Link to="/auth">{t("nav.tryFree")}</Link>
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </nav>
  );
};

export default Navbar;
