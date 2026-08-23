// Single source of truth for region-specific emergency numbers. PickMe
// currently operates only in Zimbabwe (see src/lib/towns.ts — every town
// configured today is Zimbabwean), so this is a flat constant rather than a
// per-town lookup. If the app ever expands beyond Zimbabwe, resolve this
// from the rider's active town/country instead of hardcoding it at every
// call site — that's the whole point of keeping it here as one function.
export function resolveEmergencyNumber(): string {
  return '999';
}

/** Normalize a Zimbabwean phone number to E.164 (+263...) for SMS sending.
 * Accepts local ("077..."), already-international ("+263 77...", "263 77..."),
 * or bare-digit input. Same region-single-source-of-truth reasoning as
 * resolveEmergencyNumber above. */
export function normalizePhoneZW(raw: string): string {
  const digits = raw.replace(/[\s\-()]/g, '');
  if (digits.startsWith('+')) return digits;
  if (digits.startsWith('263')) return `+${digits}`;
  if (digits.startsWith('0')) return `+263${digits.slice(1)}`;
  return `+263${digits}`;
}
