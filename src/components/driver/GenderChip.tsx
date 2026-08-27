/** Small tinted pill showing a rider's gender, when known — used on the
 * driver's ride-request list and detail screens. Renders nothing if the
 * value isn't one of the two the app collects, rather than guessing. */
export default function GenderChip({ gender }: { gender: string | null | undefined }) {
  const normalized = gender?.toLowerCase();
  if (normalized !== 'female' && normalized !== 'male') return null;

  const color = normalized === 'female' ? '#DB2777' : '#2563EB';
  const label = normalized === 'female' ? 'Female' : 'Male';

  return (
    <span
      className="inline-flex items-center shrink-0"
      style={{ gap: 4, height: 18, padding: '0 7px', borderRadius: 999, background: `${color}14` }}
    >
      <span className="rounded-full shrink-0" style={{ width: 5, height: 5, background: color }} />
      <span style={{ fontSize: 10.5, fontWeight: 700, color }}>{label}</span>
    </span>
  );
}
