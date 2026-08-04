import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Calendar, Clock, X } from "lucide-react";

interface ScheduleRideProps {
  scheduledAt: Date | null;
  onSchedule: (date: Date | null) => void;
}

export default function ScheduleRide({ scheduledAt, onSchedule }: ScheduleRideProps) {
  const [showPicker, setShowPicker] = useState(false);

  const now = new Date();
  const minDate = new Date(now.getTime() + 30 * 60 * 1000); // 30 min from now
  const maxDate = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // 7 days

  const formatMin = (d: Date) => d.toISOString().slice(0, 16);

  if (scheduledAt) {
    return (
      <div className="flex items-center justify-between bg-primary/10 rounded-2xl p-3">
        <div className="flex items-center gap-2">
          <Calendar className="h-4 w-4 text-primary" />
          <div>
            <p className="text-sm font-semibold text-foreground">Scheduled ride</p>
            <p className="text-xs text-muted-foreground">
              {scheduledAt.toLocaleDateString()} at {scheduledAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </p>
          </div>
        </div>
        <button
          onClick={() => onSchedule(null)}
          className="p-1.5 hover:bg-muted rounded-full transition-colors"
        >
          <X className="h-4 w-4 text-muted-foreground" />
        </button>
      </div>
    );
  }

  if (showPicker) {
    return (
      <div className="bg-muted rounded-2xl p-3 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-foreground flex items-center gap-2">
            <Clock className="h-4 w-4" /> Pick date & time
          </p>
          <button onClick={() => setShowPicker(false)} className="p-1 hover:bg-background rounded-full">
            <X className="h-4 w-4" />
          </button>
        </div>
        <input
          type="datetime-local"
          min={formatMin(minDate)}
          max={formatMin(maxDate)}
          defaultValue={formatMin(minDate)}
          onChange={(e) => {
            const val = e.target.value;
            if (val) {
              const d = new Date(val);
              if (d > now) onSchedule(d);
            }
          }}
          className="w-full px-3 py-2 rounded-xl border border-border bg-background text-foreground text-sm"
        />
        <p className="text-xs text-muted-foreground">Schedule up to 7 days in advance</p>
      </div>
    );
  }

  return (
    <button
      onClick={() => setShowPicker(true)}
      className="w-full flex items-center gap-2 justify-center text-[13px] font-medium text-foreground/80 hover:text-primary py-2.5 transition-colors"
    >
      <Calendar className="h-4 w-4 text-primary" />
      Schedule for later
    </button>
  );
}
