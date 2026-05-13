/* eslint-disable react-hooks/exhaustive-deps */
import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "@/lib/supabaseClient";
import { toast } from "sonner";
import { startRingtone, stopRingtone } from "@/lib/notificationSounds";

export type CallStatus =
  | "idle"
  | "ringing"
  | "connecting"
  | "connected"
  | "ended"
  | "error";

interface UseWebRTCCallOptions {
  rideId: string | null;
  currentUserId: string;
  otherUserId: string | null;
}

const ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "stun:stun2.l.google.com:19302" },
];

/** Show a system notification for incoming calls (works when app is in background) */
function showCallNotification(_callerId: string) {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'granted') {
    const n = new Notification('Incoming Call 📞', {
      body: 'Someone is calling you on your ride',
      tag: 'incoming-call',
      requireInteraction: true,
    });
    n.onclick = () => {
      window.focus();
      n.close();
    };
  } else if (Notification.permission !== 'denied') {
    Notification.requestPermission();
  }
}

export function useWebRTCCall({
  rideId,
  currentUserId,
  otherUserId,
}: UseWebRTCCallOptions) {
  const [callStatus, setCallStatus] = useState<CallStatus>("idle");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isSpeaker, setIsSpeaker] = useState(true);
  const [callDuration, setCallDuration] = useState(0);
  const [incomingCall, setIncomingCall] = useState<{
    sessionId: string;
    callerId: string;
  } | null>(null);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const iceCandidateQueueRef = useRef<RTCIceCandidateInit[]>([]);
  const isCallerRef = useRef(false); // Track if this user is the caller

  // Refs for stable access in callbacks
  const sessionIdRef = useRef<string | null>(null);
  const callStatusRef = useRef<CallStatus>("idle");
  const incomingCallRef = useRef<typeof incomingCall>(null);

  useEffect(() => { sessionIdRef.current = sessionId; }, [sessionId]);
  useEffect(() => { callStatusRef.current = callStatus; }, [callStatus]);
  useEffect(() => { incomingCallRef.current = incomingCall; }, [incomingCall]);

  // Create hidden audio element for remote playback
  useEffect(() => {
    if (!remoteAudioRef.current) {
      const audio = document.createElement("audio");
      audio.autoplay = true;
      audio.style.display = "none";
      document.body.appendChild(audio);
      remoteAudioRef.current = audio;
    }
    return () => {
      if (remoteAudioRef.current) {
        remoteAudioRef.current.srcObject = null;
        remoteAudioRef.current.remove();
        remoteAudioRef.current = null;
      }
    };
  }, []);

  // Signaling channel via call_sessions realtime
  const signalingChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  const setupSignalingChannel = useCallback((sid: string) => {
    // Use a Supabase Realtime broadcast channel for WebRTC signaling
    const channel = supabase.channel(`webrtc-signal-${sid}`, {
      config: { broadcast: { self: false } },
    });

    channel
      .on("broadcast", { event: "offer" }, async ({ payload }) => {
        const pc = pcRef.current;
        if (!pc) return;
        // Only process offers when in stable state (waiting for remote offer)
        if (pc.signalingState !== "stable") {
          console.warn("[WebRTC] Ignoring offer — signalingState:", pc.signalingState);
          return;
        }
        try {
          await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          channel.send({ type: "broadcast", event: "answer", payload: { sdp: answer } });
          // Process queued ICE candidates
          for (const c of iceCandidateQueueRef.current) {
            await pc.addIceCandidate(new RTCIceCandidate(c));
          }
          iceCandidateQueueRef.current = [];
        } catch (err) {
          console.error("[WebRTC] Failed to handle offer:", err);
        }
      })
      .on("broadcast", { event: "answer" }, async ({ payload }) => {
        const pc = pcRef.current;
        if (!pc) return;
        // Only accept answer when we have a local offer pending
        if (pc.signalingState !== "have-local-offer") {
          console.warn("[WebRTC] Ignoring answer — signalingState:", pc.signalingState);
          return;
        }
        try {
          await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
          // Process queued ICE candidates
          for (const c of iceCandidateQueueRef.current) {
            await pc.addIceCandidate(new RTCIceCandidate(c));
          }
          iceCandidateQueueRef.current = [];
        } catch (err) {
          console.error("[WebRTC] Failed to handle answer:", err);
        }
      })
      .on("broadcast", { event: "ice-candidate" }, async ({ payload }) => {
        if (!pcRef.current) return;
        try {
          if (pcRef.current.remoteDescription) {
            await pcRef.current.addIceCandidate(new RTCIceCandidate(payload.candidate));
          } else {
            iceCandidateQueueRef.current.push(payload.candidate);
          }
        } catch (err) {
          console.error("[WebRTC] Failed to add ICE candidate:", err);
        }
      })
      .subscribe();

    signalingChannelRef.current = channel;
    return channel;
  }, []);

  // Listen for incoming calls via DB realtime
  useEffect(() => {
    if (!currentUserId) return;

    const channel = supabase
      .channel(`call-session-${currentUserId}-${Date.now()}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "call_sessions",
          filter: `callee_id=eq.${currentUserId}`,
        },
        (payload) => {
          const session = payload.new as Record<string, unknown>;
          if (session.status === "ringing" && callStatusRef.current === "idle") {
            // Start incoming ringtone for callee
            startRingtone('incoming');
            // Show system notification for background support
            showCallNotification(session.caller_id as string);
            setIncomingCall({
              sessionId: session.id as string,
              callerId: session.caller_id as string,
            });
          }
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "call_sessions",
        },
        (payload) => {
          const session = payload.new as Record<string, unknown>;
          const isParticipant =
            session.caller_id === currentUserId ||
            session.callee_id === currentUserId;
          if (!isParticipant) return;

          if (session.status === "ended" || session.status === "declined") {
            if (
              session.id === sessionIdRef.current ||
              (session.id as string) === incomingCallRef.current?.sessionId
            ) {
              cleanup();
              setCallStatus("ended");
              setIncomingCall(null);
              setTimeout(() => setCallStatus("idle"), 2000);
            }
          }
          if (session.status === "answered" && session.id === sessionIdRef.current && isCallerRef.current) {
            // Only the CALLER initiates WebRTC when callee answers
            stopRingtone();
            initiateWebRTC(session.id as string, true);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentUserId]);

  const cleanup = useCallback(async () => {
    // Stop any ringtone
    stopRingtone();
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    }
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    if (signalingChannelRef.current) {
      supabase.removeChannel(signalingChannelRef.current);
      signalingChannelRef.current = null;
    }
    if (remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = null;
    }
    iceCandidateQueueRef.current = [];
    isCallerRef.current = false;
    setCallDuration(0);
    setIsMuted(false);
  }, []);

  const initiateWebRTC = useCallback(
    async (sid: string, isCaller: boolean) => {
      // Prevent double-init
      if (pcRef.current) {
        console.warn("[WebRTC] Already have a peer connection, skipping init");
        return;
      }

      try {
        setCallStatus("connecting");
        stopRingtone();

        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        localStreamRef.current = stream;

        const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
        pcRef.current = pc;

        // Add local tracks
        stream.getTracks().forEach((track) => pc.addTrack(track, stream));

        // Setup signaling — wait for channel to be ready
        const channel = setupSignalingChannel(sid);

        // Handle remote tracks
        pc.ontrack = (event) => {
          if (remoteAudioRef.current && event.streams[0]) {
            remoteAudioRef.current.srcObject = event.streams[0];
          }
        };

        // Queue ICE candidates until channel is ready, then send
        const pendingIceCandidates: RTCIceCandidateInit[] = [];
        let channelReady = false;

        pc.onicecandidate = (event) => {
          if (event.candidate) {
            const candidateJson = event.candidate.toJSON();
            if (channelReady) {
              channel.send({
                type: "broadcast",
                event: "ice-candidate",
                payload: { candidate: candidateJson },
              });
            } else {
              pendingIceCandidates.push(candidateJson);
            }
          }
        };

        // Handle connection state
        pc.onconnectionstatechange = () => {
          if (pc.connectionState === "connected") {
            stopRingtone();
            setCallStatus("connected");
            const start = Date.now();
            timerRef.current = setInterval(() => {
              setCallDuration(Math.floor((Date.now() - start) / 1000));
            }, 1000);
          }
          if (pc.connectionState === "disconnected" || pc.connectionState === "failed") {
            endCall();
          }
        };

        // Wait a tick for channel subscription to be ready
        await new Promise<void>((resolve) => {
          const checkReady = () => {
            // Channel is ready when subscribed
            if ((channel as any).state === 'joined') {
              resolve();
            } else {
              setTimeout(checkReady, 100);
            }
          };
          // Give it 1.5s max then proceed anyway
          setTimeout(resolve, 1500);
          checkReady();
        });

        channelReady = true;
        // Flush any queued ICE candidates
        for (const c of pendingIceCandidates) {
          channel.send({ type: "broadcast", event: "ice-candidate", payload: { candidate: c } });
        }

        // If caller, create and send offer
        if (isCaller) {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          const sendOffer = () => {
            channel.send({
              type: "broadcast",
              event: "offer",
              payload: { sdp: offer },
            });
          };
          // Send after short delay, then retry once
          setTimeout(sendOffer, 300);
          setTimeout(sendOffer, 1500);
        }
      } catch (err) {
        console.error("[WebRTC] Failed to setup call:", err);
        toast.error("Call failed", { description: String(err) });
        setCallStatus("error");
        cleanup();
        setTimeout(() => setCallStatus("idle"), 3000);
      }
    },
    [cleanup, setupSignalingChannel]
  );

  const startCall = useCallback(async () => {
    if (!rideId || !currentUserId || !otherUserId) {
      toast.error("Cannot start call", { description: "Missing ride or user info" });
      return;
    }

    try {
      setCallStatus("ringing");
      isCallerRef.current = true;
      // Start outgoing ringtone for caller
      startRingtone('outgoing');

      const { data, error } = await supabase
        .from("call_sessions")
        .insert({
          ride_id: rideId,
          caller_id: currentUserId,
          callee_id: otherUserId,
          status: "ringing",
        })
        .select("id")
        .maybeSingle();

      if (error) throw error;
      if (!data) throw new Error("Failed to create call session");

      setSessionId(data.id);
      toast.info("Calling...", { description: "Waiting for answer" });
    } catch (err: unknown) {
      stopRingtone();
      toast.error("Call failed", { description: (err as Error).message });
      setCallStatus("error");
      setTimeout(() => setCallStatus("idle"), 2000);
    }
  }, [rideId, currentUserId, otherUserId]);

  const answerCall = useCallback(async () => {
    if (!incomingCall) return;

    try {
      // Stop incoming ringtone
      stopRingtone();
      isCallerRef.current = false;

      await supabase
        .from("call_sessions")
        .update({ status: "answered" })
        .eq("id", incomingCall.sessionId);

      setSessionId(incomingCall.sessionId);
      setIncomingCall(null);
      // As callee, set up WebRTC and wait for offer
      await initiateWebRTC(incomingCall.sessionId, false);
    } catch (err: unknown) {
      toast.error("Failed to answer", { description: (err as Error).message });
      setCallStatus("error");
    }
  }, [incomingCall, initiateWebRTC]);

  const declineCall = useCallback(async () => {
    if (!incomingCall) return;
    stopRingtone();

    try {
      await supabase
        .from("call_sessions")
        .update({ status: "declined", ended_at: new Date().toISOString() })
        .eq("id", incomingCall.sessionId);
      setIncomingCall(null);
    } catch (err) {
      console.error("[WebRTC] Failed to decline call:", err);
    }
  }, [incomingCall]);

  const endCall = useCallback(async () => {
    const sid = sessionIdRef.current;
    if (sid) {
      try {
        await supabase
          .from("call_sessions")
          .update({ status: "ended", ended_at: new Date().toISOString() })
          .eq("id", sid);
      } catch (err) {
        console.warn("Failed to end call session:", err);
      }
    }
    await cleanup();
    setCallStatus("ended");
    setSessionId(null);
    setTimeout(() => setCallStatus("idle"), 2000);
  }, [cleanup]);

  const toggleMute = useCallback(() => {
    if (localStreamRef.current) {
      const audioTrack = localStreamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsMuted(!audioTrack.enabled);
      }
    }
  }, []);

  const toggleSpeaker = useCallback(() => {
    setIsSpeaker((prev) => !prev);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanup();
    };
  }, [cleanup]);

  return {
    callStatus,
    isMuted,
    isSpeaker,
    callDuration,
    incomingCall,
    startCall,
    answerCall,
    declineCall,
    endCall,
    toggleMute,
    toggleSpeaker,
  };
}

export function formatCallDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}
