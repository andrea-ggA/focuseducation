import { useState, useEffect, useCallback } from "react";
import { useSearchParams, Link, useNavigate } from "react-router-dom";
import { ArrowLeft, BookOpen, Layers, Map, Target, Loader2, Trash2, Sparkles, Zap, CheckSquare, FileText, ScrollText, BookMarked, Download } from "lucide-react";
import ShareButton from "@/components/ShareButton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { motion } from "framer-motion";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import AppHeader from "@/components/AppHeader";
import MobileBottomNav from "@/components/MobileBottomNav";

interface QuizItem { id: string; title: string; topic: string | null; quiz_type: string; total_questions: number; created_at: string; share_token: string | null; }
interface DeckItem { id: string; title: string; topic: string | null; card_count: number; created_at: string; share_token: string | null; }
interface MapItem { id: string; title: string | null; content: any; created_at: string; }
interface SummaryItem { id: string; title: string | null; content: any; content_type: string; created_at: string; share_token: string | null; }

const SUMMARY_TYPE_LABELS: Record<string, { label: string; icon: typeof FileText; emoji: string }> = {
  summary: { label: "Riassunto", icon: FileText, emoji: "📄" },
  outline: { label: "Schema", icon: ScrollText, emoji: "🗂️" },
  smart_notes: { label: "Appunti Smart", icon: BookMarked, emoji: "📝" },
};

const EmptyState = ({ icon: Icon, text, onNavigate }: { icon: any; text: string; onNavigate: () => void }) => (
  <div className="text-center py-12">
    <Icon className="h-10 w-10 text-muted-foreground/40 mx-auto mb-3" />
    <p className="text-sm text-muted-foreground">{text}</p>
    <Button size="sm" className="mt-4" onClick={onNavigate}>
      Vai a Studio AI
    </Button>
  </div>
);

