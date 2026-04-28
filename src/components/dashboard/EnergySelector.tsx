import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { motion } from "framer-motion";
import { Battery, Scale, Flame } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export type EnergyLevel = "low" | "balanced" | "hyperfocus";

interface EnergySelectorProps {
  value: EnergyLevel;
  onChange: (level: EnergyLevel) => void;
}

const LEVELS: { id: EnergyLevel; label: string; emoji: string; description: string; icon: typeof Battery }[] = [
  {
    id: "low",
    label: "Bassa Energia",
    emoji: "🪫",
    description: "Micro-task auto, pause frequenti, meno rumore visivo",
    icon: Battery,
  },
  {
    id: "balanced",
    label: "Bilanciato",
    emoji: "⚖️",
    description: "Layout standard con tutte le funzionalità",
    icon: Scale,
  },
  {
    id: "hyperfocus",
    label: "Iperfocus",
    emoji: "🔥",
    description: "Deep Work — nasconde distrazioni, timer 50min",
    icon: Flame,
  },
];

const EnergySelector = ({ value, onChange }: EnergySelectorProps) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);

  const handleChange = async (level: EnergyLevel) => {
    if (saving || level === value) return;
    const previousLevel = value;
    onChange(level);
    if (!user) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from("profiles")
        .update({ energy_level: level })
        .eq("user_id", user.id);
      if (error) throw error;
    } catch (error) {
      onChange(previousLevel);
      toast({
        title: "Salvataggio non riuscito",
        description: "Il tuo stato energia non è stato aggiornato. Riprova.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.08 }}
      className="bg-card rounded-xl border border-border shadow-card p-4 mb-4"
    >
      <p className="text-xs font-medium text-muted-foreground mb-3">⚡ Come ti senti oggi?</p>
      <div className="grid grid-cols-3 gap-2">
        {LEVELS.map((level) => {
          const isActive = value === level.id;
          return (
            <button
              key={level.id}
              onClick={() => handleChange(level.id)}
              disabled={saving}
              className={`relative rounded-xl border p-3 text-center transition-all ${
                isActive
                  ? "border-primary bg-primary/10 shadow-soft"
                  : "border-border hover:border-primary/30 hover:bg-secondary/50"
              }`}
            >
              <span className="text-xl block mb-1">{level.emoji}</span>
              <p className={`text-xs font-semibold ${isActive ? "text-primary" : "text-card-foreground"}`}>
                {level.label}
              </p>
              <p className="text-[10px] text-muted-foreground mt-0.5 leading-tight">{level.description}</p>
              {isActive && (
                <motion.div
                  layoutId="energy-indicator"
                  className="absolute inset-0 border-2 border-primary rounded-xl"
                  transition={{ type: "spring", stiffness: 400, damping: 30 }}
                />
              )}
            </button>
          );
        })}
      </div>
    </motion.div>
  );
};

export default EnergySelector;
