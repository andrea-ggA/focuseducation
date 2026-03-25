import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export const useUserRole = () => {
  const { user } = useAuth();
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setIsAdmin(false);
      setLoading(false);
      return;
    }

    let cancelled = false;

    // Safety net: if query hangs >5s, assume non-admin so UI never freezes
    const timeout = setTimeout(() => {
      if (!cancelled) { setIsAdmin(false); setLoading(false); }
    }, 5000);

    const checkRole = async () => {
      try {
        const { data } = await supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", user.id)
          .eq("role", "admin")
          .maybeSingle();

        if (!cancelled) { setIsAdmin(!!data); setLoading(false); }
      } catch {
        if (!cancelled) { setIsAdmin(false); setLoading(false); }
      } finally {
        clearTimeout(timeout);
      }
    };

    checkRole();
    return () => { cancelled = true; clearTimeout(timeout); };
  }, [user]);

  return { isAdmin, loading };
};
