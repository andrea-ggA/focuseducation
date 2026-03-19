import { useEffect } from "react";
import { motion } from "framer-motion";
import { BookOpen, ArrowRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useDueCards } from "@/hooks/useDueCards";
import { Link } from "react-router-dom";

interface DueCardsWidgetProps {
  onStartQuickReview: () => void;
  initialCount?:      number | null; // pre-caricato dal Dashboard batch (evita doppia query)
}

export default function DueCardsWidget({ onStartQuickReview, initialCount = null }: DueCardsWidgetProps) {
  const { dueCount: hookCount, loading: hookLoading, refresh } = useDueCards();

  // Usa il conteggio pre-caricato dal Dashboard se disponibile → appare immediatamente
  const dueCount = initialCount !== null ? initialCount : hookCount;
  const loading  = initialCount === null && hookLoading;

  // Refresh in background solo se non è stato pre-caricato
  useEffect(() => {
    if (initialCount === null) refresh();
  }, [refresh, initialCount]);

  if (loading) {
    return (
      <div className="bg-card rounded-xl border border-border p-4 flex items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        <span className="text-sm text-muted-foreground">Caricamento ripasso...</span>
      </div>
    );
  }

  if (dueCount === 0) {
    return (
      <div className="bg-card rounded-xl border border-border p-4 flex items-center gap-3">
        <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
          <BookOpen className="h-4 w-4 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-card-foreground">Nessuna carta da ripassare 🎉</p>
          <p className="text-xs text-muted-foreground">Torna più tardi o crea nuove flashcard</p>
        </div>
        <Button variant="ghost" size="sm" asChild>
          <Link to="/libreria?tab=flashcard">Libreria</Link>
        </Button>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-card rounded-xl border border-primary/30 p-4 flex items-center gap-3"
    >
      <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 relative">
        <BookOpen className="h-4 w-4 text-primary" />
        {dueCount > 0 && (
          <span className="absolute -top-1.5 -right-1.5 h-4 w-4 rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center">
            {dueCount > 9 ? "9+" : dueCount}
          </span>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-sm font-semibold text-card-foreground">Ripasso del giorno</p>
          <Badge variant="default" className="text-[10px] px-1.5 py-0">
            {dueCount} {dueCount === 1 ? "carta" : "carte"}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground">
          {dueCount <= 5
            ? "Sessione veloce · ~5 min"
            : dueCount <= 15
            ? "Sessione media · ~10-15 min"
            : "Sessione completa · ~20+ min"}
        </p>
      </div>
      <Button size="sm" onClick={onStartQuickReview} className="shrink-0 gap-1">
        Ripassa <ArrowRight className="h-3.5 w-3.5" />
      </Button>
    </motion.div>
  );
}
