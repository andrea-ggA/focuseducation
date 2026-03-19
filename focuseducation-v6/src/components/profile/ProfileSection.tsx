import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { User, Mail, Lock, Save } from "lucide-react";

interface Props {
  profile: { full_name: string | null; study_level: string | null } | null;
  onUpdate: () => void;
}

const ProfileSection = ({ profile, onUpdate }: Props) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [fullName, setFullName] = useState(profile?.full_name || "");
  // FIX: profile arriva async dal parent — sincronizza quando cambia
  useEffect(() => { if (profile?.full_name) setFullName(profile.full_name); }, [profile?.full_name]);
  const [newEmail, setNewEmail] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [savingEmail, setSavingEmail] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);

  const saveName = async () => {
    if (!user) return;
    setSavingName(true);
    await supabase.from("profiles").update({ full_name: fullName }).eq("user_id", user.id);
    setSavingName(false);
    toast({ title: "Nome aggiornato!" });
    onUpdate();
  };

  const changeEmail = async () => {
    if (!newEmail.includes("@")) {
      toast({ title: "Email non valida", variant: "destructive" });
      return;
    }
    setSavingEmail(true);
    const { error } = await supabase.auth.updateUser({ email: newEmail });
    setSavingEmail(false);
    if (error) {
      toast({ title: "Errore", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Email di conferma inviata", description: "Controlla la tua casella di posta per confermare il cambio." });
      setNewEmail("");
    }
  };

  const changePassword = async () => {
    if (newPassword.length < 6) {
      toast({ title: "Password troppo corta", description: "Minimo 6 caratteri.", variant: "destructive" });
      return;
    }
    if (newPassword !== confirmPassword) {
      toast({ title: "Le password non coincidono", variant: "destructive" });
      return;
    }
    setSavingPassword(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setSavingPassword(false);
    if (error) {
      toast({ title: "Errore", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Password aggiornata!" });
      setNewPassword("");
      setConfirmPassword("");
      setCurrentPassword("");
    }
  };

  return (
    <div className="space-y-6">
      {/* Name */}
      <div className="bg-card rounded-xl border border-border shadow-card p-6">
        <h3 className="text-base font-semibold text-card-foreground mb-4 flex items-center gap-2">
          <User className="h-4 w-4 text-primary" /> Informazioni personali
        </h3>
        <div className="space-y-3">
          <div>
            <Label className="text-muted-foreground">Nome completo</Label>
            <Input value={fullName} onChange={(e) => setFullName(e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label className="text-muted-foreground">Email attuale</Label>
            <Input value={user?.email || ""} disabled className="mt-1" />
          </div>
          <Button onClick={saveName} disabled={savingName} size="sm">
            <Save className="h-3.5 w-3.5 mr-1.5" />
            {savingName ? "Salvataggio..." : "Salva nome"}
          </Button>
        </div>
      </div>

      {/* Change email */}
      <div className="bg-card rounded-xl border border-border shadow-card p-6">
        <h3 className="text-base font-semibold text-card-foreground mb-4 flex items-center gap-2">
          <Mail className="h-4 w-4 text-primary" /> Cambia email
        </h3>
        <div className="space-y-3">
          <div>
            <Label className="text-muted-foreground">Nuova email</Label>
            <Input value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="nuova@email.com" className="mt-1" />
          </div>
          <Button onClick={changeEmail} disabled={savingEmail || !newEmail} size="sm">
            {savingEmail ? "Invio..." : "Cambia email"}
          </Button>
        </div>
      </div>

      {/* Change password */}
      <div className="bg-card rounded-xl border border-border shadow-card p-6">
        <h3 className="text-base font-semibold text-card-foreground mb-4 flex items-center gap-2">
          <Lock className="h-4 w-4 text-primary" /> Cambia password
        </h3>
        <div className="space-y-3">
          <div>
            <Label className="text-muted-foreground">Nuova password</Label>
            <Input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="Min. 6 caratteri" className="mt-1" />
          </div>
          <div>
            <Label className="text-muted-foreground">Conferma password</Label>
            <Input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="Ripeti la password" className="mt-1" />
          </div>
          <Button onClick={changePassword} disabled={savingPassword || !newPassword} size="sm">
            {savingPassword ? "Aggiornamento..." : "Aggiorna password"}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default ProfileSection;
