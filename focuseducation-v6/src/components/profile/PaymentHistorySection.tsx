import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Receipt, Download } from "lucide-react";

interface PaymentRecord {
  id: string;
  plan_name: string;
  status: string;
  created_at: string;
  current_period_start: string | null;
  current_period_end: string | null;
}

const PaymentHistorySection = () => {
  const { user } = useAuth();
  const [records, setRecords] = useState<PaymentRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    const load = async () => {
      const { data } = await supabase
        .from("subscriptions")
        .select("id, plan_name, status, created_at, current_period_start, current_period_end")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });
      if (data) setRecords(data);
      setLoading(false);
    };
    load();
  }, [user]);

  const formatDate = (d: string | null) =>
    d ? new Date(d).toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "numeric" }) : "—";

  const statusLabel = (s: string) => {
    switch (s) {
      case "active": return { text: "Attivo", cls: "bg-primary/10 text-primary" };
      case "cancelled": return { text: "Cancellato", cls: "bg-destructive/10 text-destructive" };
      case "pending": return { text: "In attesa", cls: "bg-accent/10 text-accent" };
      default: return { text: s, cls: "bg-muted text-muted-foreground" };
    }
  };

  return (
    <div className="bg-card rounded-xl border border-border shadow-card p-6">
      <h3 className="text-base font-semibold text-card-foreground mb-4 flex items-center gap-2">
        <Receipt className="h-4 w-4 text-primary" /> Ricevute di pagamento
      </h3>

      {loading ? (
        <p className="text-sm text-muted-foreground">Caricamento...</p>
      ) : records.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4 text-center">Nessuna ricevuta disponibile.</p>
      ) : (
        <div className="space-y-3">
          {records.map((r) => {
            const status = statusLabel(r.status);
            return (
              <div key={r.id} className="border border-border rounded-lg p-4 flex items-center justify-between">
                <div>
                  <p className="font-medium text-card-foreground text-sm">{r.plan_name}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatDate(r.current_period_start)} → {formatDate(r.current_period_end)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${status.cls}`}>
                    {status.text}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default PaymentHistorySection;
