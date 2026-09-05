import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View, Pressable } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

import {
  defineCoreConfig,
  buildSupabaseOptions,
  createSupabaseAuthProvider,
  createGoBackendClient,
  createBackendSocketClient,
  eventRideId,
  GoBackendError,
  type BackendSocketState,
} from '@cruixe/core';

/**
 * Proves the ported core actually works against the real deployed backend from
 * a device — not that it compiles, which the tests already cover.
 *
 * Three things are being proven, in order of how much they'd hurt to discover
 * late:
 *   1. `packages/core` resolves and runs under Hermes at all.
 *   2. An authenticated HTTP call reaches the Go backend from a real device
 *      network (not localhost, not a Vite dev proxy).
 *   3. The WebSocket connects, authenticates, joins a room, and receives a
 *      live event — the piece the migration brief flags as most likely to
 *      differ subtly on React Native.
 */

const RED = '#B81104';

type Status = 'idle' | 'running' | 'pass' | 'fail';

/** Just the slice of the Supabase client this screen touches. */
type SupabaseLike = {
  auth: {
    signInWithPassword(c: { email: string; password: string }): Promise<{ error: { message: string } | null }>;
  };
};

function readEnv() {
  // EXPO_PUBLIC_* is Metro's equivalent of Vite's import.meta.env. This is the
  // seam CoreConfig exists for: core itself reads neither.
  return {
    apiBaseUrl: process.env.EXPO_PUBLIC_GO_BACKEND_URL ?? '',
    wsUrl: process.env.EXPO_PUBLIC_WS_URL ?? '',
    supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL ?? '',
    supabasePublishableKey: process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '',
    // TODO before anything ships: this string is sent as `x-client-info` on
    // every Supabase request and lands in backend logs. Real mobile traffic
    // tagged "spike" will mislead whoever reads those logs later. Change to
    // 'cruixe-mobile' when this leaves spike status.
    clientInfo: 'cruixe-mobile-spike',
  };
}

export default function CoreCheck() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [log, setLog] = useState<string[]>([]);
  const [configOk, setConfigOk] = useState<Status>('idle');
  const [authOk, setAuthOk] = useState<Status>('idle');
  const [httpOk, setHttpOk] = useState<Status>('idle');
  // Split deliberately: connectivity needs nobody, a room broadcast needs a
  // second party. Bundling them meant one red light with two very different
  // causes and two very different setup costs.
  const [socketOk, setSocketOk] = useState<Status>('idle');
  const [broadcastOk, setBroadcastOk] = useState<Status>('idle');
  const [socketState, setSocketState] = useState<BackendSocketState>('idle');
  const [rideId, setRideId] = useState('');

  const say = useCallback((line: string) => {
    setLog((prev) => [...prev, `${new Date().toLocaleTimeString()}  ${line}`]);
  }, []);

  // Built once and kept, so the socket is not recreated on every render.
  // `supabase` is deliberately loosely typed: createClient's generics resolve
  // differently at the call site than in a bare ReturnType, and pinning the
  // exact instantiation here buys nothing for a spike.
  const refs = useRef<{
    supabase?: SupabaseLike;
    go?: ReturnType<typeof createGoBackendClient>;
    socket?: ReturnType<typeof createBackendSocketClient>;
  }>({});

  useEffect(() => {
    try {
      const config = defineCoreConfig(readEnv());

      const supabase = createClient(
        config.supabaseUrl,
        config.supabasePublishableKey,
        buildSupabaseOptions(config, { storage: AsyncStorage, platform: 'native' }),
      );

      const auth = createSupabaseAuthProvider(supabase as never);

      refs.current.supabase = supabase as unknown as SupabaseLike;
      refs.current.go = createGoBackendClient({ config, auth });
      refs.current.socket = createBackendSocketClient({ wsUrl: config.wsUrl, auth });

      setConfigOk('pass');
      say(`config ok — api=${config.apiBaseUrl}`);
    } catch (error) {
      setConfigOk('fail');
      // defineCoreConfig names every missing key at once, which is the whole
      // reason it validates eagerly rather than failing at first use.
      say(`config FAILED — ${(error as Error).message}`);
    }

    return () => {
      refs.current.socket?.dispose();
      refs.current.go?.dispose();
    };
  }, [say]);

  const signIn = async () => {
    setAuthOk('running');
    try {
      const { error } = await refs.current.supabase!.auth.signInWithPassword({ email, password });
      if (error) throw new Error(error.message);
      setAuthOk('pass');
      say('signed in');
    } catch (error) {
      setAuthOk('fail');
      say(`sign-in FAILED — ${(error as Error).message}`);
    }
  };

  const callBackend = async () => {
    setHttpOk('running');
    try {
      // A real authenticated driver endpoint against the deployed Railway
      // backend. Proves egress, TLS, auth header and response parsing together.
      const rides = await refs.current.go!.get<unknown[]>('/api/rides/open');
      setHttpOk('pass');
      say(`GET /api/rides/open ok — ${Array.isArray(rides) ? rides.length : '?'} open rides`);
    } catch (error) {
      const e = error as GoBackendError;
      // UNAUTHENTICATED still proves we reached the backend; NETWORK_ERROR does
      // not. Worth distinguishing, or a routing problem reads as an auth one.
      setHttpOk('fail');
      say(`GET failed — code=${e.code ?? '?'} status=${e.status ?? '?'} ${e.message}`);
    }
  };

  /**
   * Check 4 — connectivity + auth. Needs no second party.
   *
   * A socket in state 'open' only proves the TCP/TLS handshake completed. The
   * ping round trip proves the Supabase token was accepted by the Go backend
   * and that traffic flows both ways under Hermes on a real device network.
   * That is the part most likely to differ from the browser.
   */
  const checkSocket = async () => {
    setSocketOk('running');
    const socket = refs.current.socket!;

    socket.onState((state) => {
      setSocketState(state);
      say(`socket state → ${state}`);
    });

    // Registered once, here, so a broadcast can arrive at any point after the
    // room is joined — including while the screen sits idle.
    socket.onAny((event) => {
      setBroadcastOk('pass');
      say(`EVENT ${event.type} ride=${eventRideId(event) ?? '—'}`);
    });

    try {
      await socket.connect();
      say('socket open — sending ping');
      const ponged = await socket.ping(10_000);
      if (ponged) {
        setSocketOk('pass');
        say('pong received — token accepted, bidirectional flow confirmed');
      } else {
        setSocketOk('fail');
        say('NO pong within 10s — socket opened but the server is not answering');
      }
    } catch (error) {
      setSocketOk('fail');
      say(`socket connect FAILED — ${(error as Error).message}`);
    }
  };

  /**
   * Check 5 — room broadcast. Needs a rider requesting a ride from the web app
   * on a laptop; same backend, same rooms, so no second phone is required.
   */
  const joinRoom = () => {
    if (!rideId.trim()) return;
    setBroadcastOk('running');
    refs.current.socket!.joinRide(rideId.trim());
    say(`joined ride_${rideId.trim()} — now trigger an event for this ride from the web app`);
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.h1}>Core wiring check</Text>
      <Text style={styles.sub}>Proves @cruixe/core works against the live backend from a device.</Text>

      <Check label="1. Config resolves" status={configOk} />
      <Check label="2. Supabase auth" status={authOk} />
      <Check label="3. Go backend call" status={httpOk} />
      <Check label={`4. Socket connect + ping/pong (${socketState})`} status={socketOk} />
      <Check label="5. Room broadcast (needs a rider)" status={broadcastOk} />

      <View style={styles.card}>
        <TextInput
          style={styles.input}
          placeholder="driver email"
          autoCapitalize="none"
          keyboardType="email-address"
          value={email}
          onChangeText={setEmail}
        />
        <TextInput
          style={styles.input}
          placeholder="password"
          secureTextEntry
          value={password}
          onChangeText={setPassword}
        />
        <Button label="Sign in" onPress={signIn} primary />
        <Button label="Call Go backend" onPress={callBackend} />
        <Button label="Connect socket + ping" onPress={checkSocket} />
        <TextInput
          style={styles.input}
          placeholder="ride id to join"
          autoCapitalize="none"
          value={rideId}
          onChangeText={setRideId}
        />
        <Button label="Join ride room" onPress={joinRoom} />
        <Text style={styles.hint}>
          Checks 1–4 need only this phone. Check 5 needs a rider requesting a ride from the
          web app on a laptop — same backend, same rooms, so no second phone.
        </Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Log</Text>
        {log.length === 0 && <Text style={styles.logLine}>—</Text>}
        {log.map((line, i) => (
          <Text key={i} style={styles.logLine}>
            {line}
          </Text>
        ))}
      </View>
    </ScrollView>
  );
}

