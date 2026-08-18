/* eslint-disable react-hooks/exhaustive-deps */
 import { useEffect, useRef, useState, useCallback } from 'react';
 import L from 'leaflet';
 import 'leaflet/dist/leaflet.css';
 import { cn } from '@/lib/utils';
 import { Skeleton } from '@/components/ui/skeleton';
 import { Button } from '@/components/ui/button';
 import { Crosshair, RefreshCw, AlertTriangle } from 'lucide-react';
 import { GWANDA_BOUNDS } from '@/hooks/useGwandaLandmarks';
 
 interface DriverMarker {
   id: string;
   name: string;
   lat: number;
   lng: number;
   isOnline: boolean;
   tripStatus?: string | null; // offline | available | accepted | enroute | in_progress | completed
 }
 
 interface RideMarker {
   id: string;
   pickupLat: number;
   pickupLng: number;
   dropoffLat: number;
   dropoffLng: number;
   status: string;
   pickupAddress: string;
   dropoffAddress: string;
 }
 
 interface AdminMapProps {
   drivers: DriverMarker[];
   rides: RideMarker[];
   className?: string;
   height?: string;
 }
 
 // Driver marker with status-based colors
 function getDriverMarkerColor(tripStatus?: string | null, isOnline?: boolean): { bg: string; border: string; label: string } {
   if (tripStatus === 'enroute' || tripStatus === 'in_progress') return { bg: '#ef4444', border: '#dc2626', label: 'bg-red-600' };
   if (tripStatus === 'accepted' || tripStatus === 'arrived') return { bg: '#f59e0b', border: '#d97706', label: 'bg-amber-500' };
   if (isOnline) return { bg: '#B81104', border: '#7F0B02', label: 'bg-primary' };
   return { bg: '#6b7280', border: '#4b5563', label: 'bg-gray-500' };
 }

 const createDriverIcon = (name: string, tripStatus?: string | null, isOnline?: boolean) => {
   const { bg, label } = getDriverMarkerColor(tripStatus, isOnline);
   return L.divIcon({
     html: `
       <div class="flex flex-col items-center">
         <div class="w-9 h-9 rounded-full border-3 border-white shadow-lg flex items-center justify-center" style="background:${bg}; animation: pulse 2s infinite">
           <svg class="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24">
             <path d="M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11c-.66 0-1.21.42-1.42 1.01L3 12v8c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h12v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-8l-2.08-5.99zM6.5 16c-.83 0-1.5-.67-1.5-1.5S5.67 13 6.5 13s1.5.67 1.5 1.5S7.33 16 6.5 16zm11 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zM5 11l1.5-4.5h11L19 11H5z"/>
           </svg>
         </div>
         <span class="mt-0.5 px-1.5 py-0.5 ${label} text-white text-[10px] font-bold rounded shadow max-w-20 truncate">${name}</span>
       </div>
     `,
     className: 'admin-driver-marker',
     iconSize: [80, 55],
     iconAnchor: [40, 45],
   });
 };
 
 // Ride pickup marker - yellow
 const ridePickupIcon = L.divIcon({
   html: `
     <div class="flex flex-col items-center">
       <div class="w-7 h-7 rounded-full bg-amber-400 border-2 border-white shadow-md flex items-center justify-center">
         <svg class="w-4 h-4 text-black" fill="currentColor" viewBox="0 0 24 24">
           <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/>
         </svg>
       </div>
     </div>
   `,
   className: 'admin-pickup-marker',
   iconSize: [28, 35],
   iconAnchor: [14, 30],
 });
 
 // Ride dropoff marker - blue
 const rideDropoffIcon = L.divIcon({
   html: `
     <div class="flex flex-col items-center">
       <div class="w-7 h-7 rounded-full border-2 border-white shadow-md flex items-center justify-center" style="background:#B81104">
         <svg class="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 24 24">
           <path d="M12 4l-8 8h5v8h6v-8h5z"/>
         </svg>
       </div>
     </div>
   `,
   className: 'admin-dropoff-marker',
   iconSize: [28, 35],
   iconAnchor: [14, 30],
 });
 
 const GWANDA_CENTER = { lat: -20.9355, lng: 29.0147 };
 
 const gwandaBounds: L.LatLngBoundsExpression = [
   [GWANDA_BOUNDS.south, GWANDA_BOUNDS.west],
   [GWANDA_BOUNDS.north, GWANDA_BOUNDS.east],
 ];
 
 export default function AdminMap({ drivers, rides, className = '', height = '400px' }: AdminMapProps) {
   const mapContainerRef = useRef<HTMLDivElement>(null);
   const mapInstanceRef = useRef<L.Map | null>(null);
   const driverMarkersRef = useRef<L.Marker[]>([]);
   const rideMarkersRef = useRef<L.Marker[]>([]);
   const routeLinesRef = useRef<L.Polyline[]>([]);
   
   const [mapState, setMapState] = useState<'loading' | 'ready' | 'error'>('loading');
   const [isMounted, setIsMounted] = useState(false);
 
   const handleRecenter = useCallback(() => {
     if (!mapInstanceRef.current) return;
     mapInstanceRef.current.fitBounds(gwandaBounds, { padding: [20, 20], maxZoom: 15 });
   }, []);
 
   const handleRetry = useCallback(() => {
     setMapState('loading');
     if (mapInstanceRef.current) {
       mapInstanceRef.current.remove();
       mapInstanceRef.current = null;
     }
     setIsMounted(false);
     setTimeout(() => setIsMounted(true), 100);
   }, []);
 
   useEffect(() => {
     setIsMounted(true);
     return () => setIsMounted(false);
   }, []);
 
   // Initialize map
   useEffect(() => {
     const container = mapContainerRef.current;
     if (!container || !isMounted || mapInstanceRef.current) return;
 
     const rect = container.getBoundingClientRect();
     if (rect.width === 0 || rect.height === 0) {
       const timer = setTimeout(() => container.dispatchEvent(new Event('resize')), 100);
       return () => clearTimeout(timer);
     }
 
     try {
       const map = L.map(container, {
         center: [GWANDA_CENTER.lat, GWANDA_CENTER.lng],
         zoom: 14,
         zoomControl: true,
         attributionControl: true,
       });
 
       const tileLayer = L.tileLayer('https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png', {
         attribution: '&copy; OpenStreetMap, Tiles: HOT',
         maxZoom: 19,
       });
 
       tileLayer.addTo(map);
       
       tileLayer.on('load', () => setMapState('ready'));
       tileLayer.on('tileerror', () => {
         if (mapState === 'loading') setMapState('error');
       });
 
       map.fitBounds(gwandaBounds, { padding: [20, 20], maxZoom: 14 });
       mapInstanceRef.current = map;
 
       setTimeout(() => {
         if (mapState === 'loading') setMapState('ready');
       }, 5000);
 
     } catch (error) {
       console.error('[AdminMap] Init error:', error);
       setMapState('error');
     }
 
     return () => {
       if (mapInstanceRef.current) {
         mapInstanceRef.current.remove();
         mapInstanceRef.current = null;
       }
     };
   }, [isMounted]);
 
   // Update driver markers
   useEffect(() => {
     const map = mapInstanceRef.current;
     if (!map) return;
 
     // Clear old markers
     driverMarkersRef.current.forEach(m => map.removeLayer(m));
     driverMarkersRef.current = [];
 
     // Add new markers
      drivers.forEach(driver => {
        const marker = L.marker([driver.lat, driver.lng], { 
          icon: createDriverIcon(driver.name.split(' ')[0] || 'Driver', driver.tripStatus, driver.isOnline)
        })
         .bindPopup(`
           <div style="font-family: system-ui; min-width: 140px;">
             <div style="font-weight: 800; font-size: 14px;">${driver.name}</div>
             <div style="opacity: 0.7; font-size: 12px; margin-top: 4px;">
               ${driver.isOnline ? '🟢 Online' : '⚫ Offline'}
             </div>
             <div style="font-size: 11px; opacity: 0.6; margin-top: 4px;">
               ${driver.lat.toFixed(5)}, ${driver.lng.toFixed(5)}
             </div>
           </div>
         `)
         .addTo(map);
       driverMarkersRef.current.push(marker);
     });
   }, [drivers]);
 
   // Update ride markers
   useEffect(() => {
     const map = mapInstanceRef.current;
     if (!map) return;
 
     // Clear old markers and lines
     rideMarkersRef.current.forEach(m => map.removeLayer(m));
     routeLinesRef.current.forEach(l => map.removeLayer(l));
     rideMarkersRef.current = [];
     routeLinesRef.current = [];
 
     // Add new markers
     rides.forEach(ride => {
       const statusColor = ride.status === 'in_progress' ? '#16a34a' : 
                          ride.status === 'accepted' ? '#0b3b78' : '#f59e0b';
       
       // Pickup marker
       const pickupMarker = L.marker([ride.pickupLat, ride.pickupLng], { icon: ridePickupIcon })
         .bindPopup(`
           <div style="font-family: system-ui; min-width: 160px;">
             <div style="font-weight: 800; font-size: 13px;">Pickup</div>
             <div style="font-size: 12px; margin-top: 4px;">${ride.pickupAddress}</div>
             <div style="margin-top: 6px; padding: 3px 8px; background: ${statusColor}; color: white; border-radius: 6px; font-size: 11px; font-weight: 700; display: inline-block;">
               ${ride.status.toUpperCase()}
             </div>
           </div>
         `)
         .addTo(map);
 
       // Dropoff marker
       const dropoffMarker = L.marker([ride.dropoffLat, ride.dropoffLng], { icon: rideDropoffIcon })
         .bindPopup(`
           <div style="font-family: system-ui; min-width: 160px;">
             <div style="font-weight: 800; font-size: 13px;">Drop-off</div>
             <div style="font-size: 12px; margin-top: 4px;">${ride.dropoffAddress}</div>
           </div>
         `)
         .addTo(map);
 
       // Route line
       const routeLine = L.polyline(
         [[ride.pickupLat, ride.pickupLng], [ride.dropoffLat, ride.dropoffLng]], 
         { color: statusColor, weight: 3, opacity: 0.7, dashArray: '8, 8' }
       ).addTo(map);
 
       rideMarkersRef.current.push(pickupMarker, dropoffMarker);
       routeLinesRef.current.push(routeLine);
     });
   }, [rides]);
 
   return (
     <div className={cn('relative rounded-xl overflow-hidden bg-muted', className)} style={{ height, minHeight: '300px' }}>
       {mapState === 'loading' && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center map-shimmer">
            <div className="relative z-10 flex flex-col items-center gap-3">
             <div className="w-8 h-8 border-3 border-primary border-t-transparent rounded-full animate-spin" />
             <p className="text-sm font-medium text-muted-foreground">Loading map...</p>
           </div>
         </div>
       )}
 
       {mapState === 'error' && (
         <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-muted gap-4">
           <AlertTriangle className="w-10 h-10 text-destructive" />
           <p className="font-semibold">Map failed to load</p>
           <Button onClick={handleRetry} variant="outline" size="sm">
             <RefreshCw className="w-4 h-4 mr-2" />
             Retry
           </Button>
         </div>
       )}
 
       <div ref={mapContainerRef} className="absolute inset-0 w-full h-full" style={{ zIndex: 1 }} />
 
       {mapState === 'ready' && (
         <>
           <div className="absolute bottom-3 left-3 z-[1000]">
             <Button onClick={handleRecenter} variant="secondary" size="sm" className="shadow-lg bg-background/95 backdrop-blur-sm">
               <Crosshair className="w-4 h-4 mr-1.5" />
               Gwanda
             </Button>
           </div>
           
           {/* Legend */}
            <div className="absolute top-3 right-12 z-[1000] bg-background/95 backdrop-blur-sm rounded-lg shadow-lg p-3 text-xs">
              <div className="font-bold mb-2">Fleet Status</div>
              <div className="flex items-center gap-2 mb-1">
                 <div className="w-3 h-3 rounded-full bg-primary" />
                <span>Available</span>
              </div>
              <div className="flex items-center gap-2 mb-1">
                <div className="w-3 h-3 rounded-full bg-amber-500" />
                <span>Heading to Pickup</span>
              </div>
              <div className="flex items-center gap-2 mb-1">
                <div className="w-3 h-3 rounded-full bg-red-500" />
                <span>Enroute (Rider Onboard)</span>
              </div>
              <div className="flex items-center gap-2 mb-1">
                <div className="w-3 h-3 rounded-full bg-gray-400" />
                <span>Offline</span>
              </div>
              <div className="border-t border-border mt-2 pt-2">
                <div className="flex items-center gap-2 mb-1">
                  <div className="w-3 h-3 rounded-full bg-amber-400" />
                  <span>Pickup</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-primary" />
                  <span>Dropoff ({rides.length})</span>
                </div>
              </div>
            </div>
         </>
       )}
     </div>
   );
 }