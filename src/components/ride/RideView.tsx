/* eslint-disable react-hooks/exhaustive-deps */
import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { rankTownStreets } from '@/lib/streetSearchRank';
import { motion } from 'framer-motion';
import { useNavigate, useLocation } from 'react-router-dom';
import { haptic } from '@/lib/haptics';
import { useAuth } from '@/hooks/useAuth';
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
import { useStudentDiscountAvailable } from '@/hooks/useStudentProfile';

import { useWallet } from '@/hooks/useWallet';
import PaymentMethodSelector from './PaymentMethodSelector';
import { Button } from '@/components/ui/button';
import {
  Loader2, MapPin, Navigation, Crosshair, ArrowLeft, User, Search,
  Star, Phone, MessageCircle, Clock, ChevronRight, Locate,
  Banknote, Wallet, Zap, CarFront, Menu, History, ContactRound,
  Calendar, CreditCard, ChevronDown, Sparkles, UserPlus, X } from
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
import RideGlassPanel from './RideGlassPanel';
import { glassSurface, redCta, RIDE_RED, RIDE_TEXT, RIDE_TEXT_2 } from './rideGlass';
import QuickPickChips from './QuickPickChips';
import ProximityFilter from './ProximityFilter';
import EmergencyButton from './EmergencyButton';
import { NotificationBell } from '@/components/NotificationCenter';

import RideHomeGreeting from './RideHomeGreeting';
import DropoffAutocomplete from './DropoffAutocomplete';

import QuickShortcutsRow from './QuickShortcutsRow';
import { type RideStop } from './MultiStopInput';
import { useLandmarks as useLandmarksSearch, type Landmark } from '@/hooks/useLandmarks';
import { useStreets, type Street } from '@/hooks/useStreets';
import { DEFAULT_TOWN, detectTown, type TownConfig } from '@/lib/towns';
import TownSelectorSheet from './TownSelectorSheet';
import ShareTripButton from './ShareTripButton';
import ScheduleRide from './ScheduleRide';
import { requestNotificationPermission, showLocalNotification } from '@/lib/push';
import ParcelBookingSheet, { type ParcelBookingData } from './ParcelBookingSheet';
import ShareRideSheet from './ShareRideSheet';
import NoteToDriverSheet from './NoteToDriverSheet';
import BookingForSomeoneElse from './BookingForSomeoneElse';
import { normalizePhoneZW } from '@/lib/region';
import { useRiderPreferences } from '@/components/settings/RiderPreferencesSettings';

// ── types ──
import { type ServiceType } from '@/components/VehicleTypeSelector';
import IntercitySelector from './IntercitySelector';
import { type IntercityRoute } from '@/lib/intercityRoutes';
import { useNearbyDrivers } from '@/hooks/useNearbyDrivers';
import GenderPreferenceToggle, { type GenderPreference } from './GenderPreferenceToggle';
import { pickNativeContact } from '@/lib/nativeContactPicker';
import PilotReadinessCard from '@/components/pilot/PilotReadinessCard';
import LuggageSheet from '@/components/luggage/LuggageSheet';
import LocationPermissionPrompt from '@/components/ride/LocationPermissionPrompt';
import DestinationSearchScreen, { type SearchResultRow } from '@/components/ride/DestinationSearchScreen';
import RideTierSelector, { type RideTierId, type RideTierOption } from './RideTierSelector';

interface SelectedLocation {name: string;lat: number;lng: number;}
interface GPSState {status: 'idle' | 'loading' | 'success' | 'denied' | 'unavailable';coords: {lat: number;lng: number;} | null;error: string | null;}
type VehicleTier = RideTierId;
type PaymentMethod = 'cash' | 'wallet';

const SERVICE_TABS: {id: ServiceType;label: string;icon: string;}[] = [
{ id: 'ride', label: 'Ride', icon: '🚗' },
{ id: 'intercity', label: 'Intercity', icon: '🛣️' },
{ id: 'courier', label: 'Courier', icon: '📦' },
{ id: 'freight', label: 'Freight', icon: '🚛' }];

