import { useState, useRef } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Loader2, ChevronLeft, ChevronRight, Plus, Camera, FileText, Car, User, CreditCard } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import CarLoadingSpinner from '@/components/CarLoadingSpinner';
import { createDriverDocument, createDriverApplication } from '@/lib/businessApi';

const TOTAL_STEPS = 4;

const personalSchema = z.object({
  firstName: z.string().min(2, 'First name is required'),
  surname: z.string().min(2, 'Surname is required'),
  dateOfBirth: z.string().min(1, 'Date of birth is required'),
  gender: z.enum(['male', 'female'], { required_error: 'Please select your gender' }),
});

const licenseSchema = z.object({
  licenseNumber: z.string().min(2, 'License number is required'),
  licenseExpiry: z.string().min(1, 'Expiration date is required'),
});

const vehicleSchema = z.object({
  vehicleMake: z.string().min(2, 'Vehicle brand is required'),
  vehicleModel: z.string().min(2, 'Vehicle model is required'),
  vehicleColor: z.string().min(2, 'Vehicle color is required'),
  plateNumber: z.string().min(2, 'Plate number is required'),
  vehicleYear: z.number().min(1990).max(new Date().getFullYear() + 1),
  vehicleType: z.enum(['economy', 'comfort', 'premium', 'suv']),
});

type PersonalData = z.infer<typeof personalSchema>;
type LicenseData = z.infer<typeof licenseSchema>;
type VehicleData = z.infer<typeof vehicleSchema>;

interface DriverRegistrationWizardProps {
  onSuccess: () => void;
  onClose?: () => void;
}

interface FileUploadBoxProps {
  label: string;
  file: File | null;
  onSelect: (file: File) => void;
}

function FileUploadBox({ label, file, onSelect }: FileUploadBoxProps) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className="flex flex-col items-center gap-2">
      <button
        type="button"
        onClick={() => ref.current?.click()}
        className="w-28 h-28 rounded-2xl bg-muted/60 border-2 border-dashed border-border hover:border-accent flex items-center justify-center transition-colors"
      >
        {file ? (
          <img
            src={URL.createObjectURL(file)}
            alt={label}
            className="w-full h-full object-cover rounded-2xl"
          />
        ) : (
          <Plus className="w-8 h-8 text-muted-foreground" />
        )}
      </button>
      <span className="text-xs text-muted-foreground text-center max-w-[7rem]">{label}</span>
      <input
        ref={ref}
        type="file"
        accept="image/*,.pdf"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onSelect(f);
        }}
      />
    </div>
  );
}

