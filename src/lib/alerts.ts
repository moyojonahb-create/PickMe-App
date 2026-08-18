/**
 * Alert utilities for ride notifications
 */

export function playAlert(): void {
  try {
    const audioCtx = new (window.AudioContext || (window as unknown as Record<string, typeof AudioContext>).webkitAudioContext)();
    const oscillator = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    
    oscillator.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    
    oscillator.frequency.value = 880;
    oscillator.type = "square";
    gainNode.gain.value = 0.3;
    
    oscillator.start();
    
    setTimeout(() => { oscillator.frequency.value = 1100; }, 150);
    setTimeout(() => { oscillator.frequency.value = 880; }, 300);
    setTimeout(() => { oscillator.frequency.value = 1100; }, 450);
    setTimeout(() => { 
      oscillator.stop(); 
      audioCtx.close();
    }, 600);
  } catch (e) {
    console.warn("[Alerts] Failed to play alert sound:", e);
  }
}

export function vibrateAlert(): void {
  if ("vibrate" in navigator) {
    navigator.vibrate([200, 100, 200, 100, 400]);
  }
}

export function showBrowserNotification(title: string, body: string, url?: string): void {
  try {
    if (typeof globalThis.Notification === "undefined") return;
    if (Notification.permission !== "granted") return;
    const notification = new Notification(title, {
      body,
      icon: "/icons/pickme-app-icon.png",
      badge: "/icons/pickme-app-icon.png",
      tag: "pickme-alert",
      requireInteraction: true,
    });
    
    notification.onclick = () => {
      window.focus();
      if (url) window.location.href = url;
      notification.close();
    };
  } catch (e) {
    console.warn("[Alerts] Browser notification failed:", e);
  }
}

export function triggerFullAlert(title: string, body: string, url?: string): void {
  playAlert();
  vibrateAlert();
  showBrowserNotification(title, body, url);
}
