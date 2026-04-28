import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Link } from "react-router-dom";
import { ArrowLeft, BookOpen, Layers, Sparkles, Clock, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { motion } from "framer-motion";
import AppHeader from "@/components/AppHeader";
import FlashcardViewer from "@/components/study/FlashcardViewer";
import TopicSelector from "@/components/study/TopicSelector";

interface Deck {
  id: string;
  title: string;
  topic: string | null;
  card_count: number;
  created_at: string;
}

interface DeckWithReview extends Deck {
  dueCount: number;
}

type FlashView = "list" | "topic_select" | "viewer";

const Flashcards = () => {
  const { user } = useAuth();
  const [decks, setDecks] = useState<DeckWithReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<FlashView>("list");
  const [activeDeckId, setActiveDeckId] = useState<string | null>(null);
  const [selectedTopics, setSelectedTopics] = useState<string[] | null>(null);
  const [reviewMode, setReviewMode] = useState(false);

  useEffect(() => {
    if (!user) return;
    const load = async () => {
      // FIX: usa RPC aggregata invece di caricare tutte le flashcard per contare
      // Anche fix: include card con next_review_at IS NULL (mai revisionate)
      const [decksRes, dueRes] = await Promise.all([
        supabase
          .from("flashcard_decks")
          .select("id, title, topic, card_count, created_at")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false }),
        supabase.rpc("get_due_counts_by_deck", { _user_id: user.id }),
      ]);

      const dueCounts: Record<string, number> = {};
      if (dueRes.data) {
        for (const row of dueRes.data as { deck_id: string; due_count: number }[]) {
          dueCounts[row.deck_id] = row.due_count;
        }
      }

      if (decksRes.data) {
        setDecks(
          decksRes.data.map((d) => ({
            ...d,
            dueCount: dueCounts[d.id] || 0,
          }))
        );
      }
      setLoading(false);
    };
    load();
  }, [user, view]); // refresh when returning to list

  const totalDue = decks.reduce((sum, d) => sum + d.dueCount, 0);

  const openDeck = (deckId: string, review = false) => {
    setActiveDeckId(deckId);
    setSelectedTopics(null);
    setReviewMode(review);
    if (review) {
      setView("viewer"); // skip topic select in review mode
    } else {
      setView("topic_select");
    }
  };

  const handleStart = (topics: string[] | null) => {
    setSelectedTopics(topics);
    setView("viewer");
  };

  const handleBack = () => {
    setView("list");
    setActiveDeckId(null);
    setSelectedTopics(null);
    setReviewMode(false);
  };

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <main className="container mx-auto px-4 py-8 max-w-4xl">
        <div className="mb-6">
          <Button variant="ghost" size="sm" asChild>
            <Link to="/dashboard"><ArrowLeft className="h-4 w-4 mr-2" /> Dashboard</Link>
          </Button>
        </div>

        {view === "list" && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
            <div>
              <h1 className="text-2xl md:text-3xl font-bold text-foreground flex items-center gap-2">
                <Layers className="h-7 w-7 text-primary" /> Le tue Flashcard
              </h1>
              <p className="text-muted-foreground mt-1">
                Studia e ripeti con le tue flashcard generate dall'AI.
              </p>
            </div>

            {/* Review Summary Banner */}
            {totalDue > 0 && (
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="bg-primary/5 border border-primary/20 rounded-xl p-4 flex items-center justify-between"
              >
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                    <Clock className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-card-foreground">
                      {totalDue} {totalDue === 1 ? "carta" : "carte"} da ripassare
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Il ripasso spaziato migliora la memoria a lungo termine
                    </p>
                  </div>
                </div>
              </motion.div>
            )}

            {loading ? (
              <div className="flex items-center justify-center py-20">
                <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
              </div>
            ) : decks.length === 0 ? (
              <div className="bg-card rounded-xl border border-border shadow-card p-12 text-center">
                <BookOpen className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <h3 className="text-lg font-semibold text-card-foreground mb-2">Nessun mazzo ancora</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Vai allo Studio AI per caricare un documento e generare flashcard automaticamente.
                </p>
                <Button asChild>
                  <Link to="/study"><Sparkles className="h-4 w-4 mr-2" /> Vai allo Studio AI</Link>
                </Button>
              </div>
            ) : (
              <div className="grid sm:grid-cols-2 gap-4">
                {decks.map((deck, i) => (
                  <motion.div
                    key={deck.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.05 }}
                    className="bg-card rounded-xl border border-border shadow-card p-5 cursor-pointer hover:border-primary/40 transition-colors group"
                    onClick={() => openDeck(deck.id)}
                  >
                    <div className="flex items-start justify-between mb-2">
                      <h3 className="font-semibold text-card-foreground group-hover:text-primary transition-colors line-clamp-2">
                        {deck.title}
                      </h3>
                      <Badge variant="secondary" className="shrink-0 ml-2">
                        {deck.card_count} carte
                      </Badge>
                    </div>
                    {deck.topic && (
                      <p className="text-xs text-muted-foreground">{deck.topic}</p>
                    )}
                    <div className="flex items-center justify-between mt-3">
                      <p className="text-[10px] text-muted-foreground">
                        {new Date(deck.created_at).toLocaleDateString("it-IT")}
                      </p>
                      {deck.dueCount > 0 && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs border-primary/30 text-primary hover:bg-primary hover:text-primary-foreground"
                          onClick={(e) => {
                            e.stopPropagation();
                            openDeck(deck.id, true);
                          }}
                        >
                          <RefreshCw className="h-3 w-3 mr-1" />
                          Ripassa ({deck.dueCount})
                        </Button>
                      )}
                    </div>
                  </motion.div>
                ))}
              </div>
            )}
          </motion.div>
        )}

        {view === "topic_select" && activeDeckId && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <div className="bg-card rounded-xl border border-border shadow-card p-6">
              <TopicSelector
                type="flashcards"
                sourceId={activeDeckId}
                onStart={handleStart}
                onBack={handleBack}
              />
            </div>
          </motion.div>
        )}

        {view === "viewer" && activeDeckId && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <div className="bg-card rounded-xl border border-border shadow-card p-6">
              <FlashcardViewer
                deckId={activeDeckId}
                selectedTopics={selectedTopics}
                reviewMode={reviewMode}
                onBack={reviewMode ? handleBack : () => setView("topic_select")}
              />
            </div>
          </motion.div>
        )}
      </main>
    </div>
  );
};

export default Flashcards;