export default function DriverRegistrationWizard({ onSuccess, onClose }: DriverRegistrationWizardProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [step, setStep] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isNavigating, setIsNavigating] = useState(false);
  const [showProcessing, setShowProcessing] = useState(false);

  // File state
  const [personalPhoto, setPersonalPhoto] = useState<File | null>(null);
  const [licenseFront, setLicenseFront] = useState<File | null>(null);
  const [licenseBack, setLicenseBack] = useState<File | null>(null);
  const [idCard, setIdCard] = useState<File | null>(null);
  const [selfieWithId, setSelfieWithId] = useState<File | null>(null);
  const [vehiclePhoto, setVehiclePhoto] = useState<File | null>(null);
  const [insuranceDoc, setInsuranceDoc] = useState<File | null>(null);

  const personalForm = useForm<PersonalData>({
    resolver: zodResolver(personalSchema),
    defaultValues: { firstName: '', surname: '', dateOfBirth: '', gender: undefined },
  });

  const licenseForm = useForm<LicenseData>({
    resolver: zodResolver(licenseSchema),
    defaultValues: { licenseNumber: '', licenseExpiry: '' },
  });

  const vehicleForm = useForm<VehicleData>({
    resolver: zodResolver(vehicleSchema),
    defaultValues: {
      vehicleMake: '', vehicleModel: '', vehicleColor: '',
      plateNumber: '', vehicleYear: new Date().getFullYear(), vehicleType: 'economy',
    },
  });

  const uploadFile = async (file: File, folder: string): Promise<string> => {
    if (!user) throw new Error('Not authenticated');
    const ext = file.name.split('.').pop();
    const path = `${user.id}/${folder}_${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from('driver-documents').upload(path, file);
    if (error) throw error;
    return path;
  };

  const handleNext = async () => {
    if (isNavigating || isSubmitting) return;

    setIsNavigating(true);
    try {
      if (step === 1) {
        const valid = await personalForm.trigger();
        if (!valid) return;
      } else if (step === 2) {
        const valid = await licenseForm.trigger();
        if (!valid) return;
      } else if (step === 4) {
        const valid = await vehicleForm.trigger();
        if (!valid) return;
        await handleSubmit();
        return;
      }
      setStep(s => Math.min(s + 1, TOTAL_STEPS));
    } finally {
      setIsNavigating(false);
    }
  };

  const handleBack = () => setStep(s => Math.max(s - 1, 1));

  const handleSubmit = async () => {
    if (!user) return;
    setIsSubmitting(true);
    setShowProcessing(true);

    try {
      const personal = personalForm.getValues();
      const vehicle = vehicleForm.getValues();

      // Create driver record through Go. Storage uploads remain in Supabase.
      const driver = await createDriverApplication({
        vehicle_type: vehicle.vehicleType,
        vehicle_make: vehicle.vehicleMake,
        vehicle_model: vehicle.vehicleModel,
        vehicle_year: vehicle.vehicleYear,
        vehicle_color: vehicle.vehicleColor,
        plate_number: vehicle.plateNumber,
        gender: personal.gender,
        status: 'pending',
      });
      const driverId = driver.id;
      if (!driverId) throw new Error('Failed to create driver application');

      // Upload documents in parallel
      const uploads: Promise<void>[] = [];

      const uploadDoc = async (file: File | null, docType: string) => {
        if (!file) return;
        const path = await uploadFile(file, docType);
        await createDriverDocument({
          driver_id: driverId, document_type: docType, file_url: path, status: 'pending',
        });
      };

      uploads.push(uploadDoc(licenseFront, 'drivers_license'));
      uploads.push(uploadDoc(licenseBack, 'drivers_license_back'));
      uploads.push(uploadDoc(idCard, 'police_clearance')); // maps to existing doc type
      uploads.push(uploadDoc(selfieWithId, 'insurance')); // maps to existing doc type
      uploads.push(uploadDoc(vehiclePhoto, 'vehicle_registration'));
      uploads.push(uploadDoc(insuranceDoc, 'vehicle_insurance'));
      uploads.push(uploadDoc(personalPhoto, 'personal_photo'));

      await Promise.allSettled(uploads);

      // Brief processing animation
      await new Promise(r => setTimeout(r, 2500));

      toast({ title: 'Application submitted!', description: 'Your documents are being reviewed.' });
      onSuccess();
    } catch (error: unknown) {
      let errorMessage = 'Failed to submit application.';
      if (error instanceof Error) {
        const errMsg = error.message.toLowerCase();
        if (errMsg.includes('new row violates row-level security') || errMsg.includes('42501')) {
          errorMessage = 'Permission denied. Please contact support or try admin add-driver.js';
        } else if (errMsg.includes('bucket') || errMsg.includes('storage')) {
          errorMessage = 'Storage upload failed. Check "driver-documents" bucket in Supabase dashboard.';
        } else if (errMsg.includes('column') || errMsg.includes('does not exist')) {
          errorMessage = 'Database schema mismatch. Run migrations.';
        } else {
          errorMessage = error.message;
        }
        console.error('Driver registration error:', error);
      }
      toast({ title: 'Registration Failed', description: errorMessage, variant: 'destructive' });
      setShowProcessing(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (showProcessing) {
    return <CarLoadingSpinner message="Checking all the details — you're almost on your way!" onClose={onClose} />;
  }

  const stepIcons = [
    { icon: User, label: 'Personal' },
    { icon: CreditCard, label: 'License' },
    { icon: FileText, label: 'ID card' },
    { icon: Car, label: 'Vehicle' },
  ];

  return (
    <div className="min-h-[100dvh] bg-background flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
          ✕
        </button>
        <span className="text-xs text-accent font-medium">Help</span>
      </div>

      {/* Content */}
      <div className="flex-1 px-5 py-6 overflow-y-auto">
        <h2 className="text-2xl font-bold text-foreground mb-6">
          {stepIcons[step - 1].label === 'Personal' && 'Personal information'}
          {stepIcons[step - 1].label === 'License' && 'Driver license'}
          {stepIcons[step - 1].label === 'ID card' && 'ID card'}
          {stepIcons[step - 1].label === 'Vehicle' && 'Vehicle information'}
        </h2>

        {/* Step 1: Personal Information */}
        {step === 1 && (
          <Form {...personalForm}>
            <form className="space-y-4">
              <FileUploadBox label="Personal picture" file={personalPhoto} onSelect={setPersonalPhoto} />

              <FormField control={personalForm.control} name="firstName" render={({ field }) => (
                <FormItem>
                  <FormControl>
                    <Input placeholder="First name" className="h-14 rounded-2xl bg-muted/40 border-border" {...field} />
                  </FormControl>
                  <FormMessage className="text-destructive text-xs" />
                </FormItem>
              )} />

              <FormField control={personalForm.control} name="surname" render={({ field }) => (
                <FormItem>
                  <FormControl>
                    <Input placeholder="Surname" className="h-14 rounded-2xl bg-muted/40 border-border" {...field} />
                  </FormControl>
                  <FormMessage className="text-destructive text-xs" />
                </FormItem>
              )} />

              <FormField control={personalForm.control} name="dateOfBirth" render={({ field }) => (
                <FormItem>
                  <FormControl>
                    <Input type="date" placeholder="Date of birth" className="h-14 rounded-2xl bg-muted/40 border-border" {...field} />
                  </FormControl>
                  <FormMessage className="text-destructive text-xs" />
                </FormItem>
              )} />

              <FormField control={personalForm.control} name="gender" render={({ field }) => (
                <FormItem>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger className="h-14 rounded-2xl bg-muted/40 border-border">
                        <SelectValue placeholder="Gender" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="male">Male</SelectItem>
                      <SelectItem value="female">Female</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage className="text-destructive text-xs" />
                </FormItem>
              )} />
            </form>
          </Form>
        )}

        {/* Step 2: Driver License */}
        {step === 2 && (
          <Form {...licenseForm}>
            <form className="space-y-4">
              <div className="flex gap-4">
                <FileUploadBox label="Driver license" file={licenseFront} onSelect={setLicenseFront} />
                <FileUploadBox label="Back side of license" file={licenseBack} onSelect={setLicenseBack} />
              </div>

              <FormField control={licenseForm.control} name="licenseNumber" render={({ field }) => (
                <FormItem>
                  <FormControl>
                    <Input placeholder="License number" className="h-14 rounded-2xl bg-muted/40 border-border" {...field} />
                  </FormControl>
                  <FormMessage className="text-destructive text-xs" />
                </FormItem>
              )} />

              <FormField control={licenseForm.control} name="licenseExpiry" render={({ field }) => (
                <FormItem>
                  <FormControl>
                    <Input type="date" placeholder="Expiration date" className="h-14 rounded-2xl bg-muted/40 border-border" {...field} />
                  </FormControl>
                  <FormMessage className="text-destructive text-xs" />
                </FormItem>
              )} />
            </form>
          </Form>
        )}

        {/* Step 3: ID Card */}
        {step === 3 && (
          <div className="space-y-4">
            <div className="flex gap-4">
              <FileUploadBox label="ID card" file={idCard} onSelect={setIdCard} />
              <FileUploadBox label="Selfie with ID" file={selfieWithId} onSelect={setSelfieWithId} />
            </div>
          </div>
        )}

        {/* Step 4: Vehicle Information */}
        {step === 4 && (
          <Form {...vehicleForm}>
            <form className="space-y-4">
              <div className="flex gap-4">
                <FileUploadBox label="Vehicle picture" file={vehiclePhoto} onSelect={setVehiclePhoto} />
                <FileUploadBox label="Vehicle insurance disc" file={insuranceDoc} onSelect={setInsuranceDoc} />
              </div>

              <FormField control={vehicleForm.control} name="vehicleMake" render={({ field }) => (
                <FormItem>
                  <FormControl>
                    <Input placeholder="Vehicle brand" className="h-14 rounded-2xl bg-muted/40 border-border" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={vehicleForm.control} name="vehicleModel" render={({ field }) => (
                <FormItem>
                  <FormControl>
                    <Input placeholder="Vehicle model" className="h-14 rounded-2xl bg-muted/40 border-border" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={vehicleForm.control} name="vehicleColor" render={({ field }) => (
                <FormItem>
                  <FormControl>
                    <Input placeholder="Vehicle color" className="h-14 rounded-2xl bg-muted/40 border-border" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={vehicleForm.control} name="plateNumber" render={({ field }) => (
                <FormItem>
                  <FormControl>
                    <Input placeholder="Plate number" className="h-14 rounded-2xl bg-muted/40 border-border" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={vehicleForm.control} name="vehicleYear" render={({ field }) => (
                <FormItem>
                  <FormControl>
                    <Input type="number" placeholder="Production year" className="h-14 rounded-2xl bg-muted/40 border-border"
                      {...field} onChange={e => field.onChange(parseInt(e.target.value) || 0)} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={vehicleForm.control} name="vehicleType" render={({ field }) => (
                <FormItem>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger className="h-14 rounded-2xl bg-muted/40 border-border">
                        <SelectValue placeholder="Vehicle type" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="economy">Economy</SelectItem>
                      <SelectItem value="comfort">Comfort</SelectItem>
                      <SelectItem value="premium">Premium</SelectItem>
                      <SelectItem value="suv">SUV</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
            </form>
          </Form>
        )}
      </div>

      {/* Footer with step indicator and nav */}
      <div className="px-5 pb-6 pt-3 border-t border-border bg-background">
        {/* Progress bar */}
        <div className="flex items-center gap-1 mb-4">
          {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
            <div
              key={i}
              className={`h-1 flex-1 rounded-full transition-colors ${
                i < step ? 'bg-accent' : i === step ? 'bg-accent/40' : 'bg-muted'
              }`}
            />
          ))}
        </div>

        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-muted-foreground">{step} of {TOTAL_STEPS}</span>

          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="icon"
              onClick={handleBack}
              disabled={step === 1 || isSubmitting || isNavigating}
              className="rounded-full w-12 h-12"
            >
              <ChevronLeft className="w-5 h-5" />
            </Button>

            <Button
              onClick={handleNext}
              disabled={isSubmitting || isNavigating}
              className="rounded-full h-12 px-6 bg-primary text-primary-foreground hover:brightness-110 font-semibold"
            >
              {isSubmitting ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <>
                  {step === TOTAL_STEPS ? 'Submit' : 'Next'}
                  <ChevronRight className="w-5 h-5 ml-1" />
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
