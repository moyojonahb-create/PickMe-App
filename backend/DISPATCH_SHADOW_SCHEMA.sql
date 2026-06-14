CREATE TABLE IF NOT EXISTS public.dispatch_shadow_runs (
  id uuid PRIMARY KEY,
  ride_id uuid NOT NULL,
  rider_id uuid,
  pickup_lat numeric(10,7),
  pickup_lng numeric(10,7),
  pickup_location text,
  dropoff_location text,
  vehicle_type text,
  city text,
  mode text NOT NULL DEFAULT 'shadow',
  status text NOT NULL,
  candidate_count integer NOT NULL DEFAULT 0,
  selected_count integer NOT NULL DEFAULT 0,
  redis_available boolean NOT NULL DEFAULT false,
  redis_latency_ms numeric(10,3),
  candidate_discovery_latency_ms numeric(10,3),
  ranking_latency_ms numeric(10,3),
  dispatch_latency_ms numeric(10,3),
  shadow_write_latency_ms numeric(10,3),
  selected_driver_id uuid,
  selected_rank integer,
  ranking_version text NOT NULL,
  error text,
  started_at timestamptz NOT NULL,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.dispatch_shadow_runs
  ADD COLUMN IF NOT EXISTS candidate_discovery_latency_ms numeric(10,3),
  ADD COLUMN IF NOT EXISTS ranking_latency_ms numeric(10,3),
  ADD COLUMN IF NOT EXISTS shadow_write_latency_ms numeric(10,3);

CREATE TABLE IF NOT EXISTS public.dispatch_shadow_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shadow_run_id uuid NOT NULL REFERENCES public.dispatch_shadow_runs(id) ON DELETE CASCADE,
  ride_id uuid NOT NULL,
  driver_id uuid NOT NULL,
  rank integer NOT NULL,
  selected boolean NOT NULL DEFAULT false,
  distance_km numeric(8,3),
  score numeric(10,4),
  proximity_score numeric(6,4),
  freshness_score numeric(6,4),
  availability_score numeric(6,4),
  reputation_score numeric(6,4),
  fairness_score numeric(6,4),
  location_updated_at timestamptz,
  vehicle_type text,
  city text,
  exclusion_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.dispatch_shadow_outcomes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id uuid NOT NULL UNIQUE,
  shadow_run_id uuid,
  actual_driver_id uuid,
  actual_offer_id uuid,
  actual_driver_was_candidate boolean,
  actual_driver_was_selected boolean,
  actual_driver_shadow_rank integer,
  actual_driver_shadow_score numeric(10,4),
  first_offer_driver_id uuid,
  first_offer_was_candidate boolean,
  first_offer_was_selected boolean,
  first_offer_shadow_rank integer,
  seconds_to_first_offer integer,
  seconds_to_acceptance integer,
  ride_final_status text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dispatch_shadow_runs_ride_id
  ON public.dispatch_shadow_runs (ride_id);

CREATE INDEX IF NOT EXISTS idx_dispatch_shadow_runs_created_at
  ON public.dispatch_shadow_runs (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_dispatch_shadow_candidates_ride_id
  ON public.dispatch_shadow_candidates (ride_id);

CREATE INDEX IF NOT EXISTS idx_dispatch_shadow_candidates_driver_id
  ON public.dispatch_shadow_candidates (driver_id);

CREATE INDEX IF NOT EXISTS idx_dispatch_shadow_candidates_run_rank
  ON public.dispatch_shadow_candidates (shadow_run_id, rank);

CREATE INDEX IF NOT EXISTS idx_dispatch_shadow_candidates_ride_selected
  ON public.dispatch_shadow_candidates (ride_id, selected);

CREATE TABLE IF NOT EXISTS public.dispatch_shadow_daily_stats (
  day date PRIMARY KEY,
  total_shadow_runs integer NOT NULL DEFAULT 0,
  average_candidate_count numeric(10,3) NOT NULL DEFAULT 0,
  average_dispatch_latency_ms numeric(10,3) NOT NULL DEFAULT 0,
  average_redis_geo_latency_ms numeric(10,3) NOT NULL DEFAULT 0,
  average_candidate_discovery_latency_ms numeric(10,3) NOT NULL DEFAULT 0,
  average_ranking_latency_ms numeric(10,3) NOT NULL DEFAULT 0,
  average_shadow_write_latency_ms numeric(10,3) NOT NULL DEFAULT 0,
  actual_driver_was_candidate_rate numeric(6,4) NOT NULL DEFAULT 0,
  actual_driver_was_selected_rate numeric(6,4) NOT NULL DEFAULT 0,
  average_shadow_rank numeric(10,3) NOT NULL DEFAULT 0,
  average_first_offer_time_seconds numeric(10,3) NOT NULL DEFAULT 0,
  average_acceptance_time_seconds numeric(10,3) NOT NULL DEFAULT 0,
  redis_unavailable_count integer NOT NULL DEFAULT 0,
  no_coordinates_count integer NOT NULL DEFAULT 0,
  low_candidate_count integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.dispatch_shadow_daily_stats (
  day,
  total_shadow_runs,
  average_candidate_count,
  average_dispatch_latency_ms,
  average_redis_geo_latency_ms,
  average_candidate_discovery_latency_ms,
  average_ranking_latency_ms,
  average_shadow_write_latency_ms,
  actual_driver_was_candidate_rate,
  actual_driver_was_selected_rate,
  average_shadow_rank,
  average_first_offer_time_seconds,
  average_acceptance_time_seconds,
  redis_unavailable_count,
  no_coordinates_count,
  low_candidate_count,
  updated_at
)
SELECT
  r.created_at::date AS day,
  COUNT(r.*)::integer,
  COALESCE(AVG(r.candidate_count), 0),
  COALESCE(AVG(r.dispatch_latency_ms), 0),
  COALESCE(AVG(r.redis_latency_ms), 0),
  COALESCE(AVG(r.candidate_discovery_latency_ms), 0),
  COALESCE(AVG(r.ranking_latency_ms), 0),
  COALESCE(AVG(r.shadow_write_latency_ms), 0),
  COALESCE(AVG(CASE WHEN o.actual_driver_was_candidate THEN 1.0 WHEN o.actual_driver_was_candidate = false THEN 0.0 END), 0),
  COALESCE(AVG(CASE WHEN o.actual_driver_was_selected THEN 1.0 WHEN o.actual_driver_was_selected = false THEN 0.0 END), 0),
  COALESCE(AVG(o.actual_driver_shadow_rank), 0),
  COALESCE(AVG(o.seconds_to_first_offer), 0),
  COALESCE(AVG(o.seconds_to_acceptance), 0),
  COUNT(*) FILTER (WHERE r.status = 'redis_unavailable')::integer,
  COUNT(*) FILTER (WHERE r.status = 'no_coordinates')::integer,
  COUNT(*) FILTER (WHERE r.candidate_count > 0 AND r.candidate_count < 3)::integer,
  NOW()
FROM public.dispatch_shadow_runs r
LEFT JOIN public.dispatch_shadow_outcomes o ON o.ride_id = r.ride_id
GROUP BY r.created_at::date
ON CONFLICT (day)
DO UPDATE SET
  total_shadow_runs = EXCLUDED.total_shadow_runs,
  average_candidate_count = EXCLUDED.average_candidate_count,
  average_dispatch_latency_ms = EXCLUDED.average_dispatch_latency_ms,
  average_redis_geo_latency_ms = EXCLUDED.average_redis_geo_latency_ms,
  average_candidate_discovery_latency_ms = EXCLUDED.average_candidate_discovery_latency_ms,
  average_ranking_latency_ms = EXCLUDED.average_ranking_latency_ms,
  average_shadow_write_latency_ms = EXCLUDED.average_shadow_write_latency_ms,
  actual_driver_was_candidate_rate = EXCLUDED.actual_driver_was_candidate_rate,
  actual_driver_was_selected_rate = EXCLUDED.actual_driver_was_selected_rate,
  average_shadow_rank = EXCLUDED.average_shadow_rank,
  average_first_offer_time_seconds = EXCLUDED.average_first_offer_time_seconds,
  average_acceptance_time_seconds = EXCLUDED.average_acceptance_time_seconds,
  redis_unavailable_count = EXCLUDED.redis_unavailable_count,
  no_coordinates_count = EXCLUDED.no_coordinates_count,
  low_candidate_count = EXCLUDED.low_candidate_count,
  updated_at = NOW();
