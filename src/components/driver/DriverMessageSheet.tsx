import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { User, Phone, X, ArrowUp, RotateCw, Check, CheckCheck } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

const RED_GRADIENT = 'linear-gradient(135deg,#E01B00,#B81104)';
const RED_SHADOW = '0 6px 14px rgba(184,17,4,.3)';
const RED_SOLID = '#B81104';
const RIDER_BG = '#F1F3F5';
const RIDER_TEXT = '#16181C';

const QUICK_REPLIES_BY_ROLE = {
  driver: ["I'm outside", '2 minutes away', 'Running late'],
  rider: ["I'm coming now", 'Please wait 2 minutes', "I'm outside"],
} as const;

type Msg = {
  id: string;
  ride_id: string;
  sender_id: string;
  text: string;
  created_at: string;
  delivered_at?: string | null;
  read_at?: string | null;
  pending?: boolean;
  failed?: boolean;
};

interface DriverMessageSheetProps {
  open: boolean;
  onClose: () => void;
  rideId: string;
  currentUserId: string;
  /** Which app this sheet is rendered in — drives quick replies only; bubble
   *  sides/colours are keyed off `driverUserId`, not the viewer. */
  viewerRole: 'driver' | 'rider';
  /** Auth user id of the driver on this ride. */
  driverUserId: string;
  passengerName: string;
  passengerPhone?: string | null;
  etaMinutes?: number | null;
}

