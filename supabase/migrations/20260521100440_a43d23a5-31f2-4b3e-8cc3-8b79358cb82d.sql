
-- Luggage requests table
CREATE TABLE public.luggage_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id uuid REFERENCES public.rides(id) ON DELETE CASCADE,
  rider_id uuid NOT NULL,
  description text,
  image_paths text[] NOT NULL DEFAULT '{}',
  estimated_weight text,
  item_count int DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_luggage_requests_ride_id ON public.luggage_requests(ride_id);
CREATE INDEX idx_luggage_requests_rider_id ON public.luggage_requests(rider_id);

ALTER TABLE public.luggage_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Riders manage own luggage requests"
  ON public.luggage_requests FOR ALL
  USING (auth.uid() = rider_id)
  WITH CHECK (auth.uid() = rider_id);

CREATE POLICY "Approved drivers view luggage for pending/assigned rides"
  ON public.luggage_requests FOR SELECT
  USING (
    public.is_user_driver(auth.uid())
    AND (
      ride_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.rides r
        LEFT JOIN public.drivers d ON d.id = r.driver_id
        WHERE r.id = luggage_requests.ride_id
          AND (r.status = 'pending' OR d.user_id = auth.uid())
      )
    )
  );

CREATE TRIGGER update_luggage_requests_updated_at
  BEFORE UPDATE ON public.luggage_requests
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Fare adjustments table
CREATE TABLE public.fare_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id uuid NOT NULL REFERENCES public.rides(id) ON DELETE CASCADE,
  driver_id uuid NOT NULL,
  old_price numeric NOT NULL,
  new_price numeric NOT NULL,
  reason text,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_fare_adjustments_ride_id ON public.fare_adjustments(ride_id);

ALTER TABLE public.fare_adjustments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Drivers insert own adjustments"
  ON public.fare_adjustments FOR INSERT
  WITH CHECK (auth.uid() = driver_id AND public.is_user_driver(auth.uid()));

CREATE POLICY "Ride parties view adjustments"
  ON public.fare_adjustments FOR SELECT
  USING (
    auth.uid() = driver_id
    OR EXISTS (
      SELECT 1 FROM public.rides r
      WHERE r.id = fare_adjustments.ride_id AND r.user_id = auth.uid()
    )
  );

CREATE POLICY "Rider updates adjustment status"
  ON public.fare_adjustments FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.rides r
      WHERE r.id = fare_adjustments.ride_id AND r.user_id = auth.uid()
    )
    OR auth.uid() = driver_id
  );

CREATE TRIGGER update_fare_adjustments_updated_at
  BEFORE UPDATE ON public.fare_adjustments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.luggage_requests;
ALTER PUBLICATION supabase_realtime ADD TABLE public.fare_adjustments;

-- Storage bucket (private)
INSERT INTO storage.buckets (id, name, public)
VALUES ('luggage-photos', 'luggage-photos', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Riders upload own luggage photos"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'luggage-photos'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Riders read own luggage photos"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'luggage-photos'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Riders delete own luggage photos"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'luggage-photos'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Approved drivers read luggage photos"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'luggage-photos'
    AND public.is_user_driver(auth.uid())
  );
