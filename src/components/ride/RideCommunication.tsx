import { useEffect, useState, useCallback, useRef } from "react";
import { supabase } from "@/lib/supabaseClient";
import { CallButton } from "./CallButton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useRideRealtime } from "@/hooks/useRideRealtime";
import { Send, Phone, MessageCircle, Image as ImageIcon, Smile } from "lucide-react";
import { playMessageSound } from "@/lib/notificationSounds";
import { format } from "date-fns";
import { motion, AnimatePresence } from "framer-motion";
import { createMessage } from "@/lib/businessApi";

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
};

export function RideCommunication({ 
  rideId, 
  currentUserId, 
  otherUserPhone, 
  riderId 
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
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-bold text-lg text-foreground flex items-center gap-2">
          <MessageCircle className="h-5 w-5" />
          Chat
        </h3>
        {messages.length > 0 && (
          <span className="text-[10px] text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
            {messages.length} messages
          </span>
        )}
      </div>

      {/* Call Button */}
      {otherUserPhone && (
        <div className="flex items-center gap-2 p-3 bg-muted rounded-xl">
          <Phone className="h-4 w-4 text-muted-foreground" />
          <span className="flex-1 text-sm font-medium">{otherUserPhone}</span>
          <CallButton phone={otherUserPhone} label="Call" className="text-sm py-2 px-4" />
        </div>
      )}

      {/* Chat Section */}
      <div className="border border-border rounded-xl overflow-hidden">
        {/* Messages */}
        <div ref={containerRef} className="h-56 overflow-y-auto p-3 space-y-1 bg-muted/20">
          {messages.length === 0 ? (
            <div className="text-muted-foreground text-sm text-center py-8 space-y-2">
              <MessageCircle className="w-8 h-8 mx-auto opacity-40" />
              <p>No messages yet</p>
            </div>
          ) : (
            <>
              {groupedMessages.map((group, gi) => (
                <div key={gi}>
                  <div className="flex justify-center my-2">
                    <span className="text-[10px] text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
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
                        className={`flex ${isMe ? "justify-end" : "justify-start"} mb-1`}
                      >
                        <div
                          className={`max-w-[80%] rounded-2xl px-3.5 py-2 ${
                            isMe
                              ? "bg-primary text-primary-foreground rounded-br-md"
                              : "bg-card border border-border rounded-bl-md"
                          }`}
                        >
                          {!isMe && (
                            <p className="text-[10px] font-bold mb-0.5 opacity-60">
                              {isRider ? "Rider" : "Driver"}
                            </p>
                          )}
                          <p className="text-sm leading-relaxed">{m.text}</p>
                          <p className={`text-[9px] mt-0.5 text-right ${isMe ? 'opacity-60' : 'text-muted-foreground'}`}>
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
              className="border-t border-border bg-muted/30 overflow-hidden"
            >
              <div className="p-2 flex flex-wrap gap-1.5">
                {QUICK_REPLIES.map((reply) => (
                  <button
                    key={reply}
                    onClick={() => sendMessage(reply)}
                    className="text-xs px-3 py-1.5 rounded-full bg-card border border-border hover:bg-primary hover:text-primary-foreground transition-colors font-medium"
                  >
                    {reply}
                  </button>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Input */}
        <div className="flex items-center gap-1.5 p-2 bg-background border-t border-border">
          <button
            onClick={() => setShowQuickReplies(!showQuickReplies)}
            className={`p-2 rounded-full transition-colors ${showQuickReplies ? 'bg-primary text-primary-foreground' : 'hover:bg-muted text-muted-foreground'}`}
          >
            <Smile className="h-4 w-4" />
          </button>
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message…"
            className="flex-1 border-0 bg-muted/50 focus-visible:ring-1"
            disabled={sending}
          />
          <Button 
            onClick={() => sendMessage()} 
            disabled={!text.trim() || sending}
            size="icon"
            className="rounded-full shrink-0"
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
