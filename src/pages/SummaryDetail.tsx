import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Download, ChevronLeft, ChevronRight, Loader2, Bookmark, Share2, Info, Sparkles, Send, X, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import ReactMarkdown from "react-markdown";
import { motion, AnimatePresence } from "framer-motion";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useIsMobile } from "@/hooks/use-mobile";
import { toast } from "sonner";
import { useCredits, CREDIT_COSTS } from "@/hooks/useCredits";
import { escapeHtml, isSafeUuid, SAFE_MARKDOWN_COMPONENTS } from "@/lib/security";
import { getAuthToken, streamTutorChat } from "@/lib/backendApi";
import { consumeOpenAiSseStream } from "@/lib/sse";
const FORMAT_LABELS: Record<string, { label: string; emoji: string }> = {
  summary: { label: "Riassunto", emoji: "📄" },
  outline: { label: "Schema", emoji: "🗂️" },
  smart_notes: { label: "Appunti Smart", emoji: "📝" },
};

type ChatMsg = { role: "user" | "assistant"; content: string };
type GeneratedContentPayload = { markdown?: string };

function splitIntoPages(md: string, linesPerPage = 42): string[] {
  if (!md.trim()) return [""];
  const lines = md.split("\n");
  const pages: string[] = [];
  let current: string[] = [];
  for (const line of lines) {
    if (/^#{1,2}\s/.test(line) && current.length > linesPerPage * 0.4) {
      pages.push(current.join("\n"));
      current = [];
    }
    current.push(line);
    if (current.length >= linesPerPage) {
      pages.push(current.join("\n"));
      current = [];
    }
  }
  if (current.length > 0) {
    if (pages.length > 0 && current.length < linesPerPage * 0.2) {
      pages[pages.length - 1] += "\n" + current.join("\n");
    } else {
      pages.push(current.join("\n"));
    }
  }
  return pages.length ? pages : [""];
}

function markdownToHtml(md: string, docTitle: string): string {
  const lines = escapeHtml(md).split("\n");
  const htmlParts: string[] = [];
  let inList = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) { if (inList) { htmlParts.push("</ul>"); inList = false; } continue; }
    const h3 = trimmed.match(/^###\s+(.+)/);
    if (h3) { if (inList) { htmlParts.push("</ul>"); inList = false; } htmlParts.push(`<h3>${applyInline(h3[1])}</h3>`); continue; }
    const h2 = trimmed.match(/^##\s+(.+)/);
    if (h2) { if (inList) { htmlParts.push("</ul>"); inList = false; } htmlParts.push(`<h2>${applyInline(h2[1])}</h2>`); continue; }
    const h1 = trimmed.match(/^#\s+(.+)/);
    if (h1) { if (inList) { htmlParts.push("</ul>"); inList = false; } htmlParts.push(`<h1>${applyInline(h1[1])}</h1>`); continue; }
    const li = trimmed.match(/^[-*]\s+(.+)/);
    if (li) { if (!inList) { htmlParts.push("<ul>"); inList = true; } htmlParts.push(`<li>${applyInline(li[1])}</li>`); continue; }
    const ol = trimmed.match(/^\d+\.\s+(.+)/);
    if (ol) { if (!inList) { htmlParts.push("<ul>"); inList = true; } htmlParts.push(`<li>${applyInline(ol[1])}</li>`); continue; }
    if (inList) { htmlParts.push("</ul>"); inList = false; }
    htmlParts.push(`<p>${applyInline(trimmed)}</p>`);
  }
  if (inList) htmlParts.push("</ul>");
  return `<!DOCTYPE html><html lang="it"><head><meta charset="utf-8"><title>${escapeHtml(docTitle)}</title>
<style>@page{margin:2cm 2.5cm;size:A4}*{box-sizing:border-box}body{font-family:'Georgia','Times New Roman',serif;margin:0;padding:2cm 2.5cm;color:#1a1a2e;line-height:1.75;font-size:11.5pt}.doc-title{font-size:20pt;font-weight:800;color:#0f172a;margin-bottom:6px;border-bottom:3px solid #3b82f6;padding-bottom:10px}.doc-meta{font-size:9pt;color:#64748b;margin-bottom:24px}h1{font-size:16pt;font-weight:700;color:#0f172a;margin:28px 0 10px;border-bottom:2px solid #e2e8f0;padding-bottom:4px}h2{font-size:13pt;font-weight:700;color:#1e293b;margin:22px 0 8px}h3{font-size:11.5pt;font-weight:600;color:#334155;margin:16px 0 6px}p{margin:0 0 8px;text-align:justify}ul{margin:4px 0 12px 20px;padding:0}li{margin-bottom:3px}strong{font-weight:700}em{font-style:italic}@media print{body{padding:0}}</style></head><body>
<div class="doc-title">${escapeHtml(docTitle)}</div>
<div class="doc-meta">Generato con FocusED · ${new Date().toLocaleDateString("it-IT", { year: "numeric", month: "long", day: "numeric" })}</div>
${htmlParts.join("\n")}</body></html>`;
}

function applyInline(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/`(.+?)`/g, '<code style="background:#f1f5f9;padding:1px 4px;border-radius:3px;font-size:10pt;">$1</code>');
}

