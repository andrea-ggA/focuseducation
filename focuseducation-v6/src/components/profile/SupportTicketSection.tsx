import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { LifeBuoy, Send, MessageSquare, Clock, Loader2, ArrowLeft, Bot, User, Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

interface Ticket {
  id: string;
  subject: string;
  message: string;
  status: string;
  priority: string;
  ai_response: string | null;
  created_at: string;
}

interface TicketMessage {
  id: string;
  ticket_id: string;
  user_id: string;
  sender_type: string;
  message: string;
  created_at: string;
}

const SupportTicketSection = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [priority, setPriority] = useState("normal");
  const [showForm, setShowForm] = useState(false);

  const [activeTicket, setActiveTicket] = useState<Ticket | null>(null);
  const [ticketMessages, setTicketMessages] = useState<TicketMessage[]>([]);
  const [replyText, setReplyText] = useState("");
  const [sendingReply, setSendingReply] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!user) return;
    const load = async () => {
      const { data } = await supabase
        .from("support_tickets")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });
      setTickets((data as Ticket[]) || []);
      setLoading(false);
    };
    load();
  }, [user]);

  // Realtime subscription for new ticket messages
  useEffect(() => {
    if (!user) return;

    const channel = supabase
      .channel("ticket-messages-realtime")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "ticket_messages",
        },
        (payload) => {
          const newMsg = payload.new as TicketMessage;
          // Only show notification for support/ai messages (not own messages)
          if (newMsg.sender_type !== "user") {
            toast({
              title: "📩 Nuova risposta dal supporto",
              description: newMsg.message.slice(0, 100) + (newMsg.message.length > 100 ? "..." : ""),
            });

            // If viewing this ticket, add the message
            if (activeTicket && newMsg.ticket_id === activeTicket.id) {
              setTicketMessages(prev => {
                if (prev.some(m => m.id === newMsg.id)) return prev;
                return [...prev, newMsg];
              });
            }
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, activeTicket, toast]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [ticketMessages]);

  const openConversation = async (ticket: Ticket) => {
    setActiveTicket(ticket);
    setLoadingMessages(true);
    const { data } = await supabase
      .from("ticket_messages")
      .select("*")
      .eq("ticket_id", ticket.id)
      .order("created_at", { ascending: true });
    setTicketMessages((data as TicketMessage[]) || []);
    setLoadingMessages(false);
  };

  const sendReply = async () => {
    if (!user || !activeTicket || !replyText.trim()) return;
    setSendingReply(true);

    const { data, error } = await supabase.from("ticket_messages").insert({
      ticket_id: activeTicket.id,
      user_id: user.id,
      sender_type: "user",
      message: replyText.trim(),
    }).select().single();

    if (error) {
      toast({ title: "Errore", description: error.message, variant: "destructive" });
    } else if (data) {
      setTicketMessages(prev => [...prev, data as TicketMessage]);
      if (activeTicket.status === "closed") {
        await supabase.from("support_tickets").update({ status: "open" }).eq("id", activeTicket.id);
        setActiveTicket({ ...activeTicket, status: "open" });
        setTickets(prev => prev.map(t => t.id === activeTicket.id ? { ...t, status: "open" } : t));
      }
    }
    setReplyText("");
    setSendingReply(false);
  };

  const submitTicket = async () => {
    if (!user || !subject.trim() || !message.trim()) return;
    setSubmitting(true);

    const { data, error } = await supabase.from("support_tickets").insert({
      user_id: user.id,
      subject: subject.trim(),
      message: message.trim(),
      priority,
    }).select().single();

    if (error) {
      toast({ title: "Errore", description: error.message, variant: "destructive" });
      setSubmitting(false);
      return;
    }

    const ticket = data as Ticket;

    await supabase.from("ticket_messages").insert({
      ticket_id: ticket.id,
      user_id: user.id,
      sender_type: "user",
      message: message.trim(),
    });

    setTickets(prev => [ticket, ...prev]);
    setSubject("");
    setMessage("");
    setShowForm(false);
    setSubmitting(false);
    toast({ title: "Ticket inviato! 📩", description: "Il nostro team ti risponderà al più presto." });
  };

  const statusBadge = (status: string) => {
    if (status === "open") return <Badge variant="default" className="text-[10px]">Aperto</Badge>;
    if (status === "in_progress") return <Badge variant="secondary" className="text-[10px]">In lavorazione</Badge>;
    return <Badge variant="outline" className="text-[10px]">Chiuso</Badge>;
  };

  const senderIcon = (type: string) => {
    if (type === "user") return <User className="h-3.5 w-3.5" />;
    if (type === "ai") return <Bot className="h-3.5 w-3.5" />;
    return <LifeBuoy className="h-3.5 w-3.5" />;
  };

  const senderLabel = (type: string) => {
    if (type === "user") return "Tu";
    if (type === "ai") return "AI";
    return "Supporto";
  };

  if (loading) return null;

  if (activeTicket) {
    return (
      <div className="space-y-6">
        <div className="bg-card rounded-xl border border-border shadow-card p-6">
          <div className="flex items-center gap-2 mb-4">
            <Button variant="ghost" size="sm" onClick={() => setActiveTicket(null)}>
              <ArrowLeft className="h-4 w-4 mr-1" /> Indietro
            </Button>
            <h3 className="text-base font-semibold text-card-foreground flex-1 truncate">{activeTicket.subject}</h3>
            {statusBadge(activeTicket.status)}
          </div>

          <div ref={scrollRef} className="space-y-3 max-h-96 overflow-y-auto mb-4">
            <div className="bg-secondary/50 rounded-lg p-3">
              <div className="flex items-center gap-1.5 mb-1">
                <User className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-xs font-medium text-muted-foreground">Tu</span>
                <span className="text-[10px] text-muted-foreground ml-auto">
                  {new Date(activeTicket.created_at).toLocaleDateString("it-IT", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>
              <p className="text-sm text-card-foreground">{activeTicket.message}</p>
            </div>

            {activeTicket.ai_response && ticketMessages.length === 0 && (
              <div className="bg-primary/5 border border-primary/10 rounded-lg p-3">
                <div className="flex items-center gap-1.5 mb-1">
                  <Bot className="h-3.5 w-3.5 text-primary" />
                  <span className="text-xs font-medium text-primary">AI</span>
                </div>
                <p className="text-sm text-card-foreground whitespace-pre-wrap">{activeTicket.ai_response}</p>
              </div>
            )}

            {loadingMessages && (
              <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>
            )}

            {ticketMessages.map(msg => (
              <div key={msg.id} className={`rounded-lg p-3 ${
                msg.sender_type === "user" ? "bg-secondary/50" : "bg-primary/5 border border-primary/10"
              }`}>
                <div className="flex items-center gap-1.5 mb-1">
                  {senderIcon(msg.sender_type)}
                  <span className={`text-xs font-medium ${msg.sender_type === "user" ? "text-muted-foreground" : "text-primary"}`}>
                    {senderLabel(msg.sender_type)}
                  </span>
                  <span className="text-[10px] text-muted-foreground ml-auto">
                    {new Date(msg.created_at).toLocaleDateString("it-IT", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>
                <p className="text-sm text-card-foreground whitespace-pre-wrap">{msg.message}</p>
              </div>
            ))}
          </div>

          {activeTicket.status !== "closed" && (
            <div className="flex gap-2">
              <Input
                placeholder="Scrivi un messaggio..."
                value={replyText}
                onChange={e => setReplyText(e.target.value)}
                onKeyDown={e => e.key === "Enter" && !e.shiftKey && sendReply()}
                disabled={sendingReply}
                className="flex-1"
              />
              <Button size="icon" onClick={sendReply} disabled={sendingReply || !replyText.trim()}>
                {sendingReply ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </Button>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="bg-card rounded-xl border border-border shadow-card p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold text-card-foreground flex items-center gap-2">
            <LifeBuoy className="h-4 w-4 text-primary" /> Assistenza
          </h3>
          <Button size="sm" onClick={() => setShowForm(!showForm)}>
            {showForm ? "Annulla" : <><Send className="h-3.5 w-3.5 mr-1.5" /> Nuovo ticket</>}
          </Button>
        </div>

        {showForm && (
          <div className="space-y-3 mb-6 p-4 bg-secondary/30 rounded-xl border border-border">
            <div>
              <Label className="text-xs text-muted-foreground">Oggetto</Label>
              <Input value={subject} onChange={e => setSubject(e.target.value)} placeholder="Descrivi il problema in breve..." className="mt-1" />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Messaggio</Label>
              <Textarea value={message} onChange={e => setMessage(e.target.value)}
                placeholder="Descrivi il problema nel dettaglio..." className="mt-1" rows={4} />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Priorità</Label>
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger className="mt-1 w-40 h-8"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Bassa</SelectItem>
                  <SelectItem value="normal">Normale</SelectItem>
                  <SelectItem value="high">Alta</SelectItem>
                  <SelectItem value="urgent">Urgente</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button onClick={submitTicket} disabled={submitting || !subject.trim() || !message.trim()} className="w-full">
              {submitting ? "Invio..." : <><Send className="h-4 w-4 mr-2" /> Invia ticket</>}
            </Button>
          </div>
        )}

        {tickets.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">
            Nessun ticket di assistenza. Hai bisogno di aiuto? Apri un nuovo ticket!
          </p>
        ) : (
          <div className="space-y-3">
            {tickets.map(ticket => (
              <button
                key={ticket.id}
                onClick={() => openConversation(ticket)}
                className="w-full text-left rounded-xl border border-border p-4 space-y-2 hover:border-primary/30 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-semibold text-card-foreground">{ticket.subject}</h4>
                  {statusBadge(ticket.status)}
                </div>
                <p className="text-xs text-muted-foreground line-clamp-2">{ticket.message}</p>
                <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                  <Clock className="h-3 w-3" />
                  {new Date(ticket.created_at).toLocaleDateString("it-IT", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                  <MessageSquare className="h-3 w-3 ml-2" />
                  <span>Apri conversazione</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default SupportTicketSection;
