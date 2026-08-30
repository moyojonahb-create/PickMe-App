import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { User, Phone, X, ArrowUp, RotateCw } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

const RED_GRADIENT = 'linear-gradient(135deg,#E01B00,#B81104)';
const RED_SHADOW = '0 6px 14px rgba(184,17,4,.3)';

const QUICK_REPLIES = ["I'm outside", '2 minutes away', 'Running late'];

type Msg = {
  id: string;
  ride_id: string;
  sender_id: string;
  text: string;
  created_at: string;
  pending?: boolean;
  failed?: boolean;
};

interface DriverMessageSheetProps {
  open: boolean;
  onClose: () => void;
  rideId: string;
  currentUserId: string;
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
  passengerName,
  passengerPhone,
  etaMinutes,
}: DriverMessageSheetProps) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const listRef = useRef<HTMLDivElement | null>(null);

  const firstName = (passengerName || 'Passenger').split(' ')[0];

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      const el = listRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }, []);

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
      setMessages((data as Msg[]) || []);
      setLoading(false);
      scrollToBottom();
    })();

    const channel = supabase
      .channel(`driver-msgs-${rideId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `ride_id=eq.${rideId}` },
        (payload) => {
          const row = payload.new as Msg;
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
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [open, rideId, scrollToBottom]);

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
          return { ...(data as Msg), pending: false, failed: false };
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
              <span style={{ width: 6, height: 6, borderRadius: 999, background: '#22A447' }} />
              <span style={{ fontSize: 11.5, fontWeight: 500, color: '#666666' }}>
                {etaMinutes != null ? `${etaMinutes} min away` : 'On the way'}
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
                    alignSelf: mine ? 'flex-end' : 'flex-start',
                    maxWidth: '78%',
                    padding: '9px 13px',
                    borderRadius: mine ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                    background: mine ? RED_GRADIENT : 'rgba(17,17,17,.06)',
                    color: mine ? '#fff' : '#111111',
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
                    style={{ alignSelf: 'flex-end', gap: 4, fontSize: 10.5, fontWeight: 600, color: '#B81104' }}
                  >
                    <RotateCw style={{ width: 11, height: 11 }} /> Not sent — tap to retry
                  </button>
                )}
                {mine && !m.failed && !m.pending && m.id === lastOutgoingId && (
                  <span style={{ alignSelf: 'flex-end', fontSize: 10.5, fontWeight: 600, color: '#999999' }}>Sent</span>
                )}
              </div>
            );
          })}
        </div>

        {/* Quick replies */}
        <div
          className="flex overflow-x-auto"
          style={{ gap: 8, padding: '0 16px 10px', scrollbarWidth: 'none' }}
        >
          {QUICK_REPLIES.map((q) => (
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
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder={`Message ${firstName}…`}
            aria-label="Message"
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
