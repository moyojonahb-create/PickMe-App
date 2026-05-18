/**
 * Smoke tests for critical flows.
 *
 * These tests verify that the core building blocks the user touches every
 * session keep working after each change. They run in jsdom without
 * Supabase / Maps / push — they only validate exported helpers and the
 * runtime breadcrumb logger that powers our error reporting.
 *
 * Heavier end-to-end UI tests live alongside the components they cover.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { roundFare, calculateFare } from '@/lib/pricing';
import { isGoogleMapsDisabled } from '@/lib/mapsKillSwitch';
import { installRuntimeBreadcrumbs, getBreadcrumbs, noteBreadcrumb } from '@/lib/runtimeBreadcrumbs';

describe('smoke: pricing — ride request input math', () => {
  it('rounds fares to the nearest $0.50 and never below the minimum', () => {
    expect(roundFare(1.23)).toBeGreaterThanOrEqual(0.5);
    // Standard rate: base $1.50 + $1.00/km, $0.50 min, rounded to $0.50.
    const fare = calculateFare(5);
    expect(fare).toBeGreaterThanOrEqual(0.5);
    expect((fare * 2) % 1).toBe(0); // multiple of 0.5
  });
});

describe('smoke: map toggle', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('defaults to Mapbox (Google disabled) when no override is set', () => {
    expect(isGoogleMapsDisabled()).toBe(true);
  });

  it('honours the localStorage opt-in for Google Maps', () => {
    localStorage.setItem('enableGoogleMaps', '1');
    expect(isGoogleMapsDisabled()).toBe(false);
  });
});

describe('smoke: runtime breadcrumb logger', () => {
  it('captures clicks and exposes them to error reporting', () => {
    installRuntimeBreadcrumbs(); // idempotent
    const btn = document.createElement('button');
    btn.textContent = 'Request ride';
    document.body.appendChild(btn);
    btn.click();

    const trail = getBreadcrumbs();
    const lastClick = [...trail].reverse().find((b) => b.kind === 'click');
    expect(lastClick?.label).toBe('Request ride');
  });

  it('records manual notes from try/catch handlers', () => {
    noteBreadcrumb('wallet_pin_invalid', 'attempt=3');
    const trail = getBreadcrumbs();
    expect(trail.some((b) => b.kind === 'note' && b.label === 'wallet_pin_invalid')).toBe(true);
  });

  it('exposes window.__pickmeBreadcrumbs() for live debugging', () => {
    installRuntimeBreadcrumbs();
    const fn = (window as unknown as { __pickmeBreadcrumbs?: () => unknown[] }).__pickmeBreadcrumbs;
    expect(typeof fn).toBe('function');
    expect(Array.isArray(fn!())).toBe(true);
  });
});
