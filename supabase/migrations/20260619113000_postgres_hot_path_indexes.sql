-- GO V2.5-C PostgreSQL hot-path indexes for ride, dispatch, wallet,
-- websocket authorization, risk, and notification pilot load paths.

CREATE INDEX IF NOT EXISTS idx_rides_rider_status_created
  ON public.rides (rider_id, ride_status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_rides_driver_ride_status
  ON public.rides (driver_id, ride_status, id);

CREATE INDEX IF NOT EXISTS idx_rides_requested_created
  ON public.rides (created_at DESC)
  WHERE ride_status = 'requested';

CREATE INDEX IF NOT EXISTS idx_ride_offers_ride_pending_expires_created
  ON public.ride_offers (ride_id, expires_at, created_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_ride_offers_id_pending_expires
  ON public.ride_offers (id, expires_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_ride_offers_driver_ride
  ON public.ride_offers (driver_id, ride_id);

CREATE INDEX IF NOT EXISTS idx_dispatch_shadow_runs_ride_created
  ON public.dispatch_shadow_runs (ride_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_dispatch_shadow_candidates_run_driver
  ON public.dispatch_shadow_candidates (shadow_run_id, driver_id);

CREATE INDEX IF NOT EXISTS idx_driver_sessions_driver_updated
  ON public.driver_sessions (driver_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_payment_intents_scoped_idempotency
  ON public.payment_intents (user_id, provider, operation, idempotency_key);

CREATE INDEX IF NOT EXISTS idx_payment_intents_provider_reference
  ON public.payment_intents (provider, provider_reference)
  WHERE provider_reference IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_payment_intents_idempotency
  ON public.payment_intents (idempotency_key);

CREATE INDEX IF NOT EXISTS idx_wallet_accounts_owner_type_currency
  ON public.wallet_accounts (owner_user_id, account_type, currency);

CREATE INDEX IF NOT EXISTS idx_wallet_authorizations_ride
  ON public.wallet_authorizations (ride_id);

CREATE INDEX IF NOT EXISTS idx_wallet_transactions_owner_created
  ON public.wallet_transactions (owner_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_wallet_ledger_entries_transaction
  ON public.wallet_ledger_entries (transaction_id);

CREATE INDEX IF NOT EXISTS idx_notification_devices_active_user_seen
  ON public.notification_devices (user_id, last_seen DESC)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_notification_history_failed_created
  ON public.notification_history (created_at DESC)
  WHERE status = 'failed';

CREATE INDEX IF NOT EXISTS idx_risk_scores_score_updated
  ON public.risk_scores (risk_score DESC, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_risk_events_area_only
  ON public.risk_events (area);