function dayLabel(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const yest = new Date(Date.now() - 86400000);
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (same(d, today)) return 'Today';
  if (same(d, yest)) return 'Yesterday';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export default function DriverMessageSheet({
  open,
  onClose,
  rideId,
  currentUserId,
  viewerRole,
  driverUserId,
  passengerName,
  passengerPhone,
  etaMinutes,
}: DriverMessageSheetProps) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [otherTyping, setOtherTyping] = useState(false);
  const [otherOnline, setOtherOnline] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);
  const openRef = useRef(open);
  openRef.current = open;

  const firstName = (passengerName || 'Passenger').split(' ')[0];
  const quickReplies = QUICK_REPLIES_BY_ROLE[viewerRole] ?? QUICK_REPLIES_BY_ROLE.driver;

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      const el = listRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }, []);

  /** Stamp delivered_at / read_at on incoming messages. Non-fatal. */
  const stampReceipts = useCallback(
    async (rows: Msg[]) => {
      const incoming = rows.filter((m) => m.sender_id !== currentUserId && !m.pending);
      const now = new Date().toISOString();
      const needDelivered = incoming.filter((m) => !m.delivered_at).map((m) => m.id);
      const needRead = openRef.current ? incoming.filter((m) => !m.read_at).map((m) => m.id) : [];
      const ids = Array.from(new Set([...needDelivered, ...needRead]));
      if (ids.length === 0) return;

      const patch: Record<string, string> = { delivered_at: now };
      if (openRef.current) patch.read_at = now;

      try {
        const { error } = await supabase
          .from('messages')
          .update(patch as never)
          .in('id', ids);
        if (error) {
          console.warn('receipt stamp failed:', error.message);
          return;
        }
        setMessages((prev) =>
          prev.map((m) =>
            ids.includes(m.id)
              ? { ...m, delivered_at: m.delivered_at ?? now, read_at: openRef.current ? m.read_at ?? now : m.read_at }
              : m,
          ),
        );
      } catch (e) {
        console.warn('receipt stamp failed:', (e as Error).message);
      }
    },
    [currentUserId],
  );

  // Load history + subscribe to new rows. Channel is torn down on unmount/close.
  useEffect(() => {
    if (!open || !rideId) return;
    let cancelled = false;
    setLoading(true);

    (async () => {
      const { data } = await supabase
        .from('messages')
        .select('*')
        .eq('ride_id', rideId)
        .order('created_at', { ascending: true });
      if (cancelled) return;
      const rows = (data as unknown as Msg[]) || [];
      setMessages(rows);
      setLoading(false);
      scrollToBottom();
      void stampReceipts(rows);
    })();

    const channel = supabase
      .channel(`driver-msgs-${rideId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `ride_id=eq.${rideId}` },
        (payload) => {
          const row = payload.new as unknown as Msg;
          setMessages((prev) => {
            if (prev.some((m) => m.id === row.id)) return prev;
            // Replace a matching optimistic bubble from this device.
            const idx = prev.findIndex((m) => m.pending && m.sender_id === row.sender_id && m.text === row.text);
            if (idx >= 0) {
              const next = [...prev];
              next[idx] = row;
              return next;
            }
            return [...prev, row];
          });
          scrollToBottom();
          void stampReceipts([row]);
        },
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'messages', filter: `ride_id=eq.${rideId}` },
        (payload) => {
          const row = payload.new as unknown as Msg;
          setMessages((prev) => prev.map((m) => (m.id === row.id ? { ...m, ...row } : m)));
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [open, rideId, scrollToBottom, stampReceipts]);

  // Typing indicator — broadcast channel, no table.
  const typingChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const lastTypingSentRef = useRef(0);
  const typingClearRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!open || !rideId) return;
    const channel = supabase.channel(`typing-${rideId}`, { config: { broadcast: { self: false } } });
    channel
      .on('broadcast', { event: 'typing' }, (payload) => {
        const uid = (payload.payload as { userId?: string })?.userId;
        if (!uid || uid === currentUserId) return;
        setOtherTyping(true);
        if (typingClearRef.current) clearTimeout(typingClearRef.current);
        typingClearRef.current = setTimeout(() => setOtherTyping(false), 4000);
      })
      .subscribe();
    typingChannelRef.current = channel;

    return () => {
      if (typingClearRef.current) clearTimeout(typingClearRef.current);
      typingClearRef.current = null;
      typingChannelRef.current = null;
      setOtherTyping(false);
      supabase.removeChannel(channel);
    };
  }, [open, rideId, currentUserId]);

  const notifyTyping = useCallback(() => {
    const now = Date.now();
    if (now - lastTypingSentRef.current < 2000) return;
    lastTypingSentRef.current = now;
    void typingChannelRef.current?.send({ type: 'broadcast', event: 'typing', payload: { userId: currentUserId } });
  }, [currentUserId]);

  // Presence — is the other party in this ride right now?
  useEffect(() => {
    if (!open || !rideId) return;
    const channel = supabase.channel(`presence-ride-${rideId}`, {
      config: { presence: { key: `${viewerRole}-${currentUserId}` } },
    });
    const sync = () => {
      const state = channel.presenceState() as Record<string, Array<{ role?: string }>>;
      const present = Object.values(state).flat();
      setOtherOnline(present.some((p) => p.role && p.role !== viewerRole));
    };
    channel
      .on('presence', { event: 'sync' }, sync)
      .on('presence', { event: 'join' }, sync)
      .on('presence', { event: 'leave' }, sync)
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') void channel.track({ userId: currentUserId, role: viewerRole });
      });
    return () => {
      setOtherOnline(false);
      supabase.removeChannel(channel);
    };
  }, [open, rideId, currentUserId, viewerRole]);


  const send = useCallback(
    async (raw: string, retryId?: string) => {
      const text = raw.trim();
      if (!text || !rideId || !currentUserId) return;
      const tempId = retryId || `tmp-${Date.now()}-${Math.random().toString(16).slice(2)}`;

      setMessages((prev) => {
        if (retryId) {
          return prev.map((m) => (m.id === retryId ? { ...m, pending: true, failed: false } : m));
        }
        return [
          ...prev,
          { id: tempId, ride_id: rideId, sender_id: currentUserId, text, created_at: new Date().toISOString(), pending: true },
        ];
      });
      scrollToBottom();

      const { data, error } = await supabase
        .from('messages')
        .insert({ ride_id: rideId, sender_id: currentUserId, text })
        .select('*')
        .maybeSingle();

      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== tempId) return m;
          if (error || !data) return { ...m, pending: false, failed: true };
          return { ...(data as unknown as Msg), pending: false, failed: false };
        }),
      );
      scrollToBottom();
    },
    [rideId, currentUserId, scrollToBottom],
  );

  const handleSend = () => {
    const text = draft;
    setDraft('');
    void send(text);
  };

  const lastOutgoingId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].sender_id === currentUserId) return messages[i].id;
    }
    return null;
  }, [messages, currentUserId]);

  // Swipe-down dismiss
  const dragStart = useRef<number | null>(null);
  const [dragY, setDragY] = useState(0);

  if (!open) return null;

  // The typing bubble sits on the OTHER party's side: if the viewer is the
  // driver, the other party is the rider (left), and vice versa.
  const typingOnRight = viewerRole === 'rider';

  return (
    <AnimatePresence>
      <motion.div
        key="scrim"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 z-40"
        style={{ background: 'rgba(17,17,17,.32)' }}
      />
      <motion.div
        key="sheet"
        role="dialog"
        aria-label={`Messages with ${passengerName}`}
        initial={{ y: '100%' }}
        animate={{ y: dragY }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', stiffness: 420, damping: 38 }}
        className="absolute z-50 flex flex-col"
        style={{
          left: 0,
          right: 0,
          bottom: 0,
          top: 150,
          borderTopLeftRadius: 26,
          borderTopRightRadius: 26,
          background: 'rgba(255,255,255,.92)',
          backdropFilter: 'blur(28px) saturate(190%)',
          WebkitBackdropFilter: 'blur(28px) saturate(190%)',
          boxShadow: '0 -14px 44px rgba(17,17,17,.28)',
          overflow: 'hidden',
        }}
      >
        {/* Drag handle */}
        <div
          className="flex justify-center"
          style={{ paddingTop: 8, paddingBottom: 4, touchAction: 'none' }}
          onPointerDown={(e) => {
            dragStart.current = e.clientY;
            (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
          }}
          onPointerMove={(e) => {
            if (dragStart.current == null) return;
            setDragY(Math.max(0, e.clientY - dragStart.current));
          }}
          onPointerUp={() => {
            if (dragY > 90) onClose();
            dragStart.current = null;
            setDragY(0);
          }}
        >
          <span style={{ width: 44, height: 5, borderRadius: 999, background: 'rgba(17,17,17,.16)' }} />
        </div>

        {/* Header */}
        <div
          className="flex items-center"
          style={{ padding: '6px 16px 14px', gap: 10, borderBottom: '.5px solid rgba(17,17,17,.08)' }}
        >
          <span
            className="shrink-0 flex items-center justify-center rounded-full"
            style={{ width: 42, height: 42, background: 'linear-gradient(135deg,#C6CBD4,#868E9B)', boxShadow: '0 0 0 2px rgba(255,255,255,.95)' }}
          >
            <User style={{ width: 21, height: 21, color: '#fff' }} strokeWidth={2.2} />
          </span>
          <div className="min-w-0" style={{ flex: 1 }}>
            <p className="truncate" style={{ fontSize: 15.5, fontWeight: 700, color: '#111111', letterSpacing: '-.015em' }}>
              {passengerName}
            </p>
            <span className="flex items-center" style={{ gap: 5, marginTop: 2 }}>
              <span style={{ width: 6, height: 6, borderRadius: 999, background: otherOnline ? '#22A447' : '#B4B9C0' }} />
              <span style={{ fontSize: 11.5, fontWeight: 500, color: '#666666' }}>
                {otherOnline ? 'Online' : 'Offline'}
                {etaMinutes != null ? ` · ${etaMinutes} min away` : ''}
              </span>
            </span>
          </div>
          {passengerPhone && (
            <a
              href={`tel:${passengerPhone}`}
              aria-label={`Call ${firstName}`}
              className="shrink-0 flex items-center justify-center rounded-full active:scale-90 transition-transform"
              style={{ width: 38, height: 38, background: RED_GRADIENT, boxShadow: RED_SHADOW }}
            >
              <Phone style={{ width: 17, height: 17, color: '#fff' }} />
            </a>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close messages"
            className="shrink-0 flex items-center justify-center rounded-full active:scale-90 transition-transform"
            style={{ width: 38, height: 38, background: 'rgba(17,17,17,.06)' }}
          >
            <X style={{ width: 16, height: 16, color: '#111111' }} strokeWidth={2.4} />
          </button>
        </div>

        {/* Messages */}
        <div
          ref={listRef}
          className="flex-1 overflow-y-auto overscroll-contain"
          style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}
        >
          {!loading && messages.length === 0 && (
            <p className="text-center" style={{ margin: 'auto', fontSize: 12.5, fontWeight: 500, color: '#999999' }}>
              No messages yet — say hello to {firstName}.
            </p>
          )}
          {messages.map((m, i) => {
            const fromDriver = m.sender_id === driverUserId;
            const mine = m.sender_id === currentUserId;
            const showDate = i === 0 || dayLabel(messages[i - 1].created_at) !== dayLabel(m.created_at);
            return (
              <div key={m.id} style={{ display: 'contents' }}>
                {showDate && (
                  <p className="text-center" style={{ fontSize: 10.5, fontWeight: 600, color: '#999999' }}>
                    {dayLabel(m.created_at)}
                  </p>
                )}
                <div
                  style={{
                    alignSelf: fromDriver ? 'flex-end' : 'flex-start',
                    maxWidth: '78%',
                    padding: '9px 13px',
                    borderRadius: fromDriver ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                    background: fromDriver ? RED_GRADIENT : RIDER_BG,
                    color: fromDriver ? '#fff' : RIDER_TEXT,
                    fontSize: 13.5,
                    fontWeight: 500,
                    lineHeight: 1.4,
                    opacity: m.pending ? 0.75 : 1,
                  }}
                >
                  {m.text}
                </div>
                {mine && m.failed && (
                  <button
                    type="button"
                    onClick={() => void send(m.text, m.id)}
                    className="flex items-center active:scale-95 transition-transform"
                    style={{ alignSelf: fromDriver ? 'flex-end' : 'flex-start', gap: 4, fontSize: 10.5, fontWeight: 600, color: RED_SOLID }}
                  >
                    <RotateCw style={{ width: 11, height: 11 }} /> Not sent — tap to retry
                  </button>
                )}
                {mine && !m.failed && !m.pending && m.id === lastOutgoingId && (
                  <span
                    aria-label={m.read_at ? 'Read' : m.delivered_at ? 'Delivered' : 'Sent'}
                    style={{ alignSelf: fromDriver ? 'flex-end' : 'flex-start', display: 'inline-flex', alignItems: 'center' }}
                  >
                    {m.read_at ? (
                      <CheckCheck style={{ width: 14, height: 14, color: RED_SOLID }} strokeWidth={2.6} />
                    ) : m.delivered_at ? (
                      <CheckCheck style={{ width: 14, height: 14, color: '#999999' }} strokeWidth={2.4} />
                    ) : (
                      <Check style={{ width: 14, height: 14, color: '#999999' }} strokeWidth={2.4} />
                    )}
                  </span>
                )}
              </div>
            );
          })}

          {otherTyping && (
            <div
              aria-label="Typing"
              style={{
                alignSelf: typingOnRight ? 'flex-end' : 'flex-start',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                padding: '10px 14px',
                borderRadius: typingOnRight ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                background: typingOnRight ? RED_GRADIENT : RIDER_BG,
              }}
            >
              {[0, 1, 2].map((d) => (
                <motion.span
                  key={d}
                  animate={{ opacity: [0.3, 1, 0.3], y: [0, -2, 0] }}
                  transition={{ duration: 1, repeat: Infinity, delay: d * 0.15 }}
                  style={{
                    width: 5,
                    height: 5,
                    borderRadius: 999,
                    background: typingOnRight ? '#fff' : '#8A9099',
                    display: 'block',
                  }}
                />
              ))}
            </div>
          )}
        </div>

        {/* Quick replies */}
        <div
          className="flex overflow-x-auto"
          style={{ gap: 8, padding: '0 16px 10px', scrollbarWidth: 'none' }}
        >
          {quickReplies.map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => void send(q)}
              className="shrink-0 active:scale-95 transition-transform"
              style={{
                height: 32,
                padding: '0 13px',
                borderRadius: 999,
                background: 'rgba(17,17,17,.05)',
                fontSize: 12.5,
                fontWeight: 600,
                color: '#111111',
                whiteSpace: 'nowrap',
              }}
            >
              {q}
            </button>
          ))}
        </div>

        {/* Composer */}
        <div
          className="flex items-center"
          style={{ gap: 8, padding: '8px 16px 30px', borderTop: '.5px solid rgba(17,17,17,.08)' }}
        >
          <input
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              if (e.target.value.trim()) notifyTyping();
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder={`Message ${firstName}…`}
            aria-label="Message"
            className="placeholder:text-[#999999]"
            style={{
              flex: 1,
              height: 44,
              padding: '0 16px',
              borderRadius: 22,
              background: 'rgba(17,17,17,.05)',
              fontSize: 14,
              fontWeight: 500,
              color: '#111111',
              outline: 'none',
              border: 'none',
            }}
          />
          <button
            type="button"
            onClick={handleSend}
            disabled={!draft.trim()}
            aria-label="Send message"
            className="shrink-0 flex items-center justify-center rounded-full active:scale-90 transition-transform disabled:opacity-50"
            style={{ width: 44, height: 44, background: RED_GRADIENT, boxShadow: RED_SHADOW }}
          >
            <ArrowUp style={{ width: 19, height: 19, color: '#fff' }} strokeWidth={2.6} />
          </button>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
