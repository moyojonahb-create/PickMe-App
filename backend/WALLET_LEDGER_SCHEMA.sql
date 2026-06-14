CREATE TABLE IF NOT EXISTS public.wallet_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid,
  owner_role text NOT NULL CHECK (owner_role IN ('rider', 'driver', 'platform', 'system')),
  account_type text NOT NULL CHECK (account_type IN (
    'rider_wallet',
    'driver_wallet',
    'platform_wallet',
    'cash_liability_wallet',
    'pending_deposit_wallet',
    'provider_clearing_wallet'
  )),
  currency text NOT NULL CHECK (currency IN ('USD', 'ZWG')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'frozen', 'closed')),
  cached_available_balance numeric(18,2) NOT NULL DEFAULT 0,
  cached_pending_balance numeric(18,2) NOT NULL DEFAULT 0,
  cached_liability_balance numeric(18,2) NOT NULL DEFAULT 0,
  cached_available_balance_minor bigint NOT NULL DEFAULT 0,
  cached_pending_balance_minor bigint NOT NULL DEFAULT 0,
  cached_liability_balance_minor bigint NOT NULL DEFAULT 0,
  last_ledger_entry_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_user_id, account_type, currency)
);

CREATE TABLE IF NOT EXISTS public.wallet_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_type text NOT NULL CHECK (transaction_type IN (
    'ride_settlement',
    'cash_liability',
    'deposit',
    'withdrawal',
    'refund',
    'reversal',
    'admin_adjustment',
    'shadow_settlement',
    'cash_platform_fee',
    'wallet_settlement'
  )),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending',
    'posted',
    'reversed',
    'failed',
    'cancelled',
    'requires_approval'
  )),
  idempotency_key text NOT NULL UNIQUE,
  currency text NOT NULL CHECK (currency IN ('USD', 'ZWG')),
  total_amount numeric(18,2) NOT NULL CHECK (total_amount > 0),
  amount_minor bigint NOT NULL DEFAULT 0 CHECK (amount_minor >= 0),
  source_type text,
  source_id text,
  owner_user_id uuid,
  ride_id uuid,
  payment_provider text CHECK (payment_provider IS NULL OR payment_provider IN ('cash', 'wallet', 'onemoney', 'ecocash', 'innbucks', 'card', 'visa', 'mastercard', 'paypal', 'internal')),
  payment_intent_id uuid,
  created_by uuid,
  approved_by uuid,
  approved_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.wallet_ledger_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id uuid NOT NULL REFERENCES public.wallet_transactions(id),
  account_id uuid NOT NULL REFERENCES public.wallet_accounts(id),
  entry_type text NOT NULL CHECK (entry_type IN ('debit', 'credit')),
  amount numeric(18,2) NOT NULL CHECK (amount > 0),
  amount_minor bigint NOT NULL DEFAULT 0 CHECK (amount_minor >= 0),
  currency text NOT NULL CHECK (currency IN ('USD', 'ZWG')),
  ride_id uuid,
  source_type text,
  source_id text,
  payment_provider text CHECK (payment_provider IS NULL OR payment_provider IN ('cash', 'wallet', 'onemoney', 'ecocash', 'innbucks', 'card', 'visa', 'mastercard', 'paypal', 'internal')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.payment_intents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  amount numeric(18,2) NOT NULL CHECK (amount > 0),
  amount_minor bigint NOT NULL DEFAULT 0 CHECK (amount_minor >= 0),
  currency text NOT NULL CHECK (currency IN ('USD', 'ZWG')),
  provider text NOT NULL CHECK (provider IN ('onemoney', 'ecocash', 'innbucks', 'card', 'visa', 'mastercard', 'paypal')),
  payment_method text NOT NULL CHECK (payment_method IN ('onemoney', 'ecocash', 'innbucks', 'card', 'visa', 'mastercard', 'paypal')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'pending_admin_approval', 'pending_provider_payment', 'authorized', 'captured', 'voided', 'refunded', 'approved', 'completed', 'rejected', 'failed', 'cancelled', 'expired')),
  wallet_account_type text CHECK (wallet_account_type IS NULL OR wallet_account_type IN ('rider_wallet', 'driver_wallet')),
  provider_reference text,
  operation text NOT NULL DEFAULT 'legacy',
  idempotency_key text NOT NULL,
  expires_at timestamptz,
  approved_by uuid,
  approved_at timestamptz,
  rejected_by uuid,
  rejected_at timestamptz,
  rejection_reason text,
  wallet_transaction_id uuid REFERENCES public.wallet_transactions(id),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, provider, operation, idempotency_key)
);

CREATE TABLE IF NOT EXISTS public.provider_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL CHECK (provider IN ('onemoney', 'ecocash', 'innbucks', 'card', 'visa', 'mastercard', 'paypal')),
  provider_event_id text NOT NULL,
  provider_reference text,
  event_type text NOT NULL,
  signature_valid boolean NOT NULL DEFAULT false,
  payload_hash text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  status text NOT NULL DEFAULT 'received' CHECK (status IN ('received', 'processed', 'duplicate', 'ignored', 'failed')),
  UNIQUE (provider, provider_event_id),
  UNIQUE (provider, payload_hash)
);

CREATE TABLE IF NOT EXISTS public.withdrawal_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL,
  wallet_account_id uuid NOT NULL REFERENCES public.wallet_accounts(id),
  amount numeric(18,2) NOT NULL CHECK (amount > 0),
  amount_minor bigint NOT NULL DEFAULT 0 CHECK (amount_minor >= 0),
  currency text NOT NULL CHECK (currency IN ('USD', 'ZWG')),
  provider text NOT NULL CHECK (provider IN ('onemoney', 'ecocash', 'innbucks', 'card', 'visa', 'mastercard', 'paypal')),
  destination_reference text NOT NULL,
  status text NOT NULL DEFAULT 'pending_approval' CHECK (status IN (
    'pending_approval',
    'approved',
    'rejected',
    'processing',
    'paid',
    'failed',
    'cancelled'
  )),
  idempotency_key text NOT NULL UNIQUE,
  requested_at timestamptz NOT NULL DEFAULT now(),
  approved_by uuid,
  approved_at timestamptz,
  rejected_by uuid,
  rejected_at timestamptz,
  rejection_reason text,
  provider_reference text,
  wallet_transaction_id uuid REFERENCES public.wallet_transactions(id),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.wallet_pins (
  user_id uuid PRIMARY KEY,
  pin_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.wallet_authorizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id uuid NOT NULL UNIQUE,
  rider_id uuid NOT NULL,
  wallet_account_id uuid NOT NULL REFERENCES public.wallet_accounts(id),
  amount numeric(18,2) NOT NULL CHECK (amount > 0),
  amount_minor bigint NOT NULL DEFAULT 0 CHECK (amount_minor >= 0),
  currency text NOT NULL CHECK (currency IN ('USD', 'ZWG')),
  status text NOT NULL CHECK (status IN ('authorized', 'captured', 'released', 'expired', 'failed')),
  idempotency_key text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  captured_amount numeric(18,2) NOT NULL DEFAULT 0 CHECK (captured_amount >= 0),
  released_amount numeric(18,2) NOT NULL DEFAULT 0 CHECK (released_amount >= 0),
  captured_amount_minor bigint NOT NULL DEFAULT 0 CHECK (captured_amount_minor >= 0),
  released_amount_minor bigint NOT NULL DEFAULT 0 CHECK (released_amount_minor >= 0),
  failure_reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.wallet_authorization_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  authorization_id uuid NOT NULL REFERENCES public.wallet_authorizations(id),
  event_type text NOT NULL CHECK (event_type IN ('authorized', 'captured', 'released', 'expired', 'released_unused', 'failed')),
  amount numeric(18,2) NOT NULL CHECK (amount >= 0),
  amount_minor bigint NOT NULL DEFAULT 0 CHECK (amount_minor >= 0),
  idempotency_key text NOT NULL UNIQUE,
  reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.settlement_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id uuid NOT NULL,
  driver_id uuid,
  rider_id uuid,
  fare numeric(18,2) NOT NULL CHECK (fare > 0),
  platform_fee numeric(18,2) NOT NULL CHECK (platform_fee >= 0),
  driver_earning numeric(18,2) NOT NULL CHECK (driver_earning >= 0),
  fare_minor bigint NOT NULL DEFAULT 0 CHECK (fare_minor >= 0),
  platform_fee_minor bigint NOT NULL DEFAULT 0 CHECK (platform_fee_minor >= 0),
  driver_earning_minor bigint NOT NULL DEFAULT 0 CHECK (driver_earning_minor >= 0),
  payment_method text NOT NULL CHECK (payment_method IN ('cash', 'wallet', 'ecocash', 'innbucks', 'visa', 'mastercard', 'paypal')),
  settlement_mode text NOT NULL CHECK (settlement_mode IN ('shadow', 'active')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'posted', 'settled', 'failed', 'liability_recorded', 'reversed', 'cancelled')),
  wallet_transaction_id uuid REFERENCES public.wallet_transactions(id),
  idempotency_key text NOT NULL UNIQUE,
  error text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.reconciliation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text CHECK (provider IS NULL OR provider IN ('onemoney', 'ecocash', 'innbucks', 'card', 'visa', 'mastercard', 'paypal', 'internal')),
  run_type text NOT NULL CHECK (run_type IN ('provider_events', 'ledger_balance', 'settlements', 'withdrawals', 'deposits')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed', 'requires_review')),
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  matched_count integer NOT NULL DEFAULT 0 CHECK (matched_count >= 0),
  mismatch_count integer NOT NULL DEFAULT 0 CHECK (mismatch_count >= 0),
  missing_provider_count integer NOT NULL DEFAULT 0 CHECK (missing_provider_count >= 0),
  missing_ledger_count integer NOT NULL DEFAULT 0 CHECK (missing_ledger_count >= 0),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS public.financial_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_type text NOT NULL CHECK (job_type IN (
    'cash_settlement',
    'wallet_capture',
    'authorization_release',
    'authorization_expiration',
    'reconciliation_run',
    'provider_callback_processing',
    'refund_processing',
    'chargeback_processing',
    'dispute_resolution',
    'provider_statement_reconciliation',
    'financial_incident_review',
    'provider_certification',
    'recovery_drill',
    'settlement_failure_drill',
    'reconciliation_failure_drill',
    'provider_callback_failure_drill',
    'dual_approval_review',
    'finance_close',
    'launch_gate_review',
    'release_readiness_review',
    'launch_gate_drill',
    'executive_signoff_packet',
    'internal_launch_drill',
    'drill_evidence_review',
    'production_exception_closure',
    'daily_finance_close',
    'internal_pilot_runbook',
    'internal_pilot_authorization'
  )),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'succeeded', 'failed', 'dead_lettered', 'cancelled')),
  source_type text,
  source_id text,
  idempotency_key text NOT NULL UNIQUE,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  max_attempts integer NOT NULL DEFAULT 10 CHECK (max_attempts > 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  locked_by text,
  locked_until timestamptz,
  failure_reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.financial_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  metric_type text NOT NULL CHECK (metric_type IN (
    'settlement_failure',
    'callback_failure',
    'reconciliation_drift',
    'expired_authorization',
    'failed_capture',
    'failed_release',
    'provider_statement_drift',
    'refund_failure',
    'chargeback_failure',
    'open_dispute',
    'financial_incident',
    'certification_failure',
    'recovery_drill_failure',
    'recovery_score',
    'launch_gate_blocked',
    'finance_close_failure',
    'release_readiness_score',
    'launch_gate_drill_failure',
    'launch_blocker_open',
    'production_exception_open'
  )),
  provider text CHECK (provider IS NULL OR provider IN ('onemoney', 'ecocash', 'innbucks', 'card', 'visa', 'mastercard', 'paypal', 'internal')),
  reference_type text,
  reference_id text,
  value integer NOT NULL DEFAULT 1,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.provider_statement_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL CHECK (provider IN ('onemoney', 'ecocash', 'innbucks', 'card', 'visa', 'mastercard', 'paypal')),
  statement_reference text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'requires_review')),
  imported_by uuid,
  total_line_count integer NOT NULL DEFAULT 0 CHECK (total_line_count >= 0),
  matched_count integer NOT NULL DEFAULT 0 CHECK (matched_count >= 0),
  mismatch_count integer NOT NULL DEFAULT 0 CHECK (mismatch_count >= 0),
  unmatched_count integer NOT NULL DEFAULT 0 CHECK (unmatched_count >= 0),
  failure_reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (provider, statement_reference)
);

