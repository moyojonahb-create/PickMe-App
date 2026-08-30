CREATE TABLE public.ride_passenger_ratings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id uuid NOT NULL REFERENCES public.rides(id) ON DELETE CASCADE,
  driver_id uuid NOT NULL,
  rating integer NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (ride_id, driver_id)
);

GRANT SELECT, INSERT ON public.ride_passenger_ratings TO authenticated;
GRANT ALL ON public.ride_passenger_ratings TO service_role;

ALTER TABLE public.ride_passenger_ratings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Drivers insert ratings for their rides"
ON public.ride_passenger_ratings FOR INSERT TO authenticated
WITH CHECK (
  auth.uid() = driver_id
  AND EXISTS (
    SELECT 1 FROM public.rides r
    WHERE r.id = ride_id
      AND public.is_ride_driver(auth.uid(), r.driver_id)
  )
);

CREATE POLICY "Participants and admins read passenger ratings"
ON public.ride_passenger_ratings FOR SELECT TO authenticated
USING (
  auth.uid() = driver_id
  OR EXISTS (SELECT 1 FROM public.rides r WHERE r.id = ride_id AND r.user_id = auth.uid())
  OR public.has_role(auth.uid(), 'admin')
);

CREATE INDEX idx_ride_passenger_ratings_ride ON public.ride_passenger_ratings(ride_id);

CREATE TABLE public.driver_offline_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
  admin_id uuid,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.driver_offline_actions TO authenticated;
GRANT ALL ON public.driver_offline_actions TO service_role;

ALTER TABLE public.driver_offline_actions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read driver offline actions"
ON public.driver_offline_actions FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX idx_driver_offline_actions_driver ON public.driver_offline_actions(driver_id);

CREATE OR REPLACE FUNCTION public.admin_force_driver_offline(_driver_id uuid, _reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  UPDATE public.drivers SET is_online = false, updated_at = now() WHERE id = _driver_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'driver not found';
  END IF;

  UPDATE public.driver_sessions
     SET went_offline_at = now()
   WHERE driver_id = _driver_id AND went_offline_at IS NULL;

  INSERT INTO public.driver_offline_actions (driver_id, admin_id, reason)
  VALUES (_driver_id, auth.uid(), _reason);

  RETURN jsonb_build_object('success', true, 'driver_id', _driver_id);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_force_driver_offline(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_force_driver_offline(uuid, text) TO authenticated;