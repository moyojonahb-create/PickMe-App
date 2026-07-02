import { useState, useRef, useEffect } from "react";
import { supabase } from "@/lib/supabaseClient";
import { resolveAvatarUrl } from "@/lib/avatarUrl";
import { useAuth } from "@/hooks/useAuth";
import { updateMyDriver } from "@/lib/businessApi";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Camera, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface DriverAvatarUploadProps {
  currentAvatarUrl?: string | null;
  gender?: string | null;
  onUploaded: (url: string) => void;
}

export default function DriverAvatarUpload({ currentAvatarUrl, gender, onUploaded }: DriverAvatarUploadProps) {
  const { user } = useAuth();
  const [uploading, setUploading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    resolveAvatarUrl(currentAvatarUrl).then(url => setPreviewUrl(url));
  }, [currentAvatarUrl]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;

    // Accept any image format — allow low-quality phone cameras
    if (!file.type.startsWith("image/")) {
      toast.error("Please select an image file");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error("Image must be under 10MB");
      return;
    }

    setUploading(true);
    try {
      const ext = file.name.split(".").pop() || "jpg";
      const filePath = `${user.id}/avatar.${ext}`;

      // Upload to storage
      const { error: uploadErr } = await supabase.storage
        .from("driver-avatars")
        .upload(filePath, file, { upsert: true });

      if (uploadErr) throw uploadErr;

      // Get signed URL (bucket is private)
      const { data: signedData, error: signedErr } = await supabase.storage
        .from("driver-avatars")
        .createSignedUrl(filePath, 60 * 60 * 24 * 365); // 1 year

      if (signedErr || !signedData?.signedUrl) throw signedErr || new Error("Failed to get URL");

      const avatarUrl = signedData.signedUrl;

      // Update driver record with file path (not signed URL, as signed URLs expire)
      await updateMyDriver({ avatar_url: filePath });

      setPreviewUrl(avatarUrl);
      onUploaded(avatarUrl);
      toast.success("Profile photo updated!");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      toast.error("Upload failed", { description: message });
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="flex items-center gap-4">
      <div className="relative">
        <Avatar className="h-16 w-16 border-2 border-primary/20">
          {previewUrl ? (
            <AvatarImage src={previewUrl} alt="Driver avatar" />
          ) : null}
          <AvatarFallback className={`text-lg font-bold ${gender === "female" ? "bg-pink-100 text-pink-700" : "bg-primary/10 text-primary"}`}>
            {gender === "female" ? "♀" : "♂"}
          </AvatarFallback>
        </Avatar>
        <button
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="absolute -bottom-1 -right-1 p-1.5 rounded-full bg-primary text-primary-foreground shadow-md hover:bg-primary/90 transition-colors"
        >
          {uploading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Camera className="h-3 w-3" />}
        </button>
      </div>
      <div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
        >
          {uploading ? "Uploading…" : previewUrl ? "Change Photo" : "Add Photo"}
        </Button>
        <p className="text-xs text-muted-foreground mt-1">Max 10MB · Any image format</p>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="user"
        className="hidden"
        onChange={handleUpload}
      />
    </div>
  );
}
