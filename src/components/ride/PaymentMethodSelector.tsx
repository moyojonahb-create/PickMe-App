import { useEffect, type CSSProperties } from "react";
import { Banknote, Smartphone, Wallet, X } from "lucide-react";
import { haptic } from "@/lib/haptics";
import RideGlassPanel from "./RideGlassPanel";
import { redCta, RIDE_RED, RIDE_TEXT, RIDE_TEXT_2 } from "./rideGlass";

export type PaymentMethod = "cash" | "wallet";

const METHOD_CONFIRM_LABEL: Record<PaymentMethod, string> = { cash: "Pay with cash", wallet: "Pay from wallet" };

interface PaymentMethodSelectorProps {
  open: boolean;
  onClose: () => void;
  selected: PaymentMethod;
  onSelect: (method: PaymentMethod) => void;
  onConfirm: () => void;
  walletBalance?: number;
  estimatedFare?: number;
  tierLabel?: string;
  /** Third-party bookings (someone else pays) and recipient-pays parcels
   * can only settle in cash — see BookingForSomeoneElse's payer picker,
   * which is the other half of this constraint. */
  restrictToCash?: boolean;
  restrictReason?: string;
}

const panelStyle: CSSProperties = {
  background: "rgba(255,255,255,.88)",
  backdropFilter: "blur(28px) saturate(190%)",
  WebkitBackdropFilter: "blur(28px) saturate(190%)",
  boxShadow: "inset 0 0 0 .5px rgba(255,255,255,.6), 0 -8px 30px rgba(17,17,17,.06)",
};
const rowGlass: CSSProperties = {
  background: "linear-gradient(160deg, rgba(255,255,255,.8), rgba(255,255,255,.48))",
  boxShadow: "inset 0 .75px 0 rgba(255,255,255,.98), inset 0 0 0 .5px rgba(17,17,17,.09)",
};
const rowGlassSelected: CSSProperties = {
  background: "linear-gradient(135deg, rgba(255,250,205,.95), rgba(255,221,0,.22))",
  boxShadow: "inset 0 .5px 0 rgba(255,255,255,.9), inset 0 0 0 1px rgba(255,221,0,.6)",
};

function Radio({ selected, disabled }: { selected: boolean; disabled?: boolean }) {
  if (selected) {
    return (
      <span
        className="shrink-0 flex items-center justify-center rounded-full"
        style={{ width: 22, height: 22, boxShadow: `inset 0 0 0 2.2px ${RIDE_RED}` }}
      >
        <span className="rounded-full" style={{ width: 11, height: 11, background: RIDE_RED }} />
      </span>
    );
  }
  return (
    <span
      className="shrink-0 rounded-full"
      style={{ width: 22, height: 22, background: "#fff", boxShadow: `inset 0 0 0 2px ${disabled ? "#E5E7EB" : "#D6D8DB"}` }}
    />
  );
}

