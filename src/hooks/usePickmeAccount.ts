import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

interface PickmeProfile {
  full_name: string | null;
  pickme_account: string | null;
}

/** Fetches the current user's display name and PickMe Account number (PMR######R). */
export function usePickmeAccount() {
  const { user } = useAuth();
  const [profile, setProfile] = useState<PickmeProfile>({ full_name: null, pickme_account: null });
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!user) { setLoading(false); return; }
    const { data } = await supabase
      .from("profiles")
      .select("full_name, pickme_account")
      .eq("user_id", user.id)
      .maybeSingle();
    setProfile({
      full_name: data?.full_name ?? null,
      pickme_account: (data as { pickme_account?: string } | null)?.pickme_account ?? null,
    });
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);


  useEffect(() => { load(); }, [load]);

  return { ...profile, loading, refresh: load };
}
