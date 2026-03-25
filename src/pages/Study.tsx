import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useSubscription } from "@/hooks/useSubscription";
import { Link, useSearchParams, useNavigate } from "react-router-dom";
import { Upload, BookOpen, Sparkles, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";
import DocumentUpload from "@/components/study/DocumentUpload";
import QuizPlayer from "@/components/study/QuizPlayer";
import FlashcardViewer from "@/components/study/FlashcardViewer";
import StudyHistory from "@/components/study/StudyHistory";
import TopicSelector from "@/components/study/TopicSelector";
import MicroTaskList from "@/components/study/MicroTaskList";
import MindMapViewer from "@/components/study/MindMapViewer";
import SummaryViewer from "@/components/study/SummaryViewer";
import CreditPaywall, { type PaywallAction } from "@/components/dashboard/CreditPaywall";
import AppHeader from "@/components/AppHeader";
import MobileBottomNav from "@/components/MobileBottomNav";
import { useStudyMachine } from "@/hooks/useStudyMachine";

const Study = () => {
  const { user }                  = useAuth();
  const { isPro, isHyperfocus }   = useSubscription();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate                  = useNavigate();
  const [state, dispatch]         = useStudyMachine();
  const [refreshKey, setRefreshKey]     = useState(0);
  const [microTaskRefresh, setMicroTaskRefresh] = useState(0);
  const [showPaywall, setShowPaywall]     = useState(false);
  const [paywallAction, setPaywallAction] = useState<PaywallAction>("generic");
  const [paywallNeeded, setPaywallNeeded] = useState<number | undefined>(undefined);

  const source = searchParams.get("source");

  // Auto-open quiz from URL params (e.g. from Libreria)
  useEffect(() => {
    const quizParam    = searchParams.get("quiz");
    const gamifiedParam = searchParams.get("gamified");
    if (quizParam && state.view === "home") {
      dispatch({ type: "UPLOAD_QUIZ", quizId: quizParam, gamified: gamifiedParam === "true" });
      const newParams = new URLSearchParams();
      if (source) newParams.set("source", source);
      setSearchParams(newParams, { replace: true });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleBack = () => {
    if (source === "libreria") { navigate("/libreria"); return; }
    dispatch({ type: "BACK" });
    setRefreshKey((p) => p + 1);
  };

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />

      <main className="container mx-auto px-4 py-8 pb-24 md:pb-8 max-w-4xl">
        <div className="mb-6">
          {state.view === "home" ? (
            <Button variant="ghost" size="sm" asChild>
              <Link to="/dashboard"><ArrowLeft className="h-4 w-4 mr-2" /> Dashboard</Link>
            </Button>
          ) : (
            <Button variant="ghost" size="sm" onClick={handleBack}>
              <ArrowLeft className="h-4 w-4 mr-2" /> {source === "libreria" ? "Libreria" : "Studio AI"}
            </Button>
          )}
        </div>

        {state.view === "home" && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-8">
            <div>
              <h1 className="text-2xl md:text-3xl font-bold text-foreground flex items-center gap-2">
                <Sparkles className="h-7 w-7 text-primary" /> Studio AI
              </h1>
              <p className="text-muted-foreground mt-1">Carica i tuoi appunti e genera quiz e flashcard automaticamente.</p>
            </div>

            <div className="bg-card rounded-xl border border-border shadow-card p-6">
              <div className="flex items-center gap-2 mb-4">
                <Upload className="h-5 w-5 text-primary" />
                <h2 className="text-lg font-semibold text-card-foreground">Carica materiale</h2>
              </div>
              <DocumentUpload
                onQuizGenerated={(id)       => dispatch({ type: "UPLOAD_QUIZ", quizId: id, gamified: false })}
                onFlashcardsGenerated={(id) => dispatch({ type: "UPLOAD_FLASHCARDS", deckId: id })}
                hasFullAccess={isPro || isHyperfocus}
                hasGamified={isHyperfocus}
                onDecompose={() => setMicroTaskRefresh((p) => p + 1)}
                onMindMap={(nodes, edges)   => dispatch({ type: "UPLOAD_MINDMAP", nodes, edges })}
                onInsufficientCredits={(action, needed) => {
                  setPaywallAction((action ?? "generic") as PaywallAction);
                  setPaywallNeeded(needed);
                  setShowPaywall(true);
                }}
                onSummaryGenerated={(content, format, title) =>
                  dispatch({ type: "UPLOAD_SUMMARY", content, format, title })
                }
              />
            </div>

            <div className="bg-card rounded-xl border border-border shadow-card p-6" key={microTaskRefresh}>
              <MicroTaskList />
            </div>

            <div className="bg-card rounded-xl border border-border shadow-card p-6">
              <div className="flex items-center gap-2 mb-4">
                <BookOpen className="h-5 w-5 text-primary" />
                <h2 className="text-lg font-semibold text-card-foreground">I tuoi materiali</h2>
              </div>
              <StudyHistory
                onPlayQuiz={(id, gamified) => dispatch({ type: "UPLOAD_QUIZ", quizId: id, gamified })}
                onViewDeck={(id)           => dispatch({ type: "UPLOAD_FLASHCARDS", deckId: id })}
                refreshKey={refreshKey}
              />
            </div>
          </motion.div>
        )}

        {state.view === "mindmap" && state.mindMapData && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <div className="bg-card rounded-xl border border-border shadow-card p-6">
              <MindMapViewer nodes={state.mindMapData.nodes} edges={state.mindMapData.edges} onBack={handleBack} />
            </div>
          </motion.div>
        )}

        {state.view === "summary" && state.summaryData && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <SummaryViewer
              content={state.summaryData.content}
              format={state.summaryData.format as "summary" | "outline" | "smart_notes"}
              title={state.summaryData.title}
              onBack={handleBack}
            />
          </motion.div>
        )}

        {state.view === "topic_select_quiz" && state.activeQuizId && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <div className="bg-card rounded-xl border border-border shadow-card p-6">
              <TopicSelector
                type="quiz"
                sourceId={state.activeQuizId}
                onStart={(topics, timer, bet) => dispatch({ type: "START_QUIZ", topics, timer, bet })}
                onBack={handleBack}
              />
            </div>
          </motion.div>
        )}

        {state.view === "topic_select_flashcards" && state.activeDeckId && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <div className="bg-card rounded-xl border border-border shadow-card p-6">
              <TopicSelector
                type="flashcards"
                sourceId={state.activeDeckId}
                onStart={(topics) => dispatch({ type: "START_FLASHCARDS", topics })}
                onBack={handleBack}
              />
            </div>
          </motion.div>
        )}

        {state.view === "quiz" && state.activeQuizId && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <div className="bg-card rounded-xl border border-border shadow-card p-6">
              <QuizPlayer
                quizId={state.activeQuizId}
                isGamified={state.activeQuizGamified}
                selectedTopics={state.selectedTopics}
                customTimerSeconds={state.customTimerSeconds}
                xpBet={state.xpBet}
                onBack={() => dispatch({ type: "BACK_TO_TOPICS" })}
              />
            </div>
          </motion.div>
        )}

        {state.view === "flashcards" && state.activeDeckId && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <div className="bg-card rounded-xl border border-border shadow-card p-6">
              <FlashcardViewer
                deckId={state.activeDeckId}
                selectedTopics={state.selectedTopics}
                onBack={() => dispatch({ type: "BACK_TO_TOPICS" })}
              />
            </div>
          </motion.div>
        )}
      </main>

      <CreditPaywall open={showPaywall} onClose={() => setShowPaywall(false)} action={paywallAction} creditsNeeded={paywallNeeded} />
      <MobileBottomNav />
    </div>
  );
};

export default Study;
