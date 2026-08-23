import { useEffect, useState, type CSSProperties } from 'react';
import { DoorOpen, Luggage, PhoneCall, Quote, Repeat, Timer, UserRound, X } from 'lucide-react';
import { haptic } from '@/lib/haptics';
import RideGlassPanel from './RideGlassPanel';
import { redCta, RIDE_RED, RIDE_TEXT, RIDE_TEXT_2 } from './rideGlass';

const NOTE_MAX = 120;

const COMMON_NOTES: { label: string; icon: typeof PhoneCall }[] = [
  { label: 'Call when you arrive', icon: PhoneCall },
  { label: 'I have bags', icon: Luggage },
  { label: 'Elderly passenger', icon: UserRound },
  { label: 'Meet at the gate', icon: DoorOpen },
  { label: 'Give me 2 minutes', icon: Timer },
];

// Drivers read this while driving — control characters and hard line breaks
// have no business in a note that ends up on someone's dashboard mid-trip.
function sanitizeNote(raw: string): string {
  let out = "";
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i);
    const isControl = (code >= 0 && code <= 8) || code === 11 || code === 12 || (code >= 14 && code <= 31) || code === 127;
    const isBreak = code === 10 || code === 13;
    if (isControl) continue;
    out += isBreak ? " " : raw[i];
  }
  return out.replace(/\s+/g, " ").trimStart().slice(0, NOTE_MAX);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Chips append to the field, they never replace it — toggling a chip must
// never discard something the rider already typed.
function toggleChip(draft: string, label: string): string {
  if (draft.includes(label)) {
    return draft
      .replace(new RegExp(`\\s*,\\s*${escapeRegExp(label)}`), '')
      .replace(new RegExp(`${escapeRegExp(label)}\\s*,\\s*`), '')
      .replace(label, '')
      .trim();
  }
  const trimmed = draft.trim();
  const joined = trimmed.length > 0 ? `${trimmed}, ${label}` : label;
  return joined.length > NOTE_MAX ? draft : joined;
}

interface NoteToDriverSheetProps {
  open: boolean;
  onClose: () => void;
  note: string;
  onNoteChange: (note: string) => void;
  reuseEveryTrip: boolean;
  onReuseEveryTripChange: (reuse: boolean) => void;
  onSave: (note: string, reuseEveryTrip: boolean) => void;
}

const panelStyle: CSSProperties = {
  background: 'rgba(255,255,255,.88)',
  backdropFilter: 'blur(28px) saturate(190%)',
  WebkitBackdropFilter: 'blur(28px) saturate(190%)',
  boxShadow: 'inset 0 0 0 .5px rgba(255,255,255,.6), 0 -8px 30px rgba(17,17,17,.06)',
};
const headerIconTile: CSSProperties = {
  background: 'linear-gradient(135deg, rgba(255,248,247,.95), rgba(184,17,4,.1))',
  boxShadow: 'inset 0 0 0 .5px rgba(184,17,4,.18)',
};
const fieldGlass: CSSProperties = {
  background: 'rgba(255,255,255,.75)',
  boxShadow: 'inset 0 0 0 1.5px rgba(184,17,4,.28), 0 6px 16px rgba(17,17,17,.05)',
};
const chipGlass: CSSProperties = {
  background: 'linear-gradient(160deg, rgba(255,255,255,.8), rgba(255,255,255,.48))',
  boxShadow: 'inset 0 .75px 0 rgba(255,255,255,.98), inset 0 0 0 .5px rgba(17,17,17,.09)',
};
const chipGlassSelected: CSSProperties = {
  background: 'linear-gradient(135deg, rgba(255,250,205,.95), rgba(255,221,0,.22))',
  boxShadow: 'inset 0 .5px 0 rgba(255,255,255,.9), inset 0 0 0 1px rgba(255,221,0,.55)',
};

