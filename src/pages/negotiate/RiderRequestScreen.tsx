import { useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { ArrowLeft, MapPin, Navigation, DollarSign, X, Search, Crosshair, Loader2, Users, Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLandmarks, type Landmark } from '@/hooks/useLandmarks';
import { useOSRMRoute } from '@/hooks/useOSRMRoute';
import { usePricingSettings } from '@/hooks/usePricingSettings';
import { searchZW } from '@/lib/geo_osm';
import { cachePlaceFromNominatim } from '@/lib/placeCache';
import QuickPickChips from '@/components/ride/QuickPickChips';
import ProximityFilter from '@/components/ride/ProximityFilter';
import { goBackend } from '@/lib/goBackendClient';
import { decimalToMinor } from '@/lib/money';

interface SelectedLocation {
  name: string;
  lat: number;
  lng: number;
}

export default function RiderRequestScreen() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [pickup, setPickup] = useState<SelectedLocation | null>(null);
  const [dropoff, setDropoff] = useState<SelectedLocation | null>(null);
  const [offeredFare, setOfferedFare] = useState('');
  const [loading, setLoading] = useState(false);
  const [passengerCount, setPassengerCount] = useState(1);

  // Search overlay state
  const [activeField, setActiveField] = useState<'pickup' | 'dropoff' | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [proximityRadius, setProximityRadius] = useState<number | null>(null);

  // GPS state
  const [gpsStatus, setGpsStatus] = useState<'idle' | 'loading' | 'denied'>('idle');
  const [gpsCoords, setGpsCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [gpsError, setGpsError] = useState<string | null>(null);

  // Nominatim state
  const [nominatimResults, setNominatimResults] = useState<Array<{ name: string; lat: number; lng: number; displayName: string }>>([]);
  const [nominatimLoading, setNominatimLoading] = useState(false);

  // Landmark search
  const { landmarks, loading: landmarksLoading } = useLandmarks({
    searchQuery,
    limit: 15,
    userLocation: gpsCoords,
    radiusKm: proximityRadius,
  });

  // Route & pricing
  const { route: routeData, loading: routeLoading } = useOSRMRoute(
    pickup ? { lat: pickup.lat, lng: pickup.lng } : null,
    dropoff ? { lat: dropoff.lat, lng: dropoff.lng } : null
  );
  const { data: pricingSettings } = usePricingSettings();

  // Calculate fare estimate
  const fareEstimate = (() => {
    if (!routeData?.distanceKm || !pricingSettings) return null;
    const { distanceKm, durationMinutes } = routeData;
    const baseFare = pricingSettings.base_fare;
    const perKmRate = pricingSettings.per_km_rate;
    const minFare = pricingSettings.min_fare;

    let fare = baseFare + distanceKm * perKmRate;
    fare = Math.max(fare, minFare);

    // $0.50 surcharge for 3-5 passengers
    if (passengerCount >= 3 && passengerCount <= 5) {
      fare += 0.50;
    }

    // Round to nearest $0.50
    fare = Math.round(fare * 2) / 2;
    fare = Math.max(fare, 0.50);

    return { fareR: fare, distanceKm, durationMinutes };
  })();

  // Auto-fill offered fare when estimate changes
  useEffect(() => {
    if (fareEstimate && !offeredFare) {
      setOfferedFare(String(fareEstimate.fareR));
    }
  }, [fareEstimate?.fareR]);

  const showNominatimFallback = searchQuery.trim().length >= 3 && landmarks.length === 0 && nominatimResults.length > 0;

  const handleUseMyLocation = useCallback(() => {
    if (!navigator.geolocation) return;
    setGpsStatus('loading');
    setGpsError(null);
    navigator.geolocation.getCurrentPosition(
      pos => {
        const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setGpsCoords(coords);
        setGpsStatus('idle');
        setPickup({ name: 'My location', ...coords });
        setActiveField(null);
      },
      err => {
        setGpsStatus('denied');
        setGpsError(err.code === err.PERMISSION_DENIED ? 'Location access denied' : 'Unable to get location');
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }, []);

  const handleLandmarkSelect = (landmark: Landmark) => {
    const loc: SelectedLocation = { name: landmark.name, lat: landmark.latitude, lng: landmark.longitude };
    if (activeField === 'pickup') setPickup(loc);
    else setDropoff(loc);
    setActiveField(null);
    setSearchQuery('');
    setNominatimResults([]);
  };

  const handleNominatimSelect = (result: { name: string; lat: number; lng: number }) => {
    if (activeField === 'pickup') setPickup(result);
    else setDropoff(result);
    setActiveField(null);
    setSearchQuery('');
    setNominatimResults([]);
  };

  const handleQuickPickSelect = (pick: { name: string; lat: number; lng: number }) => {
    if (activeField === 'pickup') setPickup(pick);
    else if (activeField === 'dropoff') setDropoff(pick);
    setActiveField(null);
  };

  const handleSearchChange = useCallback(async (value: string) => {
    setSearchQuery(value);
    if (value.trim().length >= 3) {
      setNominatimLoading(true);
      try {
        const results = await searchZW(value.trim());
        setNominatimResults(results.map(r => ({
          name: r.name || r.display_name.split(',')[0],
          lat: Number(r.lat),
          lng: Number(r.lon),
          displayName: r.display_name,
        })));
        for (const r of results) cachePlaceFromNominatim(r).catch(() => {});
      } catch {
        setNominatimResults([]);
      } finally {
        setNominatimLoading(false);
      }
    } else {
      setNominatimResults([]);
    }
  }, []);

  async function handleRequest() {
    if (!user) {
      toast({ title: 'Not logged in', description: 'Please log in first.', variant: 'destructive' });
      return;
    }
    if (!pickup || !dropoff || !offeredFare) {
      toast({ title: 'Missing fields', description: 'Fill in all fields.', variant: 'destructive' });
      return;
    }
    const fare = parseFloat(offeredFare);
    if (isNaN(fare) || fare <= 0) {
      toast({ title: 'Invalid fare', description: 'Enter a valid fare amount.', variant: 'destructive' });
      return;
    }

    setLoading(true);
    try {
      const data = await goBackend.post<{ id?: string; ride_id?: string; request_id?: string; ride?: { id?: string } }>('/api/rides', {
        pickup_address: pickup.name,
        pickup_lat: pickup.lat,
        pickup_lng: pickup.lng,
        dropoff_address: dropoff.name,
        dropoff_lat: dropoff.lat,
        dropoff_lng: dropoff.lng,
        offered_fare_minor: decimalToMinor(fare),
        fare_minor: decimalToMinor(fare),
        currency: 'USD',
        status: 'negotiating',
        passenger_count: passengerCount,
        distance_km: fareEstimate?.distanceKm ?? 0,
        duration_minutes: fareEstimate?.durationMinutes ?? 0,
      });
      const id = data.request_id ?? data.ride_id ?? data.ride?.id ?? data.id;
      if (!id) throw new Error('Backend did not return a ride id');
      navigate(`/negotiate/offers/${id}`);
    } catch (e: unknown) {
      toast({ title: 'Error', description: (e as Error).message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
      return;
  }

  // Fare adjustment helpers ($0.50 steps)
  const adjustFare = (direction: 'up' | 'down') => {
    const current = parseFloat(offeredFare) || 0;
    const step = 0.50;
    const newFare = direction === 'up' ? current + step : Math.max(step, current - step);
    setOfferedFare(String(Math.round(newFare * 2) / 2));
  };

  return (
    <div className="min-h-screen bg-background flex flex-col relative">
      {/* Header */}
      <div className="flex items-center gap-3 p-4 border-b border-border z-10">
        <button onClick={() => navigate(-1)} className="p-1 rounded-lg hover:bg-muted transition-colors">
          <ArrowLeft className="w-5 h-5 text-foreground" />
        </button>
        <h1 className="text-lg font-bold text-foreground">Request a Ride</h1>
      </div>

      <div className="flex-1 p-6 space-y-5 max-w-md mx-auto w-full">
        <p className="text-sm text-muted-foreground">
          Set your pickup, dropoff, and the fare you're willing to pay. Drivers will counter-offer.
        </p>

        {/* Pickup */}
        <div className="space-y-2">
          <Label className="text-sm font-medium text-foreground flex items-center gap-2">
            <MapPin className="w-4 h-4 text-primary" /> Pickup Location
          </Label>
          <button
            type="button"
            onClick={() => { setActiveField('pickup'); setSearchQuery(''); }}
            className={cn(
              'w-full flex items-center gap-3 p-3.5 rounded-xl border text-left transition-colors',
              pickup ? 'border-primary/30 bg-primary/5' : 'border-border bg-background hover:bg-muted'
            )}
          >
            <span className={cn('w-3 h-3 rounded-full shrink-0', pickup ? 'bg-accent' : 'bg-muted-foreground/30')} />
            <span className={cn('text-sm font-medium truncate flex-1', pickup ? 'text-foreground' : 'text-muted-foreground')}>
              {pickup?.name || 'Tap to search pickup...'}
            </span>
            {pickup && (
              <span onClick={e => { e.stopPropagation(); setPickup(null); setOfferedFare(''); }} className="p-1 hover:bg-muted rounded-full">
                <X className="w-4 h-4 text-muted-foreground" />
              </span>
            )}
          </button>
        </div>

        {/* Dropoff */}
        <div className="space-y-2">
          <Label className="text-sm font-medium text-foreground flex items-center gap-2">
            <Navigation className="w-4 h-4 text-accent" /> Drop-off Location
          </Label>
          <button
            type="button"
            onClick={() => { setActiveField('dropoff'); setSearchQuery(''); }}
            className={cn(
              'w-full flex items-center gap-3 p-3.5 rounded-xl border text-left transition-colors',
              dropoff ? 'border-accent/30 bg-accent/5' : 'border-border bg-background hover:bg-muted'
            )}
          >
            <span className={cn('w-3 h-3 rounded-full shrink-0', dropoff ? 'bg-primary' : 'bg-muted-foreground/30')} />
            <span className={cn('text-sm font-medium truncate flex-1', dropoff ? 'text-foreground' : 'text-muted-foreground')}>
              {dropoff?.name || 'Tap to search destination...'}
            </span>
            {dropoff && (
              <span onClick={e => { e.stopPropagation(); setDropoff(null); setOfferedFare(''); }} className="p-1 hover:bg-muted rounded-full">
                <X className="w-4 h-4 text-muted-foreground" />
              </span>
            )}
          </button>
        </div>

        {/* Fare Estimate Card */}
        {pickup && dropoff && (
          <div className="bg-accent/5 border border-accent/20 rounded-2xl p-4 space-y-2">
            {routeLoading ? (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span className="text-sm">Calculating route...</span>
              </div>
            ) : fareEstimate ? (
              <>
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Estimated fare</p>
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    <Info className="w-3 h-3" /> approx.
                  </span>
                </div>
                <p className="text-3xl font-bold text-foreground">${fareEstimate.fareR.toFixed(2)}</p>
                <p className="text-sm text-muted-foreground">
                  {fareEstimate.distanceKm.toFixed(1)} km • {fareEstimate.durationMinutes} min
                </p>
                {passengerCount >= 3 && passengerCount <= 5 && (
                  <p className="text-xs text-accent font-medium">+$5 group surcharge (3-5 passengers)</p>
                )}
              </>
            ) : null}
          </div>
        )}

        {/* Passenger Count */}
        <div className="space-y-2">
          <Label className="text-sm font-medium text-foreground flex items-center gap-2">
            <Users className="w-4 h-4 text-primary" /> Passengers
          </Label>
          <div className="flex items-center justify-between bg-muted rounded-xl p-3">
            <div>
              <p className="text-sm font-semibold text-foreground">{passengerCount} {passengerCount === 1 ? 'person' : 'people'}</p>
              {passengerCount >= 3 && passengerCount <= 5 && (
                <p className="text-xs text-accent">+$0.50 surcharge applies</p>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => { setPassengerCount(c => Math.max(1, c - 1)); setOfferedFare(''); }}
                disabled={passengerCount <= 1}
                className="w-9 h-9 rounded-full bg-background border border-border flex items-center justify-center text-lg font-bold text-foreground disabled:opacity-30 transition-opacity"
              >
                −
              </button>
              <span className="w-8 text-center text-lg font-bold text-foreground">{passengerCount}</span>
              <button
                onClick={() => { setPassengerCount(c => Math.min(5, c + 1)); setOfferedFare(''); }}
                disabled={passengerCount >= 5}
                className="w-9 h-9 rounded-full bg-background border border-border flex items-center justify-center text-lg font-bold text-foreground disabled:opacity-30 transition-opacity"
              >
                +
              </button>
            </div>
          </div>
        </div>

        {/* Offered Fare with $0.50 stepper */}
        <div className="space-y-2">
          <Label className="text-sm font-medium text-foreground flex items-center gap-2">
            <DollarSign className="w-4 h-4 text-primary" /> Your Offered Fare (USD)
          </Label>
          <div className="flex items-center gap-2">
            <button
              onClick={() => adjustFare('down')}
              disabled={!offeredFare || parseFloat(offeredFare) <= 0.50}
              className="w-12 h-12 rounded-xl bg-muted border border-border flex items-center justify-center text-xl font-bold text-foreground disabled:opacity-30 transition-opacity shrink-0"
            >
              −
            </button>
            <div className="flex-1 relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground font-semibold">$</span>
              <input
                type="number"
                placeholder="0"
                min="0.50"
                step="0.50"
                value={offeredFare}
                onChange={e => setOfferedFare(e.target.value)}
                className="w-full h-12 pl-8 pr-4 bg-muted rounded-xl text-2xl font-bold text-foreground text-center focus:outline-none focus:ring-2 focus:ring-accent border-0"
              />
            </div>
            <button
              onClick={() => adjustFare('up')}
              className="w-12 h-12 rounded-xl bg-muted border border-border flex items-center justify-center text-xl font-bold text-foreground transition-opacity shrink-0"
            >
              +
            </button>
          </div>
          <p className="text-xs text-muted-foreground">Adjust in $0.50 steps. Drivers can negotiate a different price.</p>
        </div>

        <Button
          className="w-full"
          size="lg"
          onClick={handleRequest}
          disabled={loading || !pickup || !dropoff || !offeredFare}
        >
          {loading ? 'Submitting…' : 'Request Ride'}
        </Button>
      </div>

      {/* ══ Full-Screen Search Overlay ══ */}
      {activeField && (
        <div className="absolute inset-0 z-40 flex flex-col bg-background" style={{ animation: 'slideUp 0.25s ease' }}>
          {/* Search header */}
          <div className="flex items-center gap-3 px-4 bg-background border-b border-border" style={{ paddingTop: `calc(env(safe-area-inset-top) + 12px)`, paddingBottom: '12px' }}>
            <button
              onClick={() => { setActiveField(null); setSearchQuery(''); setNominatimResults([]); }}
              className="w-10 h-10 flex items-center justify-center rounded-xl hover:bg-muted transition-colors shrink-0"
            >
              <X className="w-5 h-5 text-foreground" />
            </button>
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground pointer-events-none" />
              <input
                autoFocus
                type="text"
                placeholder={activeField === 'pickup' ? 'Search pickup location...' : 'Search destination...'}
                value={searchQuery}
                onChange={e => handleSearchChange(e.target.value)}
                className="w-full h-11 pl-10 pr-4 bg-muted rounded-xl text-base font-medium text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-accent border-0"
              />
            </div>
          </div>

          {/* Scrollable results */}
          <div className="flex-1 overflow-y-auto">
            {/* GPS — pickup only */}
            {activeField === 'pickup' && (
              <button
                onClick={handleUseMyLocation}
                disabled={gpsStatus === 'loading'}
                className="w-full flex items-center gap-4 px-4 py-4 hover:bg-muted transition-colors border-b border-border text-left"
              >
                <div className="w-11 h-11 rounded-full bg-accent/10 flex items-center justify-center shrink-0">
                  {gpsStatus === 'loading' ? (
                    <Loader2 className="w-5 h-5 animate-spin text-accent" />
                  ) : (
                    <Crosshair className="w-5 h-5 text-accent" />
                  )}
                </div>
                <div>
                  <p className="font-semibold text-foreground">Use my current location</p>
                  <p className="text-sm text-muted-foreground">Find pickup point automatically</p>
                </div>
              </button>
            )}

            {gpsError && (
              <p className="text-sm text-amber-600 bg-amber-50 mx-4 my-3 p-3 rounded-xl">{gpsError}</p>
            )}

            {/* Proximity Filter */}
            {gpsCoords && (
              <div className="px-4 pt-3 pb-1">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Nearby places</p>
                <ProximityFilter selected={proximityRadius} onSelect={setProximityRadius} />
              </div>
            )}

            {/* Quick Picks */}
            {!searchQuery.trim() && (
              <div className="px-4 pt-4 pb-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Popular places</p>
                <QuickPickChips
                  onSelect={handleQuickPickSelect}
                  selectedName={activeField === 'pickup' ? pickup?.name : dropoff?.name}
                />
              </div>
            )}

            {/* Search results */}
            {(searchQuery.trim() || proximityRadius !== null) && (
              <>
                <div className="px-4 pt-4 pb-1">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    {searchQuery.trim() ? 'Results' : `Within ${proximityRadius}km`}
                  </p>
                </div>

                {landmarksLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="w-6 h-6 animate-spin text-accent" />
                  </div>
                ) : (
                  <>
                    {landmarks.map((landmark) => (
                      <button
                        key={landmark.id}
                        onClick={() => handleLandmarkSelect(landmark)}
                        className="w-full flex items-center gap-4 px-4 py-4 hover:bg-muted transition-colors border-b border-border/50 text-left"
                      >
                        <div className="w-11 h-11 rounded-full bg-muted flex items-center justify-center shrink-0">
                          <MapPin className="w-5 h-5 text-muted-foreground" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold text-foreground truncate">{landmark.name}</p>
                          <p className="text-sm text-muted-foreground capitalize">{landmark.category}</p>
                        </div>
                      </button>
                    ))}

                    {landmarks.length === 0 && !nominatimLoading && !showNominatimFallback && searchQuery.trim() && (
                      <div className="text-center py-12 text-muted-foreground">
                        <MapPin className="w-10 h-10 mx-auto mb-3 opacity-30" />
                        <p className="text-sm">No results for "{searchQuery}"</p>
                      </div>
                    )}

                    {nominatimLoading && (
                      <div className="flex items-center justify-center gap-2 py-4 text-muted-foreground">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span className="text-sm">Searching more places...</span>
                      </div>
                    )}
                  </>
                )}

                {/* Nominatim fallback */}
                {(showNominatimFallback || (landmarks.length > 0 && nominatimResults.length > 0)) && (
                  <>
                    <div className="px-4 py-2 bg-accent/5 border-t border-border">
                      <p className="text-xs font-semibold text-accent uppercase tracking-wider">📍 More places in Gwanda</p>
                    </div>
                    {nominatimResults.map((result, index) => (
                      <button
                        key={`nom-${index}`}
                        onClick={() => handleNominatimSelect(result)}
                        className="w-full flex items-center gap-4 px-4 py-4 hover:bg-muted transition-colors border-b border-border/50 text-left"
                      >
                        <div className="w-11 h-11 rounded-full bg-accent/10 flex items-center justify-center shrink-0">
                          <Navigation className="w-5 h-5 text-accent" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold text-foreground truncate">{result.name}</p>
                          <p className="text-sm text-muted-foreground truncate">{result.displayName}</p>
                        </div>
                      </button>
                    ))}
                  </>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
