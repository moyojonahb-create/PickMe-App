// Ranking helpers that push in-town street results to the top of place search.
import { getDistance } from '@/lib/towns';

export interface RankablePlace {
  name: string;
  lat: number;
  lng: number;
  displayName?: string;
  category?: string;
  class?: string;
  type?: string;
}

const STREET_TYPES = new Set([
  'road', 'residential', 'street', 'primary', 'secondary', 'tertiary',
  'unclassified', 'living_street', 'trunk', 'motorway', 'service', 'pedestrian',
]);

const STREET_WORDS = /\b(road|rd|street|st|avenue|ave|drive|dr|way|lane|ln|close|crescent|cres)\b/i;

export function isStreetLike(p: RankablePlace): boolean {
  if (p.class === 'highway') return true;
  if (p.type && STREET_TYPES.has(p.type)) return true;
  return STREET_WORDS.test(p.name || '');
}

export interface RankContext {
  townName: string;
  townCenter: { lat: number; lng: number };
  userCoords?: { lat: number; lng: number } | null;
  maxDistanceKm?: number;
}

/**
 * Sorts places so that streets inside the active town come first, then other
 * in-town results, then everything else — each group ordered by proximity to
 * the rider (GPS when available, town centre otherwise).
 */
export function rankTownStreets<T extends RankablePlace>(places: T[], ctx: RankContext): T[] {
  const origin = ctx.userCoords ?? ctx.townCenter;
  const townNeedle = ctx.townName.toLowerCase();

  const scored = places.map((p) => {
    const distanceKm = getDistance(origin.lat, origin.lng, p.lat, p.lng);
    const inTownByName = (p.displayName || '').toLowerCase().includes(townNeedle);
    const inTownByRadius = ctx.maxDistanceKm
      ? getDistance(ctx.townCenter.lat, ctx.townCenter.lng, p.lat, p.lng) <= ctx.maxDistanceKm
      : true;
    const inTown = inTownByName || inTownByRadius;

    let tier = 3;
    if (inTown && isStreetLike(p)) tier = 0;
    else if (inTown) tier = 1;
    else if (isStreetLike(p)) tier = 2;

    return { p, tier, distanceKm };
  });

  scored.sort((a, b) => (a.tier - b.tier) || (a.distanceKm - b.distanceKm));
  return scored.map((s) => s.p);
}
