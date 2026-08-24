import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { playMessageSound } from '@/lib/notificationSounds';

/**
 * Tracks unread messages for a ride's chat independently of whether the
 * chat panel is mounted — the chat card itself only exists while open, so
 * without this there was no way to notice a message arrived (no badge, no
 * sound) unless you happened to already have the chat open.
 */
export function useUnreadRideMessages(
  rideId: string | null | undefined,
  currentUserId: string | null | undefined,
  chatOpen: boolean
): number {
  const [unreadCount, setUnreadCount] = useState(0);
  const chatOpenRef = useRef(chatOpen);

  useEffect(() => {
    chatOpenRef.current = chatOpen;
    if (chatOpen) setUnreadCount(0);
  }, [chatOpen]);

  useEffect(() => {
    setUnreadCount(0);
    if (!rideId || !currentUserId) return;

    const channel = supabase
      .channel(`ride-messages-badge-${rideId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `ride_id=eq.${rideId}` },
        (payload) => {
          const msg = payload.new as { sender_id: string };
          if (msg.sender_id === currentUserId) return;
          if (chatOpenRef.current) return;
          setUnreadCount((c) => c + 1);
          playMessageSound();
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [rideId, currentUserId]);

  return unreadCount;
}
