import { useEffect, useState, useCallback, useRef } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useRideRealtime } from "@/hooks/useRideRealtime";
import { Send, Phone, MessageCircle, PhoneCall, Smile } from "lucide-react";
import { playMessageSound } from "@/lib/notificationSounds";
import { format } from "date-fns";
import { motion, AnimatePresence } from "framer-motion";
import { createMessage } from "@/lib/businessApi";
import { RIDE_RED, RIDE_RED_GRADIENT, RIDE_TEXT, RIDE_TEXT_2, RIDE_FONT, glassSurface } from "./rideGlass";

type Message = {
  id: string;
  ride_id: string;
  sender_id: string;
  text: string;
  created_at: string;
};

const QUICK_REPLIES = [
  "I'm here",
  "On my way",
  "5 minutes away",
  "Please wait",
  "Can you call me?",
  "Thank you!",
];

type RideCommunicationProps = {
  rideId: string;
  currentUserId: string;
  otherUserPhone?: string | null;
  riderId: string;
  /** In-app voice call (Agora) — when provided, the Call action uses this
   * instead of a plain `tel:` link, and reuses the same ActiveCallOverlay/
   * IncomingCallModal already mounted on the parent screen. */
  onStartCall?: () => void;
  /** True while a call (ringing/connecting/connected) is already underway,
   * so this button doesn't start a second one. */
  callActive?: boolean;
};

