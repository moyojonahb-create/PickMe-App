import { useState, type CSSProperties, type ReactNode } from 'react';
import { Share2, Copy, Check, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';

interface ShareTripProps {
  rideId: string;
  pickupAddress: string;
  dropoffAddress: string;
  driverName?: string;
  /** 'pill' (default) is the existing compact inline pill. 'square' matches
   * the bordered icon-over-label action-grid style used on the redesigned
   * connected-ride screens. 'glass' is the flex-fill white-glass action-row
   * button used on the in-trip (4f) screen. 'row' is the icon-tile +
   * title/subtitle + chevron list row used on the Safety sheet (4l). Same
   * share/copy logic in every case — only the trigger markup differs. */
  variant?: 'pill' | 'square' | 'glass' | 'row';
  /** 'glass'/'row' — inline style for the button (glass background/shadow
   * tokens live with the caller, not duplicated into this component). */
  style?: CSSProperties;
  className?: string;
  /** 'row' only — the pre-styled leading icon tile element. */
  rowIcon?: ReactNode;
}

export default function ShareTripButton({ rideId, pickupAddress, dropoffAddress, driverName, variant = 'pill', style, className, rowIcon }: ShareTripProps) {
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

  if (variant === 'row') {
    return (
      <button
        onClick={(e) => { e.stopPropagation(); handleShare(); }}
        className={className}
        style={style}
      >
        {rowIcon}
        <div className="min-w-0 flex-1 text-left">
          <p style={{ fontSize: 14.5, fontWeight: 600, lineHeight: 1.2 }}>
            {copied ? 'Link copied' : 'Share live trip'}
          </p>
          <p style={{ fontSize: 11.5, fontWeight: 500, lineHeight: 1.2, marginTop: 2 }}>
            {copied ? 'Trip link ready to paste' : 'Send your route and driver details'}
          </p>
        </div>
        <ChevronRight style={{ width: 17, height: 17 }} className="shrink-0" />
      </button>
    );
  }

  if (variant === 'glass') {
    return (
      <button
        onClick={(e) => { e.stopPropagation(); handleShare(); }}
        className={className ?? 'flex items-center justify-center active:scale-[0.97] transition-transform'}
        style={style}
      >
        {copied ? <Check style={{ width: 18, height: 18 }} /> : <Share2 style={{ width: 18, height: 18 }} />}
        <span style={{ fontSize: 14.5, fontWeight: 700 }}>{copied ? 'Copied' : 'Share trip'}</span>
      </button>
    );
  }

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
