package wallet

import (
	"context"
	"encoding/json"
	"strconv"

	"github.com/gofiber/fiber/v2"

	"pickme-backend/internal/middleware"
)

type ReportReader interface {
	ShadowSettlementSummary(ctx context.Context, days int) (json.RawMessage, error)
	RecentShadowSettlements(ctx context.Context, limit int) ([]json.RawMessage, error)
	FailedShadowSettlements(ctx context.Context, limit int) ([]json.RawMessage, error)
	ActiveSettlementSummary(ctx context.Context, days int) (json.RawMessage, error)
	DriverLiabilities(ctx context.Context, limit int) ([]json.RawMessage, error)
	FailedActiveSettlements(ctx context.Context, limit int) ([]json.RawMessage, error)
}

func (r *PostgresReports) WalletState(ctx context.Context, userID string) ([]map[string]any, error) {
	// Reads from public.wallets (single row per user). Column names match
	// the normalizers in src/lib/walletApi.ts, so no client change is needed.
	rows, err := queryJSONRows(ctx, r.db, `
		SELECT json_build_object(
			'id', id,
			'user_id', user_id,
			'balance', balance,
			'currency', 'USD',
			'is_locked', is_locked,
			'locked_reason', locked_reason,
			'locked_at', locked_at,
			'created_at', created_at,
			'updated_at', updated_at
		)
		FROM public.wallets
		WHERE user_id = $1
	`, userID)
	return rawRowsToMaps(rows, err)
}

func (r *PostgresReports) WalletTransactions(ctx context.Context, userID string, limit int) ([]map[string]any, error) {
	rows, err := queryJSONRows(ctx, r.db, `
		SELECT json_build_object(
			'id', id,
			'transaction_type', transaction_type,
			'status', status,
			'currency', currency,
			'total_amount', total_amount,
			'source_type', source_type,
			'source_id', source_id,
			'payment_provider', payment_provider,
			'created_at', created_at
		)
		FROM public.wallet_transactions
		WHERE owner_user_id = $1 OR created_by = $1
		ORDER BY created_at DESC
		LIMIT $2
	`, userID, limit)
	return rawRowsToMaps(rows, err)
}

func (r *PostgresReports) WalletDeposits(ctx context.Context, userID string, limit int) ([]map[string]any, error) {
	// Reads from public.deposit_requests. driver_id here is the auth user id,
	// matching the RLS policy and the handler's userID argument. Column names
	// match the normalizers in src/lib/walletApi.ts, so no client change is needed.
	rows, err := queryJSONRows(ctx, r.db, `
		SELECT json_build_object(
			'id', id,
			'driver_id', driver_id,
			'amount_usd', amount_usd,
			'currency', 'USD',
			'ecocash_phone', ecocash_phone,
			'ecocash_reference', ecocash_reference,
			'proof_path', proof_path,
			'status', status,
			'admin_note', admin_note,
			'approved_at', approved_at,
			'created_at', created_at
		)
		FROM public.deposit_requests
		WHERE driver_id = $1
		ORDER BY created_at DESC
		LIMIT $2
	`, userID, limit)
	return rawRowsToMaps(rows, err)
}

func (r *PostgresReports) RideSettlement(ctx context.Context, rideID string, userID string) (map[string]any, error) {
	raw, err := queryJSON(ctx, r.db, `
		SELECT json_build_object(
			'id', s.id,
			'ride_id', s.ride_id,
			'driver_id', s.driver_id,
			'rider_id', s.rider_id,
			'fare', s.fare,
			'platform_fee', s.platform_fee,
			'driver_earning', s.driver_earning,
			'payment_method', s.payment_method,
			'settlement_mode', s.settlement_mode,
			'status', s.status,
			'wallet_transaction_id', s.wallet_transaction_id,
			'reference', s.idempotency_key,
			'created_at', s.created_at,
			'updated_at', s.updated_at
		)
		FROM public.settlement_records s
		WHERE s.ride_id = $1
		  AND (s.rider_id = $2 OR s.driver_id = $2)
		ORDER BY s.created_at DESC
		LIMIT 1
	`, rideID, userID)
	if err != nil {
		return nil, err
	}
	return rawToMap(raw)
}

func (r *PostgresReports) DepositDetail(ctx context.Context, userID string, id string) (map[string]any, error) {
	raw, err := queryJSON(ctx, r.db, `
		SELECT json_build_object(
			'id', id,
			'user_id', user_id,
			'amount', amount,
			'currency', currency,
			'payment_method', payment_method,
			'wallet_account_type', wallet_account_type,
			'status', status,
			'rejection_reason', rejection_reason,
			'wallet_transaction_id', wallet_transaction_id,
			'created_at', created_at,
			'updated_at', updated_at
		)
		FROM public.payment_intents
		WHERE id = $1
		  AND user_id = $2
	`, id, userID)
	if err != nil {
		return nil, err
	}
	return rawToMap(raw)
}

func (r *PostgresReports) WithdrawalDetail(ctx context.Context, driverID string, id string) (map[string]any, error) {
	raw, err := queryJSON(ctx, r.db, `
		SELECT json_build_object(
			'id', id,
			'driver_id', driver_id,
			'amount', amount,
			'currency', currency,
			'provider', provider,
			'destination_reference', destination_reference,
			'status', status,
			'rejection_reason', rejection_reason,
			'wallet_transaction_id', wallet_transaction_id,
			'requested_at', requested_at,
			'updated_at', updated_at
		)
		FROM public.withdrawal_requests
		WHERE id = $1
		  AND driver_id = $2
	`, id, driverID)
	if err != nil {
		return nil, err
	}
	return rawToMap(raw)
}

func (r *PostgresReports) PendingDeposits(ctx context.Context, limit int) ([]map[string]any, error) {
	rows, err := queryJSONRows(ctx, r.db, `
		SELECT json_build_object(
			'id', id,
			'user_id', user_id,
			'amount', amount,
			'currency', currency,
			'payment_method', payment_method,
			'wallet_account_type', wallet_account_type,
			'status', status,
			'created_at', created_at
		)
		FROM public.payment_intents
		WHERE status = 'pending_admin_approval'
		ORDER BY created_at DESC
		LIMIT $1
	`, limit)
	return rawRowsToMaps(rows, err)
}

func (r *PostgresReports) PendingWithdrawals(ctx context.Context, limit int) ([]map[string]any, error) {
	rows, err := queryJSONRows(ctx, r.db, `
		SELECT json_build_object(
			'id', id,
			'driver_id', driver_id,
			'amount', amount,
			'currency', currency,
			'provider', provider,
			'destination_reference', destination_reference,
			'status', status,
			'requested_at', requested_at
		)
		FROM public.withdrawal_requests
		WHERE status = 'pending_approval'
		ORDER BY requested_at DESC
		LIMIT $1
	`, limit)
	return rawRowsToMaps(rows, err)
}

func (r *PostgresReports) AdminActions(ctx context.Context, limit int) ([]map[string]any, error) {
	rows, err := queryJSONRows(ctx, r.db, `
		SELECT json_build_object(
			'id', id,
			'admin_user_id', admin_user_id,
			'action', action,
			'target_type', target_type,
			'target_id', target_id,
			'reason', reason,
			'previous_status', previous_status,
			'new_status', new_status,
			'created_at', created_at
		)
		FROM public.wallet_admin_actions
		ORDER BY created_at DESC
		LIMIT $1
	`, limit)
	return rawRowsToMaps(rows, err)
}

func (r *PostgresReports) ReconciliationSummary(ctx context.Context) (map[string]any, error) {
	raw, err := r.reconciliationSummaryPayload(ctx)
	if err != nil {
		return nil, err
	}
	var result map[string]any
	if err := json.Unmarshal(raw, &result); err != nil {
		return nil, err
	}
	return result, nil
}

func (r *PostgresReports) reconciliationSummaryPayload(ctx context.Context) (json.RawMessage, error) {
	return queryJSON(ctx, r.db, `
		WITH account_projection AS (
			SELECT
				a.id,
				a.account_type,
				a.cached_available_balance,
				a.cached_pending_balance,
				a.cached_liability_balance,
				COALESCE(SUM(CASE WHEN e.entry_type = 'credit' THEN e.amount ELSE 0 END), 0) AS ledger_credits,
				COALESCE(SUM(CASE WHEN e.entry_type = 'debit' THEN e.amount ELSE 0 END), 0) AS ledger_debits,
				COALESCE(holds.open_hold_amount, 0) AS open_hold_amount
			FROM public.wallet_accounts a
			LEFT JOIN public.wallet_ledger_entries e ON e.account_id = a.id
			LEFT JOIN (
				SELECT wallet_account_id, SUM(amount - captured_amount - released_amount) AS open_hold_amount
				FROM public.wallet_authorizations
				WHERE status = 'authorized'
				GROUP BY wallet_account_id
			) holds ON holds.wallet_account_id = a.id
			GROUP BY a.id, holds.open_hold_amount
		),
		drift AS (
			SELECT *
			FROM account_projection
			WHERE ABS(cached_available_balance - ((ledger_credits - ledger_debits) - open_hold_amount)) > 0.009
			   OR ABS(cached_pending_balance - open_hold_amount) > 0.009
			   OR ABS(cached_liability_balance - CASE WHEN account_type = 'cash_liability_wallet' THEN (ledger_debits - ledger_credits) ELSE 0 END) > 0.009
		),
		orphaned_authorizations AS (
			SELECT a.id
			FROM public.wallet_authorizations a
			LEFT JOIN public.rides r ON r.id = a.ride_id
			WHERE a.status = 'authorized'
			  AND r.id IS NULL
		),
		settlement_mismatches AS (
			SELECT a.id
			FROM public.wallet_authorizations a
			LEFT JOIN public.settlement_records s ON s.ride_id = a.ride_id AND s.payment_method = 'wallet' AND s.settlement_mode = 'active'
			WHERE a.status = 'captured'
			  AND s.id IS NULL
			UNION ALL
			SELECT s.id
			FROM public.settlement_records s
			LEFT JOIN public.wallet_authorizations a ON a.ride_id = s.ride_id AND a.status = 'captured'
			WHERE s.payment_method = 'wallet'
			  AND s.settlement_mode = 'active'
			  AND s.status = 'settled'
			  AND a.id IS NULL
		),
		liability_mismatches AS (
			SELECT id
			FROM account_projection
			WHERE account_type = 'cash_liability_wallet'
			  AND ABS(cached_liability_balance - (ledger_debits - ledger_credits)) > 0.009
		)
		SELECT json_build_object(
			'checked_accounts', (SELECT COUNT(*) FROM account_projection),
			'balance_drift_count', (SELECT COUNT(*) FROM drift),
			'open_authorizations', (SELECT COUNT(*) FROM public.wallet_authorizations WHERE status = 'authorized'),
			'expired_authorizations', (SELECT COUNT(*) FROM public.wallet_authorizations WHERE status = 'authorized' AND expires_at <= NOW()),
			'orphaned_authorizations', (SELECT COUNT(*) FROM orphaned_authorizations),
			'settlement_mismatches', (SELECT COUNT(*) FROM settlement_mismatches),
			'liability_mismatches', (SELECT COUNT(*) FROM liability_mismatches),
			'failed_settlements', (SELECT COUNT(*) FROM public.settlement_records WHERE status = 'failed'),
			'reconciliation_runs_requiring_review', (SELECT COUNT(*) FROM public.reconciliation_runs WHERE status = 'requires_review'),
			'latest_reconciliation_run', (
				SELECT json_build_object('id', id, 'status', status, 'started_at', started_at, 'completed_at', completed_at, 'mismatch_count', mismatch_count)
				FROM public.reconciliation_runs
				WHERE run_type = 'ledger_balance'
				ORDER BY started_at DESC
				LIMIT 1
			)
		)
	`)
}

func (r *PostgresReports) ReconciliationDrift(ctx context.Context, limit int) ([]map[string]any, error) {
	rows, err := queryJSONRows(ctx, r.db, `
		WITH account_projection AS (
			SELECT
				a.id,
				a.owner_user_id,
				a.owner_role,
				a.account_type,
				a.currency,
				a.cached_available_balance,
				a.cached_pending_balance,
				a.cached_liability_balance,
				COALESCE(SUM(CASE WHEN e.entry_type = 'credit' THEN e.amount ELSE 0 END), 0) AS ledger_credits,
				COALESCE(SUM(CASE WHEN e.entry_type = 'debit' THEN e.amount ELSE 0 END), 0) AS ledger_debits,
				COALESCE(holds.open_hold_amount, 0) AS open_hold_amount
			FROM public.wallet_accounts a
			LEFT JOIN public.wallet_ledger_entries e ON e.account_id = a.id
			LEFT JOIN (
				SELECT wallet_account_id, SUM(amount - captured_amount - released_amount) AS open_hold_amount
				FROM public.wallet_authorizations
				WHERE status = 'authorized'
				GROUP BY wallet_account_id
			) holds ON holds.wallet_account_id = a.id
			GROUP BY a.id, holds.open_hold_amount
		),
		drift AS (
			SELECT
				*,
				((ledger_credits - ledger_debits) - open_hold_amount) AS expected_available_balance,
				open_hold_amount AS expected_pending_balance,
				CASE WHEN account_type = 'cash_liability_wallet' THEN (ledger_debits - ledger_credits) ELSE 0 END AS expected_liability_balance
			FROM account_projection
		)
		SELECT json_build_object(
			'account_id', id,
			'owner_user_id', owner_user_id,
			'owner_role', owner_role,
			'account_type', account_type,
			'currency', currency,
			'cached_available_balance', cached_available_balance,
			'expected_available_balance', expected_available_balance,
			'available_drift', cached_available_balance - expected_available_balance,
			'cached_pending_balance', cached_pending_balance,
			'expected_pending_balance', expected_pending_balance,
			'pending_drift', cached_pending_balance - expected_pending_balance,
			'cached_liability_balance', cached_liability_balance,
			'expected_liability_balance', expected_liability_balance,
			'liability_drift', cached_liability_balance - expected_liability_balance
		)
		FROM drift
		WHERE ABS(cached_available_balance - expected_available_balance) > 0.009
		   OR ABS(cached_pending_balance - expected_pending_balance) > 0.009
		   OR ABS(cached_liability_balance - expected_liability_balance) > 0.009
		ORDER BY GREATEST(
			ABS(cached_available_balance - expected_available_balance),
			ABS(cached_pending_balance - expected_pending_balance),
			ABS(cached_liability_balance - expected_liability_balance)
		) DESC
		LIMIT $1
	`, limit)
	return rawRowsToMaps(rows, err)
}

