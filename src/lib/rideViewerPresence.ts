import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/hooks/useAuth';

function channelName(rideId: string) {
  return `ride-viewers-${rideId}`;
}

/** Driver side: marks this driver as currently viewing `rideId` for as long
 * as the calling component stays mounted (e.g. its card is visible in the
 * open-rides list). Backed by Supabase Realtime Presence — no extra table,
 * and it clears itself automatically on unmount/disconnect. */
export function useTrackRideViewer(rideId: string | null | undefined) {
  const { user } = useAuth();

  useEffect(() => {
    if (!rideId || !user?.id) return;
    const channel = supabase.channel(channelName(rideId), {
      config: { presence: { key: user.id } },
    });
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') channel.track({ viewing_at: Date.now() });
    });
    return () => { supabase.removeChannel(channel); };
  }, [rideId, user?.id]);
}

/** Rider side: live count of drivers currently viewing this ride (i.e. it's
 * showing in their open-rides list right now). */
export function useRideViewerCount(rideId: string | null | undefined): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!rideId) {
      setCount(0);
      return;
    }
    const channel = supabase.channel(channelName(rideId));
    channel
      .on('presence', { event: 'sync' }, () => {
        setCount(Object.keys(channel.presenceState()).length);
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); setCount(0); };
  }, [rideId]);

  return count;
}
