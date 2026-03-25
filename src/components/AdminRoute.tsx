import { Navigate } from "react-router-dom";
import { type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { useUserRole } from "@/hooks/useUserRole";

/**
 * AdminRoute: renders children ONLY for admin users.
 * Shows a neutral loader during role resolution.
 * Redirects non-admins (or errors) to /dashboard without exposing admin UI.
 */
const AdminRoute = ({ children }: { children: ReactNode }) => {
  const { isAdmin, loading } = useUserRole();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!isAdmin) return <Navigate to="/dashboard" replace />;

  return <>{children}</>;
};

export default AdminRoute;
