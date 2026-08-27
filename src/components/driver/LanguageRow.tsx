import { useState } from 'react';
import { Globe, ChevronRight, X } from 'lucide-react';
import { useEscapeKey } from '@/hooks/useEscapeKey';

interface LanguageRowProps {
  language?: string;
}

/** The app is currently English-only (no locale/i18n system exists yet), so
 * this reflects that real, current state rather than implying a language
 * picker that doesn't exist. Tapping it explains that plainly. */
export default function LanguageRow({ language = 'English' }: LanguageRowProps) {
  const [open, setOpen] = useState(false);
  useEscapeKey(open, () => setOpen(false));

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full flex items-center justify-between gap-3 py-2.5 text-left active:opacity-70 transition-opacity"
      >
        <span className="flex items-center gap-2.5">
          <Globe className="w-4 h-4 text-muted-foreground" />
          <span className="text-[13px] font-semibold text-foreground">Language</span>
        </span>
        <span className="flex items-center gap-1 text-[13px] text-muted-foreground">
          {language}
          <ChevronRight className="w-3.5 h-3.5" />
        </span>
      </button>

      {open && (
        <div className="fixed inset-0 z-[80] flex items-end justify-center" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-foreground/30 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <div className="relative w-full max-w-lg bg-background rounded-t-3xl p-5 space-y-3" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 20px)' }}>
            <div className="flex items-center justify-between">
              <p className="font-bold text-foreground">Passenger language</p>
              <button onClick={() => setOpen(false)} aria-label="Close" className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-muted">
                <X className="w-4 h-4 text-muted-foreground" />
              </button>
            </div>
            <p className="text-sm text-muted-foreground">
              CruiXe currently operates in <span className="font-semibold text-foreground">{language}</span> only.
              Multi-language support isn't available yet.
            </p>
          </div>
        </div>
      )}
    </>
  );
}
