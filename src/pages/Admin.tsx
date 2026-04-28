import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useUserRole } from "@/hooks/useUserRole";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  Users, CreditCard, Timer, Loader2, Shield, Sparkles, Zap, MessageSquare, Plus,
  Search, TrendingUp, Activity, RefreshCw, Trash2, Mail, Calendar, AlertCircle,
} from "lucide-react";

import { useToast } from "@/hooks/use-toast";
import AppHeader from "@/components/AppHeader";

interface UserRow {
  user_id: string;
  full_name: string | null;
  study_level: string | null;
  streak_count: number;
  onboarding_completed: boolean;
  created_at: string;
}

interface SubscriptionRow {
  id: string;
  user_id: string;
  plan_name: string;
  status: string;
  current_period_start: string | null;
  current_period_end: string | null;
}

interface RoleRow { id: string; user_id: string; role: string; }
interface CreditRow { id: string; user_id: string; balance: number; rollover_balance: number; }
interface TicketRow {
  id: string;
  user_id: string;
  subject: string;
  message: string;
  status: string;
  priority: string;
  ai_response: string | null;
  created_at: string;
}

interface GenerationJob {
  id: string; user_id: string; content_type: string; status: string;
  total_items: number | null; progress_message: string | null;
  error: string | null; created_at: string; completed_at: string | null;
}

interface Stats {
  totalUsers: number;
  activeSubscriptions: number;
  totalQuizzes: number;
  totalFocusMinutes: number;
  openTickets: number;
}

const PLAN_OPTIONS = ["Free", "Focus Pro", "Hyperfocus Master"];
const STATUS_OPTIONS = ["active", "cancelled", "expired", "pending"];
const ROLE_OPTIONS = ["user", "moderator", "admin"];
const TICKET_STATUS = ["open", "in_progress", "closed"];

const getErrorMessage = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback;

