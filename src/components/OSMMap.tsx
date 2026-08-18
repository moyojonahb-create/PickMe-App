/* eslint-disable react-hooks/exhaustive-deps */
import { useEffect, useRef, useState, useCallback, forwardRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Crosshair, RefreshCw, AlertTriangle } from 'lucide-react';
import { DEFAULT_TOWN, detectTown, TownConfig } from '@/lib/towns';

// Fix default marker icons for Leaflet in React
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';

// Fix Leaflet's default icon paths
delete ((L.Icon.Default.prototype as unknown as Record<string, unknown>))._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
});

interface Coordinates {
  lat: number;
  lng: number;
}

interface OSMMapProps {
  center?: Coordinates;
  zoom?: number;
  pickup?: Coordinates | null;
  dropoff?: Coordinates | null;
  routeGeometry?: string | null;
  driverLocation?: Coordinates | null;
  onMapClick?: (coords: Coordinates) => void;
  className?: string;
  height?: string;
  showRecenterButton?: boolean;
}

// Custom marker icons - Yellow Pickup with Black Pin, Blue Dropoff with Arrow
const pickupIcon = L.divIcon({
  html: `
    <div class="flex flex-col items-center">
      <div class="w-10 h-10 rounded-full bg-amber-400 border-4 border-white shadow-lg flex items-center justify-center">
        <svg class="w-5 h-5 text-black" fill="currentColor" viewBox="0 0 24 24">
          <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
        </svg>
      </div>
      <span class="mt-1 px-2 py-0.5 bg-amber-400 text-black text-xs font-bold rounded shadow">Pickup</span>
    </div>
  `,
  className: 'custom-marker',
  iconSize: [50, 60],
  iconAnchor: [25, 50],
});

const dropoffIcon = L.divIcon({
  html: `
    <div class="flex flex-col items-center">
      <div class="w-10 h-10 rounded-full border-4 border-white shadow-lg flex items-center justify-center" style="background:#B81104">
        <svg class="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24">
          <path d="M12 4l-8 8h5v8h6v-8h5z"/>
        </svg>
      </div>
      <span class="mt-1 px-2 py-0.5 text-white text-xs font-bold rounded shadow" style="background:#B81104">Drop-off</span>
    </div>
  `,
  className: 'custom-marker',
  iconSize: [50, 60],
  iconAnchor: [25, 50],
});

const driverIcon = L.divIcon({
  html: `
    <div class="w-10 h-10 rounded-full bg-primary border-4 border-white shadow-lg flex items-center justify-center animate-pulse">
      <svg class="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24">
        <path d="M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11c-.66 0-1.21.42-1.42 1.01L3 12v8c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h12v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-8l-2.08-5.99zM6.5 16c-.83 0-1.5-.67-1.5-1.5S5.67 13 6.5 13s1.5.67 1.5 1.5S7.33 16 6.5 16zm11 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zM5 11l1.5-4.5h11L19 11H5z"/>
      </svg>
    </div>
  `,
  className: 'custom-marker driver-marker',
  iconSize: [40, 40],
  iconAnchor: [20, 20],
});

// Default center
const DEFAULT_CENTER: Coordinates = { lat: DEFAULT_TOWN.center.lat, lng: DEFAULT_TOWN.center.lng };

// Helper to get bounds from a town config
const getTownBounds = (town: TownConfig): L.LatLngBoundsExpression => [
  [town.bounds.south, town.bounds.west],
  [town.bounds.north, town.bounds.east],
];

// Available tile layers - Humanitarian as default since Gwanda OSM is updated
const TILE_LAYERS = {
  humanitarian: {
    name: 'Humanitarian',
    url: 'https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>, Tiles: HOT',
  },
  osm: {
    name: 'Standard',
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  },
  france: {
    name: 'OSM France',
    url: 'https://{s}.tile.openstreetmap.fr/osmfr/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>, Tiles: OSM France',
  },
};

// Combined bounds covering all towns
const allTownsBounds: L.LatLngBoundsExpression = (() => {
  const allBounds = [DEFAULT_TOWN, ...([{ bounds: { south: -22.28, north: -22.14, west: 29.93, east: 30.05 } }])];
  const south = Math.min(...allBounds.map(t => t.bounds.south));
  const north = Math.max(...allBounds.map(t => t.bounds.north));
  const west = Math.min(...allBounds.map(t => t.bounds.west));
  const east = Math.max(...allBounds.map(t => t.bounds.east));
  return [[south - 0.5, west - 0.5], [north + 0.5, east + 0.5]] as L.LatLngBoundsExpression;
})();

