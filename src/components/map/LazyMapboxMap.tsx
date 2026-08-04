import { lazy, Suspense, type ComponentProps } from 'react';
import type MapboxMapComponent from '@/components/MapboxMap';

const MapboxMap = lazy(() => import('@/components/MapboxMap'));

type MapboxMapProps = ComponentProps<typeof MapboxMapComponent>;

/**
 * Lightweight stand-in shown while the map chunk (and Mapbox GL JS) load.
 * Purely visual — mimics a muted map canvas so the booking sheet can paint
 * immediately without waiting on the map.
 */
function MapPlaceholder({ className, height }: { className?: string; height?: string | number }) {
  return (
    <div
      className={className}
      style={{ height: height ?? '100%' }}
      aria-hidden="true"
    >
      <div className="relative w-full h-full overflow-hidden bg-muted/50">
        <div
          className="absolute inset-0 opacity-[0.35]"
          style={{
            backgroundImage:
              'linear-gradient(hsl(var(--border)) 1px, transparent 1px), linear-gradient(90deg, hsl(var(--border)) 1px, transparent 1px)',
            backgroundSize: '48px 48px',
          }}
        />
        <div className="absolute inset-0 animate-pulse bg-gradient-to-b from-transparent via-background/20 to-background/40" />
      </div>
    </div>
  );
}

/**
 * Drop-in replacement for `<MapboxMap />` that code-splits the map (and the
 * Mapbox GL loader) out of the screen's chunk. Same props, same behaviour.
 */
export default function LazyMapboxMap(props: MapboxMapProps) {
  return (
    <Suspense fallback={<MapPlaceholder className={props.className} height={props.height} />}>
      <MapboxMap {...props} />
    </Suspense>
  );
}
