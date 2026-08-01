import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Clock, Loader2, MapPin, Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface AutocompleteLocation {
  name: string;
  lat: number;
  lng: number;
}

interface DropoffAutocompleteProps {
  value: AutocompleteLocation | null;
  center: { lat: number; lng: number };
  townName: string;
  onSelect: (loc: AutocompleteLocation) => void;
  onClear: () => void;
  /** Opens the full search experience */
  onBrowseAll?: () => void;
}

/** Mocked place catalogue — offsets are applied to the active town centre */
const MOCK_PLACES: { name: string; area: string; dLat: number; dLng: number; recent?: boolean }[] = [
  { name: 'City Centre', area: 'Central business district', dLat: 0.002, dLng: 0.003, recent: true },
  { name: 'Main Bus Terminus', area: 'Transport hub', dLat: -0.006, dLng: 0.004, recent: true },
  { name: 'Central Hospital', area: 'Hospital Rd', dLat: 0.009, dLng: -0.005 },
  { name: 'Sunnyside Shopping Mall', area: 'Sunnyside', dLat: -0.012, dLng: 0.011 },
  { name: 'Inness Road', area: 'Sunnyside', dLat: 0.004, dLng: 0.014 },
  { name: 'University Campus', area: 'Mount Pleasant', dLat: 0.021, dLng: -0.008 },
  { name: 'Airport Terminal', area: 'Airport Rd', dLat: -0.034, dLng: 0.041 },
  { name: 'Sports Stadium', area: 'Showgrounds', dLat: 0.015, dLng: 0.019 },
  { name: 'Riverside Lodge', area: 'Riverside', dLat: -0.018, dLng: -0.013 },
  { name: 'Industrial Park', area: 'Light industry', dLat: -0.024, dLng: 0.006 },
];

export default function DropoffAutocomplete({
  value,
  center,
  townName,
  onSelect,
  onClear,
  onBrowseAll,
}: DropoffAutocompleteProps) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Simulated network latency for the mocked provider
  useEffect(() => {
    if (!open) return;
    setSearching(true);
    const t = setTimeout(() => setSearching(false), query.trim() ? 260 : 120);
    return () => clearTimeout(t);
  }, [query, open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const suggestions = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? MOCK_PLACES.filter((p) => `${p.name} ${p.area}`.toLowerCase().includes(q))
      : MOCK_PLACES.slice(0, 6);
    return list.map((p) => ({
      ...p,
      lat: center.lat + p.dLat,
      lng: center.lng + p.dLng,
      distance: Math.round((Math.abs(p.dLat) + Math.abs(p.dLng)) * 111 * 10) / 10,
    }));
  }, [query, center]);

  return (
    <div ref={wrapRef} className="relative">
      <div
        className={cn(
          'w-full min-h-[62px] flex items-center gap-3 px-3 py-3 rounded-2xl glass-card transition-all',
          open && 'ring-2 ring-primary/25'
        )}
      >
        <div
          className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
          style={{ background: 'var(--gradient-primary)' }}
        >
          <MapPin className="w-4 h-4 text-primary-foreground" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-semibold text-primary uppercase tracking-widest">Drop-off</p>
          <input
            type="text"
            value={open ? query : value?.name ?? ''}
            placeholder="Where to?"
            onFocus={() => setOpen(true)}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            className="w-full bg-transparent border-0 p-0 text-[14px] font-medium text-foreground placeholder:text-muted-foreground focus:outline-none"
          />
        </div>
        {(value || query) && (
          <button
            type="button"
            aria-label="Clear drop-off"
            onClick={() => {
              setQuery('');
              onClear();
            }}
            className="p-1.5 hover:bg-foreground/5 rounded-full"
          >
            <X className="w-3.5 h-3.5 text-muted-foreground" />
          </button>
        )}
      </div>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 420, damping: 32, mass: 0.6 }}
            className="absolute left-0 right-0 top-[calc(100%+8px)] z-50 overflow-hidden rounded-2xl glass-card-heavy shadow-xl"
            style={{ transformOrigin: 'top center' }}
          >
            <div className="px-4 py-2 border-b border-border/20 flex items-center gap-2">
              {searching ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />
              ) : (
                <Search className="w-3.5 h-3.5 text-muted-foreground" />
              )}
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest">
                {searching ? 'Searching…' : `Suggestions in ${townName}`}
              </p>
            </div>

            <div className="max-h-[290px] overflow-y-auto">
              {searching ? (
                <div className="p-3 space-y-3">
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="flex items-center gap-3 animate-pulse">
                      <div className="w-9 h-9 rounded-xl bg-foreground/10" />
                      <div className="flex-1 space-y-1.5">
                        <div className="h-3 w-1/2 rounded bg-foreground/10" />
                        <div className="h-2.5 w-1/3 rounded bg-foreground/5" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : suggestions.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">No matches for “{query}”</p>
              ) : (
                suggestions.map((s, i) => (
                  <motion.button
                    key={s.name}
                    type="button"
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.02 + i * 0.028, duration: 0.18, ease: 'easeOut' }}
                    onClick={() => {
                      onSelect({ name: s.name, lat: s.lat, lng: s.lng });
                      setQuery('');
                      setOpen(false);
                    }}
                    className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-primary/5 active:bg-primary/10 transition-colors border-b border-border/10 last:border-0"
                  >
                    <div className="w-9 h-9 rounded-xl glass-card flex items-center justify-center shrink-0">
                      {s.recent ? (
                        <Clock className="w-4 h-4 text-muted-foreground" />
                      ) : (
                        <MapPin className="w-4 h-4 text-primary" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground truncate">{s.name}</p>
                      <p className="text-xs text-muted-foreground truncate">{s.area}</p>
                    </div>
                    <span className="text-[11px] text-muted-foreground tabular-nums shrink-0">{s.distance} km</span>
                  </motion.button>
                ))
              )}
            </div>

            {onBrowseAll && (
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  onBrowseAll();
                }}
                className="w-full px-4 py-3 text-[13px] font-semibold text-primary hover:bg-primary/5 transition-colors border-t border-border/20"
              >
                Search all places
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
