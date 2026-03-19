/**
 * FocusModeToggle — pulsante che nasconde tutti i widget di gamification
 * (Fortune Wheel, PowerUp Shop, WeeklyChallenges, badges) e riduce la
 * Dashboard allo stretto necessario per studiare.
 *
 * Fondamentale per utenti ADHD che si distraggono con la gamification
 * proprio quando devono studiare sul serio.
 *
 * Persiste in sessionStorage per la sessione corrente.
 */
import { motion } from "framer-motion";
import { Focus, Layers } from "lucide-react";
import { Button } from "@/components/ui/button";

interface FocusModeToggleProps {
  active: boolean;
  onToggle: () => void;
}

export default function FocusModeToggle({ active, onToggle }: FocusModeToggleProps) {
  return (
    <Button
      variant={active ? "default" : "outline"}
      size="sm"
      onClick={onToggle}
      className={`gap-1.5 h-8 text-xs font-medium transition-all ${
        active
          ? "bg-primary text-primary-foreground shadow-md"
          : "text-muted-foreground hover:text-foreground"
      }`}
      title={active ? "Disattiva Focus Mode — mostra tutti i widget" : "Attiva Focus Mode — nascondi distrazioni"}
    >
      <motion.div
        animate={{ rotate: active ? 0 : 0, scale: active ? 1.1 : 1 }}
        transition={{ type: "spring", stiffness: 300 }}
      >
        {active ? <Focus className="h-3.5 w-3.5" /> : <Layers className="h-3.5 w-3.5" />}
      </motion.div>
      <span className="hidden sm:inline">{active ? "Focus Mode" : "Focus Mode"}</span>
      {active && (
        <motion.span
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          className="h-1.5 w-1.5 rounded-full bg-green-400"
        />
      )}
    </Button>
  );
}