func (r *PostgresReports) OpenAuthorizations(ctx context.Context, limit int) ([]map[string]any, error) {
	rows, err := queryJSONRows(ctx, r.db, `
		SELECT json_build_object(
			'id', id,
			'ride_id', ride_id,
			'rider_id', rider_id,
			'wallet_account_id', wallet_account_id,
			'amount', amount,
			'remaining_amount', amount - captured_amount - released_amount,
			'currency', currency,
			'status', status,
			'expires_at', expires_at,
			'is_expired', expires_at <= NOW(),
			'created_at', created_at,
			'updated_at', updated_at
		)
		FROM public.wallet_authorizations
		WHERE status = 'authorized'
		ORDER BY expires_at ASC
		LIMIT $1
	`, limit)
	return rawRowsToMaps(rows, err)
}

func (r *PostgresReports) ExpiredAuthorizations(ctx context.Context, limit int) ([]map[string]any, error) {
	rows, err := queryJSONRows(ctx, r.db, `
		SELECT json_build_object(
			'id', id,
			'ride_id', ride_id,
			'rider_id', rider_id,
			'wallet_account_id', wallet_account_id,
			'amount', amount,
			'remaining_amount', amount - captured_amount - released_amount,
			'currency', currency,
			'status', status,
			'expires_at', expires_at,
			'created_at', created_at,
			'updated_at', updated_at
		)
		FROM public.wallet_authorizations
		WHERE status = 'authorized'
		  AND expires_at <= NOW()
		ORDER BY expires_at ASC
		LIMIT $1
	`, limit)
	return rawRowsToMaps(rows, err)
}

func (r *PostgresReports) FinancialHardeningSummary(ctx context.Context) (map[string]any, error) {
	raw, err := queryJSON(ctx, r.db, `
		SELECT json_build_object(
			'settlement_failures', (SELECT COALESCE(SUM(value), 0) FROM public.financial_metrics WHERE metric_type = 'settlement_failure'),
			'callback_failures', (SELECT COALESCE(SUM(value), 0) FROM public.financial_metrics WHERE metric_type = 'callback_failure'),
			'reconciliation_drift', (SELECT COALESCE(SUM(value), 0) FROM public.financial_metrics WHERE metric_type = 'reconciliation_drift'),
			'expired_authorizations', (SELECT COALESCE(SUM(value), 0) FROM public.financial_metrics WHERE metric_type = 'expired_authorization'),
			'failed_captures', (SELECT COALESCE(SUM(value), 0) FROM public.financial_metrics WHERE metric_type = 'failed_capture'),
			'failed_releases', (SELECT COALESCE(SUM(value), 0) FROM public.financial_metrics WHERE metric_type = 'failed_release'),
			'dead_letter_jobs', (SELECT COUNT(*) FROM public.financial_jobs WHERE status = 'dead_lettered'),
			'pending_jobs', (SELECT COUNT(*) FROM public.financial_jobs WHERE status = 'pending'),
			'processing_jobs', (SELECT COUNT(*) FROM public.financial_jobs WHERE status = 'processing'),
			'failed_jobs', (SELECT COUNT(*) FROM public.financial_jobs WHERE status = 'failed'),
			'stale_processing_jobs', (
				SELECT COUNT(*)
				FROM public.financial_jobs
				WHERE status = 'processing'
				  AND locked_until IS NOT NULL
				  AND locked_until <= NOW()
			)
		)
	`)
	if err != nil {
		return nil, err
	}
	return rawToMap(raw)
}

func (r *PostgresReports) FinancialRecoverySummary(ctx context.Context) (map[string]any, error) {
	raw, err := queryJSON(ctx, r.db, `
		SELECT json_build_object(
			'open_refunds', (SELECT COUNT(*) FROM public.refund_intents WHERE status IN ('pending_review', 'approved', 'processing', 'failed')),
			'open_chargebacks', (SELECT COUNT(*) FROM public.chargeback_records WHERE status IN ('received', 'under_review', 'accepted', 'represented', 'lost')),
			'open_disputes', (SELECT COUNT(*) FROM public.financial_disputes WHERE status NOT IN ('closed', 'cancelled', 'resolved_refund', 'resolved_no_change', 'resolved_adjustment')),
			'open_incidents', (SELECT COUNT(*) FROM public.financial_incidents WHERE status NOT IN ('resolved', 'closed')),
			'statement_mismatches', (SELECT COUNT(*) FROM public.provider_statement_lines WHERE match_status <> 'matched'),
			'dead_letter_jobs', (SELECT COUNT(*) FROM public.financial_jobs WHERE status = 'dead_lettered'),
			'active_runbooks', (SELECT COUNT(*) FROM public.financial_runbooks WHERE status = 'active')
		)
	`)
	if err != nil {
		return nil, err
	}
	return rawToMap(raw)
}

func (r *PostgresReports) RefundIntents(ctx context.Context, limit int) ([]map[string]any, error) {
	return r.simpleFinanceRows(ctx, `
		SELECT json_build_object(
			'id', id,
			'provider', provider,
			'user_id', user_id,
			'amount', amount,
			'amount_minor', amount_minor,
			'currency', currency,
			'status', status,
			'reason', reason,
			'original_payment_intent_id', original_payment_intent_id,
			'original_wallet_transaction_id', original_wallet_transaction_id,
			'wallet_transaction_id', wallet_transaction_id,
			'failure_reason', failure_reason,
			'created_at', created_at,
			'updated_at', updated_at
		)
		FROM public.refund_intents
		ORDER BY updated_at DESC
		LIMIT $1
	`, limit)
}

func (r *PostgresReports) Chargebacks(ctx context.Context, limit int) ([]map[string]any, error) {
	return r.simpleFinanceRows(ctx, `
		SELECT json_build_object(
			'id', id,
			'provider', provider,
			'provider_reference', provider_reference,
			'provider_chargeback_id', provider_chargeback_id,
			'amount', amount,
			'amount_minor', amount_minor,
			'currency', currency,
			'status', status,
			'reason', reason,
			'opened_at', opened_at,
			'resolved_at', resolved_at,
			'updated_at', updated_at
		)
		FROM public.chargeback_records
		ORDER BY updated_at DESC
		LIMIT $1
	`, limit)
}

func (r *PostgresReports) FinancialDisputes(ctx context.Context, limit int) ([]map[string]any, error) {
	return r.simpleFinanceRows(ctx, `
		SELECT json_build_object(
			'id', id,
			'dispute_type', dispute_type,
			'status', status,
			'provider', provider,
			'ride_id', ride_id,
			'user_id', user_id,
			'payment_intent_id', payment_intent_id,
			'wallet_transaction_id', wallet_transaction_id,
			'amount', amount,
			'amount_minor', amount_minor,
			'currency', currency,
			'reason', reason,
			'resolution', resolution,
			'assigned_to', assigned_to,
			'created_at', created_at,
			'updated_at', updated_at,
			'resolved_at', resolved_at
		)
		FROM public.financial_disputes
		ORDER BY updated_at DESC
		LIMIT $1
	`, limit)
}

func (r *PostgresReports) FinancialIncidents(ctx context.Context, limit int) ([]map[string]any, error) {
	return r.simpleFinanceRows(ctx, `
		SELECT json_build_object(
			'id', id,
			'severity', severity,
			'status', status,
			'incident_type', incident_type,
			'provider', provider,
			'source_type', source_type,
			'source_id', source_id,
			'title', title,
			'description', description,
			'created_at', created_at,
			'updated_at', updated_at,
			'resolved_at', resolved_at
		)
		FROM public.financial_incidents
		ORDER BY updated_at DESC
		LIMIT $1
	`, limit)
}

func (r *PostgresReports) ProviderStatementImports(ctx context.Context, limit int) ([]map[string]any, error) {
	return r.simpleFinanceRows(ctx, `
		SELECT json_build_object(
			'id', id,
			'provider', provider,
			'statement_reference', statement_reference,
			'status', status,
			'total_line_count', total_line_count,
			'matched_count', matched_count,
			'mismatch_count', mismatch_count,
			'unmatched_count', unmatched_count,
			'failure_reason', failure_reason,
			'created_at', created_at,
			'completed_at', completed_at
		)
		FROM public.provider_statement_imports
		ORDER BY created_at DESC
		LIMIT $1
	`, limit)
}

func (r *PostgresReports) ProviderStatementLines(ctx context.Context, limit int) ([]map[string]any, error) {
	return r.simpleFinanceRows(ctx, `
		SELECT json_build_object(
			'id', id,
			'import_id', import_id,
			'provider', provider,
			'line_reference', line_reference,
			'provider_reference', provider_reference,
			'provider_event_id', provider_event_id,
			'line_type', line_type,
			'amount', amount,
			'amount_minor', amount_minor,
			'currency', currency,
			'status', status,
			'match_status', match_status,
			'matched_payment_intent_id', matched_payment_intent_id,
			'matched_wallet_transaction_id', matched_wallet_transaction_id,
			'mismatch_reason', mismatch_reason,
			'created_at', created_at
		)
		FROM public.provider_statement_lines
		ORDER BY created_at DESC
		LIMIT $1
	`, limit)
}

func (r *PostgresReports) FinancialRunbooks(ctx context.Context, limit int) ([]map[string]any, error) {
	return r.simpleFinanceRows(ctx, `
		WITH runbooks AS (
			SELECT
				created_at,
				json_build_object(
			'id', id,
			'runbook_key', runbook_key,
			'title', title,
			'category', category,
			'status', status,
			'version', version,
			'created_at', created_at,
			'updated_at', updated_at
				) AS payload
			FROM public.financial_runbooks
			UNION ALL
			SELECT
				created_at,
				json_build_object(
					'id', id,
					'runbook_key', runbook_type,
					'title', title,
					'category', 'internal_pilot',
					'status', status,
					'version', 1,
					'owner_id', owner_id,
					'created_at', created_at,
					'updated_at', updated_at
				) AS payload
			FROM public.internal_pilot_runbooks
		)
		SELECT payload
		FROM runbooks
		ORDER BY created_at DESC
		LIMIT $1
	`, limit)
}

func (r *PostgresReports) FinancialReliabilitySummary(ctx context.Context) (map[string]any, error) {
	raw, err := queryJSON(ctx, r.db, `
		SELECT json_build_object(
			'provider_certifications_running', (SELECT COUNT(*) FROM public.provider_certifications WHERE status = 'running'),
			'provider_certifications_passed', (SELECT COUNT(*) FROM public.provider_certifications WHERE status = 'passed'),
			'provider_certifications_failed', (SELECT COUNT(*) FROM public.provider_certifications WHERE status = 'failed'),
			'certification_checks_failed', (SELECT COUNT(*) FROM public.provider_certification_checks WHERE status = 'failed'),
			'recovery_drills_running', (SELECT COUNT(*) FROM public.recovery_drills WHERE status = 'running'),
			'recovery_drills_passed', (SELECT COUNT(*) FROM public.recovery_drills WHERE status = 'passed'),
			'recovery_drills_failed', (SELECT COUNT(*) FROM public.recovery_drills WHERE status = 'failed'),
			'latest_recovery_score', (SELECT score FROM public.recovery_scorecards ORDER BY period_end DESC, created_at DESC LIMIT 1),
			'dead_letter_jobs', (SELECT COUNT(*) FROM public.financial_jobs WHERE status = 'dead_lettered'),
			'callback_failures', (SELECT COALESCE(SUM(value), 0) FROM public.financial_metrics WHERE metric_type = 'callback_failure'),
			'certification_failures', (SELECT COALESCE(SUM(value), 0) FROM public.financial_metrics WHERE metric_type = 'certification_failure'),
			'recovery_drill_failures', (SELECT COALESCE(SUM(value), 0) FROM public.financial_metrics WHERE metric_type = 'recovery_drill_failure')
		)
	`)
	if err != nil {
		return nil, err
	}
	return rawToMap(raw)
}

func (r *PostgresReports) ProviderCertifications(ctx context.Context, limit int) ([]map[string]any, error) {
	return r.simpleFinanceRows(ctx, `
		SELECT json_build_object(
			'id', id,
			'provider', provider,
			'certification_type', certification_type,
			'status', status,
			'score', score,
			'certified_by', certified_by,
			'certified_at', certified_at,
			'expires_at', expires_at,
			'created_at', created_at,
			'updated_at', updated_at
		)
		FROM public.provider_certifications
		ORDER BY updated_at DESC
		LIMIT $1
	`, limit)
}

func (r *PostgresReports) ProviderCertificationChecks(ctx context.Context, limit int) ([]map[string]any, error) {
	return r.simpleFinanceRows(ctx, `
		SELECT json_build_object(
			'id', id,
			'certification_id', certification_id,
			'provider', provider,
			'check_type', check_type,
			'status', status,
			'evidence', evidence,
			'failure_reason', failure_reason,
			'performed_at', performed_at,
			'created_at', created_at,
			'updated_at', updated_at
		)
		FROM public.provider_certification_checks
		ORDER BY updated_at DESC
		LIMIT $1
	`, limit)
}

