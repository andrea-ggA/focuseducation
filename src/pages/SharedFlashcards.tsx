import { useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { motion } from "framer-motion";
import { BookOpen, ChevronLeft, ChevronRight, Sparkles, RotateCcw } from "lucide-react";
import { isSafeShareToken } from "@/lib/security";

interface Flashcard {
  id: string;
  front: string;
  back: string;
  topic: string | null;
  sort_order: number;
}

const SharedFlashcards = () => {
  const { token } = useParams<{ token: string }>();
  const [deckTitle, setDeckTitle] = useState("");
  const [cards, setCards] = useState<Flashcard[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [creatorName, setCreatorName] = useState<string | null>(null);

  useEffect(() => {
    if (!isSafeShareToken(token)) {
      setNotFound(true);
      setLoading(false);
      return;
    }
    const fetch = async () => {
      const { data: deck } = await supabase
        .from("flashcard_decks")
        .select("id, title, card_count, user_id")
        .eq("share_token", token)
        .maybeSingle();

      if (!deck) { setNotFound(true); setLoading(false); return; }
      setDeckTitle(deck.title);

      const [profileRes, cardsRes] = await Promise.all([
        supabase.from("profiles").select("full_name").eq("user_id", deck.user_id).maybeSingle(),
        supabase.from("flashcards").select("id, front, back, topic, sort_order").eq("deck_id", deck.id).order("sort_order"),
      ]);
      if (profileRes.data?.full_name) setCreatorName(profileRes.data.full_name);
      if (cardsRes.data) setCards(cardsRes.data);
      setLoading(false);
    };
    fetch();
  }, [token]);

  if (loading) return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
    </div>
  );

  if (notFound) return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <div className="text-center max-w-md">
        <BookOpen className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
        <h1 className="text-2xl font-bold text-foreground mb-2">Flashcard non trovate</h1>
        <p className="text-muted-foreground mb-6">Questo link non è valido o le flashcard non sono più condivise.</p>
        <Button asChild><Link to="/">Vai alla home</Link></Button>
      </div>
    </div>
  );

  if (cards.length === 0) return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <p className="text-muted-foreground">Nessuna flashcard in questo mazzo.</p>
    </div>
  );

  const card = cards[currentIndex];
  const progress = ((currentIndex + 1) / cards.length) * 100;

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4 py-8">
      <div className="max-w-lg w-full space-y-6">
        {/* Header */}
        <div className="text-center space-y-1">
          <h1 className="text-xl font-bold text-foreground">{deckTitle}</h1>
          {creatorName && <p className="text-sm text-muted-foreground">Condiviso da {creatorName}</p>}
          <div className="flex items-center justify-center gap-2">
            <Badge variant="secondary">{cards.length} carte</Badge>
            <span className="text-sm text-muted-foreground">{currentIndex + 1}/{cards.length}</span>
          </div>
        </div>

        {/* Progress */}
        <div className="w-full bg-secondary rounded-full h-1.5">
          <div className="bg-primary h-1.5 rounded-full transition-all" style={{ width: `${progress}%` }} />
        </div>

        {/* Card */}
        <div style={{ perspective: "1000px" }}>
          <motion.div
            onClick={() => setFlipped(!flipped)}
            className="relative w-full cursor-pointer"
            style={{ transformStyle: "preserve-3d" }}
            animate={{ rotateY: flipped ? 180 : 0 }}
            transition={{ duration: 0.4 }}
          >
            <div
              className={`w-full min-h-[280px] rounded-2xl border-2 border-border bg-card p-8 flex flex-col items-center justify-center text-center shadow-lg ${flipped ? "invisible" : ""}`}
              style={{ backfaceVisibility: "hidden" }}
            >
              {card.topic && <Badge variant="secondary" className="mb-3 text-xs">{card.topic}</Badge>}
              <p className="text-lg font-semibold text-card-foreground">{card.front}</p>
              <p className="text-xs text-muted-foreground mt-4">Tocca per girare</p>
            </div>
            <div
              className={`w-full min-h-[280px] rounded-2xl border-2 border-primary/30 bg-primary/5 p-8 flex flex-col items-center justify-center text-center absolute top-0 left-0 shadow-lg ${!flipped ? "invisible" : ""}`}
              style={{ backfaceVisibility: "hidden", transform: "rotateY(180deg)" }}
            >
              <p className="text-lg text-card-foreground">{card.back}</p>
            </div>
          </motion.div>
        </div>

        {/* Navigation */}
        <div className="flex justify-between items-center">
          <Button
            variant="outline"
            size="sm"
            disabled={currentIndex === 0}
            onClick={() => { setCurrentIndex(p => p - 1); setFlipped(false); }}
          >
            <ChevronLeft className="h-4 w-4 mr-1" /> Precedente
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => { setCurrentIndex(0); setFlipped(false); }}
          >
            <RotateCcw className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={currentIndex >= cards.length - 1}
            onClick={() => { setCurrentIndex(p => p + 1); setFlipped(false); }}
          >
            Successiva <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        </div>

        {/* CTA */}
        <div className="bg-card border border-border rounded-xl p-5 text-center space-y-3">
          <h3 className="font-semibold text-card-foreground">Crea le tue flashcard con l'AI! 🚀</h3>
          <p className="text-sm text-muted-foreground">
            Carica qualsiasi documento e FocusEd genera flashcard, quiz e riassunti automaticamente.
          </p>
          <Button asChild className="w-full">
            <Link to="/auth"><Sparkles className="h-4 w-4 mr-2" /> Registrati gratis</Link>
          </Button>
        </div>

        <p className="text-center text-xs text-muted-foreground">
          Generato con <Link to="/" className="text-primary font-medium hover:underline">FocusEd</Link>
        </p>
      </div>
    </div>
  );
};

export default SharedFlashcards;
