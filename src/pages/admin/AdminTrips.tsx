import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { 
  Search, 
  Filter, 
  MoreHorizontal, 
  Eye, 
  XCircle,
  Navigation,
  MapPin,
  Clock
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { supabase } from '@/lib/supabaseClient';
import { cancelRide } from '@/lib/backendClient';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';

interface Ride {
  id: string;
  user_id: string;
  pickup_address: string;
  dropoff_address: string;
  distance_km: number;
  duration_minutes: number;
  fare: number;
  status: string;
  vehicle_type: string;
  created_at: string;
  rider_name?: string;
  driver_name?: string;
}

const statusColors: Record<string, string> = {
  requested: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  in_progress: 'bg-primary/10 text-primary dark:bg-primary/20 dark:text-primary',
  completed: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  cancelled: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
};

const AdminTrips = () => {
  const [rides, setRides] = useState<Ride[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const fetchRides = async () => {
    try {
      let query = supabase
        .from('rides')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);

      if (statusFilter !== 'all') {
        query = query.eq('status', statusFilter);
      }

      const { data, error } = await query;

      if (error) throw error;
      
      // Fetch rider names
      const ridesWithNames = await Promise.all(
        (data || []).map(async (ride) => {
          const { data: profileData } = await supabase
            .from('profiles')
            .select('full_name')
            .eq('user_id', ride.user_id)
            .maybeSingle();
          
          return {
            ...ride,
            rider_name: profileData?.full_name || 'Unknown Rider'
          };
        })
      );
      
      setRides(ridesWithNames);
    } catch (error) {
      console.error('Error fetching rides:', error);
      toast.error('Failed to load trips');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRides();
  }, [statusFilter]);

  const handleCancelTrip = async (rideId: string) => {
    setCancellingId(rideId);
    try {
      await cancelRide(rideId, { reason: 'Admin cancelled trip' });

      toast.success('Trip cancelled by admin');
      fetchRides();
    } catch (error) {
      console.error('Error cancelling trip:', error);
      toast.error('Failed to cancel trip');
    } finally {
      setCancellingId(null);
    }
  };

  const filteredRides = rides.filter(ride => {
    if (!search) return true;
    const searchLower = search.toLowerCase();
    return (
      ride.pickup_address.toLowerCase().includes(searchLower) ||
      ride.dropoff_address.toLowerCase().includes(searchLower) ||
      ride.rider_name?.toLowerCase().includes(searchLower)
    );
  });

  return (
    <AdminGuard>
      <AdminLayout>
        <div className="space-y-6">
          {/* Header */}
          <div>
            <h1 className="text-2xl font-bold text-foreground">Trips</h1>
            <p className="text-muted-foreground">Monitor and manage all ride requests</p>
          </div>

          {/* Filters */}
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search by location, rider..."
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
                <SelectItem value="requested">Requested</SelectItem>
                <SelectItem value="in_progress">In Progress</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
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
            ) : filteredRides.length === 0 ? (
              <div className="p-12 text-center">
                <Navigation className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                <h3 className="font-medium text-foreground mb-1">No trips found</h3>
                <p className="text-sm text-muted-foreground">
                  {search || statusFilter !== 'all'
                    ? 'Try adjusting your filters'
                    : 'Trips will appear here once riders book rides'}
                </p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Trip</TableHead>
                    <TableHead>Rider</TableHead>
                    <TableHead>Route</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Fare</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead className="w-[50px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredRides.map((ride) => (
                    <TableRow key={ride.id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Navigation className="w-4 h-4 text-muted-foreground" />
                          <div>
                            <p className="font-medium capitalize">{ride.vehicle_type}</p>
                            <p className="text-sm text-muted-foreground">
                              {ride.distance_km}km • {ride.duration_minutes}min
                            </p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <p className="font-medium">{ride.rider_name}</p>
                      </TableCell>
                      <TableCell>
                        <div className="max-w-[200px]">
                          <div className="flex items-start gap-2">
                            <div className="w-2 h-2 rounded-full bg-foreground mt-1.5 shrink-0" />
                            <p className="text-sm truncate">{ride.pickup_address}</p>
                          </div>
                          <div className="flex items-start gap-2 mt-1">
                            <div className="w-2 h-2 bg-foreground mt-1.5 shrink-0" />
                            <p className="text-sm truncate">{ride.dropoff_address}</p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge className={cn("capitalize", statusColors[ride.status])}>
                          {ride.status.replace('_', ' ')}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <span className="font-medium">${Number(ride.fare).toFixed(2)}</span>
                      </TableCell>
                      <TableCell>
                        <div className="text-sm">
                          <p>{format(new Date(ride.created_at), 'MMM d, yyyy')}</p>
                          <p className="text-muted-foreground">
                            {format(new Date(ride.created_at), 'h:mm a')}
                          </p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon">
                              <MoreHorizontal className="w-4 h-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem asChild>
                              <Link to={`/ride-detail/${ride.id}`}>
                                <Eye className="w-4 h-4 mr-2" />
                                View Details
                              </Link>
                            </DropdownMenuItem>
                            {(ride.status === 'requested' || ride.status === 'in_progress') && (
                              <AlertDialog>
                                <AlertDialogTrigger asChild>
                                  <DropdownMenuItem 
                                    onSelect={(e) => e.preventDefault()}
                                    className="text-red-600"
                                  >
                                    <XCircle className="w-4 h-4 mr-2" />
                                    Cancel Trip
                                  </DropdownMenuItem>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>Cancel Trip</AlertDialogTitle>
                                    <AlertDialogDescription>
                                      Are you sure you want to cancel this trip? This action cannot be undone.
                                    </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel>Keep Trip</AlertDialogCancel>
                                    <AlertDialogAction
                                      onClick={() => handleCancelTrip(ride.id)}
                                      className="bg-red-600 hover:bg-red-700"
                                    >
                                      Cancel Trip
                                    </AlertDialogAction>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
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

export default AdminTrips;
