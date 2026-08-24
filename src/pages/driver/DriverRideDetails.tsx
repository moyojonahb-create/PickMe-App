import { useEffect, useState, useCallback, useMemo, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { X, User, Star, Banknote, Users, Briefcase, Quote, Package, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import LazyMapboxMap from '@/components/map/LazyMapboxMap';
import { getDriverProfile, submitOffer } from '@/lib/offerHelpers';
import { fetchEnrichedOpenRides, type EnrichedRideRequest } from '@/lib/driverRideRequests';
import { fetchRiderTrustSignals, type RiderTrustSignals } from '@/lib/driverStats';
import { getParcelSignedUrl } from '@/lib/parcelStorage';
import { supabase } from '@/lib/supabaseClient';
import { redCta, RIDE_RED, RIDE_TEXT, RIDE_TEXT_2, tintBlue, tintYellow, glassSurface } from '@/components/ride/rideGlass';

const PARCEL_SIZE_LABEL: Record<string, string> = { small: 'Small · fits on a lap', medium: 'Medium · boot space', large: 'Large · back seat' };

function fmtUSD(n: number): string {
  return `$${n.toFixed(2)}`;
}

export default function DriverRideDetails() {
  const { rideId } = useParams<{ rideId: string }>();
  const navigate = useNavigate();

  const [ride, setRide] = useState<EnrichedRideRequest | null>(null);
  const [trust, setTrust] = useState<RiderTrustSignals | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [driverCoords, setDriverCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [parcelPhotoUrl, setParcelPhotoUrl] = useState<string | null>(null);

  useEffect(() => {
    navigator.geolocation?.getCurrentPosition(
      (pos) => setDriverCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => {},
      { enableHighAccuracy: false, timeout: 5000 }
    );
  }, []);

  const load = useCallback(async () => {
    if (!rideId) return;
    setLoading(true);
    try {
      const profile = await getDriverProfile();
      const list = await fetchEnrichedOpenRides(profile?.gender);
      const found = list.find((r) => r.id === rideId) ?? null;
      setRide(found);
      if (found) {
        const { data } = await supabase.from('rides').select('user_id').eq('id', found.id).maybeSingle();
        if (data?.user_id) {
          fetchRiderTrustSignals(data.user_id).then(setTrust).catch(() => {});
        }
      }
    } catch (e) {
      toast.error('Could not load ride', { description: (e as Error).message });
    } finally {
      setLoading(false);
    }
  }, [rideId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const path = ride?.parcel?.photoPath;
    if (!path) { setParcelPhotoUrl(null); return; }
    let cancelled = false;
    getParcelSignedUrl(path).then((url) => { if (!cancelled) setParcelPhotoUrl(url); });
    return () => { cancelled = true; };
  }, [ride?.parcel?.photoPath]);

  const pickupToTripMinutes = useMemo(() => {
    if (!driverCoords || ride?.pickup_lat == null || ride?.pickup_lon == null) return null;
    const dLat = (ride.pickup_lat - driverCoords.lat) * 111;
    const dLng = (ride.pickup_lon - driverCoords.lng) * 111 * Math.cos((driverCoords.lat * Math.PI) / 180);
    const km = Math.sqrt(dLat * dLat + dLng * dLng);
    return { km, minutes: Math.max(1, Math.round((km / 25) * 60)) };
  }, [driverCoords, ride]);

  const handleAccept = async () => {
    if (!ride || submitting) return;
    setSubmitting(true);
    try {
      const eta = Math.max(5, Math.round(ride.duration_minutes / 2)) || 10;
      // No fare negotiation on this screen — the driver accepts the listed
      // fare as-is. Still goes through the same offer/accept pipeline the
      // rider-side bid stack (RideMatching.tsx) reads from; "Accept ride"
      // just means "at the fare shown," not "skip that pipeline."
      await submitOffer({ ride_id: ride.id, price: ride.fare, eta_minutes: eta });
      toast.success('Offer sent!', { description: 'Waiting for the rider to confirm.' });
      navigate('/driver/requests');
    } catch (e) {
      toast.error('Could not send offer', { description: (e as Error).message });
    } finally {
      setSubmitting(false);
    }
  };

  const handleClose = () => navigate('/driver/requests');

  if (loading) {
    return (
      <div className="min-h-[100dvh] p-4 space-y-3" style={{ background: '#F2F4F7' }}>
        <div className="h-8 w-40 rounded bg-muted animate-pulse" />
        <div className="h-32 rounded-2xl bg-muted animate-pulse" />
        <div className="h-24 rounded-2xl bg-muted animate-pulse" />
      </div>
    );
  }

  if (!ride) {
    return (
      <div className="min-h-[100dvh] bg-background flex flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="font-bold text-foreground">This request is no longer available</p>
        <p className="text-sm text-muted-foreground">It may have expired or been taken by another driver.</p>
        <button onClick={() => navigate('/driver/requests')} className="mt-2 px-5 py-2.5 rounded-full bg-primary text-primary-foreground font-bold text-sm">
          Back to requests
        </button>
      </div>
    );
  }

  const isParcel = (ride.vehicle_type || 'economy') === 'parcel';
  const pickup = ride.pickup_lat != null && ride.pickup_lon != null ? { lat: ride.pickup_lat, lng: ride.pickup_lon } : null;
  const dropoff = ride.dropoff_lat != null && ride.dropoff_lon != null ? { lat: ride.dropoff_lat, lng: ride.dropoff_lon } : null;
  const note = ride.rider_note || (isParcel ? ride.parcel?.deliveryNote ?? null : null);

  return (
    <div className="min-h-[100dvh] flex flex-col" style={{ background: '#F2F4F7' }}>
      <div className="flex items-center" style={{ padding: '59px 16px 12px', gap: 10 }}>
        <button type="button" onClick={handleClose} aria-label="Close" className="shrink-0 flex items-center justify-center rounded-full active:scale-90 transition-transform" style={{ width: 36, height: 36, background: 'rgba(17,17,17,.06)' }}>
          <X style={{ width: 16, height: 16, color: RIDE_TEXT }} strokeWidth={2.4} />
        </button>
        <span style={{ flex: 1, fontSize: 16, fontWeight: 700, color: RIDE_TEXT }}>Ride request</span>
        <span className="tabular-nums" style={{ fontSize: 19, fontWeight: 700, color: RIDE_RED }}>{fmtUSD(ride.fare)}</span>
      </div>

      <div className="flex-1 overflow-y-auto" style={{ padding: '0 16px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {/* Map preview */}
        <div style={{ height: 120, borderRadius: 16, overflow: 'hidden' }}>
          <LazyMapboxMap pickup={pickup} dropoff={dropoff} height="120px" className="w-full h-full" />
        </div>

        {/* Identity card */}
        <div className="flex items-center" style={{ ...glassSurface, borderRadius: 16, padding: '12px 14px', gap: 12 }}>
          {isParcel ? (
            <>
              <span className="shrink-0 flex items-center justify-center rounded-full" style={{ width: 48, height: 48, background: 'rgba(184,17,4,.1)' }}>
                <Package style={{ width: 22, height: 22, color: RIDE_RED }} />
              </span>
              <div className="min-w-0" style={{ flex: 1 }}>
                <p className="truncate" style={{ fontSize: 16, fontWeight: 700, color: RIDE_TEXT }}>{ride.parcel ? PARCEL_SIZE_LABEL[ride.parcel.packageSize] ?? ride.parcel.packageSize : 'Parcel'}</p>
                <p className="truncate" style={{ fontSize: 12, fontWeight: 500, color: RIDE_TEXT_2, marginTop: 1 }}>To: {ride.parcel?.recipientName}</p>
              </div>
            </>
          ) : (
            <>
              <span className="shrink-0 flex items-center justify-center rounded-full overflow-hidden" style={{ width: 48, height: 48, background: 'linear-gradient(135deg,#C6CBD4,#868E9B)', boxShadow: '0 0 0 2px rgba(255,255,255,.95)' }}>
                {ride.passenger_avatar_url ? (
                  <img src={ride.passenger_avatar_url} alt="" className="w-full h-full object-cover" />
                ) : (
                  <User style={{ width: 22, height: 22, color: '#fff' }} strokeWidth={2} />
                )}
              </span>
              <div className="min-w-0" style={{ flex: 1 }}>
                <p className="truncate" style={{ fontSize: 16, fontWeight: 700, color: RIDE_TEXT }}>{ride.passenger_display_name ?? 'Rider'}</p>
                <p className="flex items-center truncate" style={{ gap: 4, fontSize: 12, fontWeight: 500, color: RIDE_TEXT_2, marginTop: 1 }}>
                  {trust?.averageRating != null ? (
                    <>
                      <Star style={{ width: 11, height: 11, color: '#FFDD00' }} fill="#FFDD00" />
                      <span style={{ fontWeight: 700, color: RIDE_TEXT }}>{trust.averageRating.toFixed(1)}</span>
                      <span>· {trust.tripsWithPickMe} trip{trust.tripsWithPickMe === 1 ? '' : 's'} with PickMe</span>
                    </>
                  ) : (
                    <span>{trust ? `${trust.tripsWithPickMe} trip${trust.tripsWithPickMe === 1 ? '' : 's'} with PickMe` : 'New rider'}</span>
                  )}
                </p>
                {ride.passenger_name && (
                  <p className="flex items-center truncate" style={{ gap: 4, fontSize: 10.5, fontWeight: 700, color: '#B45309', marginTop: 2 }}>
                    <UserPlus style={{ width: 11, height: 11 }} />
                    For {ride.passenger_name} — booked by someone else
                  </p>
                )}
              </div>
            </>
          )}
          <span className="shrink-0 inline-flex items-center" style={{ ...tintYellow, height: 28, padding: '0 11px', borderRadius: 999, gap: 5 }}>
            <Banknote style={{ width: 13, height: 13, color: RIDE_TEXT }} />
            <span style={{ fontSize: 12, fontWeight: 700, color: RIDE_TEXT }}>{ride.payment_method === 'wallet' ? 'Wallet' : 'Cash'}</span>
          </span>
        </div>

        {/* Route card */}
        <div style={{ ...tintBlue, borderRadius: 16, padding: '13px 14px' }}>
          <div className="flex items-start" style={{ gap: 10 }}>
            <div className="flex flex-col items-center shrink-0" style={{ paddingTop: 4 }}>
              <span className="rounded-full" style={{ width: 8, height: 8, background: '#1A73E8' }} />
              <span style={{ width: 2, height: 26, background: 'rgba(17,17,17,.15)', margin: '2px 0' }} />
              <span className="rounded-full" style={{ width: 8, height: 8, background: RIDE_RED }} />
            </div>
            <div className="min-w-0" style={{ flex: 1 }}>
              <p className="truncate" style={{ fontSize: 13, fontWeight: 600, color: RIDE_TEXT_2 }}>{ride.pickup_address}</p>
              <p className="truncate" style={{ fontSize: 13.5, fontWeight: 700, color: RIDE_TEXT, marginTop: 16 }}>{ride.dropoff_address}</p>
            </div>
          </div>
        </div>

        {/* Distance / duration split */}
        <div className="flex" style={{ gap: 10 }}>
          <div className="flex-1" style={{ ...glassSurface, borderRadius: 14, padding: '10px 13px' }}>
            <p style={{ fontSize: 10.5, fontWeight: 700, color: RIDE_TEXT_2, textTransform: 'uppercase', letterSpacing: '.06em' }}>To pickup</p>
            <p className="tabular-nums" style={{ fontSize: 15, fontWeight: 700, color: RIDE_TEXT, marginTop: 2 }}>
              {pickupToTripMinutes ? `${pickupToTripMinutes.km.toFixed(1)} km · ${pickupToTripMinutes.minutes} min` : '—'}
            </p>
          </div>
          <div className="flex-1" style={{ ...glassSurface, borderRadius: 14, padding: '10px 13px' }}>
            <p style={{ fontSize: 10.5, fontWeight: 700, color: RIDE_TEXT_2, textTransform: 'uppercase', letterSpacing: '.06em' }}>Whole trip</p>
            <p className="tabular-nums" style={{ fontSize: 15, fontWeight: 700, color: RIDE_TEXT, marginTop: 2 }}>{ride.distance_km.toFixed(1)} km · {ride.duration_minutes} min</p>
          </div>
        </div>

        {/* Parcel photo */}
        {isParcel && parcelPhotoUrl && (
          <div style={{ ...glassSurface, borderRadius: 16, padding: 10 }}>
            <p style={{ fontSize: 11, fontWeight: 700, color: RIDE_TEXT_2, marginBottom: 8 }}>Photo of the parcel</p>
            <img src={parcelPhotoUrl} alt="Parcel" className="w-full h-40 object-cover rounded-xl" />
          </div>
        )}

        {/* Preferences */}
        {!isParcel && (
          <div style={{ ...glassSurface, borderRadius: 16, padding: '13px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: RIDE_TEXT_2, textTransform: 'uppercase', letterSpacing: '.1em' }}>Rider preferences</span>
            <div className="flex flex-wrap" style={{ gap: 7 }}>
              {ride.passenger_count && ride.passenger_count > 1 && (
                <Chip icon={Users}>{ride.passenger_count} passengers</Chip>
              )}
              {ride.hasLuggage && <Chip icon={Briefcase}>Has bags</Chip>}
              {ride.preferences?.quiet_ride && <Chip>Quiet ride</Chip>}
              {ride.preferences?.cool_temperature && <Chip>Cool temperature</Chip>}
              {ride.preferences?.wav_required && <Chip>Wheelchair accessible</Chip>}
              {ride.preferences?.hearing_impaired && <Chip>Hearing impaired</Chip>}
            </div>
            {note && (
              <>
                <span style={{ height: 0.5, background: 'rgba(17,17,17,.08)' }} />
                <p className="flex items-start" style={{ gap: 7, fontSize: 12, fontWeight: 600, color: RIDE_TEXT_2, lineHeight: 1.4 }}>
                  <Quote style={{ width: 13, height: 13, color: RIDE_RED, marginTop: 2, flexShrink: 0 }} />
                  {note}
                </p>
              </>
            )}
          </div>
        )}
        {isParcel && ride.parcel && (
          <div style={{ ...glassSurface, borderRadius: 16, padding: '13px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: RIDE_TEXT_2, textTransform: 'uppercase', letterSpacing: '.1em' }}>Parcel details</span>
            <Chip>{ride.parcel.whoPays === 'sender' ? 'Sender pays' : 'Recipient pays'}</Chip>
            {ride.parcel.deliveryNote && (
              <p className="flex items-start" style={{ gap: 7, fontSize: 12, fontWeight: 600, color: RIDE_TEXT_2, lineHeight: 1.4 }}>
                <Quote style={{ width: 13, height: 13, color: RIDE_RED, marginTop: 2, flexShrink: 0 }} />
                {ride.parcel.deliveryNote}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Bottom action bar */}
      <div className="flex items-center" style={{ padding: '10px 16px 30px', gap: 12, background: 'rgba(255,255,255,.94)', backdropFilter: 'blur(20px) saturate(190%)', WebkitBackdropFilter: 'blur(20px) saturate(190%)' }}>
        <button type="button" onClick={handleClose} className="shrink-0 flex items-center justify-center active:scale-[0.97] transition-transform" style={{ width: 104, height: 48, borderRadius: 15, ...glassSurface }}>
          <span style={{ fontSize: 14.5, fontWeight: 700, color: RIDE_TEXT_2 }}>Close</span>
        </button>
        <button
          type="button"
          onClick={handleAccept}
          disabled={submitting}
          className="flex items-center justify-center active:scale-[0.97] transition-transform disabled:opacity-70"
          style={{ flex: 1, height: 48, borderRadius: 15, gap: 8, ...redCta }}
        >
          {submitting ? (
            <span style={{ fontSize: 15.5, fontWeight: 700 }}>Sending…</span>
          ) : (
            <>
              <span style={{ fontSize: 15.5, fontWeight: 700 }}>Accept ride</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
}

function Chip({ icon: Icon, children }: { icon?: typeof Users; children: ReactNode }) {
  return (
    <span className="inline-flex items-center" style={{ ...tintBlue, height: 28, padding: '0 11px', borderRadius: 999, gap: 5 }}>
      {Icon && <Icon style={{ width: 12, height: 12, color: '#1A73E8' }} />}
      <span style={{ fontSize: 12, fontWeight: 700, color: RIDE_TEXT }}>{children}</span>
    </span>
  );
}
