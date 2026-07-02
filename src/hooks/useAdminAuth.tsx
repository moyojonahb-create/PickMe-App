import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { adminVerify } from '@/lib/businessApi';

interface AdminAuthState {
  isAdmin: boolean;
  isLoading: boolean;
  error: string | null;
}

// Module-level cache so repeat mounts don't re-fetch
let cachedAdmin: { userId: string; isAdmin: boolean; ts: number } | null = null;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export const useAdminAuth = () => {
  const { user, session, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;

  const [state, setState] = useState<AdminAuthState>(() => {
    // Instant return if cache is fresh
    if (cachedAdmin && user && cachedAdmin.userId === user.id && Date.now() - cachedAdmin.ts < CACHE_TTL) {
      return { isAdmin: cachedAdmin.isAdmin, isLoading: false, error: cachedAdmin.isAdmin ? null : 'Access denied' };
    }
    return { isAdmin: false, isLoading: true, error: null };
  });

  useEffect(() => {
    let cancelled = false;

    const checkAdminRole = async () => {
      if (authLoading) return;

      if (!user || !session) {
        setState({ isAdmin: false, isLoading: false, error: 'Not authenticated' });
        navigateRef.current('/');
        return;
      }

      // Use cache if fresh
      if (cachedAdmin && cachedAdmin.userId === user.id && Date.now() - cachedAdmin.ts < CACHE_TTL) {
        if (!cancelled) {
          setState({ isAdmin: cachedAdmin.isAdmin, isLoading: false, error: cachedAdmin.isAdmin ? null : 'Access denied' });
          if (!cachedAdmin.isAdmin) navigateRef.current('/');
        }
        return;
      }

      try {
        if (cancelled) return;

        const data = await adminVerify();

        if (data?.error || data?.isAdmin !== true) {
          cachedAdmin = { userId: user.id, isAdmin: false, ts: Date.now() };
          setState({ isAdmin: false, isLoading: false, error: 'Access denied' });
          navigateRef.current('/');
          return;
        }

        cachedAdmin = { userId: user.id, isAdmin: true, ts: Date.now() };
        setState({ isAdmin: true, isLoading: false, error: null });
      } catch (err) {
        if (cancelled) return;
        console.error('Error verifying admin role:', err);
        setState({ isAdmin: false, isLoading: false, error: 'Failed to verify permissions' });
        navigateRef.current('/');
      }
    };

    checkAdminRole();
    return () => { cancelled = true; };
  }, [user, session, authLoading]);

  return state;
};

export default useAdminAuth;
