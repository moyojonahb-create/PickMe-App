import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, LineChart, Line, AreaChart, Area } from 'recharts';
import { DollarSign, TrendingUp, Car, Calendar, Star, Percent, CheckCircle2 } from 'lucide-react';
import { format, subDays, eachDayOfInterval, eachHourOfInterval, startOfDay, endOfDay } from 'date-fns';
import { motion } from 'framer-motion';
import { getDriverEarnings } from '@/lib/walletApi';

interface EarningsData {
  date: string;
  earnings: number;
  trips: number;
  commission: number;
}

interface HourlyData {
  hour: string;
  trips: number;
}

const chartConfig = {
  earnings: { label: 'Earnings', color: 'hsl(var(--primary))' },
  trips: { label: 'Trips', color: 'hsl(var(--accent-foreground))' },
  commission: { label: 'Commission', color: 'hsl(var(--destructive))' },
};

export default function DriverEarningsDashboard() {
  const { user } = useAuth();
  const [rides, setRides] = useState<{ fare: number; created_at: string; status: string }[]>([]);
  const [earnings, setEarnings] = useState<{ platform_fee: number; driver_earnings: number; fare_amount: number; created_at: string }[]>([]);
  const [ratings, setRatings] = useState<{ rating: number; created_at: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<'7d' | '30d'>('7d');

  useEffect(() => {
    if (!user) return;
    const load = async () => {
      setLoading(true);
      const since = subDays(new Date(), period === '7d' ? 7 : 30).toISOString();

      const { data: driver } = await supabase
        .from('drivers')
        .select('id')
        .eq('user_id', user.id)
        .maybeSingle();

      if (!driver) { setLoading(false); return; }

      const [ridesRes, earningsRes, ratingsRes] = await Promise.all([
        supabase
          .from('rides')
          .select('fare, created_at, status')
          .eq('driver_id', driver.id)
          .eq('status', 'completed')
          .gte('created_at', since)
          .order('created_at', { ascending: true }),
        getDriverEarnings(period),
        supabase
          .from('driver_ratings')
          .select('rating, created_at')
          .eq('driver_id', driver.id)
          .gte('created_at', since)
          .order('created_at', { ascending: true }),
      ]);

      setRides(ridesRes.data || []);
      setEarnings(earningsRes || []);
      setRatings(ratingsRes.data || []);
      setLoading(false);
    };
    load();
  }, [user, period]);

  const days = period === '7d' ? 7 : 30;

  const dailyData: EarningsData[] = useMemo(() => {
    const interval = eachDayOfInterval({
      start: subDays(new Date(), days - 1),
      end: new Date(),
    });

    return interval.map((day) => {
      const dayStr = format(day, 'yyyy-MM-dd');
      const dayRides = rides.filter(r => format(new Date(r.created_at), 'yyyy-MM-dd') === dayStr);
      const dayEarnings = earnings.filter(e => format(new Date(e.created_at), 'yyyy-MM-dd') === dayStr);
      const totalCommission = dayEarnings.reduce((s, e) => s + Number(e.platform_fee), 0);

      return {
        date: format(day, period === '7d' ? 'EEE' : 'dd MMM'),
        earnings: dayRides.reduce((sum, r) => sum + Number(r.fare), 0),
        trips: dayRides.length,
        commission: totalCommission,
      };
    });
  }, [rides, earnings, days, period]);

  // Peak hours heatmap data
  const hourlyData: HourlyData[] = useMemo(() => {
    const hours = Array.from({ length: 24 }, (_, i) => ({ hour: `${i}:00`, trips: 0 }));
    rides.forEach(r => {
      const h = new Date(r.created_at).getHours();
      hours[h].trips++;
    });
    return hours;
  }, [rides]);

  const totals = useMemo(() => {
    const totalEarnings = rides.reduce((s, r) => s + Number(r.fare), 0);
    const totalTrips = rides.length;
    const avgPerTrip = totalTrips > 0 ? totalEarnings / totalTrips : 0;
    const todayStr = format(new Date(), 'yyyy-MM-dd');
    const todayEarnings = rides
      .filter(r => format(new Date(r.created_at), 'yyyy-MM-dd') === todayStr)
      .reduce((s, r) => s + Number(r.fare), 0);
    const totalCommission = earnings.reduce((s, e) => s + Number(e.platform_fee), 0);
    const avgRating = ratings.length > 0 
      ? ratings.reduce((s, r) => s + r.rating, 0) / ratings.length 
      : 0;
    return { totalEarnings, totalTrips, avgPerTrip, todayEarnings, totalCommission, avgRating };
  }, [rides, earnings, ratings]);

  if (loading) {
    return (
      <Card>
        <CardContent className="pt-4">
          <div className="h-48 flex items-center justify-center">
            <div className="animate-pulse text-muted-foreground text-sm">Loading earnings…</div>
          </div>
        </CardContent>
      </Card>
    );
  }

  const statCards = [
    { icon: DollarSign, label: 'Today', value: `$${totals.todayEarnings.toFixed(2)}`, accent: true },
    { icon: Calendar, label: period === '7d' ? 'This Week' : 'This Month', value: `$${totals.totalEarnings.toFixed(2)}`, accent: true },
    { icon: Car, label: 'Total Trips', value: `${totals.totalTrips}`, accent: false },
    { icon: TrendingUp, label: 'Avg / Trip', value: `$${totals.avgPerTrip.toFixed(2)}`, accent: false },
    { icon: Percent, label: 'Commission Paid', value: `$${totals.totalCommission.toFixed(2)}`, accent: false },
    { icon: Star, label: 'Avg Rating', value: totals.avgRating > 0 ? totals.avgRating.toFixed(1) : '—', accent: false },
  ];

  return (
    <Card className="overflow-hidden">
      <CardContent className="pt-4 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-sm flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-primary" />
            Earnings Dashboard
          </h3>
          <Tabs value={period} onValueChange={(v) => setPeriod(v as '7d' | '30d')}>
            <TabsList className="h-8">
              <TabsTrigger value="7d" className="text-xs px-3 h-6">7 Days</TabsTrigger>
              <TabsTrigger value="30d" className="text-xs px-3 h-6">30 Days</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        <div className="rounded-2xl border border-primary/20 bg-primary/5 p-3">
          <div className="flex items-start gap-2">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <div>
              <p className="text-xs font-extrabold text-foreground">Pilot performance targets</p>
              <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
                Keep acceptance high, pickup communication clear, and cash handoff confirmed before marking trips complete.
              </p>
            </div>
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-3 gap-2">
          {statCards.map((card, i) => (
            <motion.div
              key={card.label}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              className={cn(
                'rounded-xl p-3',
                card.accent ? 'bg-primary/10' : 'bg-muted'
              )}
            >
              <div className="flex items-center gap-1.5 mb-1">
                <card.icon className={cn('h-3.5 w-3.5', card.accent ? 'text-primary' : 'text-muted-foreground')} />
                <span className="text-[10px] text-muted-foreground font-medium">{card.label}</span>
              </div>
              <p className="text-lg font-extrabold tabular-nums">{card.value}</p>
            </motion.div>
          ))}
        </div>

        {/* Earnings Bar Chart */}
        <div>
          <p className="text-xs font-semibold text-muted-foreground mb-2">Earnings ($)</p>
          <ChartContainer config={chartConfig} className="h-40 w-full">
            <BarChart data={dailyData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border/30" />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Bar dataKey="earnings" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ChartContainer>
        </div>

        {/* Peak Hours Heatmap */}
        <div>
          <p className="text-xs font-semibold text-muted-foreground mb-2">Peak Hours</p>
          <ChartContainer config={chartConfig} className="h-32 w-full">
            <AreaChart data={hourlyData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
              <defs>
                <linearGradient id="peakGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0.05} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border/30" />
              <XAxis dataKey="hour" tick={{ fontSize: 8 }} interval={3} />
              <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Area type="monotone" dataKey="trips" stroke="hsl(var(--primary))" fill="url(#peakGradient)" strokeWidth={2} />
            </AreaChart>
          </ChartContainer>
        </div>

        {/* Trip Count Line Chart */}
        <div>
          <p className="text-xs font-semibold text-muted-foreground mb-2">Trips per day</p>
          <ChartContainer config={chartConfig} className="h-32 w-full">
            <LineChart data={dailyData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border/30" />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Line type="monotone" dataKey="trips" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ChartContainer>
        </div>
      </CardContent>
    </Card>
  );
}

function cn(...classes: (string | boolean | undefined)[]) {
  return classes.filter(Boolean).join(' ');
}