const RIDE_TIER_LABELS: Record<RideTierId, string> = {
  economy: 'Economy',
  share: 'Share Ride',
  parcel: 'Parcel',
};


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
  const [settingFavorite, setSettingFavorite] = useState<'home' | 'work' | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [proximityRadius, setProximityRadius] = useState<number | null>(null);
  const [nominatimResults, setNominatimResults] = useState<Array<{name: string;lat?: number;lng?: number;displayName: string;placeId?: string;source?: 'google' | 'osm';}>>([]);
  const [cachedPlaceResults, setCachedPlaceResults] = useState<Array<{name: string;lat: number;lng: number;displayName: string;}>>([]);
  const [nominatimLoading, setNominatimLoading] = useState(false);
  const [cachedPlacesLoading, setCachedPlacesLoading] = useState(false);
  const nominatimDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Google Places session token: groups one autocomplete "session" (first
  // keystroke through place selection) into a single billed unit. Lazily
  // created on first Google call, cleared once a place is picked.
  const googleSessionTokenRef = useRef<string | null>(null);
  const [reverseGeoLoading, setReverseGeoLoading] = useState(false);
  const [selectedTier, setSelectedTier] = useState<VehicleTier>('economy');
  const [parcelSheetOpen, setParcelSheetOpen] = useState(false);
  const [shareSheetOpen, setShareSheetOpen] = useState(false);
  // Ride-type selection now happens BEFORE the destination is picked (tap
  // "Where to?"/PickMe → choose a tier → then enter pickup/dropoff), not
  // after. A tier's fare genuinely can't be computed without a route yet,
  // so this step shows tiers with no price ("See fare next") — the same
  // RideTierSelector re-renders with real fares once destination is known.
  const [tierPickerOpen, setTierPickerOpen] = useState(false);
  const [parcelSize, setParcelSize] = useState<'small' | 'medium' | 'large'>('medium');
  const [schedulePickerOpen, setSchedulePickerOpen] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  // Payment method row is only shown until the rider explicitly confirms a
  // method (tapping Cash or Wallet in the sheet) — it then hides for good.
  const [paymentMethodConfirmed, setPaymentMethodConfirmed] = useState(false);
  const { balance: walletBalance } = useWallet();
  const [passengerCount, setPassengerCount] = useState(1);
  const [bookForSomeoneElse, setBookForSomeoneElse] = useState(false);
  const [passengerName, setPassengerName] = useState('');
  const [passengerPhone, setPassengerPhone] = useState('');
  const [thirdPartyPayer, setThirdPartyPayer] = useState<'booker' | 'passenger'>('booker');
  const [notifyBooker, setNotifyBooker] = useState(true);
  const [bookingForSomeoneElseOpen, setBookingForSomeoneElseOpen] = useState(false);
  const [rideStatus, setRideStatus] = useState<RideStatus>('idle');
  const [isRequesting, setIsRequesting] = useState(false);
  const [currentRideId, setCurrentRideId] = useState<string | null>(null);
  const [matchedDriver, setMatchedDriver] = useState<{name: string;car: string;plate: string;rating: number;avatar?: string;eta: number;} | null>(null);
  const [offersOpen, setOffersOpen] = useState(false);
  const [viewingDrivers, setViewingDrivers] = useState<DriverViewing[]>([]);
  const [offers, setOffers] = useState<DriverOffer[]>([]);
  const [luggageDraft, setLuggageDraft] = useState<import('@/components/luggage/LuggageSheet').LuggageDraft | null>(null);
  const [luggageOpen, setLuggageOpen] = useState(false);
  const [luggagePromptOpen, setLuggagePromptOpen] = useState(false);
  const [luggagePromptShown, setLuggagePromptShown] = useState(false);
  const [paymentPopupOpen, setPaymentPopupOpen] = useState(false);
  const [riderNote, setRiderNote] = useState('');
  const [noteReuseEveryTrip, setNoteReuseEveryTrip] = useState(false);
  const [noteSheetOpen, setNoteSheetOpen] = useState(false);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'signup'>('login');
  const [sheetExpanded, setSheetExpanded] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [selectedTown, setSelectedTown] = useState<TownConfig>(DEFAULT_TOWN);
  // Set when the rider explicitly picks a town, so the map recenters there even
  // if GPS already has a fix. Cleared by a fresh GPS fix or a new pickup, so
  // "use my location" still wins after a manual town selection.
  const [preferredCenter, setPreferredCenter] = useState<{ lat: number; lng: number } | null>(null);
  // Drives the upfront "Allow location" prompt: only shown when the browser
  // reports the permission is still undecided ('prompt'). Already-granted or
  // already-denied skip the prompt entirely — see the effects below.
  const [gpsPermissionState, setGpsPermissionState] = useState<'unknown' | 'granted' | 'prompt' | 'denied' | 'unsupported'>('unknown');
  const [locationPromptDismissed, setLocationPromptDismissed] = useState(false);
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
  const { streets, loading: streetsLoading } = useStreets({ searchQuery, townName: selectedTown.name, limit: 15 });
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

  // One-time luggage prompt as soon as a drop-off is chosen for this booking.
  // Never fires for Parcel — a parcel is not a passenger, so "travelling
  // with luggage?" doesn't apply.
  useEffect(() => {
    if (dropoffLocation && !luggagePromptShown && selectedTier !== 'parcel') {
      setLuggagePromptShown(true);
      setLuggagePromptOpen(true);
    }
    if (!dropoffLocation || selectedTier === 'parcel') {
      setLuggagePromptShown(false);
      setLuggagePromptOpen(false);
    }
  }, [dropoffLocation, luggagePromptShown, selectedTier]);

  // Check the browser's actual permission state before ever touching
  // navigator.geolocation, so a first-time visitor sees our explicit
  // "Allow location" ask instead of a silent/no-context native prompt.
  useEffect(() => {
    if (!navigator.geolocation) {
      setGpsPermissionState('unsupported');
      return;
    }
    if (!navigator.permissions?.query) {
      // Permissions API unavailable (Safari, some WebViews) — fall back to
      // showing our prompt; tapping "Allow" still triggers the native ask.
      setGpsPermissionState('prompt');
      return;
    }
    let cancelled = false;
    navigator.permissions.query({ name: 'geolocation' })
      .then((status) => {
        if (cancelled) return;
        setGpsPermissionState(status.state);
        status.onchange = () => {
          if (!cancelled) setGpsPermissionState(status.state);
        };
      })
      .catch(() => {
        if (!cancelled) setGpsPermissionState('prompt');
      });
    return () => { cancelled = true; };
  }, []);

  // Already decided by the browser — skip our custom prompt entirely.
  // 'granted' fetches location immediately; 'denied' fetches too (the
  // browser fails instantly with no dialog) purely so gpsState flips to
  // 'denied' and the existing GpsPermissionBanner + retry takes over.
  // setPickup: false — this is a passive background fetch, not a rider tap,
  // so it must only centre the map/detect the town, never silently fill in
  // a pickup and knock the rider off the "Where to?" home screen.
  useEffect(() => {
    if ((gpsPermissionState === 'granted' || gpsPermissionState === 'denied') && gpsState.status === 'idle') {
      handleUseMyLocation(true, false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gpsPermissionState]);

  // Once pickup is set (e.g. GPS auto-fill on mount), never leave the rider
  // staring at the bare in-between map with nothing to do — jump straight
  // into the destination search until drop-off is picked too, so the flow
  // is always: entering places → choosing the ride, no dead middle screen.
  useEffect(() => {
    if (pickupLocation && !dropoffLocation && !activeField && rideStatus === 'idle') {
      setActiveField('dropoff');
    }
  }, [pickupLocation, dropoffLocation, activeField, rideStatus]);

  // Prefer the rider's saved profile name (nickname) for the greeting
  useEffect(() => {
    if (!user?.id) { setProfileName(''); return; }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('profiles')
        .select('full_name, default_ride_note')
        .eq('user_id', user.id)
        .maybeSingle();
      if (cancelled) return;
      if (data?.full_name) setProfileName(data.full_name);
      if (data?.default_ride_note) { setRiderNote(data.default_ride_note); setNoteReuseEveryTrip(true); }
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

  // Single source of truth for the fare breakdown — the headline price, the
  // itemized card, and the Find Drivers button all read from this, so they
  // can never disagree about what the ride actually costs.
  const fareBreakdown = useMemo(() => {
    if (!fareEstimate) return null;
    const baseFare = townPricing.base_fare;
    const distanceFare = fareEstimate.fareR - baseFare;
    const extraPassengers = Math.max(passengerCount - 3, 0);
    const extraPassengerFee = extraPassengers * 0.5;
    const validStopsCount = rideStops.filter((s) => s.address && s.lat && s.lng).length;
    const stopFee = validStopsCount * 0.5;
    const subtotal = baseFare + distanceFare + extraPassengerFee + stopFee;
    const discount = studentDiscountAvailable ? Math.min(STUDENT_DISCOUNT, Math.max(subtotal - 0.5, 0)) : 0;
    const totalFare = Math.max(subtotal - discount, 0.5);
    const sym = fareEstimate.currencySymbol;
    return {
      baseFare, distanceFare, extraPassengers, extraPassengerFee,
      validStopsCount, stopFee, subtotal, discount, totalFare, sym,
      fmt: (v: number) => `${sym}${v.toFixed(2)}`,
    };
  }, [fareEstimate, townPricing, passengerCount, rideStops, studentDiscountAvailable]);

  // Larger packages take up more of a driver's boot and are worth more to
  // carry — a flat surcharge on top of the same distance-derived base every
  // size shares, not a separate fare model.
  const PARCEL_SIZE_SURCHARGE: Record<'small' | 'medium' | 'large', number> = { small: 0, medium: 0.5, large: 1.5 };

  // Ride tier list — Economy is the real priced fare (fareBreakdown); Share and
  // Parcel are derived client-side from the same base numbers, same pattern the
  // app already uses to build fareBreakdown itself. Their fare is sent as-is in
  // the ride request, same as Economy's.
  const rideTierOptions: RideTierOption[] = useMemo(() => {
    if (!fareBreakdown || !fareEstimate) return [];
    const economyPrice = fareBreakdown.totalFare;
    // Was Math.max(economy + 2, economy * 1.4) — priced ABOVE Economy while
    // badged "Save more" (a $5 economy trip came out at $7). Share only
    // makes sense as a real discount: 30% off, matching the 4s mockup's
    // $5.00 → $3.50 example exactly, floored at the town's base fare so it
    // never undercuts the minimum any trip is allowed to cost.
    const sharePrice = Math.max(economyPrice * 0.7, fareBreakdown.baseFare);
    const parcelBasePrice = Math.max(fareBreakdown.baseFare, fareBreakdown.baseFare + fareBreakdown.distanceFare * 0.6);
    const parcelPrice = parcelBasePrice + PARCEL_SIZE_SURCHARGE[parcelSize];
    const etaMinutes = Math.max(1, Math.round(fareEstimate.durationMinutes));
    return [
      { id: 'economy', name: 'Economy', capacity: 4, etaMinutes, price: economyPrice, badge: 'Fast pickup', badgeVariant: 'primary' },
      { id: 'share', name: 'Share Ride', capacity: 4, etaMinutes: etaMinutes + 2, price: sharePrice, badge: 'Save more', badgeVariant: 'accent' },
      { id: 'parcel', name: 'Parcel', capacity: 1, etaMinutes: Math.max(etaMinutes, 10), price: parcelPrice, badge: 'Send anything', badgeVariant: 'accent' },
    ];
  }, [fareBreakdown, fareEstimate, parcelSize]);

  const selectedTierPrice = rideTierOptions.find((t) => t.id === selectedTier)?.price ?? fareBreakdown?.totalFare ?? 0;

  // Pre-destination tier picker — same three tiers, no fare/ETA yet (both
  // need a real route). Never fabricate a number here.
  const rideTierOptionsNoFare: RideTierOption[] = useMemo(() => [
    { id: 'economy', name: 'Economy', capacity: 4, etaMinutes: null, price: null, badge: 'Fast pickup', badgeVariant: 'primary' },
    { id: 'share', name: 'Share Ride', capacity: 4, etaMinutes: null, price: null, badge: 'Save more', badgeVariant: 'accent' },
    { id: 'parcel', name: 'Parcel', capacity: 1, etaMinutes: null, price: null, badge: 'Send anything', badgeVariant: 'accent' },
  ], []);

  const handleSelectTier = (id: RideTierId) => {
    setSelectedTier(id);
    setServiceType(id === 'parcel' ? 'courier' : 'ride');
    haptic('light');
  };

  // ── handlers ──
  const applyPosition = useCallback(async (pos: GeolocationPosition, reverseGeocode: boolean, setPickup = true) => {
    const c = { lat: pos.coords.latitude, lng: pos.coords.longitude };
    setGpsState({ status: 'success', coords: c, error: null });
    if (setPickup) {
      setPickupLocation((prev) => prev && prev.name !== 'My location' ? prev : { name: 'My location', lat: c.lat, lng: c.lng });
      setActiveField(null);
    }

    // Use detected town
    const detected = detectTown(c.lat, c.lng);
    setSelectedTown(detected);

    if (!reverseGeocode) return;
    // Reverse geocode to get city name for better results
    try {
      const result = await reverseZW(c.lat, c.lng);
      const name = result?.name || result?.display_name?.split(',')[0] || 'My location';
      if (setPickup) setPickupLocation({ name, lat: c.lat, lng: c.lng });
    } catch (e) {
      console.error('Reverse geocode error:', e);
    }
  }, []);

  /**
   * `fast` = coarse/cached fix used on mount so the map can centre almost
   * immediately (high-accuracy GPS can take several seconds on low-end
   * devices). A precise fix is requested straight after in the background.
   *
   * `setPickup` = false for passive/background fetches (initial mount,
   * granting permission) — those should only centre the map and detect the
   * town, never silently fill in a pickup and shove the rider off the
   * "Where to?" home screen. Only an explicit rider tap (search card, a
   * shortcut tile, or the on-screen "use my location" buttons) is allowed
   * to set pickupLocation and advance the flow.
   */
  const handleUseMyLocation = useCallback((fast = false, setPickup = true) => {
    // An explicit "use my location" ask (or the initial already-decided-
    // permission fetch, where this is a no-op since nothing's been picked
    // yet) always wins back over a manually-selected town's center. The
    // background "upgrade to precise fix" request below does NOT re-enter
    // this function, so it can't undo a town selection made in the meantime.
    setPreferredCenter(null);
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
        (pos) => { void applyPosition(pos, true, setPickup); },
        onError,
        { enableHighAccuracy: true, timeout: 10000 },
      );
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        void applyPosition(pos, false, setPickup);
        // Upgrade to a precise fix + street-level label once painted.
        navigator.geolocation.getCurrentPosition(
          (precise) => { void applyPosition(precise, true, setPickup); },
          () => {},
          { enableHighAccuracy: true, timeout: 10000 },
        );
      },
      // Coarse attempt failed (or timed out) — fall back to the precise one.
      () => {
        navigator.geolocation.getCurrentPosition(
          (pos) => { void applyPosition(pos, true, setPickup); },
          onError,
          { enableHighAccuracy: true, timeout: 10000 },
        );
      },
      { enableHighAccuracy: false, timeout: 4000, maximumAge: 60000 },
    );
  }, [applyPosition]);

  // Lifted to component scope so both the home-content row (Where-to card,
  // Home/Work tiles) and the pinned-row PickMe CTA below can share it,
  // instead of each having their own copy of "how do we get a pickup."
  const ensurePickup = useCallback(() => {
    if (pickupLocation) return;
    if (gpsState.coords) {
      setPickupLocation({ name: 'My location', lat: gpsState.coords.lat, lng: gpsState.coords.lng });
    } else {
      if (gpsState.status === 'idle') handleUseMyLocation();
      setPickupLocation({ name: `${selectedTown.name} centre`, lat: selectedTown.center.lat, lng: selectedTown.center.lng });
    }
  }, [pickupLocation, gpsState.coords, gpsState.status, selectedTown, handleUseMyLocation]);

  // Runs on every "a place was picked" path (landmark/street/nominatim
  // search results, recents, an existing Home/Work shortcut) — when the
  // rider tapped Home/Work before either was ever saved, the very next
  // place they pick both completes their pickup/dropoff selection *and*
  // gets saved as that favorite, so future taps are instant.
  const saveFavoriteIfSetting = useCallback((loc: SelectedLocation) => {
    if (!settingFavorite || !user?.id) return;
    const key = settingFavorite;
    const label = key === 'home' ? 'Home' : 'Work';
    setSettingFavorite(null);
    supabase
      .from('favorite_locations')
      .insert([{ user_id: user.id, name: label, address: loc.name, latitude: loc.lat, longitude: loc.lng, icon: key }] as never)
      .then(({ error }) => {
        if (error) {
          toast({ title: `Couldn't save ${label}`, description: error.message, variant: 'destructive' });
          return;
        }
        toast({ title: `${label} saved`, description: 'Tap it again next time for instant selection.' });
      });
  }, [settingFavorite, user?.id, toast]);

  const handleLandmarkSelect = (landmark: Landmark) => {
    const loc: SelectedLocation = { name: landmark.name, lat: landmark.latitude, lng: landmark.longitude };
    if (activeStopId) {
      setRideStops((prev) => prev.map((s) => s.id === activeStopId ? { ...s, address: loc.name, lat: loc.lat, lng: loc.lng } : s));
      setActiveStopId(null);
    } else if (activeField === 'pickup') setPickupLocation(loc);else
    setDropoffLocation(loc);
    setActiveField(null);setSearchQuery('');setNominatimResults([]);
    saveFavoriteIfSetting(loc);
    haptic('light');
  };

  const handleStreetSelect = (street: Street) => {
    const loc: SelectedLocation = { name: street.name, lat: street.latitude, lng: street.longitude };
    if (activeStopId) {
      setRideStops((prev) => prev.map((s) => s.id === activeStopId ? { ...s, address: loc.name, lat: loc.lat, lng: loc.lng } : s));
      setActiveStopId(null);
    } else if (activeField === 'pickup') setPickupLocation(loc);else
    setDropoffLocation(loc);
    setActiveField(null);setSearchQuery('');setNominatimResults([]);
    saveFavoriteIfSetting(loc);
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
        if (googleSessionTokenRef.current) url.searchParams.set('sessionToken', googleSessionTokenRef.current);
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
      } finally {
        // Selection ends the autocomplete session — next search starts a fresh token.
        googleSessionTokenRef.current = null;
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
    saveFavoriteIfSetting(loc);
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

  const handleTownSelect = useCallback((town: TownConfig) => {
    setSelectedTown(town);
    setPickupLocation(null);
    setDropoffLocation(null);
    setPreferredCenter(town.center);
  }, []);

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
      // Only invoked (see the gating effect below) once our own landmarks +
      // streets data has already come up thin, so this never outranks local data.
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      try {
        if (!googleSessionTokenRef.current) {
          googleSessionTokenRef.current = typeof crypto !== 'undefined' && crypto.randomUUID
            ? crypto.randomUUID()
            : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        }
        const base = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/google-places-search`;
        const url = new URL(base);
        url.searchParams.set('q', query.trim());
        url.searchParams.set('lat', String(selectedTown.center.lat));
        url.searchParams.set('lng', String(selectedTown.center.lng));
        url.searchParams.set('radiusKm', String(selectedTown.radiusKm));
        url.searchParams.set('sessionToken', googleSessionTokenRef.current);

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
        if (import.meta.env.DEV) {
          const googleCount = results.filter((r) => r.source === 'google').length;
          const osmCount = results.filter((r) => r.source === 'osm').length;
          console.log(`[search] fallback tail for "${query.trim()}": ${googleCount} google, ${osmCount} nominatim`);
        }
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

  // Google is a quota-limited demo key, so only spend it when our own data
  // (landmarks + streets) is thin — otherwise local results already answer
  // the query and a Google call would just burn the daily allowance for nothing.
  const GOOGLE_FALLBACK_MIN_QUERY_LENGTH = 3;
  const GOOGLE_FALLBACK_LOCAL_RESULT_THRESHOLD = 5;
  useEffect(() => {
    const trimmed = searchQuery.trim();
    if (trimmed.length < GOOGLE_FALLBACK_MIN_QUERY_LENGTH) {
      setNominatimResults([]);
      setNominatimLoading(false);
      return;
    }
    // Wait for our own landmarks + streets results to settle before deciding
    // local coverage is thin — both are now server-side searches, so a
    // premature check would fire Google before the local answer is in.
    if (landmarksLoading || streetsLoading) return;

    const localCount = landmarks.length + streets.length;
    if (localCount >= GOOGLE_FALLBACK_LOCAL_RESULT_THRESHOLD) {
      if (import.meta.env.DEV) {
        console.log(`[search] "${trimmed}" has ${localCount} local matches — skipping Google fallback`);
      }
      setNominatimResults([]);
      setNominatimLoading(false);
      return;
    }
    handleNominatimSearch(trimmed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery, landmarks, streets, landmarksLoading, streetsLoading, handleNominatimSearch]);

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

  const handlePickPassengerFromContacts = async () => {
    const result = await pickNativeContact();
    if (result.status === 'picked') {
      setPassengerName(result.name);
      setPassengerPhone(result.phone);
      haptic('light');
      toast({ title: '✅ Contact selected', description: `${result.name} — ${result.phone}` });
    } else if (result.status === 'unsupported') {
      toast({ title: 'Contacts unavailable', description: 'Type the name and number in below instead.' });
    }
  };

  // Same trip_events / event_type: 'rider_note' log RideMatching.tsx and
  // FullScreenNavigation.tsx already read — this is the driver-visible
  // source of truth for the note, not a column on rides.
  const handleSaveNote = (note: string, reuseEveryTrip: boolean) => {
    if (currentRideId && note) {
      supabase.from('trip_events').insert([{
        ride_id: currentRideId,
        actor_id: user?.id ?? null,
        event_type: 'rider_note',
        payload: { note },
      }] as never).then(({ error }) => {
        if (error) console.error('Rider note insert failed:', error.message);
      });
    }
    if (!user?.id) return;
    supabase.from('profiles').update({ default_ride_note: reuseEveryTrip ? (note || null) : null } as never).eq('user_id', user.id).then(({ error }) => {
      if (error) console.error('Saving default note failed:', error.message);
    });
  };

  const handleSendOffer = async (customFare: number, scheduledOverride?: Date | null) => {
    // The schedule sheet's Confirm button calls this in the same handler
    // that just set `scheduledAt` via setState — reading the state variable
    // here would see the pre-update value (React batches the update to the
    // next render), so an explicit override lets the caller pass the exact
    // date it just picked instead of racing its own setState.
    const effectiveScheduledAt = scheduledOverride !== undefined ? scheduledOverride : scheduledAt;
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
        // passenger_phone deliberately NOT sent here — the backend writes
        // it straight onto the broadly-readable rides row. It goes into
        // ride_passenger_contacts (RLS-restricted to the rider + matched
        // driver) via the explicit upsert below instead. passenger_name
        // alone is fine to carry through — it's already how the driver's
        // pre-accept request card knows this is a third-party booking.
        ...(bookForSomeoneElse && passengerName.trim() ? { passenger_name: passengerName.trim() } : {}),
        ...(effectiveScheduledAt ? { scheduled_at: effectiveScheduledAt.toISOString() } : {})
      });
      if (!result.ok) throw new Error(result.error);

      if (bookForSomeoneElse && passengerName.trim() && passengerPhone.trim() && result.ride.id) {
        await supabase.from('ride_passenger_contacts').upsert([{
          ride_id: result.ride.id,
          passenger_name: passengerName.trim(),
          passenger_phone: normalizePhoneZW(passengerPhone),
          payer: thirdPartyPayer,
          notify_booker: notifyBooker,
        }] as never);
      }

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
                    phone: normalizePhoneZW(passengerPhone),
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

      // The note has to reach the driver before they accept — logged as a
      // trip_events row (the same source RideMatching.tsx and
      // FullScreenNavigation.tsx already read), not a field on the ride
      // request itself, so requestRide()/the Go backend don't need to know
      // about it.
      if (riderNote.trim() && result.ride.id) {
        supabase.from('trip_events').insert([{
          ride_id: result.ride.id,
          actor_id: user?.id ?? null,
          event_type: 'rider_note',
          payload: { note: riderNote.trim() },
        }] as never).then(({ error }) => {
          if (error) console.error('Rider note insert failed:', error.message);
        });
      }

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
      if (!effectiveScheduledAt) {
        navigate(`/ride/${result.ride.id}/matching`, { replace: true });
      } else {
        toast({ title: 'Ride scheduled!', description: 'Your ride has been scheduled for later.' });
        setRideStatus('idle');setRideStops([]);
      }
    } catch (error: unknown) {toast({ title: 'Failed to send offer', description: (error as Error).message, variant: 'destructive' });setRideStatus('idle');} finally {setIsRequesting(false);}
  };

  const handleSendParcelOffer = async (data: ParcelBookingData) => {
    if (!user) { setAuthMode('login'); setAuthModalOpen(true); return; }
    if (!pickupLocation || !dropoffLocation || !fareEstimate) { toast({ title: 'Select pickup and destination', variant: 'destructive' }); return; }
    const parcelFare = rideTierOptions.find((t) => t.id === 'parcel')?.price ?? selectedTierPrice;
    if (paymentMethod === 'wallet' && walletBalance < parcelFare) {
      toast({
        title: 'Insufficient wallet balance',
        description: `You need $${parcelFare.toFixed(2)} but only have $${walletBalance.toFixed(2)}. Please top up or select Cash Payment.`,
        variant: 'destructive',
      });
      return;
    }

    haptic('medium');
    setIsRequesting(true);
    setRideStatus('searching');
    try {
      const result = await requestRide({
        pickup_address: pickupLocation.name, pickup_lat: pickupLocation.lat, pickup_lng: pickupLocation.lng,
        dropoff_address: dropoffLocation.name, dropoff_lat: dropoffLocation.lat, dropoff_lng: dropoffLocation.lng,
        distance_km: fareEstimate.distanceKm, duration_minutes: fareEstimate.durationMinutes,
        fare: parcelFare,
        route_polyline: routeData?.geometry || null,
        passenger_count: 1,
        payment_method: paymentMethod, vehicle_type: 'parcel',
        town_id: selectedTown?.id ?? null,
        gender_preference: 'any',
      });
      if (!result.ok) throw new Error(result.error);
      const rideId = result.ride.id;
      setCurrentRideId(rideId);

      const recipientPhone = normalizePhoneZW(data.recipientPhone);

      // Judging fields (size/note/who-pays/photo) are openly readable so a
      // browsing driver can decide whether to accept before matching — only
      // the recipient's phone lives in the separate, matched-only table.
      await supabase.from('ride_parcel_details').insert([{
        ride_id: rideId,
        package_size: data.packageSize,
        recipient_name: data.recipientName.trim(),
        delivery_note: data.deliveryNote.trim() || null,
        who_pays: data.whoPays,
        photo_path: data.photoPath,
      }] as never);
      await supabase.from('ride_parcel_contacts').insert([{
        ride_id: rideId,
        recipient_phone: recipientPhone,
      }] as never);

      // Best-effort SMS — the recipient isn't an app user, SMS is the only
      // channel that reaches them. Never blocks the booking on failure.
      supabase.auth.getSession().then(({ data: sessionData }) => {
        const token = sessionData.session?.access_token;
        if (!token) return;
        const bookerName = user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'Someone';
        fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sms-invite`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            phone: recipientPhone,
            messageType: 'parcel_booked',
            bookerName,
            pickup: pickupLocation.name,
            dropoff: dropoffLocation.name,
          }),
        }).catch(() => {});
      }).catch(() => {});

      setParcelSheetOpen(false);
      navigate(`/ride/${rideId}/matching`, { replace: true });
    } catch (error: unknown) {
      toast({ title: 'Failed to send parcel', description: (error as Error).message, variant: 'destructive' });
      setRideStatus('idle');
    } finally {
      setIsRequesting(false);
    }
  };

  const handleScheduleConfirm = (date: Date, remindMe: boolean) => {
    setScheduledAt(date);
    setSchedulePickerOpen(false);
    if (remindMe) {
      requestNotificationPermission().then((granted) => {
        if (!granted) return;
        const delay = date.getTime() - 30 * 60 * 1000 - Date.now();
        // Best-effort only: a plain in-tab timer, not a server-scheduled
        // push — it's lost if the tab/app closes before it fires. There's
        // no backend job yet that could deliver this reliably hours later;
        // see the scheduled-dispatch gap noted alongside this feature.
        if (delay > 0) {
          setTimeout(() => {
            showLocalNotification('Ride reminder', 'Your scheduled ride is in 30 minutes.');
          }, delay);
        }
      });
    }
    void handleSendOffer(selectedTierPrice, date);
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
    // Google fallback is triggered by the gating effect above, once landmarks
    // + streets results for this query are known to be thin.
  };
  const canRequestRide = pickupLocation && dropoffLocation && fareEstimate && !isRequesting;
  const firstName = (profileName || (user?.user_metadata?.full_name as string | undefined) || user?.email?.split('@')[0] || '').split(' ')[0];
  const mapCenter = preferredCenter ?? gpsState.coords ?? pickupLocation ?? selectedTown.center;
  const mapZoom = gpsState.coords ? 16 : 14;
  const searchResultRows: SearchResultRow[] = useMemo(() => {
    // Landmarks + streets are our own DB, ranked together by fuzzy match
    // strength so a strong street match can outrank a weak landmark match.
    // The geocoder (cache + Nominatim) is a fallback tail, not ranked in.
    type ScoredRow = SearchResultRow & { matchScore: number };
    const dbRows: ScoredRow[] = [];

    landmarks.forEach((l) => dbRows.push({
      id: `lm-${l.id}`,
      name: l.name,
      secondary: [l.category, l.distance !== undefined ? (l.distance < 1 ? `${Math.round(l.distance * 1000)}m` : `${l.distance.toFixed(1)}km`) : null].filter(Boolean).join(' · '),
      onSelect: () => handleLandmarkSelect(l),
      matchScore: l.matchScore ?? 0,
      source: 'landmark',
    }));

    streets.forEach((s) => dbRows.push({
      id: `st-${s.id}`,
      name: s.name,
      secondary: [s.road_class, s.town].filter(Boolean).join(' · '),
      onSelect: () => handleStreetSelect(s),
      matchScore: s.matchScore ?? 0,
      source: 'street',
    }));

    dbRows.sort((a, b) => b.matchScore - a.matchScore);
    const rows: SearchResultRow[] = dbRows.map(({ matchScore: _matchScore, ...row }) => row);

    cachedPlaceResults.forEach((r, i) => rows.push({
      id: `cache-${i}`, name: r.name, secondary: r.displayName, onSelect: () => handleNominatimSelect(r), source: 'cache',
    }));
    nominatimResults.forEach((r, i) => rows.push({
      id: `nom-${i}`, name: r.name, secondary: r.displayName, onSelect: () => handleNominatimSelect(r),
      source: r.source === 'google' ? 'google' : 'nominatim',
    }));
    if (import.meta.env.DEV && searchQuery.trim().length >= 3) {
      const counts = rows.reduce<Record<string, number>>((acc, r) => {
        const key = r.source ?? 'unknown';
        acc[key] = (acc[key] ?? 0) + 1;
        return acc;
      }, {});
      console.log(`[search] "${searchQuery.trim()}" result sources:`, counts);
    }
    return rows;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [landmarks, streets, cachedPlaceResults, nominatimResults, activeField, activeStopId]);

  const showHomeContent = rideStatus === 'idle' && !pickupLocation && !dropoffLocation;
  const unifiedPlaceResults = [...cachedPlaceResults, ...nominatimResults.map((item) => ({ ...item, source: 'nominatim' as const }))]
    .filter((item, index, arr) => {
      const key = `${item.name}-${item.displayName}`.toLowerCase();
      return arr.findIndex((candidate) => `${candidate.name}-${candidate.displayName}`.toLowerCase() === key) === index;
    });

  // ═══════════════════════════════════════════
  // MAIN RIDE BOOKING UI
  // ═══════════════════════════════════════════
  return (
    <div className="relative h-[100dvh] w-full overflow-hidden bg-background">
      {/* ── MAP ── */}
      <div className="absolute inset-0">
        <MapboxMap pickup={pickupLocation} dropoff={dropoffLocation} routeGeometry={routeData?.geometry} onMapClick={handleMapClick} defaultCenter={mapCenter} preferredCenter={preferredCenter} defaultZoom={mapZoom} className="w-full h-full" height="100%" drivers={nearbyDrivers} stops={rideStops.filter(s => s.lat && s.lng)} riderGender={(riderPrefs?.gender as "male" | "female" | undefined) ?? null} />

        {/* Map chrome — back button (top-left) + menu/notifications/locate/navigation
            stack (top-right). Nothing else floats over the map, per the reference. */}
        <button
          onClick={() => showHomeContent ? setMenuOpen(true) : navigate(-1)}
          aria-label={showHomeContent ? 'Menu' : 'Back'}
          className="absolute left-3 z-40 flex items-center justify-center rounded-full active:scale-90 transition-transform"
          style={{ top: 'calc(env(safe-area-inset-top) + 7px)', width: 52, height: 52, ...glassSurface }}
        >
          {showHomeContent ? <Menu className="w-5 h-5" style={{ color: RIDE_TEXT }} /> : <ArrowLeft className="w-5 h-5" style={{ color: RIDE_TEXT }} />}
        </button>

        <div className="absolute right-3 z-40 flex flex-col gap-3" style={{ top: 'calc(env(safe-area-inset-top) + 7px)' }}>
          {!showHomeContent && (
            <button
              onClick={() => setMenuOpen(true)}
              aria-label="Menu"
              className="flex items-center justify-center rounded-full active:scale-90 transition-transform"
              style={{ width: 52, height: 52, ...glassSurface }}
            >
              <Menu className="w-5 h-5" style={{ color: RIDE_TEXT }} />
            </button>
          )}
          <NotificationBell
            className="active:scale-90 transition-transform"
            style={{ width: 52, height: 52, ...glassSurface }}
          />
          <button
            onClick={() => handleUseMyLocation()}
            aria-label="Use my location"
            className="flex items-center justify-center rounded-full active:scale-90 transition-transform"
            style={{ width: 52, height: 52, ...glassSurface }}
          >
            {gpsState.status === 'loading' ? <Loader2 className="w-5 h-5 animate-spin" style={{ color: RIDE_RED }} /> : <Locate className="w-5 h-5" style={{ color: RIDE_TEXT }} />}
          </button>
          {!showHomeContent && (
            <button
              onClick={() => handleUseMyLocation()}
              aria-label="Recenter navigation"
              className="flex items-center justify-center rounded-full active:scale-90 transition-transform"
              style={{ width: 52, height: 52, ...glassSurface }}
            >
              <Navigation className="w-5 h-5" style={{ color: RIDE_TEXT }} />
            </button>
          )}
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
        <div className="absolute left-4 right-4 z-30" style={{ top: 'calc(env(safe-area-inset-top) + 104px)' }}>
            <div className="glass-card-heavy px-5 py-3.5 text-sm font-medium text-center text-foreground">
              📍 Tap map to set {activeField === 'pickup' ? 'pickup' : 'drop-off'}
            </div>
          </div>
        }
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
      <RideGlassPanel
        className="absolute left-0 right-0 z-50"
        onRibbonClick={() => setSheetExpanded((e) => !e)}
        handleWidth={showHomeContent ? 140 : undefined}
        style={{
          bottom: 0,
          // Idle content is fixed and compact (three row-2 tiles + row-3 buttons) —
          // size to it exactly instead of capping by viewport height, so nothing
          // in row 2 or row 3 ever needs a scroll to come into view.
          maxHeight: showHomeContent ? 'none' : (sheetExpanded ? '60vh' : '38vh'),
          transition: 'max-height 0.3s cubic-bezier(0.32,0.72,0,1)',
          paddingBottom: 'env(safe-area-inset-bottom)',
        }}>

        {/* Location pills row — pinned above the content, always visible, never scrolls.
            Same treatment on every screen, including idle (row 1 of the 4e layout). */}
        <div className="shrink-0 flex items-center gap-2.5 px-4 pt-2 pb-1">
          <TownSelectorSheet currentTown={selectedTown} onSelect={handleTownSelect} />
          <span
            className="ml-auto inline-flex items-center gap-1.5 shrink-0"
            style={{ height: 36, padding: '0 12px', borderRadius: 999, ...glassSurface }}
          >
            <Sparkles className="w-[13px] h-[13px]" style={{ color: RIDE_TEXT }} />
            <span className="text-[12.5px] font-medium" style={{ color: RIDE_TEXT }}>{selectedTown.radiusKm}+ km area</span>
          </span>
        </div>

        {/* Scrollable content */}
        <div
          className="flex-1 px-4 pt-1 pb-1.5 space-y-2 min-h-0 overflow-y-auto overscroll-contain"
          style={showHomeContent ? { paddingBottom: 4 } : undefined}
        >
          {/* ── HOME CONTENT (idle state, before booking starts) ──
              Row 2 of the 4e layout: Where-to card + Home/Work tiles, one row, fixed height. */}
          {showHomeContent && !tierPickerOpen && (() => {
            const pickDropoff = (loc: { name: string; lat: number; lng: number }) => {
              ensurePickup();
              setDropoffLocation(loc);
              setActiveField(null);
              setSearchQuery('');
              haptic('light');
              setSheetExpanded(true);
            };
            const requestSetShortcut = (key: 'home' | 'work') => {
              setSettingFavorite(key);
              ensurePickup();
              setActiveField('dropoff');
              setSearchQuery('');
              setSheetExpanded(true);
            };
            return (
              <div className="flex items-center gap-2" style={{ height: 62 }}>
                <RideHomeGreeting
                  name={firstName}
                  onSearchClick={() => setTierPickerOpen(true)}
                />
                <QuickShortcutsRow onSelect={pickDropoff} onRequestSet={requestSetShortcut} />
              </div>
            );
          })()}

          {/* ── RIDE TYPE PICKER (idle state, before destination is known) ──
              Choosing a tier here just records the choice and moves on to
              destination entry; RideTierSelector re-renders with real fares
              once pickup/dropoff (and so a route) exist, below. */}
          {showHomeContent && tierPickerOpen && (
            <div className="space-y-2">
              <div className="flex items-center justify-between px-1">
                <p className="text-[13px] font-bold" style={{ color: RIDE_TEXT }}>Choose a ride</p>
                <button
                  type="button"
                  onClick={() => setTierPickerOpen(false)}
                  aria-label="Close"
                  className="flex items-center justify-center rounded-full active:scale-90 transition-transform"
                  style={{ width: 28, height: 28, background: 'rgba(17,17,17,.06)' }}
                >
                  <X className="w-3.5 h-3.5" style={{ color: RIDE_TEXT }} />
                </button>
              </div>
              <RideTierSelector
                options={rideTierOptionsNoFare}
                selected={selectedTier}
                onSelect={(id) => {
                  handleSelectTier(id);
                  setTierPickerOpen(false);
                  ensurePickup();
                  setActiveField('dropoff');
                  setSearchQuery('');
                  setSheetExpanded(true);
                }}
                currencySymbol={fareBreakdown?.sym ?? '$'}
              />
            </div>
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


          {/* Ride tier list — Economy / Share Ride / Parcel */}
          {pickupLocation && dropoffLocation && rideTierOptions.length > 0 && (
            <RideTierSelector
              options={rideTierOptions}
              selected={selectedTier}
              onSelect={handleSelectTier}
              currencySymbol={fareBreakdown?.sym ?? '$'}
              passengerCount={passengerCount}
              onPassengerCountChange={setPassengerCount}
            />
          )}

          {/* Rider preferences live in Profile only; they are attached to the ride
              and surfaced to the assigned driver, not shown here. */}

          {/* ─── Negotiation (expanded) ─── */}
          {pickupLocation && dropoffLocation && fareBreakdown && rideStatus !== 'idle' && (
            <button onClick={handleCancelRide} className="w-full text-center text-sm text-destructive font-medium py-1.5 hover:underline transition-colors">Cancel Ride</button>
          )}
        </div>

        {/* ── PINNED BOTTOM ROW ── row 3 of the 4e layout when idle (schedule + Find
            Drivers); the payment/schedule/CTA stack for every other booking state. */}
        <div
          className="shrink-0 px-4 pb-2 pt-1.5"
          style={showHomeContent ? { paddingTop: 4 } : undefined}
        >
          {showHomeContent ? (
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setSchedulePickerOpen(true)}
                aria-label={scheduledAt ? 'Scheduled ride' : 'Schedule a ride'}
                className="shrink-0 flex items-center justify-center active:scale-95 transition-transform"
                style={{ width: 44, height: 44, borderRadius: 16, ...glassSurface }}>
                <Calendar className="w-[18px] h-[18px]" style={{ color: RIDE_RED }} />
              </button>
              {/* Same "start booking" action as tapping the Where-to card
                  above — this is the idle screen's primary CTA, not a
                  decorative brand mark, so it needs to actually do that. */}
              <button
                type="button"
                onClick={() => setTierPickerOpen(true)}
                className="relative flex-1 min-w-0 flex items-center justify-center gap-2 overflow-hidden active:scale-[0.97] transition-transform"
                style={{ height: 44, borderRadius: 16, ...redCta }}>
                <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2" style={{ background: 'linear-gradient(180deg, rgba(255,255,255,.2), rgba(255,255,255,0))' }} />
                <span className="relative text-[16px] font-bold text-white">PickMe</span>
                <span className="relative flex items-center justify-center rounded-full" style={{ width: 23, height: 23, background: 'rgba(255,255,255,.24)', boxShadow: 'inset 0 .5px 0 rgba(255,255,255,.5)' }}>
                  <ChevronRight className="w-[15px] h-[15px] text-white" strokeWidth={2.6} />
                </span>
              </button>
            </div>
          ) : pickupLocation && dropoffLocation && fareBreakdown ? (
            <>
              {/* Luggage prompt — shown once, right after drop-off is picked */}
              {luggagePromptOpen && (
                <div className="mb-1.5 flex items-center justify-between gap-2 px-3 py-1.5 rounded-xl bg-accent/10 border border-accent/30">
                  <span className="text-[12px] font-semibold text-foreground">🧳 Travelling with luggage?</span>
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => { setLuggagePromptOpen(false); setLuggageOpen(true); }}
                      className="px-3 py-1 rounded-full bg-primary text-accent text-[11px] font-bold active:scale-95 transition-transform">
                      Yes
                    </button>
                    <button
                      onClick={() => { setLuggagePromptOpen(false); setPaymentPopupOpen(true); }}
                      className="px-3 py-1 rounded-full bg-muted text-muted-foreground text-[11px] font-semibold active:scale-95 transition-transform">
                      No
                    </button>
                  </div>
                </div>
              )}
              <button
                type="button"
                onClick={() => setPaymentPopupOpen(true)}
                className="w-full flex items-center gap-2.5 px-3.5 mb-2.5 active:opacity-80 transition-opacity"
                style={{ height: 44, borderRadius: 15, ...glassSurface }}>
                <CreditCard className="w-[18px] h-[18px]" style={{ color: RIDE_TEXT }} />
                <span className="flex-1 text-left text-[14.5px] font-medium" style={{ color: RIDE_TEXT }}>
                  {paymentMethodConfirmed ? (paymentMethod === 'wallet' ? 'Wallet' : 'Cash') : 'Select payment method'}
                </span>
                <ChevronRight className="w-[17px] h-[17px]" style={{ color: RIDE_TEXT_2 }} />
              </button>

              {selectedTier !== 'parcel' && (
                <button
                  type="button"
                  onClick={() => setBookingForSomeoneElseOpen(true)}
                  className="w-full flex items-center gap-2.5 px-3.5 mb-2.5 active:opacity-80 transition-opacity"
                  style={{ height: 44, borderRadius: 15, ...glassSurface }}>
                  <UserPlus className="w-[18px] h-[18px]" style={{ color: RIDE_TEXT }} />
                  <span className="flex-1 text-left text-[14.5px] font-medium" style={{ color: RIDE_TEXT }}>
                    {bookForSomeoneElse && passengerName.trim() ? `Riding: ${passengerName.trim().split(' ')[0]}` : 'Who is riding? · Myself'}
                  </span>
                  <ChevronRight className="w-[17px] h-[17px]" style={{ color: RIDE_TEXT_2 }} />
                </button>
              )}

              <button
                type="button"
                onClick={() => setNoteSheetOpen(true)}
                className="w-full flex items-center gap-2.5 px-3.5 mb-2.5 active:opacity-80 transition-opacity"
                style={{ height: 44, borderRadius: 15, ...glassSurface }}>
                <MessageCircle className="w-[18px] h-[18px]" style={{ color: RIDE_TEXT }} />
                <span className="flex-1 text-left text-[14.5px] font-medium truncate" style={{ color: RIDE_TEXT }}>
                  {riderNote.trim() ? riderNote.trim() : 'Note for your driver · optional'}
                </span>
                <ChevronRight className="w-[17px] h-[17px]" style={{ color: RIDE_TEXT_2 }} />
              </button>

              <div className="flex items-center gap-3">
                {/* Scheduling a Parcel isn't supported yet — ScheduleRide's
                    confirm goes straight to handleSendOffer, which has no
                    idea about recipient/size/photo, so a scheduled parcel
                    would silently skip ParcelBookingSheet entirely. Hiding
                    this here until scheduled parcels have their own path,
                    rather than letting that gap through. */}
                {selectedTier !== 'parcel' && (
                  <button
                    type="button"
                    onClick={() => setSchedulePickerOpen(true)}
                    className="shrink-0 flex items-center justify-center gap-2 active:scale-[0.97] transition-transform"
                    style={{
                      width: 132,
                      height: 48,
                      borderRadius: 15,
                      background: 'rgba(255,255,255,.55)',
                      backdropFilter: 'blur(20px) saturate(180%)',
                      WebkitBackdropFilter: 'blur(20px) saturate(180%)',
                      boxShadow: 'inset 0 .5px 0 rgba(255,255,255,.9), inset 0 0 0 1px rgba(184,17,4,.22), 0 6px 14px rgba(0,0,0,.05)',
                    }}>
                    <Calendar className="w-[18px] h-[18px]" style={{ color: RIDE_RED }} />
                    <span className="text-[14.5px] font-bold" style={{ color: RIDE_RED }}>{scheduledAt ? 'Scheduled' : 'Schedule'}</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    if (selectedTier === 'parcel') { setParcelSheetOpen(true); return; }
                    if (selectedTier === 'share') { setShareSheetOpen(true); return; }
                    handleSendOffer(selectedTierPrice);
                  }}
                  disabled={isRequesting}
                  className="relative flex-1 flex items-center justify-center gap-2 overflow-hidden active:scale-[0.97] transition-transform disabled:opacity-70"
                  style={{ height: 48, borderRadius: 15, ...redCta }}>
                  <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2" style={{ background: 'linear-gradient(180deg, rgba(255,255,255,.2), rgba(255,255,255,0))' }} />
                  {isRequesting ? (
                    <>
                      <div className="relative w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      <span className="relative text-[15.5px] font-bold text-white">Finding your ride…</span>
                    </>
                  ) : (
                    <>
                      <span className="relative text-[15.5px] font-bold text-white">Choose {RIDE_TIER_LABELS[selectedTier]}</span>
                      <span className="relative flex items-center justify-center rounded-full" style={{ width: 23, height: 23, background: 'rgba(255,255,255,.24)', boxShadow: 'inset 0 .5px 0 rgba(255,255,255,.5)' }}>
                        <ChevronRight className="w-[15px] h-[15px] text-white" strokeWidth={2.6} />
                      </span>
                    </>
                  )}
                </button>
              </div>
            </>
          ) : (
            <button
              type="button"
              disabled
              className="w-full flex items-center justify-center"
              style={{ height: 48, borderRadius: 15, ...redCta, opacity: 0.55 }}>
              {pickupLocation && dropoffLocation ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/60 border-t-transparent rounded-full animate-spin mr-2" />
                  <span className="text-[15.5px] font-bold text-white">Calculating…</span>
                </>
              ) : (
                <span className="text-[15.5px] font-bold text-white">Find Drivers</span>
              )}
            </button>
          )}
        </div>
      </RideGlassPanel>

      {/* ═══ DESTINATION SEARCH SCREEN ═══ */}
      {activeField && !mapPickMode && (
        <DestinationSearchScreen
          activeField={activeField}
          onActiveFieldChange={(f) => {setActiveField(f);setSearchQuery('');setNominatimResults([]);}}
          pickupName={pickupLocation?.name || ''}
          dropoffName={dropoffLocation?.name || ''}
          query={searchQuery}
          onQueryChange={handleSearchChange}
          onClose={() => {
            setActiveField(null);
            setSearchQuery('');
            setNominatimResults([]);
            // Dropoff not chosen yet means we're still in the initial "Where to?"
            // flow, where pickup was auto-filled by ensurePickup() — undo that too
            // so back returns to the home greeting instead of the summary pill.
            if (!dropoffLocation) setPickupLocation(null);
          }}
          onUseMyLocation={() => handleUseMyLocation()}
          gpsLoading={gpsState.status === 'loading'}
          onChooseOnMap={() => setMapPickMode(true)}
          onSelectPlace={(place) => {
            const loc: SelectedLocation = { name: place.name, lat: place.lat, lng: place.lng };
            if (activeField === 'pickup') {setPickupLocation(loc);setActiveField('dropoff');}
            else {setDropoffLocation(loc);setActiveField(null);}
            setSearchQuery('');
            saveFavoriteIfSetting(loc);
          }}
          loading={landmarksLoading || streetsLoading || cachedPlacesLoading || nominatimLoading}
          results={searchResultRows}
          settingFavorite={settingFavorite}
          onRequestSetFavorite={setSettingFavorite}
        />
      )}

      {/* Modals */}
      <OffersModal isOpen={offersOpen} tripId={currentRideId || ''} viewing={viewingDrivers} offers={offers} onAcceptOffer={handleAcceptOffer} onDeclineOffer={handleDeclineOffer} onCancelRide={handleCancelRide} onClose={() => setOffersOpen(false)} />
      <AuthModalWrapper isOpen={authModalOpen} onClose={() => setAuthModalOpen(false)} mode={authMode} onSwitchMode={() => setAuthMode((m) => m === 'login' ? 'signup' : 'login')} />
      {gpsPermissionState === 'prompt' && !locationPromptDismissed && gpsState.status === 'idle' && (
        <LocationPermissionPrompt
          onAllow={() => { setLocationPromptDismissed(true); handleUseMyLocation(true, false); }}
          onDismiss={() => setLocationPromptDismissed(true)}
        />
      )}
      <LuggageSheet
        open={luggageOpen}
        onClose={() => { setLuggageOpen(false); setPaymentPopupOpen(true); }}
        initial={luggageDraft}
        onSave={setLuggageDraft}
      />
      <PaymentMethodSelector
        open={paymentPopupOpen}
        onClose={() => setPaymentPopupOpen(false)}
        selected={paymentMethod}
        onSelect={setPaymentMethod}
        onConfirm={() => setPaymentMethodConfirmed(true)}
        walletBalance={walletBalance}
        estimatedFare={fareBreakdown?.totalFare ?? 0}
        tierLabel={fareBreakdown ? `${RIDE_TIER_LABELS[selectedTier]} · ${fareBreakdown.fmt(selectedTierPrice)}` : RIDE_TIER_LABELS[selectedTier]}
        restrictToCash={bookForSomeoneElse && thirdPartyPayer === 'passenger'}
        restrictReason={bookForSomeoneElse && thirdPartyPayer === 'passenger' ? `${passengerName.trim().split(' ')[0] || 'They'} pays cash on arrival — only cash works for a third-party ride` : undefined}
      />
      <NoteToDriverSheet
        open={noteSheetOpen}
        onClose={() => setNoteSheetOpen(false)}
        note={riderNote}
        onNoteChange={setRiderNote}
        reuseEveryTrip={noteReuseEveryTrip}
        onReuseEveryTripChange={setNoteReuseEveryTrip}
        onSave={handleSaveNote}
      />
      <ScheduleRide
        open={schedulePickerOpen}
        onClose={() => setSchedulePickerOpen(false)}
        onConfirm={handleScheduleConfirm}
        scheduledAt={scheduledAt}
        onCancelScheduled={() => { setScheduledAt(null); setSchedulePickerOpen(false); }}
        destinationName={dropoffLocation?.name ?? ''}
        tierLabel={RIDE_TIER_LABELS[selectedTier]}
        fareLabel={fareBreakdown ? fareBreakdown.fmt(selectedTierPrice) : ''}
      />
      <ParcelBookingSheet
        open={parcelSheetOpen}
        onClose={() => setParcelSheetOpen(false)}
        onConfirm={handleSendParcelOffer}
        submitting={isRequesting}
        pickupName={pickupLocation?.name ?? ''}
        dropoffName={dropoffLocation?.name ?? ''}
        distanceKm={fareEstimate?.distanceKm ?? 0}
        fare={rideTierOptions.find((t) => t.id === 'parcel')?.price ?? 0}
        currencySymbol={fareBreakdown?.sym ?? '$'}
        paymentMethod={paymentMethod}
        packageSize={parcelSize}
        onPackageSizeChange={setParcelSize}
      />
      <ShareRideSheet
        open={shareSheetOpen}
        onClose={() => setShareSheetOpen(false)}
        submitting={isRequesting}
        shareFare={rideTierOptions.find((t) => t.id === 'share')?.price ?? 0}
        soloFare={rideTierOptions.find((t) => t.id === 'economy')?.price ?? 0}
        dropoffTown={dropoffLocation?.name ?? ''}
        riderFirstName={firstName}
        onConfirm={() => { setShareSheetOpen(false); handleSendOffer(selectedTierPrice); }}
        onRideAlone={() => { setShareSheetOpen(false); handleSelectTier('economy'); }}
      />
      <BookingForSomeoneElse
        open={bookingForSomeoneElseOpen}
        onClose={() => setBookingForSomeoneElseOpen(false)}
        enabled={bookForSomeoneElse}
        onEnabledChange={setBookForSomeoneElse}
        tierLabel={RIDE_TIER_LABELS[selectedTier]}
        pickupName={pickupLocation?.name ?? ''}
        dropoffName={dropoffLocation?.name ?? ''}
        fare={selectedTierPrice}
        currencySymbol={fareBreakdown?.sym ?? '$'}
        paymentMethod={paymentMethod}
        passengerName={passengerName}
        onPassengerNameChange={setPassengerName}
        passengerPhone={passengerPhone}
        onPassengerPhoneChange={setPassengerPhone}
        payer={thirdPartyPayer}
        onPayerChange={setThirdPartyPayer}
        notifyBooker={notifyBooker}
        onNotifyBookerChange={setNotifyBooker}
        submitting={isRequesting}
        onOpenContacts={handlePickPassengerFromContacts}
        onConfirm={() => { setBookingForSomeoneElseOpen(false); handleSendOffer(selectedTierPrice); }}
      />
    </div>);

}


