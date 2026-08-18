export type RiderGender = 'male' | 'female' | null | undefined;

const RED = '#B81104';
const YELLOW = '#FFDD00';
const SILHOUETTE = '#1F1F1F';

function silhouette(gender: RiderGender): string {
  // Dark person silhouette drawn inside the yellow circle (viewBox 0 0 24 24 space,
  // translated by the caller). Female = skirt, male = trousers, otherwise neutral torso.
  if (gender === 'female') {
    return `
      <circle cx="12" cy="7.4" r="2.5" fill="${SILHOUETTE}"/>
      <path d="M12 10.4c-2.1 0-3 1.6-3.6 3.7l-.5 1.9c-.1.5.3.9.8.9h6.6c.5 0 .9-.4.8-.9l-.5-1.9c-.6-2.1-1.5-3.7-3.6-3.7z" fill="${SILHOUETTE}"/>
    `;
  }
  if (gender === 'male') {
    return `
      <circle cx="12" cy="7.4" r="2.5" fill="${SILHOUETTE}"/>
      <path d="M9.1 11.2h5.8c.6 0 1 .5 1 1.1v2.1c0 .4-.3.7-.7.7h-.6v1.6c0 .4-.3.7-.7.7h-1c-.4 0-.7-.3-.7-.7V15h-.4v1.7c0 .4-.3.7-.7.7h-1c-.4 0-.7-.3-.7-.7V15h-.6c-.4 0-.7-.3-.7-.7v-2.1c0-.6.4-1.1 1-1.1z" fill="${SILHOUETTE}"/>
    `;
  }
  return `
    <circle cx="12" cy="7.4" r="2.5" fill="${SILHOUETTE}"/>
    <path d="M12 10.5c-2.4 0-4.2 1.6-4.2 3.9v1.7c0 .5.4.9.9.9h6.6c.5 0 .9-.4.9-.9v-1.7c0-2.3-1.8-3.9-4.2-3.9z" fill="${SILHOUETTE}"/>
  `;
}

/**
 * Red teardrop map pin with a white outline, a yellow inner circle and a
 * gender-aware dark person silhouette, plus a soft ground shadow at the tip.
 */
export function pickupPinSvg(gender: RiderGender, size = 54): string {
  const height = Math.round(size * 1.3);
  return `
    <svg width="${size}" height="${height}" viewBox="0 0 48 62" fill="none" xmlns="http://www.w3.org/2000/svg">
      <ellipse cx="24" cy="57" rx="9" ry="3.2" fill="rgba(15,23,42,0.28)"/>
      <path d="M24 2.5c-9.7 0-17.5 7.8-17.5 17.4 0 12.2 14.4 27.6 16.3 29.6.6.7 1.8.7 2.4 0 1.9-2 16.3-17.4 16.3-29.6C41.5 10.3 33.7 2.5 24 2.5z"
        fill="${RED}" stroke="#FFFFFF" stroke-width="3"/>
      <circle cx="24" cy="19.6" r="10.4" fill="${YELLOW}"/>
      <g transform="translate(11.4 7) scale(1.05)">${silhouette(gender)}</g>
    </svg>
  `;
}

export function createPickupPinElement(gender: RiderGender, size = 54): HTMLElement {
  const el = document.createElement('div');
  el.className = 'pickme-pickup-pin';
  el.style.width = `${size}px`;
  el.style.height = `${Math.round(size * 1.3)}px`;
  el.style.pointerEvents = 'none';
  el.innerHTML = pickupPinSvg(gender, size);
  return el;
}
