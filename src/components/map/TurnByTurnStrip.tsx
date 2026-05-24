import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowUp, CornerUpLeft, CornerUpRight, RotateCw, Flag, Navigation2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  getDetailedRoute,
  getManeuverInstruction,
  findCurrentStep,
  type RouteStep,
} from '@/lib/osrmSteps';
import type { Coordinates } from '@/lib/osrm';

interface Props {
  origin: Coordinates | null;
  destination: Coordinates | null;
  className?: string;
  /** Show a short subtitle (distance to next maneuver). */
  showDistance?: boolean;
}

function pickIcon(step: RouteStep) {
  const m = step.maneuver;
  if (m.type === 'arrive') return Flag;
  if (m.type === 'roundabout') return RotateCw;
  if (m.type === 'turn' && m.modifier?.includes('left')) return CornerUpLeft;
  if (m.type === 'turn' && m.modifier?.includes('right')) return CornerUpRight;
  if (m.type === 'depart') return Navigation2;
  return ArrowUp;
}

/**
 * Floating top-of-map strip showing the current turn-by-turn instruction.
 * Fetches a detailed OSRM route once per origin/destination pair and re-resolves
 * the current step as the user moves. Silent when no route or no upcoming step.
 */
export default function TurnByTurnStrip({ origin, destination, className, showDistance = true }: Props) {
  const [steps, setSteps] = useState<RouteStep[]>([]);
  const [routeKey, setRouteKey] = useState<string>('');

  // Refetch detailed steps only when destination changes meaningfully (~25m).
  useEffect(() => {
    if (!origin || !destination) {
      setSteps([]);
      return;
    }
    const key = `${destination.lat.toFixed(4)},${destination.lng.toFixed(4)}`;
    if (key === routeKey && steps.length > 0) return;
    let cancelled = false;
    getDetailedRoute(origin, destination)
      .then((r) => {
        if (cancelled) return;
        setSteps(r?.steps ?? []);
        setRouteKey(key);
      })
      .catch(() => !cancelled && setSteps([]));
    return () => {
      cancelled = true;
    };
    // intentionally only depends on destination — origin changes too often
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [destination?.lat, destination?.lng]);

  if (!origin || steps.length === 0) return null;

  const { stepIndex, distanceToNextManeuver } = findCurrentStep(steps, origin);
  const current = steps[stepIndex];
  if (!current) return null;

  const Icon = pickIcon(current);
  const instruction = getManeuverInstruction(current);
  const distStr =
    distanceToNextManeuver >= 1000
      ? `${(distanceToNextManeuver / 1000).toFixed(1)} km`
      : `${Math.max(10, Math.round(distanceToNextManeuver / 10) * 10)} m`;

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={`${stepIndex}-${instruction}`}
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        transition={{ duration: 0.25 }}
        className={cn(
          'mx-auto max-w-md flex items-center gap-3 rounded-2xl bg-slate-900/85 backdrop-blur-xl text-white px-3.5 py-2.5 shadow-[0_10px_30px_rgba(0,0,0,0.35)] border border-white/10',
          className,
        )}
        role="status"
        aria-live="polite"
      >
        <div className="h-10 w-10 shrink-0 rounded-xl bg-primary/90 flex items-center justify-center">
          <Icon className="h-5 w-5" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[15px] font-bold leading-tight truncate">{instruction}</p>
          {showDistance && (
            <p className="text-[11px] font-medium text-white/70 mt-0.5 tabular-nums">in {distStr}</p>
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
