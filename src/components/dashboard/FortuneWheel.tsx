import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Star, X, Trophy, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useCredits } from "@/hooks/useCredits";
import { useGamification } from "@/hooks/useGamification";
import { useToast } from "@/hooks/use-toast";
import confetti from "canvas-confetti";

// PRIZES array mantenuto identico — usato SOLO per l'animazione (ordine fette)
// Il premio reale è selezionato server-side dalla RPC fortune_wheel_spin
const PRIZES = [
  { id: "credits_50",  label: "+50 Crediti",  emoji: "🪙", color: "#e9c46a", type: "credits",  value: 50  },
  { id: "xp_200",      label: "+200 XP",       emoji: "⚡", color: "#2a9d8f", type: "xp",       value: 200 },
  { id: "credits_100", label: "+100 Crediti",  emoji: "💰", color: "#f4a261", type: "credits",  value: 100 },
  { id: "retry",       label: "Riprova!",      emoji: "🔄", color: "#e76f51", type: "retry",    value: 0   },
  { id: "credits_200", label: "+200 Crediti",  emoji: "🎁", color: "#457b9d", type: "credits",  value: 200 },
  { id: "xp_500",      label: "+500 XP",       emoji: "🚀", color: "#7c3aed", type: "xp",       value: 500 },
  { id: "badge",       label: "Badge Raro!",   emoji: "🏆", color: "#2a9d8f", type: "badge",    value: 0   },
  { id: "credits_50b", label: "+50 Crediti",   emoji: "🪙", color: "#e9c46a", type: "credits",  value: 50  },
];

const SLICE_DEG = 360 / PRIZES.length;

interface FortuneWheelProps {
  open: boolean;
  onClose: () => void;
}

