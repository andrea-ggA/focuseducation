import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Bell, Clock, Brain, Trophy, BarChart3, Volume2, Upload, Play, Trash2, ShieldCheck } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

interface NotifPrefs {
  study_reminder_enabled: boolean;
  reminder_time: string;
  break_reminders: boolean;
  achievement_notifications: boolean;
  daily_summary: boolean;
  focus_mode_enabled: boolean;
  notification_sound_url: string | null;
}

const defaultPrefs: NotifPrefs = {
  study_reminder_enabled: true,
  reminder_time: "09:00",
  break_reminders: true,
  achievement_notifications: true,
  daily_summary: false,
  focus_mode_enabled: false,
  notification_sound_url: null,
};

const ACCEPTED_AUDIO = ".mp3,.wav,.ogg,.aac,.m4a,.flac,.wma,.webm";

const NotificationsSection = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [prefs, setPrefs] = useState<NotifPrefs>(defaultPrefs);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [permissionStatus, setPermissionStatus] = useState<string>("default");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if ("Notification" in window) setPermissionStatus(Notification.permission);
  }, []);

  useEffect(() => {
    if (!user) return;
    const load = async () => {
      const { data } = await supabase
        .from("notification_preferences")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle();
      if (data) {
        setPrefs({
          study_reminder_enabled: data.study_reminder_enabled,
          reminder_time: data.reminder_time?.substring(0, 5) || "09:00",
          break_reminders: data.break_reminders,
          achievement_notifications: data.achievement_notifications,
          daily_summary: data.daily_summary,
          focus_mode_enabled: (data as any).focus_mode_enabled ?? false,
          notification_sound_url: (data as any).notification_sound_url ?? null,
        });
      }
      setLoading(false);
    };
    load();
  }, [user]);

  const requestPermission = async () => {
    if (!("Notification" in window)) {
      toast({ title: "Non supportato", description: "Il tuo browser non supporta le notifiche.", variant: "destructive" });
      return;
    }
    const perm = await Notification.requestPermission();
    setPermissionStatus(perm);
    if (perm === "granted") {
      toast({ title: "Notifiche abilitate! 🔔" });
      new Notification("FocusADHD", { body: "Le notifiche sono attive!", icon: "/favicon.ico" });
    }
  };

  const uploadSound = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    const maxSize = 5 * 1024 * 1024; // 5MB
    if (file.size > maxSize) {
      toast({ title: "File troppo grande", description: "Massimo 5MB.", variant: "destructive" });
      return;
    }
    setUploading(true);
    const ext = file.name.split(".").pop()?.toLowerCase() || "mp3";
    const path = `${user.id}/notification-sound.${ext}`;

    const { error } = await supabase.storage.from("notification-sounds").upload(path, file, { upsert: true });
    if (error) {
      toast({ title: "Errore upload", description: error.message, variant: "destructive" });
      setUploading(false);
      return;
    }
    const { data: urlData } = supabase.storage.from("notification-sounds").getPublicUrl(path);
    setPrefs(p => ({ ...p, notification_sound_url: urlData.publicUrl }));
    setUploading(false);
    toast({ title: "Suono caricato! 🔊" });
  };

  const removeSound = async () => {
    // FIX: elimina anche il file da Storage (prima veniva solo rimosso dalla UI)
    if (prefs.notification_sound_url && user) {
      const path = `${user.id}/notification-sound.` +
        (prefs.notification_sound_url.split(".").pop()?.split("?")[0] || "mp3");
      await supabase.storage.from("notification-sounds").remove([path]);
    }
    setPrefs(p => ({ ...p, notification_sound_url: null }));
  };

  const playSound = () => {
    if (prefs.notification_sound_url) {
      if (audioRef.current) audioRef.current.pause();
      audioRef.current = new Audio(prefs.notification_sound_url);
      audioRef.current.play().catch(() => {});
    }
  };

  const savePrefs = async () => {
    if (!user) return;
    setSaving(true);
    const payload = {
      user_id: user.id,
      study_reminder_enabled: prefs.study_reminder_enabled,
      reminder_time: prefs.reminder_time + ":00",
      break_reminders: prefs.break_reminders,
      achievement_notifications: prefs.achievement_notifications,
      daily_summary: prefs.daily_summary,
      focus_mode_enabled: prefs.focus_mode_enabled,
      notification_sound_url: prefs.notification_sound_url,
    };

    const { data: existing } = await supabase
      .from("notification_preferences")
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (existing) {
      await supabase.from("notification_preferences").update(payload).eq("user_id", user.id);
    } else {
      await supabase.from("notification_preferences").insert(payload);
    }

    setSaving(false);
    toast({ title: "Preferenze notifiche salvate!" });

    if (prefs.study_reminder_enabled && permissionStatus === "granted") {
      scheduleStudyReminder(prefs.reminder_time);
    }
  };

  const scheduleStudyReminder = (time: string) => {
    const [hours, minutes] = time.split(":").map(Number);
    const now = new Date();
    const reminderTime = new Date();
    reminderTime.setHours(hours, minutes, 0, 0);
    if (reminderTime <= now) reminderTime.setDate(reminderTime.getDate() + 1);
    const delay = reminderTime.getTime() - now.getTime();

    setTimeout(() => {
      if (Notification.permission === "granted") {
        new Notification("📚 Tempo di studiare!", {
          body: "Il tuo cervello ADHD è pronto per una sessione di focus. Inizia con 25 minuti! 🎯",
          icon: "/favicon.ico",
          tag: "study-reminder",
        });
        if (prefs.notification_sound_url) {
          new Audio(prefs.notification_sound_url).play().catch(() => {});
        }
      }
    }, delay);
  };

  const toggle = (key: keyof NotifPrefs) => {
    setPrefs((p) => ({ ...p, [key]: !p[key] }));
  };

  if (loading) return null;

  return (
    <div className="space-y-6">
      <div className="bg-card rounded-xl border border-border shadow-card p-6">
        <h3 className="text-base font-semibold text-card-foreground mb-4 flex items-center gap-2">
          <Bell className="h-4 w-4 text-primary" /> Notifiche & Promemoria
        </h3>

        {permissionStatus !== "granted" && (
          <div className="bg-accent/10 border border-accent/20 rounded-lg p-3 mb-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-card-foreground">Abilita notifiche push</p>
                <p className="text-xs text-muted-foreground">Per ricevere promemoria di studio ADHD-friendly</p>
              </div>
              <Button size="sm" onClick={requestPermission}>
                <Bell className="h-3.5 w-3.5 mr-1.5" /> Abilita
              </Button>
            </div>
          </div>
        )}

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Brain className="h-4 w-4 text-primary" />
              <div>
                <p className="text-sm font-medium text-card-foreground">Promemoria studio giornaliero</p>
                <p className="text-xs text-muted-foreground">Ricevi un promemoria per iniziare a studiare</p>
              </div>
            </div>
            <Switch checked={prefs.study_reminder_enabled} onCheckedChange={() => toggle("study_reminder_enabled")} />
          </div>

          {prefs.study_reminder_enabled && (
            <div className="ml-7 flex items-center gap-2">
              <Clock className="h-3.5 w-3.5 text-muted-foreground" />
              <Label className="text-xs text-muted-foreground">Orario:</Label>
              <Input type="time" value={prefs.reminder_time}
                onChange={(e) => setPrefs((p) => ({ ...p, reminder_time: e.target.value }))}
                className="w-28 h-8 text-xs" />
            </div>
          )}

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Clock className="h-4 w-4 text-accent" />
              <div>
                <p className="text-sm font-medium text-card-foreground">Promemoria pause</p>
                <p className="text-xs text-muted-foreground">Avvisa quando fare una pausa durante lo studio</p>
              </div>
            </div>
            <Switch checked={prefs.break_reminders} onCheckedChange={() => toggle("break_reminders")} />
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Trophy className="h-4 w-4 text-accent" />
              <div>
                <p className="text-sm font-medium text-card-foreground">Badge e traguardi</p>
                <p className="text-xs text-muted-foreground">Notifica quando sblocchi un badge</p>
              </div>
            </div>
            <Switch checked={prefs.achievement_notifications} onCheckedChange={() => toggle("achievement_notifications")} />
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <BarChart3 className="h-4 w-4 text-primary" />
              <div>
                <p className="text-sm font-medium text-card-foreground">Riepilogo giornaliero</p>
                <p className="text-xs text-muted-foreground">Ricevi un riepilogo serale dei tuoi progressi</p>
              </div>
            </div>
            <Switch checked={prefs.daily_summary} onCheckedChange={() => toggle("daily_summary")} />
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <ShieldCheck className="h-4 w-4 text-primary" />
              <div>
                <p className="text-sm font-medium text-card-foreground">Modalità Focus (Non disturbare)</p>
                <p className="text-xs text-muted-foreground">Silenzia le notifiche durante il timer Pomodoro</p>
              </div>
            </div>
            <Switch checked={prefs.focus_mode_enabled} onCheckedChange={() => toggle("focus_mode_enabled")} />
          </div>

          <Button onClick={savePrefs} disabled={saving} size="sm" className="w-full mt-2">
            {saving ? "Salvataggio..." : "Salva preferenze notifiche"}
          </Button>
        </div>
      </div>

      {/* Custom Sound */}
      <div className="bg-card rounded-xl border border-border shadow-card p-6">
        <h3 className="text-base font-semibold text-card-foreground mb-4 flex items-center gap-2">
          <Volume2 className="h-4 w-4 text-primary" /> Suono personalizzato
        </h3>
        <p className="text-xs text-muted-foreground mb-3">
          Carica un file audio per le notifiche. Formati supportati: MP3, WAV, OGG, AAC, M4A, FLAC, WMA, WebM (max 5MB).
        </p>

        {prefs.notification_sound_url ? (
          <div className="flex items-center gap-2 bg-secondary/50 rounded-lg p-3">
            <Volume2 className="h-4 w-4 text-primary shrink-0" />
            <span className="text-sm text-card-foreground flex-1 truncate">Suono personalizzato caricato</span>
            <Button variant="ghost" size="icon" onClick={playSound} className="h-8 w-8">
              <Play className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="icon" onClick={removeSound} className="h-8 w-8 text-destructive">
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        ) : (
          <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={uploading} className="w-full">
            <Upload className="h-4 w-4 mr-2" />
            {uploading ? "Caricamento..." : "Carica file audio"}
          </Button>
        )}
        <input ref={fileRef} type="file" accept={ACCEPTED_AUDIO} className="hidden" onChange={uploadSound} />
      </div>
    </div>
  );
};

export default NotificationsSection;