const SelectionToolbar = ({ selected, items, onToggleAll, onDeleteSelected, label, deleting }: {
  selected: Set<string>; items: { id: string }[]; onToggleAll: () => void; onDeleteSelected: () => void; label: string; deleting: boolean;
}) => {
  if (items.length === 0) return null;
  return (
    <div className="flex items-center justify-between mb-3 px-1">
      <Button variant="ghost" size="sm" onClick={onToggleAll} className="text-xs gap-1.5">
        <CheckSquare className="h-3.5 w-3.5" />
        {selected.size === items.length ? "Deseleziona tutto" : "Seleziona tutto"}
      </Button>
      {selected.size > 0 && (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="destructive" size="sm" className="text-xs gap-1.5" disabled={deleting}>
              <Trash2 className="h-3.5 w-3.5" />
              Elimina {selected.size} {label}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Eliminare {selected.size} {label}?</AlertDialogTitle>
              <AlertDialogDescription>Questa azione è irreversibile.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Annulla</AlertDialogCancel>
              <AlertDialogAction onClick={onDeleteSelected}>Elimina</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  );
};

function generatePdfHtml(title: string, markdown: string): string {
  // Convert markdown to simple HTML for PDF
  let html = markdown
    .replace(/^### (.+)$/gm, '<h3 style="margin-top:18px;margin-bottom:6px;font-size:14px;font-weight:700;">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 style="margin-top:24px;margin-bottom:8px;font-size:16px;font-weight:700;border-bottom:1px solid #e5e7eb;padding-bottom:4px;">$1</h2>')
    .replace(/^# (.+)$/gm, '<h1 style="margin-top:28px;margin-bottom:10px;font-size:20px;font-weight:800;">$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^- (.+)$/gm, '<li style="margin-left:16px;margin-bottom:2px;">$1</li>')
    .replace(/\n{2,}/g, '</p><p style="margin-bottom:8px;">')
    .replace(/\n/g, '<br>');

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${title}</title>
<style>
  body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 700px; margin: 40px auto; padding: 0 24px; color: #1a1a2e; line-height: 1.6; font-size: 13px; }
  h1 { color: #1a1a2e; } h2 { color: #2d2d5e; } h3 { color: #4a4a7a; }
  li { list-style-type: disc; }
  @media print { body { margin: 20px; } }
</style></head><body>
<h1>${title}</h1>
<p style="margin-bottom:8px;">${html}</p>
</body></html>`;
}

import { LibrarySearch, type SortOption } from "@/components/library/LibrarySearch";

const Library = () => {
  const [searchParams] = useSearchParams();
  const initialTab = searchParams.get("tab") || "domande";
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();

  const [quizzes, setQuizzes] = useState<QuizItem[]>([]);
  const [decks, setDecks] = useState<DeckItem[]>([]);
  const [maps, setMaps] = useState<MapItem[]>([]);
  const [summaries, setSummaries] = useState<SummaryItem[]>([]);
  const [loading, setLoading] = useState(true);

  // Search + sort
  const [searchQuery, setSearchQuery] = useState("");
  const [sortOrder, setSortOrder] = useState<SortOption>("newest");

  // Selection state
  const [selectedQuizzes, setSelectedQuizzes] = useState<Set<string>>(new Set());
  const [selectedDecks, setSelectedDecks] = useState<Set<string>>(new Set());
  const [selectedMaps, setSelectedMaps] = useState<Set<string>>(new Set());
  const [selectedSummaries, setSelectedSummaries] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);

  const fetchData = useCallback(async () => {
    if (!user) return;
    const [qRes, dRes, mRes, sRes] = await Promise.all([
      supabase.from("quizzes").select("id, title, topic, quiz_type, total_questions, created_at, share_token").eq("user_id", user.id).order("created_at", { ascending: false }),
      supabase.from("flashcard_decks").select("id, title, topic, card_count, created_at, share_token").eq("user_id", user.id).order("created_at", { ascending: false }),
      supabase.from("generated_content").select("id, title, content, created_at").eq("user_id", user.id).eq("content_type", "mindmap").order("created_at", { ascending: false }),
      supabase.from("generated_content").select("id, title, content, content_type, created_at, share_token").eq("user_id", user.id).in("content_type", ["summary", "outline", "smart_notes"]).order("created_at", { ascending: false }),
    ]);
    if (qRes.data) setQuizzes(qRes.data);
    if (dRes.data) setDecks(dRes.data);
    if (mRes.data) setMaps(mRes.data as MapItem[]);
    if (sRes.data) setSummaries(sRes.data as SummaryItem[]);
    setLoading(false);
  }, [user]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Filter and sort helpers
  const filterAndSort = <T extends { title?: string | null; topic?: string | null; created_at: string; total_questions?: number; card_count?: number }>(
    items: T[]
  ): T[] => {
    let filtered = items;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      filtered = items.filter(
        (i) => (i.title || "").toLowerCase().includes(q) || (i.topic || "").toLowerCase().includes(q)
      );
    }
    switch (sortOrder) {
      case "oldest": return [...filtered].sort((a, b) => a.created_at.localeCompare(b.created_at));
      case "title":  return [...filtered].sort((a, b) => (a.title || "").localeCompare(b.title || ""));
      case "size":   return [...filtered].sort((a, b) => ((b as any).total_questions || (b as any).card_count || 0) - ((a as any).total_questions || (a as any).card_count || 0));
      default:       return [...filtered].sort((a, b) => b.created_at.localeCompare(a.created_at));
    }
  };

  const filteredQuizzes   = filterAndSort(quizzes);
  const filteredDecks     = filterAndSort(decks);
  const filteredMaps      = filterAndSort(maps);
  const filteredSummaries = filterAndSort(summaries);

  const deleteQuiz = async (id: string) => {
    await supabase.from("quiz_questions").delete().eq("quiz_id", id);
    await supabase.from("quiz_attempts").delete().eq("quiz_id", id);
    await supabase.from("quizzes").delete().eq("id", id);
    setQuizzes(prev => prev.filter(q => q.id !== id));
    toast({ title: "Quiz eliminato" });
  };

  const deleteDeck = async (id: string) => {
    await supabase.from("flashcards").delete().eq("deck_id", id);
    await supabase.from("flashcard_decks").delete().eq("id", id);
    setDecks(prev => prev.filter(d => d.id !== id));
    toast({ title: "Flashcard eliminate" });
  };

  const deleteMap = async (id: string) => {
    await supabase.from("generated_content").delete().eq("id", id);
    setMaps(prev => prev.filter(m => m.id !== id));
    toast({ title: "Mappa eliminata" });
  };

  const deleteSummary = async (id: string) => {
    await supabase.from("generated_content").delete().eq("id", id);
    setSummaries(prev => prev.filter(s => s.id !== id));
    toast({ title: "Contenuto eliminato" });
  };

  // Bulk delete functions
  const deleteSelectedQuizzes = async () => {
    setDeleting(true);
    try {
      await Promise.all([...selectedQuizzes].map(id => deleteQuiz(id)));
      setSelectedQuizzes(new Set());
      toast({ title: `${selectedQuizzes.size} quiz eliminati` });
    } catch { toast({ title: "Errore durante l'eliminazione", variant: "destructive" }); }
    setDeleting(false);
  };

  const deleteSelectedDecks = async () => {
    setDeleting(true);
    try {
      await Promise.all([...selectedDecks].map(id => deleteDeck(id)));
      setSelectedDecks(new Set());
      toast({ title: `${selectedDecks.size} deck eliminati` });
    } catch { toast({ title: "Errore durante l'eliminazione", variant: "destructive" }); }
    setDeleting(false);
  };

  const deleteSelectedMaps = async () => {
    setDeleting(true);
    try {
      await Promise.all([...selectedMaps].map(id => deleteMap(id)));
      setSelectedMaps(new Set());
      toast({ title: `${selectedMaps.size} mappe eliminate` });
    } catch { toast({ title: "Errore durante l'eliminazione", variant: "destructive" }); }
    setDeleting(false);
  };

  const deleteSelectedSummaries = async () => {
    setDeleting(true);
    try {
      await Promise.all([...selectedSummaries].map(id => deleteSummary(id)));
      setSelectedSummaries(new Set());
      toast({ title: `${selectedSummaries.size} contenuti eliminati` });
    } catch { toast({ title: "Errore durante l'eliminazione", variant: "destructive" }); }
    setDeleting(false);
  };

  const toggleSelection = (set: Set<string>, setFn: React.Dispatch<React.SetStateAction<Set<string>>>, id: string) => {
    setFn(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleAll = (items: { id: string }[], selected: Set<string>, setFn: React.Dispatch<React.SetStateAction<Set<string>>>) => {
    if (selected.size === items.length) {
      setFn(new Set());
    } else {
      setFn(new Set(items.map(i => i.id)));
    }
  };



  const handleDownloadPdf = (item: SummaryItem) => {
    const markdown = (item.content as any)?.markdown || "";
    const title = item.title || "Documento";
    const htmlContent = generatePdfHtml(title, markdown);
    const blob = new Blob([htmlContent], { type: "text/html" });
    const url = URL.createObjectURL(blob);

    // Open in new window for print-to-PDF
    const printWindow = window.open(url, "_blank");
    if (printWindow) {
      printWindow.onload = () => {
        setTimeout(() => {
          printWindow.print();
        }, 500);
      };
    } else {
      // Fallback: download as HTML
      const a = document.createElement("a");
      a.href = url;
      a.download = `${title.replace(/[^a-zA-Z0-9]/g, "_")}.html`;
      a.click();
    }
    URL.revokeObjectURL(url);
  };

  const handleDownloadMd = (item: SummaryItem) => {
    const markdown = (item.content as any)?.markdown || "";
    const title = item.title || "Documento";
    const blob = new Blob([markdown], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${title.replace(/[^a-zA-Z0-9]/g, "_")}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };


  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <main className="container mx-auto px-4 py-8 pb-24 md:pb-8 max-w-4xl">
        <div className="mb-6">
          <Button variant="ghost" size="sm" asChild>
            <Link to="/dashboard"><ArrowLeft className="h-4 w-4 mr-2" /> Dashboard</Link>
          </Button>
        </div>

        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
          <div className="mb-6">
            <h1 className="text-2xl md:text-3xl font-bold text-foreground flex items-center gap-2">
              <BookOpen className="h-7 w-7 text-primary" /> Libreria
            </h1>
            <p className="text-muted-foreground mt-1">Tutti i tuoi contenuti generati.</p>
          </div>

          <Tabs defaultValue={initialTab} className="space-y-6">
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="domande" className="flex items-center gap-1.5 text-xs sm:text-sm">
                <Target className="h-4 w-4" /> <span className="hidden sm:inline">Domande</span> <Badge variant="secondary" className="ml-0.5 text-[10px] h-5">{quizzes.length}</Badge>
              </TabsTrigger>
              <TabsTrigger value="flashcard" className="flex items-center gap-1.5 text-xs sm:text-sm">
                <Layers className="h-4 w-4" /> <span className="hidden sm:inline">Flashcard</span> <Badge variant="secondary" className="ml-0.5 text-[10px] h-5">{decks.length}</Badge>
              </TabsTrigger>
              <TabsTrigger value="mappe" className="flex items-center gap-1.5 text-xs sm:text-sm">
                <Map className="h-4 w-4" /> <span className="hidden sm:inline">Mappe</span> <Badge variant="secondary" className="ml-0.5 text-[10px] h-5">{maps.length}</Badge>
              </TabsTrigger>
              <TabsTrigger value="riassunti" className="flex items-center gap-1.5 text-xs sm:text-sm">
                <FileText className="h-4 w-4" /> <span className="hidden sm:inline">Riassunti</span> <Badge variant="secondary" className="ml-0.5 text-[10px] h-5">{summaries.length}</Badge>
              </TabsTrigger>
            </TabsList>

            {loading ? (
              <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
            ) : (
              <>
                {/* Search and sort */}
                <LibrarySearch
                  onSearch={setSearchQuery}
                  onSort={setSortOrder}
                  sortValue={sortOrder}
                  totalItems={filteredQuizzes.length + filteredDecks.length + filteredMaps.length + filteredSummaries.length}
                />

                <TabsContent value="domande">
                  {filteredQuizzes.length === 0 ? (
                    searchQuery
                      ? <p className="text-center text-muted-foreground py-8 text-sm">Nessun quiz corrisponde a "{searchQuery}"</p>
                      : <EmptyState icon={Target} text="Nessun quiz generato. Carica un documento in Studio AI per iniziare!" onNavigate={() => navigate("/study")} />
                  ) : (
                    <>
                      <SelectionToolbar
                        selected={selectedQuizzes} items={filteredQuizzes}
                        onToggleAll={() => toggleAll(quizzes, selectedQuizzes, setSelectedQuizzes)}
                        onDeleteSelected={deleteSelectedQuizzes} label="quiz" deleting={deleting}
                      />
                      <div className="space-y-3">
                        {filteredQuizzes.map((q, i) => (
                          <motion.div key={q.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}
                            className={`flex items-center gap-3 p-4 rounded-xl border bg-card hover:border-primary/40 transition-colors ${selectedQuizzes.has(q.id) ? "border-primary/60 bg-primary/5" : "border-border"}`}>
                            <Checkbox checked={selectedQuizzes.has(q.id)} onCheckedChange={() => toggleSelection(selectedQuizzes, setSelectedQuizzes, q.id)} />
                            {q.quiz_type === "gamified_adhd" ? <Zap className="h-5 w-5 text-accent shrink-0" /> : <Sparkles className="h-5 w-5 text-primary shrink-0" />}
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-card-foreground truncate">{q.title}</p>
                              <p className="text-xs text-muted-foreground">{q.total_questions} domande · {new Date(q.created_at).toLocaleDateString("it-IT")}</p>
                            </div>
                            {q.quiz_type === "gamified_adhd" && <Badge variant="outline" className="text-accent border-accent text-[10px]">ADHD</Badge>}
                            <Button size="sm" onClick={() => navigate(`/study?quiz=${q.id}&gamified=${q.quiz_type === "gamified_adhd"}&source=libreria`)}>Gioca</Button>
                            <ShareButton type="quiz" id={q.id} shareToken={q.share_token} onTokenGenerated={(token) => setQuizzes(prev => prev.map(x => x.id === q.id ? { ...x, share_token: token } : x))} />
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader><AlertDialogTitle>Eliminare questo quiz?</AlertDialogTitle><AlertDialogDescription>Azione irreversibile.</AlertDialogDescription></AlertDialogHeader>
                                <AlertDialogFooter><AlertDialogCancel>Annulla</AlertDialogCancel><AlertDialogAction onClick={() => deleteQuiz(q.id)}>Elimina</AlertDialogAction></AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          </motion.div>
                        ))}
                      </div>
                    </>
                  )}
                </TabsContent>

                <TabsContent value="flashcard">
                  {filteredDecks.length === 0 ? (
                    searchQuery
                      ? <p className="text-center text-muted-foreground py-8 text-sm">Nessun deck corrisponde a "{searchQuery}"</p>
                      : <EmptyState icon={Layers} text="Nessuna flashcard generata. Crea le tue prime flashcard in Studio AI!" onNavigate={() => navigate("/study")} />
                  ) : (
                    <>
                      <SelectionToolbar
                        selected={selectedDecks} items={filteredDecks}
                        onToggleAll={() => toggleAll(decks, selectedDecks, setSelectedDecks)}
                        onDeleteSelected={deleteSelectedDecks} label="deck" deleting={deleting}
                      />
                      <div className="space-y-3">
                        {filteredDecks.map((d, i) => (
                          <motion.div key={d.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}
                            className={`flex items-center gap-3 p-4 rounded-xl border bg-card hover:border-primary/40 transition-colors ${selectedDecks.has(d.id) ? "border-primary/60 bg-primary/5" : "border-border"}`}>
                            <Checkbox checked={selectedDecks.has(d.id)} onCheckedChange={() => toggleSelection(selectedDecks, setSelectedDecks, d.id)} />
                            <Layers className="h-5 w-5 text-primary shrink-0" />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-card-foreground truncate">{d.title}</p>
                              <p className="text-xs text-muted-foreground">{d.card_count} carte · {new Date(d.created_at).toLocaleDateString("it-IT")}</p>
                            </div>
                            <Button size="sm" onClick={() => navigate(`/flashcards?deck=${d.id}`)}>Studia</Button>
                            <ShareButton type="flashcard_deck" id={d.id} shareToken={d.share_token} onTokenGenerated={(token) => setDecks(prev => prev.map(x => x.id === d.id ? { ...x, share_token: token } : x))} />
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader><AlertDialogTitle>Eliminare queste flashcard?</AlertDialogTitle><AlertDialogDescription>Azione irreversibile.</AlertDialogDescription></AlertDialogHeader>
                                <AlertDialogFooter><AlertDialogCancel>Annulla</AlertDialogCancel><AlertDialogAction onClick={() => deleteDeck(d.id)}>Elimina</AlertDialogAction></AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          </motion.div>
                        ))}
                      </div>
                    </>
                  )}
                </TabsContent>

                <TabsContent value="mappe">
                  {filteredMaps.length === 0 ? (
                    <EmptyState icon={Map} text="Nessuna mappa concettuale. Generane una dalla sezione Mappe Concettuali!" onNavigate={() => navigate("/study")} />
                    searchQuery
                      ? <p className="text-center text-muted-foreground py-8 text-sm">Nessuna mappa corrisponde a &quot;{searchQuery}&quot;</p>
                      : <EmptyState icon={Map} text="Nessuna mappa concettuale. Generane una dalla sezione Mappe Concettuali!" onNavigate={() => navigate("/study")} />
                    <>
                      <SelectionToolbar
                        selected={selectedMaps} items={filteredMaps}
                        onToggleAll={() => toggleAll(maps, selectedMaps, setSelectedMaps)}
                        onDeleteSelected={deleteSelectedMaps} label="mappe" deleting={deleting}
                      />
                      <div className="grid sm:grid-cols-2 gap-4">
                        {filteredMaps.map((m, i) => (
                          <motion.div key={m.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}
                            className={`border rounded-xl p-4 bg-card hover:border-primary/40 transition-colors cursor-pointer group ${selectedMaps.has(m.id) ? "border-primary/60 bg-primary/5" : "border-border"}`}
                            onClick={() => navigate(`/mappe-concettuali?map=${m.id}`)}>
                            <div className="flex items-start justify-between">
                              <div className="flex items-start gap-2 flex-1 min-w-0">
                                <Checkbox
                                  checked={selectedMaps.has(m.id)}
                                  onCheckedChange={() => toggleSelection(selectedMaps, setSelectedMaps, m.id)}
                                  onClick={(e) => e.stopPropagation()}
                                  className="mt-0.5"
                                />
                                <div className="min-w-0">
                                  <p className="text-sm font-medium text-card-foreground truncate">{m.title || "Mappa senza titolo"}</p>
                                  <p className="text-xs text-muted-foreground mt-1">{new Date(m.created_at).toLocaleDateString("it-IT")}</p>
                                  <p className="text-xs text-muted-foreground">{(m.content as any)?.nodes?.length || 0} nodi</p>
                                </div>
                              </div>
                              <Button
                                variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                                onClick={(e) => { e.stopPropagation(); deleteMap(m.id); }}
                              ><Trash2 className="h-3 w-3" /></Button>
                            </div>
                          </motion.div>
                        ))}
                      </div>
                    </>
                  )}
                </TabsContent>

                <TabsContent value="riassunti">
                  {filteredSummaries.length === 0 ? (
                    searchQuery
                      ? <p className="text-center text-muted-foreground py-8 text-sm">Nessun riassunto corrisponde a &quot;{searchQuery}&quot;</p>
                      : <EmptyState icon={FileText} text="Nessun riassunto generato. Genera il tuo primo riassunto, schema o appunti smart in Studio AI!" onNavigate={() => navigate("/study")} />
                  ) : (
                    <>
                      <SelectionToolbar
                        selected={selectedSummaries} items={filteredSummaries}
                        onToggleAll={() => toggleAll(summaries, selectedSummaries, setSelectedSummaries)}
                        onDeleteSelected={deleteSelectedSummaries} label="contenuti" deleting={deleting}
                      />
                      <div className="space-y-3">
                        {filteredSummaries.map((s, i) => {
                          const typeInfo = SUMMARY_TYPE_LABELS[s.content_type] || SUMMARY_TYPE_LABELS.summary;
                          const markdown = (s.content as any)?.markdown || "";
                          const wordCount = markdown.split(/\s+/).filter(Boolean).length;

                          return (
                            <motion.div key={s.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}
                              className={`flex items-center gap-3 p-4 rounded-xl border bg-card hover:border-primary/40 transition-colors ${selectedSummaries.has(s.id) ? "border-primary/60 bg-primary/5" : "border-border"}`}>
                              <Checkbox checked={selectedSummaries.has(s.id)} onCheckedChange={() => toggleSelection(selectedSummaries, setSelectedSummaries, s.id)} />
                              <span className="text-xl shrink-0">{typeInfo.emoji}</span>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-card-foreground truncate">{s.title || "Senza titolo"}</p>
                                <p className="text-xs text-muted-foreground">
                                  {typeInfo.label} · {wordCount} parole · {new Date(s.created_at).toLocaleDateString("it-IT")}
                                </p>
                              </div>
                              <Badge variant="outline" className="text-[10px] shrink-0">{typeInfo.label}</Badge>
                              <Button size="sm" variant="outline" onClick={() => navigate(`/libreria/riassunto/${s.id}`)}>
                                Leggi
                              </Button>
                              <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground hover:text-primary" onClick={() => handleDownloadPdf(s)} title="Scarica PDF">
                                <Download className="h-3.5 w-3.5" />
                              </Button>
                              <ShareButton type="summary" id={s.id} shareToken={s.share_token} onTokenGenerated={(token) => setSummaries(prev => prev.map(x => x.id === s.id ? { ...x, share_token: token } : x))} />
                              <AlertDialog>
                                <AlertDialogTrigger asChild>
                                  <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                  <AlertDialogHeader><AlertDialogTitle>Eliminare questo contenuto?</AlertDialogTitle><AlertDialogDescription>Azione irreversibile.</AlertDialogDescription></AlertDialogHeader>
                                  <AlertDialogFooter><AlertDialogCancel>Annulla</AlertDialogCancel><AlertDialogAction onClick={() => deleteSummary(s.id)}>Elimina</AlertDialogAction></AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                            </motion.div>
                          );
                        })}
                      </div>
                    </>
                  )}
                </TabsContent>
              </>
            )}
          </Tabs>
        </motion.div>
      </main>
      <MobileBottomNav />
    </div>
  );
};

export default Library;