export default function FortuneWheel({ open, onClose }: FortuneWheelProps) {
  const { user }                       = useAuth();
  const { refreshCredits }             = useCredits();
  const { refreshGamification }        = useGamification();
  const { toast }                      = useToast();
  const canvasRef                      = useRef<HTMLCanvasElement>(null);

  const [spinning, setSpinning]        = useState(false);
  const [rotation, setRotation]        = useState(0);
  const [prize, setPrize]              = useState<typeof PRIZES[0] | null>(null);
  const [spunToday, setSpunToday]      = useState(false);
  const [nextSpin, setNextSpin]        = useState<Date | null>(null);
  const [countdown, setCountdown]      = useState("");
  const [loading, setLoading]          = useState(true);
  const [hasRespin, setHasRespin]      = useState(false);

  // Check today's spin status
  useEffect(() => {
    if (!user || !open) return;
    const check = async () => {
      setLoading(true);
      // FIX: use DB date via RPC (no client timezone tricks)
      const { data: spinData } = await supabase
        .from("fortune_wheel_spins")
        .select("spin_date")
        .eq("user_id", user.id)
        .eq("spin_date", new Date().toISOString().slice(0, 10))
        .maybeSingle();

      // Check fortune_respin powerup
      const { data: respinData } = await supabase
        .from("user_powerups")
        .select("quantity")
        .eq("user_id", user.id)
        .eq("powerup_type", "fortune_respin")
        .maybeSingle();

      const alreadySpun = !!spinData;
      const hasRespinPowerup = (respinData?.quantity ?? 0) > 0;

      setHasRespin(hasRespinPowerup);
      setSpunToday(alreadySpun && !hasRespinPowerup);

      if (alreadySpun && !hasRespinPowerup) {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(0, 0, 0, 0);
        setNextSpin(tomorrow);
      }
      setLoading(false);
    };
    check();
  }, [user, open]);

  // Countdown timer
  useEffect(() => {
    if (!nextSpin) return;
    const tick = () => {
      const diff = nextSpin.getTime() - Date.now();
      if (diff <= 0) { setSpunToday(false); setNextSpin(null); return; }
      const h = Math.floor(diff / 3_600_000);
      const m = Math.floor((diff % 3_600_000) / 60_000);
      const s = Math.floor((diff % 60_000) / 1_000);
      setCountdown(`${h}h ${m}m ${s}s`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [nextSpin]);

  // Draw wheel canvas
  useEffect(() => {
    if (!open) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    const r  = cx - 8;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    PRIZES.forEach((p, i) => {
      const startAngle = (i * SLICE_DEG - 90) * (Math.PI / 180);
      const endAngle   = ((i + 1) * SLICE_DEG - 90) * (Math.PI / 180);
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, r, startAngle, endAngle);
      ctx.closePath();
      ctx.fillStyle = p.color;
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.3)";
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate((startAngle + endAngle) / 2);
      ctx.textAlign = "right";
      ctx.font = "bold 13px system-ui";
      ctx.fillStyle = "white";
      ctx.shadowColor = "rgba(0,0,0,0.5)";
      ctx.shadowBlur = 4;
      ctx.fillText(p.emoji + " " + p.label, r - 8, 5);
      ctx.restore();
    });
    ctx.beginPath();
    ctx.arc(cx, cy, 18, 0, 2 * Math.PI);
    ctx.fillStyle = "white";
    ctx.fill();
    ctx.strokeStyle = "#e5e7eb";
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.font = "bold 16px system-ui";
    ctx.fillStyle = "#2a9d8f";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("★", cx, cy);
  }, [open]);

  const spin = useCallback(async () => {
    if (!user || spinning || spunToday) return;
    setSpinning(true);
    setPrize(null);

    try {
      // FIX: selezione premio server-side via RPC atomica
      // Il server seleziona il premio, lo registra e lo eroga in un'unica transazione
      const { data, error } = await supabase.rpc("fortune_wheel_spin" as any, { _user_id: user.id });
      const result = data as any;

      if (error || !result?.success) {
        const msg = result?.error === "already_spun"
          ? "Hai già girato la ruota oggi!"
          : "Errore durante il giro. Riprova.";
        toast({ title: "Errore", description: msg, variant: "destructive" });
        setSpinning(false);
        return;
      }

      // Il server ci dice l'indice della fetta vincitrice — usiamo solo quello per l'animazione
      const prizeIdx     = result.prize_idx as number;
      const selectedPrize = PRIZES[prizeIdx];

      // Calcola rotazione per l'animazione (la ruota si ferma sul premio corretto)
      const sliceCenter = prizeIdx * SLICE_DEG + SLICE_DEG / 2;
      const targetAngle = 360 - sliceCenter;
      const newRotation = rotation + 5 * 360 + targetAngle;
      setRotation(newRotation);

      // Dopo l'animazione
      setTimeout(async () => {
        setPrize(selectedPrize);
        setSpunToday(true);
        setHasRespin(false);

        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(0, 0, 0, 0);
        setNextSpin(tomorrow);

        // Refresh UI — il premio è già stato erogato server-side
        await Promise.all([refreshCredits(), refreshGamification()]);

        if (selectedPrize.type === "credits" && selectedPrize.value > 0) {
          confetti({ particleCount: 80, spread: 70, colors: ["#e9c46a", "#2a9d8f", "#f4a261"] });
        } else if (selectedPrize.type === "xp") {
          confetti({ particleCount: 60, spread: 60, colors: ["#7c3aed", "#2a9d8f"] });
        } else if (selectedPrize.type === "badge") {
          confetti({ particleCount: 120, spread: 90, colors: ["#e9c46a", "#f4a261", "#2a9d8f"] });
        }

        setSpinning(false);
      }, 3600);
    } catch (err) {
      console.error("Fortune wheel error:", err);
      toast({ title: "Errore", description: "Impossibile girare la ruota. Riprova.", variant: "destructive" });
      setSpinning(false);
    }
  }, [user, spinning, spunToday, rotation, refreshCredits, refreshGamification, toast]);

  if (!open) return null;

  return (
    <AnimatePresence>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
        onClick={onClose}>
        <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.8, opacity: 0 }}
          onClick={e => e.stopPropagation()}
          className="bg-card rounded-2xl border border-border shadow-2xl w-full max-w-sm overflow-hidden">

          <div className="bg-gradient-to-r from-yellow-500/20 to-primary/20 px-5 py-4 flex items-center gap-3 border-b border-border">
            <Star className="h-6 w-6 text-yellow-500" />
            <div className="flex-1">
              <h2 className="font-bold text-card-foreground">Ruota della Fortuna</h2>
              <p className="text-xs text-muted-foreground">
                {hasRespin ? "Hai un giro extra disponibile! 🎟️" : "Un giro gratuito al giorno"}
              </p>
            </div>
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-1">
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="p-5 space-y-5">
            {loading ? (
              <div className="flex justify-center py-12">
                <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              </div>
            ) : (
              <>
                <div className="relative flex justify-center">
                  <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1 z-10 w-0 h-0"
                    style={{ borderLeft: "10px solid transparent", borderRight: "10px solid transparent",
                      borderTop: "20px solid hsl(var(--foreground))" }} />
                  <motion.canvas ref={canvasRef} width={280} height={280}
                    className="rounded-full shadow-lg"
                    animate={{ rotate: rotation }}
                    transition={{ duration: 3.5, ease: [0.2, 0.8, 0.4, 1.0] }} />
                </div>

                <AnimatePresence>
                  {prize && (
                    <motion.div initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }}
                      className="bg-primary/10 border border-primary/30 rounded-xl p-4 text-center space-y-1">
                      <div className="text-3xl">{prize.emoji}</div>
                      <p className="font-bold text-card-foreground text-lg">{prize.label}</p>
                      <p className="text-xs text-muted-foreground">
                        {prize.type === "retry"   ? "Riprova domani!" :
                         prize.type === "badge"   ? "Badge aggiunto al tuo profilo!" :
                         prize.type === "credits" ? "Crediti aggiunti al tuo wallet!" :
                         "XP aggiunti al tuo profilo!"}
                      </p>
                    </motion.div>
                  )}
                </AnimatePresence>

                {spunToday && !spinning ? (
                  <div className="bg-secondary/50 rounded-xl p-4 flex items-center gap-3">
                    <Clock className="h-5 w-5 text-muted-foreground shrink-0" />
                    <div>
                      <p className="text-sm font-medium text-card-foreground">Prossimo giro tra</p>
                      <p className="text-primary font-bold font-mono">{countdown}</p>
                    </div>
                  </div>
                ) : (
                  <Button className="w-full h-12 text-base gap-2" onClick={spin}
                    disabled={spinning || spunToday}>
                    {spinning ? (
                      <><div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                      Girando...</>
                    ) : (
                      <><Star className="h-5 w-5" />
                      {hasRespin ? "Usa giro extra 🎟️" : "Gira la ruota!"}</>
                    )}
                  </Button>
                )}
              </>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
