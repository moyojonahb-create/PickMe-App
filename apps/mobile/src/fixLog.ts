// SDK 54+ replaced expo-file-system's default export with a File/Directory API
// and moved the previous one to /legacy. Using legacy deliberately: its surface
// is exactly what this harness needs, it is guaranteed present through SDK 57,
// and a throwaway spike is the wrong place to spend time on an API migration.
// The real RN app should use the new API — and note the new FileHandle type
// offers true append, which would remove the read-modify-write below.
import * as FileSystem from 'expo-file-system/legacy';

/**
 * Append-only, on-disk fix log.
 *
 * Every fix is written to disk the moment it arrives, one JSON object per line.
 * This is the single most important design decision in the harness, and it is
 * driven by scenario S2: when the app is swiped from recents, Android kills the
 * JS process. Anything held in memory — a useState array, a batched buffer —
 * dies with it, and the log would show a clean stop at the swipe whether or not
 * the foreground service kept working. That would make the most important
 * scenario unmeasurable, and worse, would look like a definite failure.
 *
 * NDJSON rather than a JSON array so an append never has to read, parse and
 * rewrite the whole file, and so a process killed mid-write costs at most the
 * final line instead of corrupting the entire log.
 */

const LOG_PATH = `${FileSystem.documentDirectory}fix-log.ndjson`;
const META_PATH = `${FileSystem.documentDirectory}run-meta.json`;

export interface FixRecord {
  /** Epoch ms when the fix reached us. */
  t: number;
  lat: number;
  lon: number;
  /** Metres. Large values usually mean a cell/wifi fix rather than GPS. */
  accuracy: number | null;
  /** Battery 0–1, sampled opportunistically. */
  battery: number | null;
  /** 'active' | 'background' | 'inactive' — where the app was when it landed. */
  appState: string;
  /** True when replayed from the library's offline/heartbeat buffer. */
  isHeartbeat?: boolean;
}

export interface RunMeta {
  startedAt: number;
  startBattery: number | null;
  scenario: string;
  device: string;
  note?: string;
}

export async function appendFix(fix: FixRecord): Promise<void> {
  // expo-file-system has no append primitive, so read-modify-write. Acceptable
  // here: the file stays small (a 30-minute run at 15s is ~120 lines) and
  // correctness matters far more than write efficiency in a throwaway harness.
  try {
    const existing = await readRaw();
    await FileSystem.writeAsStringAsync(LOG_PATH, `${existing}${JSON.stringify(fix)}\n`);
  } catch (error) {
    // Never let logging failure kill tracking — a dropped line is a small
    // measurement error, a thrown exception inside a location callback can take
    // the whole subscription down and invalidate the run.
    console.warn('[fixLog] append failed', error);
  }
}

async function readRaw(): Promise<string> {
  const info = await FileSystem.getInfoAsync(LOG_PATH);
  if (!info.exists) return '';
  return FileSystem.readAsStringAsync(LOG_PATH);
}

export async function readFixes(): Promise<FixRecord[]> {
  const raw = await readRaw();
  return raw
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      try {
        return JSON.parse(line) as FixRecord;
      } catch {
        return null; // tolerate a torn final line from a killed process
      }
    })
    .filter((f): f is FixRecord => f !== null);
}

export async function resetLog(meta: RunMeta): Promise<void> {
  await FileSystem.writeAsStringAsync(LOG_PATH, '');
  await FileSystem.writeAsStringAsync(META_PATH, JSON.stringify(meta));
}

export async function readMeta(): Promise<RunMeta | null> {
  const info = await FileSystem.getInfoAsync(META_PATH);
  if (!info.exists) return null;
  try {
    return JSON.parse(await FileSystem.readAsStringAsync(META_PATH)) as RunMeta;
  } catch {
    return null;
  }
}

/** Absolute path, for sharing the raw log off the device. */
export const logFileUri = LOG_PATH;
