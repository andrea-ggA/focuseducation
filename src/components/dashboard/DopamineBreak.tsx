import { useState } from "react";
import { motion } from "framer-motion";
import { CheckCircle2 } from "lucide-react";

interface DopamineBreakProps {
  onActivityDone: (activity: string) => void;
}

const BREAK_ACTIVITIES = [
  { emoji: "🤸", label: "Stretching", description: "2 min di allungamento" },
  { emoji: "💧", label: "Idratazione", description: "Bevi un bicchiere d'acqua" },
  { emoji: "🧹", label: "Micro-ordine", description: "Riordina la scrivania 30 sec" },
];

const DopamineBreak = ({ onActivityDone }: DopamineBreakProps) => {
  const [completed, setCompleted] = useState<Set<string>>(new Set());

  const toggle = (label: string) => {
    if (completed.has(label)) return;
    setCompleted((prev) => new Set(prev).add(label));
    onActivityDone(label);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="mt-4 space-y-2"
    >
      <p className="text-xs font-medium text-muted-foreground mb-2">
        🧠 Pausa dopamina — scegli un'attività sana:
      </p>
      <div className="grid grid-cols-3 gap-2">
        {BREAK_ACTIVITIES.map((act) => {
          const done = completed.has(act.label);
          return (
            <button
              key={act.label}
              onClick={() => toggle(act.label)}
              className={`rounded-lg border p-2.5 text-center transition-all ${
                done
                  ? "border-primary/30 bg-primary/5"
                  : "border-border hover:border-primary/30 hover:bg-secondary/50"
              }`}
            >
              <span className="text-lg block">{act.emoji}</span>
              <p className="text-[10px] font-semibold text-card-foreground mt-1">{act.label}</p>
              {done && <CheckCircle2 className="h-3 w-3 text-primary mx-auto mt-1" />}
            </button>
          );
        })}
      </div>
      <p className="text-[10px] text-muted-foreground text-center">
        +20 XP bonus se torni in tempo! ⏰
      </p>
    </motion.div>
  );
};

export default DopamineBreak;
