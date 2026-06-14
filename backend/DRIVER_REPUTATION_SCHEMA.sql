CREATE TABLE IF NOT EXISTS public.driver_reputation (
  driver_id uuid PRIMARY KEY,
  rating_avg numeric(3,2) NOT NULL DEFAULT 0,
  rating_count integer NOT NULL DEFAULT 0,
  acceptance_rate numeric(5,4) NOT NULL DEFAULT 0.5,
  completion_rate numeric(5,4) NOT NULL DEFAULT 0.5,
  cancellation_rate numeric(5,4) NOT NULL DEFAULT 0,
  cancel_after_accept_rate numeric(5,4) NOT NULL DEFAULT 0,
  reliability_score numeric(5,4) NOT NULL DEFAULT 0.5,
  freshness_score numeric(5,4) NOT NULL DEFAULT 0.5,
  dispatch_score numeric(6,4) NOT NULL DEFAULT 0.5,
  completed_rides integer NOT NULL DEFAULT 0,
  accepted_rides integer NOT NULL DEFAULT 0,
  offered_rides integer NOT NULL DEFAULT 0,
  rejected_offers integer NOT NULL DEFAULT 0,
  timed_out_offers integer NOT NULL DEFAULT 0,
  cancelled_rides integer NOT NULL DEFAULT 0,
  last_completed_ride_at timestamptz,
  last_offer_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.driver_reputation_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL,
  rating_avg numeric(3,2) NOT NULL DEFAULT 0,
  acceptance_rate numeric(5,4) NOT NULL DEFAULT 0.5,
  completion_rate numeric(5,4) NOT NULL DEFAULT 0.5,
  cancellation_rate numeric(5,4) NOT NULL DEFAULT 0,
  reliability_score numeric(5,4) NOT NULL DEFAULT 0.5,
  dispatch_score numeric(6,4) NOT NULL DEFAULT 0.5,
  snapshot_date date NOT NULL DEFAULT CURRENT_DATE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.driver_reputation_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL,
  event_type text NOT NULL,
  ride_id uuid,
  offer_id uuid,
  score_before numeric(6,4),
  score_after numeric(6,4),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_driver_reputation_dispatch_score
  ON public.driver_reputation (dispatch_score DESC);

CREATE INDEX IF NOT EXISTS idx_driver_reputation_low_score
  ON public.driver_reputation (dispatch_score ASC);

CREATE INDEX IF NOT EXISTS idx_driver_reputation_events_driver_created
  ON public.driver_reputation_events (driver_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_driver_reputation_snapshots_driver_date
  ON public.driver_reputation_snapshots (driver_id, snapshot_date DESC);

ALTER TABLE public.driver_reputation ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.driver_reputation_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.driver_reputation_events ENABLE ROW LEVEL SECURITY;
