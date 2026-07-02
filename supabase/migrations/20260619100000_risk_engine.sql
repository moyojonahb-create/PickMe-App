-- GO V2.5-A centralized fraud and risk engine

CREATE TABLE IF NOT EXISTS public.risk_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  actor_type text,
  area text NOT NULL CHECK (area IN (
    'rider_fraud',
    'driver_fraud',
    'wallet_abuse',
    'referral_abuse',
    'student_discount_abuse',
    'gps_spoofing',
    'fake_ride_creation',
    'multi_account_abuse',
    'payment_abuse',
    'emergency_sos_abuse'
  )),
  event_type text NOT NULL,
  severity text CHECK (severity IS NULL OR severity IN ('low', 'medium', 'high', 'critical')),
  device_fingerprint text,
  phone text,
  ip_address inet,
  latitude double precision,
  longitude double precision,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.risk_scores (
  user_id uuid PRIMARY KEY,
  risk_score integer NOT NULL DEFAULT 0 CHECK (risk_score BETWEEN 0 AND 100),
  trust_score integer NOT NULL DEFAULT 100 CHECK (trust_score BETWEEN 0 AND 100),
  fraud_score integer NOT NULL DEFAULT 0 CHECK (fraud_score BETWEEN 0 AND 100),
  risk_level text NOT NULL DEFAULT 'low' CHECK (risk_level IN ('low', 'medium', 'high', 'blocked')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.risk_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_key text NOT NULL UNIQUE,
  area text NOT NULL,
  description text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  weight integer NOT NULL DEFAULT 5,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.risk_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  admin_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('allow', 'review', 'rate_limit', 'require_verification', 'block')),
  reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.risk_device_fingerprints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_fingerprint text NOT NULL,
  user_id uuid NOT NULL,
  phone text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  first_seen timestamptz NOT NULL DEFAULT now(),
  last_seen timestamptz NOT NULL DEFAULT now(),
  UNIQUE (device_fingerprint, user_id)
);

CREATE INDEX IF NOT EXISTS idx_risk_events_user_created ON public.risk_events (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_risk_events_area_created ON public.risk_events (area, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_risk_scores_level_score ON public.risk_scores (risk_level, risk_score DESC);
CREATE INDEX IF NOT EXISTS idx_risk_actions_user_created ON public.risk_actions (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_risk_device_fingerprint ON public.risk_device_fingerprints (device_fingerprint, last_seen DESC);
CREATE INDEX IF NOT EXISTS idx_risk_device_phone ON public.risk_device_fingerprints (phone, last_seen DESC);

INSERT INTO public.risk_rules (rule_key, area, description, weight)
VALUES
  ('ride_requests_per_user', 'fake_ride_creation', 'Short-term ride request burst counter', 10),
  ('wallet_transfers_per_user', 'wallet_abuse', 'Short-term wallet transfer burst counter', 15),
  ('failed_login_attempts', 'multi_account_abuse', 'Short-term failed login counter', 8),
  ('device_accounts_count', 'multi_account_abuse', 'Device fingerprint account fanout counter', 15),
  ('phone_accounts_count', 'multi_account_abuse', 'Phone account fanout counter', 15),
  ('suspicious_location_jumps', 'gps_spoofing', 'Suspicious location jump counter', 12)
ON CONFLICT (rule_key) DO NOTHING;

ALTER TABLE public.risk_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.risk_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.risk_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.risk_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.risk_device_fingerprints ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can insert own risk events" ON public.risk_events;
CREATE POLICY "Users can insert own risk events"
ON public.risk_events
FOR INSERT
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can view own risk scores" ON public.risk_scores;
CREATE POLICY "Users can view own risk scores"
ON public.risk_scores
FOR SELECT
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Admins can manage risk events" ON public.risk_events;
CREATE POLICY "Admins can manage risk events"
ON public.risk_events
FOR ALL
USING (EXISTS (SELECT 1 FROM public.profiles WHERE profiles.user_id = auth.uid() AND profiles.role = 'admin'))
WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE profiles.user_id = auth.uid() AND profiles.role = 'admin'));

DROP POLICY IF EXISTS "Admins can manage risk scores" ON public.risk_scores;
CREATE POLICY "Admins can manage risk scores"
ON public.risk_scores
FOR ALL
USING (EXISTS (SELECT 1 FROM public.profiles WHERE profiles.user_id = auth.uid() AND profiles.role = 'admin'))
WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE profiles.user_id = auth.uid() AND profiles.role = 'admin'));

DROP POLICY IF EXISTS "Admins can manage risk rules" ON public.risk_rules;
CREATE POLICY "Admins can manage risk rules"
ON public.risk_rules
FOR ALL
USING (EXISTS (SELECT 1 FROM public.profiles WHERE profiles.user_id = auth.uid() AND profiles.role = 'admin'))
WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE profiles.user_id = auth.uid() AND profiles.role = 'admin'));

DROP POLICY IF EXISTS "Admins can manage risk actions" ON public.risk_actions;
CREATE POLICY "Admins can manage risk actions"
ON public.risk_actions
FOR ALL
USING (EXISTS (SELECT 1 FROM public.profiles WHERE profiles.user_id = auth.uid() AND profiles.role = 'admin'))
WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE profiles.user_id = auth.uid() AND profiles.role = 'admin'));

DROP POLICY IF EXISTS "Admins can manage risk device fingerprints" ON public.risk_device_fingerprints;
CREATE POLICY "Admins can manage risk device fingerprints"
ON public.risk_device_fingerprints
FOR ALL
USING (EXISTS (SELECT 1 FROM public.profiles WHERE profiles.user_id = auth.uid() AND profiles.role = 'admin'))
WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE profiles.user_id = auth.uid() AND profiles.role = 'admin'));