func (r *PostgresReports) RecoveryDrills(ctx context.Context, limit int) ([]map[string]any, error) {
	return r.simpleFinanceRows(ctx, `
		SELECT json_build_object(
			'id', id,
			'drill_type', drill_type,
			'provider', provider,
			'status', status,
			'score', score,
			'triggered_by', triggered_by,
			'failure_reason', failure_reason,
			'started_at', started_at,
			'completed_at', completed_at,
			'created_at', created_at,
			'updated_at', updated_at
		)
		FROM public.recovery_drills
		ORDER BY updated_at DESC
		LIMIT $1
	`, limit)
}

func (r *PostgresReports) RecoveryDrillEvents(ctx context.Context, limit int) ([]map[string]any, error) {
	return r.simpleFinanceRows(ctx, `
		SELECT json_build_object(
			'id', id,
			'drill_id', drill_id,
			'event_type', event_type,
			'status', status,
			'message', message,
			'created_at', created_at
		)
		FROM public.recovery_drill_events
		ORDER BY created_at DESC
		LIMIT $1
	`, limit)
}

func (r *PostgresReports) RecoveryScorecards(ctx context.Context, limit int) ([]map[string]any, error) {
	return r.simpleFinanceRows(ctx, `
		SELECT json_build_object(
			'id', id,
			'provider', provider,
			'score_type', score_type,
			'score', score,
			'status', status,
			'period_start', period_start,
			'period_end', period_end,
			'created_at', created_at
		)
		FROM public.recovery_scorecards
		ORDER BY period_end DESC, created_at DESC
		LIMIT $1
	`, limit)
}

func (r *PostgresReports) FinanceGovernanceSummary(ctx context.Context) (map[string]any, error) {
	raw, err := queryJSON(ctx, r.db, `
		SELECT json_build_object(
			'pending_dual_approvals', (SELECT COUNT(*) FROM public.finance_approval_requests WHERE status = 'pending'),
			'approved_dual_approvals', (SELECT COUNT(*) FROM public.finance_approval_requests WHERE status = 'approved'),
			'rejected_dual_approvals', (SELECT COUNT(*) FROM public.finance_approval_requests WHERE status = 'rejected'),
			'blocked_launch_gates', (SELECT COUNT(*) FROM public.launch_gates WHERE status = 'blocked'),
			'approved_launch_gates', (SELECT COUNT(*) FROM public.launch_gates WHERE status = 'approved'),
			'open_finance_closes', (SELECT COUNT(*) FROM public.finance_close_runs WHERE status <> 'signed_off'),
			'signed_finance_closes', (SELECT COUNT(*) FROM public.finance_close_runs WHERE status = 'signed_off'),
			'pending_signoffs', (SELECT COUNT(*) FROM public.finance_signoffs WHERE status = 'pending'),
			'latest_launch_readiness_score', (SELECT score FROM public.launch_readiness_scorecards ORDER BY created_at DESC LIMIT 1),
			'latest_launch_readiness_status', (SELECT status FROM public.launch_readiness_scorecards ORDER BY created_at DESC LIMIT 1)
		)
	`)
	if err != nil {
		return nil, err
	}
	return rawToMap(raw)
}

func (r *PostgresReports) FinanceApprovalRequests(ctx context.Context, limit int) ([]map[string]any, error) {
	return r.simpleFinanceRows(ctx, `
		SELECT json_build_object(
			'id', id,
			'approval_type', approval_type,
			'status', status,
			'target_type', target_type,
			'target_id', target_id,
			'requested_by', requested_by,
			'required_approval_count', required_approval_count,
			'approvals_count', approvals_count,
			'rejection_reason', rejection_reason,
			'created_at', created_at,
			'updated_at', updated_at,
			'completed_at', completed_at
		)
		FROM public.finance_approval_requests
		ORDER BY updated_at DESC
		LIMIT $1
	`, limit)
}

func (r *PostgresReports) LaunchGates(ctx context.Context, limit int) ([]map[string]any, error) {
	return r.simpleFinanceRows(ctx, `
		SELECT json_build_object(
			'id', id,
			'gate_key', gate_key,
			'gate_type', gate_type,
			'provider', provider,
			'status', status,
			'readiness_score', readiness_score,
			'finance_approval_request_id', finance_approval_request_id,
			'cto_approval_request_id', cto_approval_request_id,
			'created_at', created_at,
			'updated_at', updated_at
		)
		FROM public.launch_gates
		ORDER BY updated_at DESC
		LIMIT $1
	`, limit)
}

func (r *PostgresReports) FinanceCloseRuns(ctx context.Context, limit int) ([]map[string]any, error) {
	return r.simpleFinanceRows(ctx, `
		SELECT json_build_object(
			'id', id,
			'close_type', close_type,
			'status', status,
			'period_start', period_start,
			'period_end', period_end,
			'opened_by', opened_by,
			'signed_off_by', signed_off_by,
			'mismatch_count', mismatch_count,
			'created_at', created_at,
			'updated_at', updated_at,
			'completed_at', completed_at
		)
		FROM public.finance_close_runs
		ORDER BY period_end DESC, updated_at DESC
		LIMIT $1
	`, limit)
}

func (r *PostgresReports) FinanceSignoffs(ctx context.Context, limit int) ([]map[string]any, error) {
	return r.simpleFinanceRows(ctx, `
		SELECT json_build_object(
			'id', id,
			'signoff_type', signoff_type,
			'target_type', target_type,
			'target_id', target_id,
			'status', status,
			'signer_id', signer_id,
			'reason', reason,
			'signed_at', signed_at,
			'created_at', created_at
		)
		FROM public.finance_signoffs
		ORDER BY created_at DESC
		LIMIT $1
	`, limit)
}

func (r *PostgresReports) LaunchReadinessScorecards(ctx context.Context, limit int) ([]map[string]any, error) {
	return r.simpleFinanceRows(ctx, `
		SELECT json_build_object(
			'id', id,
			'score', score,
			'status', status,
			'public_payments_ready', public_payments_ready,
			'provider_activation_ready', provider_activation_ready,
			'finance_close_ready', finance_close_ready,
			'dual_approval_ready', dual_approval_ready,
			'recovery_drills_ready', recovery_drills_ready,
			'created_by', created_by,
			'created_at', created_at
		)
		FROM public.launch_readiness_scorecards
		ORDER BY created_at DESC
		LIMIT $1
	`, limit)
}

func (r *PostgresReports) ReleaseReadinessSummary(ctx context.Context) (map[string]any, error) {
	raw, err := queryJSON(ctx, r.db, `
		SELECT json_build_object(
			'evidence_present', (SELECT COUNT(*) FROM public.release_readiness_evidence WHERE status = 'present'),
			'evidence_missing', (SELECT COUNT(*) FROM public.release_readiness_evidence WHERE status = 'missing'),
			'evidence_warnings', (SELECT COUNT(*) FROM public.release_readiness_evidence WHERE status = 'warning'),
			'launch_gate_drills_passed', (SELECT COUNT(*) FROM public.launch_gate_drills WHERE status = 'passed'),
			'launch_gate_drills_failed', (SELECT COUNT(*) FROM public.launch_gate_drills WHERE status = 'failed'),
			'provider_certifications_passed', (SELECT COUNT(*) FROM public.provider_certifications WHERE status = 'passed'),
			'provider_certifications_failed', (SELECT COUNT(*) FROM public.provider_certifications WHERE status = 'failed'),
			'recovery_drills_passed', (SELECT COUNT(*) FROM public.recovery_drills WHERE status = 'passed'),
			'recovery_drills_failed', (SELECT COUNT(*) FROM public.recovery_drills WHERE status = 'failed'),
			'blocked_launch_gates', (SELECT COUNT(*) FROM public.launch_gates WHERE status = 'blocked'),
			'approved_launch_gates', (SELECT COUNT(*) FROM public.launch_gates WHERE status = 'approved'),
			'latest_overall_score', (SELECT overall_score FROM public.final_readiness_scorecards ORDER BY created_at DESC LIMIT 1),
			'latest_status', (SELECT status FROM public.final_readiness_scorecards ORDER BY created_at DESC LIMIT 1),
			'latest_launch_recommendation', (SELECT launch_recommendation FROM public.final_readiness_scorecards ORDER BY created_at DESC LIMIT 1),
			'public_launch_approved', false
		)
	`)
	if err != nil {
		return nil, err
	}
	return rawToMap(raw)
}

func (r *PostgresReports) ReleaseEvidence(ctx context.Context, limit int) ([]map[string]any, error) {
	return r.simpleFinanceRows(ctx, `
		SELECT json_build_object(
			'id', id,
			'category', category,
			'component', component,
			'status', status,
			'evidence_type', evidence_type,
			'evidence_ref', evidence_ref,
			'score_impact', score_impact,
			'collected_by', collected_by,
			'created_at', created_at
		)
		FROM public.release_readiness_evidence
		ORDER BY created_at DESC
		LIMIT $1
	`, limit)
}

func (r *PostgresReports) ReleaseScorecards(ctx context.Context, limit int) ([]map[string]any, error) {
	return r.simpleFinanceRows(ctx, `
		SELECT json_build_object(
			'id', id,
			'architecture_score', architecture_score,
			'reliability_score', reliability_score,
			'security_score', security_score,
			'finance_score', finance_score,
			'governance_score', governance_score,
			'operations_score', operations_score,
			'provider_readiness_score', provider_readiness_score,
			'launch_readiness_score', launch_readiness_score,
			'overall_score', overall_score,
			'status', status,
			'launch_recommendation', launch_recommendation,
			'blockers', blockers,
			'created_by', created_by,
			'created_at', created_at
		)
		FROM public.final_readiness_scorecards
		ORDER BY created_at DESC
		LIMIT $1
	`, limit)
}

func (r *PostgresReports) ExecutiveSignoffSummary(ctx context.Context) (map[string]any, error) {
	raw, err := queryJSON(ctx, r.db, `
		SELECT json_build_object(
			'total_packets', (SELECT COUNT(*) FROM public.executive_signoff_packets),
			'pending_packets', (SELECT COUNT(*) FROM public.executive_signoff_packets WHERE status = 'pending'),
			'approved_packets', (SELECT COUNT(*) FROM public.executive_signoff_packets WHERE status = 'approved'),
			'rejected_packets', (SELECT COUNT(*) FROM public.executive_signoff_packets WHERE status = 'rejected'),
			'conditional_packets', (SELECT COUNT(*) FROM public.executive_signoff_packets WHERE status = 'conditional_approval'),
			'finance_approved', (SELECT COUNT(*) FROM public.executive_signoff_packets WHERE finance_status IN ('approved', 'conditional_approval')),
			'cto_approved', (SELECT COUNT(*) FROM public.executive_signoff_packets WHERE cto_status IN ('approved', 'conditional_approval')),
			'risk_approved', (SELECT COUNT(*) FROM public.executive_signoff_packets WHERE risk_status IN ('approved', 'conditional_approval')),
			'operations_approved', (SELECT COUNT(*) FROM public.executive_signoff_packets WHERE operations_status IN ('approved', 'conditional_approval')),
			'latest_packet_status', (SELECT status FROM public.executive_signoff_packets ORDER BY updated_at DESC LIMIT 1),
			'public_launch_approved', false
		)
	`)
	if err != nil {
		return nil, err
	}
	return rawToMap(raw)
}

func (r *PostgresReports) LaunchBlockers(ctx context.Context, limit int) ([]map[string]any, error) {
	return r.simpleFinanceRows(ctx, `
		SELECT json_build_object(
			'id', id,
			'title', title,
			'severity', severity,
			'status', status,
			'owner_id', owner_id,
			'due_date', due_date,
			'resolved_by', resolved_by,
			'resolution', resolution,
			'created_at', created_at,
			'updated_at', updated_at,
			'resolved_at', resolved_at
		)
		FROM public.launch_blockers
		ORDER BY CASE status WHEN 'open' THEN 0 ELSE 1 END, due_date NULLS LAST, created_at DESC
		LIMIT $1
	`, limit)
}

func (r *PostgresReports) InternalLaunchStatus(ctx context.Context) (map[string]any, error) {
	raw, err := queryJSON(ctx, r.db, `
		SELECT json_build_object(
			'open_blockers', (SELECT COUNT(*) FROM public.launch_blockers WHERE status = 'open'),
			'critical_open_blockers', (SELECT COUNT(*) FROM public.launch_blockers WHERE status = 'open' AND severity = 'critical'),
			'resolved_blockers', (SELECT COUNT(*) FROM public.launch_blockers WHERE status = 'resolved'),
			'latest_outcome', (SELECT outcome FROM public.internal_launch_decisions ORDER BY created_at DESC LIMIT 1),
			'latest_overall_readiness_score', (SELECT overall_readiness_score FROM public.internal_launch_decisions ORDER BY created_at DESC LIMIT 1),
			'provider_activation_simulated', (SELECT provider_activation_simulated FROM public.internal_launch_decisions ORDER BY created_at DESC LIMIT 1),
			'wallet_activation_simulated', (SELECT wallet_activation_simulated FROM public.internal_launch_decisions ORDER BY created_at DESC LIMIT 1),
			'withdrawal_activation_simulated', (SELECT withdrawal_activation_simulated FROM public.internal_launch_decisions ORDER BY created_at DESC LIMIT 1),
			'public_payment_activation_simulated', (SELECT public_payment_activation_simulated FROM public.internal_launch_decisions ORDER BY created_at DESC LIMIT 1),
			'public_launch_approved', false
		)
	`)
	if err != nil {
		return nil, err
	}
	return rawToMap(raw)
}

