import { useEffect, useState } from 'react';
import { 
  Calendar, 
  Download, 
  TrendingUp, 
  Car,
  Navigation,
  Banknote,
  MapPin
} from 'lucide-react';
import AdminLayout from '@/components/admin/AdminLayout';
import AdminGuard from '@/components/admin/AdminGuard';
import MetricCard from '@/components/admin/MetricCard';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { supabase } from '@/lib/supabaseClient';
import { toast } from 'sonner';
import { format, subDays, startOfDay } from 'date-fns';
import { adminListLedger } from '@/lib/walletApi';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
} from 'recharts';

interface ReportMetrics {
  totalTrips: number;
  completedTrips: number;
  cancelledTrips: number;
  averageFare: number;
  activeDrivers: number;
  topLandmark: string;
}

interface SettlementMetrics {
  totalSettled: number;
  settledToday: number;
  settledWeek: number;
  settledMonth: number;
  settledCount: number;
}

interface DailyData {
  date: string;
  trips: number;
  revenue: number;
  cancellations: number;
}

const AdminReports = () => {
  const [dateRange, setDateRange] = useState('7');
  const [metrics, setMetrics] = useState<ReportMetrics | null>(null);
  const [dailyData, setDailyData] = useState<DailyData[]>([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [settlements, setSettlements] = useState<SettlementMetrics | null>(null);

  useEffect(() => {
    const fetchSettlements = async () => {
      const data = await adminListLedger('all');
      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const weekStart = new Date(todayStart);
      weekStart.setDate(weekStart.getDate() - 7);
      const monthStart = new Date(todayStart);
      monthStart.setDate(monthStart.getDate() - 30);
      setSettlements({
        totalSettled: data.reduce((s, r) => s + Number(r.amount), 0),
        settledToday: data.filter(r => new Date(r.created_at) >= todayStart).reduce((s, r) => s + Number(r.amount), 0),
        settledWeek: data.filter(r => new Date(r.created_at) >= weekStart).reduce((s, r) => s + Number(r.amount), 0),
        settledMonth: data.filter(r => new Date(r.created_at) >= monthStart).reduce((s, r) => s + Number(r.amount), 0),
        settledCount: data.length,
      });
    };
    fetchSettlements();
  }, []);

  useEffect(() => {
    const fetchReportData = async () => {
      setLoading(true);
      try {
        const days = parseInt(dateRange);
        const startDate = startOfDay(subDays(new Date(), days));

        // Fetch rides within date range
        const { data: rides } = await supabase
          .from('rides')
          .select('*')
          .gte('created_at', startDate.toISOString());

        // Fetch drivers
        const { count: activeDrivers } = await supabase
          .from('drivers')
          .select('*', { count: 'exact', head: true })
          .eq('status', 'approved');

        // Calculate metrics
        const completedRides = rides?.filter(r => r.status === 'completed') || [];
        const cancelledRides = rides?.filter(r => r.status === 'cancelled') || [];
        const totalFare = completedRides.reduce((sum, r) => sum + Number(r.fare), 0);

        // Find top pickup location
        const pickupCounts: Record<string, number> = {};
        rides?.forEach(r => {
          const pickup = r.pickup_address.split(',')[0];
          pickupCounts[pickup] = (pickupCounts[pickup] || 0) + 1;
        });
        const topLandmark = Object.entries(pickupCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'N/A';

        setMetrics({
          totalTrips: rides?.length || 0,
          completedTrips: completedRides.length,
          cancelledTrips: cancelledRides.length,
          averageFare: completedRides.length > 0 ? totalFare / completedRides.length : 0,
          activeDrivers: activeDrivers || 0,
          topLandmark,
        });

        // Generate daily data
        const daily: DailyData[] = [];
        for (let i = days - 1; i >= 0; i--) {
          const date = subDays(new Date(), i);
          const dateStr = format(date, 'yyyy-MM-dd');
          const dayRides = rides?.filter(r => 
            format(new Date(r.created_at), 'yyyy-MM-dd') === dateStr
          ) || [];
          
          daily.push({
            date: format(date, 'MMM d'),
            trips: dayRides.length,
            revenue: dayRides.filter(r => r.status === 'completed').reduce((sum, r) => sum + Number(r.fare), 0),
            cancellations: dayRides.filter(r => r.status === 'cancelled').length,
          });
        }
        setDailyData(daily);
      } catch (error) {
        console.error('Error fetching report data:', error);
        toast.error('Failed to load report data');
      } finally {
        setLoading(false);
      }
    };

    fetchReportData();
  }, [dateRange]);

  const exportCSV = async (type: 'trips' | 'drivers' | 'earnings') => {
    setExporting(true);
    try {
      let csvContent = '';
      
      if (type === 'trips') {
        const { data: rides } = await supabase
          .from('rides')
          .select('*')
          .order('created_at', { ascending: false });

        csvContent = 'ID,Date,Status,Pickup,Dropoff,Distance (km),Duration (min),Fare (R),Vehicle\n';
        rides?.forEach(r => {
          csvContent += `${r.id},${format(new Date(r.created_at), 'yyyy-MM-dd HH:mm')},${r.status},"${r.pickup_address}","${r.dropoff_address}",${r.distance_km},${r.duration_minutes},${r.fare},${r.vehicle_type}\n`;
        });
      } else if (type === 'drivers') {
        const { data: drivers } = await supabase
          .from('drivers')
          .select('*')
          .order('created_at', { ascending: false });

        csvContent = 'ID,Status,Vehicle Type,Plate,Rating,Total Trips,Online,Created\n';
        drivers?.forEach(d => {
          csvContent += `${d.id},${d.status},${d.vehicle_type},${d.plate_number || 'N/A'},${d.rating_avg},${d.total_trips},${d.is_online},${format(new Date(d.created_at), 'yyyy-MM-dd')}\n`;
        });
      } else {
        csvContent = 'Date,Trips,Revenue (R),Cancellations\n';
        dailyData.forEach(d => {
          csvContent += `${d.date},${d.trips},${d.revenue},${d.cancellations}\n`;
        });
      }

      const blob = new Blob([csvContent], { type: 'text/csv' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `cruixe-${type}-${format(new Date(), 'yyyy-MM-dd')}.csv`;
      a.click();
      window.URL.revokeObjectURL(url);
      
      toast.success(`${type} exported successfully`);
    } catch (error) {
      console.error('Export error:', error);
      toast.error('Failed to export data');
    } finally {
      setExporting(false);
    }
  };

  return (
    <AdminGuard>
      <AdminLayout>
        <div className="space-y-6">
          {/* Header */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-foreground">Reports & Analytics</h1>
              <p className="text-muted-foreground">Insights and performance metrics</p>
            </div>
            <div className="flex items-center gap-3">
              <Select value={dateRange} onValueChange={setDateRange}>
                <SelectTrigger className="w-[140px]">
                  <Calendar className="w-4 h-4 mr-2" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="7">Last 7 days</SelectItem>
                  <SelectItem value="14">Last 14 days</SelectItem>
                  <SelectItem value="30">Last 30 days</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Metrics */}
          {loading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {[...Array(6)].map((_, i) => (
                <Skeleton key={i} className="h-32 rounded-xl" />
              ))}
            </div>
          ) : metrics && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <MetricCard
                title="Total Trips"
                value={metrics.totalTrips}
                icon={Navigation}
              />
              <MetricCard
                title="Completed Trips"
                value={metrics.completedTrips}
                icon={TrendingUp}
                variant="success"
              />
              <MetricCard
                title="Cancelled Trips"
                value={metrics.cancelledTrips}
                icon={Navigation}
                variant="danger"
              />
              <MetricCard
                title="Average Fare"
                value={`$${metrics.averageFare.toFixed(2)}`}
                icon={Banknote}
              />
              <MetricCard
                title="Active Drivers"
                value={metrics.activeDrivers}
                icon={Car}
              />
              <MetricCard
                title="Top Pickup Location"
                value={metrics.topLandmark}
                icon={MapPin}
              />
            </div>
          )}

          {/* Charts */}
          <div className="grid lg:grid-cols-2 gap-6">
            <div className="bg-card rounded-xl border border-border p-6">
              <h3 className="font-semibold mb-4">Trips Over Time</h3>
              {loading ? (
                <Skeleton className="h-[300px]" />
              ) : (
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={dailyData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e5e5" />
                    <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                    <YAxis tick={{ fontSize: 12 }} />
                    <Tooltip />
                    <Line 
                      type="monotone" 
                      dataKey="trips" 
                      stroke="#F97316" 
                      strokeWidth={2}
                      dot={{ fill: '#F97316' }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>

            <div className="bg-card rounded-xl border border-border p-6">
              <h3 className="font-semibold mb-4">Daily Revenue (R)</h3>
              {loading ? (
                <Skeleton className="h-[300px]" />
              ) : (
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={dailyData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e5e5" />
                    <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                    <YAxis tick={{ fontSize: 12 }} />
                    <Tooltip />
                    <Bar dataKey="revenue" fill="#10B981" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {/* Settlement Analytics */}
          {settlements && (
            <div className="bg-card rounded-xl border border-border p-6">
              <h3 className="font-semibold mb-4">Settlement Analytics</h3>
              <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
                <div className="text-center p-3 bg-muted rounded-lg">
                  <p className="text-2xl font-bold text-foreground">${settlements.totalSettled.toFixed(2)}</p>
                  <p className="text-xs text-muted-foreground">Total Settled</p>
                </div>
                <div className="text-center p-3 bg-muted rounded-lg">
                  <p className="text-2xl font-bold text-foreground">${settlements.settledToday.toFixed(2)}</p>
                  <p className="text-xs text-muted-foreground">Today</p>
                </div>
                <div className="text-center p-3 bg-muted rounded-lg">
                  <p className="text-2xl font-bold text-foreground">${settlements.settledWeek.toFixed(2)}</p>
                  <p className="text-xs text-muted-foreground">This Week</p>
                </div>
                <div className="text-center p-3 bg-muted rounded-lg">
                  <p className="text-2xl font-bold text-foreground">${settlements.settledMonth.toFixed(2)}</p>
                  <p className="text-xs text-muted-foreground">This Month</p>
                </div>
                <div className="text-center p-3 bg-muted rounded-lg">
                  <p className="text-2xl font-bold text-foreground">{settlements.settledCount}</p>
                  <p className="text-xs text-muted-foreground">Settled Trips</p>
                </div>
              </div>
            </div>
          )}

          {/* Export Section */}
          <div className="bg-card rounded-xl border border-border p-6">
            <h3 className="font-semibold mb-4">Export Data</h3>
            <div className="flex flex-wrap gap-3">
              <Button 
                variant="outline" 
                onClick={() => exportCSV('trips')}
                disabled={exporting}
              >
                <Download className="w-4 h-4 mr-2" />
                Export Trips
              </Button>
              <Button 
                variant="outline" 
                onClick={() => exportCSV('drivers')}
                disabled={exporting}
              >
                <Download className="w-4 h-4 mr-2" />
                Export Drivers
              </Button>
              <Button 
                variant="outline" 
                onClick={() => exportCSV('earnings')}
                disabled={exporting}
              >
                <Download className="w-4 h-4 mr-2" />
                Export Earnings
              </Button>
            </div>
          </div>
        </div>
      </AdminLayout>
    </AdminGuard>
  );
};

export default AdminReports;
