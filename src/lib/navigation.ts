/**
 * External Maps navigation helper for PickMe drivers.
 * Opens Mapbox Directions (Android/desktop) or Apple Maps (iOS) with driving directions.
 */

const NAV_STORAGE_PREFIX = 'pickme_last_nav_';

export type NavTarget = 'pickup' | 'dropoff';

export function openNavTo(lat: number, lng: number, tripId: string, target: NavTarget) {
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const dest = `${lat},${lng}`;
  const mapboxWeb = `https://www.mapbox.com/directions?destination=${lng},${lat}`;

  // Persist navigation state for resume functionality
  localStorage.setItem(`${NAV_STORAGE_PREFIX}trip_id`, tripId);
  localStorage.setItem(`${NAV_STORAGE_PREFIX}target`, target);
  localStorage.setItem(`${NAV_STORAGE_PREFIX}time`, String(Date.now()));
  localStorage.setItem(`${NAV_STORAGE_PREFIX}lat`, String(lat));
  localStorage.setItem(`${NAV_STORAGE_PREFIX}lng`, String(lng));

  if (isIOS) {
    const apple = `maps://?saddr=Current%20Location&daddr=${dest}`;
    window.location.href = apple;
    setTimeout(() => window.open(mapboxWeb, '_blank'), 400);
    return;
  }

  window.open(mapboxWeb, '_blank');
}

export interface SavedNav {
  tripId: string;
  target: NavTarget;
  time: number;
  lat: number;
  lng: number;
}

const THIRTY_MINUTES = 30 * 60 * 1000;

export function getSavedNav(): SavedNav | null {
  const tripId = localStorage.getItem(`${NAV_STORAGE_PREFIX}trip_id`);
  const target = localStorage.getItem(`${NAV_STORAGE_PREFIX}target`) as NavTarget | null;
  const timeStr = localStorage.getItem(`${NAV_STORAGE_PREFIX}time`);
  const lat = localStorage.getItem(`${NAV_STORAGE_PREFIX}lat`);
  const lng = localStorage.getItem(`${NAV_STORAGE_PREFIX}lng`);

  if (!tripId || !target || !timeStr || !lat || !lng) return null;

  const time = Number(timeStr);
  if (Date.now() - time > THIRTY_MINUTES) return null;

  return { tripId, target, time, lat: Number(lat), lng: Number(lng) };
}

export function dismissNavBanner() {
  localStorage.setItem(`${NAV_STORAGE_PREFIX}dismissed`, String(Date.now()));
}

export function isNavBannerDismissed(): boolean {
  const dismissed = localStorage.getItem(`${NAV_STORAGE_PREFIX}dismissed`);
  if (!dismissed) return false;
  return Date.now() - Number(dismissed) < THIRTY_MINUTES;
}

export function clearNavState() {
  localStorage.removeItem(`${NAV_STORAGE_PREFIX}trip_id`);
  localStorage.removeItem(`${NAV_STORAGE_PREFIX}target`);
  localStorage.removeItem(`${NAV_STORAGE_PREFIX}time`);
  localStorage.removeItem(`${NAV_STORAGE_PREFIX}lat`);
  localStorage.removeItem(`${NAV_STORAGE_PREFIX}lng`);
  localStorage.removeItem(`${NAV_STORAGE_PREFIX}dismissed`);
}
