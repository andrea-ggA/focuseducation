import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { useGamification } from "@/hooks/useGamification";
import { useCredits } from "@/hooks/useCredits";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { motion, AnimatePresence } from "framer-motion";
import { ShoppingBag, Shield, Zap, Clock, Flame, Star, Check, Package, Sparkles, Coins } from "lucide-react";

interface PowerUp {
  id: string;
  name: string;
  description: string;
  icon: React.ReactNode;
  xpCost: number;
  maxQuantity: number;
  type: string;
  color: string;
}

const POWERUPS: PowerUp[] = [
  {
    id: "streak_freeze",
    name: "Streak Freeze",
    description: "Protegge la tua streak per 1 giorno di inattività",
    icon: <Shield className="h-6 w-6" />,
    xpCost: 200,
    maxQuantity: 3,
    type: "streak_freeze",
    color: "hsl(var(--primary))",
  },
  {
    id: "xp_boost_2x",
    name: "XP Boost 2x",
    description: "Raddoppia gli XP guadagnati nel prossimo quiz",
    icon: <Zap className="h-6 w-6" />,
    xpCost: 300,
    maxQuantity: 5,
    type: "xp_boost_2x",
    color: "hsl(43, 70%, 50%)",
  },
  {
    id: "extra_time",
    name: "Tempo Extra",
    description: "+15 secondi per domanda nel prossimo quiz",
    icon: <Clock className="h-6 w-6" />,
    xpCost: 150,
    maxQuantity: 5,
    type: "extra_time",
    color: "hsl(210, 50%, 50%)",
  },
  {
    id: "streak_multiplier",
    name: "Streak Bonus",
    description: "Bonus +50% XP quando hai una streak attiva di 3+ giorni",
    icon: <Flame className="h-6 w-6" />,
    xpCost: 400,
    maxQuantity: 2,
    type: "streak_multiplier",
    color: "hsl(var(--accent))",
  },
  {
    id: "fortune_respin",
    name: "Secondo Giro",
    description: "Un giro extra alla ruota della fortuna",
    icon: <Star className="h-6 w-6" />,
    xpCost: 250,
    maxQuantity: 1,
    type: "fortune_respin",
    color: "hsl(275, 45%, 55%)",
  },
];

// Particle component for purchase celebration
const PurchaseParticles = ({ color }: { color: string }) => {
  const particles = Array.from({ length: 12 }, (_, i) => {
    const angle = (i / 12) * 360;
    const distance = 60 + Math.random() * 40;
    return {
      x: Math.cos((angle * Math.PI) / 180) * distance,
      y: Math.sin((angle * Math.PI) / 180) * distance,
      size: 4 + Math.random() * 6,
      delay: Math.random() * 0.2,
    };
  });

  return (
    <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
      {particles.map((p, i) => (
        <motion.div
          key={i}
          className="absolute rounded-full"
          style={{ background: color, width: p.size, height: p.size }}
          initial={{ x: 0, y: 0, opacity: 1, scale: 1 }}
          animate={{ x: p.x, y: p.y, opacity: 0, scale: 0 }}
          transition={{ duration: 0.8, delay: p.delay, ease: "easeOut" }}
        />
      ))}
    </div>
  );
};

const XP_TO_CREDITS_RATE = 1000; // 1000 XP = 10 NeuroCredits
const CREDITS_PER_CONVERSION = 10;

