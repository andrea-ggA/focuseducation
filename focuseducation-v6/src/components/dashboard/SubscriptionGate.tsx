import { ReactNode } from "react";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";

interface SubscriptionGateProps {
  hasAccess: boolean;
  featureName: string;
  children: ReactNode;
}

const SubscriptionGate = ({ hasAccess, featureName, children }: SubscriptionGateProps) => {
  if (hasAccess) return <>{children}</>;

  return (
    <div className="relative">
      <div className="pointer-events-none opacity-30 blur-[2px]">{children}</div>
      <div className="absolute inset-0 flex flex-col items-center justify-center bg-card/80 backdrop-blur-sm rounded-xl border border-border">
        <Lock className="h-8 w-8 text-muted-foreground mb-3" />
        <p className="text-sm font-medium text-card-foreground mb-1">
          {featureName}
        </p>
        <p className="text-xs text-muted-foreground mb-4">
          Disponibile con un piano a pagamento
        </p>
        <Button size="sm" asChild>
          <Link to="/pricing">Upgrade</Link>
        </Button>
      </div>
    </div>
  );
};

export default SubscriptionGate;
