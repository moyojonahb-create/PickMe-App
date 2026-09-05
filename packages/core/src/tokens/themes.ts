/**
 * CruiXe design tokens — extracted verbatim from src/index.css.
 *
 * These are NOT a flat palette. The web app ships four theme permutations and
 * the brand red is not constant across them: the women-only theme repoints it
 * to pink, and dark mode repoints `primary` to yellow while leaving the brand
 * red red. A single flat token object would silently drop the female theme,
 * which is a shipped feature (auto-enabled for female drivers in
 * DriverDashboard.tsx), so the shape here is themes × tokens.
 *
 * Values are HSL triplets in the same `H S% L%` form the CSS custom properties
 * use, so they can be re-emitted as CSS (`hsl(var(--x))`) on web or converted
 * once to hex/rgb for React Native. Keeping the source form means web and
 * mobile cannot drift apart through two separate hand-conversions.
 */

export type ThemeName = 'light' | 'dark' | 'female' | 'femaleDark';

/** `H S% L%` — the raw value of a CSS custom property, without the hsl() wrapper. */
export type Hsl = string;

export interface BrandTokens {
  red: Hsl;
  redDark: Hsl;
  redLight: Hsl;
  yellow: Hsl;
  yellowLight: Hsl;
  white: Hsl;
  dark: Hsl;
  gray100: Hsl;
  gray200: Hsl;
  gray300: Hsl;
  gray400: Hsl;
  gray500: Hsl;
  gray600: Hsl;
  gray700: Hsl;
  gray800: Hsl;
  gray900: Hsl;
}

export interface SemanticTokens {
  background: Hsl;
  foreground: Hsl;
  card: Hsl;
  cardForeground: Hsl;
  primary: Hsl;
  primaryForeground: Hsl;
  primaryLight: Hsl;
  secondary: Hsl;
  secondaryForeground: Hsl;
  muted: Hsl;
  mutedForeground: Hsl;
  accent: Hsl;
  accentForeground: Hsl;
  destructive: Hsl;
  destructiveForeground: Hsl;
  border: Hsl;
  input: Hsl;
  ring: Hsl;
}

export interface Theme {
  name: ThemeName;
  brand: BrandTokens;
  semantic: SemanticTokens;
  /**
   * Exact brand hex, authoritative over `brand`'s HSL for these colours.
   *
   * The CSS custom properties are *rounded* HSL approximations of the real hex:
   * #B81104 is hsl(4.33 95.7% 36.9%), written in CSS as `4 96% 37%`. Converting
   * that rounded triplet back yields #B91004 — one off in two channels. Verified,
   * not assumed. Since the migration brief makes exact brand values
   * non-negotiable, React Native must read hex from here and never from
   * hslToHex(theme.brand.red).
   *
   * Only the documented colours are canonical; the pink themes have no published
   * hex, so those are derived and marked as such.
   */
  brandHex: {
    red: string;
    redDark: string;
    redHover: string;
    yellow: string;
    /** true when the values above came from a documented hex, false when derived from HSL. */
    canonical: boolean;
  };
  /** CSS gradient string on web; parse to stops for RN's LinearGradient. */
  gradientPrimary: string;
}

/** Shared across every theme — only the brand red family and glass layers move. */
const NEUTRAL_GRAYS = {
  white: '0 0% 100%',
  dark: '0 0% 12%',
  gray100: '0 0% 98%',
  gray200: '0 0% 96%',
  gray300: '0 0% 90%',
  gray400: '0 0% 75%',
  gray500: '0 0% 55%',
  gray600: '0 0% 45%',
  gray700: '0 0% 30%',
  gray800: '0 0% 20%',
  gray900: '0 0% 12%',
} as const;

const YELLOW = { yellow: '52 100% 50%', yellowLight: '52 100% 70%' } as const;

export const light: Theme = {
  name: 'light',
  brand: {
    red: '4 96% 37%',        // #B81104 — Milano Red, the canonical brand red
    redDark: '4 97% 25%',    // #7F0B02
    redLight: '4 96% 45%',
    ...YELLOW,               // #FFDD00
    ...NEUTRAL_GRAYS,
  },
  semantic: {
    background: '0 0% 100%',
    foreground: '0 0% 12%',
    card: '0 0% 100%',
    cardForeground: '0 0% 12%',
    primary: '4 96% 37%',
    primaryForeground: '0 0% 100%',
    primaryLight: '4 96% 45%',
    secondary: '0 0% 96%',
    secondaryForeground: '0 0% 12%',
    muted: '0 0% 96%',
    mutedForeground: '0 0% 20%',
    accent: '52 100% 50%',
    accentForeground: '0 0% 12%',
    destructive: '0 84% 60%',
    destructiveForeground: '0 0% 100%',
    border: '0 0% 90%',
    input: '0 0% 90%',
    ring: '4 96% 37%',
  },
  // Documented in src/index.css: "Primary — Milano Red #B81104",
  // "Hover #960E03 / Dark #7F0B02", "Accent — Yellow #FFDD00".
  brandHex: {
    red: '#B81104',
    redDark: '#7F0B02',
    redHover: '#960E03',
    yellow: '#FFDD00',
    canonical: true,
  },
  gradientPrimary: 'linear-gradient(135deg, hsl(4 96% 37%), hsl(4 97% 25%))',
};

