import { useState, useEffect, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useSubscription } from "@/hooks/useSubscription";
import { useGamification, BADGE_DEFINITIONS } from "@/hooks/useGamification";
import { useToast } from "@/hooks/use-toast";
import AppHeader from "@/components/AppHeader";
import MobileBottomNav from "@/components/MobileBottomNav";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { motion } from "framer-motion";
import {
  User, Camera, Crown, Award, Copy, Gift, Share2, LogOut
} from "lucide-react";
import ProfileSection from "@/components/profile/ProfileSection";
import PlanSection from "@/components/profile/PlanSection";
import PaymentHistorySection from "@/components/profile/PaymentHistorySection";
import DevicesSection from "@/components/profile/DevicesSection";
import NotificationsSection from "@/components/profile/NotificationsSection";
import SupportTicketSection from "@/components/profile/SupportTicketSection";
import ReferralSection from "@/components/profile/ReferralSection";
import { useExamCountdown } from "@/hooks/useExamCountdown";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Calendar, Target, Eye, EyeOff } from "lucide-react";

const Profile = () => {
  const { user, signOut } = useAuth();
  const { toast } = useToast();
  const { hasSubscription, subscription } = useSubscription();
  const { achievements, badgeCount } = useGamification();
  const fileRef = useRef<HTMLInputElement>(null);

  const [profile, setProfile] = useState<{
    full_name: string | null;
    avatar_url: string | null;
    study_level: string | null;
    streak_count: number;
  } | null>(null);

  // Referral
  const [referralCode, setReferralCode] = useState<string | null>(null);
  const [referralUses, setReferralUses] = useState(0);
  const [referralMax, setReferralMax] = useState(5);
  const [referralDiscount, setReferralDiscount] = useState(20);

  // Exam + leaderboard state
  const { examInfo, saveExam } = useExamCountdown();
  const [examSubjectEdit, setExamSubjectEdit] = useState("");
  const [examDateEdit, setExamDateEdit]       = useState("");
  const [savingExam, setSavingExam]           = useState(false);
  const [leaderboardOptIn, setLeaderboardOptIn] = useState(true);
  const [savingLeaderboard, setSavingLeaderboard] = useState(false);

  // Sync exam fields when examInfo loads
  useEffect(() => {
    if (examInfo?.exam_date)    setExamDateEdit(examInfo.exam_date);
    if (examInfo?.exam_subject) setExamSubjectEdit(examInfo.exam_subject);
  }, [examInfo?.exam_date, examInfo?.exam_subject]);

  // Load leaderboard prefs
  useEffect(() => {
    if (!user) return;
    supabase.from("profiles")
      .select("leaderboard_visible")
      .eq("user_id", user.id).maybeSingle()
      .then(({ data }) => {
        if (data) {
          setLeaderboardOptIn(!!(data as any).leaderboard_visible);
        }
      });
  }, [user]);

  const saveExamInfo = async () => {
    if (!examDateEdit) return;
    setSavingExam(true);
    await saveExam(examDateEdit, examSubjectEdit);
    setSavingExam(false);
    toast({ title: "Esame aggiornato!" });
  };

  const saveLeaderboardPrefs = async () => {
    if (!user) return;
    setSavingLeaderboard(true);
    await supabase.from("profiles").update({
      leaderboard_visible: leaderboardOptIn,
    } as any).eq("user_id", user.id);
    setSavingLeaderboard(false);
    toast({ title: leaderboardOptIn ? "Ora sei visibile in classifica!" : "Sei stato rimosso dalla classifica." });
  };

  const loadProfile = async () => {
    if (!user) return;
    const [profileRes, referralRes] = await Promise.all([
      supabase.from("profiles").select("full_name, avatar_url, study_level, streak_count").eq("user_id", user.id).single(),
      supabase.from("referral_codes").select("*").eq("user_id", user.id).maybeSingle(),
    ]);
    if (profileRes.data) setProfile(profileRes.data);
    if (referralRes.data) {
      setReferralCode(referralRes.data.code);
      setReferralUses(referralRes.data.times_used);
      setReferralMax(referralRes.data.max_uses);
      setReferralDiscount(referralRes.data.discount_percent);
    }
  };

  useEffect(() => { loadProfile(); }, [user]);

  const generateReferralCode = async () => {
    if (!user) return;
    const code = `FOCUSED-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
    const { error } = await supabase.from("referral_codes").insert({
      user_id: user.id, code, discount_percent: 20, max_uses: 5,
    });
    if (!error) {
      setReferralCode(code);
      setReferralUses(0);
      toast({ title: "Codice referral creato!", description: `Il tuo codice: ${code}` });
    }
  };

  const copyReferral = () => {
    if (referralCode) {
      navigator.clipboard.writeText(referralCode);
      toast({ title: "Copiato!", description: "Codice referral copiato negli appunti." });
    }
  };

  const uploadAvatar = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    const ext = file.name.split(".").pop();
    const path = `${user.id}/avatar.${ext}`;

    const { error: uploadError } = await supabase.storage.from("avatars").upload(path, file, { upsert: true });
    if (uploadError) {
      toast({ title: "Errore upload", description: uploadError.message, variant: "destructive" });
      return;
    }
    const { data: urlData } = supabase.storage.from("avatars").getPublicUrl(path);
    // FIX: cache-busting con timestamp → il browser carica la nuova immagine
    // invece di mostrare quella vecchia in cache
    const avatarUrl = `${urlData.publicUrl}?t=${Date.now()}`;
    await supabase.from("profiles").update({ avatar_url: avatarUrl }).eq("user_id", user.id);
    setProfile((p) => p ? { ...p, avatar_url: avatarUrl } : p);
    toast({ title: "Immagine aggiornata!" });
  };

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <main className="container mx-auto px-4 py-8 pb-24 md:pb-8 max-w-3xl">
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>

          {/* Profile header */}
          <div className="bg-card rounded-xl border border-border shadow-card p-6 mb-6">
            <div className="flex items-center gap-4">
              <div className="relative">
                <div className="h-20 w-20 rounded-full bg-secondary flex items-center justify-center overflow-hidden border-2 border-primary/20">
                  {profile?.avatar_url ? (
                    <img src={profile.avatar_url} alt="Avatar" className="h-full w-full object-cover" />
                  ) : (
                    <User className="h-8 w-8 text-muted-foreground" />
                  )}
                </div>
                <button
                  onClick={() => fileRef.current?.click()}
                  className="absolute -bottom-1 -right-1 h-7 w-7 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow-md hover:bg-primary/90 transition-colors"
                >
                  <Camera className="h-3.5 w-3.5" />
                </button>
                <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={uploadAvatar} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-card-foreground text-lg truncate">{profile?.full_name || "Studente"}</p>
                <p className="text-sm text-muted-foreground truncate">{user?.email}</p>
                <div className="flex items-center gap-2 mt-1">
                  {hasSubscription && (
                    <Badge className="bg-primary text-primary-foreground"><Crown className="h-3 w-3 mr-1" />{subscription?.plan_name}</Badge>
                  )}
                  <Badge variant="outline"><Award className="h-3 w-3 mr-1" />{badgeCount} badge</Badge>
                </div>
              </div>
            </div>
          </div>

          {/* Tabs */}
          <Tabs defaultValue="profile" className="space-y-4">
            <TabsList className="w-full grid grid-cols-3 sm:grid-cols-6 h-auto gap-1">
              <TabsTrigger value="profile" className="text-xs py-2">Profilo</TabsTrigger>
              <TabsTrigger value="plan" className="text-xs py-2">Piano</TabsTrigger>
              <TabsTrigger value="receipts" className="text-xs py-2">Ricevute</TabsTrigger>
              <TabsTrigger value="devices" className="text-xs py-2">Dispositivi</TabsTrigger>
              <TabsTrigger value="notifications" className="text-xs py-2">Notifiche</TabsTrigger>
              <TabsTrigger value="support" className="text-xs py-2">Assistenza</TabsTrigger>
            </TabsList>

            <TabsContent value="profile">
              <ProfileSection profile={profile} onUpdate={loadProfile} />

              {/* Exam info */}
              <div className="bg-card rounded-xl border border-border shadow-card p-6 mt-6">
                <h3 className="text-base font-semibold text-card-foreground mb-4 flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-primary" /> Prossimo esame
                </h3>
                <div className="space-y-3">
                  <div>
                    <label className="text-xs text-muted-foreground block mb-1">Materia</label>
                    <Input
                      value={examSubjectEdit}
                      onChange={e => setExamSubjectEdit(e.target.value)}
                      placeholder="Es. Anatomia, Diritto Privato..."
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground block mb-1">Data esame</label>
                    <Input
                      type="date"
                      value={examDateEdit}
                      onChange={e => setExamDateEdit(e.target.value)}
                      min={new Date().toISOString().split("T")[0]}
                    />
                  </div>
                  <Button size="sm" onClick={saveExamInfo} disabled={savingExam || !examDateEdit}>
                    <Target className="h-3.5 w-3.5 mr-1.5" />
                    {savingExam ? "Salvataggio..." : "Salva esame"}
                  </Button>
                </div>
              </div>

              {/* Leaderboard privacy */}
              <div className="bg-card rounded-xl border border-border shadow-card p-6 mt-6">
                <h3 className="text-base font-semibold text-card-foreground mb-1 flex items-center gap-2">
                  {leaderboardOptIn ? <Eye className="h-4 w-4 text-primary" /> : <EyeOff className="h-4 w-4 text-muted-foreground" />}
                  Impostazioni Classifica
                </h3>
                <p className="text-xs text-muted-foreground mb-4">
                  Se attivi questa opzione, il tuo nickname e le tue statistiche (XP, livello, streak) saranno visibili pubblicamente nella classifica.
                </p>
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-card-foreground">Mostra il mio profilo nella Classifica</span>
                    <Switch checked={leaderboardOptIn} onCheckedChange={setLeaderboardOptIn} />
                  </div>
                  {!leaderboardOptIn && (
                    <p className="text-xs text-muted-foreground italic">
                      ⚠️ Il tuo profilo non apparirà nella classifica pubblica.
                    </p>
                  )}
                  <Button size="sm" variant="outline" onClick={saveLeaderboardPrefs} disabled={savingLeaderboard}>
                    {savingLeaderboard ? "Salvataggio..." : "Salva preferenze classifica"}
                  </Button>
                </div>
              </div>

              {/* Badges */}
              <div className="bg-card rounded-xl border border-border shadow-card p-6 mt-6">
                <h3 className="text-base font-semibold text-card-foreground mb-4 flex items-center gap-2">
                  <Award className="h-4 w-4 text-primary" /> Badge
                  <span className="text-xs text-muted-foreground ml-auto">{badgeCount}/{Object.keys(BADGE_DEFINITIONS).length}</span>
                </h3>
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
                  {Object.entries(BADGE_DEFINITIONS).map(([key, def]) => {
                    const earned = achievements.some((a) => a.achievement_type === key);
                    return (
                      <div
                        key={key}
                        className={`rounded-xl border p-3 text-center transition-all ${
                          earned ? "border-primary/30 bg-primary/5" : "border-border opacity-40 grayscale"
                        }`}
                      >
                        <div className="text-2xl mb-1">{def.icon}</div>
                        <p className="text-[10px] font-medium text-card-foreground leading-tight">{def.name}</p>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Referral — full-featured component */}
              <div className="mt-6">
                <ReferralSection />
              </div>
            </TabsContent>

            <TabsContent value="plan">
              <PlanSection />
            </TabsContent>

            <TabsContent value="receipts">
              <PaymentHistorySection />
            </TabsContent>

            <TabsContent value="devices">
              <DevicesSection />
            </TabsContent>

            <TabsContent value="notifications">
              <NotificationsSection />
            </TabsContent>

            <TabsContent value="support">
              <SupportTicketSection />
            </TabsContent>
          </Tabs>

          {/* Logout */}
          <Button variant="outline" onClick={signOut} className="w-full mt-6">
            <LogOut className="h-4 w-4 mr-2" /> Esci dall'account
          </Button>
        </motion.div>
      </main>
      <MobileBottomNav />
    </div>
  );
};

export default Profile;
