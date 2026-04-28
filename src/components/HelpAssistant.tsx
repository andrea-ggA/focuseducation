import { useState, useRef, useEffect } from "react";
import { MessageCircle, X, Send, Loader2, Bot, Ticket, Bug, HelpCircle, CreditCard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { motion, AnimatePresence } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { consumeOpenAiSseStream } from "@/lib/sse";

interface Message {
  role: "user" | "assistant";
  content: string;
}

const supabasePublicKey =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
  import.meta.env.VITE_SUPABASE_ANON_KEY;

const HELP_SYSTEM_PROMPT = `Sei l'assistente di supporto tecnico di FocusED. Il tuo UNICO scopo è aiutare gli utenti con problemi tecnici, domande sul servizio e richieste di assistenza.

REGOLE FONDAMENTALI:
1. Rispondi SOLO a domande relative a: problemi tecnici, bug, errori, problemi di accesso, gestione account, piani e abbonamenti, pagamenti, funzionamento della piattaforma.
2. NON rispondere MAI a domande di studio, didattiche, accademiche o culturali. Per quelle esiste il Tutor AI nella sezione Studio.
3. Se un utente fa una domanda di studio, rispondi: "Mi occupo solo di assistenza tecnica! Per domande di studio, usa il Tutor AI nella sezione Studio della dashboard. 📚"
4. Rispondi SEMPRE in italiano, in modo breve, professionale e risolutivo.
5. Se non riesci a risolvere il problema, suggerisci di aprire un ticket di supporto dalla sezione Profilo > Supporto.

Cosa puoi aiutare:
- Problemi di login/registrazione
- Bug o errori della piattaforma
- Domande su piani, crediti e abbonamenti
- Problemi con caricamento documenti
- Problemi con quiz, flashcard o mind map
- Gestione account e impostazioni
- Problemi di pagamento con PayPal
- Domande su come usare le funzionalità della piattaforma`;

const QUICK_ACTIONS = [
  { icon: Bug, label: "Segnala un bug", message: "Ho trovato un bug nella piattaforma" },
  { icon: CreditCard, label: "Problemi pagamento", message: "Ho un problema con il pagamento o l'abbonamento" },
  { icon: HelpCircle, label: "Come funziona?", message: "Come funziona la piattaforma FocusED?" },
  { icon: Ticket, label: "Apri ticket", action: "openTicket" as const },
];

const HelpAssistant = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    { role: "assistant", content: "Ciao! 👋 Sono l'assistente di supporto FocusED. Posso aiutarti con problemi tecnici, account, pagamenti o funzionalità della piattaforma.\n\nScegli un'opzione rapida qui sotto oppure scrivi il tuo problema!" },
  ]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [showQuickActions, setShowQuickActions] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleQuickAction = (action: typeof QUICK_ACTIONS[number]) => {
    if ("action" in action && action.action === "openTicket") {
      setIsOpen(false);
      navigate("/profile?tab=support");
      return;
    }
    if ("message" in action && action.message) {
      setShowQuickActions(false);
      setInput(action.message);
      setTimeout(() => sendMessage(undefined, action.message), 100);
    }
  };

  const sendMessage = async (e?: React.FormEvent, overrideInput?: string) => {
    e?.preventDefault();
    const text = overrideInput || input.trim();
    if (!text || isLoading) return;

    const userMsg: Message = { role: "user", content: text };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput("");
    setShowQuickActions(false);
    setIsLoading(true);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("Sessione non valida");
      const resp = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-tutor`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
            apikey: supabasePublicKey,
          },
          body: JSON.stringify({
            messages: [
              { role: "system", content: HELP_SYSTEM_PROMPT },
              ...newMessages.map((m) => ({ role: m.role, content: m.content })),
            ],
            isHelpAssistant: true,
          }),
        }
      );

      if (!resp.ok || !resp.body) throw new Error("Failed");
      let fullText = "";
      await consumeOpenAiSseStream(resp, (content) => {
        fullText += content;
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last?.role === "assistant" && prev.length > newMessages.length) {
            return prev.map((m, i) => i === prev.length - 1 ? { ...m, content: fullText } : m);
          }
          return [...prev, { role: "assistant", content: fullText }];
        });
      });
    } catch {
      setMessages((prev) => [...prev, { role: "assistant", content: "Mi dispiace, c'è stato un errore. Riprova tra poco oppure apri un ticket dalla sezione Profilo > Supporto!" }]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      <AnimatePresence>
        {!isOpen && (
          <motion.button
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            exit={{ scale: 0 }}
            onClick={() => setIsOpen(true)}
            className="fixed bottom-6 right-6 z-50 h-14 w-14 rounded-full bg-primary text-primary-foreground shadow-lg hover:shadow-xl transition-shadow flex items-center justify-center"
          >
            <MessageCircle className="h-6 w-6" />
          </motion.button>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            className="fixed bottom-6 right-6 z-50 w-[360px] max-w-[calc(100vw-2rem)] h-[500px] max-h-[calc(100vh-6rem)] bg-card border border-border rounded-2xl shadow-xl flex flex-col overflow-hidden"
          >
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-border bg-primary/5">
              <div className="flex items-center gap-2">
                <Bot className="h-5 w-5 text-primary" />
                <div>
                  <span className="font-semibold text-sm text-card-foreground">Supporto FocusED</span>
                  <p className="text-[10px] text-muted-foreground">Assistenza tecnica e account</p>
                </div>
              </div>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setIsOpen(false)}>
                <X className="h-4 w-4" />
              </Button>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {messages.map((m, i) => (
                <div key={i} className={`flex gap-2 ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                  {m.role === "assistant" && (
                    <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                      <Bot className="h-3.5 w-3.5 text-primary" />
                    </div>
                  )}
                  <div
                    className={`max-w-[80%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-line ${
                      m.role === "user"
                        ? "bg-primary text-primary-foreground rounded-br-md"
                        : "bg-secondary text-secondary-foreground rounded-bl-md"
                    }`}
                  >
                    {m.content}
                  </div>
                </div>
              ))}

              {/* Quick Actions */}
              {showQuickActions && !isLoading && (
                <div className="grid grid-cols-2 gap-2 pt-1">
                  {QUICK_ACTIONS.map((action) => (
                    <button
                      key={action.label}
                      onClick={() => handleQuickAction(action)}
                      className="flex items-center gap-2 p-2.5 rounded-xl border border-border bg-background hover:bg-accent/50 transition-colors text-left"
                    >
                      <action.icon className="h-4 w-4 text-primary shrink-0" />
                      <span className="text-xs font-medium text-foreground">{action.label}</span>
                    </button>
                  ))}
                </div>
              )}

              {isLoading && messages[messages.length - 1]?.role === "user" && (
                <div className="flex gap-2">
                  <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                    <Bot className="h-3.5 w-3.5 text-primary" />
                  </div>
                  <div className="bg-secondary rounded-2xl rounded-bl-md px-4 py-3">
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <form onSubmit={sendMessage} className="p-3 border-t border-border flex gap-2">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Descrivi il tuo problema..."
                className="flex-1 bg-secondary rounded-xl px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                disabled={isLoading}
              />
              <Button type="submit" size="icon" disabled={isLoading || !input.trim()} className="h-10 w-10 rounded-xl shrink-0">
                <Send className="h-4 w-4" />
              </Button>
            </form>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
};

export default HelpAssistant;
