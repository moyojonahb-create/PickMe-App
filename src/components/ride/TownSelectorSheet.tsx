import { useState } from 'react';
import { MapPin, ChevronDown, Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { TOWNS, type TownConfig } from '@/lib/towns';

interface TownSelectorSheetProps {
  currentTown: TownConfig;
  onSelect: (town: TownConfig) => void;
}

export default function TownSelectorSheet({ currentTown, onSelect }: TownSelectorSheetProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  const filtered = search.trim()
    ? TOWNS.filter(t => t.name.toLowerCase().includes(search.toLowerCase()))
    : TOWNS;

  const handleSelect = (town: TownConfig) => {
    onSelect(town);
    setOpen(false);
    setSearch('');
  };

  return (
    <>
      {/* Trigger button — glass pill per the /ride redesign spec */}
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 shrink-0 active:scale-95 transition-transform"
        style={{
          height: 38,
          padding: '0 12px',
          borderRadius: 999,
          background: 'rgba(255,255,255,.62)',
          backdropFilter: 'blur(20px) saturate(180%)',
          WebkitBackdropFilter: 'blur(20px) saturate(180%)',
          boxShadow: 'inset 0 .5px 0 rgba(255,255,255,.9), inset 0 0 0 .5px rgba(255,255,255,.6), 0 6px 14px rgba(0,0,0,.06)',
        }}
      >
        <MapPin className="w-3.5 h-3.5" fill="currentColor" style={{ color: '#B81104' }} />
        <span className="text-[12.5px] font-semibold" style={{ color: '#111111' }}>{currentTown.name}</span>
        <ChevronDown className="w-3.5 h-3.5" style={{ color: '#666666' }} />
      </button>

      {/* Sheet overlay */}
      {open && (
        <div className="fixed inset-0 z-[70] flex flex-col justify-end animate-fade-in" onClick={() => setOpen(false)}>
          {/* Backdrop - fully opaque to hide content behind */}
          <div className="absolute inset-0 bg-background/80 backdrop-blur-md" />

          {/* Sheet content */}
          <div
            className="relative glass-card-heavy animate-slide-up overflow-hidden"
            style={{ borderTopLeftRadius: 28, borderTopRightRadius: 28, borderBottomLeftRadius: 0, borderBottomRightRadius: 0, maxHeight: '70vh', paddingBottom: 'calc(env(safe-area-inset-bottom) + 16px)' }}
            onClick={e => e.stopPropagation()}
          >
            {/* Handle + header */}
            <div className="sticky top-0 z-10 pt-3.5 pb-3 px-5" style={{ borderTopLeftRadius: 28, borderTopRightRadius: 28, background: 'var(--gradient-primary)' }}>
              <div className="w-10 h-1 rounded-full bg-primary-foreground/40 mx-auto mb-4" />
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold font-display text-primary-foreground">Select Town</h2>
                <button onClick={() => setOpen(false)} className="w-9 h-9 rounded-full flex items-center justify-center bg-primary-foreground/15 active:scale-90 transition-all">
                  <X className="w-4 h-4 text-primary-foreground" />
                </button>
              </div>
            </div>

            {/* Search */}
            <div className="px-5 pt-4 pb-2">
              <div className="relative">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4.5 h-4.5 text-muted-foreground pointer-events-none" />
                <input
                  type="text"
                  placeholder="Search towns…"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="w-full h-11 pl-10 pr-4 glass-card text-[15px] font-medium text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/25 border-0"
                  style={{ borderRadius: 16 }}
                />
              </div>
            </div>

            {/* Town list */}
            <div className="overflow-y-auto px-3 pb-2" style={{ maxHeight: 'calc(70vh - 160px)' }}>
              {filtered.length === 0 && (
                <div className="text-center py-10 text-muted-foreground">
                  <p className="text-sm">No towns found</p>
                </div>
              )}
              {filtered.map(town => {
                const isActive = town.id === currentTown.id;
                return (
                  <button
                    key={town.id}
                    onClick={() => handleSelect(town)}
                    className={cn(
                      'w-full flex items-center gap-3.5 px-4 py-3.5 rounded-2xl transition-all active:scale-[0.98] text-left mb-1',
                      isActive ? 'bg-primary/8 glass-glow-blue' : 'hover:bg-foreground/[0.03]'
                    )}
                  >
                    <div className={cn(
                      'w-10 h-10 rounded-xl flex items-center justify-center shrink-0',
                      isActive ? '' : 'bg-muted'
                    )} style={isActive ? { background: 'var(--gradient-primary)' } : undefined}>
                      <MapPin className={cn('w-5 h-5', isActive ? 'text-primary-foreground' : 'text-muted-foreground')} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={cn('text-[15px] font-medium', isActive ? 'text-primary' : 'text-foreground')}>{town.name}</p>
                      <p className="text-xs text-muted-foreground">{town.quickPicks.length} locations · {town.radiusKm}km area</p>
                    </div>
                    {isActive && <div className="w-2 h-2 rounded-full bg-primary shrink-0" />}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