func (r *PostgresReports) DrillEvidence(ctx context.Context, limit int) ([]map[string]any, error) {
	return r.simpleFinanceRows(ctx, `
		SELECT json_build_object(
			'id', id,
			'drill_type', drill_type,
			'provider', provider,
			'status', status,
			'evidence_ref', evidence_ref,
			'submitted_by', submitted_by,
			'created_at', created_at,
			'review_count', (SELECT COUNT(*) FROM public.drill_evidence_reviews r WHERE r.evidence_id = live_drill_evidence.id),
			'approved_reviews', (SELECT COUNT(*) FROM public.drill_evidence_reviews r WHERE r.evidence_id = live_drill_evidence.id AND r.status = 'approved'),
			'rejected_reviews', (SELECT COUNT(*) FROM public.drill_evidence_reviews r WHERE r.evidence_id = live_drill_evidence.id AND r.status = 'rejected')
		)
		FROM public.live_drill_evidence
		ORDER BY created_at DESC
		LIMIT $1
	`, limit)
}

func (r *PostgresReports) ProductionExceptions(ctx context.Context, limit int) ([]map[string]any, error) {
	return r.simpleFinanceRows(ctx, `
		SELECT json_build_object(
			'id', id,
			'severity', severity,
			'owner_id', owner_id,
			'status', status,
			'remediation_plan', remediation_plan,
			'target_resolution_date', target_resolution_date,
			'verified_by', verified_by,
			'closed_by', closed_by,
			'created_at', created_at,
			'updated_at', updated_at,
			'closed_at', closed_at
		)
		FROM public.production_exceptions
		ORDER BY CASE status WHEN 'closed' THEN 1 ELSE 0 END, target_resolution_date NULLS LAST, created_at DESC
		LIMIT $1
	`, limit)
}

func (r *PostgresReports) ReliabilityScorecards(ctx context.Context, limit int) ([]map[string]any, error) {
	return r.simpleFinanceRows(ctx, `
		SELECT json_build_object(
			'id', id,
			'scorecard_type', scorecard_type,
			'settlement_reliability_score', settlement_reliability_score,
			'provider_reliability_score', provider_reliability_score,
			'reconciliation_reliability_score', reconciliation_reliability_score,
			'governance_reliability_score', governance_reliability_score,
			'launch_readiness_reliability_score', launch_readiness_reliability_score,
			'overall_score', overall_score,
			'authorization_outcome', authorization_outcome,
			'created_by', created_by,
			'created_at', created_at
		)
		FROM public.reliability_scorecards
		ORDER BY created_at DESC
		LIMIT $1
	`, limit)
}

func (r *PostgresReports) FinanceControlRoom(ctx context.Context) (map[string]any, error) {
	raw, err := queryJSON(ctx, r.db, `
		SELECT json_build_object(
			'settlement_health', COALESCE((SELECT settlement_health FROM public.control_room_snapshots ORDER BY created_at DESC LIMIT 1), CASE WHEN (SELECT COUNT(*) FROM public.settlement_records WHERE status = 'failed') = 0 THEN 'green' ELSE 'yellow' END),
			'provider_health', COALESCE((SELECT provider_health FROM public.control_room_snapshots ORDER BY created_at DESC LIMIT 1), CASE WHEN (SELECT COUNT(*) FROM public.provider_events WHERE status = 'failed') = 0 THEN 'green' ELSE 'yellow' END),
			'reconciliation_health', COALESCE((SELECT reconciliation_health FROM public.control_room_snapshots ORDER BY created_at DESC LIMIT 1), CASE WHEN (SELECT COUNT(*) FROM public.reconciliation_runs WHERE status = 'requires_review') = 0 THEN 'green' ELSE 'yellow' END),
			'authorization_health', COALESCE((SELECT authorization_health FROM public.control_room_snapshots ORDER BY created_at DESC LIMIT 1), CASE WHEN (SELECT COUNT(*) FROM public.wallet_authorizations WHERE status = 'failed') = 0 THEN 'green' ELSE 'yellow' END),
			'launch_readiness_health', COALESCE((SELECT launch_readiness_health FROM public.control_room_snapshots ORDER BY created_at DESC LIMIT 1), CASE WHEN (SELECT COUNT(*) FROM public.production_exceptions WHERE status <> 'closed' AND severity IN ('high', 'critical')) = 0 THEN 'green' ELSE 'red' END),
			'failed_settlements', (SELECT COUNT(*) FROM public.settlement_records WHERE status = 'failed'),
			'failed_provider_events', (SELECT COUNT(*) FROM public.provider_events WHERE status = 'failed'),
			'reconciliation_reviews', (SELECT COUNT(*) FROM public.reconciliation_runs WHERE status = 'requires_review'),
			'failed_authorizations', (SELECT COUNT(*) FROM public.wallet_authorizations WHERE status = 'failed'),
			'open_high_critical_exceptions', (SELECT COUNT(*) FROM public.production_exceptions WHERE status <> 'closed' AND severity IN ('high', 'critical')),
			'public_launch_approved', false
		)
	`)
	if err != nil {
		return nil, err
	}
	return rawToMap(raw)
}

func (r *PostgresReports) DailyCloseReports(ctx context.Context, limit int) ([]map[string]any, error) {
	return r.simpleFinanceRows(ctx, `
		SELECT json_build_object(
			'id', id,
			'close_date', close_date,
			'status', status,
			'opening_balance_minor', opening_balance_minor,
			'closing_balance_minor', closing_balance_minor,
			'provider_total_minor', provider_total_minor,
			'wallet_total_minor', wallet_total_minor,
			'reconciliation_status', reconciliation_status,
			'unresolved_exceptions', unresolved_exceptions,
			'finance_review_status', (SELECT status FROM public.daily_close_reviews r WHERE r.close_id = daily_finance_closes.id AND r.review_role = 'finance' ORDER BY created_at DESC LIMIT 1),
			'operations_review_status', (SELECT status FROM public.daily_close_reviews r WHERE r.close_id = daily_finance_closes.id AND r.review_role = 'operations' ORDER BY created_at DESC LIMIT 1),
			'signed_off_by', signed_off_by,
			'signed_off_at', signed_off_at,
			'created_at', created_at,
			'updated_at', updated_at
		)
		FROM public.daily_finance_closes
		ORDER BY close_date DESC
		LIMIT $1
	`, limit)
}

func (r *PostgresReports) PilotMonitoringReport(ctx context.Context) (map[string]any, error) {
	raw, err := queryJSON(ctx, r.db, `
		SELECT json_build_object(
			'pilot_users', COALESCE((SELECT pilot_users FROM public.pilot_monitoring_snapshots ORDER BY created_at DESC LIMIT 1), (SELECT COUNT(*) FROM public.pilot_wallet_users WHERE status = 'enabled')),
			'pilot_transactions', COALESCE((SELECT pilot_transactions FROM public.pilot_monitoring_snapshots ORDER BY created_at DESC LIMIT 1), (SELECT COUNT(*) FROM public.wallet_transactions WHERE payment_provider IS NOT NULL)),
			'pilot_deposits', COALESCE((SELECT pilot_deposits FROM public.pilot_monitoring_snapshots ORDER BY created_at DESC LIMIT 1), (SELECT COUNT(*) FROM public.payment_intents WHERE status IN ('approved', 'completed'))),
			'pilot_withdrawals', COALESCE((SELECT pilot_withdrawals FROM public.pilot_monitoring_snapshots ORDER BY created_at DESC LIMIT 1), (SELECT COUNT(*) FROM public.withdrawal_requests WHERE status = 'approved')),
			'pilot_failures', COALESCE((SELECT pilot_failures FROM public.pilot_monitoring_snapshots ORDER BY created_at DESC LIMIT 1), (
				(SELECT COUNT(*) FROM public.settlement_records WHERE status = 'failed') +
				(SELECT COUNT(*) FROM public.wallet_authorizations WHERE status = 'failed') +
				(SELECT COUNT(*) FROM public.provider_events WHERE status = 'failed')
			)),
			'latest_settlement_success_rate', (SELECT settlement_success_rate FROM public.daily_reliability_metrics ORDER BY metric_date DESC LIMIT 1),
			'latest_provider_callback_success_rate', (SELECT provider_callback_success_rate FROM public.daily_reliability_metrics ORDER BY metric_date DESC LIMIT 1),
			'latest_reconciliation_success_rate', (SELECT reconciliation_success_rate FROM public.daily_reliability_metrics ORDER BY metric_date DESC LIMIT 1),
			'public_launch_approved', false
		)
	`)
	if err != nil {
		return nil, err
	}
	return rawToMap(raw)
}

func (r *PostgresReports) Day1CloseReport(ctx context.Context) (map[string]any, error) {
	raw, err := queryJSON(ctx, r.db, `
		SELECT json_build_object(
			'latest_status', (SELECT status FROM public.day1_close_simulations ORDER BY created_at DESC LIMIT 1),
			'opening_balance_validated', (SELECT opening_balance_validated FROM public.day1_close_simulations ORDER BY created_at DESC LIMIT 1),
			'transaction_validated', (SELECT transaction_validated FROM public.day1_close_simulations ORDER BY created_at DESC LIMIT 1),
			'provider_total_validated', (SELECT provider_total_validated FROM public.day1_close_simulations ORDER BY created_at DESC LIMIT 1),
			'wallet_total_validated', (SELECT wallet_total_validated FROM public.day1_close_simulations ORDER BY created_at DESC LIMIT 1),
			'reconciliation_validated', (SELECT reconciliation_validated FROM public.day1_close_simulations ORDER BY created_at DESC LIMIT 1),
			'exception_review_completed', (SELECT exception_review_completed FROM public.day1_close_simulations ORDER BY created_at DESC LIMIT 1),
			'finance_signed_off', (SELECT finance_signed_off FROM public.day1_close_simulations ORDER BY created_at DESC LIMIT 1),
			'operations_signed_off', (SELECT operations_signed_off FROM public.day1_close_simulations ORDER BY created_at DESC LIMIT 1),
			'open_daily_closes', (SELECT COUNT(*) FROM public.daily_finance_closes WHERE status IN ('open', 'reconciling', 'pending_review')),
			'signed_daily_closes', (SELECT COUNT(*) FROM public.daily_finance_closes WHERE status = 'signed_off'),
			'failed_daily_closes', (SELECT COUNT(*) FROM public.daily_finance_closes WHERE status = 'failed'),
			'public_launch_approved', false
		)
	`)
	if err != nil {
		return nil, err
	}
	return rawToMap(raw)
}

func (r *PostgresReports) PilotStatusReport(ctx context.Context) (map[string]any, error) {
	raw, err := queryJSON(ctx, r.db, `
		SELECT json_build_object(
			'latest_outcome', (SELECT outcome FROM public.internal_pilot_success_criteria ORDER BY created_at DESC LIMIT 1),
			'settlement_success', (SELECT settlement_success FROM public.internal_pilot_success_criteria ORDER BY created_at DESC LIMIT 1),
			'reconciliation_success', (SELECT reconciliation_success FROM public.internal_pilot_success_criteria ORDER BY created_at DESC LIMIT 1),
			'provider_success', (SELECT provider_success FROM public.internal_pilot_success_criteria ORDER BY created_at DESC LIMIT 1),
			'reliability_score', (SELECT reliability_score FROM public.internal_pilot_success_criteria ORDER BY created_at DESC LIMIT 1),
			'unresolved_exceptions', (SELECT unresolved_exceptions FROM public.internal_pilot_success_criteria ORDER BY created_at DESC LIMIT 1),
			'timeline_events', (SELECT COUNT(*) FROM public.pilot_operations_timeline),
			'pilot_start_recorded', EXISTS (SELECT 1 FROM public.pilot_operations_timeline WHERE event_type = 'pilot_start'),
			'pilot_close_recorded', EXISTS (SELECT 1 FROM public.pilot_operations_timeline WHERE event_type = 'pilot_close'),
			'high_critical_escalations', (SELECT COUNT(*) FROM public.incident_escalations WHERE level IN ('high', 'critical') AND status <> 'closed'),
			'public_launch_approved', false
		)
	`)
	if err != nil {
		return nil, err
	}
	return rawToMap(raw)
}

func (r *PostgresReports) GoNoGoReport(ctx context.Context) (map[string]any, error) {
	raw, err := queryJSON(ctx, r.db, `
		WITH blockers AS (
			SELECT
				(SELECT COUNT(*) FROM public.production_exceptions WHERE status <> 'closed' AND severity = 'critical') AS critical_exceptions,
				(SELECT COUNT(*) FROM public.production_exceptions WHERE status <> 'closed' AND severity = 'high') AS high_exceptions,
				(SELECT COUNT(*) FROM public.reconciliation_runs WHERE status = 'requires_review') AS reconciliation_incomplete,
				NOT EXISTS (SELECT 1 FROM public.executive_signoff_packets WHERE finance_status IN ('approved', 'conditional_approval')) AS finance_missing,
				NOT EXISTS (SELECT 1 FROM public.executive_signoff_packets WHERE operations_status IN ('approved', 'conditional_approval')) AS operations_missing,
				NOT EXISTS (SELECT 1 FROM public.executive_signoff_packets WHERE cto_status IN ('approved', 'conditional_approval')) AS cto_missing,
				NOT EXISTS (SELECT 1 FROM public.executive_signoff_packets WHERE risk_status IN ('approved', 'conditional_approval')) AS risk_missing
		)
		SELECT json_build_object(
			'latest_decision', (SELECT decision FROM public.pilot_authorizations ORDER BY created_at DESC LIMIT 1),
			'critical_exceptions', critical_exceptions,
			'high_exceptions', high_exceptions,
			'reconciliation_incomplete', reconciliation_incomplete,
			'finance_signoff_missing', finance_missing,
			'operations_signoff_missing', operations_missing,
			'cto_signoff_missing', cto_missing,
			'risk_signoff_missing', risk_missing,
			'go_blocked', critical_exceptions > 0 OR high_exceptions > 0 OR reconciliation_incomplete > 0 OR finance_missing OR operations_missing OR cto_missing OR risk_missing,
			'public_launch_approved', false
		)
		FROM blockers
	`)
	if err != nil {
		return nil, err
	}
	return rawToMap(raw)
}