export default function NoteToDriverSheet({
  open, onClose, note, onNoteChange, reuseEveryTrip, onReuseEveryTripChange, onSave,
}: NoteToDriverSheetProps) {
  const [draft, setDraft] = useState(note);
  const [reuseDraft, setReuseDraft] = useState(reuseEveryTrip);

  useEffect(() => {
    if (open) { setDraft(note); setReuseDraft(reuseEveryTrip); }
  }, [open, note, reuseEveryTrip]);

  if (!open) return null;

  const handleClose = () => onClose();

  const handleChipToggle = (label: string) => {
    haptic('light');
    setDraft((d) => toggleChip(d, label));
  };

  const handleSave = () => {
    const clean = sanitizeNote(draft);
    haptic('medium');
    onNoteChange(clean);
    onReuseEveryTripChange(reuseDraft);
    onSave(clean, reuseDraft);
    onClose();
  };

  return (
    <>
      <div className="fixed inset-0 z-[60]" style={{ background: 'rgba(17,17,17,.28)' }} onClick={handleClose} />
      <div className="fixed left-0 right-0 bottom-0 z-[70]" style={{ maxWidth: 480, margin: '0 auto', width: '100%' }}>
        <RideGlassPanel panelStyle={panelStyle} style={{ maxHeight: '90vh', paddingBottom: 'env(safe-area-inset-bottom)' }} onRibbonClick={handleClose}>
          <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
            <div className="p-4" style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
              {/* Section 1 — header */}
              <div className="flex items-center" style={{ gap: 11 }}>
                <span className="shrink-0 flex items-center justify-center" style={{ width: 40, height: 40, borderRadius: 14, ...headerIconTile }}>
                  <Quote style={{ width: 19, height: 19, color: RIDE_RED }} />
                </span>
                <div className="min-w-0" style={{ flex: 1 }}>
                  <p style={{ fontSize: 17, fontWeight: 700, letterSpacing: '-.02em', lineHeight: 1.2, color: RIDE_TEXT }}>Note for your driver</p>
                  <p style={{ marginTop: 3, fontSize: 12.5, fontWeight: 500, lineHeight: 1.2, color: RIDE_TEXT_2 }}>Sent with your request, before they accept</p>
                </div>
                <button
                  type="button"
                  onClick={handleClose}
                  aria-label="Close"
                  className="shrink-0 flex items-center justify-center active:scale-90 transition-transform"
                  style={{ width: 32, height: 32, borderRadius: 999, background: 'rgba(17,17,17,.06)' }}
                >
                  <X style={{ width: 16, height: 16, color: RIDE_TEXT }} strokeWidth={2.4} />
                </button>
              </div>

              {/* Section 2 — text field */}
              <div style={{ ...fieldGlass, borderRadius: 16, padding: '13px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(sanitizeNote(e.target.value))}
                  placeholder="e.g. Meeting at the blue gate behind the shops"
                  rows={2}
                  maxLength={NOTE_MAX}
                  className="w-full outline-none bg-transparent resize-none"
                  style={{ fontSize: 14.5, fontWeight: 500, lineHeight: 1.4, color: RIDE_TEXT }}
                />
                <div className="flex items-center justify-between">
                  <span style={{ fontSize: 11, fontWeight: 500, color: '#9AA1AD' }}>Keep it short — drivers read this while driving</span>
                  <span className="tabular-nums shrink-0" style={{ fontSize: 11, fontWeight: 600, color: '#9AA1AD', fontVariantNumeric: 'tabular-nums' }}>{draft.length}/{NOTE_MAX}</span>
                </div>
              </div>

              {/* Section 3 — common notes */}
              <div className="flex flex-col" style={{ gap: 7 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: RIDE_TEXT_2, textTransform: 'uppercase', letterSpacing: '.12em' }}>Common notes</span>
                <div className="flex flex-wrap" style={{ gap: 7 }}>
                  {COMMON_NOTES.map(({ label, icon: Icon }) => {
                    const selected = draft.includes(label);
                    return (
                      <button
                        key={label}
                        type="button"
                        onClick={() => handleChipToggle(label)}
                        className="flex items-center active:scale-[0.96] transition-transform"
                        style={{ height: 34, padding: '0 12px', borderRadius: 999, gap: 5, ...(selected ? chipGlassSelected : chipGlass) }}
                      >
                        <Icon style={{ width: 13, height: 13, color: selected ? RIDE_TEXT : RIDE_TEXT_2 }} />
                        <span style={{ fontSize: 12.5, fontWeight: selected ? 700 : 600, color: RIDE_TEXT }}>{label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Section 4 — reuse toggle */}
              <button
                type="button"
                onClick={() => setReuseDraft((v) => !v)}
                className="flex items-center w-full text-left active:scale-[0.98] transition-transform"
                style={{ height: 44, padding: '0 14px', borderRadius: 15, gap: 10, ...chipGlass }}
              >
                <Repeat style={{ width: 17, height: 17, color: RIDE_TEXT_2 }} strokeWidth={1.9} />
                <span style={{ flex: 1, fontSize: 14, fontWeight: 500, color: RIDE_TEXT }}>Use this note every trip</span>
                <span
                  className="shrink-0 flex items-center"
                  style={{
                    width: 44, height: 26, borderRadius: 999, padding: '0 3px',
                    justifyContent: reuseDraft ? 'flex-end' : 'flex-start',
                    background: reuseDraft ? RIDE_RED : 'rgba(17,17,17,.14)',
                    boxShadow: reuseDraft ? 'inset 0 1px 2px rgba(0,0,0,.12)' : 'inset 0 1px 2px rgba(0,0,0,.1)',
                    transition: 'background .15s ease',
                  }}
                >
                  <span className="rounded-full" style={{ width: 20, height: 20, background: '#FFFFFF', boxShadow: '0 1px 3px rgba(0,0,0,.24)' }} />
                </span>
              </button>

              {/* Section 5 — action row */}
              <div className="flex items-center" style={{ gap: 12 }}>
                <button
                  type="button"
                  onClick={handleClose}
                  className="shrink-0 flex items-center justify-center active:scale-[0.97] transition-transform"
                  style={{ width: 104, height: 48, borderRadius: 15, ...chipGlass }}
                >
                  <span style={{ fontSize: 14.5, fontWeight: 700, color: RIDE_TEXT_2 }}>Cancel</span>
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  className="flex items-center justify-center active:scale-[0.97] transition-transform"
                  style={{ flex: 1, height: 48, borderRadius: 15, ...redCta }}
                >
                  <span style={{ fontSize: 15.5, fontWeight: 700 }}>Save note</span>
                </button>
              </div>

              {/* Section 6 — iOS home indicator */}
              <div style={{ padding: '6px 0 10px' }} className="flex justify-center">
                <span className="rounded-full" style={{ width: 140, height: 5, background: RIDE_TEXT }} />
              </div>
            </div>
          </div>
        </RideGlassPanel>
      </div>
    </>
  );
}
