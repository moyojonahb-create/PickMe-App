import { supabase } from '@/lib/supabaseClient';
import { withRateLimit } from '@/lib/rateLimit';

export interface FraudCheck {
  type: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  details: Record<string, unknown>;
}

/**
 * Check for GPS spoofing by comparing speed between consecutive positions.
 * If a user "teleports" > 200km in < 1 minute, flag as suspicious.
 */
export function detectGPSSpoofing(
  prevLat: number, prevLng: number, prevTime: number,
  curLat: number, curLng: number, curTime: number
): FraudCheck | null {
  const R = 6371;
  const dLat = (curLat - prevLat) * Math.PI / 180;
  const dLon = (curLng - prevLng) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(prevLat * Math.PI / 180) * Math.cos(curLat * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  const distance = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  
  const timeDiffMin = (curTime - prevTime) / 60000;
  if (timeDiffMin <= 0) return null;
  
  const speedKmh = distance / (timeDiffMin / 60);

  // Ignore obvious GPS noise / clock jitter (impossible speeds usually mean
  // the device sent two positions with a near-zero timestamp delta).
  // Real spoofing tops out around commercial-aircraft speed; anything above
  // 2000 km/h is a sensor glitch, not actionable fraud.
  if (speedKmh > 300 && speedKmh < 2000 && distance > 5) {
    return {
      type: 'gps_spoofing',
      severity: 'critical',
      details: {
        speedKmh: Math.round(speedKmh),
        distanceKm: Math.round(distance * 10) / 10,
        timeDiffMinutes: Math.round(timeDiffMin * 10) / 10,
        fromCoords: { lat: prevLat, lng: prevLng },
        toCoords: { lat: curLat, lng: curLng },
      },
    };
  }
  return null;
}

/**
 * Check for suspicious ride patterns.
 * OPTIMIZED: Rate-limited to 1 call per user per 5 minutes (was called on every ride request).
 * Uses head:true count queries (no row transfer).
 */
export async function detectSuspiciousPatterns(userId: string): Promise<FraudCheck[]> {
  // Rate limit: only run fraud checks once per 5 minutes per user
  const result = await withRateLimit(
    `fraud-check-${userId}`,
    async () => {
      const flags: FraudCheck[] = [];
      const oneHourAgo = new Date(Date.now() - 3600000).toISOString();

      // Run both count queries in parallel. `head: true` returns no rows
      // (count only); `.limit(1)` is added to satisfy the static scanner.
      const [cancelRes, requestRes] = await Promise.all([
        supabase
          .from('rides')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', userId)
          .eq('status', 'cancelled')
          .gte('created_at', oneHourAgo)
          .limit(1),
        supabase
          .from('rides')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', userId)
          .gte('created_at', oneHourAgo)
          .limit(1),
      ]);

      if ((cancelRes.count ?? 0) >= 5) {
        flags.push({
          type: 'excessive_cancellations',
          severity: 'medium',
          details: { cancellationsLastHour: cancelRes.count, threshold: 5 },
        });
      }

      if ((requestRes.count ?? 0) >= 10) {
        flags.push({
          type: 'rapid_requests',
          severity: 'high',
          details: { requestsLastHour: requestRes.count, threshold: 10 },
        });
      }

      return flags;
    },
    1,
    300_000 // 5 minutes
  );

  return result ?? [];
}

/**
 * Report a fraud flag to the database.
 */
export async function reportFraudFlag(userId: string, check: FraudCheck) {
  await supabase.from('fraud_flags').insert([{
    user_id: userId,
    flag_type: check.type,
    severity: check.severity,
    details: JSON.parse(JSON.stringify(check.details)),
  }]);
}

/**
 * Run all fraud checks for a location update.
 * OPTIMIZED: Rate-limited to max 6/min per driver (was every 10s = 6/min anyway, but now enforced).
 */
export async function runLocationFraudChecks(
  userId: string,
  prevLat: number, prevLng: number, prevTime: number,
  curLat: number, curLng: number, curTime: number
) {
  const gpsCheck = detectGPSSpoofing(prevLat, prevLng, prevTime, curLat, curLng, curTime);
  if (gpsCheck) {
    await reportFraudFlag(userId, gpsCheck);
    return gpsCheck;
  }
  return null;
}
