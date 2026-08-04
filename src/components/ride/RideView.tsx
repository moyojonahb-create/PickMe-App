/* eslint-disable react-hooks/exhaustive-deps */
import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { rankTownStreets } from '@/lib/streetSearchRank';
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
import { goBackend } from '@/lib/goBackendClient';
import { getFallbackRoute } from '@/lib/osrm';
import { createNotification, createRidePreferences, createRideStops, createStudentDiscountUsage } from '@/lib/businessApi';
import {
  eventDriverId,
  eventNumber,
  eventOfferId,
  eventString,
  type BackendSocketEvent,
} from '@/lib/backendSocketClient';
import { acceptOffer, declineOffer } from '@/lib/offerHelpers';
import { useRideRealtime } from '@/hooks/useRideRealtime';
import { reverseZW } from '@/lib/geo_osm';
import { cachePlaceFromNominatim } from '@/lib/placeCache';
import { searchCachedPlacesPrefix } from '@/lib/placeCache';
import { useToast } from '@/hooks/use-toast';
import { useTownPricing, calculateRecommendedFare, formatFare } from '@/hooks/useTownPricing';
import { uuid } from '@/lib/uuid';
import { useStudentDiscountAvailable } from '@/hooks/useStudentProfile';

import BottomNavBar from '@/components/BottomNavBar';
import { useWallet } from '@/hooks/useWallet';
import PaymentMethodSelector from './PaymentMethodSelector';
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
import MapboxMap from '@/components/map/LazyMapboxMap';
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
import RideHomeGreeting from './RideHomeGreeting';
import DropoffAutocomplete from './DropoffAutocomplete';

