import { useEffect, useState } from 'react';
import { 
  Search, 
  Plus, 
  MoreHorizontal, 
  Edit, 
  Trash2,
  MapPin,
  Loader2
} from 'lucide-react';
import AdminLayout from '@/components/admin/AdminLayout';
import AdminGuard from '@/components/admin/AdminGuard';
import { validateLandmarkForm } from '@/lib/landmarkValidation';
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
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
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { supabase } from '@/lib/supabaseClient';
import { adminDeleteRow, adminInsertRow, adminUpdateRow } from '@/lib/businessApi';
import { toast } from 'sonner';

interface Landmark {
  id: string;
  name: string;
  category: string;
  latitude: number;
  longitude: number;
  description: string | null;
  keywords: string[] | null;
  is_active: boolean;
  created_at: string;
}

interface LandmarkForm {
  name: string;
  category: string;
  latitude: string;
  longitude: string;
  description: string;
  keywords: string;
}

const categories = [
  'Rank',
  'Hospital',
  'School',
  'Market',
  'Shopping',
  'Government',
  'Transport',
  'Residential',
  'Business',
  'Other'
];

const AdminLandmarks = () => {
  const [landmarks, setLandmarks] = useState<Landmark[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<LandmarkForm>({
    name: '',
    category: 'Other',
    latitude: '',
    longitude: '',
    description: '',
    keywords: '',
  });

  const fetchLandmarks = async () => {
    try {
      let query = supabase
        .from('koloi_landmarks')
        .select('*')
        .order('name', { ascending: true });

      if (categoryFilter !== 'all') {
        query = query.eq('category', categoryFilter);
      }

      const { data, error } = await query;

      if (error) throw error;
      setLandmarks(data || []);
    } catch (error) {
      console.error('Error fetching landmarks:', error);
      toast.error('Failed to load landmarks');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLandmarks();
  }, [categoryFilter]);

  const resetForm = () => {
    setForm({
      name: '',
      category: 'Other',
      latitude: '',
      longitude: '',
      description: '',
      keywords: '',
    });
    setEditingId(null);
  };

  const handleEdit = (landmark: Landmark) => {
    setForm({
      name: landmark.name,
      category: landmark.category,
      latitude: String(landmark.latitude),
      longitude: String(landmark.longitude),
      description: landmark.description || '',
      keywords: landmark.keywords?.join(', ') || '',
    });
    setEditingId(landmark.id);
    setDialogOpen(true);
  };

  const handleSave = async () => {
    // Validate form with comprehensive validation
    const validation = validateLandmarkForm(form);
    
    if (validation.success === false) {
      toast.error(validation.error);
      return;
    }

    setSaving(true);
    try {
      const landmarkData = validation.data;

      if (editingId) {
        await adminUpdateRow('koloi_landmarks', editingId, landmarkData as unknown as Record<string, unknown>);
        toast.success('Landmark updated');
      } else {
        await adminInsertRow('koloi_landmarks', landmarkData as unknown as Record<string, unknown>);
        toast.success('Landmark created');
      }

      setDialogOpen(false);
      resetForm();
      fetchLandmarks();
    } catch (error) {
      console.error('Error saving landmark:', error);
      toast.error('Failed to save landmark');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await adminDeleteRow('koloi_landmarks', id);
      toast.success('Landmark deleted');
      fetchLandmarks();
    } catch (error) {
      console.error('Error deleting landmark:', error);
      toast.error('Failed to delete landmark');
    }
  };

  const filteredLandmarks = landmarks.filter(landmark => {
    if (!search) return true;
    const searchLower = search.toLowerCase();
    return (
      landmark.name.toLowerCase().includes(searchLower) ||
      landmark.category.toLowerCase().includes(searchLower) ||
      landmark.keywords?.some(k => k.toLowerCase().includes(searchLower))
    );
  });

  return (
    <AdminGuard>
      <AdminLayout>
        <div className="space-y-6">
          {/* Header */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-foreground">Landmarks</h1>
              <p className="text-muted-foreground">Manage pickup and dropoff location suggestions</p>
            </div>
            <Dialog open={dialogOpen} onOpenChange={(open) => {
              setDialogOpen(open);
              if (!open) resetForm();
            }}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="w-4 h-4 mr-2" />
                  Add Landmark
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{editingId ? 'Edit Landmark' : 'Add Landmark'}</DialogTitle>
                  <DialogDescription>
                    {editingId ? 'Update the landmark details' : 'Add a new landmark for location suggestions'}
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                  <div>
                    <Label htmlFor="name">Name *</Label>
                    <Input
                      id="name"
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                      placeholder="e.g., Gwanda CBD Rank"
                    />
                  </div>
                  <div>
                    <Label htmlFor="category">Category</Label>
                    <Select 
                      value={form.category} 
                      onValueChange={(v) => setForm({ ...form, category: v })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {categories.map((cat) => (
                          <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="latitude">Latitude *</Label>
                      <Input
                        id="latitude"
                        type="number"
                        step="any"
                        value={form.latitude}
                        onChange={(e) => setForm({ ...form, latitude: e.target.value })}
                        placeholder="-20.9389"
                      />
                    </div>
                    <div>
                      <Label htmlFor="longitude">Longitude *</Label>
                      <Input
                        id="longitude"
                        type="number"
                        step="any"
                        value={form.longitude}
                        onChange={(e) => setForm({ ...form, longitude: e.target.value })}
                        placeholder="29.0147"
                      />
                    </div>
                  </div>
                  <div>
                    <Label htmlFor="description">Description</Label>
                    <Input
                      id="description"
                      value={form.description}
                      onChange={(e) => setForm({ ...form, description: e.target.value })}
                      placeholder="Optional description"
                    />
                  </div>
                  <div>
                    <Label htmlFor="keywords">Keywords (comma-separated)</Label>
                    <Input
                      id="keywords"
                      value={form.keywords}
                      onChange={(e) => setForm({ ...form, keywords: e.target.value })}
                      placeholder="taxi, transport, bus"
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setDialogOpen(false)}>
                    Cancel
                  </Button>
                  <Button onClick={handleSave} disabled={saving}>
                    {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                    {editingId ? 'Update' : 'Create'}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>

          {/* Filters */}
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search landmarks..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder="Category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                {categories.map((cat) => (
                  <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                ))}
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
            ) : filteredLandmarks.length === 0 ? (
              <div className="p-12 text-center">
                <MapPin className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                <h3 className="font-medium text-foreground mb-1">No landmarks found</h3>
                <p className="text-sm text-muted-foreground">
                  {search || categoryFilter !== 'all'
                    ? 'Try adjusting your filters'
                    : 'Add landmarks to help riders find locations'}
                </p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Coordinates</TableHead>
                    <TableHead>Keywords</TableHead>
                    <TableHead className="w-[50px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredLandmarks.map((landmark) => (
                    <TableRow key={landmark.id}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <MapPin className="w-4 h-4 text-accent" />
                          <div>
                            <p className="font-medium">{landmark.name}</p>
                            {landmark.description && (
                              <p className="text-sm text-muted-foreground truncate max-w-[200px]">
                                {landmark.description}
                              </p>
                            )}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">{landmark.category}</Badge>
                      </TableCell>
                      <TableCell>
                        <span className="text-sm text-muted-foreground font-mono">
                          {landmark.latitude.toFixed(4)}, {landmark.longitude.toFixed(4)}
                        </span>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1 max-w-[200px]">
                          {landmark.keywords?.slice(0, 3).map((keyword, i) => (
                            <Badge key={i} variant="outline" className="text-xs">
                              {keyword}
                            </Badge>
                          ))}
                          {(landmark.keywords?.length || 0) > 3 && (
                            <Badge variant="outline" className="text-xs">
                              +{(landmark.keywords?.length || 0) - 3}
                            </Badge>
                          )}
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
                            <DropdownMenuItem onClick={() => handleEdit(landmark)}>
                              <Edit className="w-4 h-4 mr-2" />
                              Edit
                            </DropdownMenuItem>
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <DropdownMenuItem 
                                  onSelect={(e) => e.preventDefault()}
                                  className="text-red-600"
                                >
                                  <Trash2 className="w-4 h-4 mr-2" />
                                  Delete
                                </DropdownMenuItem>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Delete Landmark</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    Are you sure you want to delete "{landmark.name}"? This action cannot be undone.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                                  <AlertDialogAction
                                    onClick={() => handleDelete(landmark.id)}
                                    className="bg-red-600 hover:bg-red-700"
                                  >
                                    Delete
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
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

export default AdminLandmarks;
