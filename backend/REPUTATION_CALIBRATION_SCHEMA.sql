CREATE TABLE IF NOT EXISTS public.reputation_daily_stats (
  day date PRIMARY KEY,
  driver_count integer NOT NULL DEFAULT 0,
  average_dispatch_score numeric(6,4) NOT NULL DEFAULT 0,
  median_dispatch_score numeric(6,4) NOT NULL DEFAULT 0,
  p25_dispatch_score numeric(6,4) NOT NULL DEFAULT 0,
  p50_dispatch_score numeric(6,4) NOT NULL DEFAULT 0,
  p75_dispatch_score numeric(6,4) NOT NULL DEFAULT 0,
  p90_dispatch_score numeric(6,4) NOT NULL DEFAULT 0,
  p95_dispatch_score numeric(6,4) NOT NULL DEFAULT 0,
  average_acceptance_rate numeric(6,4) NOT NULL DEFAULT 0,
  average_completion_rate numeric(6,4) NOT NULL DEFAULT 0,
  average_cancellation_rate numeric(6,4) NOT NULL DEFAULT 0,
  average_freshness_score numeric(6,4) NOT NULL DEFAULT 0,
  average_rating numeric(3,2) NOT NULL DEFAULT 0,
  score_inflation_detected boolean NOT NULL DEFAULT false,
  score_compression_detected boolean NOT NULL DEFAULT false,
  score_starvation_detected boolean NOT NULL DEFAULT false,
  new_driver_disadvantage_detected boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.reputation_score_distribution (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_date date NOT NULL DEFAULT CURRENT_DATE,
  bucket_start numeric(4,2) NOT NULL,
  bucket_end numeric(4,2) NOT NULL,
  driver_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reputation_score_distribution_snapshot
  ON public.reputation_score_distribution (snapshot_date, bucket_start);

CREATE TABLE IF NOT EXISTS public.reputation_calibration_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_date date NOT NULL DEFAULT CURRENT_DATE,
  driver_count integer NOT NULL DEFAULT 0,
  score_inflation_detected boolean NOT NULL DEFAULT false,
  score_compression_detected boolean NOT NULL DEFAULT false,
  score_starvation_detected boolean NOT NULL DEFAULT false,
  new_driver_disadvantage_detected boolean NOT NULL DEFAULT false,
  actual_driver_was_selected_rate numeric(6,4) NOT NULL DEFAULT 0,
  average_actual_driver_rank numeric(10,3) NOT NULL DEFAULT 0,
  reputation_acceptance_correlation numeric(8,4) NOT NULL DEFAULT 0,
  reputation_completion_correlation numeric(8,4) NOT NULL DEFAULT 0,
  recommendation text NOT NULL DEFAULT 'not_ready',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reputation_calibration_runs_date
  ON public.reputation_calibration_runs (run_date DESC, created_at DESC);

ALTER TABLE public.reputation_daily_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reputation_score_distribution ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reputation_calibration_runs ENABLE ROW LEVEL SECURITY;

INSERT INTO public.reputation_daily_stats (
  day,
  driver_count,
  average_dispatch_score,
  median_dispatch_score,
  p25_dispatch_score,
  p50_dispatch_score,
  p75_dispatch_score,
  p90_dispatch_score,
  p95_dispatch_score,
  average_acceptance_rate,
  average_completion_rate,
  average_cancellation_rate,
  average_freshness_score,
  average_rating,
  score_inflation_detected,
  score_compression_detected,
  score_starvation_detected,
  new_driver_disadvantage_detected,
  updated_at
)
SELECT
  CURRENT_DATE,
  COUNT(*)::integer,
  COALESCE(AVG(dispatch_score), 0),
  COALESCE(percentile_cont(0.50) WITHIN GROUP (ORDER BY dispatch_score), 0),
  COALESCE(percentile_cont(0.25) WITHIN GROUP (ORDER BY dispatch_score), 0),
  COALESCE(percentile_cont(0.50) WITHIN GROUP (ORDER BY dispatch_score), 0),
  COALESCE(percentile_cont(0.75) WITHIN GROUP (ORDER BY dispatch_score), 0),
  COALESCE(percentile_cont(0.90) WITHIN GROUP (ORDER BY dispatch_score), 0),
  COALESCE(percentile_cont(0.95) WITHIN GROUP (ORDER BY dispatch_score), 0),
  COALESCE(AVG(acceptance_rate), 0),
  COALESCE(AVG(completion_rate), 0),
  COALESCE(AVG(cancellation_rate), 0),
  COALESCE(AVG(freshness_score), 0),
  COALESCE(AVG(NULLIF(rating_avg, 0)), 0),
  COALESCE(percentile_cont(0.75) WITHIN GROUP (ORDER BY dispatch_score), 0) > 0.90,
  (
    COALESCE(percentile_cont(0.75) WITHIN GROUP (ORDER BY dispatch_score), 0) -
    COALESCE(percentile_cont(0.25) WITHIN GROUP (ORDER BY dispatch_score), 0)
  ) < 0.10,
  COALESCE(percentile_cont(0.50) WITHIN GROUP (ORDER BY dispatch_score), 0) < 0.35,
  COALESCE(AVG(dispatch_score) FILTER (WHERE completed_rides = 0), 0) + 0.10 <
    COALESCE(AVG(dispatch_score) FILTER (WHERE completed_rides >= 10), 0),
  NOW()
FROM public.driver_reputation
ON CONFLICT (day)
DO UPDATE SET
  driver_count = EXCLUDED.driver_count,
  average_dispatch_score = EXCLUDED.average_dispatch_score,
  median_dispatch_score = EXCLUDED.median_dispatch_score,
  p25_dispatch_score = EXCLUDED.p25_dispatch_score,
  p50_dispatch_score = EXCLUDED.p50_dispatch_score,
  p75_dispatch_score = EXCLUDED.p75_dispatch_score,
  p90_dispatch_score = EXCLUDED.p90_dispatch_score,
  p95_dispatch_score = EXCLUDED.p95_dispatch_score,
  average_acceptance_rate = EXCLUDED.average_acceptance_rate,
  average_completion_rate = EXCLUDED.average_completion_rate,
  average_cancellation_rate = EXCLUDED.average_cancellation_rate,
  average_freshness_score = EXCLUDED.average_freshness_score,
  average_rating = EXCLUDED.average_rating,
  score_inflation_detected = EXCLUDED.score_inflation_detected,
  score_compression_detected = EXCLUDED.score_compression_detected,
  score_starvation_detected = EXCLUDED.score_starvation_detected,
  new_driver_disadvantage_detected = EXCLUDED.new_driver_disadvantage_detected,
  updated_at = NOW();
