/**
 * Design tokens for the redesigned /ride booking flow (selection + finding
 * drivers). Kept as inline-style objects because the spec pins exact glass,
 * gradient and shadow values that Tailwind utilities can't express cleanly.
 */
import type { CSSProperties } from 'react';

export const RIDE_RED = '#B81104';
export const RIDE_RED_GRADIENT = 'linear-gradient(135deg, #E01B00, #B81104)';
export const RIDE_YELLOW = '#FFDD00';
export const RIDE_TEXT = '#111111';
export const RIDE_TEXT_2 = '#666666';
export const RIDE_TEXT_3 = '#3C3C43';

export const RIDE_FONT =
  "-apple-system, 'SF Pro Text', 'SF Pro Display', system-ui, sans-serif";

/** Frosted white glass panel used for the sheet body. */
export const glassPanel: CSSProperties = {
  background: 'rgba(255,255,255,.72)',
  backdropFilter: 'blur(22px) saturate(180%)',
  WebkitBackdropFilter: 'blur(22px) saturate(180%)',
  boxShadow:
    'inset 0 0 0 .5px rgba(255,255,255,.55), 0 -8px 30px rgba(17,17,17,.05)',
};

/** Smaller white glass surfaces: pills, circular buttons, icon badges. */
export const glassSurface: CSSProperties = {
  background: 'rgba(255,255,255,.78)',
  backdropFilter: 'blur(18px) saturate(180%)',
  WebkitBackdropFilter: 'blur(18px) saturate(180%)',
  boxShadow:
    'inset 0 0 0 .5px rgba(255,255,255,.6), 0 6px 14px rgba(0,0,0,.05)',
};

/** Blue-tinted glass card (Economy, Parcel, chosen-ride summary). */
export const tintBlue: CSSProperties = {
  background:
    'linear-gradient(135deg, rgba(238,243,252,.85), rgba(26,115,232,.07))',
  boxShadow:
    'inset 0 0 0 .5px rgba(255,255,255,.6), 0 6px 14px rgba(0,0,0,.05)',
  backdropFilter: 'blur(18px) saturate(180%)',
  WebkitBackdropFilter: 'blur(18px) saturate(180%)',
};

/** Yellow-tinted glass card (Share Ride). */
export const tintYellow: CSSProperties = {
  background:
    'linear-gradient(135deg, rgba(255,250,205,.85), rgba(255,221,0,.1))',
  boxShadow:
    'inset 0 0 0 .5px rgba(255,255,255,.6), 0 6px 14px rgba(0,0,0,.05)',
  backdropFilter: 'blur(18px) saturate(180%)',
  WebkitBackdropFilter: 'blur(18px) saturate(180%)',
};

/** Solid red CTA fill with the intentional red glow + top sheen. */
export const redCta: CSSProperties = {
  background: RIDE_RED_GRADIENT,
  boxShadow:
    '0 12px 26px rgba(184,17,4,.36), inset 0 1px 0 rgba(255,255,255,.28)',
  color: '#fff',
};
