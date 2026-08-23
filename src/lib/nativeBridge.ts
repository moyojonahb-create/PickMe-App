/**
 * Centralized native platform helpers for Capacitor.
 * Configures StatusBar, Keyboard, and SplashScreen on native platforms.
 */
import { Capacitor } from '@capacitor/core';

/** Initialize native plugins — call once from main.tsx */
export async function initNativePlatform() {
  if (!Capacitor.isNativePlatform()) return;

  // StatusBar
  try {
    const { StatusBar, Style } = await import('@capacitor/status-bar');
    await StatusBar.setStyle({ style: Style.Dark });
    await StatusBar.setBackgroundColor({ color: '#1e3a5f' });
    if (Capacitor.getPlatform() === 'android') {
      await StatusBar.setOverlaysWebView({ overlay: false });
    }
  } catch (e) {
    console.warn('[Native] StatusBar init failed:', e);
  }

  // Keyboard
  try {
    const { Keyboard, KeyboardResize } = await import('@capacitor/keyboard');
    await Keyboard.setResizeMode({ mode: KeyboardResize.Body });
    await Keyboard.setScroll({ isDisabled: false });

    Keyboard.addListener('keyboardWillShow', (info) => {
      document.documentElement.style.setProperty('--keyboard-height', `${info.keyboardHeight}px`);
      document.body.classList.add('keyboard-open');
    });
    Keyboard.addListener('keyboardWillHide', () => {
      document.documentElement.style.setProperty('--keyboard-height', '0px');
      document.body.classList.remove('keyboard-open');
    });
  } catch (e) {
    console.warn('[Native] Keyboard init failed:', e);
  }

  // SplashScreen
  try {
    const { SplashScreen } = await import('@capacitor/splash-screen');
    // Hide after a short delay — our HTML splash handles branding
    setTimeout(() => {
      SplashScreen.hide({ fadeOutDuration: 300 });
    }, 500);
  } catch (e) {
    console.warn('[Native] SplashScreen init failed:', e);
  }
}

// Without @capacitor/geolocation, nothing in the app ever triggers Android's
// runtime ACCESS_FINE_LOCATION prompt — the manifest permission only grants
// install-time visibility, not the runtime grant Android 6+ requires. Every
// navigator.geolocation.getCurrentPosition() call was failing on a fresh
// install with no prompt, no error, and an empty catch handler, so the map
// just never centred. Call this once, at the moment the user has actually
// opted in (e.g. LocationPermissionPrompt's "Allow location"), so the real
// OS dialog appears with the app context already on screen — not blind at
// boot. A no-op on web, where the browser owns its own permission prompt.
let locationPermissionRequested: Promise<boolean> | null = null;
export async function requestNativeLocationPermission(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return true;
  if (locationPermissionRequested) return locationPermissionRequested;
  locationPermissionRequested = (async () => {
    try {
      const { Geolocation } = await import('@capacitor/geolocation');
      const status = await Geolocation.requestPermissions();
      return status.location === 'granted' || status.coarseLocation === 'granted';
    } catch (e) {
      console.warn('[Native] Geolocation permission request failed:', e);
      return false;
    }
  })();
  return locationPermissionRequested;
}

/** Lock/unlock screen orientation (if plugin available) */
export function isNative(): boolean {
  return Capacitor.isNativePlatform();
}

export function getPlatform(): 'ios' | 'android' | 'web' {
  return Capacitor.getPlatform() as 'ios' | 'android' | 'web';
}
