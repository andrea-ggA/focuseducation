import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { FileText, Sparkles, BookOpen, Zap, Trash2, ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import ShareButton from "@/components/ShareButton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { motion, AnimatePresence } from "framer-motion";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

interface Quiz {
  id: string;
  title: string;
  topic: string | null;
  quiz_type: string;
  total_questions: number;
  created_at: string;
  document_id: string | null;
  share_token: string | null;
}

interface Deck {
  id: string;
  title: string;
  topic: string | null;
  card_count: number;
  created_at: string;
  document_id: string | null;
  share_token: string | null;
}

interface Document {
  id: string;
  title: string;
  created_at: string;
  file_type: string | null;
}

interface GenerationJob {
  id: string;
  status: string;
  content_type: string;
  title: string | null;
  created_at: string;
}

interface StudyHistoryProps {
  onPlayQuiz: (quizId: string, gamified: boolean) => void;
  onViewDeck: (deckId: string) => void;
  refreshKey: number;
}

const StudyHistory = ({ onPlayQuiz, onViewDeck, refreshKey }: StudyHistoryProps) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [documents, setDocuments] = useState<Document[]>([]);
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [decks, setDecks] = useState<Deck[]>([]);
  const [expandedDoc, setExpandedDoc] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!user) return;
    const fetchAll = async () => {
      const [dRes, qRes, fRes] = await Promise.all([
        supabase.from("documents").select("id, title, created_at, file_type").eq("user_id", user.id).order("created_at", { ascending: false }),
        supabase.from("quizzes").select("id, title, topic, quiz_type, total_questions, created_at, document_id, share_token").eq("user_id", user.id).order("created_at", { ascending: false }),
        supabase.from("flashcard_decks").select("id, title, topic, card_count, created_at, document_id, share_token").eq("user_id", user.id).order("created_at", { ascending: false }),
      ]);
      if (dRes.data) setDocuments(dRes.data);
      if (qRes.data) setQuizzes(qRes.data);
      if (fRes.data) setDecks(fRes.data);
      setLoading(false);
    };
    fetchAll();
  }, [user, refreshKey]);

  const deleteQuiz = async (quizId: string) => {
    setDeletingIds((prev) => new Set(prev).add(quizId));
    try {
      await supabase.from("user_question_progress").delete().eq("quiz_id", quizId);
      await supabase.from("quiz_questions").delete().eq("quiz_id", quizId);
      await supabase.from("quiz_attempts").delete().eq("quiz_id", quizId);
      await supabase.from("quizzes").delete().eq("id", quizId);
      setQuizzes((prev) => prev.filter((q) => q.id !== quizId));
      toast({ title: "Quiz eliminato" });
    } finally {
      setDeletingIds((prev) => { const n = new Set(prev); n.delete(quizId); return n; });
    }
  };

  const deleteDeck = async (deckId: string) => {
    setDeletingIds((prev) => new Set(prev).add(deckId));
    try {
      await supabase.from("flashcards").delete().eq("deck_id", deckId);
      await supabase.from("flashcard_decks").delete().eq("id", deckId);
      setDecks((prev) => prev.filter((d) => d.id !== deckId));
      toast({ title: "Flashcard eliminate" });
    } finally {
      setDeletingIds((prev) => { const n = new Set(prev); n.delete(deckId); return n; });
    }
  };

  const deleteDocument = async (docId: string) => {
    setDeletingIds((prev) => new Set(prev).add(docId));
    try {
      // FIX: legge file_url PRIMA di eliminare il record, per poter rimuovere
      // il file da Supabase Storage (prima veniva eliminato solo il record DB)
      const { data: docRow } = await supabase
        .from("documents")
        .select("file_url")
        .eq("id", docId)
        .single();

      const docQuizzes = quizzes.filter((q) => q.document_id === docId);
      const docDecks   = decks.filter((d) => d.document_id === docId);

      await Promise.all([
        ...docQuizzes.map(q => deleteQuiz(q.id)),
        ...docDecks.map(d => deleteDeck(d.id)),
      ]);

      await supabase.from("generated_content").delete().eq("document_id", docId);
      await supabase.from("generation_jobs").delete().eq("document_id", docId);
      await supabase.from("tasks").delete().eq("parent_task_id", docId);
      await supabase.from("documents").delete().eq("id", docId);

      // FIX: rimuovi il file da Supabase Storage
      if (docRow?.file_url) {
        const { error: storageErr } = await supabase.storage
          .from("documents")
          .remove([docRow.file_url]);
        if (storageErr) console.warn("[deleteDocument] Storage remove failed:", storageErr.message);
      }

      setDocuments((prev) => prev.filter((d) => d.id !== docId));
      toast({ title: "Documento e materiali associati eliminati" });
    } catch (err: any) {
      toast({ title: "Errore durante l'eliminazione", description: err.message, variant: "destructive" });
    } finally {
      setDeletingIds((prev) => { const n = new Set(prev); n.delete(docId); return n; });
    }
  };

  // Group quizzes and decks without a document
  const orphanQuizzes = quizzes.filter((q) => !q.document_id);
  const orphanDecks = decks.filter((d) => !d.document_id);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (documents.length === 0 && orphanQuizzes.length === 0 && orphanDecks.length === 0) {
    return (
      <div className="text-center py-8">
        <FileText className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
        <p className="text-sm text-muted-foreground">Nessun materiale ancora. Carica un documento per iniziare!</p>
      </div>
    );
  }

  const renderQuizItem = (q: Quiz) => (
    <div key={q.id} className="flex items-center gap-3 p-3 rounded-lg border border-border hover:bg-secondary/50 transition-colors">
      {q.quiz_type === "gamified_adhd" ? (
        <Zap className="h-4 w-4 text-accent shrink-0" />
      ) : (
        <Sparkles className="h-4 w-4 text-primary shrink-0" />
      )}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-card-foreground truncate">{q.title}</p>
        <p className="text-xs text-muted-foreground">{q.total_questions} domande</p>
      </div>
      {q.quiz_type === "gamified_adhd" && (
        <Badge variant="outline" className="text-accent border-accent shrink-0 text-[10px]">ADHD</Badge>
      )}
      <Button size="sm" variant="outline" onClick={() => onPlayQuiz(q.id, q.quiz_type === "gamified_adhd")}>
        Gioca
      </Button>
      <ShareButton
        type="quiz"
        id={q.id}
        shareToken={q.share_token}
        onTokenGenerated={(token) => setQuizzes(prev => prev.map(x => x.id === q.id ? { ...x, share_token: token } : x))}
      />
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground hover:text-destructive" disabled={deletingIds.has(q.id)}>
            {deletingIds.has(q.id) ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminare questo quiz?</AlertDialogTitle>
            <AlertDialogDescription>Questa azione è irreversibile. Il quiz e tutti i tentativi verranno eliminati.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annulla</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteQuiz(q.id)}>Elimina</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );

  const renderDeckItem = (d: Deck) => (
    <div key={d.id} className="flex items-center gap-3 p-3 rounded-lg border border-border hover:bg-secondary/50 transition-colors">
      <BookOpen className="h-4 w-4 text-primary shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-card-foreground truncate">{d.title}</p>
        <p className="text-xs text-muted-foreground">{d.card_count} carte</p>
      </div>
      <Button size="sm" variant="outline" onClick={() => onViewDeck(d.id)}>
        Studia
      </Button>
      <ShareButton
        type="flashcard_deck"
        id={d.id}
        shareToken={d.share_token}
        onTokenGenerated={(token) => setDecks(prev => prev.map(x => x.id === d.id ? { ...x, share_token: token } : x))}
      />
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground hover:text-destructive" disabled={deletingIds.has(d.id)}>
            {deletingIds.has(d.id) ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminare queste flashcard?</AlertDialogTitle>
            <AlertDialogDescription>Questa azione è irreversibile.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annulla</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteDeck(d.id)}>Elimina</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );

  return (
    <div className="space-y-3">
      {/* Per-document sections */}
      {documents.map((doc) => {
        const docQuizzes = quizzes.filter((q) => q.document_id === doc.id);
        const docDecks = decks.filter((d) => d.document_id === doc.id);
        const isExpanded = expandedDoc === doc.id;
        const itemCount = docQuizzes.length + docDecks.length;

        return (
          <div key={doc.id} className="border border-border rounded-xl overflow-hidden">
            <div
              role="button"
              tabIndex={0}
              onClick={() => setExpandedDoc(isExpanded ? null : doc.id)}
              onKeyDown={(e) => e.key === "Enter" && setExpandedDoc(isExpanded ? null : doc.id)}
              className="w-full flex items-center gap-3 p-4 hover:bg-secondary/30 transition-colors text-left cursor-pointer"
            >
              <FileText className="h-5 w-5 text-primary shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-card-foreground truncate">{doc.title}</p>
                <p className="text-xs text-muted-foreground">
                  {new Date(doc.created_at).toLocaleDateString("it-IT")} · {itemCount} materiali
                </p>
              </div>
              <div className="flex items-center gap-2">
                {docQuizzes.length > 0 && (
                  <Badge variant="secondary" className="text-[10px]">{docQuizzes.length} quiz</Badge>
                )}
                {docDecks.length > 0 && (
                  <Badge variant="secondary" className="text-[10px]">{docDecks.length} deck</Badge>
                )}
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 text-muted-foreground hover:text-destructive"
                      onClick={(e) => e.stopPropagation()}
                      disabled={deletingIds.has(doc.id)}
                    >
                      {deletingIds.has(doc.id) ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Eliminare "{doc.title}"?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Verranno eliminati il documento e tutti i quiz e flashcard associati. Questa azione è irreversibile.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Annulla</AlertDialogCancel>
                      <AlertDialogAction onClick={() => deleteDocument(doc.id)}>Elimina tutto</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
                {isExpanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
              </div>
            </div>

            <AnimatePresence>
              {isExpanded && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden"
                >
                  <div className="px-4 pb-4 space-y-2">
                    {docQuizzes.length === 0 && docDecks.length === 0 && (
                      <p className="text-xs text-muted-foreground text-center py-4">Nessun materiale generato per questo documento.</p>
                    )}
                    {docQuizzes.map(renderQuizItem)}
                    {docDecks.map(renderDeckItem)}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      })}

      {/* Orphan items (no document) */}
      {(orphanQuizzes.length > 0 || orphanDecks.length > 0) && (
        <div className="border border-border rounded-xl p-4 space-y-2">
          <p className="text-xs font-medium text-muted-foreground mb-2">📝 Da testo incollato</p>
          {orphanQuizzes.map(renderQuizItem)}
          {orphanDecks.map(renderDeckItem)}
        </div>
      )}
    </div>
  );
};

export default StudyHistory;
