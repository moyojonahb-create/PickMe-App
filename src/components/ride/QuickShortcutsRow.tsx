import { useEffect, useState, type CSSProperties } from 'react';
import { motion } from 'framer-motion';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/hooks/useAuth';
import { Home, Briefcase } from 'lucide-react';
import { RIDE_RED, RIDE_TEXT, tintYellow } from './rideGlass';

interface QuickPlace {
  id: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  icon: string | null;
}

interface QuickShortcutsRowProps {
  onSelect: (place: { name: string; lat: number; lng: number }) => void;
  /** An unset Home/Work tile was tapped — caller opens the address picker
   * and saves whatever's chosen under this key. */
  onRequestSet: (key: 'home' | 'work') => void;
}

const homeGlass: CSSProperties = {
  background: 'linear-gradient(135deg, rgba(255,241,240,.9), rgba(184,17,4,.06))',
  boxShadow: 'inset 0 .75px 0 rgba(255,255,255,.9), inset 0 0 0 .5px rgba(184,17,4,.12)',
  backdropFilter: 'blur(18px) saturate(180%)',
  WebkitBackdropFilter: 'blur(18px) saturate(180%)',
};

const workGlass: CSSProperties = {
  ...tintYellow,
  boxShadow: 'inset 0 .75px 0 rgba(255,255,255,.9), inset 0 0 0 .5px rgba(255,221,0,.5)',
};

/** Row 2's two square tiles, alongside the Where-to card from RideHomeGreeting.
 * Home and Work always keep their own tint (pink / yellow) regardless of
 * whether the rider has saved an address for them yet. */
export default function QuickShortcutsRow({ onSelect, onRequestSet }: QuickShortcutsRowProps) {
  const { user } = useAuth();
  const [places, setPlaces] = useState<QuickPlace[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) { setPlaces([]); setLoading(false); return; }
    let cancelled = false;
    supabase
      .from('favorite_locations')
      .select('id, name, address, latitude, longitude, icon')
      .eq('user_id', user.id)
      .order('created_at', { ascending: true })
      .limit(6)
      .then(({ data }) => {
        if (cancelled) return;
        setPlaces(data ?? []);
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [user]);

  const homeFav = places.find((p) => (p.icon?.toLowerCase() ?? '') === 'home');
  const workFav = places.find((p) => (p.icon?.toLowerCase() ?? '') === 'work');

  const tiles = [
    { key: 'home', label: 'Home', Icon: Home, glass: homeGlass, fav: homeFav },
    { key: 'work', label: 'Work', Icon: Briefcase, glass: workGlass, fav: workFav },
  ] as const;

  // Fragment, not a wrapping div — these render as direct flex items inside
  // RideView's row-2 flex row, alongside RideHomeGreeting's card.
  return (
    <>
      {tiles.map((tile, i) => (
        <motion.button
          key={tile.key}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.04 }}
          disabled={loading}
          onClick={() => tile.fav
            ? onSelect({ name: tile.fav.name, lat: tile.fav.latitude, lng: tile.fav.longitude })
            : onRequestSet(tile.key)}
          className="shrink-0 flex flex-col items-center justify-center gap-1 rounded-2xl active:scale-95 transition-transform disabled:opacity-60"
          style={{ width: 58, height: 62, padding: 0, ...tile.glass }}
        >
          <tile.Icon className="w-5 h-5" style={{ color: RIDE_RED }} />
          <span className="text-[11px] font-semibold" style={{ color: RIDE_TEXT }}>{tile.label}</span>
        </motion.button>
      ))}
    </>
  );
}
