import { useState, useEffect } from 'react';
import { Calendar, ChevronDown, Clock, Navigation2, Timer, Loader2, Star, ArrowRight, Moon, AlertCircle, Car } from 'lucide-react';
import { Button } from '@/components/ui/button';
import LocationInput from '@/components/LocationInput';
import LocationPanel from '@/components/LocationPanel';
import VehicleTypeSelector, { VEHICLE_TYPES, type VehicleType } from '@/components/VehicleTypeSelector';
import ErrorBoundary from '@/components/ErrorBoundary';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import { calculateRecommendedFare } from '@/hooks/useTownPricing';
import { usePricingSettings } from '@/hooks/usePricingSettings';
import { useRouteEstimate } from '@/hooks/useRouteEstimate';
import { requestRide } from '@/lib/requestRide';

interface HeroSectionProps {
  onLoginClick?: () => void;
}

const HeroSection = ({ onLoginClick }: HeroSectionProps) => {
  const { user } = useAuth();
  const { data: pricingSettings } = usePricingSettings();
  const [pickupType, setPickupType] = useState<'now' | 'later'>('now');
  const [pickupLocation, setPickupLocation] = useState('');
  const [dropoffLocation, setDropoffLocation] = useState('');
  const [showPickupDropdown, setShowPickupDropdown] = useState(false);
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [selectedVehicle, setSelectedVehicle] = useState<VehicleType>(VEHICLE_TYPES[0]);
  const [isRequesting, setIsRequesting] = useState(false);
  
  // Location coordinates
  const [pickupCoords, setPickupCoords] = useState<{ lng: number; lat: number } | null>(null);
  const [dropoffCoords, setDropoffCoords] = useState<{ lng: number; lat: number } | null>(null);

  const { route: routeEstimate, loading: routeLoading, error: routeError } = useRouteEstimate(
    pickupCoords ? { lat: pickupCoords.lat, lng: pickupCoords.lng } : null,
    dropoffCoords ? { lat: dropoffCoords.lat, lng: dropoffCoords.lng } : null
  );

  // Pricing settings no longer needed for legacy config

  // Get user location on mount for nearby landmarks
  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setUserLocation({
            lat: position.coords.latitude,
            lng: position.coords.longitude,
          });
        },
        () => {
          // Default to Gwanda center if geolocation fails
          setUserLocation({ lat: -20.9389, lng: 29.0147 });
        }
      );
    }
  }, []);

  const handlePickupSelect = (location: { name: string; lng: number; lat: number }) => {
    setPickupLocation(location.name);
    setPickupCoords({ lng: location.lng, lat: location.lat });
  };

  const handleDropoffSelect = (location: { name: string; lng: number; lat: number }) => {
    setDropoffLocation(location.name);
    setDropoffCoords({ lng: location.lng, lat: location.lat });
  };

  // Handle location panel selections
  const handlePanelPickupSelect = (location: { name: string; lat: number; lng: number }) => {
    setPickupLocation(location.name);
    setPickupCoords({ lng: location.lng, lat: location.lat });
  };

  const handlePanelDropoffSelect = (location: { name: string; lat: number; lng: number }) => {
    setDropoffLocation(location.name);
    setDropoffCoords({ lng: location.lng, lat: location.lat });
  };

  const routeInfo = routeEstimate ? {
    distance: routeEstimate.distanceKm,
    duration: routeEstimate.durationMinutes,
    durationInTraffic: routeEstimate.durationInTrafficMinutes,
    geometry: routeEstimate.geometry,
    isEstimate: routeEstimate.isEstimate,
    isTrafficAware: routeEstimate.isTrafficAware,
  } : null;

  // Calculate fare using USD town pricing
  const fareCalc = pickupCoords && dropoffCoords && routeInfo
    ? calculateRecommendedFare(
        { id: '', town_id: 'default', town_name: 'Zimbabwe', currency_code: 'USD', currency_symbol: '$', base_fare: 1.5, per_km_rate: 1, minimum_fare: 1.5, offer_floor: 1, offer_ceiling: 50, short_trip_fare: 1.5, short_trip_km: 2, night_multiplier: 1.2, demand_multiplier: 1, is_negotiation_enabled: true },
        routeInfo.distance,
        routeInfo.duration
      )
    : null;
  const currentFare = fareCalc?.recommended ?? null;

  // Handle ride request
  const handleRequestRide = async () => {
    if (!user) {
      toast.error('Please log in to request a ride');
      return;
    }

    if (!pickupCoords || !dropoffCoords || !routeInfo || !currentFare) {
      toast.error('Please select pickup and dropoff locations');
      return;
    }

    setIsRequesting(true);

    try {
      const result = await requestRide({
        pickup_address: pickupLocation,
        pickup_lat: pickupCoords.lat,
        pickup_lng: pickupCoords.lng,
        dropoff_address: dropoffLocation,
        dropoff_lat: dropoffCoords.lat,
        dropoff_lng: dropoffCoords.lng,
        distance_km: routeInfo.distance,
        duration_minutes: routeInfo.duration,
        fare: currentFare,
        vehicle_type: selectedVehicle.id,
        route_polyline: null, // No polyline without map API
        payment_method: 'cash',
      });

      if (!result.ok) throw new Error(result.error);

      toast.success(
        `Ride confirmed! ${selectedVehicle.name} • $${currentFare} • ${routeInfo.distance}km`,
        { description: `From ${pickupLocation} to ${dropoffLocation}. A driver will be assigned shortly.`, duration: 6000 }
      );
      
      // Reset form after successful request
      setPickupLocation('');
      setDropoffLocation('');
      setPickupCoords(null);
      setDropoffCoords(null);
    } catch (error) {
      console.error('Failed to request ride:', error);
      toast.error('Failed to request ride. Please try again.');
    } finally {
      setIsRequesting(false);
    }
  };

  const handleUseMyLocation = () => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const coords = {
            lng: position.coords.longitude,
            lat: position.coords.latitude,
          };
          setPickupCoords(coords);
          setPickupLocation('My Current Location');
          setUserLocation({ lat: coords.lat, lng: coords.lng });
        },
        (error) => {
          console.error('Error getting location:', error);
          toast.error('Could not get your location. Please select a landmark.');
        }
      );
    }
  };

  return (
    <section className="relative bg-background">
      <div className="cruixe-container py-8 lg:py-16">
        <div className="flex flex-col lg:flex-row lg:items-start lg:gap-12">
          {/* Left Side - Ride Request Card */}
          <div className="w-full lg:w-[420px] shrink-0 z-10">
            {/* Trust Badge */}
            <div className="flex justify-center lg:justify-start mb-4">
              <div className="inline-flex items-center gap-2 px-4 py-2 bg-primary/10 text-primary rounded-full text-sm font-medium">
                <Star className="w-4 h-4 fill-current" />
                Trusted by 50,000+ riders
              </div>
            </div>

            <h1 className="text-4xl lg:text-5xl font-bold mb-6 lg:mb-8 leading-tight text-center lg:text-left">
              <span className="text-foreground">Get picked.</span>{' '}
              <span className="text-primary">Get moving.</span>
            </h1>
            
            <p className="text-muted-foreground text-center lg:text-left mb-6">
              Get where you need to go with safe, reliable rides at your fingertips. Book in seconds, ride in minutes.
            </p>

            <div className="bg-card rounded-xl shadow-cruixe-card p-6 animate-slide-up">
              {/* Pickup Type Selector */}
              <div className="relative mb-4">
                <button
                  onClick={() => setShowPickupDropdown(!showPickupDropdown)}
                  className="flex items-center gap-2 px-4 py-2 bg-secondary rounded-full hover:bg-cruixe-gray-300 transition-colors"
                >
                  {pickupType === 'now' ? (
                    <>
                      <Clock className="w-4 h-4" />
                      <span className="font-medium">Pickup now</span>
                    </>
                  ) : (
                    <>
                      <Calendar className="w-4 h-4" />
                      <span className="font-medium">Schedule for later</span>
                    </>
                  )}
                  <ChevronDown className="w-4 h-4" />
                </button>

                {showPickupDropdown && (
                  <div className="absolute top-full left-0 mt-2 bg-card rounded-lg shadow-cruixe-lg border border-border overflow-hidden z-20 animate-fade-in">
                    <button
                      onClick={() => {
                        setPickupType('now');
                        setShowPickupDropdown(false);
                      }}
                      className={`w-full px-4 py-3 text-left hover:bg-secondary transition-colors flex items-center gap-3 ${
                        pickupType === 'now' ? 'bg-secondary' : ''
                      }`}
                    >
                      <Clock className="w-5 h-5" />
                      <span>Pickup now</span>
                    </button>
                    <button
                      onClick={() => {
                        setPickupType('later');
                        setShowPickupDropdown(false);
                      }}
                      className={`w-full px-4 py-3 text-left hover:bg-secondary transition-colors flex items-center gap-3 ${
                        pickupType === 'later' ? 'bg-secondary' : ''
                      }`}
                    >
                      <Calendar className="w-5 h-5" />
                      <span>Schedule for later</span>
                    </button>
                  </div>
                )}
              </div>

              {/* Location Inputs */}
              <div className="space-y-3">
                {/* Pickup Location */}
                <LocationInput
                  placeholder="Enter pickup location"
                  value={pickupLocation}
                  onChange={setPickupLocation}
                  onLocationSelect={handlePickupSelect}
                  onUseMyLocation={handleUseMyLocation}
                  showMyLocation={true}
                  markerType="pickup"
                  userLocation={userLocation}
                />

                {/* Dropoff Location */}
                <LocationInput
                  placeholder="Where to?"
                  value={dropoffLocation}
                  onChange={setDropoffLocation}
                  onLocationSelect={handleDropoffSelect}
                  markerType="dropoff"
                  userLocation={userLocation}
                />
              </div>

              {/* Vehicle Type Selector - show when both locations are selected */}
              {routeInfo && pickupCoords && dropoffCoords && (
                <div className="mt-4 animate-fade-in">
                  <VehicleTypeSelector
                    selectedType={selectedVehicle}
                    onSelect={setSelectedVehicle}
                    distanceKm={routeInfo.distance}
                    fareUsd={currentFare ?? undefined}
                  />
                </div>
              )}

              {/* Route Loading State */}
              {routeLoading && pickupCoords && dropoffCoords && (
                <div className="mt-4 p-4 bg-secondary rounded-xl animate-fade-in flex items-center gap-3">
                  <Loader2 className="w-5 h-5 animate-spin text-accent" />
                  <span className="text-sm text-muted-foreground">Calculating route with traffic...</span>
                </div>
              )}

              {/* Fare Estimate Card */}
              {routeInfo && currentFare && !routeLoading && (
                <div className="mt-4 p-4 bg-accent/10 rounded-xl border border-accent/20 animate-fade-in">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-2xl font-bold text-foreground">${currentFare.toFixed(2)}</span>
                    </div>
                    <div className="text-right text-sm text-muted-foreground">
                      <div className="flex items-center gap-1">
                        <Navigation2 className="w-4 h-4 text-accent" />
                        <span>{routeInfo.distance} km</span>
                        {routeInfo.isEstimate && (
                          <span className="text-xs text-amber-600">(est.)</span>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        <Timer className="w-4 h-4 text-accent" />
                        <span>~{routeInfo.durationInTraffic ?? routeInfo.duration} min</span>
                        {routeInfo.isTrafficAware && (
                          <span className="w-3 h-3 rounded-full bg-green-500" aria-label="Traffic-aware ETA" />
                        )}
                      </div>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    USD fare estimate
                    {routeInfo.isTrafficAware && ' • Live traffic'}
                    {routeInfo.isEstimate && ' • Estimated route'}
                  </p>
                </div>
              )}

              {/* Route Error */}
              {routeError && pickupCoords && dropoffCoords && !routeInfo?.isTrafficAware && (
                <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-xl flex items-center gap-2 text-sm text-amber-700">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>Using estimated distance. Live routing unavailable.</span>
                </div>
              )}

              {/* Request Ride Button */}
              <Button 
                className="cruixe-btn-primary w-full mt-4" 
                disabled={!routeInfo || !currentFare || isRequesting}
                onClick={handleRequestRide}
              >
                {isRequesting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                    Finding driver...
                  </>
                ) : routeInfo && currentFare ? (
                  `Request CruiXe - $${currentFare}`
                ) : (
                  <>
                    Find a ride
                    <ArrowRight className="w-4 h-4 ml-2" />
                  </>
                )}
              </Button>

              {/* Login prompt for non-authenticated users */}
              {!user && (
                <p className="text-center text-muted-foreground text-sm mt-4">
                  <button 
                    onClick={onLoginClick}
                    className="text-foreground underline underline-offset-2 hover:no-underline"
                  >
                    Log in
                  </button>{' '}
                  to request rides and view history
                </p>
              )}
            </div>
          </div>

          {/* Right Side - Location Panel (GPS + Landmarks + OSM Map) */}
          <div className="flex-1 mt-8 lg:mt-0">
            <ErrorBoundary>
              <LocationPanel
                pickupLocation={pickupCoords ? { name: pickupLocation, lat: pickupCoords.lat, lng: pickupCoords.lng } : null}
                dropoffLocation={dropoffCoords ? { name: dropoffLocation, lat: dropoffCoords.lat, lng: dropoffCoords.lng } : null}
                onPickupSelect={handlePanelPickupSelect}
                onDropoffSelect={handlePanelDropoffSelect}
                routeGeometry={routeInfo?.geometry}
                className="h-[500px] lg:h-[600px] shadow-cruixe-xl"
              />
            </ErrorBoundary>
          </div>
        </div>
      </div>
    </section>
  );
};

export default HeroSection;
