import { useCallback, useEffect, useState } from 'react';
import { AppState, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View, Pressable, Platform } from 'react-native';
import BackgroundGeolocation, { type Location, type State } from 'react-native-background-geolocation';
import * as Battery from 'expo-battery';
import * as Sharing from 'expo-sharing';
import * as Device from 'expo-device';

import { appendFix, readFixes, readMeta, resetLog, logFileUri, type FixRecord } from './src/fixLog';
import { analyze, formatDuration, type Analysis, type Verdict } from './src/analyze';
import CoreCheck from './src/CoreCheck';

/**
 * Throwaway harness for the background-location platform spike. See RUNBOOK.md.
 *
 * It deliberately does almost nothing beyond logging fixes to disk and scoring
 * them against pre-registered thresholds. Anything more would be building on
 * top of the assumption this spike exists to test.
 */

// Brand red, so a screenshot of this is unmistakably ours in a thread.
const RED = '#B81104';

export default function App() {
  // Both spikes ship in one dev-client build: rebuilding a dev client to switch
  // between them would cost more than the tab does.
  const [tab, setTab] = useState<'spike' | 'core'>('spike');
  const [tracking, setTracking] = useState(false);
  const [fixes, setFixes] = useState<FixRecord[]>([]);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [scenario, setScenario] = useState('S1');
  const [ready, setReady] = useState(false);

  const refresh = useCallback(async () => {
    const [loaded, meta] = await Promise.all([readFixes(), readMeta()]);
    setFixes(loaded);
    setAnalysis(analyze(loaded, meta));
  }, []);

  useEffect(() => {
    const onLocation = BackgroundGeolocation.onLocation(async (location: Location) => {
      let battery: number | null = null;
      try {
        battery = await Battery.getBatteryLevelAsync();
      } catch {
        battery = null;
      }

      await appendFix({
        t: Date.now(),
        lat: location.coords.latitude,
        lon: location.coords.longitude,
        accuracy: location.coords.accuracy ?? null,
        battery,
        appState: AppState.currentState ?? 'unknown',
        isHeartbeat: Boolean((location as unknown as { is_heartbeat?: boolean }).is_heartbeat),
      });

      // Only refresh the UI when it can actually be seen. Doing this while
      // backgrounded is pointless work on a battery test.
      if (AppState.currentState === 'active') void refresh();
    });

    // Heartbeat events matter for the desk dry-run specifically. With
    // distanceFilter set, a stationary phone produces no onLocation events at
    // all — so without this, a five-minute dry-run on a desk would log nothing
    // and look like a broken instrument when the instrument is fine. Logging
    // heartbeats separately keeps "not moving" distinguishable from "the OS
    // killed us", which is the whole question S1–S6 is asking.
    const onHeartbeat = BackgroundGeolocation.onHeartbeat(async () => {
      let battery: number | null = null;
      try {
        battery = await Battery.getBatteryLevelAsync();
      } catch {
        battery = null;
      }

      // The heartbeat payload's location can be stale, so ask for the current
      // one. Failing that, still log the beat — proof of life is the point.
      let coords: { latitude: number; longitude: number; accuracy?: number } | null = null;
      try {
        const current = await BackgroundGeolocation.getCurrentPosition({ samples: 1, timeout: 10 });
        coords = current.coords;
      } catch {
        coords = null;
      }

      await appendFix({
        t: Date.now(),
        lat: coords?.latitude ?? 0,
        lon: coords?.longitude ?? 0,
        accuracy: coords?.accuracy ?? null,
        battery,
        appState: AppState.currentState ?? 'unknown',
        isHeartbeat: true,
      });

      if (AppState.currentState === 'active') void refresh();
    });

    // v5 restructured Config from v4's flat object into nested domains
    // (geolocation / app / http / logger), and moved the constants into enums.
    // A v4-shaped flat config does not type-check here — and if it were forced
    // through with `as any` it would be silently ignored at runtime, which on
    // this spike would look exactly like the platform failing.
    BackgroundGeolocation.ready({
      geolocation: {
        // 15s target interval — the number the runbook's expected-fix count uses.
        desiredAccuracy: BackgroundGeolocation.DesiredAccuracy.High,
        distanceFilter: 10,
        locationUpdateInterval: 15_000,
        fastestLocationUpdateInterval: 10_000,
      },
      app: {
        stopOnTerminate: false, // must survive swipe-from-recents (S2)
        startOnBoot: true,
        // Fires even when stationary, so a lull in movement is distinguishable
        // from the OS having killed us — which is the entire question here.
        heartbeatInterval: 60,
        notification: {
          title: 'CruiXe spike — tracking',
          text: 'Background location test in progress',
        },
      },
      http: {
        // Never let a failed upload mask a location failure: this spike
        // measures the OS, not our network.
        autoSync: false,
      },
      logger: {
        debug: false,
        logLevel: BackgroundGeolocation.LogLevel.Warning,
      },
    }).then((state: State) => {
      setTracking(state.enabled);
      setReady(true);
      void refresh();
    });

    return () => {
      onLocation.remove();
      onHeartbeat.remove();
    };
  }, [refresh]);

  const start = async () => {
    let startBattery: number | null = null;
    try {
      startBattery = await Battery.getBatteryLevelAsync();
    } catch {
      startBattery = null;
    }

    await resetLog({
      startedAt: Date.now(),
      startBattery,
      scenario,
      device: `${Device.brand ?? '?'} ${Device.modelName ?? '?'} / ${Platform.OS} ${Device.osVersion ?? '?'}`,
    });

    await BackgroundGeolocation.start();
    setTracking(true);
    await refresh();
  };

  const stop = async () => {
    await BackgroundGeolocation.stop();
    setTracking(false);
    await refresh();
  };

  const share = async () => {
    if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(logFileUri);
  };

  const last = fixes[fixes.length - 1];

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.tabs}>
        <Pressable
          style={[styles.tab, tab === 'spike' && styles.tabActive]}
          onPress={() => setTab('spike')}
        >
          <Text style={[styles.tabText, tab === 'spike' && styles.tabTextActive]}>Location spike</Text>
        </Pressable>
        <Pressable
          style={[styles.tab, tab === 'core' && styles.tabActive]}
          onPress={() => setTab('core')}
        >
          <Text style={[styles.tabText, tab === 'core' && styles.tabTextActive]}>Core check</Text>
        </Pressable>
      </View>

      {tab === 'core' ? (
        <CoreCheck />
      ) : (
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.h1}>Background location spike</Text>
        <Text style={styles.sub}>
          {Device.brand} {Device.modelName} · {Platform.OS} {Device.osVersion}
        </Text>

        <View style={styles.row}>
          <Text style={styles.label}>Scenario</Text>
          <TextInput
            style={styles.input}
            value={scenario}
            onChangeText={setScenario}
            autoCapitalize="characters"
            placeholder="S1"
          />
        </View>

        <View style={styles.buttonRow}>
          <Pressable
            style={[styles.button, tracking ? styles.buttonMuted : styles.buttonPrimary]}
            onPress={start}
            disabled={!ready}
          >
            <Text style={styles.buttonText}>{tracking ? 'Restart run' : 'Start + reset log'}</Text>
          </Pressable>
          <Pressable
            style={[styles.button, styles.buttonMuted]}
            onPress={stop}
            disabled={!ready || !tracking}
          >
            <Text style={styles.buttonText}>Stop</Text>
          </Pressable>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Live</Text>
          <Row k="Tracking" v={tracking ? 'yes' : 'no'} />
          <Row k="Fixes logged" v={String(fixes.length)} />
          <Row k="Last fix" v={last ? new Date(last.t).toLocaleTimeString() : '—'} />
          <Row
            k="Landed in background"
            v={analysis ? `${analysis.backgroundFixCount} of ${analysis.fixCount}` : '—'}
          />
        </View>

        {analysis && analysis.fixCount > 0 && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Scored against RUNBOOK.md</Text>
            <Row k="Duration" v={formatDuration(analysis.durationMs)} />
            <Row
              k="Delivery rate"
              v={`${(analysis.deliveryRate * 100).toFixed(0)}% (${analysis.fixCount}/${Math.round(analysis.expectedFixes)})`}
              verdict={analysis.verdicts.deliveryRate}
            />
            <Row
              k="Max gap"
              v={formatDuration(analysis.maxGapMs)}
              verdict={analysis.verdicts.maxGap}
            />
            <Row
              k="Degradation"
              v={
                analysis.verdicts.degradation === 'n/a'
                  ? 'needs 20+ min'
                  : `${(analysis.degradation * 100).toFixed(0)}% worse`
              }
              verdict={analysis.verdicts.degradation}
            />
            <Row
              k="Battery"
              v={
                analysis.batteryDrainPerHour == null
                  ? '—'
                  : `${analysis.batteryDrainPerHour.toFixed(1)} %/hr`
              }
              verdict={analysis.verdicts.battery}
            />
            <View style={styles.divider} />
            <Row k="OVERALL" v={analysis.overall.toUpperCase()} verdict={analysis.overall} />

            {analysis.notableGaps.length > 0 && (
              <>
                <Text style={styles.gapsTitle}>Gaps over 90s</Text>
                {analysis.notableGaps.slice(0, 8).map((g) => (
                  <Text key={g.startedAt} style={styles.gap}>
                    {new Date(g.startedAt).toLocaleTimeString()} → {formatDuration(g.gapMs)}
                  </Text>
                ))}
              </>
            )}
          </View>
        )}

        <View style={styles.buttonRow}>
          <Pressable style={[styles.button, styles.buttonMuted]} onPress={refresh}>
            <Text style={styles.buttonText}>Refresh</Text>
          </Pressable>
          <Pressable style={[styles.button, styles.buttonMuted]} onPress={share}>
            <Text style={styles.buttonText}>Export log</Text>
          </Pressable>
        </View>

        <Text style={styles.footnote}>
          Fixes are written to disk as they arrive, so the log survives the app being swiped
          away — that is what makes scenario S2 measurable.
        </Text>
      </ScrollView>
      )}
    </SafeAreaView>
  );
}

