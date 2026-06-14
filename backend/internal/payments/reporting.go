package payments

import (
	"context"
	"encoding/json"

	"pickme-backend/internal/wallet"
)

type Reports struct {
	db wallet.DB
}

func NewReports(db wallet.DB) *Reports {
	return &Reports{db: db}
}

func (r *Reports) OneMoneySummary(ctx context.Context) (map[string]any, error) {
	return r.providerSummary(ctx, ProviderOneMoney)
}

func (r *Reports) EcoCashSummary(ctx context.Context) (map[string]any, error) {
	return r.providerSummary(ctx, ProviderEcoCash)
}

func (r *Reports) InnbucksSummary(ctx context.Context) (map[string]any, error) {
	return r.providerSummary(ctx, ProviderInnbucks)
}

func (r *Reports) CardSummary(ctx context.Context) (map[string]any, error) {
	return r.providerSummary(ctx, ProviderCard)
}

func (r *Reports) PayPalSummary(ctx context.Context) (map[string]any, error) {
	return r.providerSummary(ctx, ProviderPayPal)
}

func (r *Reports) providerSummary(ctx context.Context, provider string) (map[string]any, error) {
	raw, err := queryJSON(ctx, r.db, `
		SELECT json_build_object(
			'total_intents', (SELECT COUNT(*) FROM public.payment_intents WHERE provider = $1),
			'pending_intents', (SELECT COUNT(*) FROM public.payment_intents WHERE provider = $1 AND status = 'pending_provider_payment'),
			'completed_intents', (SELECT COUNT(*) FROM public.payment_intents WHERE provider = $1 AND status = 'completed'),
			'failed_events', (SELECT COUNT(*) FROM public.provider_events WHERE provider = $1 AND status IN ('failed', 'ignored')),
			'processed_events', (SELECT COUNT(*) FROM public.provider_events WHERE provider = $1 AND status = 'processed'),
			'duplicate_events', (SELECT COUNT(*) FROM public.provider_events WHERE provider = $1 AND status = 'duplicate'),
			'total_completed_amount', (SELECT COALESCE(SUM(amount), 0) FROM public.payment_intents WHERE provider = $1 AND status = 'completed'),
			'reconciliation_runs_requiring_review', (SELECT COUNT(*) FROM public.reconciliation_runs WHERE provider = $1 AND status = 'requires_review')
		)
	`, provider)
	if err != nil {
		return nil, err
	}
	return rawToMap(raw)
}

func (r *Reports) OneMoneyTransactions(ctx context.Context, limit int) ([]map[string]any, error) {
	return r.providerTransactions(ctx, ProviderOneMoney, limit)
}

func (r *Reports) EcoCashTransactions(ctx context.Context, limit int) ([]map[string]any, error) {
	return r.providerTransactions(ctx, ProviderEcoCash, limit)
}

func (r *Reports) InnbucksTransactions(ctx context.Context, limit int) ([]map[string]any, error) {
	return r.providerTransactions(ctx, ProviderInnbucks, limit)
}

func (r *Reports) CardTransactions(ctx context.Context, limit int) ([]map[string]any, error) {
	return r.providerTransactions(ctx, ProviderCard, limit)
}

func (r *Reports) PayPalTransactions(ctx context.Context, limit int) ([]map[string]any, error) {
	return r.providerTransactions(ctx, ProviderPayPal, limit)
}

func (r *Reports) providerTransactions(ctx context.Context, provider string, limit int) ([]map[string]any, error) {
	rows, err := queryJSONRows(ctx, r.db, `
		SELECT json_build_object(
			'id', id,
			'user_id', user_id,
			'amount', amount,
			'currency', currency,
			'provider_reference', provider_reference,
			'status', status,
			'wallet_transaction_id', wallet_transaction_id,
			'created_at', created_at,
			'updated_at', updated_at
		)
		FROM public.payment_intents
		WHERE provider = $1
		ORDER BY created_at DESC
		LIMIT $2
	`, provider, limit)
	return rawRowsToMaps(rows, err)
}

func (r *Reports) OneMoneyReconciliation(ctx context.Context, limit int) ([]map[string]any, error) {
	return r.providerReconciliation(ctx, ProviderOneMoney, limit)
}

func (r *Reports) EcoCashReconciliation(ctx context.Context, limit int) ([]map[string]any, error) {
	return r.providerReconciliation(ctx, ProviderEcoCash, limit)
}

func (r *Reports) InnbucksReconciliation(ctx context.Context, limit int) ([]map[string]any, error) {
	return r.providerReconciliation(ctx, ProviderInnbucks, limit)
}

func (r *Reports) CardReconciliation(ctx context.Context, limit int) ([]map[string]any, error) {
	return r.providerReconciliation(ctx, ProviderCard, limit)
}

func (r *Reports) PayPalReconciliation(ctx context.Context, limit int) ([]map[string]any, error) {
	return r.providerReconciliation(ctx, ProviderPayPal, limit)
}

func (r *Reports) providerReconciliation(ctx context.Context, provider string, limit int) ([]map[string]any, error) {
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
		WHERE provider = $1
		ORDER BY started_at DESC
		LIMIT $2
	`, provider, limit)
	return rawRowsToMaps(rows, err)
}

func (r *Reports) OneMoneyFailures(ctx context.Context, limit int) ([]map[string]any, error) {
	return r.providerFailures(ctx, ProviderOneMoney, limit)
}

func (r *Reports) EcoCashFailures(ctx context.Context, limit int) ([]map[string]any, error) {
	return r.providerFailures(ctx, ProviderEcoCash, limit)
}

func (r *Reports) InnbucksFailures(ctx context.Context, limit int) ([]map[string]any, error) {
	return r.providerFailures(ctx, ProviderInnbucks, limit)
}

func (r *Reports) CardFailures(ctx context.Context, limit int) ([]map[string]any, error) {
	return r.providerFailures(ctx, ProviderCard, limit)
}

func (r *Reports) PayPalFailures(ctx context.Context, limit int) ([]map[string]any, error) {
	return r.providerFailures(ctx, ProviderPayPal, limit)
}

func (r *Reports) providerFailures(ctx context.Context, provider string, limit int) ([]map[string]any, error) {
	rows, err := queryJSONRows(ctx, r.db, `
		WITH failures AS (
			SELECT
				received_at AS at,
				json_build_object(
					'type', 'provider_event',
					'provider_event_id', provider_event_id,
					'provider_reference', provider_reference,
					'event_type', event_type,
					'signature_valid', signature_valid,
					'status', status,
					'received_at', received_at
				) AS payload
			FROM public.provider_events
			WHERE provider = $1
			  AND status IN ('failed', 'ignored')
			UNION ALL
			SELECT
				updated_at AS at,
				json_build_object(
					'type', 'payment_intent',
					'id', id,
					'provider_reference', provider_reference,
					'status', status,
					'updated_at', updated_at
				) AS payload
			FROM public.payment_intents
			WHERE provider = $1
			  AND status IN ('failed', 'rejected', 'expired')
		)
		SELECT payload
		FROM failures
		ORDER BY at DESC
		LIMIT $2
	`, provider, limit)
	return rawRowsToMaps(rows, err)
}

func queryJSON(ctx context.Context, db wallet.DB, sql string, args ...any) (json.RawMessage, error) {
	var payload []byte
	if err := db.QueryRow(ctx, sql, args...).Scan(&payload); err != nil {
		return nil, err
	}
	return json.RawMessage(payload), nil
}

func queryJSONRows(ctx context.Context, db wallet.DB, sql string, args ...any) ([]json.RawMessage, error) {
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
