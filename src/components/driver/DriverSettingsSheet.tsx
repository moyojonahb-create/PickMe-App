import { useState } from "react";
import { Settings, Volume2, MapPin, BellRing, Phone, MessageSquare, Radio, Camera, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import DriverSettingsPanel from "@/components/settings/DriverSettingsPanel";
import DriverAvatarUpload from "@/components/driver/DriverAvatarUpload";
import DriverFeedback from "@/components/driver/DriverFeedback";
import type { DriverProfile } from "@/lib/offerHelpers";

interface DriverSettingsSheetProps {
  profile: DriverProfile;
  isOnline: boolean;
  togglingOnline: boolean;
  voiceEnabled: boolean;
  voiceSupported: boolean;
  onToggleOnline: (online: boolean) => void;
  onToggleVoice: (enabled: boolean) => void;
  onProfileUpdate: (updater: (prev: DriverProfile | null) => DriverProfile | null) => void;
  /** Optional external control (e.g. opened from the Driver Profile screen's
   * gear icon, or via router state) — falls back to its own internal state
   * when omitted, so existing callers are unaffected. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Hide the built-in gear trigger button when something else (like a
   * header icon on another screen) is responsible for opening it. */
  hideTrigger?: boolean;
}

export default function DriverSettingsSheet({
  profile,
  isOnline,
  togglingOnline,
  voiceEnabled,
  voiceSupported,
  onToggleOnline,
  onToggleVoice,
  onProfileUpdate,
  open: openProp,
  onOpenChange,
  hideTrigger,
}: DriverSettingsSheetProps) {
  const [openState, setOpenState] = useState(false);
  const open = openProp ?? openState;
  const setOpen = onOpenChange ?? setOpenState;

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      {!hideTrigger && (
        <SheetTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="w-11 h-11 rounded-2xl text-muted-foreground active:scale-90 transition-all"
            title="Settings"
          >
            <Settings className="h-5 w-5" />
          </Button>
        </SheetTrigger>
      )}
      <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="text-lg font-extrabold">Driver Settings</SheetTitle>
        </SheetHeader>

        <div className="space-y-6 mt-6">
          {/* Online Toggle */}
          <div className={`rounded-2xl p-4 border ${isOnline ? "border-primary bg-primary/5" : "border-border"}`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={`p-2 rounded-full ${isOnline ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
                  <Radio className="h-5 w-5" />
                </div>
                <div>
                  <p className="font-bold text-base">{isOnline ? "You're Online" : "You're Offline"}</p>
                  <p className="text-xs text-muted-foreground">
                    {isOnline ? "Receiving ride requests" : "Go online to see requests"}
                  </p>
                </div>
              </div>
              <Switch checked={isOnline} onCheckedChange={onToggleOnline} disabled={togglingOnline} />
            </div>
          </div>

          {/* Voice Announcements */}
          <div className="flex items-center justify-between p-4 rounded-2xl border border-border">
            <div className="flex items-center gap-3">
              <Volume2 className="h-5 w-5 text-muted-foreground" />
              <div>
                <p className="text-sm font-semibold">Voice Announcements</p>
                <p className="text-xs text-muted-foreground">
                  {voiceSupported ? "Announce new rides" : "Not supported"}
                </p>
              </div>
            </div>
            <Switch checked={voiceEnabled} onCheckedChange={onToggleVoice} disabled={!voiceSupported} />
          </div>

          {/* Service Area, Earnings Notif, EcoCash */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Preferences</p>
            <DriverSettingsPanel
              driverId={profile.id}
              initialArea={(profile as Record<string, unknown>).preferred_service_area as string || 'both'}
              initialEarningNotif={(profile as Record<string, unknown>).earning_notifications as boolean ?? true}
              initialEcocash={(profile as Record<string, unknown>).ecocash_number as string || ''}
            />
          </div>

          {/* Profile Photo */}
          <div className="rounded-2xl border border-border p-4">
            <div className="flex items-center gap-2 mb-3">
              <Camera className="h-4 w-4 text-muted-foreground" />
              <p className="font-semibold text-sm">Profile Photo</p>
            </div>
            <DriverAvatarUpload
              currentAvatarUrl={profile.avatar_url}
              gender={profile.gender}
              onUploaded={(url) => onProfileUpdate(prev => prev ? { ...prev, avatar_url: url } : prev)}
            />
          </div>

          {/* Suggestions & Complaints */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Feedback</p>
            <DriverFeedback />
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
