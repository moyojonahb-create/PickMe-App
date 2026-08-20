/* eslint-disable react-hooks/exhaustive-deps */
import { useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  ArrowLeft, Briefcase, Clock, Crosshair, Home, Loader2, Map as MapIcon, MapPin, X,
} from 'lucide-react';
import { useAppBootstrap } from '@/hooks/useAppBootstrap';
import { cn } from '@/lib/utils';

export interface SearchPlace {
  name: string;
  lat: number;
  lng: number;
  secondary?: string;
}

export interface SearchResultRow {
  id: string;
  name: string;
  secondary?: string;
  onSelect: () => void;
  /** Where this result came from — dev-only, shown as a debug badge to gauge whether Google is adding value over our own data. */
  source?: 'landmark' | 'street' | 'cache' | 'google' | 'nominatim';
}

interface DestinationSearchScreenProps {
  activeField: 'pickup' | 'dropoff';
  onActiveFieldChange: (field: 'pickup' | 'dropoff') => void;
  pickupName: string;
  dropoffName: string;
  query: string;
  onQueryChange: (value: string) => void;
  onClose: () => void;
  onUseMyLocation: () => void;
  gpsLoading?: boolean;
  onChooseOnMap: () => void;
  onSelectPlace: (place: SearchPlace) => void;
  results: SearchResultRow[];
  loading?: boolean;
  /** Set while the rider is picking an address to save as Home/Work (tapped
   * the shortcut before one was ever saved) — see RideView.tsx's
   * saveFavoriteIfSetting, which every selection path funnels through. */
  settingFavorite?: 'home' | 'work' | null;
  onRequestSetFavorite: (key: 'home' | 'work') => void;
}

interface FavoritePlace {
  id: string;
  name: string;
  address: string | null;
  latitude: number;
  longitude: number;
  icon: string | null;
}

