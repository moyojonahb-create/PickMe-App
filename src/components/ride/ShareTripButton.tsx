import { useState } from 'react';
import { Share2, Copy, Check } from 'lucide-react';
import { toast } from 'sonner';

interface ShareTripProps {
  rideId: string;
  pickupAddress: string;
  dropoffAddress: string;
  driverName?: string;
  /** 'pill' (default) is the existing compact inline pill. 'square' matches
   * the bordered icon-over-label action-grid style used on the redesigned
   * connected-ride screens. */
  variant?: 'pill' | 'square';
}

export default function ShareTripButton({ rideId, pickupAddress, dropoffAddress, driverName, variant = 'pill' }: ShareTripProps) {
  const [copied, setCopied] = useState(false);

  const shareUrl = `${window.location.origin}/track/${rideId}`;
  const text = [
    `🚗 Track my PickMe ride live!`,
    driverName ? `Driver: ${driverName}` : '',
    `From: ${pickupAddress}`,
    `To: ${dropoffAddress}`,
    ``,
    shareUrl,
  ].filter(Boolean).join('\n');

  const fallbackCopy = (value: string) => {
    const ta = document.createElement('textarea');
    ta.value = value;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  };

  const handleShare = async () => {
    try {
      if (navigator.share) {
        await navigator.share({ title: 'My PickMe Trip', text, url: shareUrl });
        return;
      }
    } catch {
      // share cancelled or failed, fall through to copy
    }
    await handleCopy();
  };

  const handleCopy = async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        fallbackCopy(text);
      }
      setCopied(true);
      toast.success('Trip link copied!', { description: shareUrl });
      setTimeout(() => setCopied(false), 3000);
    } catch {
      fallbackCopy(text);
      setCopied(true);
      toast.success('Trip link copied!', { description: shareUrl });
      setTimeout(() => setCopied(false), 3000);
    }
  };

  if (variant === 'square') {
    return (
      <button
        onClick={(e) => {
          e.stopPropagation();
          handleShare();
        }}
        className="flex flex-col items-center gap-1.5 py-3 rounded-2xl border border-border active:scale-95 transition-transform"
        title="Share Trip"
      >
        {copied ? <Check className="w-5 h-5 text-primary" /> : <Share2 className="w-5 h-5 text-foreground" />}
        <span className="text-[11px] font-medium text-foreground">{copied ? 'Copied' : 'Share trip'}</span>
      </button>
    );
  }

  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        handleShare();
      }}
      className="flex items-center gap-1.5 px-3 h-9 rounded-xl bg-primary/10 active:scale-[0.95] transition-all"
      title="Share Trip"
    >
      {copied ? (
        <>
          <Check className="w-4 h-4 text-primary" />
          <span className="text-xs font-medium text-primary">Copied!</span>
        </>
      ) : (
        <>
          <Share2 className="w-4 h-4 text-primary" />
          <span className="text-xs font-medium text-primary">Share</span>
        </>
      )}
    </button>
  );
}