export const dark: Theme = {
  name: 'dark',
  brand: { ...light.brand },  // brand red stays red in dark mode
  semantic: {
    background: '220 20% 7%',
    foreground: '0 0% 98%',
    card: '220 18% 12%',
    cardForeground: '0 0% 98%',
    // Deliberate: dark mode promotes YELLOW to primary, not red. Red would not
    // carry enough contrast on the near-black ground.
    primary: '52 100% 50%',
    primaryForeground: '0 0% 12%',
    primaryLight: '52 100% 60%',
    secondary: '220 16% 16%',
    secondaryForeground: '0 0% 98%',
    muted: '220 16% 16%',
    mutedForeground: '217 20% 65%',
    accent: '52 100% 50%',
    accentForeground: '0 0% 12%',
    destructive: '0 62% 30%',
    destructiveForeground: '0 0% 98%',
    border: '220 16% 18%',
    input: '220 16% 18%',
    ring: '52 100% 50%',
  },
  // Dark mode keeps the same brand red; only the semantic roles change.
  brandHex: { ...light.brandHex },
  gradientPrimary: 'linear-gradient(135deg, hsl(4 97% 25%), hsl(4 96% 45%))',
};

export const female: Theme = {
  name: 'female',
  brand: {
    ...light.brand,
    red: '330 75% 45%',       // brand red becomes pink in the women-only theme
    redDark: '330 80% 35%',
    redLight: '330 80% 60%',
  },
  semantic: {
    ...light.semantic,
    primary: '330 75% 45%',
    primaryForeground: '0 0% 100%',
    primaryLight: '330 80% 60%',
    ring: '330 75% 45%',
  },
  // No published hex for the pink theme — these are derived from the CSS HSL,
  // so they carry the same rounding drift the canonical values avoid. Flagged
  // rather than silently presented as exact.
  brandHex: {
    red: hslToHex('330 75% 45%'),
    redDark: hslToHex('330 80% 35%'),
    redHover: hslToHex('330 75% 40%'),
    yellow: '#FFDD00',
    canonical: false,
  },
  gradientPrimary: 'linear-gradient(135deg, hsl(330 75% 45%), hsl(330 80% 60%))',
};

export const femaleDark: Theme = {
  name: 'femaleDark',
  brand: {
    ...light.brand,
    red: '330 80% 60%',
    redDark: '330 70% 20%',
    redLight: '330 80% 65%',
  },
  semantic: {
    ...dark.semantic,
    primary: '330 80% 60%',
    primaryLight: '330 80% 65%',
    ring: '330 80% 60%',
  },
  brandHex: {
    red: hslToHex('330 80% 60%'),
    redDark: hslToHex('330 70% 20%'),
    redHover: hslToHex('330 80% 55%'),
    yellow: '#FFDD00',
    canonical: false,
  },
  gradientPrimary: 'linear-gradient(135deg, hsl(330 70% 20%), hsl(330 80% 60%))',
};

export const themes: Record<ThemeName, Theme> = { light, dark, female, femaleDark };

export function resolveTheme(opts: { dark?: boolean; female?: boolean }): Theme {
  if (opts.female && opts.dark) return femaleDark;
  if (opts.female) return female;
  if (opts.dark) return dark;
  return light;
}

export const typography = {
  /** Body. Must be loaded as a font asset in RN — there is no CSS webfont there. */
  body: 'Sora',
  /** Display/headings. */
  display: 'Space Grotesk',
} as const;

export const radius = {
  /** --radius: 0.875rem at a 16px root. */
  base: 14,
  sm: 10,
  md: 12,
  lg: 14,
  '2xl': 16,
  '3xl': 24,
  '4xl': 32,
} as const;

/**
 * `H S% L%` → `#rrggbb`. React Native accepts `hsl()` strings in modern
 * versions, but hex is universally safe and avoids per-platform parsing
 * differences, so convert once here rather than at every call site.
 */
export function hslToHex(hsl: Hsl): string {
  const [hRaw, sRaw, lRaw] = hsl.trim().split(/\s+/);
  const h = Number.parseFloat(hRaw);
  const s = Number.parseFloat(sRaw) / 100;
  const l = Number.parseFloat(lRaw) / 100;

  if (!Number.isFinite(h) || !Number.isFinite(s) || !Number.isFinite(l)) {
    throw new Error(`Invalid HSL token: "${hsl}"`);
  }

  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;

  const [r, g, b] =
    h < 60 ? [c, x, 0] :
    h < 120 ? [x, c, 0] :
    h < 180 ? [0, c, x] :
    h < 240 ? [0, x, c] :
    h < 300 ? [x, 0, c] :
    [c, 0, x];

  const toHex = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}