function Check({ label, status }: { label: string; status: Status }) {
  const color =
    status === 'pass' ? '#1B7F3A' : status === 'fail' ? RED : status === 'running' ? '#B45309' : '#888';
  const mark = status === 'pass' ? '✓' : status === 'fail' ? '✗' : status === 'running' ? '…' : '·';
  return (
    <View style={styles.check}>
      <Text style={[styles.checkMark, { color }]}>{mark}</Text>
      <Text style={styles.checkLabel}>{label}</Text>
    </View>
  );
}

function Button({ label, onPress, primary }: { label: string; onPress: () => void; primary?: boolean }) {
  return (
    <Pressable style={[styles.button, primary ? styles.buttonPrimary : styles.buttonMuted]} onPress={onPress}>
      <Text style={[styles.buttonText, primary && { color: '#fff' }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 10 },
  h1: { fontSize: 20, fontWeight: '800', color: '#111' },
  sub: { fontSize: 12, color: '#666', marginTop: -6, marginBottom: 6 },
  check: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  checkMark: { fontSize: 16, fontWeight: '800', width: 16 },
  checkLabel: { fontSize: 14, color: '#111' },
  card: { backgroundColor: '#fff', borderRadius: 14, padding: 12, gap: 8, marginTop: 8 },
  cardTitle: { fontSize: 11, fontWeight: '800', color: '#666', textTransform: 'uppercase', letterSpacing: 1 },
  input: {
    height: 42, borderRadius: 10, paddingHorizontal: 12,
    backgroundColor: '#F5F6F8', borderWidth: 1, borderColor: '#E3E6EA',
  },
  button: { height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  buttonPrimary: { backgroundColor: RED },
  buttonMuted: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#E3E6EA' },
  buttonText: { fontWeight: '700', fontSize: 14, color: '#111' },
  logLine: { fontSize: 11, color: '#333', fontVariant: ['tabular-nums'] },
  hint: { fontSize: 11, color: '#777', lineHeight: 15 },
});