CREATE TABLE IF NOT EXISTS public.provider_statement_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_id uuid NOT NULL REFERENCES public.provider_statement_imports(id),
  provider text NOT NULL CHECK (provider IN ('onemoney', 'ecocash', 'innbucks', 'card', 'visa', 'mastercard', 'paypal')),
  line_reference text NOT NULL,
  provider_reference text,
  provider_event_id text,
  line_type text NOT NULL CHECK (line_type IN ('deposit', 'withdrawal', 'refund', 'chargeback', 'fee', 'adjustment', 'settlement')),
  amount numeric(18,2) NOT NULL,
  amount_minor bigint NOT NULL CHECK (amount_minor <> 0),
  currency text NOT NULL CHECK (currency IN ('USD', 'ZWG')),
  status text NOT NULL,
  match_status text NOT NULL DEFAULT 'unmatched' CHECK (match_status IN ('matched', 'amount_mismatch', 'currency_mismatch', 'missing_ledger', 'missing_provider_event', 'unmatched_provider', 'ignored')),
  matched_payment_intent_id uuid REFERENCES public.payment_intents(id),
  matched_wallet_transaction_id uuid REFERENCES public.wallet_transactions(id),
  mismatch_reason text,
  occurred_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.refund_intents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL CHECK (provider IN ('onemoney', 'ecocash', 'innbucks', 'card', 'visa', 'mastercard', 'paypal', 'internal')),
  user_id uuid,
  original_payment_intent_id uuid REFERENCES public.payment_intents(id),
  original_wallet_transaction_id uuid REFERENCES public.wallet_transactions(id),
  amount numeric(18,2) NOT NULL CHECK (amount > 0),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  currency text NOT NULL CHECK (currency IN ('USD', 'ZWG')),
  status text NOT NULL DEFAULT 'pending_review' CHECK (status IN ('pending_review', 'approved', 'processing', 'posted', 'failed', 'cancelled', 'rejected')),
  reason text NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  created_by uuid,
  approved_by uuid,
  approved_at timestamptz,
  wallet_transaction_id uuid REFERENCES public.wallet_transactions(id),
  failure_reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.chargeback_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL CHECK (provider IN ('onemoney', 'ecocash', 'innbucks', 'card', 'visa', 'mastercard', 'paypal')),
  provider_reference text,
  provider_chargeback_id text NOT NULL,
  payment_intent_id uuid REFERENCES public.payment_intents(id),
  wallet_transaction_id uuid REFERENCES public.wallet_transactions(id),
  amount numeric(18,2) NOT NULL CHECK (amount > 0),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  currency text NOT NULL CHECK (currency IN ('USD', 'ZWG')),
  status text NOT NULL DEFAULT 'received' CHECK (status IN ('received', 'under_review', 'accepted', 'represented', 'won', 'lost', 'closed')),
  reason text,
  opened_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_chargeback_id)
);

CREATE TABLE IF NOT EXISTS public.financial_disputes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dispute_type text NOT NULL CHECK (dispute_type IN ('refund', 'chargeback', 'ride_settlement', 'provider_statement', 'ledger_drift', 'cash_liability')),
  status text NOT NULL DEFAULT 'opened' CHECK (status IN ('opened', 'under_review', 'awaiting_provider', 'awaiting_user', 'resolved_refund', 'resolved_no_change', 'resolved_adjustment', 'closed', 'cancelled')),
  provider text CHECK (provider IS NULL OR provider IN ('onemoney', 'ecocash', 'innbucks', 'card', 'visa', 'mastercard', 'paypal', 'internal')),
  ride_id uuid,
  user_id uuid,
  payment_intent_id uuid REFERENCES public.payment_intents(id),
  wallet_transaction_id uuid REFERENCES public.wallet_transactions(id),
  amount numeric(18,2),
  amount_minor bigint NOT NULL DEFAULT 0 CHECK (amount_minor >= 0),
  currency text CHECK (currency IS NULL OR currency IN ('USD', 'ZWG')),
  reason text NOT NULL,
  resolution text,
  opened_by uuid,
  assigned_to uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.financial_incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  severity text NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  status text NOT NULL DEFAULT 'opened' CHECK (status IN ('opened', 'investigating', 'mitigated', 'resolved', 'closed')),
  incident_type text NOT NULL CHECK (incident_type IN ('settlement_failure', 'provider_reconciliation', 'ledger_drift', 'callback_failure', 'chargeback_spike', 'refund_failure', 'operational')),
  provider text CHECK (provider IS NULL OR provider IN ('onemoney', 'ecocash', 'innbucks', 'card', 'visa', 'mastercard', 'paypal', 'internal')),
  source_type text,
  source_id text,
  title text NOT NULL,
  description text,
  opened_by uuid,
  resolved_by uuid,
  resolution text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.financial_runbooks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  runbook_key text NOT NULL UNIQUE,
  title text NOT NULL,
  category text NOT NULL CHECK (category IN ('refund', 'chargeback', 'dispute', 'provider_reconciliation', 'incident', 'ledger_recovery')),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'retired')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  content text NOT NULL,
  created_by uuid,
  approved_by uuid,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.provider_certifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL CHECK (provider IN ('onemoney', 'ecocash', 'innbucks', 'card', 'visa', 'mastercard', 'paypal')),
  certification_type text NOT NULL CHECK (certification_type IN ('mobile_money', 'card_processor', 'paypal', 'callback_security', 'statement_reconciliation')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'passed', 'failed', 'expired', 'revoked')),
  score integer NOT NULL DEFAULT 0 CHECK (score >= 0 AND score <= 100),
  certified_by uuid,
  certified_at timestamptz,
  expires_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.provider_certification_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  certification_id uuid NOT NULL REFERENCES public.provider_certifications(id),
  provider text NOT NULL CHECK (provider IN ('onemoney', 'ecocash', 'innbucks', 'card', 'visa', 'mastercard', 'paypal')),
  check_type text NOT NULL CHECK (check_type IN ('signature_verification', 'callback_replay_window', 'duplicate_callback', 'tampered_amount', 'tampered_reference', 'delayed_callback', 'status_polling', 'statement_reconciliation', 'processor_authorize_capture')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'passed', 'failed', 'warning')),
  evidence text,
  failure_reason text,
  performed_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (certification_id, check_type)
);

CREATE TABLE IF NOT EXISTS public.recovery_drills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  drill_type text NOT NULL CHECK (drill_type IN ('settlement_failure', 'reconciliation_failure', 'provider_callback_failure', 'authorization_release_failure', 'refund_failure', 'chargeback_failure', 'provider_statement_mismatch')),
  provider text CHECK (provider IS NULL OR provider IN ('onemoney', 'ecocash', 'innbucks', 'card', 'visa', 'mastercard', 'paypal', 'internal')),
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'running', 'passed', 'failed', 'cancelled')),
  score integer NOT NULL DEFAULT 0 CHECK (score >= 0 AND score <= 100),
  triggered_by uuid,
  failure_reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.recovery_drill_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  drill_id uuid NOT NULL REFERENCES public.recovery_drills(id),
  event_type text NOT NULL,
  status text NOT NULL,
  message text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.recovery_scorecards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text CHECK (provider IS NULL OR provider IN ('onemoney', 'ecocash', 'innbucks', 'card', 'visa', 'mastercard', 'paypal', 'internal')),
  score_type text NOT NULL CHECK (score_type IN ('provider_certification', 'recovery_drills', 'reconciliation', 'overall')),
  score integer NOT NULL CHECK (score >= 0 AND score <= 100),
  status text NOT NULL CHECK (status IN ('green', 'yellow', 'red')),
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.finance_approval_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  approval_type text NOT NULL CHECK (approval_type IN ('finance', 'cto', 'risk', 'operations', 'launch_gate', 'provider_activation', 'public_payment_activation', 'finance_close')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'expired')),
  target_type text NOT NULL,
  target_id text NOT NULL,
  requested_by uuid NOT NULL,
  required_approval_count integer NOT NULL DEFAULT 2 CHECK (required_approval_count >= 2),
  approvals_count integer NOT NULL DEFAULT 0 CHECK (approvals_count >= 0),
  rejection_reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.finance_approval_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.finance_approval_requests(id),
  approver_id uuid NOT NULL,
  approver_role text NOT NULL CHECK (approver_role IN ('finance', 'cto', 'risk', 'operations', 'admin')),
  decision text NOT NULL CHECK (decision IN ('approved', 'rejected')),
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (request_id, approver_id)
);

