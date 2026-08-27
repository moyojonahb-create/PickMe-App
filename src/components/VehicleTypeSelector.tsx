/* eslint-disable react-refresh/only-export-components */
import { Car, Truck, Package, MapPinned } from 'lucide-react';
import { cn } from '@/lib/utils';

export type ServiceType = 'ride' | 'intercity' | 'courier' | 'freight';

export interface VehicleType {
  id: ServiceType;
  name: string;
  description: string;
  icon: React.ElementType;
  eta: string;
  priceHint: string;
}

export const VEHICLE_TYPES: VehicleType[] = [
  {
    id: 'ride',
    name: 'CruiXe',
    description: 'Affordable town rides',
    icon: Car,
    eta: '3 min',
    priceHint: '$1.50+',
  },
  {
    id: 'intercity',
    name: 'Intercity',
    description: 'Long-distance between cities',
    icon: MapPinned,
    eta: '15 min',
    priceHint: '$10+',
  },
  {
    id: 'courier',
    name: 'Courier',
    description: 'Small packages & documents',
    icon: Package,
    eta: '5 min',
    priceHint: '$2+',
  },
  {
    id: 'freight',
    name: 'Freight',
    description: 'Large items & bulk deliveries',
    icon: Truck,
    eta: '20 min',
    priceHint: '$15+',
  },
];

interface VehicleTypeSelectorProps {
  selectedType: VehicleType;
  onSelect: (type: VehicleType) => void;
  distanceKm?: number;
  fareUsd?: number;
}

const VehicleTypeSelector = ({ 
  selectedType, 
  onSelect, 
  distanceKm,
  fareUsd,
}: VehicleTypeSelectorProps) => {
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-muted-foreground">Choose service</p>
      <div className="space-y-2">
        {VEHICLE_TYPES.map((vehicle) => {
          const Icon = vehicle.icon;
          const isSelected = selectedType.id === vehicle.id;
          
          return (
            <button
              key={vehicle.id}
              onClick={() => onSelect(vehicle)}
              className={cn(
                "w-full p-3 rounded-xl border-2 transition-all flex items-center gap-3 text-left",
                isSelected 
                  ? "border-accent bg-accent/5" 
                  : "border-border hover:border-muted-foreground/30 hover:bg-secondary/50"
              )}
            >
              <div className={cn(
                "w-12 h-12 rounded-lg flex items-center justify-center shrink-0",
                isSelected ? "bg-accent text-accent-foreground" : "bg-secondary text-muted-foreground"
              )}>
                <Icon className="w-6 h-6" />
              </div>
              
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-foreground">{vehicle.name}</span>
                  <span className="text-xs text-muted-foreground">{vehicle.eta}</span>
                </div>
                <p className="text-sm text-muted-foreground truncate">{vehicle.description}</p>
              </div>
              
              <div className="text-right shrink-0">
                {isSelected && fareUsd ? (
                  <span className="font-bold text-foreground">${fareUsd.toFixed(2)}</span>
                ) : (
                  <span className="text-sm text-muted-foreground">{vehicle.priceHint}</span>
                )}
              </div>
            </button>
          );
        })}
      </div>
      
      {/* Pricing info */}
      <div className="text-xs text-muted-foreground text-center pt-2 border-t border-border">
        {selectedType.id === 'ride' && '$1.50 – $50.00 in town ($0.50 increments)'}
        {selectedType.id === 'intercity' && '$10 – $200 between cities (negotiable)'}
        {selectedType.id === 'courier' && '$2 – $30 for packages'}
        {selectedType.id === 'freight' && '$15 – $500 for bulk deliveries'}
      </div>
    </div>
  );
};

export default VehicleTypeSelector;
