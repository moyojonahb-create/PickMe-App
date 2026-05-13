// Hook to fetch and use town-specific pricing from the database
import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabaseClient';

export interface TownPricingConfig {
  id: string;
  town_id: string;
  town_name: string;
  currency_code: string;
  currency_symbol: string;
  base_fare: number;
  per_km_rate: number;
  minimum_fare: number;
  offer_floor: number;
  offer_ceiling: number;
  short_trip_fare: number;
  short_trip_km: number;
  night_multiplier: number;
  demand_multiplier: number;
  is_negotiation_enabled: boolean;
}

// Default fallback (USD)
const DEFAULT_PRICING: TownPricingConfig = {
  id: '',
  town_id: 'unknown',
  town_name: 'Zimbabwe',
  currency_code: 'USD',
  currency_symbol: '$',
  base_fare: 2,
  per_km_rate: 0.80,
  minimum_fare: 1,
  offer_floor: 1,
  offer_ceiling: 50,
  short_trip_fare: 1,
  short_trip_km: 2,
  night_multiplier: 1.2,
  demand_multiplier: 1.0,
  is_negotiation_enabled: true,
};

const pricingCache: Record<string, TownPricingConfig> = {};

export function useTownPricing(townId: string | null) {
  const [pricing, setPricing] = useState<TownPricingConfig>(
    townId && pricingCache[townId] ? pricingCache[townId] : DEFAULT_PRICING
  );
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!townId) {
      setPricing(DEFAULT_PRICING);
      return;
    }

    if (pricingCache[townId]) {
      setPricing(pricingCache[townId]);
      return;
    }

    setLoading(true);
    supabase
      .from('town_pricing')
      .select('*')
      .eq('town_id', townId)
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          const config = data as unknown as TownPricingConfig;
          pricingCache[townId] = config;
          setPricing(config);
        } else {
          setPricing(DEFAULT_PRICING);
        }
        setLoading(false);
      });
  }, [townId]);

  return { pricing, loading };
}

/** Calculate recommended fare based on town pricing + distance/time */
export function calculateRecommendedFare(
  pricing: TownPricingConfig,
  distanceKm: number,
  _durationMinutes: number,
): {
  recommended: number;
  floor: number;
  ceiling: number;
  currencySymbol: string;
  currencyCode: string;
} {
  const isNight = isNightTime();
  const nightMult = isNight ? pricing.night_multiplier : 1.0;
  const demandMult = pricing.demand_multiplier;

  let fare = pricing.base_fare + (distanceKm * pricing.per_km_rate) + (_durationMinutes * 0.03);
  fare = fare * nightMult * demandMult;
  fare = Math.max(fare, pricing.minimum_fare);

  // Round to nearest $0.50
  fare = Math.round(fare * 2) / 2;
  fare = Math.max(fare, 0.50);

  // Calculate floor/ceiling for this trip
  const tripFloor = Math.max(pricing.offer_floor, pricing.minimum_fare);
  const tripCeiling = Math.min(
    pricing.offer_ceiling,
    fare * 2 // Max 2x the recommended fare
  );

  return {
    recommended: fare,
    floor: tripFloor,
    ceiling: tripCeiling,
    currencySymbol: pricing.currency_symbol,
    currencyCode: pricing.currency_code,
  };
}

function isNightTime(): boolean {
  const h = new Date().getHours();
  return h >= 20 || h < 5;
}

/** Get step size for fare adjustment */
export function getFareStep(_currencyCode?: string): number {
  return 0.50;
}

/** Format a fare with currency symbol */
export function formatFare(amount: number, symbol: string = '$', _code?: string): string {
  return `${symbol}${amount.toFixed(2)}`;
}

/** Preload all town pricing */
export async function preloadAllTownPricing(): Promise<Record<string, TownPricingConfig>> {
  if (Object.keys(pricingCache).length > 0) return pricingCache;
  const { data } = await supabase
    .from('town_pricing')
    .select('town_id, base_fare, per_km, per_minute, minimum_fare, surge_multiplier, currency_code, currency_symbol')
    .limit(500);
  if (data) {
    for (const row of data) {
      const config = row as unknown as TownPricingConfig;
      pricingCache[config.town_id] = config;
    }
  }
  return pricingCache;
}