func (r *PostgresReports) PilotAuthorizationReport(ctx context.Context) (map[string]any, error) {
	raw, err := queryJSON(ctx, r.db, `
		SELECT json_build_object(
			'latest_decision', (SELECT decision FROM public.pilot_authorizations ORDER BY created_at DESC LIMIT 1),
			'latest_decision_reason', (SELECT decision_reason FROM public.pilot_authorizations ORDER BY created_at DESC LIMIT 1),
			'latest_conditions', (SELECT conditions FROM public.pilot_authorizations ORDER BY created_at DESC LIMIT 1),
			'latest_approvers', (SELECT approvers FROM public.pilot_authorizations ORDER BY created_at DESC LIMIT 1),
			'authorization_count', (SELECT COUNT(*) FROM public.pilot_authorizations),
			'go_count', (SELECT COUNT(*) FROM public.pilot_authorizations WHERE decision = 'go'),
			'conditional_go_count', (SELECT COUNT(*) FROM public.pilot_authorizations WHERE decision = 'conditional_go'),
			'no_go_count', (SELECT COUNT(*) FROM public.pilot_authorizations WHERE decision = 'no_go'),
			'public_launch_approved', false
		)
	`)
	if err != nil {
		return nil, err
	}
	return rawToMap(raw)
}

func (r *PostgresReports) PilotReadinessReport(ctx context.Context) (map[string]any, error) {
	raw, err := queryJSON(ctx, r.db, `
		SELECT json_build_object(
			'latest_scope', (SELECT json_build_object(
				'pilot_users', pilot_users,
				'pilot_drivers', pilot_drivers,
				'pilot_riders', pilot_riders,
				'pilot_transactions', pilot_transactions,
				'pilot_duration_days', pilot_duration_days
			) FROM public.pilot_scope_definitions ORDER BY created_at DESC LIMIT 1),
			'latest_success_definition', (SELECT json_build_object(
				'settlement_reliability_target', settlement_reliability_target,
				'reconciliation_reliability_target', reconciliation_reliability_target,
				'provider_reliability_target', provider_reliability_target,
				'dispute_resolution_target', dispute_resolution_target,
				'incident_response_target', incident_response_target
			) FROM public.pilot_success_definitions ORDER BY created_at DESC LIMIT 1),
			'technology_ready', (SELECT technology_ready FROM public.pilot_authorizations ORDER BY created_at DESC LIMIT 1),
			'financial_ready', (SELECT financial_ready FROM public.pilot_authorizations ORDER BY created_at DESC LIMIT 1),
			'provider_ready', (SELECT provider_ready FROM public.pilot_authorizations ORDER BY created_at DESC LIMIT 1),
			'governance_ready', (SELECT governance_ready FROM public.pilot_authorizations ORDER BY created_at DESC LIMIT 1),
			'operational_ready', (SELECT operational_ready FROM public.pilot_authorizations ORDER BY created_at DESC LIMIT 1),
			'reliability_ready', (SELECT reliability_ready FROM public.pilot_authorizations ORDER BY created_at DESC LIMIT 1),
			'public_launch_approved', false
		)
	`)
	if err != nil {
		return nil, err
	}
	return rawToMap(raw)
}

func (r *PostgresReports) InternalPilotBoardReport(ctx context.Context) (map[string]any, error) {
	raw, err := queryJSON(ctx, r.db, `
		SELECT json_build_object(
			'latest_authorization_status', (SELECT status FROM public.internal_pilot_authorization_executions ORDER BY created_at DESC LIMIT 1),
			'latest_decision', (SELECT decision FROM public.internal_pilot_authorization_executions ORDER BY created_at DESC LIMIT 1),
			'latest_decision_reason', (SELECT decision_reason FROM public.internal_pilot_authorization_executions ORDER BY created_at DESC LIMIT 1),
			'active_authorizations', (SELECT COUNT(*) FROM public.internal_pilot_authorization_executions WHERE status = 'active'),
			'expired_authorizations', (SELECT COUNT(*) FROM public.internal_pilot_authorization_executions WHERE status = 'expired'),
			'revoked_authorizations', (SELECT COUNT(*) FROM public.internal_pilot_authorization_executions WHERE status = 'revoked'),
			'completed_authorizations', (SELECT COUNT(*) FROM public.internal_pilot_authorization_executions WHERE status = 'completed'),
			'approval_audit_events', (SELECT COUNT(*) FROM public.internal_pilot_authorization_audits),
			'required_signoffs', (SELECT required_signoffs FROM public.internal_pilot_authorization_executions ORDER BY created_at DESC LIMIT 1),
			'required_evidence', (SELECT required_evidence FROM public.internal_pilot_authorization_executions ORDER BY created_at DESC LIMIT 1),
			'unresolved_exceptions', (SELECT unresolved_exceptions FROM public.internal_pilot_authorization_executions ORDER BY created_at DESC LIMIT 1),
			'readiness_score', (SELECT readiness_score FROM public.internal_pilot_authorization_executions ORDER BY created_at DESC LIMIT 1),
			'readiness_score_threshold', (SELECT readiness_score_threshold FROM public.internal_pilot_authorization_executions ORDER BY created_at DESC LIMIT 1),
			'public_launch_approved', false
		)
	`)
	if err != nil {
		return nil, err
	}
	return rawToMap(raw)
}

func (r *PostgresReports) InternalPilotAuthorizationReport(ctx context.Context) (map[string]any, error) {
	raw, err := queryJSON(ctx, r.db, `
		SELECT json_build_object(
			'latest_authorization', (SELECT json_build_object(
				'id', id,
				'pilot_authorization_id', pilot_authorization_id,
				'status', status,
				'decision', decision,
				'decision_reason', decision_reason,
				'conditions', conditions,
				'approved_pilot_users', approved_pilot_users,
				'approved_drivers', approved_drivers,
				'approved_riders', approved_riders,
				'pilot_transaction_limit', pilot_transaction_limit,
				'pilot_duration_days', pilot_duration_days,
				'expires_at', expires_at
			) FROM public.internal_pilot_authorization_executions ORDER BY created_at DESC LIMIT 1),
			'authorization_count', (SELECT COUNT(*) FROM public.internal_pilot_authorization_executions),
			'approved_count', (SELECT COUNT(*) FROM public.internal_pilot_authorization_executions WHERE decision = 'approved'),
			'conditional_approval_count', (SELECT COUNT(*) FROM public.internal_pilot_authorization_executions WHERE decision = 'conditional_approval'),
			'rejected_count', (SELECT COUNT(*) FROM public.internal_pilot_authorization_executions WHERE decision = 'rejected'),
			'expired_decision_count', (SELECT COUNT(*) FROM public.internal_pilot_authorization_executions WHERE decision = 'expired'),
			'audit_events', (SELECT COUNT(*) FROM public.internal_pilot_authorization_audits),
			'latest_audit_decision', (SELECT decision FROM public.internal_pilot_authorization_audits ORDER BY created_at DESC LIMIT 1),
			'public_launch_approved', false
		)
	`)
	if err != nil {
		return nil, err
	}
	return rawToMap(raw)
}

func (r *PostgresReports) InternalPilotHealthReport(ctx context.Context) (map[string]any, error) {
	raw, err := queryJSON(ctx, r.db, `
		SELECT json_build_object(
			'authorization_state', (SELECT status FROM public.internal_pilot_authorization_executions ORDER BY created_at DESC LIMIT 1),
			'authorization_expiry', (SELECT expires_at FROM public.internal_pilot_authorization_executions ORDER BY created_at DESC LIMIT 1),
			'latest_health_report', (SELECT json_build_object(
				'report_date', report_date,
				'ride_requests', ride_requests,
				'completed_rides', completed_rides,
				'cancelled_rides', cancelled_rides,
				'failed_rides', failed_rides,
				'wallet_payments', wallet_payments,
				'cash_payments', cash_payments,
				'driver_participation', driver_participation,
				'rider_participation', rider_participation,
				'incident_count', incident_count,
				'critical_incidents', critical_incidents,
				'ride_completion_rate', ride_completion_rate,
				'cancellation_rate', cancellation_rate,
				'wallet_success_rate', wallet_success_rate,
				'operational_incident_rate', operational_incident_rate,
				'authorization_compliance_rate', authorization_compliance_rate,
				'participant_activity_rate', participant_activity_rate
			) FROM public.internal_pilot_health_reports ORDER BY report_date DESC, created_at DESC LIMIT 1),
			'participant_counts', (SELECT json_build_object(
				'total', COUNT(*),
				'active', COUNT(*) FILTER (WHERE status = 'active'),
				'suspended', COUNT(*) FILTER (WHERE status = 'suspended'),
				'removed', COUNT(*) FILTER (WHERE status = 'removed'),
				'riders', COUNT(*) FILTER (WHERE role = 'rider' AND status = 'active'),
				'drivers', COUNT(*) FILTER (WHERE role = 'driver' AND status = 'active')
			) FROM public.internal_pilot_participants),
			'incident_summary', (SELECT json_build_object(
				'open', COUNT(*) FILTER (WHERE status IN ('open', 'investigating', 'mitigated')),
				'critical', COUNT(*) FILTER (WHERE severity = 'critical' AND status <> 'closed'),
				'high', COUNT(*) FILTER (WHERE severity = 'high' AND status <> 'closed')
			) FROM public.internal_pilot_incidents),
			'active_kill_switches', (SELECT COUNT(*) FROM public.internal_pilot_kill_switches WHERE status = 'active'),
			'public_launch_approved', false
		)
	`)
	if err != nil {
		return nil, err
	}
	return rawToMap(raw)
}

func (r *PostgresReports) InternalPilotIncidents(ctx context.Context, limit int) ([]map[string]any, error) {
	return r.simpleFinanceRows(ctx, `
		SELECT json_build_object(
			'id', id,
			'authorization_execution_id', authorization_execution_id,
			'incident_type', incident_type,
			'severity', severity,
			'status', status,
			'source_id', source_id,
			'title', title,
			'owner_id', owner_id,
			'opened_by', opened_by,
			'resolved_by', resolved_by,
			'resolution', resolution,
			'created_at', created_at,
			'updated_at', updated_at,
			'resolved_at', resolved_at
		)
		FROM public.internal_pilot_incidents
		ORDER BY created_at DESC
		LIMIT $1
	`, limit)
}

func (r *PostgresReports) InternalPilotParticipants(ctx context.Context, limit int) ([]map[string]any, error) {
	return r.simpleFinanceRows(ctx, `
		SELECT json_build_object(
			'id', id,
			'authorization_execution_id', authorization_execution_id,
			'user_id', user_id,
			'role', role,
			'status', status,
			'enrollment_source', enrollment_source,
			'enrolled_by', enrolled_by,
			'reason', reason,
			'enrolled_at', enrolled_at,
			'updated_at', updated_at
		)
		FROM public.internal_pilot_participants
		ORDER BY enrolled_at DESC
		LIMIT $1
	`, limit)
}

func (r *PostgresReports) InternalPilotKillSwitches(ctx context.Context, limit int) ([]map[string]any, error) {
	return r.simpleFinanceRows(ctx, `
		SELECT json_build_object(
			'id', id,
			'service', service,
			'status', status,
			'activated_by', activated_by,
			'activated_at', activated_at,
			'deactivated_by', deactivated_by,
			'deactivated_at', deactivated_at,
			'reason', reason,
			'updated_at', updated_at
		)
		FROM public.internal_pilot_kill_switches
		ORDER BY updated_at DESC
		LIMIT $1
	`, limit)
}

func (r *PostgresReports) InternalPilotReadinessReport(ctx context.Context) (map[string]any, error) {
	raw, err := queryJSON(ctx, r.db, `
		WITH latest_auth AS (
			SELECT *
			FROM public.internal_pilot_authorization_executions
			ORDER BY created_at DESC
			LIMIT 1
		),
		counts AS (
			SELECT
				(SELECT COUNT(*) FROM public.internal_pilot_participants WHERE status = 'active') AS active_participants,
				(SELECT COUNT(*) FROM public.internal_pilot_participants WHERE status = 'active' AND role = 'driver') AS active_drivers,
				(SELECT COUNT(*) FROM public.internal_pilot_participants WHERE status = 'active' AND role = 'rider') AS active_riders,
				(SELECT COUNT(*) FROM public.internal_pilot_incidents WHERE severity IN ('high', 'critical') AND status <> 'closed') AS high_critical_incidents,
				(SELECT COUNT(*) FROM public.internal_pilot_kill_switches WHERE status = 'active') AS active_kill_switches
		)
		SELECT json_build_object(
			'authorization_state', latest_auth.status,
			'authorization_expiry', latest_auth.expires_at,
			'pilot_utilization', json_build_object(
				'active_participants', active_participants,
				'approved_pilot_users', latest_auth.approved_pilot_users,
				'active_drivers', active_drivers,
				'approved_drivers', latest_auth.approved_drivers,
				'active_riders', active_riders,
				'approved_riders', latest_auth.approved_riders,
				'pilot_transaction_limit', latest_auth.pilot_transaction_limit,
				'pilot_duration_days', latest_auth.pilot_duration_days
			),
			'incident_summary', json_build_object(
				'high_critical_open', high_critical_incidents
			),
			'kill_switch_status', json_build_object(
				'active_kill_switches', active_kill_switches
			),
			'readiness_status',
				CASE
					WHEN latest_auth.status <> 'active' THEN 'blocked_authorization_not_active'
					WHEN latest_auth.expires_at IS NOT NULL AND latest_auth.expires_at <= NOW() THEN 'blocked_authorization_expired'
					WHEN active_kill_switches > 0 THEN 'blocked_kill_switch_active'
					WHEN high_critical_incidents > 0 THEN 'blocked_high_critical_incident'
					WHEN latest_auth.approved_pilot_users > 0 AND active_participants > latest_auth.approved_pilot_users THEN 'blocked_participant_limit'
					WHEN latest_auth.approved_drivers > 0 AND active_drivers > latest_auth.approved_drivers THEN 'blocked_driver_limit'
					WHEN latest_auth.approved_riders > 0 AND active_riders > latest_auth.approved_riders THEN 'blocked_rider_limit'
					ELSE 'ready_for_internal_pilot_start'
				END,
			'public_launch_approved', false
		)
		FROM latest_auth, counts
	`)
	if err != nil {
		return nil, err
	}
	return rawToMap(raw)
}

