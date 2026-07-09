interface Coords {
  lat: number;
  lng: number;
}

interface DistanceGradientLineProps {
  from: Coords;
  to: Coords;
  distanceKm: number;
}

export default function DistanceGradientLine(_props: DistanceGradientLineProps) {
  return null;
}
