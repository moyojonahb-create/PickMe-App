import { useEffect, useState, useCallback, useMemo } from 'react';
import { RefreshCw, Wallet, Car, Navigation, Users, MapPin, TrendingUp, Clock, Eye, DollarSign, BarChart3, Loader2, AlertCircle } from 'lucide-react';
import { startOfDay, startOfWeek, startOfMonth, isAfter, subDays, format, eachDayOfInterval } from 'date-fns';
import { supabase } from '@/lib/supabaseClient';
import AdminGuard from '@/components/admin/AdminGuard';
import AdminLayout from '@/components/admin/AdminLayout';
import AdminMap from '@/components/admin/AdminMap';
import { useAdminEarnings } from '@/hooks/useWallet';
import AdminEarningsSheet from '@/components/wallet/AdminEarningsSheet';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useNavigate } from 'react-router-dom';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, LineChart, Line } from 'recharts';
import { adminUpdateRow } from '@/lib/businessApi';

interface DriverRow {
  id: string;
  user_id: string;
  vehicle_make: string | null;
  vehicle_model: string | null;
  plate_number: string | null;
  status: string;
  is_online: boolean | null;
  profile?: {
    full_name: string | null;
    phone: string | null;
  };
  location?: {
    latitude: number;
    longitude: number;
    updated_at: string;
  } | null;
}

interface RideRow {
  id: string;
  pickup_address: string;
  dropoff_address: string;
  fare: number;
  status: string;
  created_at: string;
  driver_id: string | null;
}

const statusColors: Record<string, string> = {
  pending: 'bg-amber-500/10 text-amber-600 border-amber-500/20',
  accepted: 'bg-primary/10 text-primary border-primary/20',
  in_progress: 'bg-primary/10 text-primary border-primary/20',
  completed: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20',
  cancelled: 'bg-destructive/10 text-destructive border-destructive/20',
  expired: 'bg-muted text-muted-foreground border-border',
};