CREATE TABLE IF NOT EXISTS public.launch_gates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gate_key text NOT NULL UNIQUE,
  gate_type text NOT NULL CHECK (gate_type IN ('provider_activation', 'public_payment_activation', 'wallet_ride_activation', 'withdrawal_activation', 'production_launch')),
  provider text CHECK (provider IS NULL OR provider IN ('onemoney', 'ecocash', 'innbucks', 'card', 'visa', 'mastercard', 'paypal', 'internal')),
  status text NOT NULL DEFAULT 'blocked' CHECK (status IN ('blocked', 'pending_approval', 'approved', 'rejected')),
  readiness_score integer NOT NULL DEFAULT 0 CHECK (readiness_score >= 0 AND readiness_score <= 100),
  finance_approval_request_id uuid REFERENCES public.finance_approval_requests(id),
  cto_approval_request_id uuid REFERENCES public.finance_approval_requests(id),
  created_by uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.finance_close_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  close_type text NOT NULL CHECK (close_type IN ('daily', 'monthly')),
  status text NOT NULL DEFAULT 'opened' CHECK (status IN ('opened', 'reconciling', 'pending_signoff', 'signed_off', 'failed', 'reopened')),
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  opened_by uuid,
  signed_off_by uuid,
  mismatch_count integer NOT NULL DEFAULT 0 CHECK (mismatch_count >= 0),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.finance_signoffs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  signoff_type text NOT NULL CHECK (signoff_type IN ('finance', 'cto', 'risk', 'operations')),
  target_type text NOT NULL CHECK (target_type IN ('finance_close', 'launch_gate', 'provider_activation', 'public_payment_activation', 'monthly_close')),
  target_id text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'signed', 'rejected')),
  signer_id uuid NOT NULL,
  reason text,
  signed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (signoff_type, target_type, target_id, signer_id)
);

CREATE TABLE IF NOT EXISTS public.launch_readiness_scorecards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  score integer NOT NULL CHECK (score >= 0 AND score <= 100),
  status text NOT NULL CHECK (status IN ('red', 'yellow', 'green')),
  public_payments_ready boolean NOT NULL DEFAULT false,
  provider_activation_ready boolean NOT NULL DEFAULT false,
  finance_close_ready boolean NOT NULL DEFAULT false,
  dual_approval_ready boolean NOT NULL DEFAULT false,
  recovery_drills_ready boolean NOT NULL DEFAULT false,
  created_by uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.release_readiness_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category text NOT NULL CHECK (category IN ('architecture', 'reliability', 'security', 'finance', 'governance', 'operations', 'provider_readiness', 'launch_readiness')),
  component text NOT NULL,
  status text NOT NULL DEFAULT 'present' CHECK (status IN ('present', 'missing', 'warning')),
  evidence_type text NOT NULL,
  evidence_ref text,
  score_impact integer NOT NULL DEFAULT 0,
  collected_by uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.launch_gate_drills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  drill_type text NOT NULL CHECK (drill_type IN ('provider_activation', 'public_payment_activation', 'wallet_activation', 'withdrawal_activation', 'production_launch')),
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'passed', 'failed')),
  provider text CHECK (provider IS NULL OR provider IN ('onemoney', 'ecocash', 'innbucks', 'card', 'visa', 'mastercard', 'paypal', 'internal')),
  simulated_gate_type text NOT NULL CHECK (simulated_gate_type IN ('provider_activation', 'public_payment_activation', 'wallet_ride_activation', 'withdrawal_activation', 'production_launch')),
  missing_approval_blocked boolean NOT NULL DEFAULT false,
  low_score_blocked boolean NOT NULL DEFAULT false,
  certification_blocked boolean NOT NULL DEFAULT false,
  reconciliation_blocked boolean NOT NULL DEFAULT false,
  all_requirements_approved boolean NOT NULL DEFAULT false,
  no_activation_mutation boolean NOT NULL DEFAULT true,
  triggered_by uuid,
  failure_reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.final_readiness_scorecards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  architecture_score integer NOT NULL CHECK (architecture_score >= 0 AND architecture_score <= 100),
  reliability_score integer NOT NULL CHECK (reliability_score >= 0 AND reliability_score <= 100),
  security_score integer NOT NULL CHECK (security_score >= 0 AND security_score <= 100),
  finance_score integer NOT NULL CHECK (finance_score >= 0 AND finance_score <= 100),
  governance_score integer NOT NULL CHECK (governance_score >= 0 AND governance_score <= 100),
  operations_score integer NOT NULL CHECK (operations_score >= 0 AND operations_score <= 100),
  provider_readiness_score integer NOT NULL CHECK (provider_readiness_score >= 0 AND provider_readiness_score <= 100),
  launch_readiness_score integer NOT NULL CHECK (launch_readiness_score >= 0 AND launch_readiness_score <= 100),
  overall_score integer NOT NULL CHECK (overall_score >= 0 AND overall_score <= 100),
  status text NOT NULL CHECK (status IN ('red', 'yellow', 'green')),
  launch_recommendation text NOT NULL CHECK (launch_recommendation IN ('not_approved_for_public_launch', 'approved_for_controlled_internal_launch_drill_only')),
  blockers text,
  created_by uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.executive_signoff_packets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  packet_type text NOT NULL CHECK (packet_type IN ('finance', 'cto', 'risk', 'operations', 'executive_release')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'conditional_approval')),
  finance_status text NOT NULL DEFAULT 'pending' CHECK (finance_status IN ('pending', 'approved', 'rejected', 'conditional_approval')),
  cto_status text NOT NULL DEFAULT 'pending' CHECK (cto_status IN ('pending', 'approved', 'rejected', 'conditional_approval')),
  risk_status text NOT NULL DEFAULT 'pending' CHECK (risk_status IN ('pending', 'approved', 'rejected', 'conditional_approval')),
  operations_status text NOT NULL DEFAULT 'pending' CHECK (operations_status IN ('pending', 'approved', 'rejected', 'conditional_approval')),
  evidence_bundle jsonb NOT NULL DEFAULT '{}'::jsonb,
  readiness_scorecard_id uuid REFERENCES public.final_readiness_scorecards(id),
  generated_by uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.executive_approval_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  packet_id uuid NOT NULL REFERENCES public.executive_signoff_packets(id),
  approver_role text NOT NULL CHECK (approver_role IN ('finance', 'cto', 'risk', 'operations')),
  approver_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'conditional_approval')),
  conditions text,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (packet_id, approver_role)
);

CREATE TABLE IF NOT EXISTS public.launch_blockers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  owner_id uuid NOT NULL,
  due_date timestamptz,
  resolved_by uuid,
  resolution text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.internal_launch_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  outcome text NOT NULL CHECK (outcome IN ('not_ready', 'internal_pilot_ready', 'controlled_launch_ready', 'public_launch_ready')),
  provider_activation_simulated boolean NOT NULL DEFAULT false,
  wallet_activation_simulated boolean NOT NULL DEFAULT false,
  withdrawal_activation_simulated boolean NOT NULL DEFAULT false,
  public_payment_activation_simulated boolean NOT NULL DEFAULT false,
  open_blockers_count integer NOT NULL DEFAULT 0 CHECK (open_blockers_count >= 0),
  overall_readiness_score integer NOT NULL DEFAULT 0 CHECK (overall_readiness_score >= 0 AND overall_readiness_score <= 100),
  decided_by uuid,
  decision_reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.live_drill_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  drill_type text NOT NULL CHECK (drill_type IN ('settlement', 'authorization', 'reconciliation', 'provider_callback', 'refund', 'dispute', 'launch_gate')),
  provider text CHECK (provider IS NULL OR provider IN ('onemoney', 'ecocash', 'innbucks', 'card', 'visa', 'mastercard', 'paypal', 'internal')),
  status text NOT NULL CHECK (status IN ('passed', 'failed', 'requires_review')),
  evidence_ref text NOT NULL,
  submitted_by uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.drill_evidence_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  evidence_id uuid NOT NULL REFERENCES public.live_drill_evidence(id),
  reviewer_role text NOT NULL CHECK (reviewer_role IN ('finance', 'cto', 'risk', 'operations')),
  reviewer_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (evidence_id, reviewer_role)
);