import QuickShortcutsRow from './QuickShortcutsRow';
import NearbyDriversSummary from './NearbyDriversSummary';
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
import PilotReadinessCard from '@/components/pilot/PilotReadinessCard';
import LuggageButton from '@/components/luggage/LuggageButton';
import LuggageSheet from '@/components/luggage/LuggageSheet';
import GpsPermissionBanner from '@/components/ride/GpsPermissionBanner';
import BookingForSomeoneElse from '@/components/ride/BookingForSomeoneElse';
import DestinationSearchScreen, { type SearchResultRow } from '@/components/ride/DestinationSearchScreen';

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
  const [mapPickMode, setMapPickMode] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [proximityRadius, setProximityRadius] = useState<number | null>(null);
  const [nominatimResults, setNominatimResults] = useState<Array<{name: string;lat?: number;lng?: number;displayName: string;placeId?: string;source?: 'google' | 'osm';}>>([]);
  const [cachedPlaceResults, setCachedPlaceResults] = useState<Array<{name: string;lat: number;lng: number;displayName: string;}>>([]);
  const [nominatimLoading, setNominatimLoading] = useState(false);
  const [cachedPlacesLoading, setCachedPlacesLoading] = useState(false);
  const nominatimDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [reverseGeoLoading, setReverseGeoLoading] = useState(false);
  const [selectedTier, setSelectedTier] = useState<VehicleTier>('standard');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
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
  const [luggageDraft, setLuggageDraft] = useState<import('@/components/luggage/LuggageSheet').LuggageDraft | null>(null);
  const [luggageOpen, setLuggageOpen] = useState(false);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'signup'>('login');
  const [sheetExpanded, setSheetExpanded] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [selectedTown, setSelectedTown] = useState<TownConfig>(DEFAULT_TOWN);
  const [profileName, setProfileName] = useState<string>('');
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
  const nearbyDrivers = useNearbyDrivers(
    rideStatus === 'idle' || rideStatus === 'searching',
    gpsState.coords ? { lat: gpsState.coords.lat, lng: gpsState.coords.lng } : (pickupLocation ?? selectedTown.center),
    1, // 1km radius — Uber/Bolt feel
  );

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
    if (gpsState.status === 'idle' && navigator.geolocation) handleUseMyLocation(true);
  }, []);

  // Prefer the rider's saved profile name (nickname) for the greeting
  useEffect(() => {
    if (!user?.id) { setProfileName(''); return; }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('profiles')
        .select('full_name')
        .eq('user_id', user.id)
        .maybeSingle();
      if (!cancelled && data?.full_name) setProfileName(data.full_name);
    })();
    return () => { cancelled = true; };
  }, [user?.id]);

  // ── route / fare ──
  const { route: routeData, loading: routeLoading } = useOSRMRoute(
    pickupLocation ? { lat: pickupLocation.lat, lng: pickupLocation.lng } : null,
    dropoffLocation ? { lat: dropoffLocation.lat, lng: dropoffLocation.lng } : null
  );

  const calculateFare = useCallback(() => {
    // Prefer the routed distance; fall back to a straight-line estimate so the
    // Find Drivers button never stays stuck on "Calculating…" when routing fails.
    let distanceKm = routeData?.distanceKm ?? 0;
    let durationMinutes = routeData?.durationMinutes ?? 0;
    if (!distanceKm && pickupLocation && dropoffLocation) {
      const fb = getFallbackRoute(
        { lat: pickupLocation.lat, lng: pickupLocation.lng },
        { lat: dropoffLocation.lat, lng: dropoffLocation.lng }
      );
      distanceKm = fb.distanceKm;
      durationMinutes = fb.durationMinutes;
    }
    if (!distanceKm) return null;
    const rec = calculateRecommendedFare(townPricing, distanceKm, durationMinutes);
    return { fareR: rec.recommended, distanceKm, durationMinutes, currencySymbol: rec.currencySymbol, currencyCode: rec.currencyCode };
  }, [routeData, townPricing, pickupLocation, dropoffLocation]);
  const fareEstimate = calculateFare();

  const applyRideOfferEvent = useCallback((event: BackendSocketEvent) => {
    if (!currentRideId) return;
    const offerId = eventOfferId(event);
    const driverId = eventDriverId(event);
    const offeredFare = eventNumber(event, ['price', 'fare', 'offer_fare', 'offered_fare']);
    if (!offerId || !driverId || offeredFare == null) return;

    const etaMinutes = eventNumber(event, ['eta_minutes', 'etaMinutes', 'eta']) ?? 10;
    const driverName = eventString(event, ['driver_name', 'driverName', 'name']) ?? 'Driver';
    const vehicleMake = eventString(event, ['vehicle_make', 'vehicleMake']);
    const vehicleModel = eventString(event, ['vehicle_model', 'vehicleModel']);
    const plateNumber = eventString(event, ['plate_number', 'plateNumber']) ?? '-';
    const vehicleType = (eventString(event, ['vehicle_type', 'vehicleType']) ?? 'Car') as DriverOffer['vehicleType'];

    const nextViewing: DriverViewing = {
      driverId,
      name: vehicleMake || vehicleModel ? `${vehicleMake ?? ''} ${vehicleModel ?? ''}`.trim() : driverName,
      phone: eventString(event, ['phone']) ?? '+263',
      vehicleType,
      plateNumber,
      languages: ['English'],
      distanceKm: eventNumber(event, ['distance_km', 'distanceKm']) ?? 0,
      etaMinutes,
    };

    const nextOffer: DriverOffer = {
      ...nextViewing,
      offerId,
      offeredFareR: offeredFare,
      createdAt: eventString(event, ['created_at', 'createdAt']) ?? new Date().toISOString(),
      driverName,
      vehicleMake: vehicleMake ?? undefined,
      vehicleModel: vehicleModel ?? undefined,
      gender: eventString(event, ['gender']),
      avatarUrl: eventString(event, ['avatar_url', 'avatarUrl']),
      ratingAvg: eventNumber(event, ['rating_avg', 'ratingAvg']),
      totalTrips: eventNumber(event, ['total_trips', 'totalTrips']),
    };

    setViewingDrivers((prev) => prev.some((driver) => driver.driverId === driverId) ? prev : [nextViewing, ...prev]);
    setOffers((prev) => prev.some((offer) => offer.offerId === offerId) ? prev : [nextOffer, ...prev]);
    setRideStatus('offers_received');
    setOffersOpen(true);
  }, [currentRideId]);

  useRideRealtime(currentRideId, {
    onOfferChange: applyRideOfferEvent,
    onRideChange: () => {
      if (currentRideId) navigate(`/ride/${currentRideId}`, { replace: true });
    },
  });

  // Student discount: $1 off when verified & under daily cap
  const { available: studentDiscountAvailable, usedToday: studentRidesUsedToday, dailyCap: studentDailyCap } = useStudentDiscountAvailable();
  const STUDENT_DISCOUNT = 1;

  // ── handlers ──
  const applyPosition = useCallback(async (pos: GeolocationPosition, reverseGeocode: boolean) => {
    const c = { lat: pos.coords.latitude, lng: pos.coords.longitude };
    setGpsState({ status: 'success', coords: c, error: null });
    setPickupLocation((prev) => prev && prev.name !== 'My location' ? prev : { name: 'My location', lat: c.lat, lng: c.lng });
    setActiveField(null);

    // Use detected town
    const detected = detectTown(c.lat, c.lng);
    setSelectedTown(detected);

    if (!reverseGeocode) return;
    // Reverse geocode to get city name for better results
    try {
      const result = await reverseZW(c.lat, c.lng);
      const name = result?.name || result?.display_name?.split(',')[0] || 'My location';
      setPickupLocation({ name, lat: c.lat, lng: c.lng });
    } catch (e) {
      console.error('Reverse geocode error:', e);
    }
  }, []);

  /**
   * `fast` = coarse/cached fix used on mount so the map can centre almost
   * immediately (high-accuracy GPS can take several seconds on low-end
   * devices). A precise fix is requested straight after in the background.
   */
  const handleUseMyLocation = useCallback((fast = false) => {
    if (!navigator.geolocation) {
      setGpsState({ status: 'unavailable', coords: null, error: 'Geolocation not supported' });
      // Fallback to the pilot town if no geolocation
      const defaultCity = DEFAULT_TOWN;
      setSelectedTown(defaultCity);
      return;
    }
    setGpsState((prev) => ({ ...prev, status: 'loading', error: null }));

    const onError = (err: GeolocationPositionError) => {
      setGpsState({
        status: 'denied',
        coords: null,
        error: err.code === err.PERMISSION_DENIED ? 'Location access denied' : 'Unable to get location',
      });
      // Fallback to the pilot town on error
      setSelectedTown(DEFAULT_TOWN);
    };

    if (!fast) {
      navigator.geolocation.getCurrentPosition(
        (pos) => { void applyPosition(pos, true); },
        onError,
        { enableHighAccuracy: true, timeout: 10000 },
      );
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        void applyPosition(pos, false);
        // Upgrade to a precise fix + street-level label once painted.
        navigator.geolocation.getCurrentPosition(
          (precise) => { void applyPosition(precise, true); },
          () => {},
          { enableHighAccuracy: true, timeout: 10000 },
        );
      },
      // Coarse attempt failed (or timed out) — fall back to the precise one.
      () => {
        navigator.geolocation.getCurrentPosition(
          (pos) => { void applyPosition(pos, true); },
          onError,
          { enableHighAccuracy: true, timeout: 10000 },
        );
      },
      { enableHighAccuracy: false, timeout: 4000, maximumAge: 60000 },
    );
  }, [applyPosition]);

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

  const handleNominatimSelect = async (result: {name: string;lat?: number;lng?: number;placeId?: string;}) => {
    let { lat, lng, name } = result as { lat?: number; lng?: number; name: string };

    // Google Places Autocomplete predictions don't include coordinates —
    // resolve them via a details lookup before placing the pin.
    if ((lat === undefined || lng === undefined) && result.placeId) {
      try {
        const base = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/google-places-search`;
        const url = new URL(base);
        url.searchParams.set('placeId', result.placeId);
        const res = await fetch(url.toString(), {
          headers: {
            Accept: 'application/json',
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
            Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          },
        });
        const details = res.ok ? await res.json() : null;
        if (typeof details?.lat === 'number' && typeof details?.lng === 'number') {
          lat = details.lat;
          lng = details.lng;
          name = details.name || name;
        }
      } catch {
        // handled by the guard below
      }
    }
    if (lat === undefined || lng === undefined) return;

    const loc: SelectedLocation = { name, lat, lng };
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

  const rankContext = useMemo(() => ({
    townName: selectedTown.name,
    townCenter: selectedTown.center,
    userCoords: gpsState.coords,
    maxDistanceKm: selectedTown.maxDistanceKm,
  }), [selectedTown, gpsState.coords]);

  const handleNominatimSearch = useCallback((query: string) => {
    if (nominatimDebounceRef.current) clearTimeout(nominatimDebounceRef.current);
    if (query.trim().length < 3) {setNominatimResults([]);setNominatimLoading(false);return;}
    setNominatimLoading(true);
    nominatimDebounceRef.current = setTimeout(async () => {
      // Cap total search time at 5s. This calls the google-places-search edge
      // function, which tries Google Places first and falls back to Nominatim
      // server-side — so this is a single request, not a bounded/unbounded pair.
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      try {
        const base = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/google-places-search`;
        const url = new URL(base);
        url.searchParams.set('q', query.trim());
        url.searchParams.set('lat', String(selectedTown.center.lat));
        url.searchParams.set('lng', String(selectedTown.center.lng));
        url.searchParams.set('radiusKm', String(selectedTown.radiusKm));

        const res = await fetch(url.toString(), {
          signal: controller.signal,
          headers: {
            Accept: 'application/json',
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
            Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          },
        });
        if (!res.ok) throw new Error(`Place search failed: ${res.status}`);
        const results: Array<{ placeId: string; name: string; description: string; category?: string; lat?: number; lng?: number; source?: 'google' | 'osm' }> = await res.json();
        setNominatimResults(
          (Array.isArray(results) ? results : []).map((r) => ({
            name: r.name,
            lat: r.lat,
            lng: r.lng,
            displayName: r.description,
            placeId: r.placeId,
            source: r.source,
          }))
        );
      } catch {
        setNominatimResults([]);
      } finally {
        setNominatimLoading(false);
        clearTimeout(timeoutId);
      }
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
    searchCachedPlacesPrefix(trimmed, 12, selectedTown.nominatimViewbox)
      .then((results) => {
        const mapped = results.map((row) => ({
          name: row.name || row.display_name.split(',')[0],
          lat: Number(row.lat),
          lng: Number(row.lon),
          displayName: row.display_name,
          class: (row as { class?: string }).class,
          type: (row as { type?: string }).type,
        }));
        setCachedPlaceResults(rankTownStreets(mapped, rankContext));
      })
      .catch(() => setCachedPlaceResults([]))
      .finally(() => setCachedPlacesLoading(false));
  }, [selectedTown, rankContext]);

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

  const handleSendOffer = async (customFare: number) => {
    if (!user) {setAuthMode('login');setAuthModalOpen(true);return;}
    if (!pickupLocation || !dropoffLocation || !fareEstimate) {toast({ title: 'Select pickup and destination', variant: 'destructive' });return;}
    if (paymentMethod === 'wallet' && walletBalance < customFare) {
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
        payment_method: paymentMethod, vehicle_type: selectedTier,
        town_id: selectedTown?.id ?? null,
        gender_preference: genderPreference,
        ...(bookForSomeoneElse && passengerName.trim() ? { passenger_name: passengerName.trim() } : {}),
        ...(bookForSomeoneElse && passengerPhone.trim() ? { passenger_phone: passengerPhone.trim() } : {}),
        ...(scheduledAt ? { scheduled_at: scheduledAt.toISOString() } : {})
      });
      if (!result.ok) throw new Error(result.error);

      // Record student discount usage (best-effort)
      if (studentDiscountAvailable && result.ride?.id && user?.id) {
        createStudentDiscountUsage({
          ride_id: result.ride.id,
          discount_amount: STUDENT_DISCOUNT,
        }).catch((error) => {
          console.error('Failed to record student discount:', error);
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
          await createRideStops(stopsToInsert);
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
        createRidePreferences(prefsPayload as Record<string, unknown>).catch((error) => {
          console.error('Failed to save ride preferences:', error);
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
          await createNotification({
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

      // Attach luggage info if set
      if (luggageDraft && result.ride.id && user?.id) {
        supabase.from('luggage_requests').insert([{
          ride_id: result.ride.id,
          rider_id: user.id,
          description: luggageDraft.description,
          estimated_weight: luggageDraft.estimated_weight,
          item_count: luggageDraft.item_count,
          image_paths: luggageDraft.image_paths,
        }] as never).then(({ error }) => {
          if (error) console.error('Luggage insert failed:', error.message);
        });
      }

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

  const handleAcceptOffer = async (offerId: string) => {
    if (!currentRideId) return;
    try {
      await acceptOffer(currentRideId, offerId);
      setOffersOpen(false);
      toast({ title: 'Offer accepted', description: 'Waiting for the backend confirmation.' });
      navigate(`/ride/${currentRideId}`, { replace: true });
    } catch (error: unknown) {
      toast({ title: 'Failed to accept offer', description: (error as Error).message, variant: 'destructive' });
    }
  };
  const handleDeclineOffer = async (offerId: string) => {
    try {
      await declineOffer(offerId);
      setOffers((prev) => {
        const next = prev.filter((o) => o.offerId !== offerId);
        if (next.length === 0) setRideStatus('searching');
        return next;
      });
    } catch (error: unknown) {
      toast({ title: 'Failed to decline offer', description: (error as Error).message, variant: 'destructive' });
    }
  };
  const handleCancelRide = async () => {
    if (currentRideId) await goBackend.post(`/api/rides/${currentRideId}/status`, { status: 'cancelled' });
    setRideStatus('idle');
    setCurrentRideId(null);
    setOffers([]);
    setViewingDrivers([]);
    setMatchedDriver(null);
    toast({ title: 'Ride cancelled' });
  };

  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
    handleCachedPlacesSearch(value);
    handleNominatimSearch(value);
  };
  const canRequestRide = pickupLocation && dropoffLocation && fareEstimate && !isRequesting;
  const firstName = (profileName || (user?.user_metadata?.full_name as string | undefined) || user?.email?.split('@')[0] || '').split(' ')[0];
  const mapCenter = gpsState.coords ?? pickupLocation ?? selectedTown.center;
  const mapZoom = gpsState.coords ? 16 : 14;
  const searchResultRows: SearchResultRow[] = useMemo(() => {
    const rows: SearchResultRow[] = [];
    landmarks.forEach((l) => rows.push({
      id: `lm-${l.id}`,
      name: l.name,
      secondary: [l.category, l.distance !== undefined ? (l.distance < 1 ? `${Math.round(l.distance * 1000)}m` : `${l.distance.toFixed(1)}km`) : null].filter(Boolean).join(' · '),
      onSelect: () => handleLandmarkSelect(l),
    }));
    cachedPlaceResults.forEach((r, i) => rows.push({
      id: `cache-${i}`, name: r.name, secondary: r.displayName, onSelect: () => handleNominatimSelect(r),
    }));
    nominatimResults.forEach((r, i) => rows.push({
      id: `nom-${i}`, name: r.name, secondary: r.displayName, onSelect: () => handleNominatimSelect(r),
    }));
    return rows;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [landmarks, cachedPlaceResults, nominatimResults, activeField, activeStopId]);

  const estimatedWaitMinutes = Math.max(2, Math.min(8, Math.round(8 - nearbyDrivers.length * 0.6)));
  const showHomeContent = rideStatus === 'idle' && !pickupLocation && !dropoffLocation;
  const unifiedPlaceResults = [...cachedPlaceResults, ...nominatimResults.map((item) => ({ ...item, source: 'nominatim' as const }))]
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
          <MapboxMap pickup={pickupLocation} dropoff={dropoffLocation} routeGeometry={routeData?.geometry} defaultCenter={mapCenter} defaultZoom={mapZoom} className="w-full h-full" height="100%" stops={rideStops.filter(s => s.lat && s.lng)} />
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
                    const url = `https://www.mapbox.com/directions?destination=${dropoffLocation.lng},${dropoffLocation.lat}`;
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
        <MapboxMap pickup={pickupLocation} dropoff={dropoffLocation} routeGeometry={routeData?.geometry} onMapClick={handleMapClick} defaultCenter={mapCenter} defaultZoom={mapZoom} className="w-full h-full" height="100%" drivers={nearbyDrivers} stops={rideStops.filter(s => s.lat && s.lng)} riderGender={(riderPrefs?.gender as "male" | "female" | undefined) ?? null} />

        {/* Floating map buttons */}
        <div className="absolute right-3 z-20" style={{ bottom: sheetExpanded ? 'calc(70vh + 16px)' : 'calc(48vh + 16px)', transition: 'bottom 0.3s cubic-bezier(0.32,0.72,0,1)' }}>
          <div className="flex flex-col gap-2.5">
            <button onClick={() => handleUseMyLocation()} className="w-11 h-11 rounded-full glass-card flex items-center justify-center active:scale-90 transition-all glass-glow-blue">
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
        className="absolute left-0 right-0 z-50 flex flex-col overflow-hidden"
        style={{
          bottom: 0,
          height: sheetExpanded ? '76vh' : '52vh',
          transition: 'height 0.3s cubic-bezier(0.32,0.72,0,1)',
          paddingBottom: 'env(safe-area-inset-bottom)',
          borderTopLeftRadius: 20,
          borderTopRightRadius: 20
        }}>

        {/* Blue ribbon with yellow drag handle */}
        <button
          onClick={() => setSheetExpanded((e) => !e)}
          aria-label="Expand booking sheet"
          className="w-full py-2.5 flex justify-center shrink-0 bg-primary rounded-t-[20px]">
          <div className="w-11 h-1.5 rounded-full bg-accent" />
        </button>

        {/* Scrollable content */}
        <div className="flex-1 px-4 pb-2 space-y-2.5 min-h-0 overflow-y-auto overscroll-contain">
          {/* Email verification gate */}
          {user?.email && !user?.email_confirmed_at && (
            <EmailVerificationBanner email={user.email} emailConfirmedAt={user.email_confirmed_at ?? null} />
          )}

          {/* GPS state banner — explains denied/loading/unavailable with a one-tap retry. */}
          <GpsPermissionBanner status={gpsState.status} error={gpsState.error} onRetry={() => handleUseMyLocation()} />

          {/* ── HOME CONTENT (idle state, before booking starts) ── */}
          {showHomeContent && (() => {
            const ensurePickup = () => {
              if (pickupLocation) return;
              if (gpsState.coords) {
                setPickupLocation({ name: 'My location', lat: gpsState.coords.lat, lng: gpsState.coords.lng });
              } else {
                if (gpsState.status === 'idle') handleUseMyLocation();
                setPickupLocation({ name: `${selectedTown.name} centre`, lat: selectedTown.center.lat, lng: selectedTown.center.lng });
              }
            };
            const pickDropoff = (loc: { name: string; lat: number; lng: number }) => {
              ensurePickup();
              setDropoffLocation(loc);
              setActiveField(null);
              setSearchQuery('');
              haptic('light');
              setSheetExpanded(true);
            };
            return (
              <div className="space-y-3">
                <RideHomeGreeting
                  name={firstName}
                  onSearchClick={() => { ensurePickup(); setActiveField('dropoff'); setSearchQuery(''); setSheetExpanded(true); }}
                />
                <QuickShortcutsRow onSelect={pickDropoff} />
                <NearbyDriversSummary driverCount={nearbyDrivers.length} avgWaitMinutes={estimatedWaitMinutes} />
                <RecentDestinations field="dropoff" onSelect={pickDropoff} />
              </div>
            );
          })()}

          {/* Service type indicator */}
          {serviceType !== 'ride' &&
          <div className="flex items-center justify-between px-1">
              <span className="text-xs font-bold text-primary uppercase tracking-wider">
                {SERVICE_TABS.find((t) => t.id === serviceType)?.icon} {SERVICE_TABS.find((t) => t.id === serviceType)?.label} Mode
              </span>
              <button onClick={() => setServiceType('ride')} className="text-xs text-muted-foreground underline">Switch to Ride</button>
            </div>
          }

          {/* Town / scope row */}
          <div className="flex items-center justify-between text-muted-foreground">
            <TownSelectorSheet currentTown={selectedTown} onSelect={(town) => {setSelectedTown(town);setPickupLocation(null);setDropoffLocation(null);}} />
            <p className="text-[11px]">{selectedTown.radiusKm} km area</p>
          </div>

          {/* ETA + fare heading */}
          {dropoffLocation && (
            <div className="flex items-end justify-between gap-3 px-0.5">
              <div className="flex items-baseline gap-2 min-w-0">
                <span className="text-[26px] leading-none font-bold text-primary tabular-nums">
                  {fareEstimate ? `${fareEstimate.currencySymbol}${fareEstimate.fareR.toFixed(2)}` : '—'}
                </span>
                <span className="text-[13px] text-muted-foreground truncate">
                  {fareEstimate ? `${Math.round(fareEstimate.durationMinutes)} min trip` : "Estimating…"}
                </span>
              </div>
              <div className="flex items-center gap-1 text-[12px] text-muted-foreground shrink-0">
                <Clock className="w-3.5 h-3.5" />
                {estimatedWaitMinutes} min away
              </div>
            </div>
          )}


          {/* Pickup & Dropoff — unified premium journey card */}

          <div className="relative glass-card rounded-[20px] border border-border/60">
            {/* Vertical journey rail */}
            <div className="absolute left-6 top-0 bottom-0 w-4 flex flex-col items-center justify-between py-7 pointer-events-none">
              <div className="w-2.5 h-2.5 rounded-full bg-accent ring-[3px] ring-accent/15" />
              <div className="flex-1 flex flex-col items-center my-1.5 w-px">
                <div className="flex-1 w-px border-l border-dashed border-accent/25" />
                <div className="flex-1 w-px border-l border-dashed border-primary/25" />
              </div>
              <div className="w-3 h-3 rounded-[5px] bg-primary ring-[3px] ring-primary/15" />
            </div>

            {/* Swap control */}
            <button
              onClick={handleSwapPickupDropoff}
              className="absolute right-2 top-1/2 -translate-y-1/2 z-10 w-10 h-10 rounded-full bg-primary/95 text-primary-foreground shadow-lg shadow-primary/25 flex items-center justify-center active:scale-90 transition-all"
              title="Swap pickup and drop-off"
              aria-label="Swap pickup and drop-off">
              <Route className="w-4 h-4" />
            </button>

            {/* Pickup row */}
            <button
              onClick={() => {setActiveField('pickup');setSearchQuery('');}}
              className="w-full min-h-[64px] flex items-center gap-3 pl-12 pr-3 py-3.5 active:scale-[0.98] transition-all text-left rounded-t-[20px] border-b border-border/40 hover:bg-foreground/[0.02]">
              <div className="flex-1 min-w-0">
                <p className="text-[10px] font-semibold text-primary uppercase tracking-widest">Pickup</p>
                <p className={cn("text-[15px] font-medium truncate", pickupLocation ? 'text-foreground' : 'text-muted-foreground')}>
                  {pickupLocation?.name || 'Where from?'}
                </p>
              </div>
              {pickupLocation ?
              <span onClick={(e) => {e.stopPropagation();setPickupLocation(null);}} className="p-1.5 hover:bg-foreground/5 rounded-full"><X className="w-3.5 h-3.5 text-muted-foreground" /></span> :
              <button onClick={(e) => {e.stopPropagation();handleUseMyLocation();}} className="p-1.5 hover:bg-foreground/5 rounded-full"><Locate className="w-3.5 h-3.5 text-primary" /></button>
              }
            </button>

            {/* Dropoff row */}
            <button
              onClick={() => {setActiveField('dropoff');setSearchQuery('');}}
              className="w-full min-h-[64px] flex items-center gap-3 pl-12 pr-3 py-3.5 active:scale-[0.98] transition-all text-left rounded-b-[20px] hover:bg-foreground/[0.02]">
              <div className="flex-1 min-w-0">
                <p className="text-[10px] font-semibold text-primary uppercase tracking-widest">Drop-off</p>
                <p className={cn("text-[15px] font-medium truncate", dropoffLocation ? 'text-foreground' : 'text-muted-foreground')}>
                  {dropoffLocation?.name || 'Search destination'}
                </p>
              </div>
              {dropoffLocation && (
                <span onClick={(e) => {e.stopPropagation();setDropoffLocation(null);}} className="p-1.5 hover:bg-foreground/5 rounded-full"><X className="w-3.5 h-3.5 text-muted-foreground" /></span>
              )}
            </button>
          </div>

          {/* Booking for someone else */}
          <BookingForSomeoneElse
            enabled={bookForSomeoneElse}
            onEnabledChange={setBookForSomeoneElse}
            name={passengerName}
            phone={passengerPhone}
            onNameChange={setPassengerName}
            onPhoneChange={setPassengerPhone}
            onOpenContacts={handlePickPassengerFromContacts}
          />

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

          {/* Preferences set in Profile Settings — shown as tags */}
          {(quietRide || coolTemp || wavRequired || hearingImpaired || genderPreference !== 'any') && (
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
          )}

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
                {studentDiscountAvailable && (
                  <div className="mb-2 flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-primary/10 border border-primary/20">
                    <span className="text-[12px] font-semibold text-primary">🎓 Student discount applied −{fmt(discount)}</span>
                    <span className="text-[10px] text-muted-foreground">{studentRidesUsedToday}/{studentDailyCap} today</span>
                  </div>
                )}
                <div className="mb-2 flex justify-start">
                  <LuggageButton
                    count={luggageDraft?.image_paths.length || 0}
                    onClick={() => setLuggageOpen(true)}
                  />
                </div>
                <div className="mb-2">
                  <PaymentMethodSelector
                    selected={paymentMethod}
                    onSelect={setPaymentMethod}
                    walletBalance={walletBalance}
                    estimatedFare={totalFare}
                  />
                </div>
                <PrimaryButton
                  onClick={() => handleSendOffer(totalFare)}
                  disabled={isRequesting}
                  className="w-full h-[48px] text-[15px] font-semibold rounded-2xl gap-2 inline-flex items-center justify-center active:scale-[0.97] transition-transform !bg-primary !text-accent">

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


      {/* ═══ DESTINATION SEARCH SCREEN ═══ */}
      {activeField && !mapPickMode && (
        <DestinationSearchScreen
          activeField={activeField}
          onActiveFieldChange={(f) => {setActiveField(f);setSearchQuery('');setNominatimResults([]);}}
          pickupName={pickupLocation?.name || ''}
          dropoffName={dropoffLocation?.name || ''}
          query={searchQuery}
          onQueryChange={handleSearchChange}
          onClose={() => {setActiveField(null);setSearchQuery('');setNominatimResults([]);}}
          onUseMyLocation={() => handleUseMyLocation()}
          gpsLoading={gpsState.status === 'loading'}
          onChooseOnMap={() => setMapPickMode(true)}
          onSelectPlace={(place) => {
            const loc: SelectedLocation = { name: place.name, lat: place.lat, lng: place.lng };
            if (activeField === 'pickup') {setPickupLocation(loc);setActiveField('dropoff');}
            else {setDropoffLocation(loc);setActiveField(null);}
            setSearchQuery('');
          }}
          loading={landmarksLoading || cachedPlacesLoading || nominatimLoading}
          results={searchResultRows}
        />
      )}

      {/* Modals */}
      <OffersModal isOpen={offersOpen} tripId={currentRideId || ''} viewing={viewingDrivers} offers={offers} onAcceptOffer={handleAcceptOffer} onDeclineOffer={handleDeclineOffer} onCancelRide={handleCancelRide} onClose={() => setOffersOpen(false)} />
      <AuthModalWrapper isOpen={authModalOpen} onClose={() => setAuthModalOpen(false)} mode={authMode} onSwitchMode={() => setAuthMode((m) => m === 'login' ? 'signup' : 'login')} />
      <ContactPickerSheet open={contactPickerOpen} onClose={() => setContactPickerOpen(false)} onSelect={handleContactSelected} />
      <LuggageSheet
        open={luggageOpen}
        onClose={() => setLuggageOpen(false)}
        initial={luggageDraft}
        onSave={setLuggageDraft}
      />
    </div>);

}


