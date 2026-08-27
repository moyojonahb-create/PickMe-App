import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import { AlertTriangle } from 'lucide-react';

/**
 * Admin-only component that listens for new emergency alerts in real-time
 * and shows urgent toast notifications + browser notifications.
 */
export default function AdminEmergencyAlerts() {
  const { user } = useAuth();
  const [isAdmin, setIsAdmin] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    if (!user) return;
    supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .eq('role', 'admin')
      .maybeSingle()
      .then(({ data }) => {
        if (mountedRef.current) setIsAdmin(!!data);
      });

    return () => { mountedRef.current = false; };
  }, [user]);

  useEffect(() => {
    if (!isAdmin || !user) return;

    const channel = supabase
      .channel('admin-emergency-alerts')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'emergency_alerts' },
        (payload) => {
          const alert = payload.new as Record<string, unknown>;
          const lat = alert.latitude as number;
          const lng = alert.longitude as number;
          const mapsLink = lat && lng ? `https://www.mapbox.com/directions?destination=${lng},${lat}` : null;

          // Urgent toast that stays visible
          toast.error('🆘 EMERGENCY ALERT', {
            description: `A user triggered SOS!${mapsLink ? ' Click to view location.' : ''}`,
            duration: 30000,
            action: mapsLink ? {
              label: 'View Location',
              onClick: () => window.open(mapsLink, '_blank'),
            } : undefined,
          });

          // Browser notification
          if (Notification.permission === 'granted') {
            new Notification('🆘 EMERGENCY ALERT', {
              body: `User triggered SOS alert! Ride: ${(alert.ride_id as string)?.substring(0, 8) || 'N/A'}`,
              icon: '/icons/cruixe-icon-1024.png',
              requireInteraction: true,
              tag: 'emergency-' + alert.id,
            });
          }

          // Vibrate if supported
          if (navigator.vibrate) {
            navigator.vibrate([500, 200, 500, 200, 500]);
          }
        }
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'disputes' },
        (payload) => {
          const dispute = payload.new as Record<string, unknown>;
          toast.warning('📋 New Dispute Filed', {
            description: `Category: ${dispute.category} — check admin panel.`,
            duration: 10000,
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [isAdmin, user]);

  return null;
}