CREATE TABLE IF NOT EXISTS public.production_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  severity text NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  owner_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'investigating', 'mitigated', 'verified', 'closed')),
  remediation_plan text NOT NULL,
  target_resolution_date timestamptz,
  verified_by uuid,
  closed_by uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.reliability_scorecards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scorecard_type text NOT NULL CHECK (scorecard_type IN ('settlement', 'provider', 'reconciliation', 'governance', 'launch_readiness', 'overall')),
  settlement_reliability_score integer NOT NULL CHECK (settlement_reliability_score >= 0 AND settlement_reliability_score <= 100),
  provider_reliability_score integer NOT NULL CHECK (provider_reliability_score >= 0 AND provider_reliability_score <= 100),
  reconciliation_reliability_score integer NOT NULL CHECK (reconciliation_reliability_score >= 0 AND reconciliation_reliability_score <= 100),
  governance_reliability_score integer NOT NULL CHECK (governance_reliability_score >= 0 AND governance_reliability_score <= 100),
  launch_readiness_reliability_score integer NOT NULL CHECK (launch_readiness_reliability_score >= 0 AND launch_readiness_reliability_score <= 100),
  overall_score integer NOT NULL CHECK (overall_score >= 0 AND overall_score <= 100),
  authorization_outcome text NOT NULL CHECK (authorization_outcome IN ('not_ready', 'ready_for_internal_pilot', 'ready_for_controlled_launch', 'ready_for_public_launch')),
  created_by uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.control_room_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  settlement_health text NOT NULL CHECK (settlement_health IN ('green', 'yellow', 'red')),
  provider_health text NOT NULL CHECK (provider_health IN ('green', 'yellow', 'red')),
  reconciliation_health text NOT NULL CHECK (reconciliation_health IN ('green', 'yellow', 'red')),
  authorization_health text NOT NULL CHECK (authorization_health IN ('green', 'yellow', 'red')),
  launch_readiness_health text NOT NULL CHECK (launch_readiness_health IN ('green', 'yellow', 'red')),
  created_by uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.daily_finance_closes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  close_date date NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'reconciling', 'pending_review', 'signed_off', 'failed')),
  opening_balance_minor bigint NOT NULL DEFAULT 0,
  closing_balance_minor bigint NOT NULL DEFAULT 0,
  provider_total_minor bigint NOT NULL DEFAULT 0,
  wallet_total_minor bigint NOT NULL DEFAULT 0,
  reconciliation_status text NOT NULL,
  unresolved_exceptions integer NOT NULL DEFAULT 0 CHECK (unresolved_exceptions >= 0),
  opened_by uuid,
  signed_off_by uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  signed_off_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.daily_close_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  close_id uuid NOT NULL REFERENCES public.daily_finance_closes(id),
  review_role text NOT NULL CHECK (review_role IN ('finance', 'operations')),
  reviewer_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (close_id, review_role)
);

CREATE TABLE IF NOT EXISTS public.daily_reliability_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  metric_date date NOT NULL UNIQUE,
  settlement_success_rate integer NOT NULL CHECK (settlement_success_rate >= 0 AND settlement_success_rate <= 100),
  provider_callback_success_rate integer NOT NULL CHECK (provider_callback_success_rate >= 0 AND provider_callback_success_rate <= 100),
  reconciliation_success_rate integer NOT NULL CHECK (reconciliation_success_rate >= 0 AND reconciliation_success_rate <= 100),
  refund_success_rate integer NOT NULL CHECK (refund_success_rate >= 0 AND refund_success_rate <= 100),
  dispute_resolution_rate integer NOT NULL CHECK (dispute_resolution_rate >= 0 AND dispute_resolution_rate <= 100),
  created_by uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.pilot_monitoring_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pilot_users integer NOT NULL DEFAULT 0 CHECK (pilot_users >= 0),
  pilot_transactions integer NOT NULL DEFAULT 0 CHECK (pilot_transactions >= 0),
  pilot_deposits integer NOT NULL DEFAULT 0 CHECK (pilot_deposits >= 0),
  pilot_withdrawals integer NOT NULL DEFAULT 0 CHECK (pilot_withdrawals >= 0),
  pilot_failures integer NOT NULL DEFAULT 0 CHECK (pilot_failures >= 0),
  created_by uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.internal_pilot_runbooks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  runbook_type text NOT NULL CHECK (runbook_type IN ('settlement_incident', 'reconciliation_incident', 'provider_callback_failure', 'refund_incident', 'dispute_incident', 'authorization_failure')),
  title text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('draft', 'active', 'retired')),
  owner_id uuid NOT NULL,
  steps jsonb NOT NULL DEFAULT '[]'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.day1_close_simulations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status text NOT NULL CHECK (status IN ('open', 'reconciling', 'pending_review', 'signed_off', 'failed')),
  opening_balance_validated boolean NOT NULL DEFAULT false,
  transaction_validated boolean NOT NULL DEFAULT false,
  provider_total_validated boolean NOT NULL DEFAULT false,
  wallet_total_validated boolean NOT NULL DEFAULT false,
  reconciliation_validated boolean NOT NULL DEFAULT false,
  exception_review_completed boolean NOT NULL DEFAULT false,
  finance_signed_off boolean NOT NULL DEFAULT false,
  operations_signed_off boolean NOT NULL DEFAULT false,
  simulated_by uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.incident_escalations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_type text NOT NULL,
  level text NOT NULL CHECK (level IN ('informational', 'warning', 'high', 'critical')),
  status text NOT NULL DEFAULT 'opened',
  owner_id uuid NOT NULL,
  source_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.pilot_operations_timeline (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL CHECK (event_type IN ('pilot_start', 'pilot_checkpoint', 'pilot_review', 'pilot_close')),
  status text,
  actor_id uuid,
  notes text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.internal_pilot_success_criteria (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  settlement_success boolean NOT NULL DEFAULT false,
  reconciliation_success boolean NOT NULL DEFAULT false,
  provider_success boolean NOT NULL DEFAULT false,
  reliability_score integer NOT NULL CHECK (reliability_score >= 0 AND reliability_score <= 100),
  unresolved_exceptions integer NOT NULL DEFAULT 0 CHECK (unresolved_exceptions >= 0),
  outcome text NOT NULL CHECK (outcome IN ('not_ready', 'ready_for_internal_pilot', 'ready_for_controlled_launch', 'ready_for_public_launch')),
  evaluated_by uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.pilot_authorizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  decision text NOT NULL CHECK (decision IN ('no_go', 'conditional_go', 'go')),
  decision_reason text NOT NULL,
  approvers jsonb NOT NULL DEFAULT '{}'::jsonb,
  conditions text,
  technology_ready boolean NOT NULL DEFAULT false,
  financial_ready boolean NOT NULL DEFAULT false,
  provider_ready boolean NOT NULL DEFAULT false,
  governance_ready boolean NOT NULL DEFAULT false,
  operational_ready boolean NOT NULL DEFAULT false,
  reliability_ready boolean NOT NULL DEFAULT false,
  critical_exceptions_exist boolean NOT NULL DEFAULT false,
  high_exceptions_exist boolean NOT NULL DEFAULT false,
  reconciliation_incomplete boolean NOT NULL DEFAULT false,
  finance_signoff_missing boolean NOT NULL DEFAULT false,
  operations_signoff_missing boolean NOT NULL DEFAULT false,
  cto_signoff_missing boolean NOT NULL DEFAULT false,
  risk_signoff_missing boolean NOT NULL DEFAULT false,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.pilot_scope_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pilot_users integer NOT NULL DEFAULT 0 CHECK (pilot_users >= 0),
  pilot_drivers integer NOT NULL DEFAULT 0 CHECK (pilot_drivers >= 0),
  pilot_riders integer NOT NULL DEFAULT 0 CHECK (pilot_riders >= 0),
  pilot_transactions integer NOT NULL DEFAULT 0 CHECK (pilot_transactions >= 0),
  pilot_duration_days integer NOT NULL CHECK (pilot_duration_days > 0),
  defined_by uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.pilot_success_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  settlement_reliability_target integer NOT NULL CHECK (settlement_reliability_target >= 0 AND settlement_reliability_target <= 100),
  reconciliation_reliability_target integer NOT NULL CHECK (reconciliation_reliability_target >= 0 AND reconciliation_reliability_target <= 100),
  provider_reliability_target integer NOT NULL CHECK (provider_reliability_target >= 0 AND provider_reliability_target <= 100),
  dispute_resolution_target integer NOT NULL CHECK (dispute_resolution_target >= 0 AND dispute_resolution_target <= 100),
  incident_response_target integer NOT NULL CHECK (incident_response_target >= 0 AND incident_response_target <= 100),
  defined_by uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.internal_pilot_authorization_executions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pilot_authorization_id uuid REFERENCES public.pilot_authorizations(id),
  status text NOT NULL CHECK (status IN ('active', 'expired', 'revoked', 'completed')),
  decision text NOT NULL CHECK (decision IN ('approved', 'conditional_approval', 'rejected', 'expired')),
  decision_reason text NOT NULL,
  required_signoffs jsonb NOT NULL DEFAULT '{}'::jsonb,
  required_evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  unresolved_exceptions integer NOT NULL DEFAULT 0 CHECK (unresolved_exceptions >= 0),
  readiness_score_threshold integer NOT NULL CHECK (readiness_score_threshold >= 0 AND readiness_score_threshold <= 100),
  readiness_score integer NOT NULL CHECK (readiness_score >= 0 AND readiness_score <= 100),
  conditions text,
  approved_pilot_users integer NOT NULL DEFAULT 0 CHECK (approved_pilot_users >= 0),
  approved_drivers integer NOT NULL DEFAULT 0 CHECK (approved_drivers >= 0),
  approved_riders integer NOT NULL DEFAULT 0 CHECK (approved_riders >= 0),
  pilot_transaction_limit integer NOT NULL DEFAULT 0 CHECK (pilot_transaction_limit >= 0),
  pilot_duration_days integer NOT NULL CHECK (pilot_duration_days > 0),
  expires_at timestamptz,
  created_by uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.internal_pilot_authorization_audits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  authorization_execution_id uuid NOT NULL REFERENCES public.internal_pilot_authorization_executions(id),
  approver_id uuid NOT NULL,
  decision text NOT NULL CHECK (decision IN ('approved', 'conditional_approval', 'rejected', 'expired')),
  reason text,
  conditions text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.internal_pilot_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  authorization_execution_id uuid NOT NULL REFERENCES public.internal_pilot_authorization_executions(id),
  user_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('rider', 'driver', 'admin', 'operations', 'finance', 'risk')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'removed')),
  enrollment_source text,
  enrolled_by uuid NOT NULL,
  reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  enrolled_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (authorization_execution_id, user_id, role)
);

