import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { 
  Search, 
  Filter, 
  MoreHorizontal, 
  Eye, 
  CheckCircle, 
  XCircle,
  MapPin,
  Car,
  PowerOff
} from 'lucide-react';
import AdminLayout from '@/components/admin/AdminLayout';
import AdminGuard from '@/components/admin/AdminGuard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { supabase } from '@/lib/supabaseClient';
import { adminUpdateRow } from '@/lib/businessApi';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface Driver {
  id: string;
  user_id: string;
  status: string;
  vehicle_type: string;
  plate_number: string | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
  rating_avg: number;
  total_trips: number;
  is_online: boolean;
  created_at: string;
  profiles?: {
    full_name: string | null;
    phone: string | null;
  };
}

const statusColors: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  approved: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  suspended: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  banned: 'bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-400',
};

const AdminDrivers = () => {
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [onlineFilter, setOnlineFilter] = useState<string>('all');

  const fetchDrivers = async () => {
    try {
      let query = supabase
        .from('drivers')
        .select('*')
        .order('created_at', { ascending: false });

      if (statusFilter !== 'all') {
        query = query.eq('status', statusFilter);
      }

      if (onlineFilter !== 'all') {
        query = query.eq('is_online', onlineFilter === 'online');
      }

      const { data, error } = await query;

      if (error) throw error;
      
      // Fetch profiles for each driver
      const driversWithProfiles = await Promise.all(
        (data || []).map(async (driver) => {
          const { data: profileData } = await supabase
            .from('profiles')
            .select('full_name, phone')
            .eq('user_id', driver.user_id)
            .maybeSingle();
          
          return {
            ...driver,
            profiles: profileData || { full_name: null, phone: null }
          };
        })
      );
      
      setDrivers(driversWithProfiles);
    } catch (error) {
      console.error('Error fetching drivers:', error);
      toast.error('Failed to load drivers');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDrivers();
  }, [statusFilter, onlineFilter]);

  const handleStatusChange = async (driverId: string, newStatus: string) => {
    try {
      await adminUpdateRow('drivers', driverId, { status: newStatus });

      toast.success(`Driver ${newStatus}`);
      fetchDrivers();
    } catch (error) {
      console.error('Error updating driver:', error);
      toast.error('Failed to update driver status');
    }
  };

  const handleForceOffline = async (driverId: string) => {
    if (!window.confirm('Take this driver offline now? They can go back online themselves.')) return;
    try {
      const { error } = await (supabase.rpc as any)('admin_force_driver_offline', { _driver_id: driverId });
      if (error) throw error;
      toast.success('Driver taken offline');
      fetchDrivers();
    } catch (error) {
      console.error('Error forcing driver offline:', error);
      toast.error('Failed to take driver offline');
    }
  };

  const filteredDrivers = drivers.filter(driver => {
    if (!search) return true;
    const searchLower = search.toLowerCase();
    return (
      driver.profiles?.full_name?.toLowerCase().includes(searchLower) ||
      driver.plate_number?.toLowerCase().includes(searchLower) ||
      driver.vehicle_make?.toLowerCase().includes(searchLower)
    );
  });

  return (
    <AdminGuard>
      <AdminLayout>
        <div className="space-y-6">
          {/* Header */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-foreground">Drivers</h1>
              <p className="text-muted-foreground">Manage and monitor all registered drivers</p>
            </div>
            <Button asChild>
              <Link to="/admin/drivers/map">
                <MapPin className="w-4 h-4 mr-2" />
                Live Map
              </Link>
            </Button>
          </div>

          {/* Filters */}
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search by name, plate number..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[160px]">
                <Filter className="w-4 h-4 mr-2" />
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="approved">Approved</SelectItem>
                <SelectItem value="suspended">Suspended</SelectItem>
                <SelectItem value="banned">Banned</SelectItem>
              </SelectContent>
            </Select>
            <Select value={onlineFilter} onValueChange={setOnlineFilter}>
              <SelectTrigger className="w-[140px]">
                <SelectValue placeholder="Online" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="online">Online</SelectItem>
                <SelectItem value="offline">Offline</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Table */}
          <div className="bg-card rounded-xl border border-border overflow-hidden">
            {loading ? (
              <div className="p-4 space-y-4">
                {[...Array(5)].map((_, i) => (
                  <Skeleton key={i} className="h-16" />
                ))}
              </div>
            ) : filteredDrivers.length === 0 ? (
              <div className="p-12 text-center">
                <Car className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                <h3 className="font-medium text-foreground mb-1">No drivers found</h3>
                <p className="text-sm text-muted-foreground">
                  {search || statusFilter !== 'all' || onlineFilter !== 'all'
                    ? 'Try adjusting your filters'
                    : 'Drivers will appear here once they register'}
                </p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Driver</TableHead>
                    <TableHead>Vehicle</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Online</TableHead>
                    <TableHead>Rating</TableHead>
                    <TableHead>Trips</TableHead>
                    <TableHead className="w-[50px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredDrivers.map((driver) => (
                    <TableRow key={driver.id}>
                      <TableCell>
                        <div>
                          <p className="font-medium">
                            {driver.profiles?.full_name || 'Unknown'}
                          </p>
                          <p className="text-sm text-muted-foreground">
                            {driver.profiles?.phone || 'No phone'}
                          </p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div>
                          <p className="font-medium capitalize">{driver.vehicle_type}</p>
                          <p className="text-sm text-muted-foreground">
                            {driver.vehicle_make} {driver.vehicle_model}
                            {driver.plate_number && ` • ${driver.plate_number}`}
                          </p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge className={cn("capitalize", statusColors[driver.status])}>
                          {driver.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <div className={cn(
                            "w-2.5 h-2.5 rounded-full",
                            driver.is_online ? "bg-emerald-500" : "bg-gray-400"
                          )} />
                          <span className="text-sm">
                            {driver.is_online ? 'Online' : 'Offline'}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className="font-medium">
                          {Number(driver.rating_avg).toFixed(1)}
                        </span>
                        <span className="text-muted-foreground">/5</span>
                      </TableCell>
                      <TableCell>{driver.total_trips}</TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon">
                              <MoreHorizontal className="w-4 h-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem asChild>
                              <Link to={`/admin/drivers/${driver.id}`}>
                                <Eye className="w-4 h-4 mr-2" />
                                View Details
                              </Link>
                            </DropdownMenuItem>
                            {driver.is_online && (
                              <DropdownMenuItem
                                onClick={() => handleForceOffline(driver.id)}
                                className="text-red-600"
                              >
                                <PowerOff className="w-4 h-4 mr-2" />
                                Force offline
                              </DropdownMenuItem>
                            )}
                            {driver.status === 'pending' && (
                              <DropdownMenuItem 
                                onClick={() => handleStatusChange(driver.id, 'approved')}
                              >
                                <CheckCircle className="w-4 h-4 mr-2" />
                                Approve
                              </DropdownMenuItem>
                            )}
                            {driver.status === 'approved' && (
                              <DropdownMenuItem 
                                onClick={() => handleStatusChange(driver.id, 'suspended')}
                                className="text-red-600"
                              >
                                <XCircle className="w-4 h-4 mr-2" />
                                Suspend
                              </DropdownMenuItem>
                            )}
                            {driver.status === 'suspended' && (
                              <DropdownMenuItem 
                                onClick={() => handleStatusChange(driver.id, 'approved')}
                              >
                                <CheckCircle className="w-4 h-4 mr-2" />
                                Reactivate
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </div>
      </AdminLayout>
    </AdminGuard>
  );
};

export default AdminDrivers;
