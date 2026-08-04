import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { calculateRecommendedFare, formatFare, getFareStep } from '@/hooks/useTownPricing';
import type { TownPricingConfig } from '@/hooks/useTownPricing';

const usdTown: TownPricingConfig = {
  id: '1',
  town_id: 'harare',
  town_name: 'Harare',
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

describe('calculateRecommendedFare', () => {
  // Pin the clock to daytime noon so calculateRecommendedFare's night-time
  // surcharge (see isNightTime() in useTownPricing.ts, applied 8pm-5am)
  // doesn't make these assertions depend on when the suite happens to run.
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-15T12:00:00'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('calculates USD fare: base + distance * rate + duration * 0.03', () => {
    const result = calculateRecommendedFare(usdTown, 5, 10);
    // 2 + 5*0.80 + 10*0.03 = 2 + 4 + 0.3 = 6.3 → rounded to $6.50
    expect(result.recommended).toBe(6.5);
    expect(result.currencySymbol).toBe('$');
    expect(result.currencyCode).toBe('USD');
  });

  it('enforces minimum fare', () => {
    const result = calculateRecommendedFare(usdTown, 0, 0);
    expect(result.recommended).toBeGreaterThanOrEqual(usdTown.minimum_fare);
  });

  it('floor and ceiling are bounded', () => {
    const result = calculateRecommendedFare(usdTown, 10, 20);
    expect(result.floor).toBeGreaterThanOrEqual(usdTown.offer_floor);
    expect(result.ceiling).toBeLessThanOrEqual(usdTown.offer_ceiling);
  });
});

describe('formatFare', () => {
  it('formats USD with 2 decimals', () => {
    expect(formatFare(5.5, '$', 'USD')).toBe('$5.50');
  });
  it('formats any currency with 2 decimals', () => {
    expect(formatFare(45, '$', 'USD')).toBe('$45.00');
  });
});

describe('getFareStep', () => {
  it('returns $0.50 for any currency', () => {
    expect(getFareStep('USD')).toBe(0.5);
    expect(getFareStep('ZAR')).toBe(0.5);
  });
});
