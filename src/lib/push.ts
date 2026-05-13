/**
 * Web Push notification utilities
 * Uses VAPID-based Web Push API with service worker for
 * native-feeling push notifications on both mobile & desktop.
 */

import { supabase } from '@/lib/supabaseClient';

/** Request browser notification permission */
export async function requestNotificationPermission(): Promise<boolean> {
  try {
    if (typeof globalThis.Notification === "undefined") {
      console.warn("[Push] Notifications not supported");
      return false;
    }

    if (Notification.permission === "granted") return true;
    if (Notification.permission === "denied") {
      console.warn("[Push] Notifications permission denied");
      return false;
    }

    const permission = await Notification.requestPermission();
    return permission === "granted";
  } catch {
    console.warn("[Push] Notification API error");
    return false;
  }
}

/** Check if push is supported */
export function isPushSupported(): boolean {
  return (
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

/** 
 * Subscribe to Web Push and save subscription to DB.
 * Uses VAPID public key from edge function.
 */
export async function enablePush(): Promise<boolean> {
  const granted = await requestNotificationPermission();
  if (!granted) throw new Error("Notifications permission not granted.");

  if (!isPushSupported()) {
    if (import.meta.env.DEV) console.log("[Push] Push not supported, using browser notifications only");
    return true;
  }

  try {
    // Get VAPID public key from edge function
    const { data: vapidData, error: vapidError } = await supabase.functions.invoke(
      "push-config",
      { method: "GET" }
    );

    if (vapidError || !vapidData?.vapidPublicKey) {
      console.warn("[Push] No VAPID key available, browser notifications only");
      return true;
    }

    const registration = await navigator.serviceWorker.ready;
    
    // Check existing subscription
    let subscription = await registration.pushManager.getSubscription();
    
    if (!subscription) {
      // Convert VAPID key from base64 to Uint8Array
      const vapidKey = urlBase64ToUint8Array(vapidData.vapidPublicKey);
      
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: vapidKey.buffer as ArrayBuffer,
      });
    }

    // Save subscription to server
    const { data: { user } } = await supabase.auth.getUser();
    if (user && subscription) {
      const subJson = subscription.toJSON();
      await supabase.functions.invoke("push-subscribe", {
        body: {
          userId: user.id,
          subscription: subJson,
        },
      });
    }

    if (import.meta.env.DEV) console.log("[Push] Web Push enabled successfully");
    return true;
  } catch (err) {
    console.warn("[Push] Web Push setup failed, using browser notifications:", err);
    return true; // Fall back to browser notifications
  }
}

/** Disable push notifications */
export async function disablePush(): Promise<void> {
  try {
    if (isPushSupported()) {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        await subscription.unsubscribe();
      }
    }
    if (import.meta.env.DEV) console.log("[Push] Push notifications disabled");
  } catch {
    console.warn("[Push] Error disabling push");
  }
}

/** Convert base64 VAPID key to Uint8Array for push subscription */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

/**
 * Send a local browser notification (fallback when push isn't available).
 * This is used by GlobalRideNotifier and other realtime listeners.
 */
export function showLocalNotification(
  title: string,
  body: string,
  url?: string
): void {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;

  try {
    const notification = new Notification(title, {
      body,
      icon: "/icons/icon-192x192.png",
      badge: "/icons/icon-96x96.png",
      tag: `pickme-${Date.now()}`,
    } as NotificationOptions);

    if (url) {
      notification.onclick = () => {
        window.focus();
        window.location.href = url;
      };
    }

    // Auto-close after 10s
    setTimeout(() => notification.close(), 10000);
  } catch {
    // Fallback silently
  }
}
