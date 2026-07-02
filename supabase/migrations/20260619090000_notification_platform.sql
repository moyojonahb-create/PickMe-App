-- GO V2.4-C notification platform

CREATE TABLE IF NOT EXISTS public.notification_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  platform text NOT NULL CHECK (platform IN ('ios', 'android', 'web')),
  device_token text NOT NULL UNIQUE,
  last_seen timestamptz NOT NULL DEFAULT now(),
  app_version text,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.notification_preferences (
  user_id uuid PRIMARY KEY,
  push boolean NOT NULL DEFAULT true,
  sms boolean NOT NULL DEFAULT true,
  email boolean NOT NULL DEFAULT true,
  marketing boolean NOT NULL DEFAULT false,
  transactional boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.notification_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  type text NOT NULL CHECK (type IN (
    'ride_offer',
    'ride_accepted',
    'driver_arrived',
    'ride_started',
    'ride_completed',
    'wallet_deposit_approved',
    'withdrawal_approved',
    'driver_verification_approved',
    'student_verification_approved',
    'emergency_alert'
  )),
  channel text NOT NULL CHECK (channel IN ('push', 'sms', 'email')),
  title text NOT NULL,
  body text NOT NULL,
  status text NOT NULL CHECK (status IN ('queued', 'sent', 'delivered', 'failed', 'skipped')),
  provider text,
  provider_id text,
  error_message text,
  ride_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  sent_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notification_devices_user_last_seen
  ON public.notification_devices (user_id, last_seen DESC)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_notification_history_user_created
  ON public.notification_history (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notification_history_status_created
  ON public.notification_history (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notification_history_channel_status
  ON public.notification_history (channel, status);

ALTER TABLE public.notification_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage own notification devices" ON public.notification_devices;
CREATE POLICY "Users can manage own notification devices"
ON public.notification_devices
FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can manage own notification preferences" ON public.notification_preferences;
CREATE POLICY "Users can manage own notification preferences"
ON public.notification_preferences
FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can read own notification history" ON public.notification_history;
CREATE POLICY "Users can read own notification history"
ON public.notification_history
FOR SELECT
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Admins can read notification history" ON public.notification_history;
CREATE POLICY "Admins can read notification history"
ON public.notification_history
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.profiles
    WHERE profiles.user_id = auth.uid()
      AND profiles.role = 'admin'
  )
);