export default function PaymentMethodSelector({
  open, onClose, selected, onSelect, onConfirm,
  walletBalance = 0, estimatedFare = 0, tierLabel,
  restrictToCash = false, restrictReason,
}: PaymentMethodSelectorProps) {
  const insufficient = estimatedFare > 0 && walletBalance < estimatedFare;
  const walletDisabled = insufficient || restrictToCash;

  // Third-party/recipient-pays rides can only settle in cash — snap back
  // rather than let the sheet sit open on a method the ride can't use.
  useEffect(() => {
    if (open && restrictToCash && selected !== "cash") onSelect("cash");
  }, [open, restrictToCash, selected, onSelect]);

  if (!open) return null;

  const handleSelect = (method: PaymentMethod, disabled: boolean) => {
    if (disabled) return;
    haptic("light");
    onSelect(method);
  };

  const handleConfirm = () => {
    haptic("medium");
    onConfirm();
    onClose();
  };

  return (
    <>
      <div className="fixed inset-0 z-[60]" style={{ background: "rgba(17,17,17,.28)" }} onClick={onClose} />
      <div className="fixed left-0 right-0 bottom-0 z-[70]" style={{ maxWidth: 480, margin: "0 auto", width: "100%" }}>
        <RideGlassPanel panelStyle={panelStyle} style={{ maxHeight: "90vh", paddingBottom: "env(safe-area-inset-bottom)" }} onRibbonClick={onClose}>
          <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
            <div className="p-4" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {/* Section 1 — header */}
              <div className="flex items-center" style={{ gap: 11 }}>
                <div className="min-w-0" style={{ flex: 1 }}>
                  <p style={{ fontSize: 17, fontWeight: 700, letterSpacing: "-.02em", lineHeight: 1.2, color: RIDE_TEXT }}>How are you paying?</p>
                  {tierLabel && (
                    <p style={{ marginTop: 3, fontSize: 12.5, fontWeight: 500, lineHeight: 1.2, color: RIDE_TEXT_2 }}>{tierLabel}</p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close"
                  className="shrink-0 flex items-center justify-center active:scale-90 transition-transform"
                  style={{ width: 32, height: 32, borderRadius: 999, background: "rgba(17,17,17,.06)" }}
                >
                  <X style={{ width: 16, height: 16, color: RIDE_TEXT }} strokeWidth={2.4} />
                </button>
              </div>

              {restrictToCash && restrictReason && (
                <p style={{ fontSize: 11.5, fontWeight: 500, lineHeight: 1.35, color: RIDE_TEXT_2 }}>{restrictReason}</p>
              )}

              {/* Section 2 — Cash */}
              <button
                type="button"
                role="radio"
                aria-checked={selected === "cash"}
                onClick={() => handleSelect("cash", false)}
                className="flex items-center text-left active:scale-[0.99] transition-transform"
                style={{ padding: "12px 13px", borderRadius: 16, gap: 12, ...(selected === "cash" ? rowGlassSelected : rowGlass) }}
              >
                <span className="shrink-0 flex items-center justify-center" style={{ width: 38, height: 38, borderRadius: 12, background: "rgba(255,255,255,.7)" }}>
                  <Banknote style={{ width: 19, height: 19, color: RIDE_TEXT }} />
                </span>
                <div className="min-w-0" style={{ flex: 1 }}>
                  <p style={{ fontSize: 15, fontWeight: selected === "cash" ? 700 : 600, lineHeight: 1.2, color: RIDE_TEXT }}>Cash</p>
                  <p style={{ marginTop: 2, fontSize: 11.5, fontWeight: 500, lineHeight: 1.2, color: RIDE_TEXT_2 }}>Pay the driver when you arrive</p>
                </div>
                <Radio selected={selected === "cash"} />
              </button>

              {/* Section 3 — PickMe wallet */}
              <button
                type="button"
                role="radio"
                aria-checked={selected === "wallet"}
                disabled={walletDisabled}
                onClick={() => handleSelect("wallet", walletDisabled)}
                className="flex items-center text-left active:scale-[0.99] transition-transform disabled:active:scale-100"
                style={{ padding: "12px 13px", borderRadius: 16, gap: 12, opacity: walletDisabled ? 0.55 : 1, ...(selected === "wallet" ? rowGlassSelected : rowGlass) }}
              >
                <span className="shrink-0 flex items-center justify-center" style={{ width: 38, height: 38, borderRadius: 12, background: "rgba(184,17,4,.1)" }}>
                  <Wallet style={{ width: 19, height: 19, color: RIDE_RED }} />
                </span>
                <div className="min-w-0" style={{ flex: 1 }}>
                  <p style={{ fontSize: 15, fontWeight: selected === "wallet" ? 700 : 600, lineHeight: 1.2, color: RIDE_TEXT }}>CruiXe wallet</p>
                  <p style={{ marginTop: 2, fontSize: 11.5, fontWeight: 500, lineHeight: 1.2, color: RIDE_TEXT_2 }}>
                    {restrictToCash
                      ? "Cash only for this ride"
                      : insufficient
                      ? `Balance $${walletBalance.toFixed(2)} · not enough for this trip`
                      : `Balance $${walletBalance.toFixed(2)} · covers this trip`}
                  </p>
                </div>
                <Radio selected={selected === "wallet"} disabled={walletDisabled} />
              </button>
              {insufficient && !restrictToCash && (
                <p style={{ marginTop: -6, fontSize: 11.5, fontWeight: 600, color: RIDE_RED }}>
                  Top up your wallet to pay this way — or choose Cash above.
                </p>
              )}

              {/* Section 4 — EcoCash (not yet a real ride-payment path — see
                  requestRide.ts, which only accepts "cash"/"wallet". Shown
                  as coming soon rather than shipping a method that would
                  fail a rider at the end of a trip.) */}
              <div
                className="flex items-center"
                style={{ padding: "12px 13px", borderRadius: 16, gap: 12, opacity: 0.55, ...rowGlass }}
              >
                <span className="shrink-0 flex items-center justify-center" style={{ width: 38, height: 38, borderRadius: 12, background: "rgba(26,115,232,.12)" }}>
                  <Smartphone style={{ width: 19, height: 19, color: "#1A73E8" }} />
                </span>
                <div className="min-w-0" style={{ flex: 1 }}>
                  <p style={{ fontSize: 15, fontWeight: 600, lineHeight: 1.2, color: RIDE_TEXT }}>EcoCash</p>
                  <p style={{ marginTop: 2, fontSize: 11.5, fontWeight: 500, lineHeight: 1.2, color: RIDE_TEXT_2 }}>Coming soon</p>
                </div>
                <Radio selected={false} disabled />
              </div>

              {/* Section 5 — confirm */}
              <button
                type="button"
                onClick={handleConfirm}
                className="relative flex items-center justify-center overflow-hidden active:scale-[0.98] transition-transform"
                style={{ height: 48, borderRadius: 15, ...redCta }}
              >
                <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2" style={{ background: "linear-gradient(180deg, rgba(255,255,255,.2), rgba(255,255,255,0))" }} />
                <span className="relative" style={{ fontSize: 15.5, fontWeight: 700 }}>{METHOD_CONFIRM_LABEL[selected]}</span>
              </button>

              {/* Section 6 — iOS home indicator */}
              <div style={{ padding: "6px 0 10px" }} className="flex justify-center">
                <span className="rounded-full" style={{ width: 140, height: 5, background: RIDE_TEXT }} />
              </div>
            </div>
          </div>
        </RideGlassPanel>
      </div>
    </>
  );
}
