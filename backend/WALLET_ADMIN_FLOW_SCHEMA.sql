ALTER TABLE public.payment_intents
  DROP CONSTRAINT IF EXISTS payment_intents_provider_check,
  ADD CONSTRAINT payment_intents_provider_check
  CHECK (provider IN ('manual_ecocash', 'manual_innbucks', 'manual_bank', 'manual_cash', 'manual_card', 'manual_paypal', 'ecocash', 'innbucks', 'visa', 'mastercard', 'paypal'));

ALTER TABLE public.payment_intents
  DROP CONSTRAINT IF EXISTS payment_intents_payment_method_check,
  ADD CONSTRAINT payment_intents_payment_method_check
  CHECK (payment_method IN ('manual_ecocash', 'manual_innbucks', 'manual_bank', 'manual_cash', 'manual_card', 'manual_paypal', 'ecocash', 'innbucks', 'visa', 'mastercard', 'paypal'));

ALTER TABLE public.payment_intents
  DROP CONSTRAINT IF EXISTS payment_intents_status_check,
  ADD CONSTRAINT payment_intents_status_check
  CHECK (status IN ('pending', 'pending_admin_approval', 'approved', 'rejected', 'failed', 'cancelled', 'expired'));

ALTER TABLE public.payment_intents
  ADD COLUMN IF NOT EXISTS wallet_account_type text CHECK (wallet_account_type IS NULL OR wallet_account_type IN ('rider_wallet', 'driver_wallet')),
  ADD COLUMN IF NOT EXISTS approved_by uuid,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS rejected_by uuid,
  ADD COLUMN IF NOT EXISTS rejected_at timestamptz,
  ADD COLUMN IF NOT EXISTS rejection_reason text,
  ADD COLUMN IF NOT EXISTS wallet_transaction_id uuid REFERENCES public.wallet_transactions(id);

ALTER TABLE public.withdrawal_requests
  DROP CONSTRAINT IF EXISTS withdrawal_requests_provider_check,
  ADD CONSTRAINT withdrawal_requests_provider_check
  CHECK (provider IN ('manual_ecocash', 'manual_innbucks', 'manual_bank', 'manual_cash', 'manual_card', 'manual_paypal', 'ecocash', 'innbucks', 'visa', 'mastercard', 'paypal'));

CREATE TABLE IF NOT EXISTS public.wallet_admin_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('approve_deposit', 'reject_deposit', 'approve_withdrawal', 'reject_withdrawal')),
  target_type text NOT NULL CHECK (target_type IN ('payment_intent', 'withdrawal_request')),
  target_id uuid NOT NULL,
  reason text,
  previous_status text NOT NULL,
  new_status text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payment_intents_admin_pending
  ON public.payment_intents (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_payment_intents_wallet_transaction
  ON public.payment_intents (wallet_transaction_id);

CREATE INDEX IF NOT EXISTS idx_wallet_admin_actions_target
  ON public.wallet_admin_actions (target_type, target_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_wallet_admin_actions_admin
  ON public.wallet_admin_actions (admin_user_id, created_at DESC);

ALTER TABLE public.wallet_admin_actions ENABLE ROW LEVEL SECURITY;

CREATE POLICY wallet_admin_actions_admin_select
  ON public.wallet_admin_actions
  FOR SELECT
  USING (auth.jwt() -> 'app_metadata' ->> 'role' = 'admin');
