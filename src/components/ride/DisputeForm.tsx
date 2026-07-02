import { useState } from 'react';
import { AlertTriangle, MessageSquare, DollarSign, Clock, Navigation, Shield, Send, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/hooks/useAuth';
import { submitDispute } from '@/lib/businessApi';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

interface DisputeFormProps {
  rideId: string;
  role?: 'rider' | 'driver';
}

const categories = [
  { id: 'fare_dispute', label: 'Fare Issue', icon: DollarSign, description: 'Incorrect fare or overcharge' },
  { id: 'route_issue', label: 'Route Problem', icon: Navigation, description: 'Driver took a wrong route' },
  { id: 'safety_concern', label: 'Safety Concern', icon: Shield, description: 'Unsafe driving or behavior' },
  { id: 'late_arrival', label: 'Late Arrival', icon: Clock, description: 'Driver arrived very late' },
  { id: 'other', label: 'Other', icon: MessageSquare, description: 'Other issue' },
];

export default function DisputeForm({ rideId, role = 'rider' }: DisputeFormProps) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<string | null>(null);
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!user || !category || !description.trim()) return;
    setSubmitting(true);

    try {
      await submitDispute({
        ride_id: rideId,
        reporter_role: role,
        category,
        description: description.trim(),
      });
      toast.success('Dispute submitted. Our team will review it shortly.');
      setOpen(false);
      setCategory(null);
      setDescription('');
    } catch (err) {
      console.error('Failed to submit dispute:', err);
      toast.error('Failed to submit dispute. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5 text-destructive border-destructive/20">
          <AlertTriangle className="h-3.5 w-3.5" />
          Report Issue
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            Report a Problem
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <p className="text-sm font-medium text-foreground mb-2">What went wrong?</p>
            <div className="grid grid-cols-2 gap-2">
              {categories.map((cat) => (
                <button
                  key={cat.id}
                  onClick={() => setCategory(cat.id)}
                  className={`p-3 rounded-xl border text-left transition-all ${
                    category === cat.id
                      ? 'border-primary bg-primary/5 ring-1 ring-primary'
                      : 'border-border hover:border-primary/30'
                  }`}
                >
                  <cat.icon className={`h-4 w-4 mb-1 ${category === cat.id ? 'text-primary' : 'text-muted-foreground'}`} />
                  <p className="text-xs font-semibold">{cat.label}</p>
                </button>
              ))}
            </div>
          </div>

          {category && (
            <div>
              <p className="text-sm font-medium text-foreground mb-1">Tell us more</p>
              <Textarea
                placeholder="Describe the issue in detail..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                maxLength={500}
              />
              <p className="text-xs text-muted-foreground mt-1 text-right">{description.length}/500</p>
            </div>
          )}

          <Button
            className="w-full gap-2"
            disabled={!category || description.trim().length < 10 || submitting}
            onClick={handleSubmit}
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Submit Report
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
