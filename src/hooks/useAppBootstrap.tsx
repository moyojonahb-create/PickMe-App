/* eslint-disable react-refresh/only-export-components */
// Single splash-time bootstrap: session, profile/role, favorites, recent
// trips, town pricing, and a Mapbox SDK warmup all run in parallel here so
// that every screen mounted after the splash clears can read from memory
// instead of re-fetching. Capped at ~6s — if fetches are still in flight
// past that, the splash dismisses anyway with whatever cached data landed,
// and the rest keeps populating the context in the background.
import { createContext, useContext, useEffect, useRef, useState, useCallback, ReactNode } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/hooks/useAuth';
import { loadMapbox } from '@/lib/mapboxLoader';
import { preloadAllTownPricing } from '@/hooks/useTownPricing';

const ADMIN_EMAIL = 'moyojonahb@gmail.com';
const BOOTSTRAP_TIMEOUT_MS = 6000;

export type AppRole = 'guest' | 'rider' | 'driver' | 'admin';

export interface CachedProfile {
  full_name: string | null;
  avatar_url: string | null;
  gender: string | null;
  phone: string | null;
}

export interface CachedDriverProfile {
  id: string;
  user_id: string;
  status: string;
  is_online: boolean;
  vehicle_make?: string | null;
  vehicle_model?: string | null;
  plate_number?: string | null;
  rating_avg?: number | null;
  [key: string]: unknown;
}

export interface CachedFavoriteLocation {
  id: string;
  name: string;
  address: string | null;
  latitude: number;
  longitude: number;
  icon: string | null;
}

export interface CachedRecentRide {
  id: string;
  pickup_address: string | null;
  pickup_lat: number | null;
  pickup_lon: number | null;
  dropoff_address: string | null;
  dropoff_lat: number | null;
  dropoff_lon: number | null;
  created_at: string | null;
}

interface AppBootstrapContextType {
  /** Splash has cleared — every critical fetch resolved, or the ~6s budget ran out. */
  ready: boolean;
  progress: number;
  role: AppRole;
  profile: CachedProfile | null;
  driverProfile: CachedDriverProfile | null;
  favorites: CachedFavoriteLocation[];
  recentRides: CachedRecentRide[];
  refreshFavorites: () => Promise<void>;
  refreshRecentRides: () => Promise<void>;
  refreshDriverProfile: () => Promise<void>;
}

const AppBootstrapContext = createContext<AppBootstrapContextType | undefined>(undefined);

export function AppBootstrapProvider({ children }: { children: ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const [ready, setReady] = useState(false);
  const [progress, setProgress] = useState(8);
  const [role, setRole] = useState<AppRole>('guest');
  const [profile, setProfile] = useState<CachedProfile | null>(null);
  const [driverProfile, setDriverProfile] = useState<CachedDriverProfile | null>(null);
  const [favorites, setFavorites] = useState<CachedFavoriteLocation[]>([]);
  const [recentRides, setRecentRides] = useState<CachedRecentRide[]>([]);
  const startedRef = useRef(false);

  const bumpProgress = useCallback((n: number) => {
    setProgress((p) => {
      const next = Math.max(p, n);
      (window as unknown as { __setSplashProgress?: (n: number) => void }).__setSplashProgress?.(next);
      return next;
    });
  }, []);

  const fetchFavorites = useCallback(async (uid: string) => {
    const { data } = await supabase
      .from('favorite_locations')
      .select('id, name, address, latitude, longitude, icon')
      .eq('user_id', uid)
      .order('created_at', { ascending: false })
      .limit(20);
    setFavorites((data as CachedFavoriteLocation[]) ?? []);
  }, []);

  const fetchRecentRides = useCallback(async (uid: string) => {
    const { data } = await supabase
      .from('rides')
      .select('id, pickup_address, pickup_lat, pickup_lon, dropoff_address, dropoff_lat, dropoff_lon, created_at')
      .eq('user_id', uid)
      .order('created_at', { ascending: false })
      .limit(20);
    setRecentRides((data as CachedRecentRide[]) ?? []);
  }, []);

  const fetchDriverProfile = useCallback(async (uid: string) => {
    const { data } = await supabase.from('drivers').select('*').eq('user_id', uid).maybeSingle();
    setDriverProfile((data as CachedDriverProfile) ?? null);
    return data as CachedDriverProfile | null;
  }, []);

  useEffect(() => {
    if (authLoading || startedRef.current) return;
    startedRef.current = true;

    let dismissed = false;
    const dismiss = () => {
      if (dismissed) return;
      dismissed = true;
      setReady(true);
      (window as unknown as { __dismissSplash?: () => void }).__dismissSplash?.();
    };
    const timeoutId = window.setTimeout(dismiss, BOOTSTRAP_TIMEOUT_MS);

    (async () => {
      bumpProgress(15);

      if (!user) {
        setRole('guest');
        bumpProgress(100);
        window.clearTimeout(timeoutId);
        dismiss();
        return;
      }

      const isAdmin = user.email?.toLowerCase() === ADMIN_EMAIL;

      const [profileResult, driverResult] = await Promise.allSettled([
        supabase.from('profiles').select('full_name, avatar_url, gender, phone').eq('user_id', user.id).maybeSingle(),
        isAdmin ? Promise.resolve({ data: null }) : supabase.from('drivers').select('*').eq('user_id', user.id).maybeSingle(),
      ]);
      bumpProgress(45);

      if (profileResult.status === 'fulfilled') {
        setProfile((profileResult.value.data as CachedProfile) ?? null);
      }
      let isDriver = false;
      if (driverResult.status === 'fulfilled' && driverResult.value.data) {
        setDriverProfile(driverResult.value.data as CachedDriverProfile);
        isDriver = true;
      }
      setRole(isAdmin ? 'admin' : isDriver ? 'driver' : 'rider');
      bumpProgress(60);

      // Non-blocking-priority data — still awaited so the splash timeout is
      // the only thing that can cut it short, not an arbitrary race.
      await Promise.allSettled([
        fetchFavorites(user.id).then(() => bumpProgress(75)),
        fetchRecentRides(user.id).then(() => bumpProgress(85)),
        preloadAllTownPricing().then(() => bumpProgress(93)).catch(() => {}),
        loadMapbox().then(() => bumpProgress(98)).catch(() => {}),
      ]);

      bumpProgress(100);
      window.clearTimeout(timeoutId);
      dismiss();
    })();

    return () => window.clearTimeout(timeoutId);
  }, [authLoading, user, bumpProgress, fetchFavorites, fetchRecentRides]);

  const refreshFavorites = useCallback(async () => {
    if (user) await fetchFavorites(user.id);
  }, [user, fetchFavorites]);

  const refreshRecentRides = useCallback(async () => {
    if (user) await fetchRecentRides(user.id);
  }, [user, fetchRecentRides]);

  const refreshDriverProfile = useCallback(async () => {
    if (user) await fetchDriverProfile(user.id);
  }, [user, fetchDriverProfile]);

  return (
    <AppBootstrapContext.Provider
      value={{
        ready,
        progress,
        role,
        profile,
        driverProfile,
        favorites,
        recentRides,
        refreshFavorites,
        refreshRecentRides,
        refreshDriverProfile,
      }}
    >
      {children}
    </AppBootstrapContext.Provider>
  );
}

export function useAppBootstrap() {
  const ctx = useContext(AppBootstrapContext);
  if (ctx === undefined) throw new Error('useAppBootstrap must be used within an AppBootstrapProvider');
  return ctx;
}
