/* eslint-disable react-hooks/exhaustive-deps */
import { useState, useCallback, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { useNavigate, useLocation } from 'react-router-dom';
import { haptic } from '@/lib/haptics';
import { useAuth } from '@/hooks/useAuth';
import EmailVerificationBanner from '@/components/auth/EmailVerificationBanner';
import { useOSRMRoute } from '@/hooks/useOSRMRoute';
import { usePricingSettings } from '@/hooks/usePricingSettings';
import { useLandmarks } from '@/hooks/useLandmarks';
import { supabase } from '@/lib/supabaseClient';
import { requestRide } from '@/lib/requestRide';
import { searchZW, reverseZW } from '@/lib/geo_osm';
import { cachePlaceFromNominatim } from '@/lib/placeCache';
import { searchCachedPlacesPrefix } from '@/lib/placeCache';
import { useToast } from '@/hooks/use-toast';
import { useGooglePlacesAutocomplete } from '@/hooks/useGooglePlacesAutocomplete';
import { useTownPricing, calculateRecommendedFare, formatFare } from '@/hooks/useTownPricing';
import { uuid } from '@/lib/uuid';
import { useStudentDiscountAvailable } from '@/hooks/useStudentProfile';

import BottomNavBar from '@/components/BottomNavBar';
import { useWallet } from '@/hooks/useWallet';
// import PaymentMethodSelector from './PaymentMethodSelector'; // Hidden on ride view — kept in profile
import { Button } from '@/components/ui/button';
import {
  Loader2, MapPin, Navigation, Crosshair, ArrowLeft, User, X, Search,
  Car, Star, Phone, MessageCircle, Clock, Users, ChevronRight, Locate,
  Banknote, Wallet, Zap, CarFront, Menu, History, Minus, Plus, Route, ContactRound } from
'lucide-react';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle } from
'@/components/ui/sheet';
import { cn } from '@/lib/utils';
import MapGoogle from '@/components/MapGoogle';
import RideStatusBanner, { type RideStatus } from './RideStatusBanner';
import OffersModal, { type DriverViewing, type DriverOffer } from '@/components/OffersModal';
import AuthModalWrapper from '@/components/auth/AuthModalWrapper';
import PickMeLogo from '@/components/PickMeLogo';
import { GlassSheet } from '@/components/ui/glass-sheet';
import { SecondaryButton } from '@/components/ui/secondary-button';
import { PrimaryButton } from '@/components/ui/primary-button';
import { InputField } from '@/components/ui/input-field';
import { IconPillButton } from '@/components/ui/icon-pill-button';
import QuickPickChips from './QuickPickChips';
import ProximityFilter from './ProximityFilter';
import EmergencyButton from './EmergencyButton';
import { NotificationBell } from '@/components/NotificationCenter';

import RecentDestinations from './RecentDestinations';
import MultiStopInput, { type RideStop } from './MultiStopInput';
import ScheduleRide from './ScheduleRide';
import { useLandmarks as useLandmarksSearch, type Landmark } from '@/hooks/useLandmarks';
import { DEFAULT_TOWN, detectTown, type TownConfig } from '@/lib/towns';
import TownSelectorSheet from './TownSelectorSheet';
import ShareTripButton from './ShareTripButton';
import { useRiderPreferences } from '@/components/settings/RiderPreferencesSettings';

// ── types ──
import { type ServiceType } from '@/components/VehicleTypeSelector';
import IntercitySelector from './IntercitySelector';
import { type IntercityRoute } from '@/lib/intercityRoutes';
import { useNearbyDrivers } from '@/hooks/useNearbyDrivers';
import GenderPreferenceToggle, { type GenderPreference } from './GenderPreferenceToggle';
import ContactPickerSheet from './ContactPickerSheet';

interface SelectedLocation {name: string;lat: number;lng: number;}
interface GPSState {status: 'idle' | 'loading' | 'success' | 'denied' | 'unavailable';coords: {lat: number;lng: number;} | null;error: string | null;}
type VehicleTier = 'standard';
type PaymentMethod = 'cash' | 'wallet';

const SERVICE_TABS: {id: ServiceType;label: string;icon: string;}[] = [
{ id: 'ride', label: 'Ride', icon: '🚗' },
{ id: 'intercity', label: 'Intercity', icon: '🛣️' },
{ id: 'courier', label: 'Courier', icon: '📦' },
{ id: 'freight', label: 'Freight', icon: '🚛' }];


const VEHICLE_TIERS: {id: VehicleTier;name: string;icon: typeof Car;priceRange: string;passengers: string;eta: string;multiplier: number;}[] = [
{ id: 'standard', name: 'PickMe Standard', icon: Car, priceRange: '$1.50 – $10', passengers: '1–4', eta: '3 min', multiplier: 1 }];


