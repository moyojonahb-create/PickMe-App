/**
 * Hook for server-side wallet PIN operations.
 * All PIN hashing and verification happens on the server — 
 * the PIN never leaves the client in plaintext except during the API call.
 */

import { useCallback, useState, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { walletPin } from '@/lib/walletApi';
import { GoBackendError } from '@/lib/goBackendClient';

export function useWalletPin() {
  const { user, session } = useAuth();
  const [hasPin, setHasPin] = useState(false);
  const [loading, setLoading] = useState(true);

  const callPinApi = useCallback(async (action: string, pin?: string) => {
    if (!session?.access_token) throw new Error('Not authenticated');

    return walletPin(action, pin);
  }, [session]);

  const checkPin = useCallback(async () => {
    if (!user || !session) {
      setLoading(false);
      return;
    }
    try {
      const data = await callPinApi('check');
      setHasPin(Boolean(data.hasPin ?? data.has_pin));
    } catch {
      // Fallback: assume no PIN
      setHasPin(false);
    } finally {
      setLoading(false);
    }
  }, [user, session, callPinApi]);

  useEffect(() => {
    checkPin();
  }, [checkPin]);

  const setPin = useCallback(async (pin: string): Promise<boolean> => {
    try {
      const data = await callPinApi('set', pin);
      if (data.ok) {
        setHasPin(true);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }, [callPinApi]);

  const verifyPin = useCallback(async (pin: string): Promise<boolean> => {
    try {
      const data = await callPinApi('verify', pin);
      return data.ok === true;
    } catch (err) {
      // Re-throw rate limit errors so UI can show lockout message
      if (
        (err instanceof GoBackendError && err.code === 'RATE_LIMITED') ||
        (err instanceof Error && err.message.includes('Too many attempts'))
      ) {
        throw err;
      }
      return false;
    }
  }, [callPinApi]);

  return { hasPin, loading, setPin, verifyPin, refresh: checkPin };
}