CREATE TABLE IF NOT EXISTS public.internal_pilot_participant_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id uuid NOT NULL REFERENCES public.internal_pilot_participants(id),
  authorization_execution_id uuid NOT NULL REFERENCES public.internal_pilot_authorization_executions(id),
  user_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('rider', 'driver', 'admin', 'operations', 'finance', 'risk')),
  previous_status text,
  new_status text,
  action text NOT NULL,
  reason text,
  actor_id uuid NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.internal_pilot_health_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  authorization_execution_id uuid NOT NULL REFERENCES public.internal_pilot_authorization_executions(id),
  report_date date NOT NULL,
  ride_requests integer NOT NULL DEFAULT 0 CHECK (ride_requests >= 0),
  completed_rides integer NOT NULL DEFAULT 0 CHECK (completed_rides >= 0),
  cancelled_rides integer NOT NULL DEFAULT 0 CHECK (cancelled_rides >= 0),
  failed_rides integer NOT NULL DEFAULT 0 CHECK (failed_rides >= 0),
  wallet_payments integer NOT NULL DEFAULT 0 CHECK (wallet_payments >= 0),
  cash_payments integer NOT NULL DEFAULT 0 CHECK (cash_payments >= 0),
  driver_participation integer NOT NULL DEFAULT 0 CHECK (driver_participation >= 0),
  rider_participation integer NOT NULL DEFAULT 0 CHECK (rider_participation >= 0),
  incident_count integer NOT NULL DEFAULT 0 CHECK (incident_count >= 0),
  critical_incidents integer NOT NULL DEFAULT 0 CHECK (critical_incidents >= 0),
  authorization_status text NOT NULL,
  ride_completion_rate integer NOT NULL DEFAULT 0 CHECK (ride_completion_rate >= 0 AND ride_completion_rate <= 100),
  cancellation_rate integer NOT NULL DEFAULT 0 CHECK (cancellation_rate >= 0 AND cancellation_rate <= 100),
  wallet_success_rate integer NOT NULL DEFAULT 0 CHECK (wallet_success_rate >= 0 AND wallet_success_rate <= 100),
  operational_incident_rate integer NOT NULL DEFAULT 0 CHECK (operational_incident_rate >= 0 AND operational_incident_rate <= 100),
  authorization_compliance_rate integer NOT NULL DEFAULT 0 CHECK (authorization_compliance_rate >= 0 AND authorization_compliance_rate <= 100),
  participant_activity_rate integer NOT NULL DEFAULT 0 CHECK (participant_activity_rate >= 0 AND participant_activity_rate <= 100),
  created_by uuid NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.internal_pilot_incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  authorization_execution_id uuid NOT NULL REFERENCES public.internal_pilot_authorization_executions(id),
  incident_type text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'investigating', 'mitigated', 'resolved', 'closed')),
  source_id text,
  title text NOT NULL,
  description text,
  owner_id uuid,
  opened_by uuid NOT NULL,
  resolved_by uuid,
  resolution text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.internal_pilot_kill_switches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service text NOT NULL UNIQUE CHECK (service IN ('ride_requests', 'matching', 'dispatch', 'wallets', 'deposits', 'withdrawals', 'settlements')),
  status text NOT NULL DEFAULT 'inactive' CHECK (status IN ('active', 'inactive')),
  activated_by uuid,
  activated_at timestamptz,
  deactivated_by uuid,
  deactivated_at timestamptz,
  reason text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.internal_pilot_kill_switch_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kill_switch_id uuid NOT NULL REFERENCES public.internal_pilot_kill_switches(id),
  service text NOT NULL CHECK (service IN ('ride_requests', 'matching', 'dispatch', 'wallets', 'deposits', 'withdrawals', 'settlements')),
  status text NOT NULL CHECK (status IN ('active', 'inactive')),
  operator_id uuid NOT NULL,
  reason text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.internal_pilot_execution_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  authorization_execution_id uuid NOT NULL REFERENCES public.internal_pilot_authorization_executions(id),
  participant_id uuid REFERENCES public.internal_pilot_participants(id),
  event_type text NOT NULL CHECK (event_type IN (
    'participant_joined',
    'ride_requested',
    'ride_offer_created',
    'ride_offer_accepted',
    'driver_enroute',
    'pickup_reached',
    'trip_started',
    'trip_completed',
    'trip_cancelled',
    'wallet_payment_attempted',
    'wallet_payment_completed',
    'cash_payment_completed',
    'platform_fee_recorded',
    'driver_earnings_recorded',
    'authorization_check_passed',
    'authorization_check_failed',
    'incident_created',
    'incident_resolved',
    'kill_switch_triggered'
  )),
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  status text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.internal_pilot_evidence_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  authorization_execution_id uuid NOT NULL REFERENCES public.internal_pilot_authorization_executions(id),
  report_period_start timestamptz NOT NULL,
  report_period_end timestamptz NOT NULL,
  total_events integer NOT NULL DEFAULT 0 CHECK (total_events >= 0),
  total_rides integer NOT NULL DEFAULT 0 CHECK (total_rides >= 0),
  completed_rides integer NOT NULL DEFAULT 0 CHECK (completed_rides >= 0),
  cancelled_rides integer NOT NULL DEFAULT 0 CHECK (cancelled_rides >= 0),
  wallet_transactions integer NOT NULL DEFAULT 0 CHECK (wallet_transactions >= 0),
  cash_transactions integer NOT NULL DEFAULT 0 CHECK (cash_transactions >= 0),
  incidents integer NOT NULL DEFAULT 0 CHECK (incidents >= 0),
  critical_incidents integer NOT NULL DEFAULT 0 CHECK (critical_incidents >= 0),
  compliance_score integer NOT NULL DEFAULT 0 CHECK (compliance_score >= 0 AND compliance_score <= 100),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (report_period_end > report_period_start)
);

CREATE TABLE IF NOT EXISTS public.internal_pilot_objective_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  authorization_execution_id uuid NOT NULL REFERENCES public.internal_pilot_authorization_executions(id),
  objective_name text NOT NULL,
  target_value integer NOT NULL CHECK (target_value >= 0),
  actual_value integer NOT NULL CHECK (actual_value >= 0),
  achieved boolean NOT NULL DEFAULT false,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.internal_pilot_board_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  authorization_execution_id uuid NOT NULL REFERENCES public.internal_pilot_authorization_executions(id),
  review_period_start timestamptz NOT NULL,
  review_period_end timestamptz NOT NULL,
  review_status text NOT NULL DEFAULT 'pending' CHECK (review_status IN ('pending', 'in_review', 'completed')),
  decision text NOT NULL DEFAULT 'defer' CHECK (decision IN ('approved', 'conditional_approval', 'rejected', 'defer')),
  decision_reason text NOT NULL,
  reviewed_by uuid,
  reviewed_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (review_period_end > review_period_start)
);

CREATE TABLE IF NOT EXISTS public.internal_pilot_review_findings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  board_review_id uuid NOT NULL REFERENCES public.internal_pilot_board_reviews(id),
  category text NOT NULL CHECK (category IN ('operations', 'financial', 'compliance', 'platform', 'safety', 'dispatch', 'wallet', 'governance')),
  severity text NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  title text NOT NULL,
  description text,
  recommendation text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.internal_pilot_readiness_assessments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  board_review_id uuid NOT NULL REFERENCES public.internal_pilot_board_reviews(id),
  category text NOT NULL CHECK (category IN ('operational_readiness', 'financial_readiness', 'dispatch_readiness', 'wallet_readiness', 'governance_readiness', 'compliance_readiness', 'scalability_readiness')),
  score integer NOT NULL CHECK (score >= 0 AND score <= 100),
  target_score integer NOT NULL CHECK (target_score >= 0 AND target_score <= 100),
  passed boolean NOT NULL DEFAULT false,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.wallet_pilot_programs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  program_name text NOT NULL,
  city text NOT NULL CHECK (city IN ('Gwanda', 'Bulawayo')),
  status text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'active', 'paused', 'completed', 'suspended')),
  participant_limit integer NOT NULL CHECK (participant_limit > 0),
  driver_limit integer NOT NULL CHECK (driver_limit > 0),
  wallet_balance_limit numeric(18,2) NOT NULL DEFAULT 0 CHECK (wallet_balance_limit >= 0),
  wallet_balance_limit_minor bigint NOT NULL CHECK (wallet_balance_limit_minor >= 0),
  daily_transaction_limit numeric(18,2) NOT NULL DEFAULT 0 CHECK (daily_transaction_limit >= 0),
  daily_transaction_limit_minor bigint NOT NULL CHECK (daily_transaction_limit_minor >= 0),
  monthly_transaction_limit numeric(18,2) NOT NULL DEFAULT 0 CHECK (monthly_transaction_limit >= 0),
  monthly_transaction_limit_minor bigint NOT NULL CHECK (monthly_transaction_limit_minor >= 0),
  currency text NOT NULL DEFAULT 'USD' CHECK (currency IN ('USD', 'ZWG')),
  start_date timestamptz NOT NULL,
  end_date timestamptz NOT NULL,
  authorization_execution_id uuid NOT NULL REFERENCES public.internal_pilot_authorization_executions(id),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date > start_date)
);

CREATE TABLE IF NOT EXISTS public.wallet_pilot_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id uuid NOT NULL REFERENCES public.wallet_pilot_programs(id),
  user_id uuid NOT NULL,
  participant_type text NOT NULL CHECK (participant_type IN ('rider', 'driver')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'removed')),
  enrolled_at timestamptz NOT NULL DEFAULT now(),
  enrolled_by uuid NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (program_id, user_id, participant_type)
);

CREATE TABLE IF NOT EXISTS public.wallet_pilot_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id uuid NOT NULL REFERENCES public.wallet_pilot_programs(id),
  wallet_id uuid NOT NULL REFERENCES public.wallet_accounts(id),
  user_id uuid NOT NULL,
  transaction_type text NOT NULL CHECK (transaction_type IN ('deposit', 'ride_payment', 'refund', 'adjustment')),
  amount numeric(18,2) NOT NULL DEFAULT 0 CHECK (amount >= 0),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  currency text NOT NULL CHECK (currency IN ('USD', 'ZWG')),
  status text NOT NULL DEFAULT 'recorded' CHECK (status IN ('recorded', 'rejected', 'failed')),
  evidence_id uuid REFERENCES public.internal_pilot_execution_events(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.wallet_pilot_reconciliation_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id uuid NOT NULL REFERENCES public.wallet_pilot_programs(id),
  report_date date NOT NULL,
  ledger_balance numeric(18,2) NOT NULL DEFAULT 0,
  ledger_balance_minor bigint NOT NULL DEFAULT 0,
  wallet_balance numeric(18,2) NOT NULL DEFAULT 0,
  wallet_balance_minor bigint NOT NULL DEFAULT 0,
  transaction_history_balance numeric(18,2) NOT NULL DEFAULT 0,
  transaction_history_balance_minor bigint NOT NULL DEFAULT 0,
  variance numeric(18,2) NOT NULL DEFAULT 0,
  variance_minor bigint NOT NULL DEFAULT 0,
  currency text NOT NULL CHECK (currency IN ('USD', 'ZWG')),
  status text NOT NULL CHECK (status IN ('balanced', 'variance_detected', 'investigating')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (program_id, report_date)
);

CREATE TABLE IF NOT EXISTS public.wallet_pilot_fraud_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id uuid NOT NULL REFERENCES public.wallet_pilot_programs(id),
  user_id uuid NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('duplicate_payments', 'unusual_payment_frequency', 'abnormal_refund_activity', 'rapid_balance_cycling', 'multi_account_abuse', 'wallet_farming', 'pilot_abuse', 'reconciliation_variance')),
  severity text NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  description text NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'investigating', 'resolved', 'closed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.wallet_pilot_kill_switches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id uuid NOT NULL REFERENCES public.wallet_pilot_programs(id),
  control text NOT NULL CHECK (control IN ('disable_deposits', 'disable_wallet_payments', 'disable_refunds', 'disable_wallet_adjustments')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  operator_id uuid NOT NULL,
  reason text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  activated_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (program_id, control)
);