export function RideCommunication({
  rideId,
  currentUserId,
  otherUserPhone,
  riderId,
  onStartCall,
  callActive,
}: RideCommunicationProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [lastMessageCount, setLastMessageCount] = useState(0);
  const [showQuickReplies, setShowQuickReplies] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  const loadMessages = useCallback(async () => {
    const { data, error } = await supabase
      .from("messages")
      .select("*")
      .eq("ride_id", rideId)
      .order("created_at", { ascending: true });

    if (!error && data) {
      if (data.length > lastMessageCount && lastMessageCount > 0) {
        const lastMsg = data[data.length - 1];
        if (lastMsg.sender_id !== currentUserId) {
          playMessageSound();
        }
      }
      setLastMessageCount(data.length);
      setMessages(data as Message[]);
      setTimeout(scrollToBottom, 100);
    }
  }, [rideId, currentUserId, lastMessageCount, scrollToBottom]);

  useRideRealtime(rideId, {
    onMessageChange: loadMessages,
  });

  useEffect(() => {
    loadMessages();
  }, [loadMessages]);

  const sendMessage = async (messageText?: string) => {
    const msgText = (messageText || text).trim();
    if (!msgText || sending) return;

    setSending(true);
    try {
      await createMessage({
        ride_id: rideId,
        text: msgText,
      });

      setText("");
      setShowQuickReplies(false);
      loadMessages();
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  // Group messages by time gaps (5 min)
  const groupedMessages = messages.reduce<{ date: string; messages: Message[] }[]>((acc, msg) => {
    const msgDate = format(new Date(msg.created_at), 'h:mm a');
    const last = acc[acc.length - 1];
    if (last && last.date === msgDate) {
      last.messages.push(msg);
    } else {
      acc.push({ date: msgDate, messages: [msg] });
    }
    return acc;
  }, []);

  return (
    <div style={{ fontFamily: RIDE_FONT }} className="flex flex-col" >
      <div className="flex items-center justify-between" style={{ marginBottom: 10 }}>
        <span className="flex items-center" style={{ gap: 7, fontSize: 15, fontWeight: 700, color: RIDE_TEXT }}>
          <MessageCircle style={{ width: 17, height: 17, color: RIDE_RED }} />
          Chat
        </span>
        {messages.length > 0 && (
          <span style={{ fontSize: 10.5, fontWeight: 700, color: RIDE_TEXT_2, background: 'rgba(17,17,17,.05)', padding: '2px 8px', borderRadius: 999 }}>
            {messages.length} messages
          </span>
        )}
      </div>

      {/* Call row — in-app voice call when wired, phone-network fallback otherwise */}
      {onStartCall ? (
        <button
          type="button"
          onClick={onStartCall}
          disabled={callActive}
          className="flex items-center active:scale-[0.98] transition-transform disabled:opacity-70"
          style={{ ...glassSurface, borderRadius: 14, padding: '10px 12px', gap: 10, marginBottom: 10, width: '100%', textAlign: 'left' }}
        >
          <span className="flex items-center justify-center rounded-full shrink-0" style={{ width: 32, height: 32, background: RIDE_RED_GRADIENT }}>
            <PhoneCall style={{ width: 15, height: 15, color: '#fff' }} />
          </span>
          <span style={{ flex: 1, fontSize: 13, fontWeight: 700, color: RIDE_TEXT }}>
            {callActive ? 'Call in progress…' : 'Call in app'}
          </span>
        </button>
      ) : otherUserPhone ? (
        <a
          href={`tel:${otherUserPhone.replace(/[^\d+]/g, "")}`}
          className="flex items-center active:scale-[0.98] transition-transform"
          style={{ ...glassSurface, borderRadius: 14, padding: '10px 12px', gap: 10, marginBottom: 10, textDecoration: 'none' }}
        >
          <span className="flex items-center justify-center rounded-full shrink-0" style={{ width: 32, height: 32, background: RIDE_RED_GRADIENT }}>
            <Phone style={{ width: 15, height: 15, color: '#fff' }} />
          </span>
          <span style={{ flex: 1, fontSize: 13, fontWeight: 700, color: RIDE_TEXT }}>{otherUserPhone}</span>
          <span style={{ fontSize: 11.5, fontWeight: 700, color: RIDE_RED }}>Call</span>
        </a>
      ) : null}

      {/* Chat card */}
      <div style={{ ...glassSurface, borderRadius: 18, overflow: 'hidden' }}>
        {/* Messages */}
        <div ref={containerRef} className="overflow-y-auto" style={{ height: 224, padding: '12px 12px 4px', display: 'flex', flexDirection: 'column', gap: 2, background: 'rgba(244,245,247,.5)' }}>
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center" style={{ flex: 1, gap: 8, color: RIDE_TEXT_2 }}>
              <MessageCircle style={{ width: 26, height: 26, opacity: 0.35 }} />
              <p style={{ fontSize: 12.5, fontWeight: 600 }}>No messages yet</p>
            </div>
          ) : (
            <>
              {groupedMessages.map((group, gi) => (
                <div key={gi}>
                  <div className="flex justify-center" style={{ margin: '6px 0' }}>
                    <span style={{ fontSize: 9.5, fontWeight: 700, color: RIDE_TEXT_2, background: 'rgba(17,17,17,.06)', padding: '2px 9px', borderRadius: 999 }}>
                      {group.date}
                    </span>
                  </div>
                  {group.messages.map((m, mi) => {
                    const isMe = m.sender_id === currentUserId;
                    const isRider = m.sender_id === riderId;
                    return (
                      <motion.div
                        key={m.id}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: mi * 0.03 }}
                        className={`flex ${isMe ? "justify-end" : "justify-start"}`}
                        style={{ marginBottom: 5 }}
                      >
                        <div
                          style={{
                            maxWidth: '78%',
                            borderRadius: 16,
                            padding: '8px 12px',
                            ...(isMe
                              ? { background: RIDE_RED_GRADIENT, color: '#fff', borderBottomRightRadius: 5 }
                              : { background: '#fff', color: RIDE_TEXT, boxShadow: 'inset 0 0 0 .5px rgba(17,17,17,.08)', borderBottomLeftRadius: 5 }),
                          }}
                        >
                          {!isMe && (
                            <p style={{ fontSize: 9.5, fontWeight: 800, marginBottom: 1, color: RIDE_TEXT_2, textTransform: 'uppercase', letterSpacing: '.04em' }}>
                              {isRider ? "Rider" : "Driver"}
                            </p>
                          )}
                          <p style={{ fontSize: 13.5, fontWeight: 500, lineHeight: 1.4 }}>{m.text}</p>
                          <p style={{ fontSize: 9, marginTop: 2, textAlign: 'right', opacity: isMe ? 0.75 : 0.5 }}>
                            {format(new Date(m.created_at), 'h:mm a')}
                          </p>
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
              ))}
              <div ref={messagesEndRef} />
            </>
          )}
        </div>

        {/* Quick Replies */}
        <AnimatePresence>
          {showQuickReplies && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              style={{ overflow: 'hidden', borderTop: '.5px solid rgba(17,17,17,.08)', background: 'rgba(255,255,255,.6)' }}
            >
              <div className="flex flex-wrap" style={{ padding: 8, gap: 6 }}>
                {QUICK_REPLIES.map((reply) => (
                  <button
                    key={reply}
                    onClick={() => sendMessage(reply)}
                    className="active:scale-95 transition-transform"
                    style={{ fontSize: 11.5, fontWeight: 600, padding: '6px 12px', borderRadius: 999, background: '#fff', color: RIDE_TEXT, boxShadow: 'inset 0 0 0 .5px rgba(17,17,17,.1)' }}
                  >
                    {reply}
                  </button>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Input */}
        <div className="flex items-center" style={{ gap: 8, padding: 8, background: '#fff', borderTop: '.5px solid rgba(17,17,17,.08)' }}>
          <button
            onClick={() => setShowQuickReplies(!showQuickReplies)}
            className="flex items-center justify-center shrink-0 active:scale-90 transition-transform"
            style={{ width: 34, height: 34, borderRadius: 999, background: showQuickReplies ? RIDE_RED : 'rgba(17,17,17,.05)' }}
          >
            <Smile style={{ width: 16, height: 16, color: showQuickReplies ? '#fff' : RIDE_TEXT_2 }} />
          </button>
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message…"
            disabled={sending}
            className="flex-1 min-w-0"
            style={{ height: 34, borderRadius: 999, background: 'rgba(17,17,17,.05)', padding: '0 14px', fontSize: 13, fontWeight: 500, color: RIDE_TEXT, border: 'none', outline: 'none' }}
          />
          <button
            onClick={() => sendMessage()}
            disabled={!text.trim() || sending}
            className="flex items-center justify-center shrink-0 active:scale-90 transition-transform disabled:opacity-50"
            style={{ width: 34, height: 34, borderRadius: 999, background: RIDE_RED_GRADIENT }}
          >
            <Send style={{ width: 15, height: 15, color: '#fff' }} />
          </button>
        </div>
      </div>
    </div>
  );
}
