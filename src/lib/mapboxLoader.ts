const MAPBOX_GL_JS_URL = "https://api.mapbox.com/mapbox-gl-js/v3.9.4/mapbox-gl.js";
const MAPBOX_GL_CSS_URL = "https://api.mapbox.com/mapbox-gl-js/v3.9.4/mapbox-gl.css";

type MapboxMarker = {
  setLngLat: (lngLat: [number, number]) => MapboxMarker;
  addTo: (map: MapboxMapInstance) => MapboxMarker;
  remove: () => void;
};

export type MapboxMapInstance = {
  on: (event: string, handler: (...args: any[]) => void) => void;
  off: (event: string, handler: (...args: any[]) => void) => void;
  remove: () => void;
  resize: () => void;
  panTo: (lngLat: [number, number]) => void;
  flyTo: (options: Record<string, unknown>) => void;
  easeTo: (options: Record<string, unknown>) => void;
  project: (lngLat: [number, number]) => { x: number; y: number };
  setZoom: (zoom: number) => void;
  fitBounds: (bounds: any, options?: Record<string, unknown>) => void;
  getSource: (id: string) => any;
  addSource: (id: string, source: Record<string, unknown>) => void;
  getLayer: (id: string) => any;
  addLayer: (layer: Record<string, unknown>) => void;
  removeLayer: (id: string) => void;
  removeSource: (id: string) => void;
  setPaintProperty: (layerId: string, name: string, value: unknown) => void;
};

export type MapboxGL = {
  accessToken: string;
  Map: new (options: Record<string, unknown>) => MapboxMapInstance;
  Marker: new (options?: Record<string, unknown>) => MapboxMarker;
  LngLatBounds: new () => {
    extend: (lngLat: [number, number]) => void;
    isEmpty: () => boolean;
  };
};

declare global {
  interface Window {
    mapboxgl?: MapboxGL;
  }
}

let cachedPromise: Promise<MapboxGL> | null = null;

export function getMapboxToken(): string | null {
  const token =
    import.meta.env.VITE_MAPBOX_ACCESS_TOKEN ||
    import.meta.env.VITE_MAPBOX_TOKEN ||
    import.meta.env.VITE_MAPBOX_PUBLIC_TOKEN ||
    "";
  return token && token.trim() ? token.trim() : null;
}

function ensureCss() {
  if (document.querySelector(`link[href="${MAPBOX_GL_CSS_URL}"]`)) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = MAPBOX_GL_CSS_URL;
  document.head.appendChild(link);
}

function injectScript(): Promise<MapboxGL> {
  if (window.mapboxgl) return Promise.resolve(window.mapboxgl);

  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${MAPBOX_GL_JS_URL}"]`);
    if (existing) {
      existing.addEventListener("load", () => window.mapboxgl ? resolve(window.mapboxgl) : reject(new Error("Mapbox loaded without mapboxgl")));
      existing.addEventListener("error", () => reject(new Error("Mapbox script failed to load")));
      return;
    }

    const script = document.createElement("script");
    script.src = MAPBOX_GL_JS_URL;
    script.async = true;
    script.onload = () => window.mapboxgl ? resolve(window.mapboxgl) : reject(new Error("Mapbox loaded without mapboxgl"));
    script.onerror = () => reject(new Error("Mapbox script failed to load"));
    document.head.appendChild(script);
  });
}

export function loadMapbox(): Promise<MapboxGL> {
  const token = getMapboxToken();
  if (!token) return Promise.reject(new Error("Mapbox token is not configured (set VITE_MAPBOX_ACCESS_TOKEN or VITE_MAPBOX_TOKEN)"));
  if (!cachedPromise) {
    ensureCss();
    cachedPromise = injectScript().then((mapboxgl) => {
      mapboxgl.accessToken = token;
      return mapboxgl;
    });
  }
  return cachedPromise;
}

export function resetMapboxLoader() {
  cachedPromise = null;
}
