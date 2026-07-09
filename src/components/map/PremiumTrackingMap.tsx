export interface PremiumTrackingMapProps {
  map?: unknown;
  driverPosition: { lat: number; lng: number };
  riderPosition: { lat: number; lng: number };
  routePath?: Array<{ lat: number; lng: number }>;
  etaMinutes?: number;
}

export default function PremiumTrackingMap(_props: PremiumTrackingMapProps) {
  return null;
}
