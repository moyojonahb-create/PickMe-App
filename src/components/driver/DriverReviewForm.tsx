import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, Edit3, CheckCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { upsertDriverApplication } from '@/lib/businessApi';

interface ReviewData {
  personal: {
    fullName: string;
    phone: string;
    email: string;
    city: string;
    nationalId: string;
  };
  vehicle: {
    carMake: string;
    carModel: string;
    carYear: number;
    plateNumber: string;
    vehicleColor: string;
    seats: number;
  };
  files: Record<string, File | null>;
}

export default function DriverReviewForm({ data, onBack }: { data: ReviewData; onBack: () => void }) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user } = useAuth();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async () => {
    setIsSubmitting(true);
    try {
      if (!user) throw new Error('Not logged in');

      await upsertDriverApplication({
        profile: {
          full_name: data.personal.fullName,
          phone: data.personal.phone,
        },
        driver: {
          vehicle_make: data.vehicle.carMake,
          vehicle_model: data.vehicle.carModel,
          vehicle_year: data.vehicle.carYear,
          vehicle_color: data.vehicle.vehicleColor,
          plate_number: data.vehicle.plateNumber,
          vehicle_type: 'economy',
          status: 'pending',
          is_online: false,
        },
      });

      // TODO: Upload files to storage
      // ...

      toast({
        title: 'Application submitted!',
        description: 'Your driver application is under review.',
      });

      navigate('/driver');
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to submit application. Try again.',
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="p-4 space-y-6">
      <div className="text-center mb-8">
        <div className="flex items-center gap-2 justify-center mb-2">
          <div className="w-32 h-1 bg-accent rounded-full" />
          <div className="flex-1 h-1 bg-muted rounded-full" />
        </div>
        <div className="text-sm font-medium text-muted-foreground">Step 5 of 6</div>
        <h2 className="text-2xl font-bold mt-2">Review your information</h2>
      </div>

      {/* Personal Info Card */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-lg">Personal details</CardTitle>
          <Edit3 className="w-4 h-4 text-muted-foreground cursor-pointer" onClick={onBack} />
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div><span className="font-medium">Name:</span> {data.personal.fullName}</div>
          <div><span className="font-medium">Phone:</span> {data.personal.phone}</div>
          <div><span className="font-medium">Email:</span> {data.personal.email}</div>
          <div><span className="font-medium">City:</span> {data.personal.city}</div>
          <div><span className="font-medium">National ID:</span> {data.personal.nationalId}</div>
        </CardContent>
      </Card>

      {/* Vehicle Info Card */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-lg">Vehicle details</CardTitle>
          <Edit3 className="w-4 h-4 text-muted-foreground cursor-pointer" onClick={onBack} />
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div><span className="font-medium">Make:</span> {data.vehicle.carMake}</div>
          <div><span className="font-medium">Model:</span> {data.vehicle.carModel}</div>
          <div><span className="font-medium">Year:</span> {data.vehicle.carYear}</div>
          <div><span className="font-medium">Plate:</span> {data.vehicle.plateNumber}</div>
          <div><span className="font-medium">Color:</span> {data.vehicle.vehicleColor}</div>
          <div><span className="font-medium">Seats:</span> {data.vehicle.seats}</div>
        </CardContent>
      </Card>

      {/* Documents Status */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Documents</CardTitle>
          <CardDescription>4 documents uploaded successfully</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {Object.keys(data.files).map((key) => (
            <div key={key} className="flex items-center justify-between text-sm">
              <span>{key.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase())}</span>
              <CheckCircle className="w-5 h-5 text-green-500" />
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="flex gap-3 pt-4">
        <Button type="button" variant="outline" className="flex-1 h-14 rounded-xl" onClick={onBack}>
          Edit
        </Button>
        <Button 
          type="button" 
          className="flex-1 h-14 rounded-xl bg-primary text-primary-foreground" 
          onClick={handleSubmit}
          disabled={isSubmitting}
        >
          {isSubmitting ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin mr-2" />
              Submitting...
            </>
          ) : (
            'Submit application'
          )}
        </Button>
      </div>
    </div>
  );
}


