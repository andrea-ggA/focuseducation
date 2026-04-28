import { useState, useEffect } from "react";
import { Brain, Lightbulb, Target, Clock, Zap, ChevronRight, RefreshCw, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { motion, AnimatePresence } from "framer-motion";
import { consumeOpenAiSseStream } from "@/lib/sse";

interface CoachingTip {
  title: string;
  content: string;
  category: "focus" | "organization" | "motivation" | "breaks";
}

const COACHING_TIPS: Record<string, CoachingTip[]> = {
  focus: [
    { title: "Tecnica del Body Doubling", content: "Studia con qualcuno (anche in video) per mantenere la concentrazione. La presenza di un'altra persona riduce le distrazioni.", category: "focus" },
    { title: "Blocca le distrazioni", content: "Usa la modalità Non Disturbare e metti il telefono in un'altra stanza. L'ambiente è fondamentale per il focus ADHD.", category: "focus" },
    { title: "Musica binaurale", content: "Ascolta musica a 40Hz (gamma) durante lo studio. La ricerca mostra che migliora la concentrazione nelle persone con ADHD.", category: "focus" },
    { title: "Cambia posizione", content: "Se perdi concentrazione, cambia posizione o stanza. Il cambiamento sensoriale riattiva l'attenzione.", category: "focus" },
  ],
  organization: [
    { title: "Regola dei 2 minuti", content: "Se un task richiede meno di 2 minuti, fallo subito. Non metterlo in lista, eseguilo e liberati il cervello.", category: "organization" },
    { title: "Brain Dump serale", content: "Prima di dormire, scrivi TUTTO ciò che hai in testa: idee, preoccupazioni, task. Libera la memoria di lavoro.", category: "organization" },
    { title: "Micro-task", content: "Spezza ogni compito in sotto-task da massimo 15 minuti. Il cervello ADHD lavora meglio con obiettivi piccoli e raggiungibili.", category: "organization" },
    { title: "Usa i colori", content: "Colora i tuoi appunti e task per priorità. Il sistema visivo ADHD risponde molto bene agli stimoli cromatici.", category: "organization" },
  ],
  motivation: [
    { title: "Ricompensa immediata", content: "Dopo ogni sessione Pomodoro completata, concediti una piccola ricompensa. Il cervello ADHD ha bisogno di dopamina immediata.", category: "motivation" },
    { title: "Accountability partner", content: "Condividi i tuoi obiettivi con qualcuno. Sapere che qualcuno controlla aumenta la motivazione del 65%.", category: "motivation" },
    { title: "Visualizza il risultato", content: "Prima di iniziare, immagina come ti sentirai DOPO aver completato il task. La visualizzazione positiva attiva la motivazione.", category: "motivation" },
    { title: "Streak power", content: "Non spezzare la catena! Ogni giorno che studi di fila, il tuo cervello crea un'abitudine più forte. Guarda il tuo streak crescere.", category: "motivation" },
  ],
  breaks: [
    { title: "Pausa attiva", content: "Durante le pause, muoviti! 5 minuti di stretching o una camminata veloce aumentano il flusso sanguigno al cervello.", category: "breaks" },
    { title: "Pausa sensoriale", content: "Usa una palla antistress, fai respiri profondi o ascolta un brano preferito. La stimolazione sensoriale ricarica il focus.", category: "breaks" },
    { title: "Pausa 5-4-3-2-1", content: "Nota 5 cose che vedi, 4 che senti, 3 che tocchi, 2 che annusi, 1 che gusti. Grounding perfetto per ADHD.", category: "breaks" },
    { title: "Power nap", content: "Un pisolino di 10-20 minuti tra sessioni lunghe può migliorare drasticamente la concentrazione ADHD.", category: "breaks" },
  ],
};

const CATEGORY_META = {
  focus: { icon: Target, label: "Focus", color: "text-primary" },
  organization: { icon: Brain, label: "Organizzazione", color: "text-accent" },
  motivation: { icon: Zap, label: "Motivazione", color: "text-primary" },
  breaks: { icon: Clock, label: "Pause", color: "text-accent" },
};

const AdhdCoaching = () => {
  const { user } = useAuth();
  const [activeCategory, setActiveCategory] = useState<string>("focus");
  const [currentTipIndex, setCurrentTipIndex] = useState(0);
  const [adhdTraits, setAdhdTraits] = useState<string[]>([]);
  const [dailyTip, setDailyTip] = useState<CoachingTip | null>(null);
  const [loadingAi, setLoadingAi] = useState(false);
  const [aiTip, setAiTip] = useState<string>("");

  useEffect(() => {
    if (user) {
      supabase.from("profiles").select("adhd_traits").eq("user_id", user.id).single().then(({ data }) => {
        if (data?.adhd_traits) setAdhdTraits(data.adhd_traits);
      });
    }

    // Daily tip based on day of year
    const dayOfYear = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0).getTime()) / 86400000);
    const allTips = Object.values(COACHING_TIPS).flat();
    setDailyTip(allTips[dayOfYear % allTips.length]);
  }, [user]);

  const tips = COACHING_TIPS[activeCategory] || [];
  const currentTip = tips[currentTipIndex % tips.length];

  const nextTip = () => setCurrentTipIndex((p) => (p + 1) % tips.length);

  const getPersonalizedTip = async () => {
    if (!user) return;
    setLoadingAi(true);
    setAiTip("");

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("Sessione non valida");
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-tutor`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify({
          messages: [{
            role: "user",
            content: `Sono uno studente con ADHD. I miei tratti principali sono: ${adhdTraits.length > 0 ? adhdTraits.join(", ") : "non specificati"}. 
Sto avendo difficoltà con la concentrazione durante lo studio. 
Dammi UN consiglio specifico, pratico e attuabile subito (massimo 3 frasi). Sii diretto e motivante.`,
          }],
        }),
      });

      if (!res.ok || !res.body) throw new Error("Failed");
      let fullText = "";
      await consumeOpenAiSseStream(res, (content) => {
        fullText += content;
        setAiTip(fullText);
      });
    } catch (err) {
      setAiTip("Non sono riuscito a generare un consiglio personalizzato. Riprova tra poco!");
    } finally {
      setLoadingAi(false);
    }
  };

  return (
    <div className="bg-card rounded-xl border border-border shadow-card p-6 space-y-6">
      <div className="flex items-center gap-2">
        <Brain className="h-5 w-5 text-accent" />
        <h2 className="text-lg font-semibold text-card-foreground">Coaching ADHD+</h2>
      </div>

      {/* Daily tip */}
      {dailyTip && (
        <div className="bg-accent/10 rounded-xl p-4 border border-accent/20">
          <div className="flex items-center gap-2 mb-2">
            <Lightbulb className="h-4 w-4 text-accent" />
            <span className="text-xs font-medium text-accent">Consiglio del giorno</span>
          </div>
          <p className="text-sm font-medium text-card-foreground">{dailyTip.title}</p>
          <p className="text-xs text-muted-foreground mt-1">{dailyTip.content}</p>
        </div>
      )}

      {/* Category tabs */}
      <div className="flex gap-1 bg-secondary rounded-lg p-1">
        {Object.entries(CATEGORY_META).map(([key, meta]) => (
          <button
            key={key}
            onClick={() => { setActiveCategory(key); setCurrentTipIndex(0); }}
            className={`flex-1 text-xs font-medium py-2 rounded-md transition-all flex items-center justify-center gap-1 ${
              activeCategory === key
                ? "bg-primary text-primary-foreground shadow-soft"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <meta.icon className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{meta.label}</span>
          </button>
        ))}
      </div>

      {/* Current tip */}
      <AnimatePresence mode="wait">
        <motion.div
          key={`${activeCategory}-${currentTipIndex}`}
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -20 }}
          className="space-y-3"
        >
          <div className="border border-border rounded-xl p-4">
            <h3 className="text-sm font-semibold text-card-foreground mb-1">{currentTip?.title}</h3>
            <p className="text-xs text-muted-foreground leading-relaxed">{currentTip?.content}</p>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-muted-foreground">
              {currentTipIndex + 1}/{tips.length}
            </span>
            <Button variant="ghost" size="sm" onClick={nextTip}>
              Prossimo <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        </motion.div>
      </AnimatePresence>

      {/* AI personalized tip */}
      <div className="border-t border-border pt-4">
        <Button
          variant="outline"
          size="sm"
          onClick={getPersonalizedTip}
          disabled={loadingAi}
          className="w-full"
        >
          {loadingAi ? (
            <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Generando consiglio...</>
          ) : (
            <><RefreshCw className="h-4 w-4 mr-2" /> Consiglio AI personalizzato</>
          )}
        </Button>
        {aiTip && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-3 bg-primary/5 rounded-xl p-3 border border-primary/20"
          >
            <p className="text-xs text-card-foreground leading-relaxed whitespace-pre-wrap">{aiTip}</p>
          </motion.div>
        )}
      </div>
    </div>
  );
};

export default AdhdCoaching;