export default function RideView() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();
  const { data: pricingSettings } = usePricingSettings();
  const { findNearestLandmark } = useLandmarks({});

  // ── state ──
  const [pickupLocation, setPickupLocation] = useState<SelectedLocation | null>(null);
  const [dropoffLocation, setDropoffLocation] = useState<SelectedLocation | null>(null);
  const [serviceType, setServiceType] = useState<ServiceType>('ride');
  const [gpsState, setGpsState] = useState<GPSState>({ status: 'idle', coords: null, error: null });
  const [activeField, setActiveField] = useState<'pickup' | 'dropoff' | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [proximityRadius, setProximityRadius] = useState<number | null>(null);
  const [nominatimResults, setNominatimResults] = useState<Array<{name: string;lat: number;lng: number;displayName: string;}>>([]);
  const [cachedPlaceResults, setCachedPlaceResults] = useState<Array<{name: string;lat: number;lng: number;displayName: string;}>>([]);
  const [nominatimLoading, setNominatimLoading] = useState(false);
  const [cachedPlacesLoading, setCachedPlacesLoading] = useState(false);
  const nominatimDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [reverseGeoLoading, setReverseGeoLoading] = useState(false);
  const [selectedTier, setSelectedTier] = useState<VehicleTier>('standard');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [showPaymentPrompt, setShowPaymentPrompt] = useState<{ open: boolean; fare: number }>({ open: false, fare: 0 });
  const { balance: walletBalance } = useWallet();
  const [passengerCount, setPassengerCount] = useState(1);
  const [bookForSomeoneElse, setBookForSomeoneElse] = useState(false);
  const [passengerName, setPassengerName] = useState('');
  const [passengerPhone, setPassengerPhone] = useState('');
  const [contactPickerOpen, setContactPickerOpen] = useState(false);
  const [rideStatus, setRideStatus] = useState<RideStatus>('idle');
  const [isRequesting, setIsRequesting] = useState(false);
  const [currentRideId, setCurrentRideId] = useState<string | null>(null);
  const [matchedDriver, setMatchedDriver] = useState<{name: string;car: string;plate: string;rating: number;avatar?: string;eta: number;} | null>(null);
  const [offersOpen, setOffersOpen] = useState(false);
  const [viewingDrivers, setViewingDrivers] = useState<DriverViewing[]>([]);
  const [offers, setOffers] = useState<DriverOffer[]>([]);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'signup'>('login');
  const [sheetExpanded, setSheetExpanded] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [selectedTown, setSelectedTown] = useState<TownConfig>(DEFAULT_TOWN);
  const [rideStops, setRideStops] = useState<RideStop[]>([]);
  const [scheduledAt, setScheduledAt] = useState<Date | null>(null);
  const [activeStopId, setActiveStopId] = useState<string | null>(null);
  const { pricing: townPricing } = useTownPricing(selectedTown?.id ?? null);
  const { prefs: riderPrefs, loaded: prefsLoaded } = useRiderPreferences();
  const genderPreference = riderPrefs.gender === 'female' ? (riderPrefs.gender_preference as GenderPreference) : 'any';
  const quietRide = riderPrefs.quiet_ride;
  const coolTemp = riderPrefs.cool_temperature;
  const wavRequired = riderPrefs.wav_required;
  const hearingImpaired = riderPrefs.hearing_impaired;

  const { landmarks, loading: landmarksLoading } = useLandmarksSearch({ searchQuery, limit: 30, userLocation: gpsState.coords, radiusKm: proximityRadius, townCenter: selectedTown.center, townRadiusKm: selectedTown.radiusKm });
  const nearbyDrivers = useNearbyDrivers(rideStatus === 'idle' || rideStatus === 'searching');
  const { suggestions: googleSuggestions, loading: googleLoading, search: searchGoogle, getPlaceDetails, clear: clearGoogleSuggestions, setTownBias } = useGooglePlacesAutocomplete();

  // Restrict Google Places to selected town (strict geofence)
  useEffect(() => {
    const vb = selectedTown.nominatimViewbox;
    const viewbox = `${vb.left},${vb.top},${vb.right},${vb.bottom}`;
    setTownBias(selectedTown.center, selectedTown.radiusKm, viewbox);
  }, [selectedTown, setTownBias]);

  // ── effects ──
  useEffect(() => {
    const rebook = (location.state as Record<string, unknown>)?.rebook as Record<string, unknown> | undefined;
    if (rebook) {
      if (rebook.pickup) setPickupLocation(rebook.pickup as SelectedLocation);
      if (rebook.dropoff) setDropoffLocation(rebook.dropoff as SelectedLocation);
      window.history.replaceState({}, '');
    }
  }, []);

  useEffect(() => {
    if (gpsState.status === 'idle' && navigator.geolocation) handleUseMyLocation();
  }, []);

  // ── route / fare ──
  const { route: routeData, loading: routeLoading } = useOSRMRoute(
    pickupLocation ? { lat: pickupLocation.lat, lng: pickupLocation.lng } : null,
    dropoffLocation ? { lat: dropoffLocation.lat, lng: dropoffLocation.lng } : null
  );

  const calculateFare = useCallback(() => {
    if (!routeData?.distanceKm) return null;
    const rec = calculateRecommendedFare(townPricing, routeData.distanceKm, routeData.durationMinutes);
    return { fareR: rec.recommended, distanceKm: routeData.distanceKm, durationMinutes: routeData.durationMinutes, currencySymbol: rec.currencySymbol, currencyCode: rec.currencyCode };
  }, [routeData, townPricing]);
  const fareEstimate = calculateFare();

  // Student discount: $1 off when verified & under daily cap
  const { available: studentDiscountAvailable, usedToday: studentRidesUsedToday, dailyCap: studentDailyCap } = useStudentDiscountAvailable();
  const STUDENT_DISCOUNT = 1;

  // ── handlers ──
  const handleUseMyLocation = useCallback(() => {
    if (!navigator.geolocation) {
      setGpsState({ status: 'unavailable', coords: null, error: 'Geolocation not supported' });
      // Fallback to Harare if no geolocation
      const defaultCity = DEFAULT_TOWN;
      setSelectedTown(defaultCity);
      return;
    }
    setGpsState((prev) => ({ ...prev, status: 'loading', error: null }));
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const c = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setGpsState({ status: 'success', coords: c, error: null });
        setPickupLocation({ name: 'My location', lat: c.lat, lng: c.lng });
        setActiveField(null);
        
        // Use detected town
        const detected = detectTown(c.lat, c.lng);
        setSelectedTown(detected);
        
        // Reverse geocode to get city name for better results
        try {
          const result = await reverseZW(c.lat, c.lng);
          const name = result?.name || result?.display_name?.split(',')[0] || 'My location';
          setPickupLocation({ name, lat: c.lat, lng: c.lng });
        } catch (e) {
          console.error('Reverse geocode error:', e);
        }
      },
      (err) => {
        setGpsState({ 
          status: 'denied', 
          coords: null, 
          error: err.code === err.PERMISSION_DENIED ? 'Location access denied' : 'Unable to get location' 
        });
        // Fallback to Harare on error
        setSelectedTown(DEFAULT_TOWN);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }, []);

  const handleLandmarkSelect = (landmark: Landmark) => {
    const loc: SelectedLocation = { name: landmark.name, lat: landmark.latitude, lng: landmark.longitude };
    if (activeStopId) {
      setRideStops((prev) => prev.map((s) => s.id === activeStopId ? { ...s, address: loc.name, lat: loc.lat, lng: loc.lng } : s));
      setActiveStopId(null);
    } else if (activeField === 'pickup') setPickupLocation(loc);else
    setDropoffLocation(loc);
    setActiveField(null);setSearchQuery('');setNominatimResults([]);
    haptic('light');
  };

  const handleNominatimSelect = (result: {name: string;lat: number;lng: number;}) => {
    const loc: SelectedLocation = { name: result.name, lat: result.lat, lng: result.lng };
    if (activeStopId) {
      setRideStops((prev) => prev.map((s) => s.id === activeStopId ? { ...s, address: loc.name, lat: loc.lat, lng: loc.lng } : s));
      setActiveStopId(null);
    } else if (activeField === 'pickup') setPickupLocation(loc);else
    setDropoffLocation(loc);
    setActiveField(null);setSearchQuery('');setNominatimResults([]);
  };

  const handleQuickPickSelect = (pick: {name: string;lat: number;lng: number;}) => {
    const loc: SelectedLocation = { name: pick.name, lat: pick.lat, lng: pick.lng };
    if (activeField === 'pickup') setPickupLocation(loc);else if (activeField === 'dropoff') setDropoffLocation(loc);
    setActiveField(null);
  };

  const handleSwapPickupDropoff = () => {
    if (!pickupLocation && !dropoffLocation) return;
    setPickupLocation(dropoffLocation);
    setDropoffLocation(pickupLocation);
    haptic('light');
  };

  const handleRecentPlaceSelect = (loc: {name: string;lat: number;lng: number;}) => {
    const selected: SelectedLocation = { name: loc.name, lat: loc.lat, lng: loc.lng };
    if (activeField === 'pickup') {
      setPickupLocation(selected);
      setActiveField('dropoff');
    } else if (activeField === 'dropoff') {
      setDropoffLocation(selected);
      setActiveField(null);
    } else if (!pickupLocation) {
      setPickupLocation(selected);
      setActiveField('dropoff');
    } else {
      setDropoffLocation(selected);
    }
    haptic('light');
  };

  const handleNominatimSearch = useCallback((query: string) => {
    if (nominatimDebounceRef.current) clearTimeout(nominatimDebounceRef.current);
    if (query.trim().length < 3) {setNominatimResults([]);setNominatimLoading(false);return;}
    setNominatimLoading(true);
    nominatimDebounceRef.current = setTimeout(async () => {
      try {
        // Strict town-bounded search: only show results within the selected town
        const results = await searchZW(query.trim(), 20, selectedTown.nominatimViewbox, true);
        const mapped = results.map((r) => ({ name: r.name || r.display_name.split(',')[0], lat: Number(r.lat), lng: Number(r.lon), displayName: r.display_name, category: '' }));
        
        // If bounded search returned nothing, try unbounded as fallback (but still with viewbox bias)
        if (mapped.length === 0) {
          const fallback = await searchZW(query.trim(), 10, selectedTown.nominatimViewbox, false);
          // Filter results to only include those within the town's max distance
          const { getDistance } = await import('@/lib/towns');
          const filtered = fallback
            .map((r) => ({ name: r.name || r.display_name.split(',')[0], lat: Number(r.lat), lng: Number(r.lon), displayName: r.display_name, category: '' }))
            .filter((r) => getDistance(selectedTown.center.lat, selectedTown.center.lng, r.lat, r.lng) <= selectedTown.maxDistanceKm);
          setNominatimResults(filtered);
          for (const r of fallback) cachePlaceFromNominatim(r).catch(() => {});
        } else {
          setNominatimResults(mapped);
          for (const r of results) cachePlaceFromNominatim(r).catch(() => {});
        }
      } catch {setNominatimResults([]);} finally {setNominatimLoading(false);}
    }, 150);
  }, [selectedTown]);

  const handleCachedPlacesSearch = useCallback((query: string) => {
    const trimmed = query.trim();
    if (trimmed.length < 3) {
      setCachedPlaceResults([]);
      setCachedPlacesLoading(false);
      return;
    }

    setCachedPlacesLoading(true);
    searchCachedPlacesPrefix(trimmed, 12)
      .then((results) => {
        setCachedPlaceResults(results.map((row) => ({
          name: row.name || row.display_name.split(',')[0],
          lat: Number(row.lat),
          lng: Number(row.lon),
          displayName: row.display_name,
        })));
      })
      .catch(() => setCachedPlaceResults([]))
      .finally(() => setCachedPlacesLoading(false));
  }, []);

  const handleMapClick = useCallback(async (coords: {lat: number;lng: number;}) => {
    if (!activeField) return;
    setReverseGeoLoading(true);
    try {
      const result = await reverseZW(coords.lat, coords.lng);
      const name = result?.name || result?.display_name?.split(',')[0] || `${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}`;
      const loc: SelectedLocation = { name, lat: coords.lat, lng: coords.lng };
      if (activeField === 'pickup') {setPickupLocation(loc);setActiveField('dropoff');} else {setDropoffLocation(loc);setActiveField(null);}
      if (result) cachePlaceFromNominatim(result).catch(() => {});
    } catch {
      const loc: SelectedLocation = { name: `${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}`, lat: coords.lat, lng: coords.lng };
      if (activeField === 'pickup') {setPickupLocation(loc);setActiveField('dropoff');} else {setDropoffLocation(loc);setActiveField(null);}
    } finally {setReverseGeoLoading(false);}
  }, [activeField]);

  const handlePickPassengerFromContacts = () => {
    setContactPickerOpen(true);
  };

  const handleContactSelected = (name: string, phone: string) => {
    setPassengerName(name);
    setPassengerPhone(phone);
    haptic('light');
    toast({ title: '✅ Contact selected', description: `${name} — ${phone}` });
  };

  const handleSendOffer = async (customFare: number, methodOverride?: PaymentMethod) => {
    const method = methodOverride ?? paymentMethod;
    if (!user) {setAuthMode('login');setAuthModalOpen(true);return;}
    if (!pickupLocation || !dropoffLocation || !fareEstimate) {toast({ title: 'Select pickup and destination', variant: 'destructive' });return;}
    if (method === 'wallet' && walletBalance < customFare) {
      toast({
        title: 'Insufficient wallet balance',
        description: `You need $${customFare.toFixed(2)} but only have $${walletBalance.toFixed(2)}. Please top up or select Cash Payment.`,
        variant: 'destructive',
        action: (
          <div className="flex gap-2">
            <button
              onClick={() => setPaymentMethod('cash')}
              className="px-3 py-1.5 rounded-lg bg-foreground text-background text-xs font-semibold"
            >
              Switch to Cash
            </button>
            <button
              onClick={() => navigate(location.pathname.startsWith('/mapp') ? '/mapp/wallet' : '/wallet')}
              className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold"
            >
              Top Up
            </button>
          </div>
        ),
      });
      return;
    }
    
    // ⚡ INSTANT UI RESPONSE — update state before network call
    haptic('medium');
    setIsRequesting(true);
    setRideStatus('searching');
    
    try {
      const result = await requestRide({
        pickup_address: pickupLocation.name, pickup_lat: pickupLocation.lat, pickup_lng: pickupLocation.lng,
        dropoff_address: dropoffLocation.name, dropoff_lat: dropoffLocation.lat, dropoff_lng: dropoffLocation.lng,
        distance_km: fareEstimate.distanceKm, duration_minutes: fareEstimate.durationMinutes,
        fare: customFare,
        route_polyline: routeData?.geometry || null, passenger_count: passengerCount,
        payment_method: method, vehicle_type: selectedTier,
        town_id: selectedTown?.id ?? null,
        gender_preference: genderPreference,
        ...(bookForSomeoneElse && passengerName.trim() ? { passenger_name: passengerName.trim() } : {}),
        ...(bookForSomeoneElse && passengerPhone.trim() ? { passenger_phone: passengerPhone.trim() } : {}),
        ...(scheduledAt ? { scheduled_at: scheduledAt.toISOString() } : {})
      });
      if (!result.ok) throw new Error(result.error);

      // Record student discount usage (best-effort)
      if (studentDiscountAvailable && result.ride?.id && user?.id) {
        supabase.from('student_discount_usage').insert([{
          user_id: user.id,
          ride_id: result.ride.id,
          discount_amount: STUDENT_DISCOUNT,
        }] as never).then(({ error }) => {
          if (error) console.error('Failed to record student discount:', error.message);
        });
      }

      // Save multi-stops if any
      if (rideStops.length > 0 && result.ride.id) {
        const stopsToInsert = rideStops.
        filter((s) => s.address && s.lat && s.lng).
        map((s, i) => ({
          ride_id: result.ride.id,
          stop_order: i + 1,
          address: s.address,
          latitude: s.lat,
          longitude: s.lng
        }));
        if (stopsToInsert.length > 0) {
          await supabase.from('ride_stops').insert(stopsToInsert);
        }
      }

      // Save ride preferences if any selected
      if (result.ride.id && (quietRide || coolTemp || wavRequired || hearingImpaired || genderPreference !== 'any')) {
        const prefsPayload = {
          ride_id: result.ride.id,
          quiet_ride: quietRide,
          cool_temperature: coolTemp,
          wav_required: wavRequired,
          hearing_impaired: hearingImpaired,
          gender_preference: genderPreference,
        };
        supabase.from('ride_preferences').insert([prefsPayload] as never).then(({ error }) => {
          if (error) console.error('Failed to save ride preferences:', error.message);
        });
      }

      // Notify passenger if booking for someone else
      if (bookForSomeoneElse && passengerPhone.trim() && result.ride.id) {
        const bookerName = user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'Someone';

        // Look up user by phone in profiles
        const { data: passengerProfile } = await supabase
          .from('profiles')
          .select('user_id')
          .eq('phone', passengerPhone.trim())
          .maybeSingle();

        if (passengerProfile?.user_id) {
          // User exists — send in-app notification
          await supabase.from('notifications').insert({
            user_id: passengerProfile.user_id,
            title: '🚗 Ride booked for you!',
            body: `${bookerName} has requested a ride for you from ${pickupLocation!.name} to ${dropoffLocation!.name}.`,
            notification_type: 'ride_requested',
          });
        } else {
          // User doesn't exist — send SMS invite
          try {
            const session = (await supabase.auth.getSession()).data.session;
            if (session?.access_token) {
              fetch(
                `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sms-invite`,
                {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${session.access_token}`,
                  },
                  body: JSON.stringify({
                    phone: passengerPhone.trim(),
                    bookerName,
                    pickup: pickupLocation!.name,
                    dropoff: dropoffLocation!.name,
                  }),
                }
              ).then(res => {
                if (res.ok) {
                  toast({ title: '📱 SMS sent', description: `Invite sent to ${passengerName || passengerPhone}` });
                }
              }).catch(() => {});
            }
          } catch {
            // SMS is best-effort
          }
        }
      }

      setCurrentRideId(result.ride.id);
      
      // ⚡ Navigate instantly — the ride detail page renders map immediately
      if (!scheduledAt) {
        navigate(`/ride/${result.ride.id}`, { replace: true });
      } else {
        toast({ title: 'Ride scheduled!', description: 'Your ride has been scheduled for later.' });
        setRideStatus('idle');setScheduledAt(null);setRideStops([]);
      }
    } catch (error: unknown) {toast({ title: 'Failed to send offer', description: (error as Error).message, variant: 'destructive' });setRideStatus('idle');} finally {setIsRequesting(false);}
  };

  const handleAddStop = () => {
    if (rideStops.length >= 3) return;
    setRideStops((prev) => [...prev, { id: uuid(), address: '', lat: 0, lng: 0 }]);
  };

  const handleRemoveStop = (id: string) => {
    setRideStops((prev) => prev.filter((s) => s.id !== id));
  };

  const handleStopClick = (id: string) => {
    setActiveStopId(id);
    setActiveField('dropoff'); // Reuse search overlay
    setSearchQuery('');
  };

  const handleAcceptOffer = async (offerId: string) => {setRideStatus('driver_assigned');setOffersOpen(false);toast({ title: 'Driver accepted!' });setMatchedDriver({ name: 'Sipho Ndlovu', car: 'Toyota Corolla', plate: 'ACB 2345', rating: 4.8, eta: 3 });setTimeout(() => setRideStatus('driver_arriving'), 2000);};
  const handleDeclineOffer = async (offerId: string) => {setOffers((prev) => prev.filter((o) => o.offerId !== offerId));if (offers.length <= 1) setRideStatus('searching');};
  const handleCancelRide = async () => {if (currentRideId) await supabase.from('rides').update({ status: 'cancelled' }).eq('id', currentRideId);setRideStatus('idle');setCurrentRideId(null);setOffers([]);setViewingDrivers([]);setMatchedDriver(null);toast({ title: 'Ride cancelled' });};

  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
    if (value.trim().length >= 3) {searchGoogle(value);} else {clearGoogleSuggestions();}
    handleCachedPlacesSearch(value);
    // Only run Nominatim as silent fallback — don't show if Google has results
    handleNominatimSearch(value);
  };

  const handleGooglePlaceSelect = async (suggestion: {placeId: string;name: string;lat?: number;lng?: number;source?: string;}) => {
    // If coordinates already available (OSM source), use directly
    if (suggestion.lat && suggestion.lng) {
      const loc: SelectedLocation = { name: suggestion.name, lat: suggestion.lat, lng: suggestion.lng };
      if (activeField === 'pickup') setPickupLocation(loc);else setDropoffLocation(loc);
      setActiveField(null);setSearchQuery('');setNominatimResults([]);clearGoogleSuggestions();
      haptic('light');
      return;
    }
    // Google source — fetch details from server
    const details = await getPlaceDetails(suggestion.placeId, suggestion as any);
    if (!details) return;
    const loc: SelectedLocation = { name: suggestion.name, lat: details.lat, lng: details.lng };
    if (activeField === 'pickup') setPickupLocation(loc);else setDropoffLocation(loc);
    setActiveField(null);setSearchQuery('');setNominatimResults([]);clearGoogleSuggestions();
    haptic('light');
  };

  const canRequestRide = pickupLocation && dropoffLocation && fareEstimate && !isRequesting;
  const unifiedPlaceResults = [...cachedPlaceResults, ...googleSuggestions.map((item) => ({
    name: item.name,
    lat: item.lat ?? 0,
    lng: item.lng ?? 0,
    displayName: item.description,
    placeId: item.placeId,
    source: 'google' as const,
  })), ...nominatimResults.map((item) => ({ ...item, source: 'nominatim' as const }))]
    .filter((item, index, arr) => {
      const key = `${item.name}-${item.displayName}`.toLowerCase();
      return arr.findIndex((candidate) => `${candidate.name}-${candidate.displayName}`.toLowerCase() === key) === index;
    });

  // ═══════════════════════════════════════════
  // DRIVER MATCHED VIEW
  // ═══════════════════════════════════════════
  if (matchedDriver && (rideStatus === 'driver_assigned' || rideStatus === 'driver_arriving')) {
    return (
      <div className="relative h-[100dvh] w-full overflow-hidden bg-background">
        <div className="absolute inset-0">
          <MapGoogle pickup={pickupLocation} dropoff={dropoffLocation} routeGeometry={routeData?.geometry} defaultCenter={selectedTown.center} defaultZoom={14} className="w-full h-full" height="100%" stops={rideStops.filter(s => s.lat && s.lng)} />
        </div>

        {/* Top gradient */}
        <div className="absolute top-0 left-0 right-0 h-28 z-10 pointer-events-none" style={{ background: 'linear-gradient(to bottom, hsl(217 85% 29% / 0.12), transparent)' }} />

        {/* Header */}
        <div className="absolute top-0 left-0 right-0 z-40 flex items-center justify-between px-4" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 12px)' }}>
          <button onClick={handleCancelRide} className="w-12 h-12 flex items-center justify-center rounded-full glass-card active:scale-95 transition-all">
            <ArrowLeft className="w-5 h-5 text-primary" />
          </button>
          <PickMeLogo size="sm" />
          <div className="w-12" />
        </div>

        {/* ETA pill - animated */}
        <motion.div
          initial={{ y: -30, opacity: 0, scale: 0.9 }}
          animate={{ y: 0, opacity: 1, scale: 1 }}
          transition={{ type: 'spring', stiffness: 300, damping: 25, delay: 0.2 }}
          className="absolute top-24 left-4 right-4 z-30">
          
          <div className="glass-card-heavy p-5 flex items-center gap-4">
            <motion.div
              className="w-14 h-14 rounded-2xl flex items-center justify-center"
              style={{ background: 'var(--gradient-primary)' }}
              animate={{ scale: [1, 1.05, 1] }}
              transition={{ repeat: Infinity, duration: 2, ease: 'easeInOut' }}>
              
              <Clock className="w-7 h-7 text-primary-foreground" />
            </motion.div>
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Arriving in</p>
              <motion.p
                key={matchedDriver.eta}
                initial={{ scale: 1.2, color: 'hsl(45 100% 51%)' }}
                animate={{ scale: 1, color: 'hsl(var(--foreground))' }}
                className="text-3xl font-bold font-display text-foreground tabular-nums">
                
                {matchedDriver.eta} <span className="text-lg font-medium text-muted-foreground">min</span>
              </motion.p>
            </div>
          </div>
        </motion.div>

        {/* Driver card bottom - slide up animation */}
        <motion.div
          initial={{ y: 100, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 300, damping: 30, delay: 0.4 }}
          className="absolute bottom-0 left-0 right-0 z-50">
          
           <div className="glass-card-heavy rounded-t-[28px] overflow-hidden pb-5" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 20px)', borderBottomLeftRadius: 0, borderBottomRightRadius: 0 }}>
            {/* Blue top bar */}
            <div className="px-4 py-1.5 text-center text-[10px] font-bold tracking-wider uppercase bg-primary/10 text-primary">
              Ride Confirmed
            </div>
            <div className="px-4 pt-4">
            <div className="w-10 h-1 rounded-full bg-foreground/10 mx-auto mb-4" />
            <div className="flex items-center gap-3 mb-5">
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: 'spring', stiffness: 400, damping: 15, delay: 0.6 }}
                className="w-14 h-14 rounded-2xl flex items-center justify-center ring-2 ring-primary/20 shrink-0"
                style={{ background: 'var(--gradient-primary)' }}>
                
                <User className="w-7 h-7 text-primary-foreground" />
              </motion.div>
              <div className="flex-1 min-w-0">
                <p className="text-base font-semibold font-display text-foreground truncate">{matchedDriver.name}</p>
                <p className="text-sm text-muted-foreground truncate">{matchedDriver.car} · {matchedDriver.plate}</p>
              </div>
              <div className="flex items-center gap-1 glass-card rounded-full px-3 py-1.5 glass-glow-yellow shrink-0">
                <Star className="w-3.5 h-3.5 text-accent fill-accent" />
                <span className="text-sm font-bold text-foreground">{matchedDriver.rating}</span>
              </div>
            </div>
            <div className="grid grid-cols-4 gap-2">
              {[
              { icon: Phone, label: 'Call', bg: 'var(--gradient-primary)', textClass: 'text-primary-foreground' },
              { icon: MessageCircle, label: 'Message', bg: undefined, textClass: 'text-primary' },
              { icon: Navigation, label: 'Navigate', bg: undefined, textClass: 'text-emerald-500' },
              { icon: X, label: 'Cancel', bg: undefined, textClass: 'text-destructive' }].
              map((action, i) =>
              <motion.button
                key={action.label}
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.7 + i * 0.1, type: 'spring', stiffness: 400, damping: 25 }}
                onClick={action.label === 'Cancel' ? handleCancelRide : action.label === 'Navigate' ? () => {
                  if (dropoffLocation) {
                    const url = `https://www.google.com/maps/dir/?api=1&destination=${dropoffLocation.lat},${dropoffLocation.lng}&travelmode=driving`;
                    window.open(url, '_blank');
                  }
                } : undefined}
                className={cn(
                  'flex flex-col items-center gap-1.5 py-3 rounded-2xl active:scale-95 transition-all',
                  action.bg ? '' : action.label === 'Cancel' ? 'bg-destructive/8' : 'glass-card'
                )}
                style={action.bg ? { background: action.bg } : undefined}>
                
                  <action.icon className={cn('w-5 h-5', action.textClass)} />
                  <span className={cn('text-[11px] font-medium', action.bg ? 'text-primary-foreground' : action.textClass)}>{action.label}</span>
                </motion.button>
              )}
            </div>
            <div className="mt-3 flex justify-center">
              {currentRideId && pickupLocation && dropoffLocation &&
              <div className="mr-2">
                  <ShareTripButton
                  rideId={currentRideId}
                  pickupAddress={pickupLocation.name}
                  dropoffAddress={dropoffLocation.name}
                  driverName={matchedDriver.name} />
                
                </div>
              }
              <EmergencyButton
                rideId={currentRideId ?? undefined}
                pickupAddress={pickupLocation?.name}
                dropoffAddress={dropoffLocation?.name}
                driverName={matchedDriver.name} />
              
            </div>
            </div>
          </div>
        </motion.div>
      </div>);
  }

  // ═══════════════════════════════════════════
  // MAIN RIDE BOOKING UI
  // ═══════════════════════════════════════════
  return (
    <div className="relative h-[100dvh] w-full overflow-hidden bg-background">
      {/* ── MAP ── */}
      <div className="absolute inset-0">
        <MapGoogle pickup={pickupLocation} dropoff={dropoffLocation} routeGeometry={routeData?.geometry} onMapClick={handleMapClick} defaultCenter={selectedTown.center} defaultZoom={14} className="w-full h-full" height="100%" drivers={nearbyDrivers} stops={rideStops.filter(s => s.lat && s.lng)} suggestions={searchQuery.trim().length >= 3 ? googleSuggestions.slice(0, 5).map((s, i) => ({ id: s.placeId ?? String(i), name: s.name, lat: s.lat, lng: s.lng })) : undefined} />

        {/* Floating map buttons */}
        <div className="absolute right-3 z-20" style={{ bottom: sheetExpanded ? 'calc(70vh + 16px)' : 'calc(48vh + 16px)', transition: 'bottom 0.3s cubic-bezier(0.32,0.72,0,1)' }}>
          <div className="flex flex-col gap-2.5">
            <button onClick={handleUseMyLocation} className="w-11 h-11 rounded-full glass-card flex items-center justify-center active:scale-90 transition-all glass-glow-blue">
              {gpsState.status === 'loading' ? <Loader2 className="w-5 h-5 animate-spin text-primary" /> : <Locate className="w-5 h-5 text-primary" />}
            </button>
            <button className="w-11 h-11 rounded-full glass-card flex items-center justify-center active:scale-90 transition-all glass-glow-yellow">
              <Navigation className="w-5 h-5 text-accent" />
            </button>
          </div>
        </div>

        {/* Reverse geocode loading overlay */}
        {reverseGeoLoading &&
        <div className="absolute inset-0 bg-background/20 backdrop-blur-sm flex items-center justify-center z-30">
            <div className="glass-card-heavy rounded-full px-6 py-3.5 flex items-center gap-3">
              <Loader2 className="w-4 h-4 animate-spin text-primary" />
              <span className="text-sm font-medium text-foreground">Finding address…</span>
            </div>
          </div>
        }

        {/* Top gradient */}
        <div className="absolute top-0 left-0 right-0 h-28 z-10 pointer-events-none" style={{ background: 'linear-gradient(to bottom, hsl(217 85% 29% / 0.12), transparent)' }} />

        {/* Route loading */}
        {routeLoading && pickupLocation && dropoffLocation &&
        <div className="absolute inset-0 bg-background/20 backdrop-blur-sm flex items-center justify-center z-30">
            <div className="glass-card-heavy rounded-full px-6 py-3.5 flex items-center gap-3">
              <Loader2 className="w-4 h-4 animate-spin text-primary" />
              <span className="text-sm font-medium text-foreground">Calculating route…</span>
            </div>
          </div>
        }

        {/* Tap-map instruction */}
        {activeField && !reverseGeoLoading &&
        <div className="absolute top-4 left-4 right-4 z-30">
            <div className="glass-card-heavy px-5 py-3.5 text-sm font-medium text-center text-foreground">
              📍 Tap map to set {activeField === 'pickup' ? 'pickup' : 'drop-off'}
            </div>
          </div>
        }
      </div>

      {/* ── FLOATING MAP BUTTONS (no solid header) ── */}
      <div className="absolute top-0 left-0 right-0 z-40 flex items-center justify-between px-4 pointer-events-none" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 12px)' }}>
        <button onClick={() => setMenuOpen(true)} className="pointer-events-auto w-11 h-11 flex items-center justify-center rounded-full bg-card/90 backdrop-blur-md shadow-lg active:scale-95 transition-all">
          <Menu className="w-5 h-5 text-foreground" />
        </button>
        <div className="pointer-events-auto flex items-center gap-2">
          <NotificationBell />
          <button onClick={() => user ? navigate(location.pathname.startsWith('/mapp') ? '/mapp/profile' : '/profile') : setAuthModalOpen(true)} className="w-11 h-11 flex items-center justify-center rounded-full bg-card/90 backdrop-blur-md shadow-lg active:scale-95 transition-all">
            <User className="w-5 h-5 text-foreground" />
          </button>
        </div>
      </div>

      {/* ── HAMBURGER MENU ── */}
      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetContent side="left" className="w-[280px] p-0 border-r border-border/20" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 16px)' }}>
          <SheetHeader className="px-5 pb-2 pt-4">
            <SheetTitle><PickMeLogo size="sm" /></SheetTitle>
          </SheetHeader>
          <nav className="flex flex-col gap-1 px-3 mt-2">
            <button
              onClick={() => {setMenuOpen(false);navigate(location.pathname.startsWith('/mapp') ? '/mapp/profile' : '/profile');}}
              className="flex items-center gap-3 px-4 py-3.5 rounded-2xl text-left hover:bg-muted active:scale-[0.98] transition-all">
              
              <User className="w-5 h-5 text-primary" />
              <span className="text-[15px] font-semibold text-foreground">Profile</span>
            </button>
            <button
              onClick={() => {setMenuOpen(false);navigate(location.pathname.startsWith('/mapp') ? '/mapp/wallet' : '/wallet');}}
              className="flex items-center gap-3 px-4 py-3.5 rounded-2xl text-left hover:bg-muted active:scale-[0.98] transition-all">
              
              <Wallet className="w-5 h-5 text-primary" />
              <span className="text-[15px] font-semibold text-foreground">Wallet</span>
            </button>
            <button
              onClick={() => {setMenuOpen(false);navigate(location.pathname.startsWith('/mapp') ? '/mapp/history' : '/ride-history');}}
              className="flex items-center gap-3 px-4 py-3.5 rounded-2xl text-left hover:bg-muted active:scale-[0.98] transition-all">
              
              <History className="w-5 h-5 text-primary" />
              <span className="text-[15px] font-semibold text-foreground">History</span>
            </button>

            <div className="border-t border-border/30 my-1 mx-2" />
            <p className="px-4 pt-1 pb-0.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Services</p>

            {SERVICE_TABS.map((tab) =>
            <button
              key={tab.id}
              onClick={() => {setMenuOpen(false);setServiceType(tab.id);}}
              className={cn(
                "flex items-center gap-3 px-4 py-3.5 rounded-2xl text-left hover:bg-muted active:scale-[0.98] transition-all",
                serviceType === tab.id && "bg-primary/10"
              )}>
                <span className="text-lg">{tab.icon}</span>
                <span className={cn("text-[15px] font-semibold", serviceType === tab.id ? "text-primary" : "text-foreground")}>{tab.label}</span>
                {serviceType === tab.id && <span className="ml-auto text-[10px] font-bold text-primary bg-primary/10 px-2 py-0.5 rounded-full">Active</span>}
              </button>
            )}
          </nav>
        </SheetContent>
      </Sheet>

      {/* ── BOTTOM SHEET ── */}
      <GlassSheet
        className="absolute left-3 right-3 z-50 flex flex-col"
        style={{
          bottom: 8,
          height: sheetExpanded ? '70vh' : '48vh',
          transition: 'height 0.3s cubic-bezier(0.32,0.72,0,1)',
          paddingBottom: 'env(safe-area-inset-bottom)',
          borderTopLeftRadius: 28,
          borderTopRightRadius: 28
        }}>
        
        {/* Blue ribbon handle bar */}
        <button
          onClick={() => setSheetExpanded((e) => !e)}
          className="w-full py-3 flex justify-center shrink-0 rounded-t-[28px]"
          style={{ background: 'var(--gradient-primary)' }}>
          <div className="w-12 h-1.5 rounded-full bg-primary-foreground/40" />
        </button>

        {/* Scrollable content */}
        <div className="flex-1 px-4 pb-2 space-y-2.5 min-h-0 overflow-y-auto overscroll-contain">
          {/* Email verification gate */}
          {user?.email && !user?.email_confirmed_at && (
            <EmailVerificationBanner email={user.email} emailConfirmedAt={user.email_confirmed_at ?? null} />
          )}

          {/* Service type indicator */}
          {serviceType !== 'ride' &&
          <div className="flex items-center justify-between px-1">
              <span className="text-xs font-bold text-primary uppercase tracking-wider">
                {SERVICE_TABS.find((t) => t.id === serviceType)?.icon} {SERVICE_TABS.find((t) => t.id === serviceType)?.label} Mode
              </span>
              <button onClick={() => setServiceType('ride')} className="text-xs text-muted-foreground underline">Switch to Ride</button>
            </div>
          }

          {/* Town selector row */}
          <div className="flex items-center justify-between">
            <TownSelectorSheet currentTown={selectedTown} onSelect={(town) => {setSelectedTown(town);setPickupLocation(null);setDropoffLocation(null);}} />
            <p className="text-[10px] text-muted-foreground">{selectedTown.radiusKm}km area</p>
          </div>


          {/* Pickup & Dropoff — premium cards with swap */}
          <div className="space-y-2 relative">
            <button
              onClick={() => {setActiveField('pickup');setSearchQuery('');}}
              className="w-full min-h-[62px] flex items-center gap-3 px-3 py-3 rounded-2xl active:scale-[0.98] transition-all text-left glass-card">
              <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 bg-accent">
                <MapPin className="w-4 h-4 text-accent-foreground" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[10px] font-semibold text-primary uppercase tracking-widest">Pickup</p>
                <p className={cn("text-[14px] font-medium truncate", pickupLocation ? 'text-foreground' : 'text-muted-foreground')}>
                  {pickupLocation?.name || 'Where from?'}
                </p>
              </div>
              {pickupLocation ?
              <span onClick={(e) => {e.stopPropagation();setPickupLocation(null);}} className="p-1.5 hover:bg-foreground/5 rounded-full"><X className="w-3.5 h-3.5 text-muted-foreground" /></span> :
              <button onClick={(e) => {e.stopPropagation();handleUseMyLocation();}} className="p-1.5 hover:bg-foreground/5 rounded-full"><Locate className="w-3.5 h-3.5 text-primary" /></button>
              }
            </button>

            <button
              onClick={() => {setActiveField('dropoff');setSearchQuery('');}}
              className="w-full min-h-[62px] flex items-center gap-3 px-3 py-3 rounded-2xl active:scale-[0.98] transition-all text-left glass-card">
              <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'var(--gradient-primary)' }}>
                <MapPin className="w-4 h-4 text-primary-foreground" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[10px] font-semibold text-primary uppercase tracking-widest">Drop-off</p>
                <p className={cn("text-[14px] font-medium truncate", dropoffLocation ? 'text-foreground' : 'text-muted-foreground')}>
                  {dropoffLocation?.name || 'Where to?'}
                </p>
              </div>
              {dropoffLocation &&
              <span onClick={(e) => {e.stopPropagation();setDropoffLocation(null);}} className="p-1.5 hover:bg-foreground/5 rounded-full"><X className="w-3.5 h-3.5 text-muted-foreground" /></span>
              }
            </button>

            <button
              onClick={handleSwapPickupDropoff}
              className="absolute right-2 top-1/2 -translate-y-1/2 w-9 h-9 rounded-xl glass-card flex items-center justify-center text-primary active:scale-90 transition-all"
              title="Swap pickup and drop-off"
              aria-label="Swap pickup and drop-off">
              
              <Route className="w-4 h-4" />
            </button>
          </div>


          {/* Multi-stop + Schedule */}
          <div className="grid grid-cols-2 gap-2">
            <MultiStopInput
              stops={rideStops}
              onAddStop={handleAddStop}
              onRemoveStop={handleRemoveStop}
              onStopClick={handleStopClick} />
            <ScheduleRide scheduledAt={scheduledAt} onSchedule={setScheduledAt} />
          </div>

          {/* Passenger selector — compact inline */}
          <div className="flex items-center justify-between glass-card rounded-2xl px-3 py-2">
            <div className="flex items-center gap-2">
              <Users className="w-3.5 h-3.5 text-primary" />
              <span className="text-xs font-medium text-foreground">Passengers</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPassengerCount((prev) => Math.max(1, prev - 1))}
                disabled={passengerCount <= 1}
                className="w-7 h-7 rounded-full glass-card flex items-center justify-center active:scale-90 transition-all disabled:opacity-30">
                <Minus className="w-3 h-3 text-foreground" />
              </button>
              <span className="text-sm font-bold text-foreground tabular-nums w-4 text-center">{passengerCount}</span>
              <button
                onClick={() => setPassengerCount((prev) => Math.min(10, prev + 1))}
                disabled={passengerCount >= 10}
                className="w-7 h-7 rounded-full glass-card flex items-center justify-center active:scale-90 transition-all disabled:opacity-30">
                <Plus className="w-3 h-3 text-foreground" />
              </button>
            </div>
          </div>
          {passengerCount > 3 &&
          <p className="text-[11px] text-accent font-medium -mt-1.5 ml-1">⚡ Extra passenger charges applied</p>
          }

          <div className='glass-card rounded-2xl px-3 py-2 space-y-2'>
            <div className='flex items-center justify-between'>
              <p className='text-xs font-semibold'>Book for someone else</p>
              <button onClick={() => setBookForSomeoneElse((v) => !v)} className={cn('h-5 w-9 rounded-full transition-colors', bookForSomeoneElse ? 'bg-primary' : 'bg-muted')}>
                <span className={cn('block h-4 w-4 rounded-full bg-white transition-transform', bookForSomeoneElse ? 'translate-x-[16px]' : 'translate-x-0.5')} />
              </button>
            </div>
            {bookForSomeoneElse &&
            <>
                <div className='grid grid-cols-1 gap-1.5'>
                  <InputField placeholder='Passenger name' value={passengerName} onChange={(e) => setPassengerName(e.target.value)} />
                  <InputField placeholder='Passenger phone' value={passengerPhone} onChange={(e) => setPassengerPhone(e.target.value)} />
                </div>
                <IconPillButton onClick={handlePickPassengerFromContacts}><ContactRound className='w-4 h-4' />Pick from contacts</IconPillButton>
                <p className='text-[10px] text-muted-foreground'>Driver can contact this passenger.</p>
              </>
            }
          </div>

          {/* Preferences hidden on ride view — kept in Profile → Ride Preferences */}
          {/* {(quietRide || coolTemp || wavRequired || hearingImpaired || genderPreference !== 'any') && (
            <div className="glass-card rounded-2xl px-3 py-2">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest mb-1">Your Preferences</p>
              <div className="flex flex-wrap gap-1">
                {quietRide && <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium">🤫 Quiet Ride</span>}
                {coolTemp && <span className="text-[10px] px-2 py-0.5 rounded-full bg-sky-500/10 text-sky-600 font-medium">❄️ Cool Temp</span>}
                {wavRequired && <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 font-medium">♿ WAV</span>}
                {hearingImpaired && <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-600 font-medium">👂 Hearing</span>}
                {genderPreference !== 'any' && <span className="text-[10px] px-2 py-0.5 rounded-full bg-pink-500/10 text-pink-600 font-medium">🛡️ Women Only</span>}
              </div>
              <p className="text-[9px] text-muted-foreground mt-1">Change in Profile → Ride Preferences</p>
            </div>
          )} */}

          {/* ── Fare breakdown + Negotiation (expanded) ── */}
          {pickupLocation && dropoffLocation && fareEstimate && (() => {
            const activeTown = selectedTown.name;
            const extraPassengers = Math.max(passengerCount - 3, 0);
            const extraPassengerFee = extraPassengers * 0.5;
            const validStops = rideStops.filter(s => s.address && s.lat && s.lng);
            const stopFee = validStops.length * 0.5;
            const baseFare = townPricing.base_fare;
            const distanceFare = fareEstimate.fareR - baseFare;
            const totalFare = baseFare + distanceFare + extraPassengerFee + stopFee;
            const sym = fareEstimate.currencySymbol;
            const code = fareEstimate.currencyCode;
            const fmt = (v: number) => `${sym}${v.toFixed(2)}`;

            return (
              <>
                {/* Compact fare card */}
                



























                







                {rideStatus !== 'idle' &&
                <button onClick={handleCancelRide} className="w-full text-center text-sm text-destructive font-medium py-1.5 hover:underline transition-colors">Cancel Ride</button>
                }
              </>);

          })()}
        </div>

        {/* ── PINNED FIND DRIVERS BUTTON ── always visible at bottom */}
        <div className="shrink-0 px-4 pb-3 pt-2">
          {pickupLocation && dropoffLocation && fareEstimate ? (() => {
            const extraPassengers = Math.max(passengerCount - 3, 0);
            const extraPassengerFee = extraPassengers * 0.5;
            const validStops = rideStops.filter(s => s.address && s.lat && s.lng);
            const stopFee = validStops.length * 0.5;
            const subtotal = townPricing.base_fare + (fareEstimate.fareR - townPricing.base_fare) + extraPassengerFee + stopFee;
            const discount = studentDiscountAvailable ? Math.min(STUDENT_DISCOUNT, Math.max(subtotal - 0.5, 0)) : 0;
            const totalFare = Math.max(subtotal - discount, 0.5);
            const sym = fareEstimate.currencySymbol;
            const fmt = (v: number) => `${sym}${v.toFixed(2)}`;
            return (
              <>
                {/* Payment method selector hidden on ride view — kept in profile instead. Default to cash for ride requests. */}
                {/* <div className="mb-2">
                  <PaymentMethodSelector
                    selected={paymentMethod}
                    onSelect={setPaymentMethod}
                    walletBalance={walletBalance}
                    estimatedFare={totalFare}
                  />
                </div> */}
                <PrimaryButton
                  onClick={() => setShowPaymentPrompt({ open: true, fare: totalFare })}
                  disabled={isRequesting}
                  className="w-full h-[48px] text-[15px] font-semibold rounded-2xl gap-2 inline-flex items-center justify-center active:scale-[0.97] transition-transform">

                  {isRequesting ? (
                    <>
                      <div className="w-4 h-4 border-2 border-primary-foreground border-t-transparent rounded-full animate-spin" />
                      Finding your ride…
                    </>
                  ) : (
                    <>
                      <Car className="w-4 h-4" />
                      {`Find Drivers • ${fmt(totalFare)}`}
                    </>
                  )}
                </PrimaryButton>
              </>
            );
          })() :
          <SecondaryButton
            disabled
            className="w-full h-[48px] text-[15px] font-semibold rounded-2xl bg-primary/30 text-primary-foreground border-transparent">
              {pickupLocation && dropoffLocation ? <><div className="w-4 h-4 border-2 border-primary-foreground/50 border-t-transparent rounded-full animate-spin mr-2" />Calculating…</> : 'Find Drivers'}
            </SecondaryButton>
          }
        </div>
      </GlassSheet>

      {/* ═══ PAYMENT METHOD PROMPT ═══ */}
      {showPaymentPrompt.open && (
        <div
          className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm animate-in fade-in"
          onClick={() => setShowPaymentPrompt({ open: false, fare: 0 })}>
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full sm:max-w-md bg-background rounded-t-3xl sm:rounded-3xl p-6 pb-[calc(env(safe-area-inset-bottom)+24px)] shadow-2xl animate-in slide-in-from-bottom">
            <div className="w-12 h-1.5 bg-muted rounded-full mx-auto mb-4 sm:hidden" />
            <h3 className="text-xl font-bold text-foreground text-center mb-1">How are you paying?</h3>
            <p className="text-sm text-muted-foreground text-center mb-5">
              Fare: ${showPaymentPrompt.fare.toFixed(2)}
            </p>
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => {
                  setPaymentMethod('cash');
                  const fare = showPaymentPrompt.fare;
                  setShowPaymentPrompt({ open: false, fare: 0 });
                  setTimeout(() => handleSendOffer(fare), 50);
                }}
                className="flex flex-col items-center justify-center gap-2 p-5 rounded-2xl border-2 border-border hover:border-primary hover:bg-primary/5 active:scale-95 transition-all">
                <Banknote className="w-7 h-7 text-primary" />
                <span className="text-[15px] font-semibold text-foreground">Cash</span>
              </button>
              <button
                onClick={() => {
                  const fare = showPaymentPrompt.fare;
                  if (walletBalance < fare) {
                    toast({
                      title: 'Insufficient wallet balance',
                      description: `You need $${fare.toFixed(2)} but only have $${walletBalance.toFixed(2)}. Top up or choose Cash.`,
                      variant: 'destructive',
                    });
                    return;
                  }
                  setPaymentMethod('wallet');
                  setShowPaymentPrompt({ open: false, fare: 0 });
                  setTimeout(() => handleSendOffer(fare), 50);
                }}
                className="flex flex-col items-center justify-center gap-2 p-5 rounded-2xl border-2 border-border hover:border-primary hover:bg-primary/5 active:scale-95 transition-all">
                <Wallet className="w-7 h-7 text-primary" />
                <span className="text-[15px] font-semibold text-foreground">Wallet</span>
                <span className="text-[11px] text-muted-foreground">${walletBalance.toFixed(2)}</span>
              </button>
            </div>
            <button
              onClick={() => setShowPaymentPrompt({ open: false, fare: 0 })}
              className="w-full mt-4 py-3 text-sm text-muted-foreground font-medium hover:text-foreground transition-colors">
              Cancel
            </button>
          </div>
        </div>
      )}


      {/* ═══ SEARCH OVERLAY ═══ */}
      {activeField &&
      <div className="fixed inset-0 z-[60] flex flex-col" style={{ background: 'hsl(var(--background) / 0.97)', backdropFilter: 'blur(28px)', WebkitBackdropFilter: 'blur(28px)' }}>
          {/* Search sheet — full screen */}
          <div className="flex-1 flex flex-col overflow-hidden">
          {/* Search header */}
          <div className="flex items-center gap-3 px-4 border-b border-border/30" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 14px)', paddingBottom: '14px' }}>
            <button onClick={() => {setActiveField(null);setSearchQuery('');setNominatimResults([]);}} className="w-11 h-11 flex items-center justify-center rounded-full glass-card active:scale-90 transition-all shrink-0">
              <ArrowLeft className="w-5 h-5 text-primary" />
            </button>
            <div className="flex-1 relative">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground pointer-events-none" />
              <input
                autoFocus type="text"
                placeholder={activeField === 'pickup' ? 'Search pickup location…' : 'Search destination…'}
                value={searchQuery}
                onChange={(e) => handleSearchChange(e.target.value)}
                className="w-full h-12 pl-11 pr-4 glass-card text-[16px] font-medium text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/25 border-0"
                style={{ borderRadius: 18 }} />
            
            </div>
          </div>

          {/* Results */}
          <div className="flex-1 overflow-y-auto">
            {/* GPS button */}
            {activeField === 'pickup' &&
            <button onClick={handleUseMyLocation} disabled={gpsState.status === 'loading'} className="w-full flex items-center gap-4 px-5 py-4 hover:bg-primary/5 active:bg-primary/8 transition-colors border-b border-border/15 text-left">
                <div className="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0" style={{ background: 'var(--gradient-primary)' }}>
                  {gpsState.status === 'loading' ? <Loader2 className="w-5 h-5 animate-spin text-primary-foreground" /> : <Crosshair className="w-5 h-5 text-primary-foreground" />}
                </div>
                <div>
                  <p className="font-medium text-foreground">Use my current location</p>
                  <p className="text-sm text-muted-foreground">Find pickup point automatically</p>
                </div>
              </button>
            }

            {gpsState.error && <p className="text-sm text-destructive bg-destructive/10 mx-4 my-3 p-3 rounded-xl">{gpsState.error}</p>}

            {gpsState.coords &&
            <div className="px-4 pt-3 pb-1">
                <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest mb-2">Nearby places</p>
                <ProximityFilter selected={proximityRadius} onSelect={setProximityRadius} />
              </div>
            }

            {/* Show town places by default when no search query */}
            {!searchQuery.trim() &&
            <>
                <div className="px-4 pt-3 pb-1">
                  <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest">
                    📍 Places in {selectedTown.name}
                  </p>
                </div>
                {landmarksLoading ?
              <div className="flex items-center justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div> :
              landmarks.length > 0 ?
              landmarks.map((landmark) =>
              <button key={landmark.id} onClick={() => handleLandmarkSelect(landmark)} className="w-full flex items-center gap-4 px-4 py-3.5 hover:bg-primary/5 transition-colors border-b border-border/15 text-left">
                      <div className="w-10 h-10 rounded-2xl glass-card flex items-center justify-center shrink-0">
                        <MapPin className="w-4.5 h-4.5 text-primary" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-foreground truncate text-sm">{landmark.name}</p>
                        <p className="text-xs text-muted-foreground capitalize">{landmark.category}{landmark.distance ? ` · ${landmark.distance < 1 ? `${Math.round(landmark.distance * 1000)}m` : `${landmark.distance.toFixed(1)}km`}` : ''}</p>
                      </div>
                    </button>
              ) :

              <p className="text-sm text-muted-foreground text-center py-6">No places found in {selectedTown.name}</p>
              }
              </>
            }

            {searchQuery.trim().length >= 3 &&
            <>
                {/* Single unified section: Streets & Places */}
                <div className="px-4 py-2 bg-accent/8 border-t border-border/15">
                  <p className="text-[11px] font-semibold text-foreground uppercase tracking-widest">Showing locations within {selectedTown.name}</p>
                </div>

                {(landmarksLoading || cachedPlacesLoading || googleLoading || nominatimLoading) && landmarks.length === 0 && unifiedPlaceResults.length === 0 &&
              <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin" /><span className="text-sm">Searching places…</span></div>
              }

                {/* Landmark results */}
                {landmarks.map((landmark) =>
              <button key={landmark.id} onClick={() => handleLandmarkSelect(landmark)} className="w-full flex items-center gap-4 px-4 py-3.5 hover:bg-primary/5 transition-colors border-b border-border/15 text-left">
                      <div className="w-11 h-11 rounded-2xl glass-card flex items-center justify-center shrink-0">
                        <MapPin className="w-5 h-5 text-primary" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-foreground truncate">{landmark.name}</p>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <span className="text-xs text-muted-foreground capitalize">{landmark.category}</span>
                          {landmark.distance !== undefined && <span className="text-xs text-muted-foreground">· {landmark.distance < 1 ? `${Math.round(landmark.distance * 1000)}m` : `${landmark.distance.toFixed(1)}km`}</span>}
                        </div>
                      </div>
                    </button>
              )}

                {/* Cached places — only when Google has no results */}
                {googleSuggestions.length === 0 && cachedPlaceResults.map((result, index) =>
              <button key={`cache-${index}`} onClick={() => handleNominatimSelect(result)} className="w-full flex items-center gap-4 px-4 py-3.5 hover:bg-primary/5 transition-colors border-b border-border/15 text-left">
                      <div className="w-11 h-11 rounded-2xl glass-card flex items-center justify-center shrink-0">
                        <MapPin className="w-5 h-5 text-primary" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-foreground truncate">{result.name}</p>
                        <p className="text-sm text-muted-foreground truncate">{result.displayName}</p>
                      </div>
                    </button>
              )}

                {/* Google/unified results — shown as primary */}
                {googleSuggestions.map((suggestion) =>
              <button key={suggestion.placeId} onClick={() => handleGooglePlaceSelect(suggestion)} className="w-full flex items-center gap-4 px-4 py-3.5 hover:bg-accent/5 transition-colors border-b border-border/15 text-left">
                      <div className="w-11 h-11 rounded-2xl glass-card flex items-center justify-center shrink-0">
                        <MapPin className="w-5 h-5 text-primary" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-foreground truncate">{suggestion.name}</p>
                        <p className="text-sm text-muted-foreground truncate">{suggestion.description}</p>
                      </div>
                    </button>
              )}

                {/* Only show Nominatim results when Google returned nothing */}
                {googleSuggestions.length === 0 && nominatimResults.map((result, index) =>
              <button key={`nom-${index}`} onClick={() => handleNominatimSelect(result)} className="w-full flex items-center gap-4 px-4 py-3.5 hover:bg-primary/5 transition-colors border-b border-border/15 text-left">
                      <div className="w-11 h-11 rounded-2xl glass-card flex items-center justify-center shrink-0">
                        <MapPin className="w-5 h-5 text-primary" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-foreground truncate">{result.name}</p>
                        <p className="text-sm text-muted-foreground truncate">{result.displayName}</p>
                      </div>
                    </button>
              )}

                {/* Empty state */}
                {!landmarksLoading && !cachedPlacesLoading && !googleLoading && !nominatimLoading && landmarks.length === 0 && cachedPlaceResults.length === 0 && googleSuggestions.length === 0 && nominatimResults.length === 0 && searchQuery.trim().length >= 3 &&
              <div className="text-center py-12 text-muted-foreground">
                      <MapPin className="w-10 h-10 mx-auto mb-3 opacity-30" />
                      <p className="text-sm">No results for "{searchQuery}" in {selectedTown.name}</p>
                      <p className="text-xs mt-1">Try switching to a different town above</p>
                    </div>
              }
              </>
            }
          </div>
          </div>
        </div>
      }

      {/* Modals */}
      <OffersModal isOpen={offersOpen} tripId={currentRideId || ''} viewing={viewingDrivers} offers={offers} onAcceptOffer={handleAcceptOffer} onDeclineOffer={handleDeclineOffer} onCancelRide={handleCancelRide} onClose={() => setOffersOpen(false)} />
      <AuthModalWrapper isOpen={authModalOpen} onClose={() => setAuthModalOpen(false)} mode={authMode} onSwitchMode={() => setAuthMode((m) => m === 'login' ? 'signup' : 'login')} />
      <ContactPickerSheet open={contactPickerOpen} onClose={() => setContactPickerOpen(false)} onSelect={handleContactSelected} />
    </div>);

}