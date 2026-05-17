import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabaseClient';
import AdminGuard from '@/components/admin/AdminGuard';
import {
  getRamzAction,
  countRecentOtpFailures,
  countFatiguedDrivers,
  avgSosResponseMinutes,
} from '@/lib/ramzActions';
import { Wrench, Loader2, Heart, Radio } from 'lucide-react';
import AdminLayout from '@/components/admin/AdminLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  RefreshCw, AlertTriangle, CheckCircle2, Clock, Zap, Activity,
  Database, Shield, Bug, Server, Users, Gauge, Eye, Bot,
  MapPin, Phone, Navigation, CreditCard, Smartphone, Volume2, Archive,
  Copy, Check
} from 'lucide-react';
import { format, subHours, subDays } from 'date-fns';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid } from 'recharts';
import { toast } from 'sonner';
import { uuid } from '@/lib/uuid';
import MapsDebugPanel from '@/components/admin/MapsDebugPanel';
import RamzCodeScanPanel from '@/components/admin/RamzCodeScanPanel';
import LoadPulsePanel from '@/components/admin/LoadPulsePanel';
import UserIncidentsPanel from '@/components/admin/UserIncidentsPanel';
import { generateLovablePrompt } from '@/lib/ramzPrompt';

interface HealthCheck {
  id: string;
  category: 'error' | 'performance' | 'security' | 'database' | 'suggestion' | 'ui' | 'map' | 'driver';
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  title: string;
  description: string;
  suggestion: string;
  timestamp: string;
  affectedUsers?: number;
  context?: string;
  /** When true, this is an operational stat (pending/incomplete counts), not a technical error. */
  isStat?: boolean;
}

// IDs that represent everyday operational counts (pending drivers/riders/rides,
// approvals, deposits, cancellations) — these are NOT system errors. They are
// surfaced in the "PickMe Daily Stats" section instead.
const STAT_FINDING_IDS = new Set<string>([
  'stale-rides',
  'low-balance-drivers',
  'old-disputes',
  'pending-drivers',
  'high-cancel-rate',
  'no-driver-response',
  'stuck-accepted-rides',
  'pending-deposits',
  'rider-pending-deposits',
  'pending-documents',
]);

interface PerformanceMetric {
  label: string;
  value: number;
  unit: string;
  status: 'good' | 'warn' | 'critical';
  threshold: { warn: number; critical: number };
}

interface ErrorLog {
  id: string;
  error_type: string;
  severity: string;
  title: string;
  description: string;
  suggestion: string | null;
  affected_users: number;
  context: string | null;
  resolved: boolean;
  period: string;
  created_at: string;
}

const SEVERITY_COLORS: Record<string, string> = {
  critical: 'bg-red-500/10 text-red-600 border-red-500/20',
  high: 'bg-orange-500/10 text-orange-600 border-orange-500/20',
  medium: 'bg-amber-500/10 text-amber-600 border-amber-500/20',
  low: 'bg-blue-500/10 text-blue-600 border-blue-500/20',
  info: 'bg-muted text-muted-foreground border-border',
};

const CATEGORY_ICONS: Record<string, typeof Bug> = {
  error: Bug,
  performance: Gauge,
  security: Shield,
  database: Database,
  suggestion: Zap,
  ui: Smartphone,
  map: MapPin,
  driver: Navigation,
};