func (r *PostgresReports) InternalPilotEvidence(ctx context.Context, limit int) ([]map[string]any, error) {
	return r.simpleFinanceRows(ctx, `
		SELECT json_build_object(
			'id', id,
			'authorization_execution_id', authorization_execution_id,
			'report_period_start', report_period_start,
			'report_period_end', report_period_end,
			'total_events', total_events,
			'total_rides', total_rides,
			'completed_rides', completed_rides,
			'cancelled_rides', cancelled_rides,
			'wallet_transactions', wallet_transactions,
			'cash_transactions', cash_transactions,
			'incidents', incidents,
			'critical_incidents', critical_incidents,
			'compliance_score', compliance_score,
			'created_at', created_at
		)
		FROM public.internal_pilot_evidence_packages
		ORDER BY created_at DESC
		LIMIT $1
	`, limit)
}

func (r *PostgresReports) InternalPilotObjectives(ctx context.Context, limit int) ([]map[string]any, error) {
	return r.simpleFinanceRows(ctx, `
		SELECT json_build_object(
			'id', id,
			'authorization_execution_id', authorization_execution_id,
			'objective_name', objective_name,
			'target_value', target_value,
			'actual_value', actual_value,
			'achieved', achieved,
			'notes', notes,
			'created_at', created_at
		)
		FROM public.internal_pilot_objective_results
		ORDER BY created_at DESC
		LIMIT $1
	`, limit)
}

func (r *PostgresReports) InternalPilotSummary(ctx context.Context) (map[string]any, error) {
	raw, err := queryJSON(ctx, r.db, `
		SELECT json_build_object(
			'latest_evidence_package', (SELECT json_build_object(
				'id', id,
				'total_events', total_events,
				'total_rides', total_rides,
				'completed_rides', completed_rides,
				'cancelled_rides', cancelled_rides,
				'wallet_transactions', wallet_transactions,
				'cash_transactions', cash_transactions,
				'incidents', incidents,
				'critical_incidents', critical_incidents,
				'compliance_score', compliance_score,
				'created_at', created_at
			) FROM public.internal_pilot_evidence_packages ORDER BY created_at DESC LIMIT 1),
			'pilot_utilization', (SELECT json_build_object(
				'active_participants', COUNT(*) FILTER (WHERE status = 'active'),
				'riders', COUNT(*) FILTER (WHERE status = 'active' AND role = 'rider'),
				'drivers', COUNT(*) FILTER (WHERE status = 'active' AND role = 'driver')
			) FROM public.internal_pilot_participants),
			'payment_statistics', (SELECT json_build_object(
				'wallet_transactions', COALESCE(SUM(wallet_transactions), 0),
				'cash_transactions', COALESCE(SUM(cash_transactions), 0)
			) FROM public.internal_pilot_evidence_packages),
			'incident_summary', (SELECT json_build_object(
				'total', COUNT(*),
				'critical', COUNT(*) FILTER (WHERE severity = 'critical'),
				'open', COUNT(*) FILTER (WHERE status IN ('open', 'investigating', 'mitigated'))
			) FROM public.internal_pilot_incidents),
			'objective_achievement', (SELECT json_build_object(
				'total', COUNT(*),
				'achieved', COUNT(*) FILTER (WHERE achieved),
				'not_achieved', COUNT(*) FILTER (WHERE NOT achieved)
			) FROM public.internal_pilot_objective_results),
			'readiness_recommendation',
				CASE
					WHEN EXISTS (SELECT 1 FROM public.internal_pilot_incidents WHERE severity = 'critical' AND status <> 'closed') THEN 'not_ready_critical_incident_open'
					WHEN EXISTS (SELECT 1 FROM public.internal_pilot_kill_switches WHERE status = 'active') THEN 'not_ready_kill_switch_active'
					WHEN EXISTS (SELECT 1 FROM public.internal_pilot_objective_results WHERE NOT achieved) THEN 'conditional_objectives_not_met'
					ELSE 'ready_for_board_review'
				END,
			'public_launch_approved', false
		)
	`)
	if err != nil {
		return nil, err
	}
	return rawToMap(raw)
}

func (r *PostgresReports) InternalPilotCompliance(ctx context.Context) (map[string]any, error) {
	raw, err := queryJSON(ctx, r.db, `
		WITH evidence AS (
			SELECT *
			FROM public.internal_pilot_execution_events
		)
		SELECT json_build_object(
			'authorization_checks', json_build_object(
				'passed', COUNT(*) FILTER (WHERE event_type = 'authorization_check_passed'),
				'failed', COUNT(*) FILTER (WHERE event_type = 'authorization_check_failed'),
				'pass_rate',
					CASE
						WHEN COUNT(*) FILTER (WHERE event_type IN ('authorization_check_passed', 'authorization_check_failed')) = 0 THEN 0
						ELSE ((COUNT(*) FILTER (WHERE event_type = 'authorization_check_passed')) * 100 / COUNT(*) FILTER (WHERE event_type IN ('authorization_check_passed', 'authorization_check_failed')))
					END
			),
			'policy_violations', COUNT(*) FILTER (WHERE event_type IN ('authorization_check_failed', 'kill_switch_triggered')),
			'kill_switch_activations', COUNT(*) FILTER (WHERE event_type = 'kill_switch_triggered'),
			'latest_compliance_score', (SELECT compliance_score FROM public.internal_pilot_evidence_packages ORDER BY created_at DESC LIMIT 1),
			'readiness_recommendation',
				CASE
					WHEN COUNT(*) FILTER (WHERE event_type = 'authorization_check_failed') > 0 THEN 'requires_authorization_review'
					WHEN COUNT(*) FILTER (WHERE event_type = 'kill_switch_triggered') > 0 THEN 'requires_kill_switch_review'
					ELSE 'compliance_ready_for_board_review'
				END,
			'public_launch_approved', false
		)
		FROM evidence
	`)
	if err != nil {
		return nil, err
	}
	return rawToMap(raw)
}

func (r *PostgresReports) InternalPilotBoardReview(ctx context.Context) (map[string]any, error) {
	raw, err := queryJSON(ctx, r.db, `
		SELECT json_build_object(
			'latest_review', (SELECT json_build_object(
				'id', id,
				'authorization_execution_id', authorization_execution_id,
				'review_status', review_status,
				'decision', decision,
				'decision_reason', decision_reason,
				'reviewed_by', reviewed_by,
				'reviewed_at', reviewed_at,
				'created_at', created_at
			) FROM public.internal_pilot_board_reviews ORDER BY created_at DESC LIMIT 1),
			'review_status_counts', (SELECT json_build_object(
				'pending', COUNT(*) FILTER (WHERE review_status = 'pending'),
				'in_review', COUNT(*) FILTER (WHERE review_status = 'in_review'),
				'completed', COUNT(*) FILTER (WHERE review_status = 'completed')
			) FROM public.internal_pilot_board_reviews),
			'decision_counts', (SELECT json_build_object(
				'approved', COUNT(*) FILTER (WHERE decision = 'approved'),
				'conditional_approval', COUNT(*) FILTER (WHERE decision = 'conditional_approval'),
				'rejected', COUNT(*) FILTER (WHERE decision = 'rejected'),
				'defer', COUNT(*) FILTER (WHERE decision = 'defer')
			) FROM public.internal_pilot_board_reviews),
			'public_launch_approved', false
		)
	`)
	if err != nil {
		return nil, err
	}
	return rawToMap(raw)
}

func (r *PostgresReports) InternalPilotFindings(ctx context.Context, limit int) ([]map[string]any, error) {
	return r.simpleFinanceRows(ctx, `
		SELECT json_build_object(
			'id', id,
			'board_review_id', board_review_id,
			'category', category,
			'severity', severity,
			'title', title,
			'description', description,
			'recommendation', recommendation,
			'created_at', created_at
		)
		FROM public.internal_pilot_review_findings
		ORDER BY created_at DESC
		LIMIT $1
	`, limit)
}

func (r *PostgresReports) InternalPilotReadinessAssessment(ctx context.Context, limit int) ([]map[string]any, error) {
	return r.simpleFinanceRows(ctx, `
		SELECT json_build_object(
			'id', id,
			'board_review_id', board_review_id,
			'category', category,
			'score', score,
			'target_score', target_score,
			'passed', passed,
			'notes', notes,
			'created_at', created_at
		)
		FROM public.internal_pilot_readiness_assessments
		ORDER BY created_at DESC
		LIMIT $1
	`, limit)
}

func (r *PostgresReports) InternalPilotBoardRecommendation(ctx context.Context) (map[string]any, error) {
	raw, err := queryJSON(ctx, r.db, `
		WITH latest_review AS (
			SELECT *
			FROM public.internal_pilot_board_reviews
			ORDER BY created_at DESC
			LIMIT 1
		),
		finding_counts AS (
			SELECT
				COUNT(*) FILTER (WHERE severity = 'critical') AS critical_findings,
				COUNT(*) FILTER (WHERE severity = 'high') AS high_findings,
				COUNT(*) FILTER (WHERE severity IN ('low', 'medium')) AS minor_findings,
				COUNT(*) FILTER (WHERE severity = 'high' AND category IN ('financial', 'compliance')) AS high_financial_compliance_findings
			FROM public.internal_pilot_review_findings
			WHERE board_review_id = (SELECT id FROM latest_review)
		),
		assessment_counts AS (
			SELECT
				COUNT(*) AS total_assessments,
				COUNT(*) FILTER (WHERE passed) AS passed_assessments,
				COUNT(*) FILTER (WHERE NOT passed) AS failed_assessments,
				COUNT(*) FILTER (WHERE NOT passed AND score + 10 < target_score) AS severe_assessment_gaps
			FROM public.internal_pilot_readiness_assessments
			WHERE board_review_id = (SELECT id FROM latest_review)
		),
		objective_counts AS (
			SELECT
				COUNT(*) AS total_objectives,
				COUNT(*) FILTER (WHERE achieved) AS achieved_objectives,
				COUNT(*) FILTER (WHERE NOT achieved) AS missed_objectives
			FROM public.internal_pilot_objective_results
		)
		SELECT json_build_object(
			'board_review_id', (SELECT id FROM latest_review),
			'latest_decision', (SELECT decision FROM latest_review),
			'latest_decision_reason', (SELECT decision_reason FROM latest_review),
			'critical_findings', COALESCE((SELECT critical_findings FROM finding_counts), 0),
			'high_findings', COALESCE((SELECT high_findings FROM finding_counts), 0),
			'minor_findings', COALESCE((SELECT minor_findings FROM finding_counts), 0),
			'failed_assessments', COALESCE((SELECT failed_assessments FROM assessment_counts), 0),
			'missed_objectives', COALESCE((SELECT missed_objectives FROM objective_counts), 0),
			'board_recommendation',
				CASE
					WHEN COALESCE((SELECT critical_findings FROM finding_counts), 0) > 0
					  OR COALESCE((SELECT high_financial_compliance_findings FROM finding_counts), 0) > 0 THEN 'rejected_public_pilot_blocked'
					WHEN COALESCE((SELECT severe_assessment_gaps FROM assessment_counts), 0) > 0
					  OR COALESCE((SELECT high_findings FROM finding_counts), 0) > 0 THEN 'defer_remain_internal_pilot'
					WHEN COALESCE((SELECT minor_findings FROM finding_counts), 0) > 0
					  OR COALESCE((SELECT failed_assessments FROM assessment_counts), 0) > 0
					  OR COALESCE((SELECT missed_objectives FROM objective_counts), 0) > 0 THEN 'conditional_approval_corrective_actions_required'
					ELSE 'eligible_for_v2_3_a_limited_public_wallet_pilot_review'
				END,
			'maximum_authority', 'eligible_for_v2_3_a_limited_public_wallet_pilot_review',
			'public_launch_approved', false
		)
	`)
	if err != nil {
		return nil, err
	}
	return rawToMap(raw)
}

