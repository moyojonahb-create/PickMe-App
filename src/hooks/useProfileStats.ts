import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/hooks/useAuth';

export interface ProfileStats {
  totalRides: number;
  totalDistance: number;
  totalSpent: number;
  lastRideDate: string | null;
  completedRides: number;
  referralCount: number;
  referralEarnings: number;
  referralCode: string | null;
  unreadNotifications: number;
}

const defaults: ProfileStats = {
  totalRides: 0,
  totalDistance: 0,
  totalSpent: 0,
  lastRideDate: null,
  completedRides: 0,
  referralCount: 0,
  referralEarnings: 0,
  referralCode: null,
  unreadNotifications: 0,
};

export function useProfileStats() {
  const { user } = useAuth();
  const [stats, setStats] = useState<ProfileStats>(defaults);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    if (!user) { setLoading(false); return; }

    try {
      // Fetch rides stats
      const { data: rides } = await supabase
        .from('rides')
        .select('fare, distance_km, status, created_at')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(500);

      const completed = (rides || []).filter(r => r.status === 'completed');
      const totalDistance = completed.reduce((s, r) => s + (r.distance_km || 0), 0);
      const totalSpent = completed.reduce((s, r) => s + Number(r.fare || 0), 0);

      // Fetch referral info
      const { data: profile } = await supabase
        .from('profiles')
        .select('referral_code')
        .eq('user_id', user.id)
        .maybeSingle();

      const { count: refCount } = await supabase
        .from('referrals')
        .select('*', { count: 'exact', head: true })
        .eq('referrer_id', user.id)
        .eq('status', 'completed');

      // Unread notifications
      const { count: unread } = await supabase
        .from('notifications')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('is_read', false);

      setStats({
        totalRides: (rides || []).length,
        completedRides: completed.length,
        totalDistance,
        totalSpent,
        lastRideDate: rides?.[0]?.created_at || null,
        referralCount: refCount || 0,
        referralEarnings: (refCount || 0) * 2,
        referralCode: profile?.referral_code || null,
        unreadNotifications: unread || 0,
      });
    } catch {
      // silent fail
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);


  useEffect(() => { fetch(); }, [fetch]);

  return { stats, loading, refresh: fetch };
}
