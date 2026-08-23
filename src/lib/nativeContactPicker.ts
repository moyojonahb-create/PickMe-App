// A rider picking a contact should see their phone/tablet's own contact
// picker — not an in-app screen we built and now have to keep in sync with
// the OS's real contact list. This never renders any UI of its own; it only
// hands off to the native picker and reports what came back.
export type ContactPickResult =
  | { status: 'picked'; name: string; phone: string }
  | { status: 'cancelled' }
  | { status: 'unsupported' };

export async function pickNativeContact(): Promise<ContactPickResult> {
  // Native app shell (Capacitor): opens the device's own contact-picker UI.
  try {
    const { Contacts } = await import('@capacitor-community/contacts');
    const perm = await Contacts.requestPermissions();
    if (perm.contacts === 'granted' || perm.contacts === 'limited') {
      const { contact } = await Contacts.pickContact({ projection: { name: true, phones: true } });
      const name = contact.name?.display || `${contact.name?.given ?? ''} ${contact.name?.family ?? ''}`.trim();
      const phone = contact.phones?.find((p) => p.number)?.number ?? '';
      if (name && phone) return { status: 'picked', name, phone };
      return { status: 'cancelled' };
    }
  } catch {
    // Not running under Capacitor (plain mobile web) — fall through.
  }

  // Mobile web (Chrome/Android and similar): the browser's native picker.
  const nav = navigator as Navigator & {
    contacts?: {
      select: (props: string[], opts?: { multiple?: boolean }) => Promise<Array<Record<string, unknown>>>;
    };
  };
  if (nav.contacts?.select) {
    try {
      const [picked] = await nav.contacts.select(['name', 'tel'], { multiple: false });
      if (picked) {
        const name = ((picked.name as string[]) || [])[0] ?? '';
        const phone = ((picked.tel as string[]) || [])[0] ?? '';
        if (name && phone) return { status: 'picked', name, phone };
      }
      return { status: 'cancelled' };
    } catch {
      // User backed out of the native picker — not an error worth surfacing.
      return { status: 'cancelled' };
    }
  }

  // Desktop browsers and anything else without a contacts API: nothing to
  // hand off to. The caller already has plain name/phone inputs on screen.
  return { status: 'unsupported' };
}