CREATE TABLE IF NOT EXISTS public.pilot_wallet_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  description text,
  status text NOT NULL DEFAULT 'enabled' CHECK (status IN ('enabled', 'disabled', 'suspended', 'removed')),
  created_by uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.pilot_wallet_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  role text NOT NULL CHECK (role IN ('pilot_rider', 'pilot_driver', 'pilot_admin')),
  status text NOT NULL CHECK (status IN ('enabled', 'disabled', 'suspended', 'removed')),
  group_name text,
  enabled_by uuid,
  disabled_by uuid,
  suspended_by uuid,
  removed_by uuid,
  reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.pilot_wallet_user_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  admin_user_id uuid NOT NULL,
  action text NOT NULL,
  role text NOT NULL CHECK (role IN ('pilot_rider', 'pilot_driver', 'pilot_admin')),
  status text NOT NULL CHECK (status IN ('enabled', 'disabled', 'suspended', 'removed')),
  group_name text,
  reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wallet_accounts_owner
  ON public.wallet_accounts (owner_user_id, account_type, currency);

CREATE INDEX IF NOT EXISTS idx_wallet_transactions_idempotency
  ON public.wallet_transactions (idempotency_key);

CREATE INDEX IF NOT EXISTS idx_wallet_transactions_ride
  ON public.wallet_transactions (ride_id);

