import { useState, useEffect, useCallback, useRef } from "react";
// backendApi removed — now uses supabase.functions.invoke directly
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useCredits, CREDIT_COSTS } from "@/hooks/useCredits";
import { useSubscription } from "@/hooks/useSubscription";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, Map, Plus, Loader2, Trash2, Zap, Lock, Upload, FileText } from "lucide-react";
import { Link } from "react-router-dom";
import AppHeader from "@/components/AppHeader";
import MindMapViewer from "@/components/study/MindMapViewer";
import CreditPaywall from "@/components/dashboard/CreditPaywall";
import { extractTextFromFile } from "@/lib/textExtraction";
import { generateMindmap } from "@/lib/backendApi";

interface SavedMap {
  id: string;
  title: string | null;
  content: MindMapContent | null;
  created_at: string;
}

interface MindMapContent {
  nodes?: unknown[];
  edges?: unknown[];
}

const getErrorMessage = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback;

const SUPPORTED_EXTENSIONS = [".txt", ".md", ".pdf", ".docx", ".doc"];

const MindMaps = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const { totalCredits, spendCredits, refreshCredits } = useCredits();
  const { isPro } = useSubscription();
  const fileRef = useRef<HTMLInputElement>(null);

  const [maps, setMaps] = useState<SavedMap[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [inputText, setInputText] = useState("");
  const [showGenerator, setShowGenerator] = useState(false);
  const [activeMap, setActiveMap] = useState<SavedMap | null>(null);
  const [showPaywall, setShowPaywall] = useState(false);
  const [inputMode, setInputMode] = useState<"text" | "file">("text");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [extracting, setExtracting] = useState(false);

  const fetchMaps = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from("generated_content")
      .select("id, title, content, created_at")
      .eq("user_id", user.id)
      .eq("content_type", "mindmap")
      .order("created_at", { ascending: false });
    if (data) setMaps(data as SavedMap[]);
    setLoading(false);
  }, [user]);

  useEffect(() => { fetchMaps(); }, [fetchMaps]);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 10 * 1024 * 1024) {
      toast({ title: "File troppo grande", description: "Massimo 10MB.", variant: "destructive" });
      return;
    }
    const ext = f.name.toLowerCase().substring(f.name.lastIndexOf("."));
    if (!SUPPORTED_EXTENSIONS.includes(ext)) {
      toast({ title: "Formato non supportato", description: `Formati: ${SUPPORTED_EXTENSIONS.join(", ")}`, variant: "destructive" });
      return;
    }
    setSelectedFile(f);
    setExtracting(true);
    try {
      const text = await extractTextFromFile(f);
      if (text.trim().length < 50) {
        toast({ title: "Contenuto insufficiente", description: "Il documento è troppo corto.", variant: "destructive" });
        setSelectedFile(null);
        return;
      }
      setInputText(text);
      toast({ title: "Testo estratto ✅", description: `${text.length.toLocaleString()} caratteri da ${f.name}` });
    } catch {
      toast({ title: "Errore estrazione", description: "Prova a incollare il testo manualmente.", variant: "destructive" });
      setSelectedFile(null);
    } finally {
      setExtracting(false);
    }
  };

  const generateMap = async () => {
    if (!user || !inputText.trim()) return;
    if (totalCredits < CREDIT_COSTS.mindmap) { setShowPaywall(true); return; }

    setGenerating(true);
    try {
      const spent = await spendCredits("mindmap");
      if (!spent) { setShowPaywall(true); return; }

      const { nodes, edges } = await generateMindmap(inputText.trim());
      const title = selectedFile?.name || inputText.trim().substring(0, 60);

      const { data: saved } = await supabase
        .from("generated_content")
        .insert({ user_id: user.id, content_type: "mindmap", title, content: { nodes, edges } })
        .select("id, title, content, created_at")
        .single();

      if (saved) {
        setMaps((prev) => [saved as SavedMap, ...prev]);
        setActiveMap(saved as SavedMap);
        setShowGenerator(false);
        setInputText("");
        setSelectedFile(null);
      }
      toast({ title: "Mappa generata! 🧠", description: `Spesi ${CREDIT_COSTS.mindmap} NeuroCredits` });
    } catch (err: unknown) {
      toast({
        title: "Errore",
        description: getErrorMessage(err, "Generazione fallita"),
        variant: "destructive",
      });
      await refreshCredits();
    } finally {
      setGenerating(false);
    }
  };

  const deleteMap = async (id: string) => {
    await supabase.from("generated_content").delete().eq("id", id);
    setMaps((prev) => prev.filter((m) => m.id !== id));
    if (activeMap?.id === id) setActiveMap(null);
    toast({ title: "Mappa eliminata" });
  };

  if (activeMap) {
    const content = activeMap.content;
    return (
      <div className="min-h-screen bg-background">
        <AppHeader />
        <main className="container mx-auto px-4 py-8 max-w-4xl">
          <MindMapViewer nodes={content.nodes || []} edges={content.edges || []} onBack={() => setActiveMap(null)} />
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <main className="container mx-auto px-4 py-8 max-w-4xl">
        <div className="mb-6">
          <Button variant="ghost" size="sm" asChild>
            <Link to="/dashboard"><ArrowLeft className="h-4 w-4 mr-2" /> Dashboard</Link>
          </Button>
        </div>

        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-2xl md:text-3xl font-bold text-foreground flex items-center gap-2">
                <Map className="h-7 w-7 text-primary" /> Mappe Concettuali
              </h1>
              <p className="text-muted-foreground mt-1">Genera e salva schemi visivi dai tuoi appunti.</p>
            </div>
            <div className="flex items-center gap-3">
              <Badge variant="secondary"><Zap className="h-3 w-3 mr-1" /> {totalCredits} cr</Badge>
              <Button size="sm" onClick={() => setShowGenerator(!showGenerator)}>
                <Plus className="h-4 w-4 mr-1" /> Nuova mappa
              </Button>
            </div>
          </div>

          {/* Generator */}
          <AnimatePresence>
            {showGenerator && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden mb-6">
                <div className="bg-card rounded-xl border border-border shadow-card p-6">
                  <h3 className="font-semibold text-card-foreground mb-3">Inserisci testo o carica file</h3>

                  {/* Input mode toggle */}
                  <div className="flex gap-1 bg-secondary rounded-lg p-1 mb-4">
                    <button onClick={() => setInputMode("text")}
                      className={`flex-1 text-sm font-medium py-2 rounded-md transition-all ${inputMode === "text" ? "bg-primary text-primary-foreground shadow-soft" : "text-muted-foreground hover:text-foreground"}`}>
                      ✏️ Incolla testo
                    </button>
                    <button onClick={() => setInputMode("file")}
                      className={`flex-1 text-sm font-medium py-2 rounded-md transition-all ${inputMode === "file" ? "bg-primary text-primary-foreground shadow-soft" : "text-muted-foreground hover:text-foreground"}`}>
                      📄 Carica file
                    </button>
                  </div>

                  {inputMode === "text" ? (
                    <Textarea
                      placeholder="Incolla qui il testo da cui generare la mappa concettuale..."
                      value={inputText}
                      onChange={(e) => setInputText(e.target.value)}
                      rows={6}
                      className="mb-4"
                    />
                  ) : (
                    <div className="mb-4">
                      <input ref={fileRef} type="file" accept=".txt,.md,.pdf,.doc,.docx" onChange={handleFileSelect} className="hidden" />
                      <div
                        onClick={() => !extracting && fileRef.current?.click()}
                        className={`border-2 border-dashed border-border rounded-xl p-8 text-center cursor-pointer hover:border-primary/50 hover:bg-secondary/30 transition-all ${extracting ? "pointer-events-none opacity-70" : ""}`}
                      >
                        {extracting ? (
                          <div className="flex flex-col items-center gap-3">
                            <Loader2 className="h-10 w-10 text-primary animate-spin" />
                            <p className="text-sm font-medium text-card-foreground">Estrazione testo in corso...</p>
                          </div>
                        ) : selectedFile ? (
                          <div className="flex items-center justify-center gap-3">
                            <FileText className="h-8 w-8 text-primary" />
                            <div className="text-left">
                              <p className="font-medium text-card-foreground">{selectedFile.name}</p>
                              <p className="text-xs text-muted-foreground">{inputText.length.toLocaleString()} caratteri estratti</p>
                            </div>
                          </div>
                        ) : (
                          <>
                            <Upload className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
                            <p className="text-sm font-medium text-card-foreground">Trascina un documento qui</p>
                            <p className="text-xs text-muted-foreground mt-1">PDF, DOCX, TXT, MD — max 10MB</p>
                          </>
                        )}
                      </div>
                    </div>
                  )}

                  <div className="flex items-center justify-between">
                    <p className="text-xs text-muted-foreground">Costo: {CREDIT_COSTS.mindmap} NeuroCredits</p>
                    <Button onClick={generateMap} disabled={generating || !inputText.trim()}>
                      {generating ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Generando...</> : <><Map className="h-4 w-4 mr-2" /> Genera mappa</>}
                    </Button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Gallery */}
          <div className="bg-card rounded-xl border border-border shadow-card p-6">
            <h3 className="font-semibold text-card-foreground mb-4">📁 I miei schemi</h3>
            {loading ? (
              <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
            ) : maps.length === 0 ? (
              <p className="text-center text-muted-foreground py-8 text-sm">Nessuna mappa salvata. Genera la tua prima mappa concettuale! 🧠</p>
            ) : (
              <div className="grid sm:grid-cols-2 gap-4">
                {maps.map((map, i) => (
                  <motion.div key={map.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
                    className="border border-border rounded-xl p-4 hover:border-primary/40 transition-colors cursor-pointer group"
                    onClick={() => setActiveMap(map)}>
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-card-foreground truncate">{map.title || "Mappa senza titolo"}</p>
                        <p className="text-xs text-muted-foreground mt-1">{new Date(map.created_at).toLocaleDateString("it-IT")}</p>
                        <p className="text-xs text-muted-foreground">{map.content?.nodes?.length || 0} nodi</p>
                      </div>
                      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        {!isPro && (
                          <Button variant="ghost" size="icon" className="h-7 w-7" disabled title="Solo PRO"><Lock className="h-3 w-3" /></Button>
                        )}
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive"
                          onClick={(e) => { e.stopPropagation(); deleteMap(map.id); }}>
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>
            )}
          </div>
        </motion.div>
      </main>
      <CreditPaywall open={showPaywall} onClose={() => setShowPaywall(false)} action="mindmap" creditsNeeded={CREDIT_COSTS.mindmap} />
    </div>
  );
};

export default MindMaps;