const AdminDashboard = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [pendingDrivers, setPendingDrivers] = useState<DriverRow[]>([]);
  const [onlineDrivers, setOnlineDrivers] = useState<DriverRow[]>([]);
  const [latestRides, setLatestRides] = useState<RideRow[]>([]);
  const [activeRides, setActiveRides] = useState<RideRow[]>([]);
  const [totalDrivers, setTotalDrivers] = useState(0);
  const [todayTrips, setTodayTrips] = useState(0);
  const [earningsSheetOpen, setEarningsSheetOpen] = useState(false);

  const { earnings, totalEarnings, totalPlatformFees, refresh: refreshEarnings } = useAdminEarnings();

  const refreshAll = useCallback(async () => {
    setError('');
    try {
      // Pending drivers
      const { data: pending, error: pendingErr } = await supabase
        .from('drivers')
        .select('id, user_id, vehicle_make, vehicle_model, plate_number, status, is_online')
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
        .limit(50);
      if (pendingErr) throw pendingErr;

      const pendingWithProfiles = await Promise.all(
        (pending || []).map(async (driver) => {
          const { data: profile } = await supabase
            .from('profiles')
            .select('full_name, phone')
            .eq('user_id', driver.user_id)
            .single();
          return { ...driver, profile: profile || undefined };
        })
      );

      // Online approved drivers
      const { data: online, error: onlineErr } = await supabase
        .from('drivers')
        .select('id, user_id, vehicle_make, vehicle_model, plate_number, status, is_online')
        .eq('status', 'approved')
        .eq('is_online', true)
        .limit(100);
      if (onlineErr) throw onlineErr;

      const onlineWithDetails = await Promise.all(
        (online || []).map(async (driver) => {
          const [profileRes, locationRes, activeTripRes] = await Promise.all([
            supabase.from('profiles').select('full_name, phone').eq('user_id', driver.user_id).single(),
            supabase.from('live_locations').select('latitude, longitude, updated_at').eq('user_id', driver.user_id).single(),
            supabase.from('rides').select('status').eq('driver_id', driver.id).in('status', ['accepted', 'enroute', 'in_progress', 'arrived']).limit(1).maybeSingle(),
          ]);
          return {
            ...driver,
            profile: profileRes.data || undefined,
            location: locationRes.data || null,
            tripStatus: activeTripRes.data?.status || null,
          };
        })
      );

      // Total approved drivers
      const { count: driverCount } = await supabase
        .from('drivers')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'approved');

      // Today's trips
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const { count: todayCount } = await supabase
        .from('rides')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', todayStart.toISOString());

      // Latest rides
      const { data: rides, error: ridesErr } = await supabase
        .from('rides')
        .select('id, pickup_address, dropoff_address, fare, status, created_at, driver_id')
        .order('created_at', { ascending: false })
        .limit(60);
      if (ridesErr) throw ridesErr;

      // Active rides (for map)
      const { data: active } = await supabase
        .from('rides')
        .select('id, pickup_address, dropoff_address, pickup_lat, pickup_lon, dropoff_lat, dropoff_lon, fare, status, created_at, driver_id')
        .in('status', ['pending', 'requested', 'accepted', 'enroute', 'in_progress', 'arrived'])
        .limit(50);

      setPendingDrivers(pendingWithProfiles);
      setOnlineDrivers(onlineWithDetails);
      setLatestRides(rides || []);
      setActiveRides(active || []);
      setTotalDrivers(driverCount || 0);
      setTodayTrips(todayCount || 0);
    } catch (e: unknown) {
      setError((e as Error)?.message || 'Failed to load dashboard data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshAll();
    const interval = setInterval(refreshAll, 10000);

    const channel = supabase
      .channel('admin-dashboard')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'live_locations' }, () => refreshAll())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rides' }, () => refreshAll())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'drivers' }, () => refreshAll())
      .subscribe();

    return () => {
      clearInterval(interval);
      supabase.removeChannel(channel);
    };
  }, [refreshAll]);

  const setDriverStatus = async (driverId: string, status: 'approved' | 'suspended') => {
    setError('');
    try {
      await adminUpdateRow('drivers', driverId, { status });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Operation failed');
      return;
    }
    await refreshAll();
  };

  const forceDriverOffline = async (driverId: string) => {
    try {
      await adminUpdateRow('drivers', driverId, { is_online: false });
    } catch { /* ignore */ }
    await refreshAll();
  };

  const mapDrivers = useMemo(() => 
    onlineDrivers
      .filter(d => d.location?.latitude && d.location?.longitude)
      .map(d => ({
        id: d.id,
        name: d.profile?.full_name || 'Driver',
        lat: d.location!.latitude,
        lng: d.location!.longitude,
        isOnline: true,
        tripStatus: (d as unknown as Record<string, unknown>).tripStatus as string | null,
      }))
  , [onlineDrivers]);

  const mapRides = useMemo(() => 
    activeRides.map(r => ({
      id: r.id,
      pickupLat: (r as unknown as Record<string, unknown>).pickup_lat as number,
      pickupLng: (r as unknown as Record<string, unknown>).pickup_lon as number,
      dropoffLat: (r as unknown as Record<string, unknown>).dropoff_lat as number,
      dropoffLng: (r as unknown as Record<string, unknown>).dropoff_lon as number,
      status: r.status,
      pickupAddress: r.pickup_address,
      dropoffAddress: r.dropoff_address,
    }))
  , [activeRides]);

  const summaryMetrics = useMemo(() => [
    { label: "Today's rides", value: todayTrips, icon: Navigation, tone: 'primary' },
    { label: 'Online now', value: onlineDrivers.length, icon: Car, tone: 'emerald' },
    { label: 'Pending approvals', value: pendingDrivers.length, icon: Clock, tone: 'amber' },
    { label: 'Total drivers', value: totalDrivers, icon: Users, tone: 'accent' },
  ], [onlineDrivers.length, pendingDrivers.length, todayTrips, totalDrivers]);

  const latestRidePreview = useMemo(() => latestRides.slice(0, 8), [latestRides]);

  return (
    <AdminGuard>
      <AdminLayout>
        <div className="space-y-6">
          {/* Header — gradient hero */}
          <div
            className="relative overflow-hidden rounded-3xl px-6 py-5 text-primary-foreground"
            style={{ background: 'var(--gradient-primary)' }}
          >
            <div className="absolute -top-16 -right-10 w-56 h-56 rounded-full bg-white/10 blur-3xl pointer-events-none" />
            <div className="relative flex items-center justify-between gap-3 flex-wrap">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-widest text-primary-foreground/80">Admin</p>
                <h1 className="text-3xl font-black mt-0.5">Dashboard</h1>
                <p className="text-sm text-primary-foreground/85 mt-1">Live operations overview</p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  className="font-bold bg-white/15 hover:bg-white/25 text-primary-foreground border-0 backdrop-blur rounded-full h-10 px-4"
                  onClick={() => setEarningsSheetOpen(true)}
                >
                  <Wallet className="w-4 h-4 mr-2" />
                  ${totalPlatformFees.toFixed(2)}
                </Button>
                <Button
                  size="sm"
                  className="bg-white/15 hover:bg-white/25 text-primary-foreground border-0 backdrop-blur rounded-full h-10 px-4"
                  onClick={() => { refreshAll(); refreshEarnings(); }}
                  disabled={loading}
                >
                  <RefreshCw className={`w-4 h-4 mr-1 ${loading ? 'animate-spin' : ''}`} />
                  Refresh
                </Button>
              </div>
            </div>
          </div>

          {error && (
            <div className="bg-destructive/10 border border-destructive/20 text-destructive rounded-2xl p-4 font-bold text-sm">
              {error}
            </div>
          )}

          {/* Metric Cards */}
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
            {loading ? (
              Array.from({ length: 4 }).map((_, index) => (
                <Card key={index} className="border-border/50">
                  <CardContent className="pt-4">
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-2xl bg-muted animate-pulse" />
                      <div className="flex-1 space-y-2">
                        <div className="h-5 w-12 rounded-full bg-muted animate-pulse" />
                        <div className="h-3 w-20 rounded-full bg-muted animate-pulse" />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))
            ) : summaryMetrics.map((metric) => {
              const Icon = metric.icon;
              const toneClass = metric.tone === 'emerald' ? 'bg-emerald-500/10 text-emerald-600' : metric.tone === 'amber' ? 'bg-amber-500/10 text-amber-600' : metric.tone === 'accent' ? 'bg-primary/10 text-primary' : 'bg-primary/10 text-primary';
              return (
                <Card key={metric.label} className="border-border/50 bg-card/80 shadow-sm">
                  <CardContent className="pt-4">
                    <div className="flex items-center gap-3">
                      <div className={`rounded-2xl p-2.5 ${toneClass}`}>
                        <Icon className="h-5 w-5" />
                      </div>
                      <div>
                        <p className="text-2xl font-black text-foreground">{metric.value}</p>
                        <p className="text-xs text-muted-foreground">{metric.label}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>


          {/* Commission Revenue Summary */}
          {(() => {
            const now = new Date();
            const todayEarnings = earnings.filter(e => isAfter(new Date(e.created_at), startOfDay(now)));
            const weekEarnings = earnings.filter(e => isAfter(new Date(e.created_at), startOfWeek(now, { weekStartsOn: 1 })));
            const monthEarnings = earnings.filter(e => isAfter(new Date(e.created_at), startOfMonth(now)));
            const sum = (items: typeof earnings) => items.reduce((a, e) => a + Number(e.platform_fee), 0);
            const countTrips = (items: typeof earnings) => items.length;
            return (
              <Card className="border-border/50 bg-card/80 shadow-sm">
                <CardContent className="pt-4">
                  <div className="flex items-center justify-between mb-3">
                    <h2 className="font-bold text-sm flex items-center gap-2">
                      <DollarSign className="h-4 w-4 text-primary" />
                      CruiXe Commission (15%)
                    </h2>
                    <Button size="sm" variant="outline" onClick={() => setEarningsSheetOpen(true)}>
                      View Details
                    </Button>
                  </div>
                  <div className="grid gap-3 md:grid-cols-3">
                    <div className="rounded-2xl border border-border/40 bg-primary/10 p-4 text-center">
                      <p className="text-[10px] font-bold text-muted-foreground uppercase">Today</p>
                      <p className="mt-1 text-xl font-black text-primary">${sum(todayEarnings).toFixed(2)}</p>
                      <p className="text-[10px] text-muted-foreground">{countTrips(todayEarnings)} trips</p>
                    </div>
                    <div className="rounded-2xl border border-border/40 bg-primary/10 p-4 text-center">
                      <p className="text-[10px] font-bold text-muted-foreground uppercase">This Week</p>
                      <p className="mt-1 text-xl font-black text-primary">${sum(weekEarnings).toFixed(2)}</p>
                      <p className="text-[10px] text-muted-foreground">{countTrips(weekEarnings)} trips</p>
                    </div>
                    <div className="rounded-2xl border border-border/40 bg-primary/10 p-4 text-center">
                      <p className="text-[10px] font-bold text-muted-foreground uppercase">This Month</p>
                      <p className="mt-1 text-xl font-black text-primary">${sum(monthEarnings).toFixed(2)}</p>
                      <p className="text-[10px] text-muted-foreground">{countTrips(monthEarnings)} trips</p>
                    </div>
                  </div>

                </CardContent>
              </Card>
            );
          })()}

          {/* Revenue Trend Chart */}
          {(() => {
            const chartConfig = { revenue: { label: 'Revenue', color: 'hsl(var(--primary))' }, trips: { label: 'Trips', color: 'hsl(var(--accent-foreground))' } };
            const days = eachDayOfInterval({ start: subDays(new Date(), 6), end: new Date() });
            const dailyData = days.map(day => {
              const dayStr = format(day, 'yyyy-MM-dd');
              const dayEarnings = earnings.filter(e => format(new Date(e.created_at), 'yyyy-MM-dd') === dayStr);
              return {
                date: format(day, 'EEE'),
                revenue: dayEarnings.reduce((s, e) => s + Number(e.platform_fee), 0),
                trips: dayEarnings.length,
              };
            });
            return (
              <Card className="border-border/50 bg-card/80 shadow-sm">
                <CardContent className="pt-4">
                  <div className="flex items-center justify-between mb-3">
                    <h2 className="font-bold text-sm flex items-center gap-2">
                      <BarChart3 className="h-4 w-4 text-primary" />
                      7-Day Revenue Trend
                    </h2>
                  </div>
                  <ChartContainer config={chartConfig} className="h-48 w-full">
                    <BarChart data={dailyData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border/30" />
                      <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Bar dataKey="revenue" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} name="Revenue ($)" />
                    </BarChart>
                  </ChartContainer>
                </CardContent>
              </Card>
            );
          })()}

          <Card className="border-border/50 bg-card/80 shadow-sm">
            <CardContent className="pt-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h2 className="font-bold text-sm">Live Map — Drivers & Active Rides</h2>
                <span className="rounded-full bg-primary/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-primary">Realtime</span>
              </div>
              <AdminMap 
                drivers={mapDrivers} 
                rides={mapRides} 
                height="420px"
              />
            </CardContent>
          </Card>

          <div className="grid lg:grid-cols-2 gap-6">
            {/* Pending Approvals */}
            <Card className="border-border/50 bg-card/80 shadow-sm">
              <CardContent className="pt-4">
                <h2 className="font-bold text-sm mb-3">Pending Driver Approvals</h2>
                {loading ? (
                  <div className="space-y-2">
                    {Array.from({ length: 3 }).map((_, index) => (
                      <div key={index} className="h-14 rounded-2xl bg-muted animate-pulse" />
                    ))}
                  </div>
                ) : pendingDrivers.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-border/60 bg-background/70 p-6 text-center">
                    <AlertCircle className="mx-auto h-6 w-6 text-muted-foreground" />
                    <p className="mt-2 text-sm text-muted-foreground">No pending drivers</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {pendingDrivers.map((d) => (
                      <div key={d.id} className="flex items-center justify-between gap-3 p-3 bg-muted/50 rounded-xl">
                        <div className="min-w-0">
                          <p className="font-bold text-sm truncate">{d.profile?.full_name || 'Unknown'}</p>
                          <p className="text-xs text-muted-foreground">
                            {d.profile?.phone || '—'} • {d.vehicle_make} {d.vehicle_model}
                          </p>
                        </div>
                        <div className="flex gap-2 shrink-0">
                          <Button size="sm" variant="default" className="h-8 text-xs font-bold" onClick={() => setDriverStatus(d.id, 'approved')}>
                            Approve
                          </Button>
                          <Button size="sm" variant="destructive" className="h-8 text-xs font-bold" onClick={() => setDriverStatus(d.id, 'suspended')}>
                            Reject
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Live Tracking */}
            <Card className="border-border/50 bg-card/80 shadow-sm">
              <CardContent className="pt-4">
                <h2 className="font-bold text-sm mb-3">Online Drivers</h2>
                {loading ? (
                  <div className="space-y-2">
                    {Array.from({ length: 3 }).map((_, index) => (
                      <div key={index} className="h-14 rounded-2xl bg-muted animate-pulse" />
                    ))}
                  </div>
                ) : onlineDrivers.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-border/60 bg-background/70 p-6 text-center">
                    <AlertCircle className="mx-auto h-6 w-6 text-muted-foreground" />
                    <p className="mt-2 text-sm text-muted-foreground">No drivers online</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {onlineDrivers.map((d) => (
                      <div key={d.id} className="flex items-center justify-between gap-3 p-3 bg-muted/50 rounded-xl">
                        <div className="min-w-0">
                          <p className="font-bold text-sm">{d.profile?.full_name || 'Unknown'}</p>
                          <p className="text-xs text-muted-foreground">
                            {d.location?.latitude && d.location?.longitude
                              ? `${d.location.latitude.toFixed(4)}, ${d.location.longitude.toFixed(4)}`
                              : 'No GPS'}
                          </p>
                          <p className="text-[10px] text-muted-foreground">
                            {d.location?.updated_at ? new Date(d.location.updated_at).toLocaleTimeString() : '—'}
                          </p>
                        </div>
                        <div className="flex gap-2 shrink-0">
                          <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => navigate(`/admin/drivers/${d.id}`)}>
                            <Eye className="w-3 h-3 mr-1" /> View
                          </Button>
                          <Button size="sm" variant="secondary" className="h-8 text-xs font-bold" onClick={() => forceDriverOffline(d.id)}>
                            Force Offline
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Ride Monitoring */}
          <Card className="border-border/50 bg-card/80 shadow-sm">
            <CardContent className="pt-4">
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-bold text-sm">Ride Monitoring</h2>
                <Button size="sm" variant="ghost" onClick={() => navigate('/admin/trips')}>View All</Button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left py-2 px-2 font-bold text-xs text-muted-foreground">Time</th>
                      <th className="text-left py-2 px-2 font-bold text-xs text-muted-foreground">Status</th>
                      <th className="text-left py-2 px-2 font-bold text-xs text-muted-foreground">Pickup</th>
                      <th className="text-left py-2 px-2 font-bold text-xs text-muted-foreground">Dropoff</th>
                      <th className="text-left py-2 px-2 font-bold text-xs text-muted-foreground">Fare</th>
                    </tr>
                  </thead>
                  <tbody>
                    {latestRidePreview.map((r) => (
                      <tr key={r.id} className="border-b border-border/50 hover:bg-muted/50 transition-colors">
                        <td className="py-2 px-2 text-xs text-muted-foreground whitespace-nowrap">
                          {new Date(r.created_at).toLocaleString()}
                        </td>
                        <td className="py-2 px-2">
                          <Badge variant="outline" className={`text-[10px] font-bold ${statusColors[r.status] || ''}`}>
                            {r.status}
                          </Badge>
                        </td>
                        <td className="py-2 px-2 text-xs max-w-[150px] truncate">{r.pickup_address || '—'}</td>
                        <td className="py-2 px-2 text-xs max-w-[150px] truncate">{r.dropoff_address || '—'}</td>
                        <td className="py-2 px-2 text-xs font-bold">${Number(r.fare).toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {/* Earnings Sheet */}
          <AdminEarningsSheet
            isOpen={earningsSheetOpen}
            onClose={() => setEarningsSheetOpen(false)}
            earnings={earnings}
            totalFares={totalEarnings}
            totalPlatformFees={totalPlatformFees}
          />
        </div>
      </AdminLayout>
    </AdminGuard>
  );
};

export default AdminDashboard;