func (r *PostgresReports) InternalPilotReviewSummary(ctx context.Context) (map[string]any, error) {
	raw, err := queryJSON(ctx, r.db, `
		WITH latest_review AS (
			SELECT *
			FROM public.internal_pilot_board_reviews
			ORDER BY created_at DESC
			LIMIT 1
		)
		SELECT json_build_object(
			'review_status', (SELECT review_status FROM latest_review),
			'decision', (SELECT decision FROM latest_review),
			'decision_reason', (SELECT decision_reason FROM latest_review),
			'readiness_scores', (SELECT COALESCE(json_object_agg(category, score), '{}'::json) FROM public.internal_pilot_readiness_assessments WHERE board_review_id = (SELECT id FROM latest_review)),
			'readiness_targets', (SELECT COALESCE(json_object_agg(category, target_score), '{}'::json) FROM public.internal_pilot_readiness_assessments WHERE board_review_id = (SELECT id FROM latest_review)),
			'finding_summary', (SELECT json_build_object(
				'total', COUNT(*),
				'critical', COUNT(*) FILTER (WHERE severity = 'critical'),
				'high', COUNT(*) FILTER (WHERE severity = 'high'),
				'medium', COUNT(*) FILTER (WHERE severity = 'medium'),
				'low', COUNT(*) FILTER (WHERE severity = 'low')
			) FROM public.internal_pilot_review_findings WHERE board_review_id = (SELECT id FROM latest_review)),
			'objective_achievement', (SELECT json_build_object(
				'total', COUNT(*),
				'achieved', COUNT(*) FILTER (WHERE achieved),
				'not_achieved', COUNT(*) FILTER (WHERE NOT achieved)
			) FROM public.internal_pilot_objective_results),
			'risk_summary', (SELECT json_build_object(
				'financial_high_or_critical', COUNT(*) FILTER (WHERE category = 'financial' AND severity IN ('high', 'critical')),
				'compliance_high_or_critical', COUNT(*) FILTER (WHERE category = 'compliance' AND severity IN ('high', 'critical')),
				'safety_high_or_critical', COUNT(*) FILTER (WHERE category = 'safety' AND severity IN ('high', 'critical'))
			) FROM public.internal_pilot_review_findings WHERE board_review_id = (SELECT id FROM latest_review)),
			'board_recommendation',
				CASE
					WHEN EXISTS (SELECT 1 FROM public.internal_pilot_review_findings WHERE board_review_id = (SELECT id FROM latest_review) AND severity = 'critical') THEN 'rejected_public_pilot_blocked'
					WHEN EXISTS (SELECT 1 FROM public.internal_pilot_readiness_assessments WHERE board_review_id = (SELECT id FROM latest_review) AND NOT passed AND score + 10 < target_score) THEN 'defer_remain_internal_pilot'
					WHEN EXISTS (SELECT 1 FROM public.internal_pilot_review_findings WHERE board_review_id = (SELECT id FROM latest_review) AND severity IN ('low', 'medium', 'high')) THEN 'conditional_or_deferred_review_required'
					WHEN EXISTS (SELECT 1 FROM public.internal_pilot_objective_results WHERE NOT achieved) THEN 'conditional_objectives_not_met'
					ELSE 'eligible_for_v2_3_a_limited_public_wallet_pilot_review'
				END,
			'public_launch_approved', false
		)
	`)
	if err != nil {
		return nil, err
	}
	return rawToMap(raw)
}

func (r *PostgresReports) PublicWalletPilotReport(ctx context.Context) (map[string]any, error) {
	raw, err := queryJSON(ctx, r.db, `
		WITH latest_program AS (
			SELECT *
			FROM public.wallet_pilot_programs
			ORDER BY created_at DESC
			LIMIT 1
		)
		SELECT json_build_object(
			'program', (SELECT json_build_object(
				'id', id,
				'program_name', program_name,
				'city', city,
				'status', status,
				'participant_limit', participant_limit,
				'driver_limit', driver_limit,
				'wallet_balance_limit_minor', wallet_balance_limit_minor,
				'daily_transaction_limit_minor', daily_transaction_limit_minor,
				'monthly_transaction_limit_minor', monthly_transaction_limit_minor,
				'start_date', start_date,
				'end_date', end_date
			) FROM latest_program),
			'participant_counts', (SELECT json_build_object(
				'active_total', COUNT(*) FILTER (WHERE status = 'active'),
				'active_riders', COUNT(*) FILTER (WHERE status = 'active' AND participant_type = 'rider'),
				'active_drivers', COUNT(*) FILTER (WHERE status = 'active' AND participant_type = 'driver'),
				'suspended', COUNT(*) FILTER (WHERE status = 'suspended'),
				'removed', COUNT(*) FILTER (WHERE status = 'removed')
			) FROM public.wallet_pilot_participants WHERE program_id = (SELECT id FROM latest_program)),
			'transaction_volume', (SELECT json_build_object(
				'total_transactions', COUNT(*),
				'recorded_transactions', COUNT(*) FILTER (WHERE status = 'recorded'),
				'total_amount_minor', COALESCE(SUM(amount_minor), 0)
			) FROM public.wallet_pilot_transactions WHERE program_id = (SELECT id FROM latest_program)),
			'reconciliation_status', (SELECT json_build_object(
				'latest_status', (SELECT status FROM public.wallet_pilot_reconciliation_reports WHERE program_id = (SELECT id FROM latest_program) ORDER BY report_date DESC, created_at DESC LIMIT 1),
				'variance_reports', COUNT(*) FILTER (WHERE status IN ('variance_detected', 'investigating')),
				'latest_wallet_balance_minor', (SELECT wallet_balance_minor FROM public.wallet_pilot_reconciliation_reports WHERE program_id = (SELECT id FROM latest_program) ORDER BY report_date DESC, created_at DESC LIMIT 1),
				'latest_ledger_balance_minor', (SELECT ledger_balance_minor FROM public.wallet_pilot_reconciliation_reports WHERE program_id = (SELECT id FROM latest_program) ORDER BY report_date DESC, created_at DESC LIMIT 1)
			) FROM public.wallet_pilot_reconciliation_reports WHERE program_id = (SELECT id FROM latest_program)),
			'fraud_events', (SELECT json_build_object(
				'total', COUNT(*),
				'critical', COUNT(*) FILTER (WHERE severity = 'critical'),
				'open', COUNT(*) FILTER (WHERE status IN ('open', 'investigating'))
			) FROM public.wallet_pilot_fraud_events WHERE program_id = (SELECT id FROM latest_program)),
			'kill_switch_status', (SELECT COALESCE(json_agg(json_build_object('control', control, 'status', status, 'reason', reason)), '[]'::json) FROM public.wallet_pilot_kill_switches WHERE program_id = (SELECT id FROM latest_program)),
			'pilot_readiness',
				CASE
					WHEN EXISTS (SELECT 1 FROM public.wallet_pilot_fraud_events WHERE program_id = (SELECT id FROM latest_program) AND severity = 'critical' AND status IN ('open', 'investigating')) THEN 'not_ready_critical_fraud_open'
					WHEN EXISTS (SELECT 1 FROM public.wallet_pilot_reconciliation_reports WHERE program_id = (SELECT id FROM latest_program) AND status IN ('variance_detected', 'investigating')) THEN 'not_ready_reconciliation_variance'
					ELSE 'gwanda_pilot_ready_for_controlled_operation'
				END,
			'public_launch_approved', false
		)
	`)
	if err != nil {
		return nil, err
	}
	return rawToMap(raw)
}

func (r *PostgresReports) PublicWalletPilotParticipants(ctx context.Context, limit int) ([]map[string]any, error) {
	return r.simpleFinanceRows(ctx, `
		SELECT json_build_object(
			'id', id,
			'program_id', program_id,
			'user_id', user_id,
			'participant_type', participant_type,
			'status', status,
			'enrolled_at', enrolled_at,
			'enrolled_by', enrolled_by
		)
		FROM public.wallet_pilot_participants
		ORDER BY enrolled_at DESC
		LIMIT $1
	`, limit)
}

func (r *PostgresReports) PublicWalletPilotTransactions(ctx context.Context, limit int) ([]map[string]any, error) {
	return r.simpleFinanceRows(ctx, `
		SELECT json_build_object(
			'id', id,
			'program_id', program_id,
			'wallet_id', wallet_id,
			'user_id', user_id,
			'transaction_type', transaction_type,
			'amount_minor', amount_minor,
			'currency', currency,
			'status', status,
			'evidence_id', evidence_id,
			'created_at', created_at
		)
		FROM public.wallet_pilot_transactions
		ORDER BY created_at DESC
		LIMIT $1
	`, limit)
}

func (r *PostgresReports) PublicWalletPilotReconciliation(ctx context.Context, limit int) ([]map[string]any, error) {
	return r.simpleFinanceRows(ctx, `
		SELECT json_build_object(
			'id', id,
			'program_id', program_id,
			'report_date', report_date,
			'ledger_balance_minor', ledger_balance_minor,
			'wallet_balance_minor', wallet_balance_minor,
			'transaction_history_balance_minor', transaction_history_balance_minor,
			'variance_minor', variance_minor,
			'currency', currency,
			'status', status,
			'created_at', created_at
		)
		FROM public.wallet_pilot_reconciliation_reports
		ORDER BY report_date DESC, created_at DESC
		LIMIT $1
	`, limit)
}

func (r *PostgresReports) PublicWalletPilotFraud(ctx context.Context, limit int) ([]map[string]any, error) {
	return r.simpleFinanceRows(ctx, `
		SELECT json_build_object(
			'id', id,
			'program_id', program_id,
			'user_id', user_id,
			'event_type', event_type,
			'severity', severity,
			'description', description,
			'status', status,
			'created_at', created_at
		)
		FROM public.wallet_pilot_fraud_events
		ORDER BY created_at DESC
		LIMIT $1
	`, limit)
}

func (r *PostgresReports) PublicWalletPilotEvidence(ctx context.Context) (map[string]any, error) {
	raw, err := queryJSON(ctx, r.db, `
		WITH latest_program AS (
			SELECT *
			FROM public.wallet_pilot_programs
			ORDER BY created_at DESC
			LIMIT 1
		),
		tx AS (
			SELECT *
			FROM public.wallet_pilot_transactions
			WHERE program_id = (SELECT id FROM latest_program)
		)
		SELECT json_build_object(
			'city', (SELECT city FROM latest_program),
			'participation', (SELECT json_build_object(
				'active_participants', COUNT(*) FILTER (WHERE status = 'active'),
				'active_riders', COUNT(*) FILTER (WHERE status = 'active' AND participant_type = 'rider'),
				'active_drivers', COUNT(*) FILTER (WHERE status = 'active' AND participant_type = 'driver')
			) FROM public.wallet_pilot_participants WHERE program_id = (SELECT id FROM latest_program)),
			'payments', (SELECT json_build_object(
				'deposits', COUNT(*) FILTER (WHERE transaction_type = 'deposit'),
				'ride_payments', COUNT(*) FILTER (WHERE transaction_type = 'ride_payment'),
				'refunds', COUNT(*) FILTER (WHERE transaction_type = 'refund'),
				'adjustments', COUNT(*) FILTER (WHERE transaction_type = 'adjustment'),
				'total_amount_minor', COALESCE(SUM(amount_minor), 0),
				'wallet_success_rate',
					CASE WHEN COUNT(*) = 0 THEN 0 ELSE (COUNT(*) FILTER (WHERE status = 'recorded') * 100 / COUNT(*)) END
			) FROM tx),
			'reconciliation', (SELECT json_build_object(
				'ledger_accuracy',
					CASE WHEN EXISTS (SELECT 1 FROM public.wallet_pilot_reconciliation_reports WHERE program_id = (SELECT id FROM latest_program) AND status IN ('variance_detected', 'investigating')) THEN 0 ELSE 100 END,
				'unresolved_variances', COUNT(*) FILTER (WHERE status IN ('variance_detected', 'investigating'))
			) FROM public.wallet_pilot_reconciliation_reports WHERE program_id = (SELECT id FROM latest_program)),
			'fraud', (SELECT json_build_object(
				'critical_fraud_events', COUNT(*) FILTER (WHERE severity = 'critical'),
				'open_critical_fraud_events', COUNT(*) FILTER (WHERE severity = 'critical' AND status IN ('open', 'investigating'))
			) FROM public.wallet_pilot_fraud_events WHERE program_id = (SELECT id FROM latest_program)),
			'readiness_recommendation',
				CASE
					WHEN EXISTS (SELECT 1 FROM public.wallet_pilot_fraud_events WHERE program_id = (SELECT id FROM latest_program) AND severity = 'critical' AND status IN ('open', 'investigating')) THEN 'remain_in_gwanda_critical_fraud_open'
					WHEN EXISTS (SELECT 1 FROM public.wallet_pilot_reconciliation_reports WHERE program_id = (SELECT id FROM latest_program) AND status IN ('variance_detected', 'investigating')) THEN 'remain_in_gwanda_reconciliation_variance'
					ELSE 'gwanda_wallet_pilot_ready_when_success_criteria_confirmed'
				END,
			'public_launch_approved', false
		)
	`)
	if err != nil {
		return nil, err
	}
	return rawToMap(raw)
}

func (r *PostgresReports) simpleFinanceRows(ctx context.Context, sql string, limit int) ([]map[string]any, error) {
	rows, err := queryJSONRows(ctx, r.db, sql, limit)
	return rawRowsToMaps(rows, err)
}

