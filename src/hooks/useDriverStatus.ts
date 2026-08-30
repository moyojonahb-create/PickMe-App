import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/hooks/useAuth';
import { getCached, setCache } from '@/lib/queryCache';

interface DriverStatus {
  isDriver: boolean;
  isApproved: boolean;
  isPending: boolean;
  driverId: string | null;
  loading: boolean;
}

type CachedStatus = Omit<DriverStatus, 'loading'>;

export function useDriverStatus(): DriverStatus {
  const { user, loading: authLoading } = useAuth();
  const [state, setState] = useState<DriverStatus>({
    isDriver: false,
    isApproved: false,
    isPending: false,
    driverId: null,
    loading: true,
  });

  useEffect(() => {
    if (authLoading) return;

    if (!user) {
      setState({
        isDriver: false,
        isApproved: false,
        isPending: false,
        driverId: null,
        loading: false,
      });
      return;
    }

    // UserMenu (rendered on most pages) mounts this hook on every
    // navigation — cache the result for 30s so hopping between pages
    // doesn't re-query `drivers` every time, same TTL/pattern as
    // getDriverProfile() in offerHelpers.ts.
    const cacheKey = `driver-status-${user.id}`;
    const cached = getCached<CachedStatus>(cacheKey);
    if (cached) {
      setState({ ...cached, loading: false });
      return;
    }

    const checkDriverStatus = async () => {
      try {
        const { data, error } = await supabase
          .from('drivers')
          .select('id, status')
          .eq('user_id', user.id)
          .maybeSingle();

        if (error) {
          console.error('Error checking driver status:', error);
          setState(prev => ({ ...prev, loading: false }));
          return;
        }

        const next: CachedStatus = data
          ? { isDriver: true, isApproved: data.status === 'approved', isPending: data.status === 'pending', driverId: data.id }
          : { isDriver: false, isApproved: false, isPending: false, driverId: null };
        setCache(cacheKey, next, 30_000);
        setState({ ...next, loading: false });
      } catch (err) {
        console.error('Error checking driver status:', err);
        setState(prev => ({ ...prev, loading: false }));
      }
    };

    checkDriverStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, authLoading]);


  return state;
}
