// Lightweight polyline progress + speed helpers (no external deps).

export interface LatLng { lat: number; lng: number }

/** Decode a Google/OSRM encoded polyline → [lng, lat][] (GeoJSON order). */
export function decodePolyline(encoded: string): [number, number][] {
  const points: [number, number][] = [];
  let index = 0, lat = 0, lng = 0;
  while (index < encoded.length) {
    let b: number, shift = 0, result = 0;
    do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;
    shift = 0; result = 0;
    do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;
    points.push([lng / 1e5, lat / 1e5]);
  }
  return points;
}

const R = 6371000;
const toRad = (d: number) => (d * Math.PI) / 180;

export function haversineMeters(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** Bearing from a → b, degrees [0, 360). */
export function bearing(a: LatLng, b: LatLng): number {
  const φ1 = toRad(a.lat), φ2 = toRad(b.lat);
  const Δλ = toRad(b.lng - a.lng);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

/** Project point P onto segment AB, returning the closest point on the segment. */
function projectOnSegment(p: LatLng, a: [number, number], b: [number, number]): { pt: [number, number]; t: number; dist: number } {
  // Equirectangular approximation around p for cheap projection.
  const cosLat = Math.cos(toRad(p.lat));
  const ax = a[0] * cosLat, ay = a[1];
  const bx = b[0] * cosLat, by = b[1];
  const px = p.lng * cosLat, py = p.lat;
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy || 1e-12;
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const qx = ax + t * dx;
  const qy = ay + t * dy;
  const lng = qx / cosLat;
  const lat = qy;
  return { pt: [lng, lat], t, dist: haversineMeters(p, { lat, lng }) };
}

/**
 * Trim a route polyline so the visible "remaining" portion starts at the point
 * on the line closest to the driver. Returns GeoJSON coordinates [lng,lat][].
 */
export function trimRouteAhead(
  coords: [number, number][],
  driver: LatLng | null,
): { ahead: [number, number][]; remainingMeters: number; snapped: [number, number] | null } {
  if (!coords.length) return { ahead: [], remainingMeters: 0, snapped: null };
  if (!driver) {
    let total = 0;
    for (let i = 1; i < coords.length; i++) {
      total += haversineMeters(
        { lat: coords[i - 1][1], lng: coords[i - 1][0] },
        { lat: coords[i][1], lng: coords[i][0] },
      );
    }
    return { ahead: coords, remainingMeters: total, snapped: null };
  }

  let bestIdx = 0, bestT = 0, bestDist = Infinity, bestPt: [number, number] = coords[0];
  for (let i = 0; i < coords.length - 1; i++) {
    const proj = projectOnSegment(driver, coords[i], coords[i + 1]);
    if (proj.dist < bestDist) {
      bestDist = proj.dist;
      bestIdx = i;
      bestT = proj.t;
      bestPt = proj.pt;
    }
  }

  const ahead: [number, number][] = [bestPt, ...coords.slice(bestIdx + 1)];
  let remaining = 0;
  for (let i = 1; i < ahead.length; i++) {
    remaining += haversineMeters(
      { lat: ahead[i - 1][1], lng: ahead[i - 1][0] },
      { lat: ahead[i][1], lng: ahead[i][0] },
    );
  }
  return { ahead, remainingMeters: remaining, snapped: bestPt };
}

/** Exponential moving average for smoothing speed values. */
export class EMA {
  private value: number | null = null;
  constructor(private readonly alpha = 0.35) {}
  push(v: number): number {
    this.value = this.value == null ? v : this.alpha * v + (1 - this.alpha) * this.value;
    return this.value;
  }
  get current(): number { return this.value ?? 0; }
  reset() { this.value = null; }
}