func (r *PostgresReports) PilotSummary(ctx context.Context) (map[string]any, error) {
	raw, err := queryJSON(ctx, r.db, `
		SELECT json_build_object(
			'pilot_users', (SELECT COUNT(*) FROM public.pilot_wallet_users WHERE status = 'enabled'),
			'pilot_riders', (SELECT COUNT(*) FROM public.pilot_wallet_users WHERE status = 'enabled' AND role = 'pilot_rider'),
			'pilot_drivers', (SELECT COUNT(*) FROM public.pilot_wallet_users WHERE status = 'enabled' AND role = 'pilot_driver'),
			'pilot_admins', (SELECT COUNT(*) FROM public.pilot_wallet_users WHERE status = 'enabled' AND role = 'pilot_admin'),
			'total_wallet_rides', (SELECT COUNT(*) FROM public.settlement_records WHERE payment_method = 'wallet' AND settlement_mode = 'active'),
			'successful_settlements', (SELECT COUNT(*) FROM public.settlement_records WHERE payment_method = 'wallet' AND settlement_mode = 'active' AND status = 'settled'),
			'failed_settlements', (SELECT COUNT(*) FROM public.settlement_records WHERE payment_method = 'wallet' AND status = 'failed'),
			'authorization_failures', (SELECT COUNT(*) FROM public.wallet_authorizations WHERE status = 'failed'),
			'reconciliation_failures', (SELECT COUNT(*) FROM public.reconciliation_runs WHERE status = 'requires_review'),
			'liability_events', (SELECT COUNT(*) FROM public.settlement_records WHERE payment_method = 'cash' AND settlement_mode = 'active' AND status = 'liability_recorded'),
			'deposit_approvals', (SELECT COUNT(*) FROM public.wallet_admin_actions WHERE action = 'approve_deposit'),
			'withdrawal_approvals', (SELECT COUNT(*) FROM public.wallet_admin_actions WHERE action = 'approve_withdrawal')
		)
	`)
	if err != nil {
		return nil, err
	}
	return rawToMap(raw)
}

func (r *PostgresReports) PilotUsers(ctx context.Context, limit int) ([]map[string]any, error) {
	rows, err := queryJSONRows(ctx, r.db, `
		SELECT json_build_object(
			'id', id,
			'user_id', user_id,
			'role', role,
			'status', status,
			'group_name', group_name,
			'enabled_by', enabled_by,
			'disabled_by', disabled_by,
			'suspended_by', suspended_by,
			'removed_by', removed_by,
			'reason', reason,
			'created_at', created_at,
			'updated_at', updated_at
		)
		FROM public.pilot_wallet_users
		ORDER BY updated_at DESC
		LIMIT $1
	`, limit)
	return rawRowsToMaps(rows, err)
}

func (r *PostgresReports) PilotFailures(ctx context.Context, limit int) ([]map[string]any, error) {
	rows, err := queryJSONRows(ctx, r.db, `
		WITH failures AS (
			SELECT
				created_at,
				json_build_object('type', 'failed_settlement', 'ride_id', ride_id, 'status', status, 'error', error, 'created_at', created_at) AS payload
			FROM public.settlement_records
			WHERE status = 'failed'
			UNION ALL
			SELECT
				created_at,
				json_build_object('type', 'failed_authorization', 'ride_id', ride_id, 'status', status, 'error', failure_reason, 'created_at', created_at) AS payload
			FROM public.wallet_authorizations
			WHERE status = 'failed'
		)
		SELECT payload
		FROM failures
		ORDER BY created_at DESC
		LIMIT $1
	`, limit)
	return rawRowsToMaps(rows, err)
}

func (r *PostgresReports) PilotReconciliation(ctx context.Context, limit int) ([]map[string]any, error) {
	rows, err := queryJSONRows(ctx, r.db, `
		SELECT json_build_object(
			'id', id,
			'provider', provider,
			'run_type', run_type,
			'status', status,
			'matched_count', matched_count,
			'mismatch_count', mismatch_count,
			'missing_provider_count', missing_provider_count,
			'missing_ledger_count', missing_ledger_count,
			'started_at', started_at,
			'completed_at', completed_at
		)
		FROM public.reconciliation_runs
		ORDER BY started_at DESC
		LIMIT $1
	`, limit)
	return rawRowsToMaps(rows, err)
}

type PostgresReports struct {
	db DB
}

func NewPostgresReports(db DB) *PostgresReports {
	return &PostgresReports{db: db}
}

func RegisterAdminRoutes(app fiber.Router, reports ReportReader, requireAuth fiber.Handler) {
	app.Get("/admin/wallets/shadow-settlements/summary", requireAuth, middleware.AdminOnly(), shadowSettlementSummaryHandler(reports))
	app.Get("/admin/wallets/shadow-settlements/recent", requireAuth, middleware.AdminOnly(), recentShadowSettlementsHandler(reports))
	app.Get("/admin/wallets/shadow-settlements/failed", requireAuth, middleware.AdminOnly(), failedShadowSettlementsHandler(reports))
	app.Get("/admin/wallets/active-settlements/summary", requireAuth, middleware.AdminOnly(), activeSettlementSummaryHandler(reports))
	app.Get("/admin/wallets/driver-liabilities", requireAuth, middleware.AdminOnly(), driverLiabilitiesHandler(reports))
	app.Get("/admin/wallets/active-settlements/failed", requireAuth, middleware.AdminOnly(), failedActiveSettlementsHandler(reports))
}

func (r *PostgresReports) ShadowSettlementSummary(ctx context.Context, days int) (json.RawMessage, error) {
	return queryJSON(ctx, r.db, `
		SELECT json_build_object(
			'total_shadow_settlements', COUNT(*),
			'posted_shadow_settlements', COUNT(*) FILTER (WHERE status = 'posted'),
			'failed_shadow_settlements', COUNT(*) FILTER (WHERE status = 'failed'),
			'total_fare', COALESCE(SUM(fare), 0),
			'total_platform_fee', COALESCE(SUM(platform_fee), 0),
			'total_driver_earning', COALESCE(SUM(driver_earning), 0),
			'cash_settlements', COUNT(*) FILTER (WHERE payment_method = 'cash'),
			'wallet_settlements', COUNT(*) FILTER (WHERE payment_method = 'wallet')
		)
		FROM public.settlement_records
		WHERE settlement_mode = 'shadow'
		  AND created_at >= NOW() - ($1::int * INTERVAL '1 day')
	`, days)
}

func (r *PostgresReports) RecentShadowSettlements(ctx context.Context, limit int) ([]json.RawMessage, error) {
	return queryJSONRows(ctx, r.db, `
		SELECT json_build_object(
			'id', id,
			'ride_id', ride_id,
			'driver_id', driver_id,
			'rider_id', rider_id,
			'fare', fare,
			'platform_fee', platform_fee,
			'driver_earning', driver_earning,
			'payment_method', payment_method,
			'status', status,
			'wallet_transaction_id', wallet_transaction_id,
			'error', error,
			'created_at', created_at
		)
		FROM public.settlement_records
		WHERE settlement_mode = 'shadow'
		ORDER BY created_at DESC
		LIMIT $1
	`, limit)
}

func (r *PostgresReports) FailedShadowSettlements(ctx context.Context, limit int) ([]json.RawMessage, error) {
	return queryJSONRows(ctx, r.db, `
		SELECT json_build_object(
			'id', id,
			'ride_id', ride_id,
			'payment_method', payment_method,
			'status', status,
			'error', error,
			'created_at', created_at
		)
		FROM public.settlement_records
		WHERE settlement_mode = 'shadow'
		  AND status = 'failed'
		ORDER BY created_at DESC
		LIMIT $1
	`, limit)
}

func (r *PostgresReports) ActiveSettlementSummary(ctx context.Context, days int) (json.RawMessage, error) {
	return queryJSON(ctx, r.db, `
		SELECT json_build_object(
			'total_active_cash_settlements', COUNT(*),
			'settled_cash_settlements', COUNT(*) FILTER (WHERE status = 'settled'),
			'liability_recorded_cash_settlements', COUNT(*) FILTER (WHERE status = 'liability_recorded'),
			'failed_cash_settlements', COUNT(*) FILTER (WHERE status = 'failed'),
			'processing_cash_settlements', COUNT(*) FILTER (WHERE status = 'processing'),
			'total_fare', COALESCE(SUM(fare), 0),
			'total_platform_fee', COALESCE(SUM(platform_fee), 0),
			'collected_platform_fee', COALESCE(SUM(platform_fee) FILTER (WHERE status = 'settled'), 0),
			'liability_platform_fee', COALESCE(SUM(platform_fee) FILTER (WHERE status = 'liability_recorded'), 0)
		)
		FROM public.settlement_records
		WHERE settlement_mode = 'active'
		  AND payment_method = 'cash'
		  AND created_at >= NOW() - ($1::int * INTERVAL '1 day')
	`, days)
}

func (r *PostgresReports) DriverLiabilities(ctx context.Context, limit int) ([]json.RawMessage, error) {
	return queryJSONRows(ctx, r.db, `
		SELECT json_build_object(
			'driver_id', a.owner_user_id,
			'currency', a.currency,
			'cash_liability_balance', a.cached_liability_balance,
			'liability_settlements', COALESCE(s.liability_settlements, 0),
			'oldest_liability_at', s.oldest_liability_at,
			'latest_liability_at', s.latest_liability_at
		)
		FROM public.wallet_accounts a
		LEFT JOIN LATERAL (
			SELECT
				COUNT(*) AS liability_settlements,
				MIN(created_at) AS oldest_liability_at,
				MAX(created_at) AS latest_liability_at
			FROM public.settlement_records sr
			WHERE sr.driver_id = a.owner_user_id
			  AND sr.payment_method = 'cash'
			  AND sr.settlement_mode = 'active'
			  AND sr.status = 'liability_recorded'
		) s ON true
		WHERE a.account_type = 'cash_liability_wallet'
		  AND a.cached_liability_balance > 0
		ORDER BY a.cached_liability_balance DESC, latest_liability_at ASC NULLS LAST
		LIMIT $1
	`, limit)
}

func (r *PostgresReports) FailedActiveSettlements(ctx context.Context, limit int) ([]json.RawMessage, error) {
	return queryJSONRows(ctx, r.db, `
		SELECT json_build_object(
			'id', id,
			'ride_id', ride_id,
			'driver_id', driver_id,
			'rider_id', rider_id,
			'fare', fare,
			'platform_fee', platform_fee,
			'payment_method', payment_method,
			'status', status,
			'idempotency_key', idempotency_key,
			'error', error,
			'created_at', created_at,
			'updated_at', updated_at
		)
		FROM public.settlement_records
		WHERE settlement_mode = 'active'
		  AND payment_method = 'cash'
		  AND status = 'failed'
		ORDER BY updated_at DESC
		LIMIT $1
	`, limit)
}

func shadowSettlementSummaryHandler(reports ReportReader) fiber.Handler {
	return func(c *fiber.Ctx) error {
		result, err := reports.ShadowSettlementSummary(middleware.RequestContext(c), daysParam(c, 7))
		return jsonResponse(c, result, err)
	}
}

func recentShadowSettlementsHandler(reports ReportReader) fiber.Handler {
	return func(c *fiber.Ctx) error {
		rows, err := reports.RecentShadowSettlements(middleware.RequestContext(c), limitParam(c, 50))
		return jsonRowsResponse(c, rows, err)
	}
}

func failedShadowSettlementsHandler(reports ReportReader) fiber.Handler {
	return func(c *fiber.Ctx) error {
		rows, err := reports.FailedShadowSettlements(middleware.RequestContext(c), limitParam(c, 50))
		return jsonRowsResponse(c, rows, err)
	}
}

func activeSettlementSummaryHandler(reports ReportReader) fiber.Handler {
	return func(c *fiber.Ctx) error {
		result, err := reports.ActiveSettlementSummary(middleware.RequestContext(c), daysParam(c, 7))
		return jsonResponse(c, result, err)
	}
}

func driverLiabilitiesHandler(reports ReportReader) fiber.Handler {
	return func(c *fiber.Ctx) error {
		rows, err := reports.DriverLiabilities(middleware.RequestContext(c), limitParam(c, 100))
		return jsonRowsResponse(c, rows, err)
	}
}

func failedActiveSettlementsHandler(reports ReportReader) fiber.Handler {
	return func(c *fiber.Ctx) error {
		rows, err := reports.FailedActiveSettlements(middleware.RequestContext(c), limitParam(c, 50))
		return jsonRowsResponse(c, rows, err)
	}
}

func queryJSON(ctx context.Context, db DB, sql string, args ...any) (json.RawMessage, error) {
	var payload []byte
	if err := db.QueryRow(ctx, sql, args...).Scan(&payload); err != nil {
		return nil, err
	}
	return json.RawMessage(payload), nil
}

func queryJSONRows(ctx context.Context, db DB, sql string, args ...any) ([]json.RawMessage, error) {
	rows, err := db.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var results []json.RawMessage
	for rows.Next() {
		var payload []byte
		if err := rows.Scan(&payload); err != nil {
			return nil, err
		}
		results = append(results, json.RawMessage(payload))
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if results == nil {
		results = []json.RawMessage{}
	}
	return results, nil
}

func jsonResponse(c *fiber.Ctx, result json.RawMessage, err error) error {
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	c.Set(fiber.HeaderContentType, fiber.MIMEApplicationJSONCharsetUTF8)
	return c.Send(result)
}

func jsonRowsResponse(c *fiber.Ctx, rows []json.RawMessage, err error) error {
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(rows)
}

func daysParam(c *fiber.Ctx, fallback int) int {
	return positiveInt(c.Query("days"), fallback, 365)
}

func limitParam(c *fiber.Ctx, fallback int) int {
	return positiveInt(c.Query("limit"), fallback, 500)
}

func positiveInt(value string, fallback int, max int) int {
	if value == "" {
		return fallback
	}
	parsed, err := strconv.Atoi(value)
	if err != nil || parsed <= 0 {
		return fallback
	}
	if parsed > max {
		return max
	}
	return parsed
}

func rawRowsToMaps(rows []json.RawMessage, err error) ([]map[string]any, error) {
	if err != nil {
		return nil, err
	}
	results := make([]map[string]any, 0, len(rows))
	for _, row := range rows {
		item, err := rawToMap(row)
		if err != nil {
			return nil, err
		}
		results = append(results, item)
	}
	return results, nil
}

func rawToMap(row json.RawMessage) (map[string]any, error) {
	var item map[string]any
	if err := json.Unmarshal(row, &item); err != nil {
		return nil, err
	}
	return item, nil
}