export default function AdminSystemHealth() {
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [lastScan, setLastScan] = useState<string | null>(null);
  const [checks, setChecks] = useState<HealthCheck[]>([]);
  const [metrics, setMetrics] = useState<PerformanceMetric[]>([]);
  const [errorTimeline, setErrorTimeline] = useState<{ hour: string; errors: number; completed: number }[]>([]);
  const [filter, setFilter] = useState<string>('all');
  const [logTab, setLogTab] = useState<string>('today');
  const [errorLogs, setErrorLogs] = useState<ErrorLog[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [autoRescan, setAutoRescan] = useState(true);
  const [realtimeOn, setRealtimeOn] = useState(false);
  const navigate = useNavigate();
  const lastSosIdRef = useRef<string | null>(null);

  // Load persisted error logs
  const loadErrorLogs = useCallback(async (period: string) => {
    setLogsLoading(true);
    try {
      const { data } = await supabase
        .from('system_error_logs')
        .select('*')
        .eq('period', period)
        .order('created_at', { ascending: false })
        .limit(100);
      setErrorLogs((data as ErrorLog[]) || []);
    } catch {
      setErrorLogs([]);
    } finally {
      setLogsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadErrorLogs(logTab);
  }, [logTab, loadErrorLogs]);

  // Persist findings to DB
  const persistFindings = useCallback(async (findings: HealthCheck[]) => {
    const scanId = uuid();
    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);

    // Move old "today" entries to "week" if they're from previous days
    await supabase
      .from('system_error_logs')
      .update({ period: 'week', updated_at: new Date().toISOString() } as any)
      .eq('period', 'today')
      .lt('created_at', todayStart.toISOString());

    // Insert new findings — operational stats are NOT persisted as errors.
    const rows = findings
      .filter(f => f.severity !== 'info' && !f.isStat)
      .map(f => ({
        error_type: f.category,
        severity: f.severity,
        title: f.title,
        description: f.description,
        suggestion: f.suggestion,
        affected_users: f.affectedUsers || 0,
        context: f.context || null,
        period: 'today',
        scan_id: scanId,
      }));

    if (rows.length > 0) {
      await supabase.from('system_error_logs').insert(rows);
    }
  }, []);

  const runSystemScan = useCallback(async () => {
    setScanning(true);
    const findings: HealthCheck[] = [];
    const now = new Date();

    try {
      // === CORE CHECKS ===

      // 1. Stale pending rides
      const thirtyMinAgo = subHours(now, 0.5).toISOString();
      const { count: staleCount } = await supabase
        .from('rides')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending')
        .lt('created_at', thirtyMinAgo);

      if (staleCount && staleCount > 0) {
        findings.push({
          id: 'stale-rides',
          category: 'database',
          severity: staleCount > 10 ? 'high' : 'medium',
          title: `${staleCount} stale pending rides detected`,
          description: `Rides stuck in "pending" for 30+ min. Expiry trigger may not be firing.`,
          suggestion: 'Run expire_old_rides() or check the ride expiry trigger.',
          timestamp: now.toISOString(),
          affectedUsers: staleCount,
          context: 'Riders requesting rides → ride stays pending indefinitely',
        });
      }

      // 2. Low wallet drivers
      const { count: lowBalCount } = await supabase
        .from('driver_wallets')
        .select('driver_id', { count: 'exact', head: true })
        .lt('balance_usd', 0.5);

      if (lowBalCount && lowBalCount > 0) {
        findings.push({
          id: 'low-balance-drivers',
          category: 'driver',
          severity: lowBalCount > 5 ? 'high' : 'low',
          title: `${lowBalCount} drivers with insufficient balance`,
          description: `Drivers below $0.50 can't accept rides after trial ends.`,
          suggestion: 'Send deposit reminders or review minimum balance threshold.',
          timestamp: now.toISOString(),
          affectedUsers: lowBalCount,
          context: 'Driver tries to go online → blocked by low balance',
        });
      }

      // 3. Unresolved SOS
      const { count: unresolvedAlerts } = await supabase
        .from('emergency_alerts')
        .select('id', { count: 'exact', head: true })
        .eq('resolved', false);

      if (unresolvedAlerts && unresolvedAlerts > 0) {
        findings.push({
          id: 'unresolved-sos',
          category: 'security',
          severity: 'critical',
          title: `🆘 ${unresolvedAlerts} unresolved SOS alerts!`,
          description: `Emergency alerts not addressed. User safety at risk.`,
          suggestion: 'IMMEDIATELY review all emergency alerts and contact affected users.',
          timestamp: now.toISOString(),
          affectedUsers: unresolvedAlerts,
          context: 'User pressed SOS button during ride',
        });
      }

      // 4. Old disputes
      const oneDayAgo = subDays(now, 1).toISOString();
      const { count: oldDisputes } = await supabase
        .from('disputes')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'open')
        .lt('created_at', oneDayAgo);

      if (oldDisputes && oldDisputes > 0) {
        findings.push({
          id: 'old-disputes',
          category: 'suggestion',
          severity: 'medium',
          title: `${oldDisputes} disputes open 24+ hours`,
          description: `Users waiting for resolution. Slow response hurts trust.`,
          suggestion: 'Prioritize dispute resolution. Set up auto-escalation for 12h+ disputes.',
          timestamp: now.toISOString(),
          affectedUsers: oldDisputes,
          context: 'Rider/driver filed dispute → no admin response',
        });
      }

      // 5. Fraud flags
      const { count: unresolvedFraud } = await supabase
        .from('fraud_flags')
        .select('id', { count: 'exact', head: true })
        .eq('resolved', false);

      if (unresolvedFraud && unresolvedFraud > 0) {
        findings.push({
          id: 'fraud-flags',
          category: 'security',
          severity: unresolvedFraud > 3 ? 'high' : 'medium',
          title: `${unresolvedFraud} unresolved fraud flags`,
          description: `Potential fraudulent activity not yet reviewed.`,
          suggestion: 'Review fraud flags for GPS spoofing and suspicious ride patterns.',
          timestamp: now.toISOString(),
          context: 'System auto-detected suspicious activity',
        });
      }

      // 6. Pending driver approvals
      const { count: pendingDrivers } = await supabase
        .from('drivers')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending');

      if (pendingDrivers && pendingDrivers > 3) {
        findings.push({
          id: 'pending-drivers',
          category: 'driver',
          severity: pendingDrivers > 10 ? 'high' : 'low',
          title: `${pendingDrivers} drivers waiting for approval`,
          description: `Slow approvals reduce driver supply and platform growth.`,
          suggestion: 'Batch approve drivers with complete documentation.',
          timestamp: now.toISOString(),
          context: 'New driver registered → waiting for admin approval',
        });
      }

      // 7. High cancellation rate
      const { count: totalRides24h } = await supabase
        .from('rides')
        .select('id', { count: 'exact', head: true })
        .gte('created_at', oneDayAgo);

      const { count: cancelledRides24h } = await supabase
        .from('rides')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'cancelled')
        .gte('created_at', oneDayAgo);

      if (totalRides24h && cancelledRides24h && totalRides24h > 5) {
        const cancelRate = (cancelledRides24h / totalRides24h) * 100;
        if (cancelRate > 30) {
          findings.push({
            id: 'high-cancel-rate',
            category: 'performance',
            severity: cancelRate > 50 ? 'critical' : 'high',
            title: `${cancelRate.toFixed(0)}% cancellation rate (24h)`,
            description: `${cancelledRides24h}/${totalRides24h} rides cancelled. Abnormally high.`,
            suggestion: 'Investigate pricing, driver ETAs, and matching algorithm efficiency.',
            timestamp: now.toISOString(),
            affectedUsers: cancelledRides24h,
            context: 'Riders/drivers cancelling rides at high rate',
          });
        }
      }

      // 8. Rides with zero offers
      const twoHoursAgo = subHours(now, 2).toISOString();
      const { data: noOfferRides } = await supabase
        .from('rides')
        .select('id')
        .in('status', ['expired', 'cancelled'])
        .gte('created_at', twoHoursAgo)
        .limit(100);

      if (noOfferRides && noOfferRides.length > 0) {
        const rideIds = noOfferRides.map(r => r.id);
        const { data: offersForRides } = await supabase
          .from('offers')
          .select('ride_id')
          .in('ride_id', rideIds);

        const ridesWithOffers = new Set(offersForRides?.map(o => o.ride_id) || []);
        const zeroOfferCount = rideIds.filter(id => !ridesWithOffers.has(id)).length;

        if (zeroOfferCount > 3) {
          findings.push({
            id: 'no-driver-response',
            category: 'performance',
            severity: zeroOfferCount > 10 ? 'high' : 'medium',
            title: `${zeroOfferCount} rides with zero driver offers (2h)`,
            description: `Riders requested rides but no drivers responded. Supply-demand imbalance.`,
            suggestion: 'Check online driver count. Expand service area or adjust pricing.',
            timestamp: now.toISOString(),
            affectedUsers: zeroOfferCount,
            context: 'Rider opens app → requests ride → no driver responds → ride expires',
          });
        }
      }

      // 9. Old messages cleanup
      const { count: oldMessages } = await supabase
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .lt('created_at', subDays(now, 7).toISOString());

      if (oldMessages && oldMessages > 1000) {
        findings.push({
          id: 'message-cleanup',
          category: 'database',
          severity: 'low',
          title: `${oldMessages} old messages need cleanup`,
          description: `Chat messages 7+ days old slowing queries and increasing storage.`,
          suggestion: 'Run cleanup_old_messages() or set up a cron job.',
          timestamp: now.toISOString(),
        });
      }

      // 10. Stale GPS for online drivers
      const fiveMinAgo = subHours(now, 5 / 60).toISOString();
      const { data: onlineDrivers } = await supabase
        .from('drivers')
        .select('id, user_id')
        .eq('status', 'approved')
        .eq('is_online', true);

      if (onlineDrivers && onlineDrivers.length > 0) {
        const userIds = onlineDrivers.map(d => d.user_id);
        const { data: locations } = await supabase
          .from('live_locations')
          .select('user_id, updated_at')
          .in('user_id', userIds);

        const staleDrivers = onlineDrivers.filter(d => {
          const loc = locations?.find(l => l.user_id === d.user_id);
          return !loc || new Date(loc.updated_at) < new Date(fiveMinAgo);
        });

        if (staleDrivers.length > 0) {
          findings.push({
            id: 'stale-driver-locations',
            category: 'map',
            severity: 'medium',
            title: `${staleDrivers.length} online drivers with stale GPS`,
            description: `Drivers show online but no GPS updates for 5+ min. Poor connectivity or app crash.`,
            suggestion: 'Auto-set offline after 5 min of no GPS. Check driver app stability.',
            timestamp: now.toISOString(),
            affectedUsers: staleDrivers.length,
            context: 'Driver app → GPS stops sending → rider sees ghost driver on map',
          });
        }
      }

      // === NEW: UI / MAP / DRIVER-SPECIFIC CHECKS ===

      // 11. Check for rides where map data might have failed (no route_polyline)
      const { count: noRouteRides } = await supabase
        .from('rides')
        .select('id', { count: 'exact', head: true })
        .is('route_polyline', null)
        .gte('created_at', oneDayAgo)
        .in('status', ['pending', 'accepted', 'in_progress', 'completed']);

      if (noRouteRides && noRouteRides > 5) {
        findings.push({
          id: 'map-route-failures',
          category: 'map',
          severity: noRouteRides > 20 ? 'critical' : 'high',
          title: `🗺️ ${noRouteRides} rides missing route data`,
          description: `Maps failed to generate route polyline. Users may see blank maps or no route display.`,
          suggestion: 'Check Google Maps API key quota and billing. Verify OSRM fallback is working. Review network connectivity.',
          timestamp: now.toISOString(),
          affectedUsers: noRouteRides,
          context: 'Rider requests ride → map tries to load route → API fails → no route shown',
        });
      }

      // 12. Check for call session failures
      const { data: recentCalls } = await supabase
        .from('call_sessions')
        .select('id, status, started_at, ended_at')
        .gte('created_at', oneDayAgo)
        .limit(100);

      if (recentCalls) {
        const failedCalls = recentCalls.filter(c => c.status === 'failed' || (!c.started_at && c.ended_at));
        if (failedCalls.length > 2) {
          findings.push({
            id: 'call-failures',
            category: 'ui',
            severity: failedCalls.length > 10 ? 'critical' : 'high',
            title: `📞 ${failedCalls.length} failed calls today`,
            description: `Voice calls between riders and drivers are failing. Communication breakdown.`,
            suggestion: 'Check Agora token generation. Verify AGORA_APP_ID and AGORA_APP_CERT secrets. Test WebRTC connectivity.',
            timestamp: now.toISOString(),
            affectedUsers: failedCalls.length * 2,
            context: 'Rider/driver taps call button → call fails to connect or drops immediately',
          });
        }
      }

      // 13. Check for rides that got stuck in "accepted" too long (driver not moving)
      const { count: stuckAccepted } = await supabase
        .from('rides')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'accepted')
        .lt('updated_at', subHours(now, 1).toISOString());

      if (stuckAccepted && stuckAccepted > 0) {
        findings.push({
          id: 'stuck-accepted-rides',
          category: 'driver',
          severity: stuckAccepted > 5 ? 'critical' : 'high',
          title: `🚗 ${stuckAccepted} rides stuck in "accepted" 1+ hour`,
          description: `Driver accepted but ride never progressed. Driver may have app issues or abandoned ride.`,
          suggestion: 'Force-cancel these rides and notify riders. Check if driver app navigation is working.',
          timestamp: now.toISOString(),
          affectedUsers: stuckAccepted * 2,
          context: 'Driver accepts ride → never starts driving → rider waiting indefinitely',
        });
      }

      // 14. Check for deposit requests pending > 2 hours
      const { count: pendingDeposits } = await supabase
        .from('deposit_requests')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending')
        .lt('created_at', subHours(now, 2).toISOString());

      if (pendingDeposits && pendingDeposits > 0) {
        findings.push({
          id: 'pending-deposits',
          category: 'ui',
          severity: pendingDeposits > 5 ? 'high' : 'medium',
          title: `💳 ${pendingDeposits} driver deposits pending 2+ hours`,
          description: `Drivers deposited money but admin hasn't approved. Drivers can't operate.`,
          suggestion: 'Approve pending deposits in the Admin Deposits page.',
          timestamp: now.toISOString(),
          affectedUsers: pendingDeposits,
          context: 'Driver deposits via EcoCash → waits for approval → can\'t accept rides',
        });
      }

      // 15. Check rider deposit requests pending
      const { count: riderPendingDeposits } = await supabase
        .from('rider_deposit_requests')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending')
        .lt('created_at', subHours(now, 2).toISOString());

      if (riderPendingDeposits && riderPendingDeposits > 0) {
        findings.push({
          id: 'rider-pending-deposits',
          category: 'ui',
          severity: riderPendingDeposits > 5 ? 'high' : 'medium',
          title: `💰 ${riderPendingDeposits} rider deposits pending 2+ hours`,
          description: `Riders deposited but admin hasn't approved. Riders can't pay for rides.`,
          suggestion: 'Approve pending rider deposits in Admin Rider Deposits page.',
          timestamp: now.toISOString(),
          affectedUsers: riderPendingDeposits,
          context: 'Rider deposits wallet funds → waits for approval → can\'t book ride',
        });
      }

      // 16. Check for pending documents (driver verification bottleneck)
      const { count: pendingDocs } = await supabase
        .from('driver_documents')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending');

      if (pendingDocs && pendingDocs > 5) {
        findings.push({
          id: 'pending-documents',
          category: 'driver',
          severity: pendingDocs > 20 ? 'high' : 'medium',
          title: `📄 ${pendingDocs} driver documents awaiting review`,
          description: `Document verification backlog. Drivers can't get approved without document review.`,
          suggestion: 'Use batch approval in Driver management. Review documents promptly to grow driver fleet.',
          timestamp: now.toISOString(),
          affectedUsers: pendingDocs,
          context: 'Driver uploads documents → waits for review → can\'t start driving',
        });
      }

      // === PICKME-SPECIFIC SCANS ===

      // 17. Africa's Talking OTP failures (24h)
      const otpFailures = await countRecentOtpFailures();
      if (otpFailures > 5) {
        findings.push({
          id: 'otp-failures',
          category: 'security',
          severity: otpFailures > 25 ? 'critical' : 'high',
          title: `📱 ${otpFailures} OTP verifications failed (24h)`,
          description: 'Phone numbers exhausted all 3 attempts without verifying. Likely SMS delivery or Africa\'s Talking issue.',
          suggestion: 'Check Africa\'s Talking sender ID, account balance, and twilio-otp edge function logs.',
          timestamp: now.toISOString(),
          affectedUsers: otpFailures,
          context: 'New user enters phone → never receives SMS → can\'t sign up',
        });
      }

      // 18. Driver fatigue overrun (12h limit per PickMe rules)
      const fatigued = await countFatiguedDrivers();
      if (fatigued > 0) {
        findings.push({
          id: 'fatigue-overrun',
          category: 'driver',
          severity: fatigued > 3 ? 'critical' : 'high',
          title: `🥱 ${fatigued} driver${fatigued > 1 ? 's' : ''} online >12h (fatigue limit)`,
          description: 'PickMe enforces a 12h active limit. These drivers must take a mandatory rest break.',
          suggestion: 'Force-offline and impose a 6h cool-down. Notify the driver via push.',
          timestamp: now.toISOString(),
          affectedUsers: fatigued,
          context: 'Driver stays online past 12h → safety risk → fatigue accidents',
        });
      }

      // 18b. Stale GPS rows (live_locations grows fastest, hurts capacity)
      const oneHrAgo = subHours(now, 1).toISOString();
      const { count: staleLocs } = await supabase
        .from('live_locations')
        .select('user_id', { count: 'exact', head: true })
        .lt('updated_at', oneHrAgo);
      if (staleLocs && staleLocs > 100) {
        findings.push({
          id: 'stale-live-locations',
          category: 'performance',
          severity: staleLocs > 1000 ? 'high' : 'medium',
          title: `🛰️ ${staleLocs} stale GPS rows in live_locations`,
          description: 'Old GPS rows accumulate and slow down driver-nearby queries that run on every ride request.',
          suggestion: 'Purge rows older than 1h. Drivers will repopulate on their next location ping.',
          timestamp: now.toISOString(),
          affectedUsers: staleLocs,
          context: 'Rider requests ride → driver-nearby query scans bloated table → slow match',
        });
      }

      // 19. SOS response time SLA (admin must acknowledge within 5min)
      const sosAvg = await avgSosResponseMinutes();
      if (sosAvg !== null && sosAvg > 5) {
        findings.push({
          id: 'slow-sos-response',
          category: 'security',
          severity: sosAvg > 30 ? 'critical' : 'high',
          title: `⏱️ Avg SOS response: ${sosAvg} min (target ≤5 min)`,
          description: 'Admin team is acknowledging emergency alerts too slowly. Riders/drivers are at risk during the gap.',
          suggestion: 'Set up on-call paging, push to admin device, and a 5-min auto-escalation.',
          timestamp: now.toISOString(),
          context: 'Rider presses SOS → admin notified → ack takes too long',
        });
      }

      // All clear
      if (findings.length === 0) {
        findings.push({
          id: 'all-clear',
          category: 'suggestion',
          severity: 'info',
          title: '✅ All systems healthy — Ramz One found no issues',
          description: 'No critical issues detected during this scan.',
          suggestion: 'Continue monitoring. Next scan will check for new issues.',
          timestamp: now.toISOString(),
        });
      }

      // Build metrics
      const perfMetrics: PerformanceMetric[] = [
        {
          label: 'Online Drivers',
          value: onlineDrivers?.length || 0,
          unit: 'drivers',
          status: (onlineDrivers?.length || 0) >= 3 ? 'good' : (onlineDrivers?.length || 0) >= 1 ? 'warn' : 'critical',
          threshold: { warn: 3, critical: 1 },
        },
        {
          label: 'Cancel Rate',
          value: totalRides24h && cancelledRides24h ? Math.round((cancelledRides24h / totalRides24h) * 100) : 0,
          unit: '%',
          status: totalRides24h && cancelledRides24h
            ? (cancelledRides24h / totalRides24h) > 0.5 ? 'critical' : (cancelledRides24h / totalRides24h) > 0.3 ? 'warn' : 'good'
            : 'good',
          threshold: { warn: 30, critical: 50 },
        },
        {
          label: 'Pending Approvals',
          value: pendingDrivers || 0,
          unit: 'drivers',
          status: (pendingDrivers || 0) > 10 ? 'critical' : (pendingDrivers || 0) > 3 ? 'warn' : 'good',
          threshold: { warn: 3, critical: 10 },
        },
        {
          label: 'Open Disputes',
          value: oldDisputes || 0,
          unit: 'disputes',
          status: (oldDisputes || 0) > 5 ? 'critical' : (oldDisputes || 0) > 0 ? 'warn' : 'good',
          threshold: { warn: 1, critical: 5 },
        },
      ];

      // Build 24h timeline
      const timeline: { hour: string; errors: number; completed: number }[] = [];
      for (let i = 23; i >= 0; i--) {
        const hourStart = subHours(now, i + 1);
        const hourEnd = subHours(now, i);
        const [{ count: cancelledH }, { count: completedH }] = await Promise.all([
          supabase.from('rides').select('id', { count: 'exact', head: true })
            .in('status', ['cancelled', 'expired']).gte('created_at', hourStart.toISOString()).lt('created_at', hourEnd.toISOString()),
          supabase.from('rides').select('id', { count: 'exact', head: true })
            .eq('status', 'completed').gte('created_at', hourStart.toISOString()).lt('created_at', hourEnd.toISOString()),
        ]);
        timeline.push({ hour: format(hourEnd, 'HH:mm'), errors: cancelledH || 0, completed: completedH || 0 });
      }

      // Tag operational stat findings (not technical errors).
      for (const f of findings) {
        if (STAT_FINDING_IDS.has(f.id)) {
          f.isStat = true;
        }
      }

      // Sort by severity
      findings.sort((a, b) => {
        const order = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
        return (order[a.severity] ?? 4) - (order[b.severity] ?? 4);
      });

      setChecks(findings);
      setMetrics(perfMetrics);
      setErrorTimeline(timeline);
      setLastScan(now.toISOString());

      // Persist to DB
      await persistFindings(findings);
      await loadErrorLogs(logTab);

      // Alert for critical issues (operational stats are excluded — they're not errors).
      const criticals = findings.filter(f => f.severity === 'critical' && !f.isStat);
      if (criticals.length > 0) {
        toast.error(`🤖 Ramz One: ${criticals.length} CRITICAL issue${criticals.length > 1 ? 's' : ''} found!`, {
          description: criticals[0].title,
          duration: 15000,
        });
        if (navigator.vibrate) navigator.vibrate([300, 100, 300, 100, 300]);
      }

    } catch (err) {
      console.error('Ramz One scan failed:', err);
      setChecks([{
        id: 'scan-error', category: 'error', severity: 'critical',
        title: 'Ramz One scan failed',
        description: `Health check could not complete: ${(err as Error).message}`,
        suggestion: 'Check database connectivity and admin role configuration.',
        timestamp: now.toISOString(),
      }]);
    } finally {
      setScanning(false);
      setLoading(false);
    }
  }, [persistFindings, loadErrorLogs, logTab]);

  useEffect(() => { runSystemScan(); }, [runSystemScan]);

  // Auto-rescan every 60s (background, no spinner takeover)
  useEffect(() => {
    if (!autoRescan) return;
    const id = setInterval(() => { if (!scanning) runSystemScan(); }, 60_000);
    return () => clearInterval(id);
  }, [autoRescan, scanning, runSystemScan]);

  // Realtime SOS pager — subscribe to emergency_alerts inserts
  useEffect(() => {
    const ch = supabase
      .channel('ramz-one-sos-pager')
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'emergency_alerts' },
        (payload) => {
          const row = payload.new as { id: string; user_id: string };
          if (lastSosIdRef.current === row.id) return;
          lastSosIdRef.current = row.id;

          toast.error('🆘 NEW SOS ALERT', {
            description: 'A user just triggered an emergency. Open queue immediately.',
            duration: 30_000,
            action: { label: 'Open', onClick: () => navigate('/admin/emergency-alerts') },
          });
          if (navigator.vibrate) navigator.vibrate([400, 100, 400, 100, 400]);
          try {
            if ('Notification' in window && Notification.permission === 'granted') {
              new Notification('🆘 PickMe SOS', { body: 'New emergency alert — open Ramz One.', tag: 'pickme-sos' });
            }
            // Short alert tone
            const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
            const o = ctx.createOscillator(); const g = ctx.createGain();
            o.frequency.value = 880; o.connect(g); g.connect(ctx.destination);
            g.gain.setValueAtTime(0.18, ctx.currentTime);
            o.start(); o.stop(ctx.currentTime + 0.4);
          } catch { /* noop */ }

          runSystemScan();
        })
      .subscribe((status) => setRealtimeOn(status === 'SUBSCRIBED'));

    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => undefined);
    }

    return () => { void supabase.removeChannel(ch); };
  }, [navigate, runSystemScan]);

  const runFix = useCallback(async (check: HealthCheck) => {
    const action = getRamzAction(check.id);
    if (!action) return;
    if (action.navigateTo) { navigate(action.navigateTo); return; }
    if (action.confirm && !window.confirm(action.confirm)) return;
    try {
      const msg = await action.run();
      toast.success(`✅ ${msg}`);
      await runSystemScan();
    } catch (err) {
      toast.error(`Fix failed: ${(err as Error).message}`);
    }
  }, [navigate, runSystemScan]);


  // Split operational stats from technical errors so pending/incomplete
  // counts don't appear as "errors" in the system health view.
  const dailyStats = checks.filter(c => c.isStat);
  const issueChecks = checks.filter(c => !c.isStat);
  const filteredChecks = filter === 'all' ? issueChecks : issueChecks.filter(c => c.category === filter);
  const criticalCount = issueChecks.filter(c => c.severity === 'critical').length;
  const highCount = issueChecks.filter(c => c.severity === 'high').length;
  const totalIssues = issueChecks.filter(c => c.severity !== 'info').length;

  const STATUS_COLORS = { good: 'text-emerald-600', warn: 'text-amber-600', critical: 'text-red-600' };
  const STATUS_BG = { good: 'bg-emerald-500/10', warn: 'bg-amber-500/10', critical: 'bg-red-500/10' };

  const categories = ['all', 'error', 'map', 'ui', 'driver', 'performance', 'security', 'database', 'suggestion'];

  const resolveLog = async (logId: string) => {
    await supabase.from('system_error_logs').update({
      resolved: true, resolved_at: new Date().toISOString(),
    } as any).eq('id', logId);
    toast.success('Issue marked as resolved');
    loadErrorLogs(logTab);
  };

  return (
    <AdminGuard>
      <AdminLayout>
        <div className="space-y-6">
          {/* Live load + capacity forecast (top — most important for scale) */}
          <LoadPulsePanel />

          {/* Named user incidents in the last 24h */}
          <UserIncidentsPanel />

          {/* Maps integration debug panel */}
          <MapsDebugPanel />

          {/* Ramz One Header */}
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center shadow-lg">
                <Bot className="w-7 h-7 text-primary-foreground" />
              </div>
              <div>
                <h1 className="text-2xl font-black text-foreground flex items-center gap-2">
                  Ramz One
                  <Badge variant="outline" className="text-[10px] font-mono bg-primary/10 text-primary border-primary/20">
                    AGENT
                  </Badge>
                </h1>
                <p className="text-sm text-muted-foreground">
                  System Watchdog • {lastScan ? `Last scan: ${format(new Date(lastScan), 'HH:mm:ss')}` : 'Initializing…'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="outline" className={`gap-1.5 ${realtimeOn ? 'bg-emerald-500/10 text-emerald-700 border-emerald-500/30' : 'bg-muted text-muted-foreground'}`}>
                <Radio className={`w-3 h-3 ${realtimeOn ? 'animate-pulse' : ''}`} /> {realtimeOn ? 'Realtime' : 'Offline'}
              </Badge>
              <Badge variant="outline" className={`gap-1.5 cursor-pointer ${autoRescan ? 'bg-primary/10 text-primary border-primary/30' : 'bg-muted text-muted-foreground'}`}
                onClick={() => setAutoRescan(v => !v)}>
                <Heart className={`w-3 h-3 ${autoRescan ? 'animate-pulse' : ''}`} /> Auto-scan {autoRescan ? '60s' : 'off'}
              </Badge>
              <Button onClick={runSystemScan} disabled={scanning} className="font-bold gap-2">
                <RefreshCw className={`w-4 h-4 ${scanning ? 'animate-spin' : ''}`} />
                {scanning ? 'Scanning…' : 'Run Full Scan'}
              </Button>
            </div>
          </div>

          {/* Status Banner */}
          <Card className={criticalCount > 0 ? 'border-red-500/30 bg-red-500/5' : highCount > 0 ? 'border-amber-500/30 bg-amber-500/5' : 'border-emerald-500/30 bg-emerald-500/5'}>
            <CardContent className="pt-4">
              <div className="flex items-center gap-4">
                {criticalCount > 0 ? (
                  <div className="w-12 h-12 rounded-2xl bg-red-500/10 flex items-center justify-center animate-pulse">
                    <AlertTriangle className="w-6 h-6 text-red-600" />
                  </div>
                ) : highCount > 0 ? (
                  <div className="w-12 h-12 rounded-2xl bg-amber-500/10 flex items-center justify-center">
                    <AlertTriangle className="w-6 h-6 text-amber-600" />
                  </div>
                ) : (
                  <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 flex items-center justify-center">
                    <CheckCircle2 className="w-6 h-6 text-emerald-600" />
                  </div>
                )}
                <div>
                  <p className="text-lg font-bold text-foreground">
                    {criticalCount > 0
                      ? `🚨 ${criticalCount} Critical Issue${criticalCount > 1 ? 's' : ''} — Immediate Action Required`
                      : highCount > 0
                      ? `⚠️ ${highCount} Issue${highCount > 1 ? 's' : ''} Need Attention`
                      : '✅ All Systems Healthy'}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Ramz One scanned {checks.length} areas • {totalIssues} finding{totalIssues !== 1 ? 's' : ''}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Metrics */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {metrics.map(m => (
              <Card key={m.label}>
                <CardContent className="pt-4">
                  <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-xl ${STATUS_BG[m.status]}`}>
                      <Gauge className={`h-5 w-5 ${STATUS_COLORS[m.status]}`} />
                    </div>
                    <div>
                      <p className={`text-2xl font-black ${STATUS_COLORS[m.status]}`}>
                        {m.value}<span className="text-sm font-medium text-muted-foreground ml-1">{m.unit}</span>
                      </p>
                      <p className="text-xs text-muted-foreground">{m.label}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* 24h Timeline */}
          {errorTimeline.length > 0 && (
            <Card>
              <CardContent className="pt-4">
                <h2 className="font-bold text-sm flex items-center gap-2 mb-3">
                  <Clock className="h-4 w-4 text-primary" />
                  24h Ride Activity (Failed vs Completed)
                </h2>
                <ChartContainer config={{
                  errors: { label: 'Cancelled/Expired', color: 'hsl(0 84% 60%)' },
                  completed: { label: 'Completed', color: 'hsl(142 76% 36%)' },
                }} className="h-48 w-full">
                  <AreaChart data={errorTimeline} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border/30" />
                    <XAxis dataKey="hour" tick={{ fontSize: 10 }} interval={3} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Area type="monotone" dataKey="completed" fill="hsl(142 76% 36% / 0.2)" stroke="hsl(142 76% 36%)" name="Completed" />
                    <Area type="monotone" dataKey="errors" fill="hsl(0 84% 60% / 0.2)" stroke="hsl(0 84% 60%)" name="Cancelled/Expired" />
                  </AreaChart>
                </ChartContainer>
              </CardContent>
            </Card>
          )}

          {/* PickMe Daily Stats — operational counts (pending drivers/riders/rides,
              cancellations, deposits awaiting approval). These are NOT system errors. */}
          <div>
            <h2 className="font-bold text-lg flex items-center gap-2 mb-3">
              <Activity className="h-5 w-5 text-primary" />
              PickMe Daily Stats
              <Badge variant="outline" className="text-[10px] font-mono bg-primary/10 text-primary border-primary/20">
                OPERATIONAL
              </Badge>
            </h2>
            {dailyStats.length === 0 ? (
              <Card>
                <CardContent className="pt-6 pb-6 text-center">
                  <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto mb-2" />
                  <p className="font-bold text-sm text-foreground">No pending operational items right now</p>
                  <p className="text-xs text-muted-foreground">Drivers, riders, rides and deposits are all up to date.</p>
                </CardContent>
              </Card>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {dailyStats.map(stat => {
                  const Icon = CATEGORY_ICONS[stat.category] || Activity;
                  return (
                    <Card key={stat.id} className="border-primary/10">
                      <CardContent className="pt-4">
                        <div className="flex items-start gap-3">
                          <div className="p-2 rounded-xl shrink-0 bg-primary/10">
                            <Icon className="h-5 w-5 text-primary" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap mb-1">
                              <p className="font-bold text-sm text-foreground">{stat.title}</p>
                              {stat.affectedUsers !== undefined && (
                                <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                                  <Users className="w-3 h-3" /> {stat.affectedUsers}
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground mb-2">{stat.description}</p>
                            <p className="text-[11px] text-foreground/80">{stat.suggestion}</p>
                            <FixNowButton check={stat} onFix={runFix} />
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </div>

          {/* Live Scan Findings */}
          <div>
            <h2 className="font-bold text-lg flex items-center gap-2 mb-3">
              <Eye className="h-5 w-5 text-primary" />
              Live Scan Findings
            </h2>

            <div className="flex gap-2 flex-wrap mb-4">
              {categories.map(cat => (
                <Button
                  key={cat}
                  size="sm"
                  variant={filter === cat ? 'default' : 'outline'}
                  onClick={() => setFilter(cat)}
                  className="capitalize font-semibold text-xs"
                >
                  {cat === 'all' ? `All (${issueChecks.length})` : `${cat} (${issueChecks.filter(c => c.category === cat).length})`}
                </Button>
              ))}
            </div>

            <div className="space-y-3">
              {loading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <Card key={i}>
                    <CardContent className="pt-4">
                      <div className="animate-pulse space-y-2">
                        <div className="h-4 bg-muted rounded w-2/3" />
                        <div className="h-3 bg-muted rounded w-full" />
                        <div className="h-3 bg-muted rounded w-4/5" />
                      </div>
                    </CardContent>
                  </Card>
                ))
              ) : filteredChecks.length === 0 ? (
                <Card>
                  <CardContent className="pt-6 pb-6 text-center">
                    <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto mb-2" />
                    <p className="font-bold text-foreground">No issues in this category</p>
                  </CardContent>
                </Card>
              ) : (
                filteredChecks.map(check => {
                  const Icon = CATEGORY_ICONS[check.category] || Bug;
                  return (
                    <Card key={check.id} className={check.severity === 'critical' ? 'border-red-500/30' : check.severity === 'high' ? 'border-amber-500/30' : ''}>
                      <CardContent className="pt-4">
                        <div className="flex items-start gap-3">
                          <div className={`p-2 rounded-xl shrink-0 ${
                            check.severity === 'critical' ? 'bg-red-500/10' :
                            check.severity === 'high' ? 'bg-orange-500/10' :
                            check.severity === 'medium' ? 'bg-amber-500/10' : 'bg-muted'
                          }`}>
                            <Icon className={`h-5 w-5 ${
                              check.severity === 'critical' ? 'text-red-600' :
                              check.severity === 'high' ? 'text-orange-600' :
                              check.severity === 'medium' ? 'text-amber-600' : 'text-muted-foreground'
                            }`} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap mb-1">
                              <p className="font-bold text-sm text-foreground">{check.title}</p>
                              <Badge variant="outline" className={`text-[10px] ${SEVERITY_COLORS[check.severity]}`}>
                                {check.severity}
                              </Badge>
                              {check.affectedUsers && (
                                <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                                  <Users className="w-3 h-3" /> {check.affectedUsers} affected
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground mb-1">{check.description}</p>
                            {check.context && (
                              <p className="text-[11px] text-muted-foreground/70 italic mb-2">
                                📍 User flow: {check.context}
                              </p>
                            )}
                            <div className="bg-primary/5 border border-primary/10 rounded-lg p-2.5">
                              <p className="text-[11px] font-semibold text-primary flex items-center gap-1 mb-0.5">
                                <Zap className="w-3 h-3" /> Ramz One Suggestion
                              </p>
                              <p className="text-xs text-foreground/80">{check.suggestion}</p>
                            </div>
                            <FixNowButton check={check} onFix={runFix} />
                            <RamzPromptBlock check={check} />
                            <p className="text-[10px] text-muted-foreground mt-1.5">
                              Detected at {format(new Date(check.timestamp), 'HH:mm:ss · MMM d')}
                            </p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })
              )}
            </div>
          </div>

          {/* Ramz One — AI code scan */}
          <RamzCodeScanPanel />

          {/* Error Logs — Today / Week */}
          <div>
            <h2 className="font-bold text-lg flex items-center gap-2 mb-3">
              <Archive className="h-5 w-5 text-primary" />
              Error Log History
            </h2>

            <Tabs value={logTab} onValueChange={setLogTab}>
              <TabsList className="mb-4">
                <TabsTrigger value="today" className="font-bold">Today's Errors</TabsTrigger>
                <TabsTrigger value="week" className="font-bold">This Week (Review)</TabsTrigger>
              </TabsList>

              <TabsContent value={logTab}>
                {logsLoading ? (
                  <Card><CardContent className="pt-4"><div className="animate-pulse h-20 bg-muted rounded" /></CardContent></Card>
                ) : errorLogs.length === 0 ? (
                  <Card>
                    <CardContent className="pt-6 pb-6 text-center">
                      <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto mb-2" />
                      <p className="font-bold text-sm text-foreground">No {logTab === 'today' ? 'errors today' : 'weekly errors to review'}</p>
                      <p className="text-xs text-muted-foreground">Ramz One is watching 👁️</p>
                    </CardContent>
                  </Card>
                ) : (
                  <div className="space-y-2">
                    {errorLogs.map(log => (
                      <Card key={log.id} className={log.resolved ? 'opacity-60' : log.severity === 'critical' ? 'border-red-500/30' : ''}>
                        <CardContent className="pt-3 pb-3">
                          <div className="flex items-center justify-between gap-3">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <p className={`font-bold text-xs ${log.resolved ? 'line-through text-muted-foreground' : 'text-foreground'}`}>
                                  {log.title}
                                </p>
                                <Badge variant="outline" className={`text-[9px] ${SEVERITY_COLORS[log.severity] || ''}`}>
                                  {log.severity}
                                </Badge>
                                <Badge variant="outline" className="text-[9px]">{log.error_type}</Badge>
                                {log.resolved && <Badge className="text-[9px] bg-emerald-500/10 text-emerald-600 border-emerald-500/20">resolved</Badge>}
                              </div>
                              {log.context && <p className="text-[10px] text-muted-foreground mt-0.5">📍 {log.context}</p>}
                              <p className="text-[10px] text-muted-foreground">
                                {format(new Date(log.created_at), 'HH:mm · MMM d')} • {log.affected_users} user{log.affected_users !== 1 ? 's' : ''}
                              </p>
                            </div>
                            {!log.resolved && (
                              <Button size="sm" variant="outline" className="text-xs shrink-0" onClick={() => resolveLog(log.id)}>
                                <CheckCircle2 className="w-3 h-3 mr-1" /> Resolve
                              </Button>
                            )}
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </div>
        </div>
      </AdminLayout>
    </AdminGuard>
  );
}

/**
 * Ramz One — collapsible block that renders a structured, copy-paste-ready
 * Lovable.dev prompt for fixing the finding. Each finding gets its own
 * PROBLEM / ROOT CAUSE / FIX TYPE / LOVABLE PROMPT bundle.
 */
function RamzPromptBlock({ check }: { check: HealthCheck }) {
  const [copied, setCopied] = useState(false);
  const prompt = useMemo(() => generateLovablePrompt(check), [check]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      toast.success('Lovable prompt copied — paste it into chat to apply the fix.');
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error('Could not copy — select the text manually.');
    }
  };

  return (
    <details className="mt-2 group rounded-lg border border-border bg-muted/20 overflow-hidden">
      <summary className="flex items-center justify-between px-2.5 py-1.5 cursor-pointer list-none text-[11px] font-semibold text-foreground hover:bg-muted/40">
        <span className="flex items-center gap-1.5">
          <Bot className="w-3 h-3 text-primary" />
          Lovable-ready fix prompt
        </span>
        <span className="text-[10px] text-muted-foreground group-open:hidden">Show</span>
        <span className="text-[10px] text-muted-foreground hidden group-open:inline">Hide</span>
      </summary>
      <div className="border-t border-border bg-background/60">
        <div className="flex items-center justify-end px-2 py-1.5 border-b border-border/60 bg-muted/30">
          <Button size="sm" variant="ghost" onClick={copy} className="h-6 gap-1 text-[10px] font-semibold">
            {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
            {copied ? 'Copied' : 'Copy prompt'}
          </Button>
        </div>
        <pre className="px-2.5 py-2 text-[10.5px] leading-relaxed font-mono text-foreground/85 whitespace-pre-wrap break-words max-h-72 overflow-auto">
{prompt}
        </pre>
      </div>
    </details>
  );
}

/**
 * FixNowButton — surfaces a one-click remediation when Ramz One has a
 * registered action for this finding. Falls back to "no auto-fix" tag when
 * the issue requires human judgment (e.g. SOS triage, dispute review).
 */
function FixNowButton({ check, onFix }: { check: HealthCheck; onFix: (c: HealthCheck) => Promise<void> }) {
  const action = getRamzAction(check.id);
  const [busy, setBusy] = useState(false);
  if (!action) return null;

  const handle = async () => {
    setBusy(true);
    try { await onFix(check); } finally { setBusy(false); }
  };

  return (
    <Button
      size="sm"
      variant={action.navigateTo ? 'outline' : 'default'}
      className="mt-2 h-8 gap-1.5 text-xs font-semibold"
      onClick={handle}
      disabled={busy}
    >
      {busy
        ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
        : <Wrench className="w-3.5 h-3.5" />}
      {busy ? 'Fixing…' : action.label}
    </Button>
  );
}
