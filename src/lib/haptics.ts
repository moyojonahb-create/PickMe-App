/**
 * Native-first haptic feedback using Capacitor Haptics plugin.
 * Falls back to Vibration API on web.
 */
import { Capacitor } from '@capacitor/core';

type HapticStyle = 'light' | 'medium' | 'heavy' | 'success' | 'error' | 'selection';

const webPatterns: Record<HapticStyle, number | number[]> = {
  light: 10,
  medium: 25,
  heavy: 50,
  success: [10, 30, 10],
  error: [50, 30, 50],
  selection: 5,
};

type HapticsPluginType = {
  impact: (opts: { style: string }) => Promise<void>;
  vibrate: (opts: { duration: number }) => Promise<void>;
  notification: (opts: { type: string }) => Promise<void>;
  selectionStart: () => Promise<void>;
  selectionChanged: () => Promise<void>;
  selectionEnd: () => Promise<void>;
};
let HapticsPlugin: HapticsPluginType | null = null;

// Lazy-load native plugin only on native platforms
async function getHaptics() {
  if (HapticsPlugin) return HapticsPlugin;
  if (Capacitor.isNativePlatform()) {
    const { Haptics } = await import('@capacitor/haptics');
    HapticsPlugin = Haptics;
    return HapticsPlugin;
  }
  return null;
}

export async function haptic(style: HapticStyle = 'light') {
  try {
    const native = await getHaptics();
    if (native) {
      switch (style) {
        case 'light':
          await native.impact({ style: 'LIGHT' });
          break;
        case 'medium':
          await native.impact({ style: 'MEDIUM' });
          break;
        case 'heavy':
          await native.impact({ style: 'HEAVY' });
          break;
        case 'success':
          await native.notification({ type: 'SUCCESS' });
          break;
        case 'error':
          await native.notification({ type: 'ERROR' });
          break;
        case 'selection':
          await native.selectionStart();
          await native.selectionChanged();
          await native.selectionEnd();
          break;
      }
    } else if ('vibrate' in navigator) {
      navigator.vibrate(webPatterns[style]);
    }
  } catch {
    // silently ignore
  }
}

/** Fire-and-forget version for event handlers */
export function hapticSync(style: HapticStyle = 'light') {
  haptic(style);
}
