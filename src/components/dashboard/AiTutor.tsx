import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MessageCircle, Send, Loader2, Bot, User, Zap, Upload, FileText, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { supabase } from "@/integrations/supabase/client";
import { streamTutorChat, getAuthToken } from "@/lib/backendApi";
import { useCredits, CREDIT_COSTS } from "@/hooks/useCredits";
import { useSubscription } from "@/hooks/useSubscription";
import { SAFE_MARKDOWN_COMPONENTS } from "@/lib/security";
import { useToast } from "@/hooks/use-toast";
import { consumeOpenAiSseStream } from "@/lib/sse";
import ReactMarkdown from "react-markdown";
import * as pdfjsLib from "pdfjs-dist";
import pdfWorkerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import mammoth from "mammoth";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerSrc;

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface PdfTextItem {
  str?: string;
}

const SUPPORTED_DOC_EXTENSIONS = new Set([".txt", ".md", ".pdf", ".doc", ".docx"]);
const MAX_DOC_UPLOAD_BYTES = 50 * 1024 * 1024;
const MAX_TEXT_UPLOAD_BYTES = 5 * 1024 * 1024;

const AiTutor = () => {
  const { toast } = useToast();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const { totalCredits, spendCredits, addCredits } = useCredits();
  const { isHyperfocus } = useSubscription();

  // Document context for Hyperfocus users
  const [docContext, setDocContext] = useState<string | null>(null);
  const [docName, setDocName] = useState<string | null>(null);
  const [extracting, setExtracting] = useState(false);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleDocUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const ext = f.name.toLowerCase().substring(f.name.lastIndexOf("."));
    if (!SUPPORTED_DOC_EXTENSIONS.has(ext)) {
      toast({
        title: "Formato non supportato",
        description: "Carica solo file .txt, .md, .pdf, .doc o .docx.",
        variant: "destructive",
      });
      e.target.value = "";
      return;
    }
    if (f.size > MAX_DOC_UPLOAD_BYTES || (ext === ".txt" || ext === ".md") && f.size > MAX_TEXT_UPLOAD_BYTES) {
      toast({
        title: "File troppo grande",
        description: ext === ".txt" || ext === ".md"
          ? "Per i file testuali il limite è 5MB."
          : "Il limite è 50MB per file.",
        variant: "destructive",
      });
      e.target.value = "";
      return;
    }

    setExtracting(true);
    try {
      let text = "";
      if (ext === ".pdf") {
        const pdf = await pdfjsLib.getDocument({ data: await f.arrayBuffer() }).promise;
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const content = await page.getTextContent();
          text += content.items.map((item) => (item as PdfTextItem).str ?? "").join(" ") + "\n";
        }
      } else if (ext === ".docx" || ext === ".doc") {
        const result = await mammoth.extractRawText({ arrayBuffer: await f.arrayBuffer() });
        text = result.value;
      } else {
        text = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = (ev) => resolve(ev.target?.result as string || "");
          reader.onerror = () => reject(new Error("Read error"));
          reader.readAsText(f);
        });
      }

      if (text.trim().length < 50) {
        toast({
          title: "Documento troppo corto",
          description: "Il documento deve contenere almeno un po' di testo utile.",
          variant: "destructive",
        });
        e.target.value = "";
        return;
      }

      // Limit context to ~8000 chars to stay within token limits
      setDocContext(text.slice(0, 8000));
      setDocName(f.name);
      setMessages(prev => [...prev, {
        role: "assistant",
        content: `📄 **Documento caricato: ${f.name}**\n\nHo letto il documento (${text.length.toLocaleString()} caratteri). Ora puoi farmi domande specifiche su questo contenuto!`
      }]);
      e.target.value = "";
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : "Impossibile leggere il file. Prova con un altro formato.";
      console.error("Doc upload error:", err);
      toast({
        title: "Errore lettura documento",
        description: errorMessage,
        variant: "destructive",
      });
      setDocContext(null);
      setDocName(null);
      e.target.value = "";
    } finally {
      setExtracting(false);
    }
  };

  const removeDoc = () => {
    setDocContext(null);
    setDocName(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;
    const userInput = input.trim();

    if (totalCredits < CREDIT_COSTS.tutor) {
      setMessages((prev) => [...prev,
        { role: "user", content: userInput },
        { role: "assistant", content: "⚡ **NeuroCredits esauriti!** Passa a un piano superiore per ottenere più crediti." }
      ]);
      setInput("");
      return;
    }

    const token = await getAuthToken().catch(() => null);
    if (!token) {
      setMessages((prev) => [...prev,
        { role: "user", content: userInput },
        { role: "assistant", content: "⚠️ Devi effettuare il login per usare il Tutor AI." }
      ]);
      setInput("");
      return;
    }

    const spent = await spendCredits("tutor");
    if (!spent) {
      setMessages((prev) => [...prev,
        { role: "user", content: userInput },
        { role: "assistant", content: "⚡ **NeuroCredits esauriti!** Passa a un piano superiore per continuare." }
      ]);
      setInput("");
      return;
    }

    const userMsg: Message = { role: "user", content: userInput };
    const allMessages = [...messages, userMsg];
    setMessages(allMessages);
    setInput("");
    setIsLoading(true);

    let assistantSoFar = "";
    let shouldRefund = true;
    const appendAssistant = (content: string) => {
      setMessages((prev) => [...prev, { role: "assistant", content }]);
    };
    try {
      // FIX: docContext è inviato SOLO come parametro documentContext a streamTutorChat,
      // che lo mette nel system prompt dell'Edge Function.
      // NON aggiungerlo anche nel messages array — causerebbe doppio invio (2x token cost).
      const apiMessages = allMessages;

      const resp = await streamTutorChat(apiMessages, token, docContext);

      if (resp.status === 429) {
        setMessages((prev) => [...prev, { role: "assistant", content: "⚠️ Troppe richieste. Riprova tra qualche secondo." }]);
        setIsLoading(false);
        return;
      }
      if (resp.status === 402) {
        setMessages((prev) => [...prev, { role: "assistant", content: "⚠️ Crediti AI esauriti. Contatta il supporto." }]);
        setIsLoading(false);
        return;
      }
      if (!resp.ok || !resp.body) throw new Error("Stream failed");
      await consumeOpenAiSseStream(resp, (content) => {
        assistantSoFar += content;
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last?.role === "assistant") {
            return prev.map((m, i) => i === prev.length - 1 ? { ...m, content: assistantSoFar } : m);
          }
          return [...prev, { role: "assistant", content: assistantSoFar }];
        });
      });
      if (assistantSoFar.trim().length > 0) {
        shouldRefund = false;
      }
    } catch (err) {
      console.error(err);
      setMessages((prev) => [...prev, { role: "assistant", content: "Mi dispiace, si è verificato un errore. Riprova." }]);
    } finally {
      if (shouldRefund) {
        await addCredits(CREDIT_COSTS.tutor, "tutor_refund", "Rimborso automatico messaggio tutor non riuscito");
      }
      setIsLoading(false);
    }
  };

  return (
    <div className="bg-card rounded-xl border border-border shadow-card flex flex-col h-[500px]">
      <div className="flex items-center gap-2 p-4 border-b border-border">
        <MessageCircle className="h-5 w-5 text-primary" />
        <h2 className="text-lg font-semibold text-card-foreground">Tutor AI</h2>
        <span className="text-xs text-muted-foreground ml-auto flex items-center gap-1">
          <Zap className="h-3 w-3" /> {CREDIT_COSTS.tutor} cr/msg
        </span>
      </div>

      {/* Document context banner (Hyperfocus only) */}
      {isHyperfocus && docContext && (
        <div className="flex items-center gap-2 px-4 py-2 bg-primary/5 border-b border-primary/10 text-xs">
          <FileText className="h-3.5 w-3.5 text-primary shrink-0" />
          <span className="text-card-foreground truncate flex-1">📄 {docName}</span>
          <button onClick={removeDoc} className="text-muted-foreground hover:text-destructive">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && (
          <div className="text-center py-12">
            <Bot className="h-10 w-10 text-primary/40 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">
              Ciao! Sono il tuo tutor AI. Chiedimi qualsiasi cosa sui tuoi studi. 📚
            </p>
            {isHyperfocus && (
              <p className="text-xs text-primary mt-2">
                📄 Carica un documento per fare domande specifiche sul contenuto!
              </p>
            )}
            <div className="flex flex-wrap gap-2 justify-center mt-4">
              {["Spiegami la fotosintesi", "Aiutami con la matematica", "Quiz di storia"].map((s) => (
                <button
                  key={s}
                  onClick={() => setInput(s)}
                  className="text-xs bg-secondary text-secondary-foreground px-3 py-1.5 rounded-full hover:bg-primary hover:text-primary-foreground transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        <AnimatePresence initial={false}>
          {messages.map((msg, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className={`flex gap-2 ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              {msg.role === "assistant" && (
                <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                  <Bot className="h-4 w-4 text-primary" />
                </div>
              )}
              <div
                className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                  msg.role === "user"
                    ? "bg-primary text-primary-foreground rounded-br-md whitespace-pre-wrap"
                    : "bg-secondary text-secondary-foreground rounded-bl-md"
                }`}
              >
                {msg.role === "assistant" ? (
                  <div className="prose prose-sm dark:prose-invert max-w-none [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&_ul]:my-1 [&_ol]:my-1 [&_li]:my-0.5 [&_p]:my-1 [&_h1]:text-base [&_h2]:text-sm [&_h3]:text-sm [&_code]:bg-background/50 [&_code]:px-1 [&_code]:rounded">
                    <ReactMarkdown components={SAFE_MARKDOWN_COMPONENTS}>{msg.content}</ReactMarkdown>
                  </div>
                ) : (
                  msg.content
                )}
              </div>
              {msg.role === "user" && (
                <div className="h-7 w-7 rounded-full bg-accent/10 flex items-center justify-center shrink-0 mt-0.5">
                  <User className="h-4 w-4 text-accent" />
                </div>
              )}
            </motion.div>
          ))}
        </AnimatePresence>

        {isLoading && messages[messages.length - 1]?.role !== "assistant" && (
          <div className="flex gap-2 items-center">
            <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center">
              <Bot className="h-4 w-4 text-primary" />
            </div>
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        )}
      </div>

      {/* Input */}
      <form onSubmit={sendMessage} className="p-4 border-t border-border flex gap-2">
        {isHyperfocus && (
          <>
            <input ref={fileRef} type="file" accept=".txt,.md,.pdf,.doc,.docx" onChange={handleDocUpload} className="hidden" />
            <Button
              type="button"
              size="icon"
              variant="ghost"
              onClick={() => fileRef.current?.click()}
              disabled={isLoading || extracting}
              title="Carica documento"
            >
              {extracting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            </Button>
          </>
        )}
        <Input
          placeholder={docContext ? "Chiedi qualcosa sul documento..." : "Chiedi al tutor..."}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={isLoading}
          className="flex-1"
        />
        <Button type="submit" size="icon" disabled={isLoading || !input.trim()}>
          <Send className="h-4 w-4" />
        </Button>
      </form>
    </div>
  );
};

export default AiTutor;