const Admin = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const { isAdmin } = useUserRole(); // guard handled by AdminRoute, isAdmin always true here
  const [users, setUsers] = useState<UserRow[]>([]);
  const [subscriptions, setSubscriptions] = useState<SubscriptionRow[]>([]);
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [credits, setCredits] = useState<CreditRow[]>([]);
  const [tickets, setTickets] = useState<TicketRow[]>([]);
  const [genJobs, setGenJobs] = useState<GenerationJob[]>([]);
  const [deletingUser, setDeletingUser] = useState<string | null>(null);
  const [stats, setStats] = useState<Stats>({ totalUsers: 0, activeSubscriptions: 0, totalQuizzes: 0, totalFocusMinutes: 0, openTickets: 0 });
  const [userSearch, setUserSearch] = useState("");
  const [extendedStats, setExtendedStats] = useState({
    newUsersThisWeek: 0,
    totalFlashcards: 0,
    totalDocuments: 0,
    avgCreditsPerUser: 0,
    conversionRate: 0,
  });
  const [loading, setLoading] = useState(true);

  // Credit dialog
  const [creditDialog, setCreditDialog] = useState<{ open: boolean; userId: string; name: string }>({ open: false, userId: "", name: "" });
  const [creditAmount, setCreditAmount] = useState("50");

  // Ticket response dialog
  const [ticketDialog, setTicketDialog] = useState<{ open: boolean; ticket: TicketRow | null }>({ open: false, ticket: null });
  const [ticketResponse, setTicketResponse] = useState("");

  useEffect(() => {
    if (isAdmin) fetchAll();
  }, [isAdmin]);

  const fetchAll = async () => {
    const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const [profilesRes, subsRes, rolesRes, quizzesRes, focusRes, creditsRes, ticketsRes,
           flashcardsRes, docsRes, newUsersRes] = await Promise.all([
      supabase.from("profiles").select("user_id, full_name, study_level, streak_count, onboarding_completed, created_at").order("created_at", { ascending: false }),
      supabase.from("subscriptions").select("id, user_id, plan_name, status, current_period_start, current_period_end").order("created_at", { ascending: false }),
      supabase.from("user_roles").select("id, user_id, role"),
      supabase.from("quizzes").select("id", { count: "exact", head: true }),
      supabase.from("focus_sessions").select("duration_minutes").eq("completed", true),
      supabase.from("user_credits").select("id, user_id, balance, rollover_balance"),
      supabase.from("support_tickets").select("*").order("created_at", { ascending: false }),
      supabase.from("flashcards").select("id", { count: "exact", head: true }),
      supabase.from("documents").select("id", { count: "exact", head: true }),
      supabase.from("profiles").select("id", { count: "exact", head: true }).gte("created_at", weekAgo),
    ]);

    const allUsers = profilesRes.data || [];
    const allSubs  = subsRes.data || [];
    const allCreds = creditsRes.data || [];
    setUsers(allUsers);
    setSubscriptions(allSubs);
    setRoles(rolesRes.data || []);
    setCredits(allCreds);
    setTickets((ticketsRes.data || []) as TicketRow[]);

    const totalMinutes = (focusRes.data || []).reduce((s, r) => s + (r.duration_minutes || 0), 0);
    const openTickets  = ((ticketsRes.data || []) as TicketRow[]).filter(t => t.status !== "closed").length;
    const activeSubs   = allSubs.filter(s => ["active","trialing","ACTIVE","TRIALING"].includes(s.status)).length;
    const totalCreds   = allCreds.reduce((s, c) => s + (c.balance || 0), 0);

    setGenJobs([] as GenerationJob[]);
    setStats({
      totalUsers: allUsers.length,
      activeSubscriptions: activeSubs,
      totalQuizzes: quizzesRes.count || 0,
      totalFocusMinutes: totalMinutes,
      openTickets,
    });
    setExtendedStats({
      newUsersThisWeek: newUsersRes.count || 0,
      totalFlashcards:  flashcardsRes.count || 0,
      totalDocuments:   docsRes.count || 0,
      avgCreditsPerUser: allCreds.length > 0 ? Math.round(totalCreds / allCreds.length) : 0,
      conversionRate:   allUsers.length > 0 ? Math.round((activeSubs / allUsers.length) * 100) : 0,
    });
    setLoading(false);
  };

  const updateSubscriptionPlan = async (subId: string, newPlan: string) => {
    const sub = subscriptions.find(s => s.id === subId);
    const { error } = await supabase.from("subscriptions").update({ plan_name: newPlan }).eq("id", subId);
    if (error) {
      toast({ title: "Errore", description: error.message, variant: "destructive" });
      return;
    }
    setSubscriptions((prev) => prev.map((s) => s.id === subId ? { ...s, plan_name: newPlan } : s));

    // Auto-assign NeuroCredits based on plan
    if (sub) {
      const creditMap: Record<string, number> = { "Focus Pro": 250, "Hyperfocus Master": 700, "Free": 15 };
      const newCredits = creditMap[newPlan] || 0;
      if (newCredits > 0) {
        const existing = credits.find(c => c.user_id === sub.user_id);
        if (existing) {
          const { error: credErr } = await supabase.from("user_credits").update({ balance: newCredits }).eq("id", existing.id);
          if (!credErr) setCredits(prev => prev.map(c => c.id === existing.id ? { ...c, balance: newCredits } : c));
        } else {
          const { data, error: credErr } = await supabase.from("user_credits").insert({ user_id: sub.user_id, balance: newCredits }).select().single();
          if (!credErr && data) setCredits(prev => [...prev, data as CreditRow]);
        }
        await supabase.from("credit_transactions").insert({
          user_id: sub.user_id, action: "plan_change", amount: newCredits,
          description: `Crediti assegnati per piano ${newPlan}`,
        });
      }
    }
    toast({ title: "Piano aggiornato", description: `Crediti accreditati automaticamente.` });
  };

  const updateSubscriptionStatus = async (subId: string, newStatus: string) => {
    const { error } = await supabase.from("subscriptions").update({ status: newStatus }).eq("id", subId);
    if (error) {
      toast({ title: "Errore", description: error.message, variant: "destructive" });
    } else {
      setSubscriptions((prev) => prev.map((s) => s.id === subId ? { ...s, status: newStatus } : s));
      toast({ title: "Stato aggiornato" });
    }
  };

  const setUserRole = async (userId: string, newRole: string) => {
    const existingRole = roles.find((r) => r.user_id === userId);
    const typedRole = newRole as "admin" | "moderator" | "user";
    if (existingRole) {
      const { error } = await supabase.from("user_roles").update({ role: typedRole }).eq("id", existingRole.id);
      if (error) { toast({ title: "Errore", description: error.message, variant: "destructive" }); }
      else { setRoles((prev) => prev.map((r) => r.id === existingRole.id ? { ...r, role: newRole } : r)); toast({ title: "Ruolo aggiornato" }); }
    } else {
      const { data, error } = await supabase.from("user_roles").insert({ user_id: userId, role: typedRole }).select().single();
      if (error) { toast({ title: "Errore", description: error.message, variant: "destructive" }); }
      else if (data) { setRoles((prev) => [...prev, data]); toast({ title: "Ruolo assegnato" }); }
    }
  };

  const createSubscription = async (userId: string, plan: string) => {
    const { data, error } = await supabase.from("subscriptions").insert({
      user_id: userId, plan_name: plan, status: "active",
      current_period_start: new Date().toISOString(),
      current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    }).select().single();
    if (error) { toast({ title: "Errore", description: error.message, variant: "destructive" }); return; }
    if (data) { setSubscriptions((prev) => [data, ...prev]); }

    // Assegna crediti in base al piano
    const creditMap: Record<string, number> = { "Focus Pro": 250, "Hyperfocus Master": 700, "Free": 15 };
    const newCredits = creditMap[plan] || 0;
    if (newCredits > 0) {
      const existing = credits.find(c => c.user_id === userId);
      if (existing) {
        await supabase.from("user_credits").update({ balance: newCredits }).eq("id", existing.id);
        setCredits(prev => prev.map(c => c.id === existing.id ? { ...c, balance: newCredits } : c));
      } else {
        const { data: cd } = await supabase.from("user_credits").insert({ user_id: userId, balance: newCredits }).select().single();
        if (cd) setCredits(prev => [...prev, cd as CreditRow]);
      }
      await supabase.from("credit_transactions").insert({
        user_id: userId, action: "plan_activation", amount: newCredits,
        description: `Crediti assegnati per attivazione piano ${plan}`,
      });
    }
    toast({ title: "Abbonamento creato", description: `${newCredits} NeuroCredits assegnati.` });
  };

  const addCreditsToUser = async () => {
    const amount = parseInt(creditAmount);
    if (!amount || amount <= 0) return;
    const userId = creditDialog.userId;

    const existing = credits.find(c => c.user_id === userId);
    if (existing) {
      const { error } = await supabase.from("user_credits").update({ balance: existing.balance + amount }).eq("id", existing.id);
      if (error) { toast({ title: "Errore", description: error.message, variant: "destructive" }); return; }
      setCredits(prev => prev.map(c => c.id === existing.id ? { ...c, balance: c.balance + amount } : c));
    } else {
      const { data, error } = await supabase.from("user_credits").insert({ user_id: userId, balance: amount }).select().single();
      if (error) { toast({ title: "Errore", description: error.message, variant: "destructive" }); return; }
      if (data) setCredits(prev => [...prev, data as CreditRow]);
    }

    await supabase.from("credit_transactions").insert({
      user_id: userId, action: "admin_add", amount,
      description: `Admin ha aggiunto ${amount} crediti`,
    });

    toast({ title: `${amount} NeuroCredits aggiunti a ${creditDialog.name || "utente"}` });
    setCreditDialog({ open: false, userId: "", name: "" });
    setCreditAmount("50");
  };

  const deleteUserData = async (userId: string) => {
    if (!window.confirm("⚠️ Eliminare tutti i dati di questo utente? Non reversibile.")) return;
    setDeletingUser(userId);
    try {
      // Delete in order respecting FK constraints
      await supabase.from("user_question_progress").delete().eq("user_id", userId);
      await supabase.from("flashcard_reviews").delete().eq("user_id", userId);
      await supabase.from("quiz_attempts").delete().eq("user_id", userId);
      // Delete flashcards inside decks
      const { data: decks } = await supabase.from("flashcard_decks").select("id").eq("user_id", userId);
      for (const deck of decks || []) await supabase.from("flashcards").delete().eq("deck_id", deck.id);
      await supabase.from("flashcard_decks").delete().eq("user_id", userId);
      // Delete quiz questions inside quizzes
      const { data: quizzes } = await supabase.from("quizzes").select("id").eq("user_id", userId);
      for (const quiz of quizzes || []) await supabase.from("quiz_questions").delete().eq("quiz_id", quiz.id);
      await supabase.from("quizzes").delete().eq("user_id", userId);
      await supabase.from("generated_content").delete().eq("user_id", userId);
      await supabase.from("generation_jobs").delete().eq("user_id", userId);
      await supabase.from("tasks").delete().eq("user_id", userId);
      await supabase.from("focus_sessions").delete().eq("user_id", userId);
      await supabase.from("support_tickets").delete().eq("user_id", userId);
      await supabase.from("subscriptions").delete().eq("user_id", userId);
      await supabase.from("user_credits").delete().eq("user_id", userId);
      await supabase.from("credit_transactions").delete().eq("user_id", userId);
      await supabase.from("user_roles").delete().eq("user_id", userId);
      await supabase.from("profiles").delete().eq("user_id", userId);
      setUsers(prev => prev.filter(u => u.user_id !== userId));
      toast({ title: "Dati utente eliminati" });
    } catch (e: unknown) {
      toast({
        title: "Errore",
        description: getErrorMessage(e, "Eliminazione dati utente non riuscita."),
        variant: "destructive",
      });
    } finally {
      setDeletingUser(null);
    }
  };

  const respondToTicket = async () => {
    if (!ticketDialog.ticket || !ticketResponse.trim() || !user) return;
    // Insert into ticket_messages instead of updating ai_response
    const { error: msgError } = await supabase.from("ticket_messages").insert({
      ticket_id: ticketDialog.ticket.id,
      user_id: user.id,
      sender_type: "support",
      message: ticketResponse.trim(),
    });
    if (msgError) { toast({ title: "Errore", description: msgError.message, variant: "destructive" }); return; }

    // Also update status to in_progress
    await supabase.from("support_tickets").update({ status: "in_progress" }).eq("id", ticketDialog.ticket.id);
    setTickets(prev => prev.map(t => t.id === ticketDialog.ticket!.id ? { ...t, status: "in_progress" } : t));
    toast({ title: "Risposta inviata" });
    setTicketDialog({ open: false, ticket: null });
    setTicketResponse("");
  };

  const updateTicketStatus = async (ticketId: string, newStatus: string) => {
    const { error } = await supabase.from("support_tickets").update({ status: newStatus }).eq("id", ticketId);
    if (error) { toast({ title: "Errore", description: error.message, variant: "destructive" }); return; }
    setTickets(prev => prev.map(t => t.id === ticketId ? { ...t, status: newStatus } : t));
    toast({ title: "Stato ticket aggiornato" });
  };

  // Role guard is now handled by AdminRoute wrapper in App.tsx

  const getSubForUser = (userId: string) => subscriptions.find((s) => s.user_id === userId && s.status === "active");
  const getRoleForUser = (userId: string) => roles.find((r) => r.user_id === userId);
  const getCreditsForUser = (userId: string) => credits.find((c) => c.user_id === userId);
  const getUserName = (userId: string) => users.find(u => u.user_id === userId)?.full_name || userId.slice(0, 8);

  const filteredUsers = users.filter(u =>
    !userSearch || (u.full_name || "").toLowerCase().includes(userSearch.toLowerCase())
  );

  const statCards = [
    { icon: Users,        label: "Utenti totali",       value: stats.totalUsers,                          color: "text-primary" },
    { icon: TrendingUp,   label: "Nuovi (7gg)",          value: extendedStats.newUsersThisWeek,            color: "text-green-500" },
    { icon: CreditCard,   label: "Abbonamenti attivi",   value: stats.activeSubscriptions,                 color: "text-accent" },
    { icon: Activity,     label: "Conversione",          value: `${extendedStats.conversionRate}%`,        color: "text-primary" },
    { icon: Sparkles,     label: "Quiz generati",        value: stats.totalQuizzes,                        color: "text-primary" },
    { icon: Timer,        label: "Ore focus totali",     value: Math.round(stats.totalFocusMinutes / 60),  color: "text-accent" },
    { icon: Zap,          label: "Crediti medi/utente",  value: extendedStats.avgCreditsPerUser,           color: "text-primary" },
    { icon: MessageSquare,label: "Ticket aperti",        value: stats.openTickets,                         color: "text-destructive" },
  ];

  const priorityColor = (p: string) => p === "urgent" ? "destructive" : p === "high" ? "destructive" : "secondary";
  const statusColor = (s: string) => s === "open" ? "destructive" : s === "in_progress" ? "default" : "secondary";

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <main className="container mx-auto px-4 py-8 max-w-6xl">
        <h1 className="text-2xl font-bold text-foreground mb-6 flex items-center gap-2">
          <Shield className="h-7 w-7 text-primary" /> Pannello Amministratore
        </h1>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          {statCards.map((s, i) => (
            <Card key={s.label}>
              <CardContent className="p-4">
                <s.icon className={`h-5 w-5 ${s.color} mb-2`} />
                <p className="text-2xl font-bold text-card-foreground">{s.value}</p>
                <p className="text-xs text-muted-foreground">{s.label}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        <Tabs defaultValue="users" className="space-y-6">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="users">👥 Utenti</TabsTrigger>
            <TabsTrigger value="subscriptions">💳 Abbonamenti</TabsTrigger>
            <TabsTrigger value="tickets" className="relative">
              🎫 Ticket
              {stats.openTickets > 0 && (
                <Badge variant="destructive" className="ml-2 text-[10px] h-5 min-w-5 px-1">{stats.openTickets}</Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="analytics">📊 Analytics</TabsTrigger>
            <TabsTrigger value="generations" className="relative">
              ⚙️ Generazioni
              {genJobs.filter(j => j.status === "error").length > 0 && (
                <Badge variant="destructive" className="ml-1 text-[10px] h-4 min-w-4 px-1">
                  {genJobs.filter(j => j.status === "error").length}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>

          {/* Users tab */}
          <TabsContent value="users">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2"><Users className="h-5 w-5 text-primary" /> Gestione utenti, ruoli e crediti</CardTitle>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Cerca per nome..."
                    value={userSearch}
                    onChange={e => setUserSearch(e.target.value)}
                    className="pl-9 h-9"
                  />
                </div>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Nome</TableHead>
                          <TableHead>Livello</TableHead>
                          <TableHead>Piano</TableHead>
                          <TableHead>Crediti</TableHead>
                          <TableHead>Ruolo</TableHead>
                          <TableHead>Azioni</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredUsers.map((u) => {
                          const sub = getSubForUser(u.user_id);
                          const role = getRoleForUser(u.user_id);
                          const userCredits = getCreditsForUser(u.user_id);
                          return (
                            <TableRow key={u.user_id}>
                              <TableCell className="font-medium">{u.full_name || "—"}</TableCell>
                              <TableCell className="hidden md:table-cell text-xs text-muted-foreground">
                                {new Date(u.created_at).toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "2-digit" })}
                              </TableCell>
                              <TableCell>
                                {sub ? <Badge variant="default">{sub.plan_name}</Badge> : <Badge variant="secondary">Free</Badge>}
                              </TableCell>
                              <TableCell>
                                <div className="flex items-center gap-2">
                                  <span className="text-sm font-medium flex items-center gap-1">
                                    <Zap className="h-3 w-3 text-primary" /> {userCredits?.balance ?? 0}
                                  </span>
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    className="h-6 w-6"
                                    onClick={() => setCreditDialog({ open: true, userId: u.user_id, name: u.full_name || "" })}
                                  >
                                    <Plus className="h-3 w-3" />
                                  </Button>
                                </div>
                              </TableCell>
                              <TableCell>
                                <Select value={role?.role || "user"} onValueChange={(val) => setUserRole(u.user_id, val)}>
                                  <SelectTrigger className="w-28 h-8"><SelectValue /></SelectTrigger>
                                  <SelectContent>
                                    {ROLE_OPTIONS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                                  </SelectContent>
                                </Select>
                              </TableCell>
                              <TableCell>
                                <div className="flex gap-1 flex-wrap">
                                {!sub && (
                                  <AlertDialog>
                                    <AlertDialogTrigger asChild>
                                      <Button size="sm" variant="outline">Assegna piano</Button>
                                    </AlertDialogTrigger>
                                    <AlertDialogContent>
                                      <AlertDialogHeader>
                                        <AlertDialogTitle>Assegna abbonamento a {u.full_name || "utente"}</AlertDialogTitle>
                                        <AlertDialogDescription>Seleziona il piano da assegnare manualmente.</AlertDialogDescription>
                                      </AlertDialogHeader>
                                      <div className="flex gap-2 py-4">
                                        {PLAN_OPTIONS.map((p) => (
                                          <Button key={p} variant="outline" onClick={() => createSubscription(u.user_id, p)}>{p}</Button>
                                        ))}
                                      </div>
                                      <AlertDialogFooter><AlertDialogCancel>Annulla</AlertDialogCancel></AlertDialogFooter>
                                    </AlertDialogContent>
                                  </AlertDialog>
                                )}
                                <Button
                                  size="sm" variant="ghost"
                                  className="h-7 text-destructive hover:text-destructive hover:bg-destructive/10 text-xs"
                                  disabled={deletingUser === u.user_id}
                                  onClick={() => deleteUserData(u.user_id)}
                                >
                                  {deletingUser === u.user_id ? "..." : "🗑"}
                                </Button>
                                </div>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Subscriptions tab */}
          <TabsContent value="subscriptions">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2"><CreditCard className="h-5 w-5 text-accent" /> Gestione abbonamenti</CardTitle>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Utente</TableHead>
                          <TableHead>Piano</TableHead>
                          <TableHead>Stato</TableHead>
                          <TableHead>Inizio</TableHead>
                          <TableHead>Scadenza</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {subscriptions.map((s) => (
                          <TableRow key={s.id}>
                            <TableCell className="font-medium">{getUserName(s.user_id)}</TableCell>
                            <TableCell>
                              <Select value={s.plan_name} onValueChange={(val) => updateSubscriptionPlan(s.id, val)}>
                                <SelectTrigger className="w-36 h-8"><SelectValue /></SelectTrigger>
                                <SelectContent>{PLAN_OPTIONS.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
                              </Select>
                            </TableCell>
                            <TableCell>
                              <Select value={s.status} onValueChange={(val) => updateSubscriptionStatus(s.id, val)}>
                                <SelectTrigger className="w-28 h-8"><SelectValue /></SelectTrigger>
                                <SelectContent>{STATUS_OPTIONS.map((st) => <SelectItem key={st} value={st}>{st}</SelectItem>)}</SelectContent>
                              </Select>
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground">
                              {s.current_period_start ? new Date(s.current_period_start).toLocaleDateString("it-IT") : "—"}
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground">
                              {s.current_period_end ? new Date(s.current_period_end).toLocaleDateString("it-IT") : "—"}
                            </TableCell>
                          </TableRow>
                        ))}
                        {subscriptions.length === 0 && (
                          <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">Nessun abbonamento presente.</TableCell></TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Tickets tab */}
          <TabsContent value="tickets">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2"><MessageSquare className="h-5 w-5 text-primary" /> Gestione ticket di supporto</CardTitle>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
                ) : tickets.length === 0 ? (
                  <p className="text-center text-muted-foreground py-8">Nessun ticket di supporto.</p>
                ) : (
                  <div className="space-y-4">
                    {tickets.map((t) => (
                      <div key={t.id} className="border border-border rounded-xl p-4 space-y-3">
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <h4 className="font-semibold text-card-foreground">{t.subject}</h4>
                              <Badge variant={statusColor(t.status)} className="text-[10px]">{t.status}</Badge>
                              <Badge variant={priorityColor(t.priority)} className="text-[10px]">{t.priority}</Badge>
                            </div>
                            <p className="text-xs text-muted-foreground mt-1">
                              {getUserName(t.user_id)} · {new Date(t.created_at).toLocaleDateString("it-IT", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                            </p>
                          </div>
                          <Select value={t.status} onValueChange={(val) => updateTicketStatus(t.id, val)}>
                            <SelectTrigger className="w-28 h-8"><SelectValue /></SelectTrigger>
                            <SelectContent>{TICKET_STATUS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                          </Select>
                        </div>
                        <p className="text-sm text-card-foreground bg-secondary/50 rounded-lg p-3">{t.message}</p>
                        {t.ai_response && (
                          <div className="bg-primary/5 border border-primary/20 rounded-lg p-3">
                            <p className="text-xs font-medium text-primary mb-1">Risposta admin:</p>
                            <p className="text-sm text-card-foreground">{t.ai_response}</p>
                          </div>
                        )}
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => { setTicketDialog({ open: true, ticket: t }); setTicketResponse(t.ai_response || ""); }}
                        >
                          <MessageSquare className="h-3 w-3 mr-1" /> {t.ai_response ? "Modifica risposta" : "Rispondi"}
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
          {/* Analytics tab */}
          <TabsContent value="analytics">
            <div className="grid md:grid-cols-2 gap-6">
              <Card>
                <CardHeader><CardTitle className="text-base flex items-center gap-2"><TrendingUp className="h-4 w-4 text-primary" /> Crescita utenti</CardTitle></CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    <div className="flex justify-between items-center p-3 bg-secondary/50 rounded-lg">
                      <span className="text-sm text-muted-foreground">Nuovi utenti (7gg)</span>
                      <span className="font-bold text-card-foreground">{extendedStats.newUsersThisWeek}</span>
                    </div>
                    <div className="flex justify-between items-center p-3 bg-secondary/50 rounded-lg">
                      <span className="text-sm text-muted-foreground">Totale utenti</span>
                      <span className="font-bold text-card-foreground">{stats.totalUsers}</span>
                    </div>
                    <div className="flex justify-between items-center p-3 bg-secondary/50 rounded-lg">
                      <span className="text-sm text-muted-foreground">Tasso conversione</span>
                      <span className="font-bold text-primary">{extendedStats.conversionRate}%</span>
                    </div>
                    <div className="flex justify-between items-center p-3 bg-secondary/50 rounded-lg">
                      <span className="text-sm text-muted-foreground">Abbonamenti attivi</span>
                      <span className="font-bold text-card-foreground">{stats.activeSubscriptions}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle className="text-base flex items-center gap-2"><Activity className="h-4 w-4 text-accent" /> Utilizzo piattaforma</CardTitle></CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    <div className="flex justify-between items-center p-3 bg-secondary/50 rounded-lg">
                      <span className="text-sm text-muted-foreground">Quiz totali generati</span>
                      <span className="font-bold text-card-foreground">{stats.totalQuizzes}</span>
                    </div>
                    <div className="flex justify-between items-center p-3 bg-secondary/50 rounded-lg">
                      <span className="text-sm text-muted-foreground">Flashcard totali</span>
                      <span className="font-bold text-card-foreground">{extendedStats.totalFlashcards}</span>
                    </div>
                    <div className="flex justify-between items-center p-3 bg-secondary/50 rounded-lg">
                      <span className="text-sm text-muted-foreground">Documenti caricati</span>
                      <span className="font-bold text-card-foreground">{extendedStats.totalDocuments}</span>
                    </div>
                    <div className="flex justify-between items-center p-3 bg-secondary/50 rounded-lg">
                      <span className="text-sm text-muted-foreground">Ore focus totali</span>
                      <span className="font-bold text-card-foreground">{Math.round(stats.totalFocusMinutes / 60)}h</span>
                    </div>
                    <div className="flex justify-between items-center p-3 bg-secondary/50 rounded-lg">
                      <span className="text-sm text-muted-foreground">Crediti medi per utente</span>
                      <span className="font-bold text-card-foreground">{extendedStats.avgCreditsPerUser} cr</span>
                    </div>
                    <div className="flex justify-between items-center p-3 bg-secondary/50 rounded-lg">
                      <span className="text-sm text-muted-foreground">Ticket aperti</span>
                      <span className={`font-bold ${stats.openTickets > 0 ? "text-destructive" : "text-green-500"}`}>{stats.openTickets}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
            <div className="mt-4 flex justify-end">
              <button onClick={fetchAll} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
                <RefreshCw className="h-3.5 w-3.5" /> Aggiorna dati
              </button>
            </div>
          </TabsContent>
          {/* Generations tab */}
          <TabsContent value="generations">
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2 justify-between">
                  <span className="flex items-center gap-2"><Activity className="h-4 w-4 text-primary" /> Generazioni recenti</span>
                  <Button size="sm" variant="ghost" onClick={fetchAll}><RefreshCw className="h-3.5 w-3.5 mr-1" />Aggiorna</Button>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Utente</TableHead>
                        <TableHead>Tipo</TableHead>
                        <TableHead>Stato</TableHead>
                        <TableHead>Elementi</TableHead>
                        <TableHead>Data</TableHead>
                        <TableHead>Errore / Progresso</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {genJobs.slice(0, 50).map(job => (
                        <TableRow key={job.id} className={job.status === "error" ? "bg-destructive/5" : ""}>
                          <TableCell className="text-xs font-mono">{getUserName(job.user_id)}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className="text-[10px]">{job.content_type}</Badge>
                          </TableCell>
                          <TableCell>
                            <Badge variant={
                              job.status === "completed" ? "default" :
                              job.status === "error" ? "destructive" :
                              job.status === "processing" ? "secondary" : "outline"
                            } className="text-[10px]">{job.status}</Badge>
                          </TableCell>
                          <TableCell className="text-sm">{job.total_items ?? "—"}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {new Date(job.created_at).toLocaleDateString("it-IT", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                          </TableCell>
                          <TableCell className="text-xs max-w-48 truncate">
                            {job.status === "error"
                              ? <span className="text-destructive">{job.error || "Errore sconosciuto"}</span>
                              : <span className="text-muted-foreground">{job.progress_message || "—"}</span>
                            }
                          </TableCell>
                        </TableRow>
                      ))}
                      {genJobs.length === 0 && (
                        <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">Nessuna generazione trovata.</TableCell></TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>

      {/* Add credits dialog */}
      <Dialog open={creditDialog.open} onOpenChange={(o) => !o && setCreditDialog({ open: false, userId: "", name: "" })}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Aggiungi NeuroCredits</DialogTitle>
            <DialogDescription>Aggiungi crediti a {creditDialog.name || "utente"}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="flex gap-2">
              {["50", "100", "250", "500"].map(v => (
                <Button key={v} size="sm" variant={creditAmount === v ? "default" : "outline"} onClick={() => setCreditAmount(v)}>
                  {v}
                </Button>
              ))}
            </div>
            <Input type="number" value={creditAmount} onChange={e => setCreditAmount(e.target.value)} min={1} placeholder="Quantità personalizzata" />
          </div>
          <DialogFooter>
            <Button onClick={addCreditsToUser}>
              <Zap className="h-4 w-4 mr-2" /> Aggiungi {creditAmount} crediti
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Ticket response dialog */}
      <Dialog open={ticketDialog.open} onOpenChange={(o) => !o && setTicketDialog({ open: false, ticket: null })}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rispondi al ticket</DialogTitle>
            <DialogDescription>{ticketDialog.ticket?.subject}</DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <p className="text-sm text-muted-foreground bg-secondary/50 rounded-lg p-3 mb-4">{ticketDialog.ticket?.message}</p>
            <Textarea
              value={ticketResponse}
              onChange={e => setTicketResponse(e.target.value)}
              placeholder="Scrivi la tua risposta..."
              rows={4}
            />
          </div>
          <DialogFooter>
            <Button onClick={respondToTicket} disabled={!ticketResponse.trim()}>Invia risposta</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Admin;
