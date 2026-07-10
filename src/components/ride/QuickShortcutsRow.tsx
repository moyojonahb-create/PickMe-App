import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/hooks/useAuth';
import { Home, Briefcase, Plane, Star } from 'lucide-react';

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
}

const ICONS: Record<string, typeof Home> = {
  home: Home,
  work: Briefcase,
  airport: Plane,
};

export default function QuickShortcutsRow({ onSelect }: QuickShortcutsRowProps) {
  const { user } = useAuth();
  const [places, setPlaces] = useState<QuickPlace[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) { setLoading(false); return; }
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
          <div key={i} className="h-[76px] w-[76px] rounded-2xl bg-muted/50 animate-pulse" />
        ))}
      </div>
    );
  }

  if (places.length === 0) return null;

  return (
    <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
      {places.map((place, i) => {
        const Icon = ICONS[place.icon?.toLowerCase() ?? ''] ?? Star;
        return (
          <motion.button
            key={place.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.04 }}
            onClick={() => onSelect({ name: place.name, lat: place.latitude, lng: place.longitude })}
            className="shrink-0 w-[76px] flex flex-col items-center gap-1.5 py-3 rounded-2xl glass-card active:scale-95 transition-transform"
          >
            <div className="w-9 h-9 rounded-full flex items-center justify-center bg-primary/10">
              <Icon className="w-4 h-4 text-primary" />
            </div>
            <span className="text-[11px] font-medium text-foreground truncate max-w-[68px]">{place.name}</span>
          </motion.button>
        );
      })}
    </div>
  );
}
