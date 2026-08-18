import { useState } from "react";
import { Star, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { submitDriverRating } from "@/lib/businessApi";
import { toast } from "sonner";
import TippingModal from "./TippingModal";

interface DriverRatingModalProps {
  rideId: string;
  driverId: string; // drivers table ID
  riderId: string;
  driverName?: string;
  driverAvatar?: string;
  fare?: number;
  onClose: () => void;
}

export default function DriverRatingModal({
  rideId,
  driverId,
  riderId,
  driverName,
  driverAvatar,
  fare,
  onClose,
}: DriverRatingModalProps) {
  const [rating, setRating] = useState(0);
  const [hovered, setHovered] = useState(0);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [showTipping, setShowTipping] = useState(false);

  const handleSubmit = async () => {
    if (rating === 0) {
      toast.error("Please select a rating");
      return;
    }

    setSubmitting(true);
    try {
      await submitDriverRating({
        ride_id: rideId,
        driver_id: driverId,
        rating,
        comment: comment.trim() || null,
      });

      toast.success("Thanks for rating your driver!");
      // Show tipping modal after successful rating
      if (fare && fare > 0) {
        setShowTipping(true);
      } else {
        onClose();
      }
    } catch (e: unknown) {
      if ((e as Error).message?.includes("duplicate") || (e as Error).message?.includes("unique")) {
        toast.info("You've already rated this ride");
        onClose();
      } else {
        const message = e instanceof Error ? e.message : 'Unknown error';
        toast.error("Failed to submit rating", { description: message });
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (showTipping) {
    return (
      <TippingModal
        rideId={rideId}
        riderId={riderId}
        driverId={driverId}
        fare={fare || 0}
        driverName={driverName}
        driverAvatar={driverAvatar}
        onClose={onClose}
      />
    );
  }

  return (
    <div className="fixed inset-0 z-[9999] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-background rounded-3xl p-6 space-y-5 animate-in zoom-in-95">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-black text-foreground">Rate Your Driver</h2>
          <button
            onClick={onClose}
            className="p-2 rounded-full hover:bg-muted transition-colors"
          >
            <X className="h-5 w-5 text-muted-foreground" />
          </button>
        </div>

        {driverName && (
          <p className="text-sm text-muted-foreground text-center">
            How was your ride with <span className="font-semibold text-foreground">{driverName}</span>?
          </p>
        )}

        {/* Star Rating */}
        <div className="flex items-center justify-center gap-2">
          {[1, 2, 3, 4, 5].map((star) => (
            <button
              key={star}
              type="button"
              onClick={() => setRating(star)}
              onMouseEnter={() => setHovered(star)}
              onMouseLeave={() => setHovered(0)}
              className="p-1 transition-transform hover:scale-110"
            >
              <Star
                className={`h-10 w-10 transition-colors ${
                  star <= (hovered || rating)
                    ? "fill-yellow-400 text-yellow-400"
                    : "text-muted-foreground/30"
                }`}
              />
            </button>
          ))}
        </div>

        <p className="text-center text-sm font-semibold text-foreground">
          {rating === 0
            ? "Tap a star"
            : rating <= 2
            ? "We're sorry 😔"
            : rating <= 3
            ? "Fair enough"
            : rating <= 4
            ? "Great ride! 👍"
            : "Excellent! ⭐"}
        </p>

        <Textarea
          placeholder="Leave a comment (optional)"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          rows={3}
          className="resize-none"
        />

        <Button
          className="w-full"
          onClick={handleSubmit}
          disabled={rating === 0 || submitting}
        >
          {submitting ? "Submitting…" : "Submit Rating"}
        </Button>
      </div>
    </div>
  );
}
