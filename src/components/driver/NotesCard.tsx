import { Quote } from 'lucide-react';

interface NotesCardProps {
  note?: string | null;
}

/** Only renders when the ride actually has a passenger note — there is no
 * "invent a note" fallback. */
export default function NotesCard({ note }: NotesCardProps) {
  if (!note || !note.trim()) return null;

  return (
    <div className="py-2.5">
      <p className="text-[11px] font-semibold text-muted-foreground mb-1 flex items-center gap-1.5">
        <Quote className="w-3 h-3" />
        Notes from Passenger
      </p>
      <p className="text-[13px] text-foreground italic">&ldquo;{note}&rdquo;</p>
    </div>
  );
}
