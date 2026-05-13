import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabaseClient';
import { toast } from 'sonner';

export interface PricingSettings {
  id: string;
  base_fare: number;
  per_km_rate: number;
  min_fare: number;
  max_town_fare: number;
  fixed_town_fare: number;
  town_radius_km: number;
  peak_multiplier: number;
  night_multiplier: number;
  gwanda_cbd_lat: number;
  gwanda_cbd_lng: number;
  updated_at: string;
  updated_by: string | null;
}

export const usePricingSettings = () => {
  return useQuery({
    queryKey: ['pricing-settings'],
    queryFn: async (): Promise<PricingSettings> => {
      const { data, error } = await supabase
        .from('pricing_settings')
        .select('*')
        .limit(1)
        .maybeSingle();

      if (error) throw error;

      // Return defaults if no settings exist
      if (!data) {
        return {
          id: '',
          base_fare: 20,
          per_km_rate: 10,
          min_fare: 25,
          max_town_fare: 50,
          fixed_town_fare: 50,
          town_radius_km: 5,
          peak_multiplier: 1.2,
          night_multiplier: 1.3,
          gwanda_cbd_lat: -20.933,
          gwanda_cbd_lng: 29.013,
          updated_at: new Date().toISOString(),
          updated_by: null,
        };
      }

      return data as PricingSettings;
    },
    staleTime: 1000 * 60 * 15, // Cache for 15 minutes — pricing rarely changes
    gcTime: 1000 * 60 * 30,
  });
};

export const useUpdatePricingSettings = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (settings: Partial<PricingSettings>) => {
      const { data: user } = await supabase.auth.getUser();
      
      const { data, error } = await supabase
        .from('pricing_settings')
        .update({
          ...settings,
          updated_by: user.user?.id,
        })
        .select()
        .maybeSingle();

      if (error) throw error;
      if (!data) throw new Error('Pricing settings not found');
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pricing-settings'] });
      toast.success('Pricing settings saved successfully');
    },
    onError: (error) => {
      console.error('Failed to save pricing settings:', error);
      toast.error('Failed to save pricing settings. Make sure you have admin access.');
    },
  });
};