export default function DestinationSearchScreen({
  activeField,
  onActiveFieldChange,
  pickupName,
  dropoffName,
  query,
  onQueryChange,
  onClose,
  onUseMyLocation,
  gpsLoading,
  onChooseOnMap,
  onSelectPlace,
  results,
  loading,
  settingFavorite,
  onRequestSetFavorite,
}: DestinationSearchScreenProps) {
  // Favorites and recent rides come from the splash-time cache — no
  // per-mount Supabase query needed (see useAppBootstrap).
  const { favorites: allFavorites, recentRides } = useAppBootstrap();
  const favorites = useMemo(() => allFavorites.slice(0, 10) as FavoritePlace[], [allFavorites]);

  const recents = useMemo(() => {
    const seen = new Map<string, SearchPlace>();
    for (const ride of recentRides) {
      const name = activeField === 'pickup' ? ride.pickup_address : ride.dropoff_address;
      const lat = activeField === 'pickup' ? ride.pickup_lat : ride.dropoff_lat;
      const lng = activeField === 'pickup' ? ride.pickup_lon : ride.dropoff_lon;
      if (!name || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      if (!seen.has(name)) {
        const parts = name.split(',').map((p) => p.trim()).filter(Boolean);
        seen.set(name, { name: parts[0] || name, lat: lat as number, lng: lng as number, secondary: parts.slice(1).join(', ') || undefined });
      }
    }
    return Array.from(seen.values()).slice(0, 12);
  }, [recentRides, activeField]);

  const findFavorite = (key: string) =>
    favorites.find((f) => (f.icon || f.name).toLowerCase().includes(key));

  const savedShortcuts: { key: string; label: string; icon: typeof Home }[] = [
    { key: 'home', label: 'Home', icon: Home },
    { key: 'work', label: 'Work', icon: Briefcase },
  ];

  const searching = query.trim().length >= 3;

  const fieldRow = (field: 'pickup' | 'dropoff') => {
    const isActive = activeField === field;
    const value = field === 'pickup' ? pickupName : dropoffName;
    const placeholder = field === 'pickup' ? 'Search pickup' : 'Search destination';

    return (
      <button
        type="button"
        onClick={() => !isActive && onActiveFieldChange(field)}
        className={cn(
          'w-full flex items-center gap-3 px-3.5 py-3 text-left',
          field === 'pickup' && 'border-b border-border/60'
        )}
      >
        {field === 'pickup' ? (
          <span className="w-2.5 h-2.5 rounded-full bg-accent ring-[3px] ring-accent/20 shrink-0" />
        ) : (
          <span className="w-2.5 h-2.5 rounded-[3px] bg-primary ring-[3px] ring-primary/15 shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          {isActive ? (
            <input
              autoFocus
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              placeholder={value || placeholder}
              className="w-full bg-transparent text-[15px] font-medium text-foreground placeholder:text-muted-foreground focus:outline-none"
            />
          ) : (
            <p className={cn('text-[15px] font-medium truncate', value ? 'text-foreground' : 'text-muted-foreground')}>
              {value || placeholder}
            </p>
          )}
        </div>
        {isActive && query.length > 0 && (
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => { e.stopPropagation(); onQueryChange(''); }}
            className="p-1 rounded-full hover:bg-foreground/5"
          >
            <X className="w-3.5 h-3.5 text-muted-foreground" />
          </span>
        )}
      </button>
    );
  };

  const optionRow = (
    key: string,
    icon: React.ReactNode,
    title: string,
    subtitle: string | undefined,
    onClick: () => void
  ) => (
    <button
      key={key}
      type="button"
      onClick={onClick}
      className="w-full flex items-center gap-3.5 px-4 py-3 text-left active:bg-muted/60 hover:bg-muted/40 transition-colors"
    >
      {icon}
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-medium text-foreground truncate">{title}</p>
        {subtitle && <p className="text-[12px] text-muted-foreground truncate">{subtitle}</p>}
      </div>
    </button>
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="fixed inset-0 z-[70] flex flex-col bg-background"
    >
      {/* Blue header */}
      <div className="bg-primary px-4 pb-4" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 12px)' }}>
        <div className="flex items-center gap-2 mb-3">
          <button
            onClick={onClose}
            aria-label="Back"
            className="w-9 h-9 -ml-1 rounded-full flex items-center justify-center active:scale-90 transition-transform"
          >
            <ArrowLeft className="w-5 h-5 text-primary-foreground" />
          </button>
          <h1 className="text-[16px] font-semibold text-primary-foreground">
            {settingFavorite
              ? `Search for your ${settingFavorite === 'home' ? 'Home' : 'Work'} address`
              : activeField === 'pickup' ? 'Set pickup' : 'Set destination'}
          </h1>
        </div>

        <div className="rounded-2xl bg-card shadow-lg overflow-hidden">
          {fieldRow('pickup')}
          {fieldRow('dropoff')}
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto overscroll-contain bg-background pb-8">
        {!searching && (
          <div className="pt-2">
            {activeField === 'pickup' &&
              optionRow(
                'gps',
                <span className="w-10 h-10 rounded-2xl bg-primary flex items-center justify-center shrink-0">
                  {gpsLoading ? (
                    <Loader2 className="w-5 h-5 animate-spin text-accent" />
                  ) : (
                    <Crosshair className="w-5 h-5 text-accent" />
                  )}
                </span>,
                'Use my current location',
                'Detect pickup automatically',
                onUseMyLocation
              )}

            {optionRow(
              'map',
              <span className="w-10 h-10 rounded-2xl bg-primary/10 flex items-center justify-center shrink-0">
                <MapIcon className="w-5 h-5 text-primary" />
              </span>,
              'Choose on map',
              'Drop a pin exactly where you want',
              onChooseOnMap
            )}

            <div className="h-2 bg-muted/40 my-1" />

            {savedShortcuts.map(({ key, label, icon: Icon }) => {
              const fav = findFavorite(key);
              return optionRow(
                key,
                <span className="w-10 h-10 rounded-2xl bg-accent/20 flex items-center justify-center shrink-0">
                  <Icon className="w-5 h-5 text-primary" />
                </span>,
                label,
                fav ? fav.address || fav.name : 'Tap to set this address',
                () => {
                  if (fav) onSelectPlace({ name: fav.name, lat: fav.latitude, lng: fav.longitude });
                  else onRequestSetFavorite(key as 'home' | 'work');
                }
              );
            })}

            {recents.length > 0 && (
              <>
                <div className="h-2 bg-muted/40 my-1" />
                <p className="px-4 pt-2 pb-1 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
                  Recent
                </p>
                {recents.map((place, i) =>
                  optionRow(
                    `recent-${i}`,
                    <span className="w-10 h-10 rounded-2xl bg-muted flex items-center justify-center shrink-0">
                      <Clock className="w-5 h-5 text-muted-foreground" />
                    </span>,
                    place.name,
                    place.secondary,
                    () => onSelectPlace(place)
                  )
                )}
              </>
            )}
          </div>
        )}

        {searching && (
          <div className="pt-1">
            {loading && results.length === 0 && (
              <div className="flex items-center justify-center gap-2 py-10 text-muted-foreground">
                <Loader2 className="w-5 h-5 animate-spin" />
                <span className="text-sm">Searching places…</span>
              </div>
            )}
            {results.map((row) =>
              optionRow(
                row.id,
                <span className="w-10 h-10 rounded-2xl bg-primary/10 flex items-center justify-center shrink-0">
                  <MapPin className="w-5 h-5 text-primary" />
                </span>,
                row.name,
                row.secondary,
                row.onSelect
              )
            )}
            {!loading && results.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-10">No results for “{query}”</p>
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
}