const OSMMap = forwardRef<HTMLDivElement, OSMMapProps>(function OSMMap({
  center = DEFAULT_CENTER,
  zoom = 14,
  pickup,
  dropoff,
  routeGeometry,
  driverLocation,
  onMapClick,
  className = '',
  height = '400px',
  showRecenterButton = true,
}, _ref) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const pickupMarkerRef = useRef<L.Marker | null>(null);
  const dropoffMarkerRef = useRef<L.Marker | null>(null);
  const driverMarkerRef = useRef<L.Marker | null>(null);
  const routeLayerRef = useRef<L.Polyline | null>(null);
  
  const [mapState, setMapState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [isMounted, setIsMounted] = useState(false);

  // Detect current town from center coordinates
  const currentTown = detectTown(center.lat, center.lng);
  const townBounds = getTownBounds(currentTown);

  // Recenter map to current town's service area
  const handleRecenter = useCallback(() => {
    if (!mapInstanceRef.current) return;
    mapInstanceRef.current.fitBounds(townBounds, { 
      padding: [20, 20],
      maxZoom: 15,
    });
  }, [townBounds]);

  // Retry loading map
  const handleRetry = useCallback(() => {
    setMapState('loading');
    if (mapInstanceRef.current) {
      mapInstanceRef.current.remove();
      mapInstanceRef.current = null;
    }
    setIsMounted(false);
    setTimeout(() => setIsMounted(true), 100);
  }, []);

  // Track mount state
  useEffect(() => {
    setIsMounted(true);
    return () => setIsMounted(false);
  }, []);

  // Initialize map ONLY after container is mounted and has dimensions
  useEffect(() => {
    const container = mapContainerRef.current;
    if (!container || !isMounted) return;
    
    // Guard against double initialization
    if (mapInstanceRef.current) return;

    // Ensure container has dimensions
    const rect = container.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      console.warn('[OSMMap] Container has no dimensions, retrying...');
      const timer = setTimeout(() => {
        container.dispatchEvent(new Event('resize'));
      }, 100);
      return () => clearTimeout(timer);
    }

    console.log('[OSMMap] Initializing map with dimensions:', rect.width, rect.height);

    try {
      const map = L.map(container, {
        center: [center.lat, center.lng],
        zoom,
        zoomControl: true,
        attributionControl: true,
        maxBounds: allTownsBounds,
        maxBoundsViscosity: 0.8,
      });

      // Create base layers - Humanitarian as default
      const baseLayers = {
        [TILE_LAYERS.humanitarian.name]: L.tileLayer(TILE_LAYERS.humanitarian.url, {
          attribution: TILE_LAYERS.humanitarian.attribution,
          maxZoom: 19,
          keepBuffer: 4,
        }),
        [TILE_LAYERS.osm.name]: L.tileLayer(TILE_LAYERS.osm.url, {
          attribution: TILE_LAYERS.osm.attribution,
          maxZoom: 19,
          keepBuffer: 4,
        }),
        [TILE_LAYERS.france.name]: L.tileLayer(TILE_LAYERS.france.url, {
          attribution: TILE_LAYERS.france.attribution,
          maxZoom: 19,
          keepBuffer: 4,
        }),
      };

      // Add default layer (Humanitarian)
      const defaultLayer = baseLayers[TILE_LAYERS.humanitarian.name];
      defaultLayer.addTo(map);

      // Track tile loading - mark ready as soon as first tiles appear
      let ready = false;
      const markReady = () => {
        if (ready) return;
        ready = true;
        setMapState('ready');
      };

      // First tile loaded = show map immediately (no need to wait for all)
      defaultLayer.once('tileload', () => {
        console.log('[OSMMap] First tile loaded, showing map');
        markReady();
      });

      defaultLayer.on('load', () => {
        console.log('[OSMMap] All tiles loaded');
        markReady();
      });

      defaultLayer.on('tileerror', (e) => {
        console.warn('[OSMMap] Tile error:', e);
      });

      // Add layer control
      L.control.layers(baseLayers, {}, { position: 'topright' }).addTo(map);

      // Fit to current town's service area on initial load
      map.fitBounds(townBounds, { 
        padding: [20, 20],
        maxZoom: 15,
      });

      // Handle map clicks
      if (onMapClick) {
        map.on('click', (e) => {
          onMapClick({ lat: e.latlng.lat, lng: e.latlng.lng });
        });
      }

      mapInstanceRef.current = map;

      // Fallback: show map after 2s even if no tiles loaded yet
      const timeoutId = setTimeout(() => {
        markReady();
      }, 2000);

      return () => {
        clearTimeout(timeoutId);
      };
    } catch (error) {
      console.error('[OSMMap] Map initialization error:', error);
      setMapState('error');
    }

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, [isMounted, center.lat, center.lng, zoom, onMapClick]);

  // Update pickup marker
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    if (pickupMarkerRef.current) {
      map.removeLayer(pickupMarkerRef.current);
      pickupMarkerRef.current = null;
    }

    if (pickup) {
      pickupMarkerRef.current = L.marker([pickup.lat, pickup.lng], { icon: pickupIcon })
        .addTo(map);
    }
  }, [pickup?.lat, pickup?.lng]);

  // Update dropoff marker
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    if (dropoffMarkerRef.current) {
      map.removeLayer(dropoffMarkerRef.current);
      dropoffMarkerRef.current = null;
    }

    if (dropoff) {
      dropoffMarkerRef.current = L.marker([dropoff.lat, dropoff.lng], { icon: dropoffIcon })
        .addTo(map);
    }
  }, [dropoff?.lat, dropoff?.lng]);

  // Update driver marker
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    if (driverMarkerRef.current) {
      map.removeLayer(driverMarkerRef.current);
      driverMarkerRef.current = null;
    }

    if (driverLocation) {
      driverMarkerRef.current = L.marker([driverLocation.lat, driverLocation.lng], { icon: driverIcon })
        .addTo(map);
    }
  }, [driverLocation?.lat, driverLocation?.lng]);

  // Update route polyline - blue line
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    if (routeLayerRef.current) {
      map.removeLayer(routeLayerRef.current);
      routeLayerRef.current = null;
    }

    if (routeGeometry) {
      try {
        const decoded = decodePolyline(routeGeometry);
        if (decoded.length > 0) {
          routeLayerRef.current = L.polyline(decoded, {
            color: '#B81104',
            weight: 5,
            opacity: 0.9,
            lineCap: 'round',
            lineJoin: 'round',
          }).addTo(map);
        }
      } catch (e) {
        console.error('[OSMMap] Failed to decode route geometry:', e);
      }
    }
  }, [routeGeometry]);

  // Fit bounds to show pickup/dropoff when both are set
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    const bounds: L.LatLngBoundsLiteral = [];
    
    if (pickup) bounds.push([pickup.lat, pickup.lng]);
    if (dropoff) bounds.push([dropoff.lat, dropoff.lng]);
    if (driverLocation) bounds.push([driverLocation.lat, driverLocation.lng]);

    if (bounds.length >= 2) {
      map.fitBounds(bounds, { padding: [60, 60] });
    } else if (bounds.length === 1) {
      map.setView(bounds[0], 15);
    }
  }, [pickup?.lat, pickup?.lng, dropoff?.lat, dropoff?.lng, driverLocation?.lat, driverLocation?.lng]);

  return (
    <div 
      className={cn('relative overflow-hidden bg-pickme-gray-200', className)} 
      style={{ height, minHeight: height === '100%' ? undefined : '260px' }}
    >
      {/* Loading State */}
      {mapState === 'loading' && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center map-shimmer">
          <div className="relative z-10 flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-3 border-primary border-t-transparent rounded-full animate-spin" />
            <p className="text-sm font-medium text-muted-foreground">Map loading...</p>
          </div>
        </div>
      )}

      {/* Error State */}
      {mapState === 'error' && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-pickme-gray-200 gap-4">
          <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center">
            <AlertTriangle className="w-8 h-8 text-destructive" />
          </div>
          <div className="text-center">
            <p className="font-semibold text-foreground">Map failed to load</p>
            <p className="text-sm text-muted-foreground mt-1">Check your connection</p>
          </div>
          <Button onClick={handleRetry} variant="outline" size="sm" className="gap-2">
            <RefreshCw className="w-4 h-4" />
            Retry
          </Button>
        </div>
      )}

      {/* Map Container - MUST have explicit dimensions */}
      <div 
        ref={mapContainerRef} 
        className="absolute inset-0 w-full h-full"
        style={{ zIndex: 1 }}
      />

      {/* Map Controls */}
      {mapState === 'ready' && showRecenterButton && (
        <div className="absolute bottom-3 left-3 z-[1000]">
          <Button
            onClick={handleRecenter}
            variant="secondary"
            size="sm"
            className="shadow-lg bg-background/95 backdrop-blur-sm"
            title={`Recenter to ${currentTown.name}`}
          >
            <Crosshair className="w-4 h-4 mr-1.5" />
            {currentTown.name}
          </Button>
        </div>
      )}
    </div>
  );
});

export default OSMMap;

// Decode Google/OSRM polyline format
function decodePolyline(encoded: string): [number, number][] {
  const points: [number, number][] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let b: number;
    let shift = 0;
    let result = 0;

    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);

    const dlat = result & 1 ? ~(result >> 1) : result >> 1;
    lat += dlat;

    shift = 0;
    result = 0;

    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);

    const dlng = result & 1 ? ~(result >> 1) : result >> 1;
    lng += dlng;

    points.push([lat / 1e5, lng / 1e5]);
  }

  return points;
}