const SummaryDetail = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const isMobile = useIsMobile();
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState("");
  const [markdown, setMarkdown] = useState("");
  const [format, setFormat] = useState("summary");
  const [currentPage, setCurrentPage] = useState(0);

  // Chat state
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMsg[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!user || !id) return;
    if (!isSafeUuid(id)) {
      toast.error("Contenuto non valido");
      navigate("/libreria?tab=riassunti", { replace: true });
      return;
    }
    const load = async () => {
      const { data } = await supabase
        .from("generated_content")
        .select("title, content, content_type")
        .eq("id", id)
        .eq("user_id", user.id)
        .single();
      if (data) {
        setTitle(data.title || "Senza titolo");
        setMarkdown(((data.content as GeneratedContentPayload | null) ?? {}).markdown || "");
        setFormat(data.content_type);
      }
      setLoading(false);
    };
    load();
  }, [user, id, navigate]);

  const pages = useMemo(() => splitIntoPages(markdown), [markdown]);
  const totalPages = pages.length;

  // Swipe
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }, []);
  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (!touchStartRef.current) return;
    const dx = e.changedTouches[0].clientX - touchStartRef.current.x;
    const dy = e.changedTouches[0].clientY - touchStartRef.current.y;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      if (dx < 0 && currentPage < totalPages - 1) setCurrentPage(p => p + 1);
      else if (dx > 0 && currentPage > 0) setCurrentPage(p => p - 1);
    }
    touchStartRef.current = null;
  }, [currentPage, totalPages]);

  // Keyboard nav (disabled when chat input focused)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (chatOpen && document.activeElement === inputRef.current) return;
      if (e.key === "ArrowRight" && currentPage < totalPages - 1) setCurrentPage(p => p + 1);
      if (e.key === "ArrowLeft" && currentPage > 0) setCurrentPage(p => p - 1);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [currentPage, totalPages, chatOpen]);

  // Auto-scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages]);

  const handleCopy = () => { navigator.clipboard.writeText(markdown); toast.success("Copiato negli appunti"); };
  const handleDownloadPdf = () => {
    const fullHtml = markdownToHtml(markdown, title);
    const blob = new Blob([fullHtml], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const pw = window.open(url, "_blank", "noopener,noreferrer");
    if (pw) {
      pw.opener = null;
      pw.onload = () => setTimeout(() => {
        pw.print();
        setTimeout(() => URL.revokeObjectURL(url), 5_000);
      }, 400);
      pw.onafterprint = () => URL.revokeObjectURL(url);
    } else {
      URL.revokeObjectURL(url);
    }
  };
  const handleShare = async () => {
    if (!navigator.share) {
      handleCopy();
      return;
    }
    try {
      await navigator.share({ title, text: markdown.slice(0, 200) });
    } catch (err) {
      const isAbort = err instanceof DOMException && err.name === "AbortError";
      if (!isAbort) handleCopy();
    }
  };

  const { spendCredits, addCredits, totalCredits } = useCredits();

  const sendMessage = async (text?: string) => {
    const msg = (text || chatInput).trim();
    if (!msg || chatLoading) return;
    let shouldRefund = false;

    setChatInput("");
    const userMsg: ChatMsg = { role: "user", content: msg };
    const newMessages = [...chatMessages, userMsg];
    setChatMessages(newMessages);
    setChatLoading(true);

    let assistantSoFar = "";
    const upsert = (chunk: string) => {
      assistantSoFar += chunk;
      setChatMessages(prev => {
        const last = prev[prev.length - 1];
        if (last?.role === "assistant") {
          return prev.map((m, i) => i === prev.length - 1 ? { ...m, content: assistantSoFar } : m);
        }
        return [...prev, { role: "assistant", content: assistantSoFar }];
      });
    };

    try {
      if (totalCredits < CREDIT_COSTS.tutor) {
        toast.error("NeuroCredits insufficienti (1 credito per messaggio)");
        return;
      }

      const token = await getAuthToken().catch(() => null);
      if (!token) {
        toast.error("Sessione scaduta. Effettua nuovamente il login.");
        return;
      }

      const success = await spendCredits("tutor");
      if (!success) {
        toast.error("NeuroCredits insufficienti (1 credito per messaggio)");
        return;
      }
      shouldRefund = true;

      const resp = await streamTutorChat(newMessages, token, markdown);
      if (resp.status === 429) {
        toast.error("Troppe richieste. Riprova tra qualche secondo.");
        return;
      }
      if (resp.status === 402) {
        toast.error("Crediti AI esauriti. Contatta il supporto.");
        return;
      }
      if (!resp.ok || !resp.body) {
        throw new Error("Stream non disponibile");
      }

      await consumeOpenAiSseStream(resp, upsert);
      if (assistantSoFar.trim().length > 0) {
        shouldRefund = false;
      } else {
        toast.error("Risposta vuota dal tutor. Credito rimborsato.");
      }
    } catch {
      toast.error("Errore di connessione");
    } finally {
      if (shouldRefund) {
        await addCredits(CREDIT_COSTS.tutor, "tutor_refund", "Rimborso automatico chat documento non riuscita");
      }
      setChatLoading(false);
    }
  };

  const handleInputSubmit = (e: React.FormEvent) => { e.preventDefault(); sendMessage(); };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  const info = FORMAT_LABELS[format] || FORMAT_LABELS.summary;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* ── Top bar ── */}
      <header className="sticky top-0 z-30 bg-background/80 backdrop-blur-md border-b border-border/50">
        <div className="flex items-center justify-between px-4 h-14">
          <Button variant="ghost" size="icon" onClick={() => navigate("/libreria?tab=riassunti")} className="h-9 w-9 text-foreground">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" className="h-9 w-9 text-muted-foreground" onClick={handleCopy} title="Salva"><Bookmark className="h-5 w-5" /></Button>
            <Button variant="ghost" size="icon" className="h-9 w-9 text-muted-foreground" onClick={handleShare} title="Condividi"><Share2 className="h-5 w-5" /></Button>
            <Button variant="ghost" size="icon" className="h-9 w-9 text-muted-foreground" onClick={handleDownloadPdf} title="PDF"><Download className="h-5 w-5" /></Button>
            <Button variant="ghost" size="icon" className="h-9 w-9 text-muted-foreground" title="Info"><Info className="h-5 w-5" /></Button>
          </div>
        </div>
      </header>

      {/* ── Document content ── */}
      <main className="flex-1 overflow-y-auto touch-pan-y" onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
        <div className="max-w-2xl mx-auto px-5 md:px-10 py-8 md:py-12">
          <AnimatePresence mode="wait">
            <motion.div
              key={currentPage}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.2 }}
              className="prose prose-sm md:prose-base dark:prose-invert max-w-none
                prose-headings:font-display prose-headings:text-foreground
                prose-p:text-foreground/90 prose-p:leading-relaxed
                prose-li:text-foreground/90 prose-strong:text-foreground prose-strong:font-semibold
                prose-ul:my-2 prose-ol:my-2"
              style={{ fontSize: isMobile ? "14px" : "15px", lineHeight: 1.8 }}
            >
              <ReactMarkdown components={SAFE_MARKDOWN_COMPONENTS}>{pages[currentPage]}</ReactMarkdown>
            </motion.div>
          </AnimatePresence>

          <div className="flex justify-end mt-8 mb-4">
            <span className="text-xs text-muted-foreground/50 font-medium">{currentPage + 1}</span>
          </div>
          <div className="border-t border-border/40 mb-6" />

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-3 mb-8">
              <Button variant="ghost" size="icon" disabled={currentPage === 0} onClick={() => setCurrentPage(p => p - 1)} className="h-8 w-8 text-muted-foreground">
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <div className="flex items-center gap-1.5">
                {Array.from({ length: totalPages }, (_, i) => (
                  <button key={i} onClick={() => setCurrentPage(i)}
                    className={`h-1.5 rounded-full transition-all ${i === currentPage ? "bg-primary w-4" : "bg-muted-foreground/20 w-1.5 hover:bg-muted-foreground/40"}`}
                  />
                ))}
              </div>
              <Button variant="ghost" size="icon" disabled={currentPage === totalPages - 1} onClick={() => setCurrentPage(p => p + 1)} className="h-8 w-8 text-muted-foreground">
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>
      </main>

      {/* ── Chat panel (slide up) ── */}
      <AnimatePresence>
        {chatOpen && (
          <motion.div
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            className="fixed inset-x-0 bottom-0 z-40 bg-background border-t border-border rounded-t-2xl flex flex-col"
            style={{ maxHeight: "70vh" }}
          >
            {/* Chat header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-border/50 shrink-0">
              <div className="flex items-center gap-2">
                <MessageCircle className="h-4 w-4 text-primary" />
                <span className="text-sm font-semibold text-foreground">FocusEd AI</span>
                <span className="text-xs text-muted-foreground">· {title}</span>
              </div>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setChatOpen(false)}>
                <X className="h-4 w-4" />
              </Button>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4 min-h-0">
              {chatMessages.length === 0 && (
                <div className="text-center py-8">
                  <MessageCircle className="h-8 w-8 text-muted-foreground/30 mx-auto mb-3" />
                  <p className="text-sm text-muted-foreground/60">Chiedi qualcosa sul documento</p>
                  <div className="flex flex-wrap gap-2 justify-center mt-4">
                    {["Riassumimi questa pagina", "Quali sono i concetti chiave?", "Spiegami come se avessi 10 anni"].map(s => (
                      <button
                        key={s}
                        onClick={() => sendMessage(s)}
                        className="text-xs px-3 py-1.5 rounded-full bg-muted/60 text-muted-foreground hover:bg-muted transition-colors"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {chatMessages.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm ${
                    msg.role === "user"
                      ? "bg-primary text-primary-foreground rounded-br-md"
                      : "bg-muted/60 text-foreground rounded-bl-md"
                  }`}>
                    {msg.role === "assistant" ? (
                      <div className="prose prose-sm dark:prose-invert max-w-none prose-p:my-1 prose-ul:my-1 prose-li:my-0">
                        <ReactMarkdown components={SAFE_MARKDOWN_COMPONENTS}>{msg.content}</ReactMarkdown>
                      </div>
                    ) : msg.content}
                  </div>
                </div>
              ))}

              {chatLoading && chatMessages[chatMessages.length - 1]?.role !== "assistant" && (
                <div className="flex justify-start">
                  <div className="bg-muted/60 rounded-2xl rounded-bl-md px-4 py-3">
                    <div className="flex gap-1">
                      <span className="h-2 w-2 rounded-full bg-muted-foreground/40 animate-bounce" style={{ animationDelay: "0ms" }} />
                      <span className="h-2 w-2 rounded-full bg-muted-foreground/40 animate-bounce" style={{ animationDelay: "150ms" }} />
                      <span className="h-2 w-2 rounded-full bg-muted-foreground/40 animate-bounce" style={{ animationDelay: "300ms" }} />
                    </div>
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            {/* Chat input */}
            <form onSubmit={handleInputSubmit} className="shrink-0 border-t border-border/50 px-4 py-3 flex items-center gap-2 safe-area-bottom">
              <div className="flex-1 bg-muted/50 rounded-2xl px-4 py-2.5">
                <input
                  ref={inputRef}
                  type="text"
                  placeholder="Scrivi un messaggio..."
                  value={chatInput}
                  onChange={e => setChatInput(e.target.value)}
                  className="w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground/60 outline-none"
                  disabled={chatLoading}
                  autoFocus
                />
              </div>
              <Button
                type="submit"
                size="icon"
                disabled={!chatInput.trim() || chatLoading}
                className="h-10 w-10 rounded-full shrink-0"
              >
                <Send className="h-4 w-4" />
              </Button>
            </form>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Bottom bar ── */}
      {!chatOpen && (
        <div className="sticky bottom-0 bg-background/80 backdrop-blur-md border-t border-border/50 px-4 py-3 space-y-3 safe-area-bottom">
          <div>
            <Button variant="outline" size="sm" className="rounded-full gap-2 text-sm font-medium border-border/60" onClick={() => navigate("/questions")}>
              <Sparkles className="h-4 w-4 text-primary" />
              Quiz IA
            </Button>
          </div>
          <div className="flex items-center gap-2" onClick={() => { setChatOpen(true); }} role="button" tabIndex={0}>
            <div className="flex-1 bg-muted/50 rounded-2xl px-4 py-3 cursor-text">
              <span className="text-sm text-muted-foreground/60">Chiedi qualsiasi cosa su questo documento...</span>
            </div>
            <Button variant="ghost" size="icon" className="h-10 w-10 text-muted-foreground/50 shrink-0">
              <Send className="h-5 w-5" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};

export default SummaryDetail;