CREATE INDEX IF NOT EXISTS idx_wallet_transactions_status_created
  ON public.wallet_transactions (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_wallet_ledger_entries_account_created
  ON public.wallet_ledger_entries (account_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_wallet_ledger_entries_transaction
  ON public.wallet_ledger_entries (transaction_id);

CREATE INDEX IF NOT EXISTS idx_payment_intents_user_status
  ON public.payment_intents (user_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_payment_intents_scoped_idempotency
  ON public.payment_intents (user_id, provider, operation, idempotency_key);

CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_intents_provider_reference_unique
  ON public.payment_intents (provider, provider_reference)
  WHERE provider_reference IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_provider_events_reconciliation
  ON public.provider_events (provider, provider_reference, status);

CREATE INDEX IF NOT EXISTS idx_withdrawal_requests_driver_status
  ON public.withdrawal_requests (driver_id, status, requested_at DESC);

CREATE INDEX IF NOT EXISTS idx_wallet_authorizations_rider_status
  ON public.wallet_authorizations (rider_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_wallet_authorizations_expiry
  ON public.wallet_authorizations (status, expires_at);

CREATE INDEX IF NOT EXISTS idx_wallet_authorization_events_auth
  ON public.wallet_authorization_events (authorization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_settlement_records_ride
  ON public.settlement_records (ride_id);

CREATE INDEX IF NOT EXISTS idx_settlement_records_status
  ON public.settlement_records (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_reconciliation_runs_provider_status
  ON public.reconciliation_runs (provider, status, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_financial_jobs_ready
  ON public.financial_jobs (status, next_attempt_at, locked_until);

CREATE INDEX IF NOT EXISTS idx_financial_metrics_type_created
  ON public.financial_metrics (metric_type, provider, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_provider_statement_lines_match
  ON public.provider_statement_lines (provider, match_status, provider_reference);

CREATE INDEX IF NOT EXISTS idx_refund_intents_status
  ON public.refund_intents (status, provider, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_chargeback_records_status
  ON public.chargeback_records (status, provider, opened_at DESC);

CREATE INDEX IF NOT EXISTS idx_financial_disputes_status
  ON public.financial_disputes (status, dispute_type, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_financial_incidents_status
  ON public.financial_incidents (status, severity, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_provider_certifications_provider_status
  ON public.provider_certifications (provider, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_provider_certification_checks_status
  ON public.provider_certification_checks (provider, status, check_type);

CREATE INDEX IF NOT EXISTS idx_recovery_drills_status
  ON public.recovery_drills (status, drill_type, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_recovery_scorecards_provider
  ON public.recovery_scorecards (provider, score_type, period_end DESC);

CREATE INDEX IF NOT EXISTS idx_finance_approval_requests_status
  ON public.finance_approval_requests (status, approval_type, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_finance_approval_events_request
  ON public.finance_approval_events (request_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_launch_gates_status
  ON public.launch_gates (status, gate_type, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_finance_close_runs_period
  ON public.finance_close_runs (close_type, period_start, period_end, status);

CREATE INDEX IF NOT EXISTS idx_finance_signoffs_target
  ON public.finance_signoffs (target_type, target_id, status);

CREATE INDEX IF NOT EXISTS idx_release_readiness_evidence_category
  ON public.release_readiness_evidence (category, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_launch_gate_drills_status
  ON public.launch_gate_drills (status, simulated_gate_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_final_readiness_scorecards_created
  ON public.final_readiness_scorecards (created_at DESC, overall_score DESC);

CREATE INDEX IF NOT EXISTS idx_executive_signoff_packets_status
  ON public.executive_signoff_packets (status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_executive_approval_records_packet
  ON public.executive_approval_records (packet_id, approver_role);

CREATE INDEX IF NOT EXISTS idx_launch_blockers_status
  ON public.launch_blockers (status, severity, due_date);

CREATE INDEX IF NOT EXISTS idx_internal_launch_decisions_created
  ON public.internal_launch_decisions (created_at DESC, outcome);

CREATE INDEX IF NOT EXISTS idx_live_drill_evidence_type
  ON public.live_drill_evidence (drill_type, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_drill_evidence_reviews_evidence
  ON public.drill_evidence_reviews (evidence_id, reviewer_role, status);

CREATE INDEX IF NOT EXISTS idx_production_exceptions_status
  ON public.production_exceptions (status, severity, target_resolution_date);

CREATE INDEX IF NOT EXISTS idx_reliability_scorecards_created
  ON public.reliability_scorecards (scorecard_type, created_at DESC, overall_score DESC);

CREATE INDEX IF NOT EXISTS idx_control_room_snapshots_created
  ON public.control_room_snapshots (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_daily_finance_closes_date_status
  ON public.daily_finance_closes (close_date DESC, status);

CREATE INDEX IF NOT EXISTS idx_daily_close_reviews_close
  ON public.daily_close_reviews (close_id, review_role, status);

CREATE INDEX IF NOT EXISTS idx_daily_reliability_metrics_date
  ON public.daily_reliability_metrics (metric_date DESC);

CREATE INDEX IF NOT EXISTS idx_pilot_monitoring_snapshots_created
  ON public.pilot_monitoring_snapshots (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_internal_pilot_runbooks_type
  ON public.internal_pilot_runbooks (runbook_type, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_day1_close_simulations_created
  ON public.day1_close_simulations (created_at DESC, status);

CREATE INDEX IF NOT EXISTS idx_incident_escalations_level
  ON public.incident_escalations (level, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_pilot_operations_timeline_created
  ON public.pilot_operations_timeline (created_at DESC, event_type);

CREATE INDEX IF NOT EXISTS idx_internal_pilot_success_created
  ON public.internal_pilot_success_criteria (created_at DESC, outcome);

CREATE INDEX IF NOT EXISTS idx_pilot_authorizations_created
  ON public.pilot_authorizations (created_at DESC, decision);

CREATE INDEX IF NOT EXISTS idx_pilot_scope_definitions_created
  ON public.pilot_scope_definitions (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_pilot_success_definitions_created
  ON public.pilot_success_definitions (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_internal_pilot_authorization_executions_status
  ON public.internal_pilot_authorization_executions (status, decision, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_internal_pilot_authorization_audits_execution
  ON public.internal_pilot_authorization_audits (authorization_execution_id, approver_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_internal_pilot_participants_auth_status
  ON public.internal_pilot_participants (authorization_execution_id, status, role);

CREATE INDEX IF NOT EXISTS idx_internal_pilot_participants_user
  ON public.internal_pilot_participants (user_id, status, role);

CREATE INDEX IF NOT EXISTS idx_internal_pilot_participant_events_participant
  ON public.internal_pilot_participant_events (participant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_internal_pilot_health_reports_date
  ON public.internal_pilot_health_reports (authorization_execution_id, report_date DESC);

CREATE INDEX IF NOT EXISTS idx_internal_pilot_incidents_status
  ON public.internal_pilot_incidents (authorization_execution_id, status, severity, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_internal_pilot_kill_switches_status
  ON public.internal_pilot_kill_switches (service, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_internal_pilot_kill_switch_events_service
  ON public.internal_pilot_kill_switch_events (service, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_internal_pilot_execution_events_auth_type
  ON public.internal_pilot_execution_events (authorization_execution_id, event_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_internal_pilot_execution_events_entity
  ON public.internal_pilot_execution_events (entity_type, entity_id, event_type);

CREATE INDEX IF NOT EXISTS idx_internal_pilot_evidence_packages_period
  ON public.internal_pilot_evidence_packages (authorization_execution_id, report_period_start, report_period_end);

CREATE INDEX IF NOT EXISTS idx_internal_pilot_objective_results_auth
  ON public.internal_pilot_objective_results (authorization_execution_id, achieved, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_internal_pilot_board_reviews_auth_status
  ON public.internal_pilot_board_reviews (authorization_execution_id, review_status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_internal_pilot_review_findings_review_severity
  ON public.internal_pilot_review_findings (board_review_id, severity, category, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_internal_pilot_readiness_assessments_review_category
  ON public.internal_pilot_readiness_assessments (board_review_id, category, passed);

CREATE INDEX IF NOT EXISTS idx_wallet_pilot_programs_city_status
  ON public.wallet_pilot_programs (city, status, start_date, end_date);

CREATE INDEX IF NOT EXISTS idx_wallet_pilot_participants_program_status
  ON public.wallet_pilot_participants (program_id, status, participant_type);

CREATE INDEX IF NOT EXISTS idx_wallet_pilot_participants_user
  ON public.wallet_pilot_participants (user_id, status);

CREATE INDEX IF NOT EXISTS idx_wallet_pilot_transactions_program_type
  ON public.wallet_pilot_transactions (program_id, transaction_type, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_wallet_pilot_transactions_wallet_time
  ON public.wallet_pilot_transactions (wallet_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_wallet_pilot_reconciliation_reports_program_date
  ON public.wallet_pilot_reconciliation_reports (program_id, report_date DESC, status);

CREATE INDEX IF NOT EXISTS idx_wallet_pilot_fraud_events_program_severity
  ON public.wallet_pilot_fraud_events (program_id, severity, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_wallet_pilot_kill_switches_program_control
  ON public.wallet_pilot_kill_switches (program_id, control, status);

CREATE INDEX IF NOT EXISTS idx_pilot_wallet_users_status_role
  ON public.pilot_wallet_users (status, role, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_pilot_wallet_user_events_user
  ON public.pilot_wallet_user_events (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_pilot_wallet_user_events_admin
  ON public.pilot_wallet_user_events (admin_user_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.prevent_wallet_ledger_entry_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'wallet ledger entries are immutable; use reversal transactions';
END;
$$;

DROP TRIGGER IF EXISTS trg_wallet_ledger_entries_no_update ON public.wallet_ledger_entries;
CREATE TRIGGER trg_wallet_ledger_entries_no_update
BEFORE UPDATE ON public.wallet_ledger_entries
FOR EACH ROW EXECUTE FUNCTION public.prevent_wallet_ledger_entry_mutation();

DROP TRIGGER IF EXISTS trg_wallet_ledger_entries_no_delete ON public.wallet_ledger_entries;
CREATE TRIGGER trg_wallet_ledger_entries_no_delete
BEFORE DELETE ON public.wallet_ledger_entries
FOR EACH ROW EXECUTE FUNCTION public.prevent_wallet_ledger_entry_mutation();

ALTER TABLE public.wallet_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_ledger_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_intents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.provider_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.withdrawal_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_pins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_authorizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_authorization_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settlement_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reconciliation_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.provider_statement_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.provider_statement_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.refund_intents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chargeback_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_disputes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_runbooks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.provider_certifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.provider_certification_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recovery_drills ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recovery_drill_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recovery_scorecards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_approval_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_approval_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.launch_gates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_close_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_signoffs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.launch_readiness_scorecards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.release_readiness_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.launch_gate_drills ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.final_readiness_scorecards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.executive_signoff_packets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.executive_approval_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.launch_blockers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.internal_launch_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.live_drill_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.drill_evidence_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.production_exceptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reliability_scorecards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.control_room_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_finance_closes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_close_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_reliability_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pilot_monitoring_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.internal_pilot_runbooks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.day1_close_simulations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.incident_escalations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pilot_operations_timeline ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.internal_pilot_success_criteria ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pilot_authorizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pilot_scope_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pilot_success_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.internal_pilot_authorization_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.internal_pilot_authorization_audits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.internal_pilot_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.internal_pilot_participant_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.internal_pilot_health_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.internal_pilot_incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.internal_pilot_kill_switches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.internal_pilot_kill_switch_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.internal_pilot_execution_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.internal_pilot_evidence_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.internal_pilot_objective_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.internal_pilot_board_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.internal_pilot_review_findings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.internal_pilot_readiness_assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_pilot_programs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_pilot_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_pilot_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_pilot_reconciliation_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_pilot_fraud_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_pilot_kill_switches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pilot_wallet_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pilot_wallet_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pilot_wallet_user_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY wallet_accounts_owner_select
  ON public.wallet_accounts
  FOR SELECT
  USING (
    owner_user_id = auth.uid()
    OR auth.jwt() -> 'app_metadata' ->> 'role' = 'admin'
  );

CREATE POLICY wallet_transactions_owner_select
  ON public.wallet_transactions
  FOR SELECT
  USING (
    owner_user_id = auth.uid()
    OR created_by = auth.uid()
    OR auth.jwt() -> 'app_metadata' ->> 'role' = 'admin'
  );

CREATE POLICY wallet_ledger_entries_owner_select
  ON public.wallet_ledger_entries
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.wallet_accounts a
      WHERE a.id = wallet_ledger_entries.account_id
        AND a.owner_user_id = auth.uid()
    )
    OR auth.jwt() -> 'app_metadata' ->> 'role' = 'admin'
  );

CREATE POLICY payment_intents_owner_select
  ON public.payment_intents
  FOR SELECT
  USING (
    user_id = auth.uid()
    OR auth.jwt() -> 'app_metadata' ->> 'role' = 'admin'
  );

CREATE POLICY withdrawal_requests_driver_select
  ON public.withdrawal_requests
  FOR SELECT
  USING (
    driver_id = auth.uid()
    OR auth.jwt() -> 'app_metadata' ->> 'role' = 'admin'
  );

CREATE POLICY wallet_authorizations_owner_select
  ON public.wallet_authorizations
  FOR SELECT
  USING (
    rider_id = auth.uid()
    OR auth.jwt() -> 'app_metadata' ->> 'role' = 'admin'
  );

CREATE POLICY wallet_authorization_events_owner_select
  ON public.wallet_authorization_events
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.wallet_authorizations a
      WHERE a.id = wallet_authorization_events.authorization_id
        AND a.rider_id = auth.uid()
    )
    OR auth.jwt() -> 'app_metadata' ->> 'role' = 'admin'
  );

CREATE POLICY settlement_records_admin_select
  ON public.settlement_records
  FOR SELECT
  USING (auth.jwt() -> 'app_metadata' ->> 'role' = 'admin');

CREATE POLICY provider_events_admin_select
  ON public.provider_events
  FOR SELECT
  USING (auth.jwt() -> 'app_metadata' ->> 'role' = 'admin');

CREATE POLICY reconciliation_runs_admin_select
  ON public.reconciliation_runs
  FOR SELECT
  USING (auth.jwt() -> 'app_metadata' ->> 'role' = 'admin');

CREATE POLICY financial_jobs_admin_select
  ON public.financial_jobs
  FOR SELECT
  USING (auth.jwt() -> 'app_metadata' ->> 'role' = 'admin');

CREATE POLICY financial_metrics_admin_select
  ON public.financial_metrics
  FOR SELECT
  USING (auth.jwt() -> 'app_metadata' ->> 'role' = 'admin');

CREATE POLICY provider_statement_imports_admin_select
  ON public.provider_statement_imports
  FOR SELECT
  USING (auth.jwt() -> 'app_metadata' ->> 'role' = 'admin');

CREATE POLICY provider_statement_lines_admin_select
  ON public.provider_statement_lines
  FOR SELECT
  USING (auth.jwt() -> 'app_metadata' ->> 'role' = 'admin');

CREATE POLICY refund_intents_admin_select
  ON public.refund_intents
  FOR SELECT
  USING (auth.jwt() -> 'app_metadata' ->> 'role' = 'admin');

CREATE POLICY chargeback_records_admin_select
  ON public.chargeback_records
  FOR SELECT
  USING (auth.jwt() -> 'app_metadata' ->> 'role' = 'admin');

CREATE POLICY financial_disputes_admin_select
  ON public.financial_disputes
  FOR SELECT
  USING (auth.jwt() -> 'app_metadata' ->> 'role' = 'admin');

CREATE POLICY financial_incidents_admin_select
  ON public.financial_incidents
  FOR SELECT
  USING (auth.jwt() -> 'app_metadata' ->> 'role' = 'admin');

CREATE POLICY financial_runbooks_admin_select
  ON public.financial_runbooks
  FOR SELECT
  USING (auth.jwt() -> 'app_metadata' ->> 'role' = 'admin');

CREATE POLICY provider_certifications_admin_select
  ON public.provider_certifications
  FOR SELECT
  USING (auth.jwt() -> 'app_metadata' ->> 'role' = 'admin');

CREATE POLICY provider_certification_checks_admin_select
  ON public.provider_certification_checks
  FOR SELECT
  USING (auth.jwt() -> 'app_metadata' ->> 'role' = 'admin');

CREATE POLICY recovery_drills_admin_select
  ON public.recovery_drills
  FOR SELECT
  USING (auth.jwt() -> 'app_metadata' ->> 'role' = 'admin');

CREATE POLICY recovery_drill_events_admin_select
  ON public.recovery_drill_events
  FOR SELECT
  USING (auth.jwt() -> 'app_metadata' ->> 'role' = 'admin');

CREATE POLICY recovery_scorecards_admin_select
  ON public.recovery_scorecards
  FOR SELECT
  USING (auth.jwt() -> 'app_metadata' ->> 'role' = 'admin');

CREATE POLICY finance_approval_requests_admin_select
  ON public.finance_approval_requests
  FOR SELECT
  USING (auth.jwt() -> 'app_metadata' ->> 'role' = 'admin');

CREATE POLICY finance_approval_events_admin_select
  ON public.finance_approval_events
  FOR SELECT
  USING (auth.jwt() -> 'app_metadata' ->> 'role' = 'admin');

CREATE POLICY launch_gates_admin_select
  ON public.launch_gates
  FOR SELECT
  USING (auth.jwt() -> 'app_metadata' ->> 'role' = 'admin');

CREATE POLICY finance_close_runs_admin_select
  ON public.finance_close_runs
  FOR SELECT
  USING (auth.jwt() -> 'app_metadata' ->> 'role' = 'admin');

CREATE POLICY finance_signoffs_admin_select
  ON public.finance_signoffs
  FOR SELECT
  USING (auth.jwt() -> 'app_metadata' ->> 'role' = 'admin');

CREATE POLICY launch_readiness_scorecards_admin_select
  ON public.launch_readiness_scorecards
  FOR SELECT
  USING (auth.jwt() -> 'app_metadata' ->> 'role' = 'admin');

CREATE POLICY release_readiness_evidence_admin_select
  ON public.release_readiness_evidence
  FOR SELECT
  USING (auth.jwt() -> 'app_metadata' ->> 'role' = 'admin');

CREATE POLICY launch_gate_drills_admin_select
  ON public.launch_gate_drills
  FOR SELECT
  USING (auth.jwt() -> 'app_metadata' ->> 'role' = 'admin');

CREATE POLICY final_readiness_scorecards_admin_select
  ON public.final_readiness_scorecards
  FOR SELECT
  USING (auth.jwt() -> 'app_metadata' ->> 'role' = 'admin');

CREATE POLICY executive_signoff_packets_admin_select
  ON public.executive_signoff_packets
  FOR SELECT
  USING (auth.jwt() -> 'app_metadata' ->> 'role' = 'admin');

CREATE POLICY executive_approval_records_admin_select
  ON public.executive_approval_records
  FOR SELECT
  USING (auth.jwt() -> 'app_metadata' ->> 'role' = 'admin');

CREATE POLICY launch_blockers_admin_select
  ON public.launch_blockers
  FOR SELECT
  USING (auth.jwt() -> 'app_metadata' ->> 'role' = 'admin');

CREATE POLICY internal_launch_decisions_admin_select
  ON public.internal_launch_decisions
  FOR SELECT
  USING (auth.jwt() -> 'app_metadata' ->> 'role' = 'admin');

CREATE POLICY live_drill_evidence_admin_select
  ON public.live_drill_evidence
  FOR SELECT
  USING (auth.jwt() -> 'app_metadata' ->> 'role' = 'admin');

CREATE POLICY drill_evidence_reviews_admin_select
  ON public.drill_evidence_reviews
  FOR SELECT
  USING (auth.jwt() -> 'app_metadata' ->> 'role' = 'admin');

CREATE POLICY production_exceptions_admin_select
  ON public.production_exceptions
  FOR SELECT
  USING (auth.jwt() -> 'app_metadata' ->> 'role' = 'admin');

CREATE POLICY reliability_scorecards_admin_select
  ON public.reliability_scorecards
  FOR SELECT
  USING (auth.jwt() -> 'app_metadata' ->> 'role' = 'admin');

CREATE POLICY control_room_snapshots_admin_select
  ON public.control_room_snapshots
  FOR SELECT
  USING (auth.jwt() -> 'app_metadata' ->> 'role' = 'admin');

CREATE POLICY daily_finance_closes_admin_select
  ON public.daily_finance_closes
  FOR SELECT
  USING (auth.jwt() -> 'app_metadata' ->> 'role' = 'admin');

CREATE POLICY daily_close_reviews_admin_select
  ON public.daily_close_reviews
  FOR SELECT
  USING (auth.jwt() -> 'app_metadata' ->> 'role' = 'admin');

CREATE POLICY daily_reliability_metrics_admin_select
  ON public.daily_reliability_metrics
  FOR SELECT
  USING (auth.jwt() -> 'app_metadata' ->> 'role' = 'admin');

CREATE POLICY pilot_monitoring_snapshots_admin_select
  ON public.pilot_monitoring_snapshots
  FOR SELECT
  USING (auth.jwt() -> 'app_metadata' ->> 'role' = 'admin');

CREATE POLICY internal_pilot_runbooks_admin_select
  ON public.internal_pilot_runbooks
  FOR SELECT
  USING (auth.jwt() -> 'app_metadata' ->> 'role' = 'admin');

CREATE POLICY day1_close_simulations_admin_select
  ON public.day1_close_simulations
  FOR SELECT
  USING (auth.jwt() -> 'app_metadata' ->> 'role' = 'admin');

CREATE POLICY incident_escalations_admin_select
  ON public.incident_escalations
  FOR SELECT
  USING (auth.jwt() -> 'app_metadata' ->> 'role' = 'admin');

CREATE POLICY pilot_operations_timeline_admin_select
  ON public.pilot_operations_timeline
  FOR SELECT
  USING (auth.jwt() -> 'app_metadata' ->> 'role' = 'admin');

CREATE POLICY internal_pilot_success_criteria_admin_select
  ON public.internal_pilot_success_criteria
  FOR SELECT
  USING (auth.jwt() -> 'app_metadata' ->> 'role' = 'admin');

CREATE POLICY pilot_authorizations_admin_select
  ON public.pilot_authorizations
  FOR SELECT
  USING (auth.jwt() -> 'app_metadata' ->> 'role' = 'admin');

CREATE POLICY pilot_scope_definitions_admin_select
  ON public.pilot_scope_definitions
  FOR SELECT
  USING (auth.jwt() -> 'app_metadata' ->> 'role' = 'admin');

CREATE POLICY pilot_success_definitions_admin_select
  ON public.pilot_success_definitions
  FOR SELECT
  USING (auth.jwt() -> 'app_metadata' ->> 'role' = 'admin');

CREATE POLICY internal_pilot_authorization_executions_admin_select
  ON public.internal_pilot_authorization_executions
  FOR SELECT
  USING (auth.jwt() -> 'app_metadata' ->> 'role' = 'admin');

CREATE POLICY internal_pilot_authorization_audits_admin_select
  ON public.internal_pilot_authorization_audits
  FOR SELECT
  USING (auth.jwt() -> 'app_metadata' ->> 'role' = 'admin');

CREATE POLICY internal_pilot_participants_admin_select
  ON public.internal_pilot_participants
  FOR SELECT
  USING (auth.jwt() -> 'app_metadata' ->> 'role' = 'admin');

CREATE POLICY internal_pilot_participant_events_admin_select
  ON public.internal_pilot_participant_events
  FOR SELECT
  USING (auth.jwt() -> 'app_metadata' ->> 'role' = 'admin');

CREATE POLICY internal_pilot_health_reports_admin_select
  ON public.internal_pilot_health_reports
  FOR SELECT
  USING (auth.jwt() -> 'app_metadata' ->> 'role' = 'admin');

CREATE POLICY internal_pilot_incidents_admin_select
  ON public.internal_pilot_incidents
  FOR SELECT
  USING (auth.jwt() -> 'app_metadata' ->> 'role' = 'admin');

CREATE POLICY internal_pilot_kill_switches_admin_select
  ON public.internal_pilot_kill_switches
  FOR SELECT
  USING (auth.jwt() -> 'app_metadata' ->> 'role' = 'admin');

CREATE POLICY internal_pilot_kill_switch_events_admin_select
  ON public.internal_pilot_kill_switch_events
  FOR SELECT
  USING (auth.jwt() -> 'app_metadata' ->> 'role' = 'admin');

CREATE POLICY internal_pilot_execution_events_admin_select
  ON public.internal_pilot_execution_events
  FOR SELECT
  USING (auth.jwt() -> 'app_metadata' ->> 'role' = 'admin');

CREATE POLICY internal_pilot_evidence_packages_admin_select
  ON public.internal_pilot_evidence_packages
  FOR SELECT
  USING (auth.jwt() -> 'app_metadata' ->> 'role' = 'admin');

CREATE POLICY internal_pilot_objective_results_admin_select
  ON public.internal_pilot_objective_results
  FOR SELECT
  USING (auth.jwt() -> 'app_metadata' ->> 'role' = 'admin');

CREATE POLICY internal_pilot_board_reviews_admin_select
  ON public.internal_pilot_board_reviews
  FOR SELECT
  USING (auth.jwt() -> 'app_metadata' ->> 'role' = 'admin');

CREATE POLICY internal_pilot_review_findings_admin_select
  ON public.internal_pilot_review_findings
  FOR SELECT
  USING (auth.jwt() -> 'app_metadata' ->> 'role' = 'admin');

CREATE POLICY internal_pilot_readiness_assessments_admin_select
  ON public.internal_pilot_readiness_assessments
  FOR SELECT
  USING (auth.jwt() -> 'app_metadata' ->> 'role' = 'admin');

CREATE POLICY wallet_pilot_programs_admin_select
  ON public.wallet_pilot_programs
  FOR SELECT
  USING (auth.jwt() -> 'app_metadata' ->> 'role' = 'admin');

CREATE POLICY wallet_pilot_participants_admin_select
  ON public.wallet_pilot_participants
  FOR SELECT
  USING (auth.jwt() -> 'app_metadata' ->> 'role' = 'admin');

CREATE POLICY wallet_pilot_transactions_admin_select
  ON public.wallet_pilot_transactions
  FOR SELECT
  USING (auth.jwt() -> 'app_metadata' ->> 'role' = 'admin');

CREATE POLICY wallet_pilot_reconciliation_reports_admin_select
  ON public.wallet_pilot_reconciliation_reports
  FOR SELECT
  USING (auth.jwt() -> 'app_metadata' ->> 'role' = 'admin');

CREATE POLICY wallet_pilot_fraud_events_admin_select
  ON public.wallet_pilot_fraud_events
  FOR SELECT
  USING (auth.jwt() -> 'app_metadata' ->> 'role' = 'admin');

CREATE POLICY wallet_pilot_kill_switches_admin_select
  ON public.wallet_pilot_kill_switches
  FOR SELECT
  USING (auth.jwt() -> 'app_metadata' ->> 'role' = 'admin');

CREATE POLICY pilot_wallet_groups_admin_select
  ON public.pilot_wallet_groups
  FOR SELECT
  USING (auth.jwt() -> 'app_metadata' ->> 'role' = 'admin');

CREATE POLICY pilot_wallet_users_admin_select
  ON public.pilot_wallet_users
  FOR SELECT
  USING (auth.jwt() -> 'app_metadata' ->> 'role' = 'admin');

CREATE POLICY pilot_wallet_user_events_admin_select
  ON public.pilot_wallet_user_events
  FOR SELECT
  USING (auth.jwt() -> 'app_metadata' ->> 'role' = 'admin');
