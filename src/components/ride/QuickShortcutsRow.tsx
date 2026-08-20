import { useEffect, useState, type CSSProperties, type ComponentType } from 'react';
import { motion } from 'framer-motion';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/hooks/useAuth';
import { Home, Briefcase, Star, Plus, type LucideProps } from 'lucide-react';
import { RIDE_TEXT, RIDE_TEXT_2, tintYellow } from './rideGlass';

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
  /** Unset Home/Work chip, or the trailing Add chip, was tapped — caller opens
   * the address picker and saves whatever's chosen under this key. */
  onRequestSet: (key: 'home' | 'work' | 'custom') => void;
}

const setGlass: CSSProperties = {
  ...tintYellow,
  boxShadow: 'inset 0 .75px 0 rgba(255,255,255,.9), inset 0 0 0 .5px rgba(255,221,0,.5)',
};

const neutralGlass: CSSProperties = {
  background: 'linear-gradient(160deg, rgba(255,255,255,.8), rgba(255,255,255,.48))',
  boxShadow: 'inset 0 .75px 0 rgba(255,255,255,.98), inset 0 0 0 .5px rgba(255,255,255,.6)',
  backdropFilter: 'blur(18px) saturate(180%)',
  WebkitBackdropFilter: 'blur(18px) saturate(180%)',
};

interface Chip {
  key: string;
  label: string;
  Icon: ComponentType<LucideProps>;
  set: boolean;
  onClick: () => void;
}

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

  if (loading) {
    return (
      <div className="flex gap-2">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-[34px] w-24 rounded-full bg-muted/50 animate-pulse" />
        ))}
      </div>
    );
  }

  const homeFav = places.find((p) => (p.icon?.toLowerCase() ?? '') === 'home');
  const workFav = places.find((p) => (p.icon?.toLowerCase() ?? '') === 'work');
  const others = places.filter((p) => p.id !== homeFav?.id && p.id !== workFav?.id);

  const chips: Chip[] = [
    {
      key: 'home',
      label: homeFav ? homeFav.name : 'Home · tap to set',
      Icon: Home,
      set: !!homeFav,
      onClick: () => homeFav
        ? onSelect({ name: homeFav.name, lat: homeFav.latitude, lng: homeFav.longitude })
        : onRequestSet('home'),
    },
    {
      key: 'work',
      label: workFav ? workFav.name : 'Work · tap to set',
      Icon: Briefcase,
      set: !!workFav,
      onClick: () => workFav
        ? onSelect({ name: workFav.name, lat: workFav.latitude, lng: workFav.longitude })
        : onRequestSet('work'),
    },
    ...others.map((fav): Chip => ({
      key: fav.id,
      label: fav.name,
      Icon: Star,
      set: true,
      onClick: () => onSelect({ name: fav.name, lat: fav.latitude, lng: fav.longitude }),
    })),
    {
      key: 'add',
      label: 'Add',
      Icon: Plus,
      set: false,
      onClick: () => onRequestSet('custom'),
    },
  ];

  return (
    <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
      {chips.map((chip, i) => (
        <motion.button
          key={chip.key}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.03 }}
          onClick={chip.onClick}
          className="shrink-0 inline-flex items-center gap-1.5 px-3 rounded-full active:scale-95 transition-transform"
          style={{ height: 34, ...(chip.set ? setGlass : neutralGlass) }}
        >
          <chip.Icon className="w-3.5 h-3.5 shrink-0" style={{ color: chip.set ? RIDE_TEXT : RIDE_TEXT_2 }} />
          <span className="text-[12px] font-semibold whitespace-nowrap" style={{ color: RIDE_TEXT }}>
            {chip.label}
          </span>
        </motion.button>
      ))}
    </div>
  );
}
