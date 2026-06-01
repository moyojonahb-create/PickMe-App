import { useState, useEffect } from 'react';
import { Star, MapPin, Trash2, Plus, Loader2, Home, Briefcase, AlertCircle } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL, supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';

interface FavoriteLocation {
  id: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  icon: string;
}

interface FavoritesSheetProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectLocation?: (location: FavoriteLocation) => void;
}

const iconMap: Record<string, React.ElementType> = {
  home: Home,
  work: Briefcase,
  star: Star,
};

const geocodeAddress = async (address: string): Promise<{ latitude: number; longitude: number; formattedAddress: string } | null> => {
  try {
    const url = new URL(`${SUPABASE_URL}/functions/v1/nominatim-search`);
    url.searchParams.set('q', address);
    url.searchParams.set('limit', '1');
    url.searchParams.set('countrycodes', 'zw');

    const response = await fetch(url.toString(), {
      headers: {
        apikey: SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
      },
    });

    if (!response.ok) {
      console.error('Geocoding error:', response.status, await response.text());
      return null;
    }

    const [result] = await response.json();
    const latitude = Number(result?.lat);
    const longitude = Number(result?.lon);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

    return {
      latitude,
      longitude,
      formattedAddress: result.display_name || address
    };
  } catch (err) {
    console.error('Failed to geocode address:', err);
    return null;
  }
};

const FavoritesSheet = ({ isOpen, onClose, onSelectLocation }: FavoritesSheetProps) => {
  const { user } = useAuth();
  const [favorites, setFavorites] = useState<FavoriteLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newAddress, setNewAddress] = useState('');
  const [saving, setSaving] = useState(false);
  const [geocodeError, setGeocodeError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen && user) {
      fetchFavorites();
    }
  }, [isOpen, user]);

  const fetchFavorites = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('favorite_locations')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      toast.error('Failed to load favorites');
      console.error(error);
    } else {
      setFavorites(data || []);
    }
    setLoading(false);
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase
      .from('favorite_locations')
      .delete()
      .eq('id', id);

    if (error) {
      toast.error('Failed to delete location');
    } else {
      setFavorites(prev => prev.filter(f => f.id !== id));
      toast.success('Location removed');
    }
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    setSaving(true);
    setGeocodeError(null);

    // Geocode the address using the deployed Nominatim Edge Function.
    const geocoded = await geocodeAddress(newAddress);
    
    if (!geocoded) {
      setGeocodeError('Could not find this address. Please try a more specific address.');
      setSaving(false);
      return;
    }

    const { data, error } = await supabase
      .from('favorite_locations')
      .insert({
        user_id: user.id,
        name: newName,
        address: geocoded.formattedAddress,
        latitude: geocoded.latitude,
        longitude: geocoded.longitude,
        icon: newName.toLowerCase().includes('home') ? 'home' : 
              newName.toLowerCase().includes('work') || newName.toLowerCase().includes('office') ? 'work' : 'star'
      })
      .select()
      .single();

    if (error) {
      toast.error('Failed to add location');
    } else {
      setFavorites(prev => [data, ...prev]);
      setNewName('');
      setNewAddress('');
      setShowAddForm(false);
      toast.success('Location saved!');
    }
    setSaving(false);
  };

  const handleSelect = (location: FavoriteLocation) => {
    if (onSelectLocation) {
      onSelectLocation(location);
      onClose();
    }
  };

  return (
    <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Star className="w-5 h-5" />
            Favorite Locations
          </SheetTitle>
        </SheetHeader>

        <div className="mt-6 space-y-4">
          {!showAddForm ? (
            <Button 
              onClick={() => setShowAddForm(true)}
              variant="outline"
              className="w-full"
            >
              <Plus className="w-4 h-4 mr-2" />
              Add new location
            </Button>
          ) : (
            <form onSubmit={handleAdd} className="space-y-4 p-4 border border-border rounded-lg">
              <div>
                <Label htmlFor="name">Name</Label>
                <Input
                  id="name"
                  placeholder="e.g., Home, Work, Gym"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="mt-1"
                  required
                />
              </div>
              <div>
                <Label htmlFor="address">Address</Label>
                <Input
                  id="address"
                  placeholder="Enter full address"
                  value={newAddress}
                  onChange={(e) => {
                    setNewAddress(e.target.value);
                    setGeocodeError(null);
                  }}
                  className="mt-1"
                  required
                />
                {geocodeError && (
                  <div className="flex items-center gap-2 mt-2 text-sm text-destructive">
                    <AlertCircle className="w-4 h-4" />
                    {geocodeError}
                  </div>
                )}
              </div>
              <div className="flex gap-2">
                <Button 
                  type="button" 
                  variant="outline" 
                  onClick={() => {
                    setShowAddForm(false);
                    setGeocodeError(null);
                  }}
                  className="flex-1"
                >
                  Cancel
                </Button>
                <Button type="submit" className="flex-1" disabled={saving}>
                  {saving && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
                  {saving ? 'Finding location...' : 'Save'}
                </Button>
              </div>
            </form>
          )}

          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : favorites.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <MapPin className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p>No favorite locations yet</p>
              <p className="text-sm">Save places you visit often for quick access</p>
            </div>
          ) : (
            <div className="space-y-2">
              {favorites.map((location) => {
                const Icon = iconMap[location.icon] || Star;
                return (
                  <div
                    key={location.id}
                    className="flex items-center gap-3 p-3 border border-border rounded-lg hover:bg-secondary/50 transition-colors group"
                  >
                    <button
                      onClick={() => handleSelect(location)}
                      className="flex-1 flex items-center gap-3 text-left"
                    >
                      <div className="w-10 h-10 rounded-full bg-secondary flex items-center justify-center">
                        <Icon className="w-5 h-5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{location.name}</p>
                        <p className="text-sm text-muted-foreground truncate">
                          {location.address}
                        </p>
                      </div>
                    </button>
                    <button
                      onClick={() => handleDelete(location.id)}
                      className="p-2 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
};

export default FavoritesSheet;
