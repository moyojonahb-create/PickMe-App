import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { Loader2, Check, Car, MapPin, Navigation, Radio } from 'lucide-react';

export type RideStatus =
  | 'idle'
  | 'searching'
  | 'offers_received'
  | 'driver_assigned'
  | 'driver_arriving'
  | 'driver_arrived'
  | 'in_progress'
  | 'completed';

interface RideStatusBannerProps {
  status: RideStatus;
  driverName?: string;
  eta?: number;
  offersCount?: number;
  className?: string;
}

const STATUS_CONFIG: Record<RideStatus, {
  icon: React.ReactNode;
  label: string;
  color: string;
  pulse?: boolean;
}> = {
  idle: { icon: <MapPin className="w-4 h-4" />, label: 'Where to?', color: 'bg-secondary text-secondary-foreground' },
  searching: {
    icon: <Radio className="w-4 h-4" />,
    label: 'Finding drivers nearby...',
    color: 'bg-primary text-primary-foreground',
    pulse: true,
  },
  offers_received: {
    icon: <Car className="w-4 h-4" />,
    label: 'Offers received',
    color: 'bg-accent text-accent-foreground',
    pulse: true,
  },
  driver_assigned: { icon: <Check className="w-4 h-4" />, label: 'Driver assigned', color: 'bg-accent text-accent-foreground' },
  driver_arriving: { icon: <Car className="w-4 h-4" />, label: 'Driver on the way', color: 'bg-primary text-primary-foreground', pulse: true },
  driver_arrived: { icon: <Check className="w-4 h-4" />, label: 'Driver has arrived', color: 'bg-accent text-accent-foreground', pulse: true },
  in_progress: { icon: <Navigation className="w-4 h-4" />, label: 'Trip in progress', color: 'bg-primary text-primary-foreground' },
  completed: { icon: <Check className="w-4 h-4" />, label: 'Trip completed', color: 'bg-accent text-accent-foreground' },
};

export default function RideStatusBanner({ status, driverName, eta, offersCount, className }: RideStatusBannerProps) {
  if (status === 'idle') return null;

  const config = STATUS_CONFIG[status];

  const getLabel = () => {
    if (status === 'offers_received' && offersCount) return `${offersCount} offer${offersCount > 1 ? 's' : ''} received`;
    if (status === 'driver_arriving' && eta) return `${driverName || 'Driver'} arriving in ${eta} min`;
    if (status === 'driver_arrived' && driverName) return `${driverName} has arrived`;
    if (status === 'in_progress' && driverName) return `On trip with ${driverName}`;
    return config.label;
  };

  return (
    <motion.div
      initial={{ y: -10, opacity: 0, scale: 0.97 }}
      animate={{ y: 0, opacity: 1, scale: 1 }}
      exit={{ y: -10, opacity: 0, scale: 0.97 }}
      transition={{ type: 'spring', stiffness: 400, damping: 25 }}
      className={cn(
        'flex items-center gap-2.5 px-4 py-3 rounded-2xl font-medium text-sm shadow-cruixe-sm',
        config.color,
        className
      )}
    >
      {config.pulse ? (
        <motion.div
          animate={{ scale: [1, 1.2, 1], opacity: [1, 0.7, 1] }}
          transition={{ repeat: Infinity, duration: 1.5 }}
        >
          {config.icon}
        </motion.div>
      ) : config.icon}
      <span className="flex-1">{getLabel()}</span>
      {status === 'searching' && (
        <motion.div
          className="flex gap-1"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
        >
          {[0, 1, 2].map(i => (
            <motion.div
              key={i}
              className="w-1.5 h-1.5 rounded-full bg-current"
              animate={{ opacity: [0.3, 1, 0.3] }}
              transition={{ repeat: Infinity, duration: 1, delay: i * 0.2 }}
            />
          ))}
        </motion.div>
      )}
      {status === 'driver_arriving' && eta && (
        <motion.span
          key={eta}
          initial={{ scale: 1.3 }}
          animate={{ scale: 1 }}
          className="text-xs font-bold opacity-90"
        >
          {eta} min
        </motion.span>
      )}
    </motion.div>
  );
}
