import { MapPin } from 'lucide-react';
import { PrimaryButton } from '@/components/ui/primary-button';
import { SecondaryButton } from '@/components/ui/secondary-button';

interface LocationPermissionPromptProps {
  onAllow: () => void;
  onDismiss: () => void;
}

/**
 * Upfront, explicit location-permission ask — shown once before the browser's
 * native prompt fires, so the request has app context instead of appearing
 * (or being silently blocked) with no explanation.
 */
export default function LocationPermissionPrompt({ onAllow, onDismiss }: LocationPermissionPromptProps) {
  return (
    <div className="fixed inset-0 z-[9999] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-background rounded-3xl p-6 space-y-5 animate-in zoom-in-95">
        <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto">
          <MapPin className="w-7 h-7 text-primary" />
        </div>

        <div className="text-center space-y-1.5">
          <h2 className="text-lg font-bold text-foreground">Enable location</h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            CruiXe uses your location to set your pickup point and find nearby drivers.
          </p>
        </div>

        <div className="space-y-2">
          <PrimaryButton onClick={onAllow} className="w-full">
            Allow location
          </PrimaryButton>
          <SecondaryButton onClick={onDismiss} className="w-full">
            Set pickup manually
          </SecondaryButton>
        </div>
      </div>
    </div>
  );
}