const PowerUpShop = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const { xp, refreshGamification } = useGamification();
  const { addCredits, totalCredits, refreshCredits } = useCredits();
  const [inventory, setInventory] = useState<Record<string, number>>({});
  const [purchasing, setPurchasing] = useState<string | null>(null);
  const [justPurchased, setJustPurchased] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [converting, setConverting] = useState(false);

  const fetchInventory = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from("user_powerups")
      .select("powerup_type, quantity")
      .eq("user_id", user.id);
    if (data) {
      const inv: Record<string, number> = {};
      data.forEach((r) => { inv[r.powerup_type] = r.quantity; });
      setInventory(inv);
    }
  }, [user]);

  useEffect(() => { fetchInventory(); }, [fetchInventory]);

  const purchase = async (powerup: PowerUp) => {
    if (!user || !xp) return;
    if (xp.total_xp < powerup.xpCost) {
      toast({ title: "XP insufficienti", description: `Servono ${powerup.xpCost} XP per acquistare ${powerup.name}.`, variant: "destructive" });
      return;
    }
    const currentQty = inventory[powerup.type] || 0;
    if (currentQty >= powerup.maxQuantity) {
      toast({ title: "Limite raggiunto", description: `Puoi avere massimo ${powerup.maxQuantity} ${powerup.name}.`, variant: "destructive" });
      return;
    }

    setPurchasing(powerup.id);

    // FIX: acquisto atomico server-side via RPC con whitelist prezzi
    // Previene: (1) race condition multi-tab, (2) price manipulation da client
    const { data, error } = await supabase.rpc("purchase_powerup" as any, {
      _user_id:      user.id,
      _powerup_type: powerup.type,
      _max_qty:      powerup.maxQuantity,
    });
    const result = data as any;

    if (error || !result?.success) {
      const msg = result?.error === "insufficient_xp" ? "XP insufficienti"
                : result?.error === "max_reached"     ? `Hai già il massimo di ${powerup.name}`
                : "Errore durante l'acquisto";
      toast({ title: "Errore", description: msg, variant: "destructive" });
      setPurchasing(null);
      return;
    }

    setInventory((prev) => ({ ...prev, [powerup.type]: (prev[powerup.type] || 0) + 1 }));
    await refreshGamification();
    setPurchasing(null);

    setJustPurchased(powerup.id);
    setTimeout(() => setJustPurchased(null), 1500);

    const xpAfter = result.xp_after ?? (xp.total_xp - powerup.xpCost);
    toast({
      title: `${powerup.name} acquistato! 🎉`,
      description: `Hai speso ${result.xp_cost ?? powerup.xpCost} XP. Ti rimangono ${xpAfter} XP.`,
    });
  };

  const convertXpToCredits = async () => {
    if (!user || !xp || xp.total_xp < XP_TO_CREDITS_RATE) {
      toast({ title: "XP insufficienti", description: `Servono ${XP_TO_CREDITS_RATE} XP per convertire.`, variant: "destructive" });
      return;
    }
    setConverting(true);
    // FIX: conversione atomica server-side via RPC
    const { data, error } = await supabase.rpc("convert_xp_to_credits" as any, {
      _user_id:      user.id,
      _xp_cost:      XP_TO_CREDITS_RATE,
      _credits_gain: CREDITS_PER_CONVERSION,
    });
    const convResult = data as any;
    if (error || !convResult?.success) {
      toast({ title: "Errore", description: "Conversione fallita. Riprova.", variant: "destructive" });
      setConverting(false);
      return;
    }
    await Promise.all([refreshGamification(), refreshCredits()]);
    setConverting(false);
    toast({ title: "Conversione completata! 🪙", description: `+${CREDITS_PER_CONVERSION} NeuroCredits aggiunti al tuo wallet.` });
  };

  const totalItems = Object.values(inventory).reduce((s, v) => s + v, 0);

  return (
    <div className="bg-card rounded-xl border border-border shadow-card p-6 relative overflow-hidden">
      {/* Background glow when shop is open */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 pointer-events-none"
            style={{
              background: "radial-gradient(ellipse at top right, hsl(var(--primary) / 0.05) 0%, transparent 70%)",
            }}
          />
        )}
      </AnimatePresence>

      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 w-full text-left relative z-10"
      >
        <motion.div
          animate={isOpen ? { rotate: [0, -10, 10, 0] } : {}}
          transition={{ duration: 0.5 }}
        >
          <ShoppingBag className="h-5 w-5 text-primary" />
        </motion.div>
        <h2 className="text-lg font-semibold text-card-foreground">Negozio Power-Up</h2>
        {totalItems > 0 && (
          <Badge variant="secondary" className="ml-1">
            <Package className="h-3 w-3 mr-0.5" />
            {totalItems}
          </Badge>
        )}
        <span className="ml-auto text-xs text-muted-foreground">
          {xp ? `${xp.total_xp} XP disponibili` : "..."}
        </span>
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.3, ease: "easeInOut" }}
            className="overflow-hidden relative z-10"
          >
            {/* Inventory summary */}
            {totalItems > 0 && (
              <motion.div
                initial={{ opacity: 0, y: -5 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }}
                className="mt-4 mb-3 flex flex-wrap gap-2"
              >
                {POWERUPS.filter((p) => (inventory[p.type] || 0) > 0).map((p) => (
                  <motion.div
                    key={p.id}
                    layout
                    className="flex items-center gap-1.5 bg-primary/5 border border-primary/20 rounded-lg px-2.5 py-1.5 text-xs"
                  >
                    <span className="text-primary">{p.icon}</span>
                    <span className="font-medium text-card-foreground">{p.name}</span>
                    <Badge variant="default" className="text-[10px] h-4 px-1.5">{inventory[p.type]}x</Badge>
                  </motion.div>
                ))}
              </motion.div>
            )}

            <div className="mt-4 space-y-3">
              {POWERUPS.map((powerup, i) => {
                const owned = inventory[powerup.type] || 0;
                const maxed = owned >= powerup.maxQuantity;
                const canAfford = xp ? xp.total_xp >= powerup.xpCost : false;
                const wasPurchased = justPurchased === powerup.id;

                return (
                  <motion.div
                    key={powerup.id}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{
                      opacity: 1,
                      x: 0,
                      scale: wasPurchased ? [1, 1.03, 1] : 1,
                    }}
                    transition={{ delay: i * 0.05, duration: wasPurchased ? 0.5 : 0.2 }}
                    className={`relative flex items-center gap-3 p-3 rounded-xl border transition-colors ${
                      maxed
                        ? "border-primary/20 bg-primary/5"
                        : canAfford
                          ? "border-border hover:border-primary/40 hover:bg-secondary/30"
                          : "border-border opacity-60"
                    }`}
                  >
                    {/* Purchase celebration particles */}
                    <AnimatePresence>
                      {wasPurchased && <PurchaseParticles color={powerup.color} />}
                    </AnimatePresence>

                    {/* Glow effect on purchase */}
                    <AnimatePresence>
                      {wasPurchased && (
                        <motion.div
                          initial={{ opacity: 0.8 }}
                          animate={{ opacity: 0 }}
                          exit={{ opacity: 0 }}
                          transition={{ duration: 1 }}
                          className="absolute inset-0 rounded-xl pointer-events-none"
                          style={{
                            background: `radial-gradient(ellipse at center, ${powerup.color}30 0%, transparent 70%)`,
                            boxShadow: `0 0 30px ${powerup.color}40`,
                          }}
                        />
                      )}
                    </AnimatePresence>

                    <motion.div
                      animate={wasPurchased ? { rotate: [0, -15, 15, -10, 10, 0], scale: [1, 1.3, 1] } : {}}
                      transition={{ duration: 0.6 }}
                      className={`h-10 w-10 rounded-lg flex items-center justify-center shrink-0 ${
                        maxed ? "bg-primary/10 text-primary" : "bg-secondary text-muted-foreground"
                      }`}
                    >
                      {powerup.icon}
                    </motion.div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-card-foreground">{powerup.name}</span>
                        {owned > 0 && (
                          <motion.div layout>
                            <Badge variant="outline" className="text-[10px] h-4">
                              {owned}/{powerup.maxQuantity}
                            </Badge>
                          </motion.div>
                        )}
                        {wasPurchased && (
                          <motion.span
                            initial={{ opacity: 0, scale: 0 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0 }}
                            className="text-xs font-bold text-primary"
                          >
                            <Sparkles className="h-3.5 w-3.5 inline-block mr-0.5" />
                            Acquistato!
                          </motion.span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">{powerup.description}</p>
                    </div>
                    <Button
                      size="sm"
                      variant={maxed ? "outline" : "default"}
                      disabled={maxed || !canAfford || purchasing === powerup.id}
                      onClick={() => purchase(powerup)}
                      className="shrink-0"
                    >
                      {purchasing === powerup.id ? (
                        <motion.div
                          animate={{ rotate: 360 }}
                          transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                        >
                          <Sparkles className="h-3 w-3" />
                        </motion.div>
                      ) : maxed ? (
                        <><Check className="h-3 w-3 mr-1" /> Max</>
                      ) : (
                        <><Star className="h-3 w-3 mr-1" /> {powerup.xpCost} XP</>
                      )}
                    </Button>
                  </motion.div>
                );
              })}
            </div>

            {/* XP to Credits conversion */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.3 }}
              className="mt-4 pt-4 border-t border-border"
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-card-foreground flex items-center gap-1.5">
                    <Coins className="h-4 w-4 text-accent" /> Converti XP → NeuroCredits
                  </p>
                  <p className="text-xs text-muted-foreground">{XP_TO_CREDITS_RATE} XP = {CREDITS_PER_CONVERSION} NeuroCredits</p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={converting || !xp || xp.total_xp < XP_TO_CREDITS_RATE}
                  onClick={convertXpToCredits}
                >
                  {converting ? <Sparkles className="h-3 w-3 animate-spin" /> : <><Coins className="h-3 w-3 mr-1" /> Converti</>}
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default PowerUpShop;