function Row({ k, v, verdict }: { k: string; v: string; verdict?: Verdict }) {
  const color =
    verdict === 'pass' ? '#1B7F3A' : verdict === 'fail' ? RED : verdict === 'investigate' ? '#B45309' : '#111';
  return (
    <View style={styles.kv}>
      <Text style={styles.k}>{k}</Text>
      <Text style={[styles.v, { color }]}>{v}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F2F4F7' },
  tabs: { flexDirection: 'row', gap: 8, padding: 12, paddingBottom: 0 },
  tab: { flex: 1, height: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  tabActive: { backgroundColor: RED },
  tabText: { fontSize: 13, fontWeight: '700', color: '#111' },
  tabTextActive: { color: '#fff' },
  container: { padding: 16, gap: 12 },
  h1: { fontSize: 22, fontWeight: '800', color: '#111' },
  sub: { fontSize: 12, color: '#666', marginTop: -8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  label: { fontSize: 13, fontWeight: '700', color: '#111' },
  input: {
    flex: 1, height: 40, borderRadius: 10, paddingHorizontal: 12,
    backgroundColor: '#fff', borderWidth: 1, borderColor: '#E3E6EA',
  },
  buttonRow: { flexDirection: 'row', gap: 10 },
  button: { flex: 1, height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  buttonPrimary: { backgroundColor: RED },
  buttonMuted: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#E3E6EA' },
  buttonText: { fontWeight: '700', fontSize: 14 },
  card: { backgroundColor: '#fff', borderRadius: 16, padding: 14, gap: 6 },
  cardTitle: { fontSize: 12, fontWeight: '800', color: '#666', textTransform: 'uppercase', letterSpacing: 1 },
  kv: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  k: { fontSize: 13, color: '#444' },
  v: { fontSize: 14, fontWeight: '700', fontVariant: ['tabular-nums'] },
  divider: { height: 1, backgroundColor: '#EEE', marginVertical: 4 },
  gapsTitle: { marginTop: 8, fontSize: 12, fontWeight: '700', color: RED },
  gap: { fontSize: 12, color: '#444', fontVariant: ['tabular-nums'] },
  footnote: { fontSize: 11, color: '#777', lineHeight: 16 },
});
