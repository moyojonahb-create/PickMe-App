import { useState, useCallback, useRef, useEffect } from 'react';

interface VoiceNavigationOptions {
  enabled?: boolean;
  volume?: number;
  rate?: number;
  language?: string;
}

interface NavigationInstruction {
  type: 'straight' | 'left' | 'right' | 'arrived' | 'custom';
  text: string;
  distance?: number; // in meters
}

export function useVoiceNavigation(options: VoiceNavigationOptions = {}) {
  const {
    enabled = true,
    volume = 1,
    rate = 0.9,
    language = 'en-US',
  } = options;

  const [isSupported, setIsSupported] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [lastInstruction, setLastInstruction] = useState<string | null>(null);
  const lastSpokenRef = useRef<string | null>(null);
  const cooldownRef = useRef<number>(0);

  useEffect(() => {
    setIsSupported('speechSynthesis' in window);
  }, []);

  const speak = useCallback((text: string, force = false) => {
    if (!isSupported || !enabled) {
      if (import.meta.env.DEV) console.log('[Voice Nav - Text Fallback]:', text);
      setLastInstruction(text);
      return;
    }

    // Prevent repeating same instruction within 5 seconds
    const now = Date.now();
    if (!force && lastSpokenRef.current === text && now - cooldownRef.current < 5000) {
      return;
    }

    // Cancel any ongoing speech
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.volume = volume;
    utterance.rate = rate;
    utterance.lang = language;

    utterance.onstart = () => setIsSpeaking(true);
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);

    window.speechSynthesis.speak(utterance);
    lastSpokenRef.current = text;
    cooldownRef.current = now;
    setLastInstruction(text);
  }, [isSupported, enabled, volume, rate, language]);

  const speakInstruction = useCallback((instruction: NavigationInstruction) => {
    let text = instruction.text;

    if (!text) {
      switch (instruction.type) {
        case 'straight':
          text = instruction.distance 
            ? `Continue straight for ${Math.round(instruction.distance)} meters`
            : 'Continue straight';
          break;
        case 'left':
          text = instruction.distance
            ? `In ${Math.round(instruction.distance)} meters, turn left`
            : 'Turn left';
          break;
        case 'right':
          text = instruction.distance
            ? `In ${Math.round(instruction.distance)} meters, turn right`
            : 'Turn right';
          break;
        case 'arrived':
          text = 'You have arrived at your destination';
          break;
      }
    }

    speak(text);
  }, [speak]);

  const speakArrival = useCallback(() => {
    speak('You have arrived. Your rider is waiting.', true);
  }, [speak]);

  const speakRiderArrival = useCallback(() => {
    speak('Your PickMe ride has arrived!', true);
  }, [speak]);

  const stop = useCallback(() => {
    if (isSupported) {
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
    }
  }, [isSupported]);

  return {
    isSupported,
    isSpeaking,
    lastInstruction,
    speak,
    speakInstruction,
    speakArrival,
    speakRiderArrival,
    stop,
  };
}

// Get turn instruction from OSRM maneuver
export function getInstructionFromManeuver(maneuverType: string): NavigationInstruction['type'] {
  const leftTurns = ['turn-left', 'sharp-left', 'slight-left', 'rotate-left'];
  const rightTurns = ['turn-right', 'sharp-right', 'slight-right', 'rotate-right'];
  
  if (leftTurns.includes(maneuverType)) return 'left';
  if (rightTurns.includes(maneuverType)) return 'right';
  if (maneuverType === 'arrive') return 'arrived';
  return 'straight';
}

// Calculate bearing between two points
export function calculateBearing(
  lat1: number, lng1: number,
  lat2: number, lng2: number
): number {
  const dLon = (lng2 - lng1) * Math.PI / 180;
  const lat1Rad = lat1 * Math.PI / 180;
  const lat2Rad = lat2 * Math.PI / 180;

  const y = Math.sin(dLon) * Math.cos(lat2Rad);
  const x = Math.cos(lat1Rad) * Math.sin(lat2Rad) -
    Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLon);

  const bearing = Math.atan2(y, x) * 180 / Math.PI;
  return (bearing + 360) % 360;
}

// Get turn direction from bearing change
export function getTurnDirection(
  currentBearing: number,
  nextBearing: number
): NavigationInstruction['type'] {
  let diff = nextBearing - currentBearing;
  if (diff > 180) diff -= 360;
  if (diff < -180) diff += 360;

  if (Math.abs(diff) < 20) return 'straight';
  if (diff > 0) return 'right';
  return 'left';
}
