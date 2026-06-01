import { useState, useMemo } from "react";
import { useAuth } from "@/hooks/useAuth";
import { cancelRide } from "@/lib/backendClient";
import { Button } from "@/components/ui/button";
import { AlertTriangle, X, Clock } from "lucide-react";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";

interface CancellationPolicyProps {
  rideId: string;
  rideStatus: string;
  driverAcceptedAt?: string | null;
  onCancelled: () => void;
}

const FREE_CANCEL_WINDOW_MS = 3 * 60 * 1000;
const CANCELLATION_FEE = 1.00;

export default function CancellationPolicy({ rideId, driverAcceptedAt, onCancelled }: CancellationPolicyProps) {
  const { user } = useAuth();
  const [showConfirm, setShowConfirm] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const { isFree, elapsedMinutes } = useMemo(() => {
    if (!driverAcceptedAt) return { isFree: true, elapsedMinutes: 0 };
    const elapsed = Date.now() - new Date(driverAcceptedAt).getTime();
    return {
      isFree: elapsed < FREE_CANCEL_WINDOW_MS,
      elapsedMinutes: Math.floor(elapsed / 60000),
    };
  }, [driverAcceptedAt, showConfirm]);

  const handleCancel = async () => {
    if (!user || cancelling) return;
    setCancelling(true);
    try {
      await cancelRide(rideId, {
        reason: driverAcceptedAt ? `Cancelled ${elapsedMinutes} min after driver accepted` : "Rider cancelled",
      });

      toast.info(isFree ? "Ride cancelled - no fee" : `Ride cancelled - $${CANCELLATION_FEE.toFixed(2)} fee applied`);
      onCancelled();
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Unknown error";
      toast.error("Failed to cancel", { description: message });
    } finally {
      setCancelling(false);
      setShowConfirm(false);
    }
  };

  return (
    <>
      <Button
        variant="outline"
        className="w-full border-destructive/30 text-destructive hover:bg-destructive hover:text-destructive-foreground rounded-2xl h-12"
        onClick={() => setShowConfirm(true)}
      >
        <X className="h-4 w-4 mr-2" />
        Cancel Ride
      </Button>

      <AnimatePresence>
        {showConfirm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[9999] bg-black/60 backdrop-blur-sm flex items-end justify-center p-3"
          >
            <motion.div
              initial={{ y: 300, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 300, opacity: 0 }}
              transition={{ type: "spring", damping: 25, stiffness: 300 }}
              className="w-full max-w-md bg-background rounded-3xl p-5 space-y-4"
            >
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center">
                  <AlertTriangle className="h-6 w-6 text-destructive" />
                </div>
                <div>
                  <h3 className="font-bold text-foreground text-lg">Cancel this ride?</h3>
                  {driverAcceptedAt && (
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      Driver accepted {elapsedMinutes} min ago
                    </p>
                  )}
                </div>
              </div>

              <div className={`rounded-2xl p-4 ${isFree ? "bg-accent/10 border border-accent/20" : "bg-destructive/5 border-2 border-destructive/20"}`}>
                {isFree ? (
                  <div className="text-center">
                    <p className="text-sm font-bold text-accent">Cancel for free</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Free cancellation within 3 minutes of driver acceptance
                    </p>
                  </div>
                ) : (
                  <div className="text-center">
                    <p className="text-sm font-semibold text-destructive mb-1">Cancellation fee applies</p>
                    <p className="text-3xl font-black text-destructive">${CANCELLATION_FEE.toFixed(2)}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      The free cancellation window (3 min) has passed
                    </p>
                  </div>
                )}
              </div>

              <div className="flex gap-3">
                <Button
                  variant="destructive"
                  className="flex-1 h-12 rounded-2xl font-bold"
                  onClick={handleCancel}
                  disabled={cancelling}
                >
                  {cancelling ? "Cancelling..." : isFree ? "Cancel Ride" : `Cancel & Pay $${CANCELLATION_FEE.toFixed(2)}`}
                </Button>
                <Button
                  variant="outline"
                  className="flex-1 h-12 rounded-2xl font-bold"
                  onClick={() => setShowConfirm(false)}
                >
                  Keep Ride
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
