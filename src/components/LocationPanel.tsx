import { useState, useEffect, useCallback } from 'react';
import { Navigation, MapPin, Crosshair, AlertCircle, Check, Search, Loader2, ArrowDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { InputField } from '@/components/ui/input-field';
import { GlassCard } from '@/components/ui/glass-card';
import { EmptyState } from '@/components/ui/empty-state';
import { SectionHeader } from '@/components/ui/section-header';
import { useLandmarks, formatDistance, type Landmark } from '@/hooks/useLandmarks';
import { cn } from '@/lib/utils';
import MapboxMap from '@/components/MapboxMap';
import { LandmarkChips } from '@/components/LandmarkChips';
import ArrivalIndicator from '@/components/ArrivalIndicator';

interface SelectedLocation {
  name: string;
  lat: number;
  lng: number;
}

interface LocationPanelProps {
  pickupLocation: SelectedLocation | null;
  dropoffLocation: SelectedLocation | null;
  onPickupSelect: (location: SelectedLocation) => void;
  onDropoffSelect: (location: SelectedLocation) => void;
  routeGeometry?: string | null;
  driverLocation?: { lat: number; lng: number } | null;
  arrivalState?: {
    isArrived: boolean;
    distanceToPickup: number | null;
    distanceToDropoff: number | null;
    arrivalType: 'pickup' | 'dropoff' | null;
  };
  className?: string;
}

interface GPSState {
  status: 'idle' | 'loading' | 'success' | 'denied' | 'unavailable';
  coords: { lat: number; lng: number } | null;
  accuracy: number | null;
  error: string | null;
}

const LocationPanel = ({
  pickupLocation,
  dropoffLocation,
  onPickupSelect,
  onDropoffSelect,
  routeGeometry,
  driverLocation,
  arrivalState,
  className = '',
}: LocationPanelProps) => {
  const [gpsState, setGpsState] = useState<GPSState>({
    status: 'idle',
    coords: null,
    accuracy: null,
    error: null,
  });
  const [activeSelector, setActiveSelector] = useState<'pickup' | 'dropoff' | null>('pickup');
  const [searchQuery, setSearchQuery] = useState('');

  const { landmarks, loading: landmarksLoading, getNearbyLandmarks, findNearestLandmark, allLandmarks } = useLandmarks({
    userLocation: gpsState.coords,
    searchQuery,
    limit: 20,
  });

  // Get nearby landmarks sorted by distance
  const nearbyLandmarks = gpsState.coords 
    ? getNearbyLandmarks(20).slice(0, 8)
    : allLandmarks.slice(0, 8);

  // Filtered landmarks based on search
  const filteredLandmarks = searchQuery.trim() 
    ? landmarks 
    : nearbyLandmarks;

  const handleUseMyLocation = () => {
    if (!navigator.geolocation) {
      setGpsState({
        status: 'unavailable',
        coords: null,
        accuracy: null,
        error: 'Geolocation is not supported by your browser',
      });
      return;
    }

    setGpsState(prev => ({ ...prev, status: 'loading', error: null }));

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const coords = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        };
        setGpsState({
          status: 'success',
          coords,
          accuracy: Math.round(position.coords.accuracy),
          error: null,
        });

        // Auto-set as pickup if none selected
        if (!pickupLocation) {
          // Try to find nearest landmark for better display name
          const nearest = findNearestLandmark(coords.lat, coords.lng);
          const name = nearest && nearest.distance && nearest.distance < 0.3 
            ? `Near ${nearest.name}` 
            : 'My Current Location';
          
          onPickupSelect({
            name,
            lat: coords.lat,
            lng: coords.lng,
          });
          setActiveSelector('dropoff');
        }
      },
      (error) => {
        let errorMessage = 'Unable to get your location';
        let status: GPSState['status'] = 'unavailable';
        
        if (error.code === error.PERMISSION_DENIED) {
          errorMessage = 'Location access denied. Please select a landmark.';
          status = 'denied';
        } else if (error.code === error.POSITION_UNAVAILABLE) {
          errorMessage = 'Location unavailable. Please select a landmark.';
        } else if (error.code === error.TIMEOUT) {
          errorMessage = 'Location timed out. Select a landmark below.';
        }

        setGpsState({
          status,
          coords: null,
          accuracy: null,
          error: errorMessage,
        });
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 60000,
      }
    );
  };

  const handleLandmarkSelect = (landmark: Landmark) => {
    const location: SelectedLocation = {
      name: landmark.name,
      lat: landmark.latitude,
      lng: landmark.longitude,
    };

    if (activeSelector === 'pickup') {
      onPickupSelect(location);
      setActiveSelector('dropoff');
    } else {
      onDropoffSelect(location);
      setActiveSelector(null);
    }
    setSearchQuery('');
  };

  // Handle map click - select location on map
  const handleMapClick = useCallback((coords: { lat: number; lng: number }) => {
    if (!activeSelector) return;

    // Find nearest landmark for display name
    const nearest = findNearestLandmark(coords.lat, coords.lng);
    const name = nearest && nearest.distance && nearest.distance < 0.5 
      ? `Near ${nearest.name}` 
      : `${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}`;

    const location: SelectedLocation = {
      name,
      lat: coords.lat,
      lng: coords.lng,
    };

    if (activeSelector === 'pickup') {
      onPickupSelect(location);
      setActiveSelector('dropoff');
    } else {
      onDropoffSelect(location);
      setActiveSelector(null);
    }
  }, [activeSelector, findNearestLandmark, onPickupSelect, onDropoffSelect]);

  return (
    <GlassCard className={cn("rounded-xl overflow-hidden flex flex-col", className)}>
      {/* Map Section */}
      <div className="relative flex-shrink-0">
        <MapboxMap
          pickup={pickupLocation}
          dropoff={dropoffLocation}
          routeGeometry={routeGeometry}
          driverLocation={driverLocation}
          onMapClick={handleMapClick}
          height="280px"
          className="w-full"
        />
        
        {/* GPS Button Overlay */}
        <Button
          onClick={handleUseMyLocation}
          variant="secondary"
          size="sm"
          disabled={gpsState.status === 'loading'}
          className="absolute bottom-3 right-3 shadow-lg"
        >
          {gpsState.status === 'loading' ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <>
              <Crosshair className="w-4 h-4 mr-1.5" />
              My Location
            </>
          )}
        </Button>

        {/* Map click instruction */}
        {activeSelector && (
          <div className="absolute top-3 left-3 right-16 bg-background/90 backdrop-blur-sm rounded-lg px-3 py-2 text-sm">
            <span className="font-medium">
              Tap map to select {activeSelector === 'pickup' ? 'pickup' : 'dropoff'}
            </span>
          </div>
        )}
      </div>

      {/* Arrival Indicator */}
      {arrivalState && (
        <ArrivalIndicator
          isArrived={arrivalState.isArrived}
          arrivalType={arrivalState.arrivalType}
          distanceToPickup={arrivalState.distanceToPickup}
          distanceToDropoff={arrivalState.distanceToDropoff}
          className="mx-4 mt-4"
        />
      )}

      {/* GPS Status */}
      {gpsState.status !== 'idle' && (
        <div className="px-4 py-2 border-b border-border bg-secondary/30">
          {gpsState.status === 'success' && gpsState.coords && (
            <div className="flex items-center gap-2 text-sm">
              <Check className="w-4 h-4 text-emerald-500" />
              <span className="text-muted-foreground">
                GPS active
              </span>
              {gpsState.accuracy && (
                <span className="text-xs text-muted-foreground">(±{gpsState.accuracy}m)</span>
              )}
            </div>
          )}

          {(gpsState.status === 'denied' || gpsState.status === 'unavailable') && (
            <div className="flex items-center gap-2 text-sm text-amber-600">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{gpsState.error}</span>
            </div>
          )}
        </div>
      )}

      {/* Selected Locations Display */}
      <div className="p-4 border-b border-border space-y-3 flex-shrink-0">
        {/* Pickup */}
        <button
          onClick={() => setActiveSelector('pickup')}
          className={cn(
            "w-full flex items-center gap-3 p-3 rounded-lg border transition-colors text-left",
            activeSelector === 'pickup'
              ? "border-emerald-500 bg-emerald-500/5"
              : "border-border hover:bg-secondary/50"
          )}
        >
          <div className={cn(
            "w-10 h-10 rounded-full flex items-center justify-center shrink-0",
            pickupLocation ? "bg-emerald-100" : "bg-secondary"
          )}>
            <div className={cn(
              "w-3 h-3 rounded-full",
              pickupLocation ? "bg-emerald-500" : "bg-muted-foreground"
            )} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Pickup</p>
            <p className={cn(
              "font-medium truncate",
              pickupLocation ? "text-foreground" : "text-muted-foreground"
            )}>
              {pickupLocation?.name || 'Select pickup location'}
            </p>
          </div>
          {activeSelector === 'pickup' && (
            <span className="text-xs text-emerald-600 font-medium shrink-0">Selecting</span>
          )}
        </button>

        {/* Route line connector */}
        <div className="flex items-center justify-center">
          <div className="flex flex-col items-center gap-0.5">
            <div className="w-0.5 h-2 bg-border" />
            <ArrowDown className="w-4 h-4 text-muted-foreground" />
            <div className="w-0.5 h-2 bg-border" />
          </div>
        </div>

        {/* Dropoff */}
        <button
          onClick={() => setActiveSelector('dropoff')}
          className={cn(
            "w-full flex items-center gap-3 p-3 rounded-lg border transition-colors text-left",
            activeSelector === 'dropoff'
              ? "border-blue-500 bg-blue-500/5"
              : "border-border hover:bg-secondary/50"
          )}
        >
          <div className={cn(
            "w-10 h-10 rounded-full flex items-center justify-center shrink-0",
            dropoffLocation ? "bg-blue-100" : "bg-secondary"
          )}>
            <div className={cn(
              "w-3 h-3 rounded-full",
              dropoffLocation ? "bg-blue-500" : "bg-muted-foreground"
            )} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Destination</p>
            <p className={cn(
              "font-medium truncate",
              dropoffLocation ? "text-foreground" : "text-muted-foreground"
            )}>
              {dropoffLocation?.name || 'Select destination'}
            </p>
          </div>
          {activeSelector === 'dropoff' && (
            <span className="text-xs text-blue-600 font-medium shrink-0">Selecting</span>
          )}
        </button>
      </div>

      {/* Quick Landmark Chips */}
      {activeSelector && !searchQuery.trim() && (
        <div className="px-4 pt-3">
          <SectionHeader
            title={gpsState.coords ? 'Nearby' : 'Popular'}
            className="mb-2"
          />
          <LandmarkChips
            landmarks={nearbyLandmarks}
            onSelect={handleLandmarkSelect}
            loading={landmarksLoading}
            maxChips={6}
          />
        </div>
      )}

      {/* Landmarks Section */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {/* Search Input */}
        <div className="p-4 pb-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <InputField
              placeholder={`Search ${activeSelector === 'pickup' ? 'pickup' : 'destination'}...`}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
        </div>

        {/* Landmarks List */}
        <div className="px-4 pb-4 flex-1 overflow-auto">
          {searchQuery.trim() && (
            <>
              {landmarksLoading ? (
                <div className="grid grid-cols-2 gap-2">
                  {[...Array(4)].map((_, i) => (
                    <div key={i} className="h-16 bg-secondary animate-pulse rounded-lg" />
                  ))}
                </div>
              ) : filteredLandmarks.length === 0 ? (
                <div className="py-4">
                  <EmptyState
                    title={`No landmarks found for "${searchQuery}"`}
                    description="Try tapping on the map instead"
                    action={gpsState.coords && (() => {
                      const nearest = findNearestLandmark(gpsState.coords.lat, gpsState.coords.lng);
                      if (!nearest) return null;
                      return (
                        <button
                          onClick={() => handleLandmarkSelect(nearest)}
                          className="mt-1 px-4 py-2 bg-accent/10 hover:bg-accent/20 rounded-2xl text-accent text-sm transition-colors"
                        >
                          Use nearest: {nearest.name}
                        </button>
                      );
                    })()}
                  />
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2 max-h-[200px] overflow-y-auto">
                  {filteredLandmarks.map((landmark) => {
                    const isSelected = 
                      (activeSelector === 'pickup' && pickupLocation?.name === landmark.name) ||
                      (activeSelector === 'dropoff' && dropoffLocation?.name === landmark.name);

                    return (
                      <button
                        key={landmark.id}
                        onClick={() => handleLandmarkSelect(landmark)}
                        disabled={!activeSelector}
                        className={cn(
                          "p-3 rounded-lg border text-left transition-all",
                          isSelected
                            ? "border-accent bg-accent/10"
                            : "border-border hover:border-accent/50 hover:bg-secondary/50",
                          !activeSelector && "opacity-50 cursor-not-allowed"
                        )}
                      >
                        <p className="font-medium text-sm text-foreground truncate">
                          {landmark.name}
                        </p>
                        <div className="flex items-center justify-between mt-1">
                          <span className="text-xs text-muted-foreground capitalize">
                            {landmark.category}
                          </span>
                          {landmark.distance !== undefined && (
                            <span className="text-xs text-accent font-medium">
                              {formatDistance(landmark.distance)}
                            </span>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </GlassCard>
  );
};

export default LocationPanel;
