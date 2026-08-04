import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MapPin, Plus, X, GripVertical } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface RideStop {
  id: string;
  address: string;
  lat: number;
  lng: number;
}

interface MultiStopInputProps {
  stops: RideStop[];
  onAddStop: () => void;
  onRemoveStop: (id: string) => void;
  onStopClick: (id: string) => void;
  maxStops?: number;
}

export default function MultiStopInput({
  stops,
  onAddStop,
  onRemoveStop,
  onStopClick,
  maxStops = 3,
}: MultiStopInputProps) {
  if (stops.length === 0 && maxStops > 0) {
    return (
      <motion.button
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        onClick={onAddStop}
        className="w-full flex items-center gap-2 justify-center text-[13px] font-medium text-foreground/80 hover:text-primary py-2.5 transition-colors"
      >
        <Route className="h-4 w-4 text-primary" />
        Add a stop
      </motion.button>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest px-1">
        Stops ({stops.length}/{maxStops})
      </p>
      <AnimatePresence>
        {stops.map((stop, i) => (
          <motion.div
            key={stop.id}
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0, marginBottom: 0 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            className="flex items-center gap-2"
          >
            <div className="flex flex-col items-center shrink-0">
              <div className="w-6 h-6 rounded-full bg-accent/20 flex items-center justify-center">
                <span className="text-[10px] font-bold text-accent-foreground">{i + 1}</span>
              </div>
              {i < stops.length - 1 && (
                <div className="w-px h-4 bg-border" />
              )}
            </div>

            <button
              onClick={() => onStopClick(stop.id)}
              className="flex-1 flex items-center gap-2 px-3 py-2.5 rounded-xl glass-card active:scale-[0.98] transition-all text-left"
            >
              <MapPin className="w-3.5 h-3.5 text-accent shrink-0" />
              <span className={cn(
                'text-sm font-medium truncate',
                stop.address ? 'text-foreground' : 'text-muted-foreground'
              )}>
                {stop.address || `Stop ${i + 1}`}
              </span>
            </button>

            <button
              onClick={() => onRemoveStop(stop.id)}
              className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-destructive/10 transition-colors shrink-0"
            >
              <X className="w-3.5 h-3.5 text-muted-foreground" />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>

      {stops.length < maxStops && (
        <motion.button
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          onClick={onAddStop}
          className="w-full flex items-center gap-2 justify-center text-sm text-primary hover:text-primary/80 py-2 transition-colors"
        >
          <Plus className="h-4 w-4" />
          Add another stop
        </motion.button>
      )}
    </div>
  );
}
