import { useAuth } from "@/contexts/AuthContext";
import { Monitor, Smartphone, Globe, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

const DevicesSection = () => {
  const { user, session } = useAuth();
  const { toast } = useToast();

  const currentDevice = {
    browser: navigator.userAgent.includes("Chrome") ? "Chrome" :
             navigator.userAgent.includes("Firefox") ? "Firefox" :
             navigator.userAgent.includes("Safari") ? "Safari" : "Browser",
    os: navigator.userAgent.includes("Windows") ? "Windows" :
        navigator.userAgent.includes("Mac") ? "macOS" :
        navigator.userAgent.includes("Linux") ? "Linux" :
        navigator.userAgent.includes("Android") ? "Android" :
        navigator.userAgent.includes("iPhone") ? "iOS" : "Sconosciuto",
    isMobile: /Mobi|Android/i.test(navigator.userAgent),
    lastAccess: new Date().toLocaleDateString("it-IT", {
      day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit"
    }),
  };

  const signOutEverywhere = async () => {
    const { error } = await supabase.auth.signOut({ scope: "global" });
    if (error) {
      toast({ title: "Errore", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Disconnesso da tutti i dispositivi" });
    }
  };

  return (
    <div className="bg-card rounded-xl border border-border shadow-card p-6">
      <h3 className="text-base font-semibold text-card-foreground mb-4 flex items-center gap-2">
        <Monitor className="h-4 w-4 text-primary" /> Dispositivi attivi
      </h3>

      <div className="space-y-3">
        {/* Current device */}
        <div className="border border-primary/20 bg-primary/5 rounded-lg p-4 flex items-center gap-3">
          {currentDevice.isMobile ? (
            <Smartphone className="h-8 w-8 text-primary shrink-0" />
          ) : (
            <Monitor className="h-8 w-8 text-primary shrink-0" />
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className="font-medium text-card-foreground text-sm">{currentDevice.browser} · {currentDevice.os}</p>
              <span className="text-[10px] bg-primary text-primary-foreground px-1.5 py-0.5 rounded font-medium">Attuale</span>
            </div>
            <div className="flex items-center gap-1 mt-0.5">
              <Clock className="h-3 w-3 text-muted-foreground" />
              <p className="text-xs text-muted-foreground">{currentDevice.lastAccess}</p>
            </div>
          </div>
        </div>

        <p className="text-xs text-muted-foreground">
          Per motivi di sicurezza, puoi disconnetterti da tutti i dispositivi contemporaneamente.
        </p>

        <Button variant="outline" size="sm" onClick={signOutEverywhere} className="text-destructive border-destructive/30">
          Disconnetti tutti i dispositivi
        </Button>
      </div>
    </div>
  );
};

export default DevicesSection;
