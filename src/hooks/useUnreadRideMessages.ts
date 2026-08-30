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

    let cancelled = false;

    // Seed from persisted receipts so closing/reopening a screen keeps the badge.
    void (async () => {
      const { count } = await supabase
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('ride_id', rideId)
        .neq('sender_id', currentUserId)
        .is('read_at', null);
      if (cancelled || chatOpenRef.current) return;
      setUnreadCount(count ?? 0);
    })();

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
