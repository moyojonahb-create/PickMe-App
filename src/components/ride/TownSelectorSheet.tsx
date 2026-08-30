import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MapPin, ChevronDown, Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { TOWNS, type TownConfig } from '@/lib/towns';

interface TownSelectorSheetProps {
  currentTown: TownConfig;
  onSelect: (town: TownConfig) => void;
}

interface Position {
  left: number;
  top: number;
  width: number;
  minWidth: number;
}

export default function TownSelectorSheet({ currentTown, onSelect }: TownSelectorSheetProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [pos, setPos] = useState<Position | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const filtered = search.trim()
    ? TOWNS.filter(t => t.name.toLowerCase().includes(search.toLowerCase()))
    : TOWNS;

  const measure = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setPos({
      left: rect.left,
      top: rect.top,
      width: rect.width,
      minWidth: Math.max(rect.width, 320),
    });
  };

  const handleOpen = () => {
    measure();
    setOpen(true);
  };

  const handleSelect = (town: TownConfig) => {
    onSelect(town);
    setOpen(false);
    setSearch('');
  };

  useEffect(() => {
    if (!open) return;
    const onResize = () => measure();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [open]);

  return (
    <>
      {/* Trigger button — glass pill per the /ride redesign spec */}
      <button
        ref={triggerRef}
        onClick={handleOpen}
        className="inline-flex items-center gap-1.5 shrink-0 active:scale-95 transition-transform"
        style={{
          height: 36,
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

      {/* Popover anchored to the trigger button — pops upward from where the
          town selector sits instead of sliding down from the top of the screen. */}
      {open &&
        createPortal(
          <div className="fixed inset-0 z-[70] animate-fade-in" onClick={() => setOpen(false)}>
            <div className="absolute inset-0 bg-foreground/10 backdrop-blur-sm" />

            <div
              className="absolute z-10 glass-card-heavy overflow-hidden flex flex-col"
              style={{
                left: Math.max(12, Math.min(pos?.left ?? 12, (typeof window !== 'undefined' ? window.innerWidth : 0) - (pos?.minWidth ?? 320) - 12)),
                bottom: (typeof window !== 'undefined' ? window.innerHeight : 0) - (pos?.top ?? 0) + 8,
                width: 'auto',
                minWidth: pos?.minWidth ?? 320,
                maxWidth: 'calc(100vw - 24px)',
                maxHeight: 'min(420px, calc(100dvh - env(safe-area-inset-top) - 24px))',
                borderRadius: 22,
                boxShadow: '0 20px 50px rgba(0,0,0,.18), 0 8px 20px rgba(0,0,0,.12)',
              }}
              onClick={e => e.stopPropagation()}
            >
              {/* Header */}
              <div className="shrink-0 pb-3 px-4 pt-4" style={{ background: 'var(--gradient-primary)' }}>
                <div className="flex items-center justify-between">
                  <h2 className="text-base font-semibold font-display text-primary-foreground">Select Town</h2>
                  <button onClick={() => setOpen(false)} className="w-8 h-8 rounded-full flex items-center justify-center bg-primary-foreground/15 active:scale-90 transition-all">
                    <X className="w-4 h-4 text-primary-foreground" />
                  </button>
                </div>
              </div>

              {/* Search */}
              <div className="shrink-0 px-4 pt-3 pb-2">
                <div className="relative">
                  <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                  <input
                    type="text"
                    placeholder="Search towns…"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    autoFocus
                    className="w-full h-10 pl-9 pr-4 glass-card text-[14px] font-medium text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/25 border-0"
                    style={{ borderRadius: 14 }}
                  />
                </div>
              </div>

              {/* Town list */}
              <div className="flex-1 min-h-0 overflow-y-auto px-2 pb-2">
                {filtered.length === 0 && (
                  <div className="text-center py-8 text-muted-foreground">
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
                        'w-full flex items-center gap-3 px-3 py-3 rounded-xl transition-all active:scale-[0.98] text-left mb-1',
                        isActive ? 'bg-primary/8 glass-glow-brand' : 'hover:bg-foreground/[0.03]'
                      )}
                    >
                      <div className={cn(
                        'w-9 h-9 rounded-lg flex items-center justify-center shrink-0',
                        isActive ? '' : 'bg-muted'
                      )} style={isActive ? { background: 'var(--gradient-primary)' } : undefined}>
                        <MapPin className={cn('w-4 h-4', isActive ? 'text-primary-foreground' : 'text-muted-foreground')} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className={cn('text-[14px] font-medium', isActive ? 'text-primary' : 'text-foreground')}>{town.name}</p>
                        <p className="text-[11px] text-muted-foreground">{town.quickPicks.length} locations · {town.radiusKm}km area</p>
                      </div>
                      {isActive && <div className="w-2 h-2 rounded-full bg-primary shrink-0" />}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}

