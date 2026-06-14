package wallet

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

type DB interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

type transactionalDB interface {
	DB
	Begin(ctx context.Context) (pgx.Tx, error)
}

type AccountRepository interface {
	CreateAccount(ctx context.Context, account Account) error
	EnsureAccount(ctx context.Context, account Account) (Account, error)
	GetAccount(ctx context.Context, accountID string) (Account, error)
}

type TransactionRepository interface {
	CreateTransaction(ctx context.Context, transaction Transaction) error
	GetTransactionByIdempotencyKey(ctx context.Context, key string) (Transaction, error)
}

type LedgerRepository interface {
	PostLedgerEntries(ctx context.Context, transaction Transaction, entries []LedgerEntry) error
}

type ReconciliationRepository interface {
	CreateReconciliationRun(ctx context.Context, run ReconciliationRun) error
}

type FinancialJobRepository interface {
	CreateFinancialJob(ctx context.Context, job FinancialJob) error
	RecordFinancialMetric(ctx context.Context, metric FinancialMetric) error
}

type SettlementRepository interface {
	CreateSettlementRecord(ctx context.Context, settlement SettlementRecord) error
}

type AdminFlowRepository interface {
	CreateDepositRequest(ctx context.Context, intent PaymentIntent) error
	GetDepositRequest(ctx context.Context, id string) (PaymentIntent, error)
	ApproveDepositRequest(ctx context.Context, id string, adminID string, transactionID string) (PaymentIntent, error)
	RejectDepositRequest(ctx context.Context, id string, adminID string, reason string) (PaymentIntent, error)
	CreateWithdrawalRequest(ctx context.Context, withdrawal WithdrawalRequest) error
	GetWithdrawalRequest(ctx context.Context, id string) (WithdrawalRequest, error)
	ApproveWithdrawalRequest(ctx context.Context, id string, adminID string, transactionID string) (WithdrawalRequest, error)
	RejectWithdrawalRequest(ctx context.Context, id string, adminID string, reason string) (WithdrawalRequest, error)
	CreateAdminAction(ctx context.Context, action AdminAction) error
}

type PostgresRepository struct {
	db DB
}

func NewPostgresRepository(db DB) *PostgresRepository {
	return &PostgresRepository{db: db}
}

func (r *PostgresRepository) CreateAccount(ctx context.Context, account Account) error {
	if err := ValidateAccount(account); err != nil {
		return err
	}
	_, err := r.db.Exec(ctx, `
		INSERT INTO public.wallet_accounts (
			id,
			owner_user_id,
			owner_role,
			account_type,
			currency,
			status,
			cached_available_balance,
			cached_pending_balance,
			cached_liability_balance,
			created_at,
			updated_at
		)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW(),NOW())
		ON CONFLICT (id)
		DO UPDATE SET
			owner_user_id = EXCLUDED.owner_user_id,
			owner_role = EXCLUDED.owner_role,
			account_type = EXCLUDED.account_type,
			currency = EXCLUDED.currency,
			status = EXCLUDED.status,
			updated_at = NOW()
	`, nullString(account.ID), nullString(account.OwnerUserID), account.OwnerRole, account.AccountType, account.Currency, defaultString(account.Status, AccountStatusActive), account.CachedAvailableBalanceMinor, account.CachedPendingBalanceMinor, account.CachedLiabilityBalanceMinor)
	return err
}

func (r *PostgresRepository) EnsureAccount(ctx context.Context, account Account) (Account, error) {
	if err := r.CreateAccount(ctx, account); err != nil {
		return Account{}, err
	}
	return r.GetAccount(ctx, account.ID)
}

func (r *PostgresRepository) GetAccount(ctx context.Context, accountID string) (Account, error) {
	var account Account
	err := r.db.QueryRow(ctx, `
		SELECT
			id::text,
			COALESCE(owner_user_id::text, ''),
			owner_role,
			account_type,
			currency,
			status,
			cached_available_balance,
			cached_pending_balance,
			cached_liability_balance,
			created_at,
			updated_at
		FROM public.wallet_accounts
		WHERE id = $1
	`, accountID).Scan(
		&account.ID,
		&account.OwnerUserID,
		&account.OwnerRole,
		&account.AccountType,
		&account.Currency,
		&account.Status,
		&account.CachedAvailableBalanceMinor,
		&account.CachedPendingBalanceMinor,
		&account.CachedLiabilityBalanceMinor,
		&account.CreatedAt,
		&account.UpdatedAt,
	)
	return account, err
}

func (r *PostgresRepository) CreateTransaction(ctx context.Context, transaction Transaction) error {
	if err := ValidateTransaction(transaction); err != nil {
		return err
	}
	_, err := r.db.Exec(ctx, `
		INSERT INTO public.wallet_transactions (
			id,
			transaction_type,
			status,
			idempotency_key,
			currency,
			total_amount,
			source_type,
			source_id,
			owner_user_id,
			ride_id,
			payment_provider,
			payment_intent_id,
			created_by,
			approved_by,
			approved_at,
			created_at,
			updated_at
		)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,NOW(),NOW())
	`, nullString(transaction.ID), transaction.TransactionType, defaultString(transaction.Status, TransactionStatusPending), transaction.IdempotencyKey, transaction.Currency, transaction.TotalAmountMinor, nullString(transaction.SourceType), nullString(transaction.SourceID), nullString(transaction.OwnerUserID), nullString(transaction.RideID), nullString(transaction.PaymentProvider), nullString(transaction.PaymentIntentID), nullString(transaction.CreatedBy), nullString(transaction.ApprovedBy), transaction.ApprovedAt)
	return err
}

func (r *PostgresRepository) GetTransactionByIdempotencyKey(ctx context.Context, key string) (Transaction, error) {
	var transaction Transaction
	err := r.db.QueryRow(ctx, `
		SELECT
			id::text,
			transaction_type,
			status,
			idempotency_key,
			currency,
			total_amount,
			COALESCE(source_type, ''),
			COALESCE(source_id, ''),
			COALESCE(owner_user_id::text, ''),
			COALESCE(ride_id::text, ''),
			COALESCE(payment_provider, ''),
			COALESCE(payment_intent_id::text, ''),
			COALESCE(created_by::text, ''),
			COALESCE(approved_by::text, ''),
			approved_at,
			created_at,
			updated_at
		FROM public.wallet_transactions
		WHERE idempotency_key = $1
	`, key).Scan(
		&transaction.ID,
		&transaction.TransactionType,
		&transaction.Status,
		&transaction.IdempotencyKey,
		&transaction.Currency,
		&transaction.TotalAmountMinor,
		&transaction.SourceType,
		&transaction.SourceID,
		&transaction.OwnerUserID,
		&transaction.RideID,
		&transaction.PaymentProvider,
		&transaction.PaymentIntentID,
		&transaction.CreatedBy,
		&transaction.ApprovedBy,
		&transaction.ApprovedAt,
		&transaction.CreatedAt,
		&transaction.UpdatedAt,
	)
	return transaction, err
}

func (r *PostgresRepository) PostLedgerEntries(ctx context.Context, transaction Transaction, entries []LedgerEntry) error {
	if err := ValidateBalancedTransaction(transaction, entries); err != nil {
		return err
	}
	if db, ok := r.db.(transactionalDB); ok {
		tx, err := db.Begin(ctx)
		if err != nil {
			return err
		}
		defer func() { _ = tx.Rollback(ctx) }()
		if err := insertTransactionInTx(ctx, tx, transaction); err != nil {
			return err
		}
		for _, entry := range entries {
			if err := insertLedgerEntryInTx(ctx, tx, entry); err != nil {
				return err
			}
		}
		return tx.Commit(ctx)
	}
	if err := r.CreateTransaction(ctx, transaction); err != nil {
		return err
	}
	for _, entry := range entries {
		_, err := r.db.Exec(ctx, `
			INSERT INTO public.wallet_ledger_entries (
				id,
				transaction_id,
				account_id,
				entry_type,
				amount,
				currency,
				ride_id,
				source_type,
				source_id,
				payment_provider,
				created_at
			)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())
		`, nullString(entry.ID), transaction.ID, entry.AccountID, entry.EntryType, entry.AmountMinor, entry.Currency, nullString(entry.RideID), nullString(entry.SourceType), nullString(entry.SourceID), nullString(entry.PaymentProvider))
		if err != nil {
			return err
		}
	}
	return nil
}

func (r *PostgresRepository) CreateReconciliationRun(ctx context.Context, run ReconciliationRun) error {
	if !validReconciliationStatus(defaultString(run.Status, "pending")) {
		return ErrInvalidTransactionState
	}
	_, err := r.db.Exec(ctx, `
		INSERT INTO public.reconciliation_runs (
			id,
			provider,
			run_type,
			status,
			started_at,
			completed_at,
			matched_count,
			mismatch_count,
			missing_provider_count,
			missing_ledger_count
		)
		VALUES ($1,$2,$3,$4,NOW(),$5,$6,$7,$8,$9)
	`, nullString(run.ID), nullString(run.Provider), run.RunType, defaultString(run.Status, "pending"), run.CompletedAt, run.MatchedCount, run.MismatchCount, run.MissingProviderCount, run.MissingLedgerCount)
	return err
}

func (r *PostgresRepository) CreateFinancialJob(ctx context.Context, job FinancialJob) error {
	if job.ID == "" {
		job.ID = uuidString("financial-job:" + job.JobType + ":" + job.IdempotencyKey)
	}
	if job.Status == "" {
		job.Status = FinancialJobStatusPending
	}
	if job.MaxAttempts <= 0 {
		job.MaxAttempts = 10
	}
	if job.NextAttemptAt.IsZero() {
		job.NextAttemptAt = time.Now().UTC()
	}
	_, err := r.db.Exec(ctx, `
		INSERT INTO public.financial_jobs (
			id,
			job_type,
			status,
			source_type,
			source_id,
			idempotency_key,
			attempt_count,
			max_attempts,
			next_attempt_at,
			failure_reason,
			metadata,
			created_at,
			updated_at
		)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,NOW(),NOW())
		ON CONFLICT (idempotency_key) DO NOTHING
	`, job.ID, job.JobType, job.Status, nullString(job.SourceType), nullString(job.SourceID), job.IdempotencyKey, job.AttemptCount, job.MaxAttempts, job.NextAttemptAt, nullString(job.FailureReason), defaultString(job.Metadata, "{}"))
	return err
}

func (r *PostgresRepository) LeaseDueFinancialJobs(ctx context.Context, workerID string, now time.Time, limit int, lockFor time.Duration) ([]FinancialJob, error) {
	if workerID == "" {
		workerID = "financial-worker"
	}
	if limit <= 0 {
		limit = 100
	}
	if lockFor <= 0 {
		lockFor = 5 * time.Minute
	}
	rows, err := r.db.Query(ctx, `
		UPDATE public.financial_jobs
		SET status = 'processing',
		    locked_by = $1,
		    locked_until = $2,
		    attempt_count = attempt_count + 1,
		    updated_at = NOW()
		WHERE id IN (
			SELECT id
			FROM public.financial_jobs
			WHERE status IN ('pending', 'failed')
			  AND next_attempt_at <= $3
			  AND (locked_until IS NULL OR locked_until <= $3)
			ORDER BY next_attempt_at ASC, created_at ASC
			LIMIT $4
			FOR UPDATE SKIP LOCKED
		)
		RETURNING
			id::text,
			job_type,
			status,
			COALESCE(source_type, ''),
			COALESCE(source_id, ''),
			idempotency_key,
			attempt_count,
			max_attempts,
			next_attempt_at,
			COALESCE(locked_by, ''),
			locked_until,
			COALESCE(failure_reason, ''),
			metadata::text,
			created_at,
			updated_at
	`, workerID, now.Add(lockFor), now, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	jobs := []FinancialJob{}
	for rows.Next() {
		var job FinancialJob
		if err := rows.Scan(&job.ID, &job.JobType, &job.Status, &job.SourceType, &job.SourceID, &job.IdempotencyKey, &job.AttemptCount, &job.MaxAttempts, &job.NextAttemptAt, &job.LockedBy, &job.LockedUntil, &job.FailureReason, &job.Metadata, &job.CreatedAt, &job.UpdatedAt); err != nil {
			return nil, err
		}
		jobs = append(jobs, job)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return jobs, nil
}

func (r *PostgresRepository) MarkFinancialJobSucceeded(ctx context.Context, id string) error {
	_, err := r.db.Exec(ctx, `
		UPDATE public.financial_jobs
		SET status = 'succeeded',
		    locked_by = NULL,
		    locked_until = NULL,
		    failure_reason = NULL,
		    updated_at = NOW()
		WHERE id = $1
	`, id)
	return err
}

func (r *PostgresRepository) MarkFinancialJobFailed(ctx context.Context, id string, failureReason string, nextAttemptAt time.Time) error {
	if nextAttemptAt.IsZero() {
		nextAttemptAt = time.Now().UTC().Add(time.Minute)
	}
	_, err := r.db.Exec(ctx, `
		UPDATE public.financial_jobs
		SET status = 'failed',
		    locked_by = NULL,
		    locked_until = NULL,
		    failure_reason = $2,
		    next_attempt_at = $3,
		    updated_at = NOW()
		WHERE id = $1
	`, id, nullString(failureReason), nextAttemptAt)
	return err
}

func (r *PostgresRepository) MarkFinancialJobDeadLettered(ctx context.Context, id string, failureReason string) error {
	_, err := r.db.Exec(ctx, `
		UPDATE public.financial_jobs
		SET status = 'dead_lettered',
		    locked_by = NULL,
		    locked_until = NULL,
		    failure_reason = $2,
		    updated_at = NOW()
		WHERE id = $1
	`, id, nullString(failureReason))
	return err
}

func (r *PostgresRepository) CreateRefundIntent(ctx context.Context, refund RefundIntent) (RefundIntent, error) {
	if refund.ID == "" {
		refund.ID = uuidString("refund-intent:" + refund.IdempotencyKey)
	}
	if refund.Status == "" {
		refund.Status = RefundStatusPendingReview
	}
	if _, err := NewPositiveMoneyFromMinor(refund.AmountMinor, refund.Currency); err != nil {
		return RefundIntent{}, err
	}
	_, err := r.db.Exec(ctx, `
		INSERT INTO public.refund_intents (
			id,
			provider,
			user_id,
			original_payment_intent_id,
			original_wallet_transaction_id,
			amount_minor,
			currency,
			status,
			reason,
			idempotency_key,
			created_by,
			metadata,
			created_at,
			updated_at
		)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,NOW(),NOW())
		ON CONFLICT (idempotency_key) DO NOTHING
	`, refund.ID, refund.Provider, nullString(refund.UserID), nullString(refund.OriginalPaymentIntentID), nullString(refund.OriginalWalletTransactionID), MinorDecimalString(refund.AmountMinor, refund.Currency), refund.AmountMinor, refund.Currency, refund.Status, refund.Reason, refund.IdempotencyKey, nullString(refund.CreatedBy), "{}")
	if err != nil {
		return RefundIntent{}, err
	}
	_ = r.CreateFinancialJob(ctx, FinancialJob{JobType: FinancialJobTypeRefundProcessing, Status: FinancialJobStatusPending, SourceType: "refund_intent", SourceID: refund.ID, Provider: refund.Provider, IdempotencyKey: "refund-processing:" + refund.ID, Metadata: "{}"})
	return refund, nil
}

func (r *PostgresRepository) CreateChargeback(ctx context.Context, chargeback ChargebackRecord) (ChargebackRecord, error) {
	if chargeback.ID == "" {
		chargeback.ID = uuidString("chargeback:" + chargeback.Provider + ":" + chargeback.ProviderChargebackID)
	}
	if chargeback.Status == "" {
		chargeback.Status = ChargebackStatusReceived
	}
	if _, err := NewPositiveMoneyFromMinor(chargeback.AmountMinor, chargeback.Currency); err != nil {
		return ChargebackRecord{}, err
	}
	_, err := r.db.Exec(ctx, `
		INSERT INTO public.chargeback_records (
			id,
			provider,
			provider_reference,
			provider_chargeback_id,
			payment_intent_id,
			wallet_transaction_id,
			amount_minor,
			currency,
			status,
			reason,
			metadata,
			created_at,
			updated_at
		)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,NOW(),NOW())
		ON CONFLICT (provider, provider_chargeback_id) DO NOTHING
	`, chargeback.ID, chargeback.Provider, nullString(chargeback.ProviderReference), chargeback.ProviderChargebackID, nullString(chargeback.PaymentIntentID), nullString(chargeback.WalletTransactionID), MinorDecimalString(chargeback.AmountMinor, chargeback.Currency), chargeback.AmountMinor, chargeback.Currency, chargeback.Status, nullString(chargeback.Reason), defaultString(chargeback.Metadata, "{}"))
	if err != nil {
		return ChargebackRecord{}, err
	}
	_ = r.CreateFinancialJob(ctx, FinancialJob{JobType: FinancialJobTypeChargebackProcessing, Status: FinancialJobStatusPending, SourceType: "chargeback_record", SourceID: chargeback.ID, Provider: chargeback.Provider, IdempotencyKey: "chargeback-processing:" + chargeback.ID, Metadata: "{}"})
	return chargeback, nil
}

func (r *PostgresRepository) OpenDispute(ctx context.Context, dispute FinancialDispute) (FinancialDispute, error) {
	if dispute.ID == "" {
		dispute.ID = uuidString(fmt.Sprintf("financial-dispute:%s:%s:%d", dispute.DisputeType, dispute.Reason, time.Now().UnixNano()))
	}
	if dispute.Status == "" {
		dispute.Status = DisputeStatusOpened
	}
	if dispute.AmountMinor > 0 && dispute.Currency != "" {
		if _, err := NewMoneyFromMinor(dispute.AmountMinor, dispute.Currency); err != nil {
			return FinancialDispute{}, err
		}
	}
	_, err := r.db.Exec(ctx, `
		INSERT INTO public.financial_disputes (
			id,
			dispute_type,
			status,
			provider,
			ride_id,
			user_id,
			payment_intent_id,
			wallet_transaction_id,
			amount_minor,
			currency,
			reason,
			opened_by,
			metadata,
			created_at,
			updated_at
		)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,NOW(),NOW())
	`, dispute.ID, dispute.DisputeType, dispute.Status, nullString(dispute.Provider), nullString(dispute.RideID), nullString(dispute.UserID), nullString(dispute.PaymentIntentID), nullString(dispute.WalletTransactionID), MinorDecimalString(dispute.AmountMinor, dispute.Currency), dispute.AmountMinor, nullString(dispute.Currency), dispute.Reason, nullString(dispute.OpenedBy), "{}")
	if err != nil {
		return FinancialDispute{}, err
	}
	_ = r.CreateFinancialJob(ctx, FinancialJob{JobType: FinancialJobTypeDisputeResolution, Status: FinancialJobStatusPending, SourceType: "financial_dispute", SourceID: dispute.ID, Provider: defaultString(dispute.Provider, "internal"), IdempotencyKey: "dispute-resolution:" + dispute.ID, Metadata: "{}"})
	_ = r.RecordFinancialMetric(ctx, FinancialMetric{MetricType: FinancialMetricOpenDispute, Provider: defaultString(dispute.Provider, "internal"), ReferenceType: "financial_dispute", ReferenceID: dispute.ID})
	return dispute, nil
}

func (r *PostgresRepository) UpdateDisputeStatus(ctx context.Context, disputeID string, status string, adminID string, resolution string) (FinancialDispute, error) {
	_, err := r.db.Exec(ctx, `
		UPDATE public.financial_disputes
		SET status = $2,
		    assigned_to = COALESCE(assigned_to, $3),
		    resolution = NULLIF($4, ''),
		    resolved_at = CASE WHEN $2 IN ('resolved_refund', 'resolved_no_change', 'resolved_adjustment', 'closed', 'cancelled') THEN NOW() ELSE resolved_at END,
		    updated_at = NOW()
		WHERE id = $1
	`, disputeID, status, adminID, resolution)
	if err != nil {
		return FinancialDispute{}, err
	}
	return FinancialDispute{ID: disputeID, Status: status, AssignedTo: adminID, Resolution: resolution}, nil
}

func (r *PostgresRepository) CreateFinancialIncident(ctx context.Context, incident FinancialIncident) (FinancialIncident, error) {
	if incident.ID == "" {
		incident.ID = uuidString(fmt.Sprintf("financial-incident:%s:%s:%d", incident.IncidentType, incident.Title, time.Now().UnixNano()))
	}
	if incident.Status == "" {
		incident.Status = IncidentStatusOpened
	}
	_, err := r.db.Exec(ctx, `
		INSERT INTO public.financial_incidents (
			id,
			severity,
			status,
			incident_type,
			provider,
			source_type,
			source_id,
			title,
			description,
			opened_by,
			metadata,
			created_at,
			updated_at
		)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,NOW(),NOW())
	`, incident.ID, incident.Severity, incident.Status, incident.IncidentType, nullString(incident.Provider), nullString(incident.SourceType), nullString(incident.SourceID), incident.Title, nullString(incident.Description), nullString(incident.OpenedBy), "{}")
	if err != nil {
		return FinancialIncident{}, err
	}
	_ = r.CreateFinancialJob(ctx, FinancialJob{JobType: FinancialJobTypeFinancialIncidentReview, Status: FinancialJobStatusPending, SourceType: "financial_incident", SourceID: incident.ID, Provider: defaultString(incident.Provider, "internal"), IdempotencyKey: "financial-incident-review:" + incident.ID, Metadata: "{}"})
	_ = r.RecordFinancialMetric(ctx, FinancialMetric{MetricType: FinancialMetricFinancialIncident, Provider: defaultString(incident.Provider, "internal"), ReferenceType: "financial_incident", ReferenceID: incident.ID})
	return incident, nil
}

func (r *PostgresRepository) ImportProviderStatement(ctx context.Context, req ProviderStatementImportRequest) (ProviderStatementImport, error) {
	if req.ID == "" {
		req.ID = uuidString("provider-statement:" + req.Provider + ":" + req.StatementReference)
	}
	_, err := r.db.Exec(ctx, `
		INSERT INTO public.provider_statement_imports (
			id,
			provider,
			statement_reference,
			status,
			imported_by,
			total_line_count,
			metadata,
			created_at
		)
		VALUES ($1,$2,$3,'pending',$4,$5,$6::jsonb,NOW())
		ON CONFLICT (provider, statement_reference) DO NOTHING
	`, req.ID, req.Provider, req.StatementReference, nullString(req.ImportedBy), len(req.Lines), "{}")
	if err != nil {
		return ProviderStatementImport{}, err
	}
	for _, line := range req.Lines {
		lineID := line.ID
		if lineID == "" {
			lineID = uuidString("provider-statement-line:" + req.Provider + ":" + req.StatementReference + ":" + line.LineReference)
		}
		_, err = r.db.Exec(ctx, `
			INSERT INTO public.provider_statement_lines (
				id,
				import_id,
				provider,
				line_reference,
				provider_reference,
				provider_event_id,
				line_type,
				amount,
				amount_minor,
				currency,
				status,
				match_status,
				mismatch_reason,
				occurred_at,
				metadata,
				created_at
			)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,COALESCE(NULLIF($12,''),'unmatched'),$13,$14,$15::jsonb,NOW())
		`, lineID, req.ID, req.Provider, line.LineReference, nullString(line.ProviderReference), nullString(line.ProviderEventID), defaultString(line.LineType, "deposit"), MinorDecimalString(line.AmountMinor, line.Currency), line.AmountMinor, line.Currency, defaultString(line.Status, "posted"), nullString(line.MatchStatus), nullString(line.MismatchReason), line.OccurredAt, "{}")
		if err != nil {
			return ProviderStatementImport{}, err
		}
	}
	_ = r.CreateFinancialJob(ctx, FinancialJob{JobType: FinancialJobTypeProviderStatementReconcile, Status: FinancialJobStatusPending, SourceType: "provider_statement_import", SourceID: req.ID, Provider: req.Provider, IdempotencyKey: "provider-statement-reconciliation:" + req.ID, Metadata: "{}"})
	return ProviderStatementImport{ID: req.ID, Provider: req.Provider, StatementReference: req.StatementReference, Status: "pending", ImportedBy: req.ImportedBy, TotalLineCount: len(req.Lines)}, nil
}

func (r *PostgresRepository) RunProviderStatementReconciliation(ctx context.Context, importID string, provider string) (ReconciliationRun, error) {
	if provider == "" {
		return ReconciliationRun{}, ErrInvalidPaymentMethod
	}
	_, err := r.db.Exec(ctx, `
		WITH matched AS (
			SELECT
				l.id AS line_id,
				pi.id AS payment_intent_id,
				pi.wallet_transaction_id,
				CASE
					WHEN pi.id IS NULL THEN 'missing_ledger'
					WHEN l.currency <> pi.currency THEN 'currency_mismatch'
					WHEN l.amount_minor <> pi.amount_minor THEN 'amount_mismatch'
					ELSE 'matched'
				END AS next_status,
				CASE
					WHEN pi.id IS NULL THEN 'provider reference not found in payment_intents'
					WHEN l.currency <> pi.currency THEN 'provider statement currency differs from payment intent'
					WHEN l.amount_minor <> pi.amount_minor THEN 'provider statement amount differs from payment intent'
					ELSE NULL
				END AS mismatch_reason
			FROM public.provider_statement_lines l
			LEFT JOIN public.payment_intents pi
			  ON pi.provider = l.provider
			 AND pi.provider_reference = l.provider_reference
			WHERE l.import_id = $1
			  AND l.provider = $2
		)
		UPDATE public.provider_statement_lines l
		SET match_status = matched.next_status,
		    matched_payment_intent_id = matched.payment_intent_id,
		    matched_wallet_transaction_id = matched.wallet_transaction_id,
		    mismatch_reason = matched.mismatch_reason
		FROM matched
		WHERE l.id = matched.line_id
	`, importID, provider)
	if err != nil {
		return ReconciliationRun{}, err
	}
	runID := uuidString(fmt.Sprintf("provider-statement-reconciliation:%s:%d", importID, time.Now().UnixNano()))
	run := ReconciliationRun{ID: runID, Provider: provider, RunType: "provider_events", Status: "requires_review"}
	_, err = r.db.Exec(ctx, `
		INSERT INTO public.reconciliation_runs (
			id,
			provider,
			run_type,
			status,
			started_at,
			completed_at,
			matched_count,
			mismatch_count,
			missing_provider_count,
			missing_ledger_count,
			metadata
		)
		SELECT
			$1,
			$2,
			'provider_events',
			CASE WHEN COUNT(*) FILTER (WHERE match_status <> 'matched') = 0 THEN 'completed' ELSE 'requires_review' END,
			NOW(),
			NOW(),
			COUNT(*) FILTER (WHERE match_status = 'matched'),
			COUNT(*) FILTER (WHERE match_status IN ('amount_mismatch', 'currency_mismatch')),
			COUNT(*) FILTER (WHERE match_status IN ('unmatched_provider', 'missing_provider_event')),
			COUNT(*) FILTER (WHERE match_status = 'missing_ledger'),
			jsonb_build_object('provider_statement_import_id', $3)
		FROM public.provider_statement_lines
		WHERE import_id = $3
		  AND provider = $2
	`, runID, provider, importID)
	if err != nil {
		return ReconciliationRun{}, err
	}
	_, _ = r.db.Exec(ctx, `
		UPDATE public.provider_statement_imports
		SET status = CASE
				WHEN EXISTS (
					SELECT 1
					FROM public.provider_statement_lines
					WHERE import_id = $1
					  AND match_status <> 'matched'
				) THEN 'requires_review'
				ELSE 'completed'
			END,
		    matched_count = (SELECT COUNT(*) FROM public.provider_statement_lines WHERE import_id = $1 AND match_status = 'matched'),
		    mismatch_count = (SELECT COUNT(*) FROM public.provider_statement_lines WHERE import_id = $1 AND match_status IN ('amount_mismatch', 'currency_mismatch')),
		    unmatched_count = (SELECT COUNT(*) FROM public.provider_statement_lines WHERE import_id = $1 AND match_status NOT IN ('matched', 'amount_mismatch', 'currency_mismatch')),
		    completed_at = NOW()
		WHERE id = $1
	`, importID)
	_ = r.RecordFinancialMetric(ctx, FinancialMetric{MetricType: FinancialMetricProviderStatementDrift, Provider: provider, ReferenceType: "provider_statement_import", ReferenceID: importID})
	return run, nil
}

func (r *PostgresRepository) StartProviderCertification(ctx context.Context, cert ProviderCertification) (ProviderCertification, error) {
	if cert.ID == "" {
		cert.ID = uuidString(fmt.Sprintf("provider-certification:%s:%s:%d", cert.Provider, cert.CertificationType, time.Now().UnixNano()))
	}
	if cert.Status == "" {
		cert.Status = CertificationStatusRunning
	}
	_, err := r.db.Exec(ctx, `
		INSERT INTO public.provider_certifications (
			id,
			provider,
			certification_type,
			status,
			score,
			certified_by,
			metadata,
			created_at,
			updated_at
		)
		VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,NOW(),NOW())
	`, cert.ID, cert.Provider, cert.CertificationType, cert.Status, cert.Score, nullString(cert.CertifiedBy), defaultString(cert.Metadata, "{}"))
	if err != nil {
		return ProviderCertification{}, err
	}
	_ = r.CreateFinancialJob(ctx, FinancialJob{JobType: FinancialJobTypeProviderCertification, Status: FinancialJobStatusPending, SourceType: "provider_certification", SourceID: cert.ID, Provider: cert.Provider, IdempotencyKey: "provider-certification:" + cert.ID, Metadata: "{}"})
	return cert, nil
}

func (r *PostgresRepository) RecordCertificationCheck(ctx context.Context, check ProviderCertificationCheck) (ProviderCertificationCheck, error) {
	if check.ID == "" {
		check.ID = uuidString("provider-certification-check:" + check.CertificationID + ":" + check.CheckType)
	}
	if check.Status == "" {
		check.Status = CertificationCheckStatusPending
	}
	_, err := r.db.Exec(ctx, `
		INSERT INTO public.provider_certification_checks (
			id,
			certification_id,
			provider,
			check_type,
			status,
			evidence,
			failure_reason,
			performed_at,
			metadata,
			created_at,
			updated_at
		)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,NOW(),NOW())
		ON CONFLICT (certification_id, check_type)
		DO UPDATE SET
			status = EXCLUDED.status,
			evidence = EXCLUDED.evidence,
			failure_reason = EXCLUDED.failure_reason,
			performed_at = EXCLUDED.performed_at,
			updated_at = NOW()
	`, check.ID, check.CertificationID, check.Provider, check.CheckType, check.Status, nullString(check.Evidence), nullString(check.FailureReason), check.PerformedAt, defaultString(check.Metadata, "{}"))
	return check, err
}

func (r *PostgresRepository) RunRecoveryDrill(ctx context.Context, drill RecoveryDrill) (RecoveryDrill, error) {
	if drill.ID == "" {
		drill.ID = uuidString(fmt.Sprintf("recovery-drill:%s:%s:%d", drill.DrillType, drill.Provider, time.Now().UnixNano()))
	}
	if drill.Status == "" {
		drill.Status = RecoveryDrillStatusRunning
	}
	jobType := drillJobType(drill.DrillType)
	_, err := r.db.Exec(ctx, `
		INSERT INTO public.recovery_drills (
			id,
			drill_type,
			provider,
			status,
			score,
			triggered_by,
			metadata,
			started_at,
			created_at,
			updated_at
		)
		VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,NOW(),NOW(),NOW())
	`, drill.ID, drill.DrillType, nullString(drill.Provider), drill.Status, drill.Score, nullString(drill.TriggeredBy), defaultString(drill.Metadata, "{}"))
	if err != nil {
		return RecoveryDrill{}, err
	}
	_, _ = r.db.Exec(ctx, `
		INSERT INTO public.recovery_drill_events (
			id,
			drill_id,
			event_type,
			status,
			message,
			metadata,
			created_at
		)
		VALUES ($1,$2,'drill_started',$3,$4,$5::jsonb,NOW())
	`, uuidString("recovery-drill-event:"+drill.ID+":started"), drill.ID, drill.Status, "recovery drill started", "{}")
	_ = r.CreateFinancialJob(ctx, FinancialJob{JobType: jobType, Status: FinancialJobStatusPending, SourceType: "recovery_drill", SourceID: drill.ID, Provider: defaultString(drill.Provider, "internal"), IdempotencyKey: "recovery-drill:" + drill.ID, Metadata: "{}"})
	return drill, nil
}

func (r *PostgresRepository) RecordRecoveryScorecard(ctx context.Context, scorecard RecoveryScorecard) (RecoveryScorecard, error) {
	if scorecard.ID == "" {
		scorecard.ID = uuidString(fmt.Sprintf("recovery-scorecard:%s:%s:%d", scorecard.Provider, scorecard.ScoreType, time.Now().UnixNano()))
	}
	if scorecard.Status == "" {
		scorecard.Status = scorecardStatus(scorecard.Score)
	}
	_, err := r.db.Exec(ctx, `
		INSERT INTO public.recovery_scorecards (
			id,
			provider,
			score_type,
			score,
			status,
			period_start,
			period_end,
			metadata,
			created_at
		)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,NOW())
	`, scorecard.ID, nullString(scorecard.Provider), scorecard.ScoreType, scorecard.Score, scorecard.Status, scorecard.PeriodStart, scorecard.PeriodEnd, defaultString(scorecard.Metadata, "{}"))
	if err == nil {
		_ = r.RecordFinancialMetric(ctx, FinancialMetric{MetricType: FinancialMetricRecoveryScore, Provider: defaultString(scorecard.Provider, "internal"), ReferenceType: "recovery_scorecard", ReferenceID: scorecard.ID, Value: scorecard.Score})
	}
	return scorecard, err
}

func (r *PostgresRepository) CreateFinanceApprovalRequest(ctx context.Context, request FinanceApprovalRequest) (FinanceApprovalRequest, error) {
	if request.ID == "" {
		request.ID = uuidString(fmt.Sprintf("finance-approval:%s:%s:%s:%d", request.ApprovalType, request.TargetType, request.TargetID, time.Now().UnixNano()))
	}
	if request.Status == "" {
		request.Status = ApprovalStatusPending
	}
	if request.RequiredApprovalCount < 2 {
		request.RequiredApprovalCount = 2
	}
	_, err := r.db.Exec(ctx, `
		INSERT INTO public.finance_approval_requests (
			id,
			approval_type,
			status,
			target_type,
			target_id,
			requested_by,
			required_approval_count,
			metadata,
			created_at,
			updated_at
		)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,NOW(),NOW())
	`, request.ID, request.ApprovalType, request.Status, request.TargetType, request.TargetID, request.RequestedBy, request.RequiredApprovalCount, defaultString(request.Metadata, "{}"))
	if err != nil {
		return FinanceApprovalRequest{}, err
	}
	_ = r.CreateFinancialJob(ctx, FinancialJob{JobType: FinancialJobTypeDualApprovalReview, Status: FinancialJobStatusPending, SourceType: "finance_approval_request", SourceID: request.ID, Provider: "internal", IdempotencyKey: "dual-approval-review:" + request.ID, Metadata: "{}"})
	return request, nil
}

func (r *PostgresRepository) RecordFinanceApproval(ctx context.Context, event FinanceApprovalEvent) (FinanceApprovalRequest, error) {
	if event.ID == "" {
		event.ID = uuidString("finance-approval-event:" + event.RequestID + ":" + event.ApproverID)
	}
	_, err := r.db.Exec(ctx, `
		INSERT INTO public.finance_approval_events (
			id,
			request_id,
			approver_id,
			approver_role,
			decision,
			reason,
			created_at
		)
		SELECT $1,$2,$3,$4,$5,$6,NOW()
		WHERE EXISTS (
			SELECT 1
			FROM public.finance_approval_requests r
			WHERE r.id = $2
			  AND r.requested_by <> $3
			  AND r.status = 'pending'
		)
		ON CONFLICT (request_id, approver_id) DO NOTHING
	`, event.ID, event.RequestID, event.ApproverID, event.ApproverRole, event.Decision, nullString(event.Reason))
	if err != nil {
		return FinanceApprovalRequest{}, err
	}
	_, err = r.db.Exec(ctx, `
		UPDATE public.finance_approval_requests r
		SET approvals_count = approved_counts.approvals_count,
		    status = CASE
				WHEN rejected_counts.rejections_count > 0 THEN 'rejected'
				WHEN approved_counts.approvals_count >= r.required_approval_count THEN 'approved'
				ELSE r.status
			END,
		    rejection_reason = CASE WHEN rejected_counts.rejections_count > 0 THEN $2 ELSE r.rejection_reason END,
		    completed_at = CASE
				WHEN rejected_counts.rejections_count > 0 OR approved_counts.approvals_count >= r.required_approval_count THEN NOW()
				ELSE r.completed_at
			END,
		    updated_at = NOW()
		FROM (
			SELECT request_id, COUNT(*) AS approvals_count
			FROM public.finance_approval_events
			WHERE decision = 'approved'
			GROUP BY request_id
		) approved_counts,
		(
			SELECT $1::uuid AS request_id, COUNT(*) AS rejections_count
			FROM public.finance_approval_events
			WHERE request_id = $1
			  AND decision = 'rejected'
		) rejected_counts
		WHERE r.id = $1
		  AND approved_counts.request_id = r.id
	`, event.RequestID, nullString(event.Reason))
	if err != nil {
		return FinanceApprovalRequest{}, err
	}
	return FinanceApprovalRequest{ID: event.RequestID, Status: ApprovalStatusPending}, nil
}

func (r *PostgresRepository) CreateLaunchGate(ctx context.Context, gate LaunchGate) (LaunchGate, error) {
	if gate.ID == "" {
		gate.ID = uuidString("launch-gate:" + gate.GateKey)
	}
	if gate.Status == "" {
		gate.Status = LaunchGateStatusBlocked
	}
	_, err := r.db.Exec(ctx, `
		INSERT INTO public.launch_gates (
			id,
			gate_key,
			gate_type,
			provider,
			status,
			readiness_score,
			finance_approval_request_id,
			cto_approval_request_id,
			created_by,
			metadata,
			created_at,
			updated_at
		)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,NOW(),NOW())
		ON CONFLICT (gate_key)
		DO UPDATE SET
			status = EXCLUDED.status,
			readiness_score = EXCLUDED.readiness_score,
			updated_at = NOW()
	`, gate.ID, gate.GateKey, gate.GateType, nullString(gate.Provider), gate.Status, gate.ReadinessScore, nullString(gate.FinanceApprovalRequestID), nullString(gate.CTOApprovalRequestID), nullString(gate.CreatedBy), defaultString(gate.Metadata, "{}"))
	if err != nil {
		return LaunchGate{}, err
	}
	_ = r.CreateFinancialJob(ctx, FinancialJob{JobType: FinancialJobTypeLaunchGateReview, Status: FinancialJobStatusPending, SourceType: "launch_gate", SourceID: gate.ID, Provider: defaultString(gate.Provider, "internal"), IdempotencyKey: "launch-gate-review:" + gate.ID, Metadata: "{}"})
	_ = r.RecordFinancialMetric(ctx, FinancialMetric{MetricType: FinancialMetricLaunchGateBlocked, Provider: defaultString(gate.Provider, "internal"), ReferenceType: "launch_gate", ReferenceID: gate.ID})
	return gate, nil
}

func (r *PostgresRepository) EvaluateLaunchGate(ctx context.Context, gateID string, adminID string) (LaunchGate, error) {
	_, err := r.db.Exec(ctx, `
		UPDATE public.launch_gates g
		SET status = CASE
				WHEN g.readiness_score >= 90
				 AND finance.status = 'approved'
				 AND cto.status = 'approved'
				THEN 'approved'
				ELSE 'blocked'
			END,
		    updated_at = NOW()
		FROM public.finance_approval_requests finance,
		     public.finance_approval_requests cto
		WHERE g.id = $1
		  AND finance.id = g.finance_approval_request_id
		  AND cto.id = g.cto_approval_request_id
	`, gateID)
	if err != nil {
		return LaunchGate{}, err
	}
	return LaunchGate{ID: gateID, Status: LaunchGateStatusBlocked}, nil
}

func (r *PostgresRepository) CreateFinanceCloseRun(ctx context.Context, run FinanceCloseRun) (FinanceCloseRun, error) {
	if run.ID == "" {
		run.ID = uuidString(fmt.Sprintf("finance-close:%s:%s:%s", run.CloseType, run.PeriodStart.Format(time.RFC3339), run.PeriodEnd.Format(time.RFC3339)))
	}
	if run.Status == "" {
		run.Status = FinanceCloseStatusOpened
	}
	_, err := r.db.Exec(ctx, `
		INSERT INTO public.finance_close_runs (
			id,
			close_type,
			status,
			period_start,
			period_end,
			opened_by,
			mismatch_count,
			metadata,
			created_at,
			updated_at
		)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,NOW(),NOW())
	`, run.ID, run.CloseType, run.Status, run.PeriodStart, run.PeriodEnd, nullString(run.OpenedBy), run.MismatchCount, defaultString(run.Metadata, "{}"))
	if err != nil {
		return FinanceCloseRun{}, err
	}
	_ = r.CreateFinancialJob(ctx, FinancialJob{JobType: FinancialJobTypeFinanceClose, Status: FinancialJobStatusPending, SourceType: "finance_close_run", SourceID: run.ID, Provider: "internal", IdempotencyKey: "finance-close:" + run.ID, Metadata: "{}"})
	return run, nil
}

func (r *PostgresRepository) CreateFinanceSignoff(ctx context.Context, signoff FinanceSignoff) (FinanceSignoff, error) {
	if signoff.ID == "" {
		signoff.ID = uuidString("finance-signoff:" + signoff.SignoffType + ":" + signoff.TargetType + ":" + signoff.TargetID + ":" + signoff.SignerID)
	}
	_, err := r.db.Exec(ctx, `
		INSERT INTO public.finance_signoffs (
			id,
			signoff_type,
			target_type,
			target_id,
			status,
			signer_id,
			reason,
			signed_at,
			created_at
		)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
		ON CONFLICT (signoff_type, target_type, target_id, signer_id) DO NOTHING
	`, signoff.ID, signoff.SignoffType, signoff.TargetType, signoff.TargetID, signoff.Status, signoff.SignerID, nullString(signoff.Reason), signoff.SignedAt)
	return signoff, err
}

func (r *PostgresRepository) CreateLaunchReadinessScorecard(ctx context.Context, scorecard LaunchReadinessScorecard) (LaunchReadinessScorecard, error) {
	if scorecard.ID == "" {
		scorecard.ID = uuidString(fmt.Sprintf("launch-readiness-scorecard:%d", time.Now().UnixNano()))
	}
	if scorecard.Status == "" {
		scorecard.Status = scorecardStatus(scorecard.Score)
	}
	_, err := r.db.Exec(ctx, `
		INSERT INTO public.launch_readiness_scorecards (
			id,
			score,
			status,
			public_payments_ready,
			provider_activation_ready,
			finance_close_ready,
			dual_approval_ready,
			recovery_drills_ready,
			created_by,
			metadata,
			created_at
		)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,NOW())
	`, scorecard.ID, scorecard.Score, scorecard.Status, scorecard.PublicPaymentsReady, scorecard.ProviderActivationReady, scorecard.FinanceCloseReady, scorecard.DualApprovalReady, scorecard.RecoveryDrillsReady, nullString(scorecard.CreatedBy), defaultString(scorecard.Metadata, "{}"))
	return scorecard, err
}

func (r *PostgresRepository) CollectReleaseEvidence(ctx context.Context, evidence []ReleaseEvidenceRecord) ([]ReleaseEvidenceRecord, error) {
	for _, item := range evidence {
		if item.ID == "" {
			item.ID = uuidString(fmt.Sprintf("release-evidence:%s:%s:%d", item.Category, item.Component, time.Now().UnixNano()))
		}
		_, err := r.db.Exec(ctx, `
			INSERT INTO public.release_readiness_evidence (
				id,
				category,
				component,
				status,
				evidence_type,
				evidence_ref,
				score_impact,
				collected_by,
				metadata,
				created_at
			)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,NOW())
		`, item.ID, item.Category, item.Component, item.Status, item.EvidenceType, nullString(item.EvidenceRef), item.ScoreImpact, item.CollectedBy, defaultString(item.Metadata, "{}"))
		if err != nil {
			return nil, err
		}
	}
	err := r.CreateFinancialJob(ctx, FinancialJob{
		JobType:        FinancialJobTypeReleaseReadinessReview,
		Status:         FinancialJobStatusPending,
		SourceType:     "release_readiness_evidence",
		Provider:       "internal",
		IdempotencyKey: fmt.Sprintf("release-readiness-evidence:%d:%d", len(evidence), time.Now().UTC().UnixNano()),
		MaxAttempts:    3,
		Metadata:       "{}",
	})
	if err != nil {
		return nil, err
	}
	return evidence, nil
}

func (r *PostgresRepository) RunLaunchGateDrill(ctx context.Context, drill LaunchGateDrill) (LaunchGateDrill, error) {
	if drill.ID == "" {
		drill.ID = uuidString(fmt.Sprintf("launch-gate-drill:%s:%s:%d", drill.SimulatedGateType, drill.TriggeredBy, time.Now().UnixNano()))
	}
	_, err := r.db.Exec(ctx, `
		INSERT INTO public.launch_gate_drills (
			id,
			drill_type,
			status,
			provider,
			simulated_gate_type,
			missing_approval_blocked,
			low_score_blocked,
			certification_blocked,
			reconciliation_blocked,
			all_requirements_approved,
			no_activation_mutation,
			triggered_by,
			failure_reason,
			metadata,
			created_at,
			completed_at
		)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,NOW(),CASE WHEN $3 IN ('passed','failed') THEN NOW() ELSE NULL END)
	`, drill.ID, drill.DrillType, drill.Status, nullString(drill.Provider), drill.SimulatedGateType, drill.MissingApprovalBlocked, drill.LowScoreBlocked, drill.CertificationBlocked, drill.ReconciliationBlocked, drill.AllRequirementsApproved, drill.NoActivationMutation, drill.TriggeredBy, nullString(drill.FailureReason), defaultString(drill.Metadata, "{}"))
	if err != nil {
		return LaunchGateDrill{}, err
	}
	if drill.Status == LaunchGateDrillStatusFailed {
		_ = r.RecordFinancialMetric(ctx, FinancialMetric{MetricType: FinancialMetricLaunchGateDrillFailure, Value: 1, ReferenceType: "launch_gate_drill", ReferenceID: drill.ID})
	}
	err = r.CreateFinancialJob(ctx, FinancialJob{
		JobType:        FinancialJobTypeLaunchGateDrill,
		Status:         FinancialJobStatusPending,
		SourceType:     "launch_gate_drill",
		SourceID:       drill.ID,
		Provider:       defaultString(drill.Provider, "internal"),
		IdempotencyKey: "launch-gate-drill:" + drill.ID,
		MaxAttempts:    3,
		Metadata:       "{}",
	})
	return drill, err
}

func (r *PostgresRepository) CreateFinalReadinessScorecard(ctx context.Context, scorecard FinalReadinessScorecard) (FinalReadinessScorecard, error) {
	if scorecard.ID == "" {
		scorecard.ID = uuidString(fmt.Sprintf("final-readiness-scorecard:%s:%d", scorecard.CreatedBy, time.Now().UnixNano()))
	}
	_, err := r.db.Exec(ctx, `
		INSERT INTO public.final_readiness_scorecards (
			id,
			architecture_score,
			reliability_score,
			security_score,
			finance_score,
			governance_score,
			operations_score,
			provider_readiness_score,
			launch_readiness_score,
			overall_score,
			status,
			launch_recommendation,
			blockers,
			created_by,
			metadata,
			created_at
		)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,NOW())
	`, scorecard.ID, scorecard.ArchitectureScore, scorecard.ReliabilityScore, scorecard.SecurityScore, scorecard.FinanceScore, scorecard.GovernanceScore, scorecard.OperationsScore, scorecard.ProviderReadinessScore, scorecard.LaunchReadinessScore, scorecard.OverallScore, scorecard.Status, scorecard.LaunchRecommendation, nullString(scorecard.Blockers), scorecard.CreatedBy, defaultString(scorecard.Metadata, "{}"))
	if err != nil {
		return FinalReadinessScorecard{}, err
	}
	_ = r.RecordFinancialMetric(ctx, FinancialMetric{MetricType: FinancialMetricReleaseReadinessScore, Value: scorecard.OverallScore, ReferenceType: "final_readiness_scorecard", ReferenceID: scorecard.ID})
	return scorecard, nil
}

func (r *PostgresRepository) GenerateExecutiveSignoffPacket(ctx context.Context, packet ExecutiveSignoffPacket) (ExecutiveSignoffPacket, error) {
	if packet.ID == "" {
		packet.ID = uuidString(fmt.Sprintf("executive-signoff-packet:%s:%d", packet.PacketType, time.Now().UnixNano()))
	}
	_, err := r.db.Exec(ctx, `
		INSERT INTO public.executive_signoff_packets (
			id,
			packet_type,
			status,
			finance_status,
			cto_status,
			risk_status,
			operations_status,
			evidence_bundle,
			readiness_scorecard_id,
			generated_by,
			metadata,
			created_at,
			updated_at
		)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11::jsonb,NOW(),NOW())
	`, packet.ID, packet.PacketType, packet.Status, packet.FinanceStatus, packet.CTOStatus, packet.RiskStatus, packet.OperationsStatus, defaultString(packet.EvidenceBundle, "{}"), nullString(packet.ReadinessScorecardID), packet.GeneratedBy, defaultString(packet.Metadata, "{}"))
	if err != nil {
		return ExecutiveSignoffPacket{}, err
	}
	err = r.CreateFinancialJob(ctx, FinancialJob{JobType: FinancialJobTypeExecutiveSignoffPacket, Status: FinancialJobStatusPending, SourceType: "executive_signoff_packet", SourceID: packet.ID, Provider: "internal", IdempotencyKey: "executive-signoff-packet:" + packet.ID, Metadata: "{}"})
	return packet, err
}

func (r *PostgresRepository) RecordExecutiveApproval(ctx context.Context, approval ExecutiveApprovalRecord) (ExecutiveSignoffPacket, error) {
	if approval.ID == "" {
		approval.ID = uuidString(fmt.Sprintf("executive-approval:%s:%s", approval.PacketID, approval.ApproverRole))
	}
	_, err := r.db.Exec(ctx, `
		INSERT INTO public.executive_approval_records (
			id,
			packet_id,
			approver_role,
			approver_id,
			status,
			conditions,
			reason,
			created_at
		)
		VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
		ON CONFLICT (packet_id, approver_role) DO UPDATE SET
			approver_id = EXCLUDED.approver_id,
			status = EXCLUDED.status,
			conditions = EXCLUDED.conditions,
			reason = EXCLUDED.reason,
			created_at = NOW()
	`, approval.ID, approval.PacketID, approval.ApproverRole, approval.ApproverID, approval.Status, nullString(approval.Conditions), nullString(approval.Reason))
	if err != nil {
		return ExecutiveSignoffPacket{}, err
	}
	_, err = r.db.Exec(ctx, `
		UPDATE public.executive_signoff_packets
		SET
			finance_status = COALESCE((SELECT status FROM public.executive_approval_records WHERE packet_id = $1 AND approver_role = 'finance' ORDER BY created_at DESC LIMIT 1), finance_status),
			cto_status = COALESCE((SELECT status FROM public.executive_approval_records WHERE packet_id = $1 AND approver_role = 'cto' ORDER BY created_at DESC LIMIT 1), cto_status),
			risk_status = COALESCE((SELECT status FROM public.executive_approval_records WHERE packet_id = $1 AND approver_role = 'risk' ORDER BY created_at DESC LIMIT 1), risk_status),
			operations_status = COALESCE((SELECT status FROM public.executive_approval_records WHERE packet_id = $1 AND approver_role = 'operations' ORDER BY created_at DESC LIMIT 1), operations_status),
			status = CASE
				WHEN EXISTS (SELECT 1 FROM public.executive_approval_records WHERE packet_id = $1 AND status = 'rejected') THEN 'rejected'
				WHEN (SELECT COUNT(*) FROM public.executive_approval_records WHERE packet_id = $1 AND status IN ('approved', 'conditional_approval')) >= 4 THEN 'approved'
				WHEN EXISTS (SELECT 1 FROM public.executive_approval_records WHERE packet_id = $1 AND status = 'conditional_approval') THEN 'conditional_approval'
				ELSE 'pending'
			END,
			updated_at = NOW()
		WHERE id = $1
	`, approval.PacketID)
	if err != nil {
		return ExecutiveSignoffPacket{}, err
	}
	return ExecutiveSignoffPacket{ID: approval.PacketID}, nil
}

func (r *PostgresRepository) CreateLaunchBlocker(ctx context.Context, blocker LaunchBlocker) (LaunchBlocker, error) {
	if blocker.ID == "" {
		blocker.ID = uuidString(fmt.Sprintf("launch-blocker:%s:%d", blocker.Title, time.Now().UnixNano()))
	}
	_, err := r.db.Exec(ctx, `
		INSERT INTO public.launch_blockers (
			id,
			title,
			severity,
			status,
			owner_id,
			due_date,
			metadata,
			created_at,
			updated_at
		)
		VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,NOW(),NOW())
	`, blocker.ID, blocker.Title, blocker.Severity, blocker.Status, blocker.OwnerID, blocker.DueDate, defaultString(blocker.Metadata, "{}"))
	if err != nil {
		return LaunchBlocker{}, err
	}
	_ = r.RecordFinancialMetric(ctx, FinancialMetric{MetricType: FinancialMetricLaunchBlockerOpen, Value: 1, ReferenceType: "launch_blocker", ReferenceID: blocker.ID})
	return blocker, nil
}

func (r *PostgresRepository) ResolveLaunchBlocker(ctx context.Context, blockerID string, adminID string, resolution string) (LaunchBlocker, error) {
	_, err := r.db.Exec(ctx, `
		UPDATE public.launch_blockers
		SET status = 'resolved',
			resolved_by = $2,
			resolution = $3,
			resolved_at = NOW(),
			updated_at = NOW()
		WHERE id = $1
	`, blockerID, adminID, resolution)
	if err != nil {
		return LaunchBlocker{}, err
	}
	return LaunchBlocker{ID: blockerID, Status: LaunchBlockerStatusResolved, ResolvedBy: adminID, Resolution: resolution}, nil
}

func (r *PostgresRepository) RecordInternalLaunchDecision(ctx context.Context, decision InternalLaunchDecision) (InternalLaunchDecision, error) {
	if decision.ID == "" {
		decision.ID = uuidString(fmt.Sprintf("internal-launch-decision:%s:%d", decision.DecidedBy, time.Now().UnixNano()))
	}
	_, err := r.db.Exec(ctx, `
		INSERT INTO public.internal_launch_decisions (
			id,
			outcome,
			provider_activation_simulated,
			wallet_activation_simulated,
			withdrawal_activation_simulated,
			public_payment_activation_simulated,
			open_blockers_count,
			overall_readiness_score,
			decided_by,
			decision_reason,
			metadata,
			created_at
		)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,NOW())
	`, decision.ID, decision.Outcome, decision.ProviderActivationSimulated, decision.WalletActivationSimulated, decision.WithdrawalActivationSimulated, decision.PublicPaymentActivationSimulated, decision.OpenBlockersCount, decision.OverallReadinessScore, decision.DecidedBy, nullString(decision.DecisionReason), defaultString(decision.Metadata, "{}"))
	if err != nil {
		return InternalLaunchDecision{}, err
	}
	err = r.CreateFinancialJob(ctx, FinancialJob{JobType: FinancialJobTypeInternalLaunchDrill, Status: FinancialJobStatusPending, SourceType: "internal_launch_decision", SourceID: decision.ID, Provider: "internal", IdempotencyKey: "internal-launch-decision:" + decision.ID, Metadata: "{}"})
	return decision, err
}

func (r *PostgresRepository) RecordDrillEvidence(ctx context.Context, evidence DrillEvidence) (DrillEvidence, error) {
	if evidence.ID == "" {
		evidence.ID = uuidString(fmt.Sprintf("drill-evidence:%s:%d", evidence.DrillType, time.Now().UnixNano()))
	}
	_, err := r.db.Exec(ctx, `
		INSERT INTO public.live_drill_evidence (
			id,
			drill_type,
			provider,
			status,
			evidence_ref,
			submitted_by,
			metadata,
			created_at
		)
		VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,NOW())
	`, evidence.ID, evidence.DrillType, nullString(evidence.Provider), evidence.Status, evidence.EvidenceRef, evidence.SubmittedBy, defaultString(evidence.Metadata, "{}"))
	if err != nil {
		return DrillEvidence{}, err
	}
	err = r.CreateFinancialJob(ctx, FinancialJob{JobType: FinancialJobTypeDrillEvidenceReview, Status: FinancialJobStatusPending, SourceType: "live_drill_evidence", SourceID: evidence.ID, Provider: defaultString(evidence.Provider, "internal"), IdempotencyKey: "drill-evidence-review:" + evidence.ID, Metadata: "{}"})
	return evidence, err
}

func (r *PostgresRepository) ReviewDrillEvidence(ctx context.Context, review DrillEvidenceReview) (DrillEvidenceReview, error) {
	if review.ID == "" {
		review.ID = uuidString(fmt.Sprintf("drill-evidence-review:%s:%s", review.EvidenceID, review.ReviewerRole))
	}
	_, err := r.db.Exec(ctx, `
		INSERT INTO public.drill_evidence_reviews (
			id,
			evidence_id,
			reviewer_role,
			reviewer_id,
			status,
			notes,
			created_at
		)
		VALUES ($1,$2,$3,$4,$5,$6,NOW())
		ON CONFLICT (evidence_id, reviewer_role) DO UPDATE SET
			reviewer_id = EXCLUDED.reviewer_id,
			status = EXCLUDED.status,
			notes = EXCLUDED.notes,
			created_at = NOW()
	`, review.ID, review.EvidenceID, review.ReviewerRole, review.ReviewerID, review.Status, nullString(review.Notes))
	return review, err
}

func (r *PostgresRepository) CreateProductionException(ctx context.Context, exception ProductionException) (ProductionException, error) {
	if exception.ID == "" {
		exception.ID = uuidString(fmt.Sprintf("production-exception:%s:%d", exception.Severity, time.Now().UnixNano()))
	}
	_, err := r.db.Exec(ctx, `
		INSERT INTO public.production_exceptions (
			id,
			severity,
			owner_id,
			status,
			remediation_plan,
			target_resolution_date,
			metadata,
			created_at,
			updated_at
		)
		VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,NOW(),NOW())
	`, exception.ID, exception.Severity, exception.OwnerID, exception.Status, exception.RemediationPlan, exception.TargetResolutionDate, defaultString(exception.Metadata, "{}"))
	if err != nil {
		return ProductionException{}, err
	}
	_ = r.RecordFinancialMetric(ctx, FinancialMetric{MetricType: FinancialMetricProductionExceptionOpen, Value: 1, ReferenceType: "production_exception", ReferenceID: exception.ID})
	return exception, nil
}

func (r *PostgresRepository) UpdateProductionExceptionStatus(ctx context.Context, exceptionID string, status string, adminID string, resolution string) (ProductionException, error) {
	_, err := r.db.Exec(ctx, `
		UPDATE public.production_exceptions
		SET status = $2,
			verified_by = CASE WHEN $2 = 'verified' THEN $3 ELSE verified_by END,
			closed_by = CASE WHEN $2 = 'closed' THEN $3 ELSE closed_by END,
			closed_at = CASE WHEN $2 = 'closed' THEN NOW() ELSE closed_at END,
			metadata = metadata || jsonb_build_object('latest_resolution_note', $4),
			updated_at = NOW()
		WHERE id = $1
	`, exceptionID, status, adminID, resolution)
	if err != nil {
		return ProductionException{}, err
	}
	if status == ProductionExceptionStatusClosed {
		_ = r.CreateFinancialJob(ctx, FinancialJob{JobType: FinancialJobTypeProductionExceptionClosure, Status: FinancialJobStatusPending, SourceType: "production_exception", SourceID: exceptionID, Provider: "internal", IdempotencyKey: "production-exception-closure:" + exceptionID, Metadata: "{}"})
	}
	return ProductionException{ID: exceptionID, Status: status}, nil
}

func (r *PostgresRepository) CreateReliabilityScorecard(ctx context.Context, scorecard ReliabilityScorecard) (ReliabilityScorecard, error) {
	if scorecard.ID == "" {
		scorecard.ID = uuidString(fmt.Sprintf("reliability-scorecard:%s:%d", scorecard.ScorecardType, time.Now().UnixNano()))
	}
	_, err := r.db.Exec(ctx, `
		INSERT INTO public.reliability_scorecards (
			id,
			scorecard_type,
			settlement_reliability_score,
			provider_reliability_score,
			reconciliation_reliability_score,
			governance_reliability_score,
			launch_readiness_reliability_score,
			overall_score,
			authorization_outcome,
			created_by,
			metadata,
			created_at
		)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,NOW())
	`, scorecard.ID, scorecard.ScorecardType, scorecard.SettlementReliabilityScore, scorecard.ProviderReliabilityScore, scorecard.ReconciliationReliabilityScore, scorecard.GovernanceReliabilityScore, scorecard.LaunchReadinessReliabilityScore, scorecard.OverallScore, scorecard.AuthorizationOutcome, scorecard.CreatedBy, defaultString(scorecard.Metadata, "{}"))
	return scorecard, err
}

func (r *PostgresRepository) CreateControlRoomSnapshot(ctx context.Context, snapshot ControlRoomSnapshot) (ControlRoomSnapshot, error) {
	if snapshot.ID == "" {
		snapshot.ID = uuidString(fmt.Sprintf("control-room:%s:%d", snapshot.CreatedBy, time.Now().UnixNano()))
	}
	_, err := r.db.Exec(ctx, `
		INSERT INTO public.control_room_snapshots (
			id,
			settlement_health,
			provider_health,
			reconciliation_health,
			authorization_health,
			launch_readiness_health,
			created_by,
			metadata,
			created_at
		)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,NOW())
	`, snapshot.ID, snapshot.SettlementHealth, snapshot.ProviderHealth, snapshot.ReconciliationHealth, snapshot.AuthorizationHealth, snapshot.LaunchReadinessHealth, snapshot.CreatedBy, defaultString(snapshot.Metadata, "{}"))
	return snapshot, err
}

func (r *PostgresRepository) CreateDailyFinanceClose(ctx context.Context, close DailyFinanceClose) (DailyFinanceClose, error) {
	if close.ID == "" {
		close.ID = uuidString(fmt.Sprintf("daily-finance-close:%s", close.CloseDate.Format("2006-01-02")))
	}
	_, err := r.db.Exec(ctx, `
		INSERT INTO public.daily_finance_closes (
			id,
			close_date,
			status,
			opening_balance_minor,
			closing_balance_minor,
			provider_total_minor,
			wallet_total_minor,
			reconciliation_status,
			unresolved_exceptions,
			opened_by,
			metadata,
			created_at,
			updated_at
		)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,NOW(),NOW())
		ON CONFLICT (close_date) DO UPDATE SET
			status = EXCLUDED.status,
			closing_balance_minor = EXCLUDED.closing_balance_minor,
			provider_total_minor = EXCLUDED.provider_total_minor,
			wallet_total_minor = EXCLUDED.wallet_total_minor,
			reconciliation_status = EXCLUDED.reconciliation_status,
			unresolved_exceptions = EXCLUDED.unresolved_exceptions,
			updated_at = NOW()
	`, close.ID, close.CloseDate, close.Status, close.OpeningBalanceMinor, close.ClosingBalanceMinor, close.ProviderTotalMinor, close.WalletTotalMinor, close.ReconciliationStatus, close.UnresolvedExceptions, close.OpenedBy, defaultString(close.Metadata, "{}"))
	if err != nil {
		return DailyFinanceClose{}, err
	}
	err = r.CreateFinancialJob(ctx, FinancialJob{JobType: FinancialJobTypeDailyFinanceClose, Status: FinancialJobStatusPending, SourceType: "daily_finance_close", SourceID: close.ID, Provider: "internal", IdempotencyKey: "daily-finance-close:" + close.ID, Metadata: "{}"})
	return close, err
}

func (r *PostgresRepository) ReviewDailyClose(ctx context.Context, review DailyCloseReview) (DailyCloseReview, error) {
	if review.ID == "" {
		review.ID = uuidString(fmt.Sprintf("daily-close-review:%s:%s", review.CloseID, review.ReviewRole))
	}
	_, err := r.db.Exec(ctx, `
		INSERT INTO public.daily_close_reviews (
			id,
			close_id,
			review_role,
			reviewer_id,
			status,
			notes,
			created_at
		)
		VALUES ($1,$2,$3,$4,$5,$6,NOW())
		ON CONFLICT (close_id, review_role) DO UPDATE SET
			reviewer_id = EXCLUDED.reviewer_id,
			status = EXCLUDED.status,
			notes = EXCLUDED.notes,
			created_at = NOW()
	`, review.ID, review.CloseID, review.ReviewRole, review.ReviewerID, review.Status, nullString(review.Notes))
	if err != nil {
		return DailyCloseReview{}, err
	}
	_, err = r.db.Exec(ctx, `
		UPDATE public.daily_finance_closes
		SET status = CASE
			WHEN (SELECT COUNT(*) FROM public.daily_close_reviews WHERE close_id = $1 AND review_role IN ('finance', 'operations') AND status = 'approved') >= 2
				AND unresolved_exceptions = 0
				AND reconciliation_status = 'completed'
			THEN 'signed_off'
			WHEN EXISTS (SELECT 1 FROM public.daily_close_reviews WHERE close_id = $1 AND status = 'rejected') THEN 'failed'
			ELSE 'pending_review'
		END,
		signed_off_by = CASE
			WHEN (SELECT COUNT(*) FROM public.daily_close_reviews WHERE close_id = $1 AND review_role IN ('finance', 'operations') AND status = 'approved') >= 2 THEN $2
			ELSE signed_off_by
		END,
		signed_off_at = CASE
			WHEN (SELECT COUNT(*) FROM public.daily_close_reviews WHERE close_id = $1 AND review_role IN ('finance', 'operations') AND status = 'approved') >= 2 THEN NOW()
			ELSE signed_off_at
		END,
		updated_at = NOW()
		WHERE id = $1
	`, review.CloseID, review.ReviewerID)
	return review, err
}

func (r *PostgresRepository) CreateDailyReliabilityMetrics(ctx context.Context, metrics DailyReliabilityMetrics) (DailyReliabilityMetrics, error) {
	if metrics.ID == "" {
		metrics.ID = uuidString(fmt.Sprintf("daily-reliability:%s", metrics.MetricDate.Format("2006-01-02")))
	}
	_, err := r.db.Exec(ctx, `
		INSERT INTO public.daily_reliability_metrics (
			id,
			metric_date,
			settlement_success_rate,
			provider_callback_success_rate,
			reconciliation_success_rate,
			refund_success_rate,
			dispute_resolution_rate,
			created_by,
			metadata,
			created_at
		)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,NOW())
		ON CONFLICT (metric_date) DO UPDATE SET
			settlement_success_rate = EXCLUDED.settlement_success_rate,
			provider_callback_success_rate = EXCLUDED.provider_callback_success_rate,
			reconciliation_success_rate = EXCLUDED.reconciliation_success_rate,
			refund_success_rate = EXCLUDED.refund_success_rate,
			dispute_resolution_rate = EXCLUDED.dispute_resolution_rate,
			metadata = EXCLUDED.metadata
	`, metrics.ID, metrics.MetricDate, metrics.SettlementSuccessRate, metrics.ProviderCallbackSuccessRate, metrics.ReconciliationSuccessRate, metrics.RefundSuccessRate, metrics.DisputeResolutionRate, metrics.CreatedBy, defaultString(metrics.Metadata, "{}"))
	return metrics, err
}

func (r *PostgresRepository) CreatePilotMonitoringSnapshot(ctx context.Context, snapshot PilotMonitoringSnapshot) (PilotMonitoringSnapshot, error) {
	if snapshot.ID == "" {
		snapshot.ID = uuidString(fmt.Sprintf("pilot-monitoring:%s:%d", snapshot.CreatedBy, time.Now().UnixNano()))
	}
	_, err := r.db.Exec(ctx, `
		INSERT INTO public.pilot_monitoring_snapshots (
			id,
			pilot_users,
			pilot_transactions,
			pilot_deposits,
			pilot_withdrawals,
			pilot_failures,
			created_by,
			metadata,
			created_at
		)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,NOW())
	`, snapshot.ID, snapshot.PilotUsers, snapshot.PilotTransactions, snapshot.PilotDeposits, snapshot.PilotWithdrawals, snapshot.PilotFailures, snapshot.CreatedBy, defaultString(snapshot.Metadata, "{}"))
	return snapshot, err
}

func (r *PostgresRepository) CreateInternalPilotRunbook(ctx context.Context, runbook InternalPilotRunbook) (InternalPilotRunbook, error) {
	if runbook.ID == "" {
		runbook.ID = uuidString(fmt.Sprintf("internal-pilot-runbook:%s:%d", runbook.RunbookType, time.Now().UnixNano()))
	}
	_, err := r.db.Exec(ctx, `
		INSERT INTO public.internal_pilot_runbooks (
			id,
			runbook_type,
			title,
			status,
			owner_id,
			steps,
			metadata,
			created_at,
			updated_at
		)
		VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,NOW(),NOW())
	`, runbook.ID, runbook.RunbookType, runbook.Title, runbook.Status, runbook.OwnerID, defaultString(runbook.Steps, "[]"), defaultString(runbook.Metadata, "{}"))
	if err != nil {
		return InternalPilotRunbook{}, err
	}
	err = r.CreateFinancialJob(ctx, FinancialJob{JobType: FinancialJobTypeInternalPilotRunbook, Status: FinancialJobStatusPending, SourceType: "internal_pilot_runbook", SourceID: runbook.ID, Provider: "internal", IdempotencyKey: "internal-pilot-runbook:" + runbook.ID, Metadata: "{}"})
	return runbook, err
}

func (r *PostgresRepository) CreateDay1CloseSimulation(ctx context.Context, simulation Day1CloseSimulation) (Day1CloseSimulation, error) {
	if simulation.ID == "" {
		simulation.ID = uuidString(fmt.Sprintf("day1-close-simulation:%s:%d", simulation.SimulatedBy, time.Now().UnixNano()))
	}
	_, err := r.db.Exec(ctx, `
		INSERT INTO public.day1_close_simulations (
			id,
			status,
			opening_balance_validated,
			transaction_validated,
			provider_total_validated,
			wallet_total_validated,
			reconciliation_validated,
			exception_review_completed,
			finance_signed_off,
			operations_signed_off,
			simulated_by,
			metadata,
			created_at
		)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,NOW())
	`, simulation.ID, simulation.Status, simulation.OpeningBalanceValidated, simulation.TransactionValidated, simulation.ProviderTotalValidated, simulation.WalletTotalValidated, simulation.ReconciliationValidated, simulation.ExceptionReviewCompleted, simulation.FinanceSignedOff, simulation.OperationsSignedOff, simulation.SimulatedBy, defaultString(simulation.Metadata, "{}"))
	return simulation, err
}

func (r *PostgresRepository) CreateIncidentEscalation(ctx context.Context, escalation IncidentEscalation) (IncidentEscalation, error) {
	if escalation.ID == "" {
		escalation.ID = uuidString(fmt.Sprintf("incident-escalation:%s:%d", escalation.IncidentType, time.Now().UnixNano()))
	}
	_, err := r.db.Exec(ctx, `
		INSERT INTO public.incident_escalations (
			id,
			incident_type,
			level,
			status,
			owner_id,
			source_id,
			metadata,
			created_at,
			updated_at
		)
		VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,NOW(),NOW())
	`, escalation.ID, escalation.IncidentType, escalation.Level, escalation.Status, escalation.OwnerID, nullString(escalation.SourceID), defaultString(escalation.Metadata, "{}"))
	return escalation, err
}

func (r *PostgresRepository) CreatePilotTimelineEvent(ctx context.Context, event PilotOperationsTimelineEvent) (PilotOperationsTimelineEvent, error) {
	if event.ID == "" {
		event.ID = uuidString(fmt.Sprintf("pilot-timeline:%s:%d", event.EventType, time.Now().UnixNano()))
	}
	_, err := r.db.Exec(ctx, `
		INSERT INTO public.pilot_operations_timeline (
			id,
			event_type,
			status,
			actor_id,
			notes,
			metadata,
			created_at
		)
		VALUES ($1,$2,$3,$4,$5,$6::jsonb,NOW())
	`, event.ID, event.EventType, nullString(event.Status), event.ActorID, nullString(event.Notes), defaultString(event.Metadata, "{}"))
	return event, err
}

func (r *PostgresRepository) EvaluateInternalPilotSuccess(ctx context.Context, criteria InternalPilotSuccessCriteria) (InternalPilotSuccessCriteria, error) {
	if criteria.ID == "" {
		criteria.ID = uuidString(fmt.Sprintf("internal-pilot-success:%s:%d", criteria.EvaluatedBy, time.Now().UnixNano()))
	}
	_, err := r.db.Exec(ctx, `
		INSERT INTO public.internal_pilot_success_criteria (
			id,
			settlement_success,
			reconciliation_success,
			provider_success,
			reliability_score,
			unresolved_exceptions,
			outcome,
			evaluated_by,
			metadata,
			created_at
		)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,NOW())
	`, criteria.ID, criteria.SettlementSuccess, criteria.ReconciliationSuccess, criteria.ProviderSuccess, criteria.ReliabilityScore, criteria.UnresolvedExceptions, criteria.Outcome, criteria.EvaluatedBy, defaultString(criteria.Metadata, "{}"))
	return criteria, err
}

func (r *PostgresRepository) CreatePilotAuthorization(ctx context.Context, authorization PilotAuthorization) (PilotAuthorization, error) {
	if authorization.ID == "" {
		authorization.ID = uuidString(fmt.Sprintf("pilot-authorization:%s:%d", authorization.CreatedBy, time.Now().UnixNano()))
	}
	_, err := r.db.Exec(ctx, `
		INSERT INTO public.pilot_authorizations (
			id,
			decision,
			decision_reason,
			approvers,
			conditions,
			technology_ready,
			financial_ready,
			provider_ready,
			governance_ready,
			operational_ready,
			reliability_ready,
			critical_exceptions_exist,
			high_exceptions_exist,
			reconciliation_incomplete,
			finance_signoff_missing,
			operations_signoff_missing,
			cto_signoff_missing,
			risk_signoff_missing,
			created_by,
			created_at
		)
		VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,NOW())
	`, authorization.ID, authorization.Decision, authorization.DecisionReason, defaultString(authorization.Approvers, "{}"), nullString(authorization.Conditions), authorization.TechnologyReady, authorization.FinancialReady, authorization.ProviderReady, authorization.GovernanceReady, authorization.OperationalReady, authorization.ReliabilityReady, authorization.CriticalExceptionsExist, authorization.HighExceptionsExist, authorization.ReconciliationIncomplete, authorization.FinanceSignoffMissing, authorization.OperationsSignoffMissing, authorization.CTOSignoffMissing, authorization.RiskSignoffMissing, authorization.CreatedBy)
	return authorization, err
}

func (r *PostgresRepository) CreatePilotScopeDefinition(ctx context.Context, scope PilotScopeDefinition) (PilotScopeDefinition, error) {
	if scope.ID == "" {
		scope.ID = uuidString(fmt.Sprintf("pilot-scope:%s:%d", scope.DefinedBy, time.Now().UnixNano()))
	}
	_, err := r.db.Exec(ctx, `
		INSERT INTO public.pilot_scope_definitions (
			id,
			pilot_users,
			pilot_drivers,
			pilot_riders,
			pilot_transactions,
			pilot_duration_days,
			defined_by,
			metadata,
			created_at
		)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,NOW())
	`, scope.ID, scope.PilotUsers, scope.PilotDrivers, scope.PilotRiders, scope.PilotTransactions, scope.PilotDurationDays, scope.DefinedBy, defaultString(scope.Metadata, "{}"))
	return scope, err
}

func (r *PostgresRepository) CreatePilotSuccessDefinition(ctx context.Context, success PilotSuccessDefinition) (PilotSuccessDefinition, error) {
	if success.ID == "" {
		success.ID = uuidString(fmt.Sprintf("pilot-success-definition:%s:%d", success.DefinedBy, time.Now().UnixNano()))
	}
	_, err := r.db.Exec(ctx, `
		INSERT INTO public.pilot_success_definitions (
			id,
			settlement_reliability_target,
			reconciliation_reliability_target,
			provider_reliability_target,
			dispute_resolution_target,
			incident_response_target,
			defined_by,
			metadata,
			created_at
		)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,NOW())
	`, success.ID, success.SettlementReliabilityTarget, success.ReconciliationReliabilityTarget, success.ProviderReliabilityTarget, success.DisputeResolutionTarget, success.IncidentResponseTarget, success.DefinedBy, defaultString(success.Metadata, "{}"))
	return success, err
}

func (r *PostgresRepository) CreateInternalPilotAuthorizationExecution(ctx context.Context, authorization InternalPilotAuthorizationExecution) (InternalPilotAuthorizationExecution, error) {
	if authorization.ID == "" {
		authorization.ID = uuidString(fmt.Sprintf("internal-pilot-authorization:%s:%d", authorization.CreatedBy, time.Now().UnixNano()))
	}
	_, err := r.db.Exec(ctx, `
		INSERT INTO public.internal_pilot_authorization_executions (
			id,
			pilot_authorization_id,
			status,
			decision,
			decision_reason,
			required_signoffs,
			required_evidence,
			unresolved_exceptions,
			readiness_score_threshold,
			readiness_score,
			conditions,
			approved_pilot_users,
			approved_drivers,
			approved_riders,
			pilot_transaction_limit,
			pilot_duration_days,
			expires_at,
			created_by,
			metadata,
			created_at,
			updated_at
		)
		VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19::jsonb,NOW(),NOW())
	`, authorization.ID, nullString(authorization.PilotAuthorizationID), authorization.Status, authorization.Decision, authorization.DecisionReason, defaultString(authorization.RequiredSignoffs, "{}"), defaultString(authorization.RequiredEvidence, "{}"), authorization.UnresolvedExceptions, authorization.ReadinessScoreThreshold, authorization.ReadinessScore, nullString(authorization.Conditions), authorization.ApprovedPilotUsers, authorization.ApprovedDrivers, authorization.ApprovedRiders, authorization.PilotTransactionLimit, authorization.PilotDurationDays, authorization.ExpiresAt, authorization.CreatedBy, defaultString(authorization.Metadata, "{}"))
	if err != nil {
		return authorization, err
	}
	err = r.CreateFinancialJob(ctx, FinancialJob{
		JobType:        FinancialJobTypeInternalPilotAuthorization,
		SourceType:     "internal_pilot_authorization",
		SourceID:       authorization.ID,
		IdempotencyKey: "internal-pilot-authorization:" + authorization.ID,
		Metadata:       defaultString(authorization.Metadata, "{}"),
	})
	return authorization, err
}

func (r *PostgresRepository) RecordInternalPilotAuthorizationAudit(ctx context.Context, audit InternalPilotAuthorizationAudit) (InternalPilotAuthorizationAudit, error) {
	if audit.ID == "" {
		audit.ID = uuidString(fmt.Sprintf("internal-pilot-authorization-audit:%s:%s:%d", audit.AuthorizationExecutionID, audit.ApproverID, time.Now().UnixNano()))
	}
	_, err := r.db.Exec(ctx, `
		INSERT INTO public.internal_pilot_authorization_audits (
			id,
			authorization_execution_id,
			approver_id,
			decision,
			reason,
			conditions,
			created_at
		)
		VALUES ($1,$2,$3,$4,$5,$6,NOW())
	`, audit.ID, audit.AuthorizationExecutionID, audit.ApproverID, audit.Decision, nullString(audit.Reason), nullString(audit.Conditions))
	return audit, err
}

func (r *PostgresRepository) CreateInternalPilotParticipant(ctx context.Context, participant InternalPilotParticipant) (InternalPilotParticipant, error) {
	if participant.ID == "" {
		participant.ID = uuidString(fmt.Sprintf("internal-pilot-participant:%s:%s", participant.AuthorizationExecutionID, participant.UserID))
	}
	if participant.Status == "" {
		participant.Status = InternalPilotParticipantActive
	}
	_, err := r.db.Exec(ctx, `
		INSERT INTO public.internal_pilot_participants (
			id,
			authorization_execution_id,
			user_id,
			role,
			status,
			enrollment_source,
			enrolled_by,
			reason,
			metadata,
			enrolled_at,
			updated_at
		)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,NOW(),NOW())
		ON CONFLICT (authorization_execution_id, user_id, role)
		DO UPDATE SET
			status = EXCLUDED.status,
			enrollment_source = EXCLUDED.enrollment_source,
			enrolled_by = EXCLUDED.enrolled_by,
			reason = EXCLUDED.reason,
			metadata = EXCLUDED.metadata,
			updated_at = NOW()
	`, participant.ID, participant.AuthorizationExecutionID, participant.UserID, participant.Role, participant.Status, nullString(participant.EnrollmentSource), participant.EnrolledBy, nullString(participant.Reason), defaultString(participant.Metadata, "{}"))
	return participant, err
}

func (r *PostgresRepository) UpdateInternalPilotParticipantStatus(ctx context.Context, participantID string, status string, actorID string, reason string) (InternalPilotParticipant, error) {
	var participant InternalPilotParticipant
	err := r.db.QueryRow(ctx, `
		UPDATE public.internal_pilot_participants
		SET status = $2,
		    reason = $3,
		    updated_at = NOW()
		WHERE id = $1
		RETURNING id, authorization_execution_id, user_id, role, status, COALESCE(enrollment_source, ''), enrolled_by, COALESCE(reason, ''), metadata::text, enrolled_at, updated_at
	`, participantID, status, nullString(reason)).Scan(&participant.ID, &participant.AuthorizationExecutionID, &participant.UserID, &participant.Role, &participant.Status, &participant.EnrollmentSource, &participant.EnrolledBy, &participant.Reason, &participant.Metadata, &participant.EnrolledAt, &participant.UpdatedAt)
	return participant, err
}

func (r *PostgresRepository) CreateInternalPilotParticipantEvent(ctx context.Context, event InternalPilotParticipantEvent) error {
	if event.ID == "" {
		event.ID = uuidString(fmt.Sprintf("internal-pilot-participant-event:%s:%s:%d", event.ParticipantID, event.Action, time.Now().UnixNano()))
	}
	_, err := r.db.Exec(ctx, `
		INSERT INTO public.internal_pilot_participant_events (
			id,
			participant_id,
			authorization_execution_id,
			user_id,
			role,
			previous_status,
			new_status,
			action,
			reason,
			actor_id,
			metadata,
			created_at
		)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,NOW())
	`, event.ID, event.ParticipantID, event.AuthorizationExecutionID, event.UserID, event.Role, nullString(event.PreviousStatus), nullString(event.NewStatus), event.Action, nullString(event.Reason), event.ActorID, defaultString(event.Metadata, "{}"))
	return err
}

func (r *PostgresRepository) GetInternalPilotAccessSnapshot(ctx context.Context, check InternalPilotAccessCheck) (InternalPilotAccessSnapshot, error) {
	var snapshot InternalPilotAccessSnapshot
	var expiresAt sql.NullTime
	authID := check.AuthorizationExecutionID
	err := r.db.QueryRow(ctx, `
		WITH auth AS (
			SELECT *
			FROM public.internal_pilot_authorization_executions
			WHERE ($1 <> '' AND id = $1::uuid)
			   OR ($1 = '' AND status = 'active')
			ORDER BY created_at DESC
			LIMIT 1
		),
		participant AS (
			SELECT *
			FROM public.internal_pilot_participants
			WHERE user_id = $2::uuid
			  AND role = $3
			  AND authorization_execution_id = (SELECT id FROM auth)
			ORDER BY updated_at DESC
			LIMIT 1
		)
		SELECT
			COALESCE((SELECT id::text FROM participant), ''),
			COALESCE((SELECT role FROM participant), ''),
			COALESCE((SELECT status FROM participant), ''),
			auth.id::text,
			auth.status,
			auth.expires_at,
			auth.created_at,
			auth.approved_pilot_users,
			auth.approved_drivers,
			auth.approved_riders,
			auth.pilot_transaction_limit,
			auth.pilot_duration_days,
			(SELECT COUNT(*) FROM public.internal_pilot_participants p WHERE p.authorization_execution_id = auth.id AND p.status = 'active'),
			(SELECT COUNT(*) FROM public.internal_pilot_participants p WHERE p.authorization_execution_id = auth.id AND p.status = 'active' AND p.role = 'driver'),
			(SELECT COUNT(*) FROM public.internal_pilot_participants p WHERE p.authorization_execution_id = auth.id AND p.status = 'active' AND p.role = 'rider'),
			COALESCE((SELECT SUM(completed_rides + cancelled_rides + failed_rides) FROM public.internal_pilot_health_reports h WHERE h.authorization_execution_id = auth.id), 0),
			EXISTS (SELECT 1 FROM public.internal_pilot_kill_switches k WHERE k.service = $4 AND k.status = 'active')
		FROM auth
	`, authID, check.UserID, check.Role, check.Service).Scan(
		&snapshot.ParticipantID,
		&snapshot.ParticipantRole,
		&snapshot.ParticipantStatus,
		&snapshot.AuthorizationID,
		&snapshot.AuthorizationStatus,
		&expiresAt,
		&snapshot.AuthorizationCreatedAt,
		&snapshot.ApprovedPilotUsers,
		&snapshot.ApprovedDrivers,
		&snapshot.ApprovedRiders,
		&snapshot.PilotTransactionLimit,
		&snapshot.PilotDurationDays,
		&snapshot.ActiveParticipantCount,
		&snapshot.ActiveDriverCount,
		&snapshot.ActiveRiderCount,
		&snapshot.PilotTransactionCount,
		&snapshot.KillSwitchActive,
	)
	if err != nil {
		return snapshot, err
	}
	if expiresAt.Valid {
		snapshot.AuthorizationExpiresAt = &expiresAt.Time
	}
	return snapshot, nil
}

func (r *PostgresRepository) CreateInternalPilotHealthReport(ctx context.Context, report InternalPilotHealthReport) (InternalPilotHealthReport, error) {
	if report.ID == "" {
		report.ID = uuidString(fmt.Sprintf("internal-pilot-health:%s:%s", report.AuthorizationExecutionID, report.ReportDate.Format("2006-01-02")))
	}
	_, err := r.db.Exec(ctx, `
		INSERT INTO public.internal_pilot_health_reports (
			id,
			authorization_execution_id,
			report_date,
			ride_requests,
			completed_rides,
			cancelled_rides,
			failed_rides,
			wallet_payments,
			cash_payments,
			driver_participation,
			rider_participation,
			incident_count,
			critical_incidents,
			authorization_status,
			ride_completion_rate,
			cancellation_rate,
			wallet_success_rate,
			operational_incident_rate,
			authorization_compliance_rate,
			participant_activity_rate,
			created_by,
			metadata,
			created_at
		)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22::jsonb,NOW())
	`, report.ID, report.AuthorizationExecutionID, report.ReportDate, report.RideRequests, report.CompletedRides, report.CancelledRides, report.FailedRides, report.WalletPayments, report.CashPayments, report.DriverParticipation, report.RiderParticipation, report.IncidentCount, report.CriticalIncidents, report.AuthorizationStatus, report.RideCompletionRate, report.CancellationRate, report.WalletSuccessRate, report.OperationalIncidentRate, report.AuthorizationComplianceRate, report.ParticipantActivityRate, report.CreatedBy, defaultString(report.Metadata, "{}"))
	return report, err
}

func (r *PostgresRepository) CreateInternalPilotIncident(ctx context.Context, incident InternalPilotIncident) (InternalPilotIncident, error) {
	if incident.ID == "" {
		incident.ID = uuidString(fmt.Sprintf("internal-pilot-incident:%s:%s:%d", incident.AuthorizationExecutionID, incident.IncidentType, time.Now().UnixNano()))
	}
	_, err := r.db.Exec(ctx, `
		INSERT INTO public.internal_pilot_incidents (
			id,
			authorization_execution_id,
			incident_type,
			severity,
			status,
			source_id,
			title,
			description,
			owner_id,
			opened_by,
			metadata,
			created_at,
			updated_at
		)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,NOW(),NOW())
	`, incident.ID, incident.AuthorizationExecutionID, incident.IncidentType, incident.Severity, incident.Status, nullString(incident.SourceID), incident.Title, nullString(incident.Description), nullString(incident.OwnerID), incident.OpenedBy, defaultString(incident.Metadata, "{}"))
	return incident, err
}

func (r *PostgresRepository) UpdateInternalPilotIncidentStatus(ctx context.Context, incidentID string, status string, actorID string, resolution string) (InternalPilotIncident, error) {
	var incident InternalPilotIncident
	var resolvedAt sql.NullTime
	err := r.db.QueryRow(ctx, `
		UPDATE public.internal_pilot_incidents
		SET status = $2,
		    resolved_by = CASE WHEN $2 IN ('resolved', 'closed') THEN $3 ELSE resolved_by END,
		    resolution = CASE WHEN $2 IN ('resolved', 'closed') THEN $4 ELSE resolution END,
		    resolved_at = CASE WHEN $2 IN ('resolved', 'closed') THEN NOW() ELSE resolved_at END,
		    updated_at = NOW()
		WHERE id = $1
		RETURNING id, authorization_execution_id, incident_type, severity, status, COALESCE(source_id, ''), title, COALESCE(description, ''), COALESCE(owner_id::text, ''), opened_by, COALESCE(resolved_by::text, ''), COALESCE(resolution, ''), metadata::text, created_at, updated_at, resolved_at
	`, incidentID, status, actorID, nullString(resolution)).Scan(&incident.ID, &incident.AuthorizationExecutionID, &incident.IncidentType, &incident.Severity, &incident.Status, &incident.SourceID, &incident.Title, &incident.Description, &incident.OwnerID, &incident.OpenedBy, &incident.ResolvedBy, &incident.Resolution, &incident.Metadata, &incident.CreatedAt, &incident.UpdatedAt, &resolvedAt)
	if resolvedAt.Valid {
		incident.ResolvedAt = &resolvedAt.Time
	}
	return incident, err
}

func (r *PostgresRepository) UpsertInternalPilotKillSwitch(ctx context.Context, killSwitch InternalPilotKillSwitch) (InternalPilotKillSwitch, error) {
	if killSwitch.ID == "" {
		killSwitch.ID = uuidString("internal-pilot-kill-switch:" + killSwitch.Service)
	}
	_, err := r.db.Exec(ctx, `
		INSERT INTO public.internal_pilot_kill_switches (
			id,
			service,
			status,
			activated_by,
			activated_at,
			deactivated_by,
			deactivated_at,
			reason,
			metadata,
			created_at,
			updated_at
		)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,NOW(),NOW())
		ON CONFLICT (service)
		DO UPDATE SET
			status = EXCLUDED.status,
			activated_by = COALESCE(EXCLUDED.activated_by, public.internal_pilot_kill_switches.activated_by),
			activated_at = COALESCE(EXCLUDED.activated_at, public.internal_pilot_kill_switches.activated_at),
			deactivated_by = COALESCE(EXCLUDED.deactivated_by, public.internal_pilot_kill_switches.deactivated_by),
			deactivated_at = COALESCE(EXCLUDED.deactivated_at, public.internal_pilot_kill_switches.deactivated_at),
			reason = EXCLUDED.reason,
			metadata = EXCLUDED.metadata,
			updated_at = NOW()
	`, killSwitch.ID, killSwitch.Service, killSwitch.Status, nullString(killSwitch.ActivatedBy), killSwitch.ActivatedAt, nullString(killSwitch.DeactivatedBy), killSwitch.DeactivatedAt, killSwitch.Reason, defaultString(killSwitch.Metadata, "{}"))
	return killSwitch, err
}

func (r *PostgresRepository) CreateInternalPilotKillSwitchEvent(ctx context.Context, event InternalPilotKillSwitchEvent) error {
	if event.ID == "" {
		event.ID = uuidString(fmt.Sprintf("internal-pilot-kill-switch-event:%s:%s:%d", event.Service, event.Status, time.Now().UnixNano()))
	}
	_, err := r.db.Exec(ctx, `
		INSERT INTO public.internal_pilot_kill_switch_events (
			id,
			kill_switch_id,
			service,
			status,
			operator_id,
			reason,
			metadata,
			created_at
		)
		VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,NOW())
	`, event.ID, event.KillSwitchID, event.Service, event.Status, event.OperatorID, event.Reason, defaultString(event.Metadata, "{}"))
	return err
}

func (r *PostgresRepository) CreateInternalPilotExecutionEvent(ctx context.Context, event InternalPilotExecutionEvent) (InternalPilotExecutionEvent, error) {
	if event.ID == "" {
		event.ID = uuidString(fmt.Sprintf("internal-pilot-execution-event:%s:%s:%s:%d", event.AuthorizationExecutionID, event.EventType, event.EntityID, time.Now().UnixNano()))
	}
	_, err := r.db.Exec(ctx, `
		INSERT INTO public.internal_pilot_execution_events (
			id,
			authorization_execution_id,
			participant_id,
			event_type,
			entity_type,
			entity_id,
			status,
			metadata,
			created_at
		)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,NOW())
	`, event.ID, event.AuthorizationExecutionID, nullString(event.ParticipantID), event.EventType, event.EntityType, event.EntityID, nullString(event.Status), defaultString(event.Metadata, "{}"))
	return event, err
}

func (r *PostgresRepository) AggregateInternalPilotEvidence(ctx context.Context, authorizationExecutionID string, periodStart time.Time, periodEnd time.Time) (InternalPilotEvidenceMetrics, error) {
	var metrics InternalPilotEvidenceMetrics
	err := r.db.QueryRow(ctx, `
		WITH events AS (
			SELECT *
			FROM public.internal_pilot_execution_events
			WHERE authorization_execution_id = $1
			  AND created_at >= $2
			  AND created_at < $3
		)
		SELECT
			COUNT(*),
			COUNT(DISTINCT participant_id) FILTER (WHERE participant_id IS NOT NULL),
			(SELECT COUNT(*) FROM public.internal_pilot_participants WHERE authorization_execution_id = $1 AND status = 'active'),
			(SELECT COUNT(*) FROM public.internal_pilot_participants WHERE authorization_execution_id = $1 AND status = 'active' AND role = 'rider'),
			(SELECT COUNT(*) FROM public.internal_pilot_participants WHERE authorization_execution_id = $1 AND status = 'active' AND role = 'driver'),
			COUNT(DISTINCT entity_id) FILTER (WHERE event_type = 'ride_requested'),
			COUNT(DISTINCT entity_id) FILTER (WHERE event_type = 'trip_completed'),
			COUNT(DISTINCT entity_id) FILTER (WHERE event_type = 'trip_cancelled'),
			COUNT(*) FILTER (WHERE event_type = 'wallet_payment_completed'),
			COUNT(*) FILTER (WHERE event_type = 'cash_payment_completed'),
			COUNT(*) FILTER (WHERE event_type = 'platform_fee_recorded'),
			COUNT(*) FILTER (WHERE event_type = 'driver_earnings_recorded'),
			COUNT(*) FILTER (WHERE event_type = 'incident_created'),
			COUNT(*) FILTER (WHERE event_type = 'incident_created' AND status = 'critical'),
			COUNT(*) FILTER (WHERE event_type = 'kill_switch_triggered'),
			COUNT(*) FILTER (WHERE event_type = 'authorization_check_passed'),
			COUNT(*) FILTER (WHERE event_type = 'authorization_check_failed'),
			COUNT(*) FILTER (WHERE event_type IN ('authorization_check_failed', 'kill_switch_triggered'))
		FROM events
	`, authorizationExecutionID, periodStart, periodEnd).Scan(
		&metrics.TotalEvents,
		&metrics.TotalParticipants,
		&metrics.ActiveParticipants,
		&metrics.RiderParticipation,
		&metrics.DriverParticipation,
		&metrics.TotalRides,
		&metrics.CompletedRides,
		&metrics.CancelledRides,
		&metrics.WalletTransactions,
		&metrics.CashTransactions,
		&metrics.PlatformFees,
		&metrics.DriverEarnings,
		&metrics.Incidents,
		&metrics.CriticalIncidents,
		&metrics.KillSwitchActivations,
		&metrics.AuthorizationPassed,
		&metrics.AuthorizationFailed,
		&metrics.PolicyViolations,
	)
	return metrics, err
}

func (r *PostgresRepository) CreateInternalPilotEvidencePackage(ctx context.Context, pkg InternalPilotEvidencePackage) (InternalPilotEvidencePackage, error) {
	if pkg.ID == "" {
		pkg.ID = uuidString(fmt.Sprintf("internal-pilot-evidence-package:%s:%d", pkg.AuthorizationExecutionID, time.Now().UnixNano()))
	}
	_, err := r.db.Exec(ctx, `
		INSERT INTO public.internal_pilot_evidence_packages (
			id,
			authorization_execution_id,
			report_period_start,
			report_period_end,
			total_events,
			total_rides,
			completed_rides,
			cancelled_rides,
			wallet_transactions,
			cash_transactions,
			incidents,
			critical_incidents,
			compliance_score,
			metadata,
			created_at
		)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,NOW())
	`, pkg.ID, pkg.AuthorizationExecutionID, pkg.ReportPeriodStart, pkg.ReportPeriodEnd, pkg.TotalEvents, pkg.TotalRides, pkg.CompletedRides, pkg.CancelledRides, pkg.WalletTransactions, pkg.CashTransactions, pkg.Incidents, pkg.CriticalIncidents, pkg.ComplianceScore, defaultString(pkg.Metadata, "{}"))
	return pkg, err
}

func (r *PostgresRepository) CreateInternalPilotObjectiveResult(ctx context.Context, result InternalPilotObjectiveResult) (InternalPilotObjectiveResult, error) {
	if result.ID == "" {
		result.ID = uuidString(fmt.Sprintf("internal-pilot-objective:%s:%s:%d", result.AuthorizationExecutionID, result.ObjectiveName, time.Now().UnixNano()))
	}
	_, err := r.db.Exec(ctx, `
		INSERT INTO public.internal_pilot_objective_results (
			id,
			authorization_execution_id,
			objective_name,
			target_value,
			actual_value,
			achieved,
			notes,
			created_at
		)
		VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
	`, result.ID, result.AuthorizationExecutionID, result.ObjectiveName, result.TargetValue, result.ActualValue, result.Achieved, nullString(result.Notes))
	return result, err
}

func (r *PostgresRepository) CreateInternalPilotBoardReview(ctx context.Context, review InternalPilotBoardReview) (InternalPilotBoardReview, error) {
	if review.ID == "" {
		review.ID = uuidString(fmt.Sprintf("internal-pilot-board-review:%s:%d", review.AuthorizationExecutionID, time.Now().UnixNano()))
	}
	_, err := r.db.Exec(ctx, `
		INSERT INTO public.internal_pilot_board_reviews (
			id,
			authorization_execution_id,
			review_period_start,
			review_period_end,
			review_status,
			decision,
			decision_reason,
			reviewed_by,
			reviewed_at,
			metadata,
			created_at,
			updated_at
		)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,NOW(),NOW())
	`, review.ID, review.AuthorizationExecutionID, review.ReviewPeriodStart, review.ReviewPeriodEnd, review.ReviewStatus, review.Decision, review.DecisionReason, nullString(review.ReviewedBy), review.ReviewedAt, defaultString(review.Metadata, "{}"))
	return review, err
}

func (r *PostgresRepository) CreateInternalPilotReviewFinding(ctx context.Context, finding InternalPilotReviewFinding) (InternalPilotReviewFinding, error) {
	if finding.ID == "" {
		finding.ID = uuidString(fmt.Sprintf("internal-pilot-finding:%s:%s:%d", finding.BoardReviewID, finding.Title, time.Now().UnixNano()))
	}
	_, err := r.db.Exec(ctx, `
		INSERT INTO public.internal_pilot_review_findings (
			id,
			board_review_id,
			category,
			severity,
			title,
			description,
			recommendation,
			created_at
		)
		VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
	`, finding.ID, finding.BoardReviewID, finding.Category, finding.Severity, finding.Title, nullString(finding.Description), finding.Recommendation)
	return finding, err
}

func (r *PostgresRepository) CreateInternalPilotReadinessAssessment(ctx context.Context, assessment InternalPilotReadinessAssessment) (InternalPilotReadinessAssessment, error) {
	if assessment.ID == "" {
		assessment.ID = uuidString(fmt.Sprintf("internal-pilot-readiness:%s:%s:%d", assessment.BoardReviewID, assessment.Category, time.Now().UnixNano()))
	}
	_, err := r.db.Exec(ctx, `
		INSERT INTO public.internal_pilot_readiness_assessments (
			id,
			board_review_id,
			category,
			score,
			target_score,
			passed,
			notes,
			created_at
		)
		VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
	`, assessment.ID, assessment.BoardReviewID, assessment.Category, assessment.Score, assessment.TargetScore, assessment.Passed, nullString(assessment.Notes))
	return assessment, err
}

func (r *PostgresRepository) CreatePublicWalletPilotProgram(ctx context.Context, program PublicWalletPilotProgram) (PublicWalletPilotProgram, error) {
	if program.ID == "" {
		program.ID = uuidString(fmt.Sprintf("public-wallet-pilot-program:%s:%s", program.City, program.ProgramName))
	}
	_, err := r.db.Exec(ctx, `
		INSERT INTO public.wallet_pilot_programs (
			id,
			program_name,
			city,
			status,
			participant_limit,
			driver_limit,
			wallet_balance_limit_minor,
			daily_transaction_limit_minor,
			monthly_transaction_limit_minor,
			currency,
			start_date,
			end_date,
			authorization_execution_id,
			metadata,
			created_at,
			updated_at
		)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,NOW(),NOW())
	`, program.ID, program.ProgramName, program.City, program.Status, program.ParticipantLimit, program.DriverLimit, program.WalletBalanceLimitMinor, program.DailyTransactionLimitMinor, program.MonthlyTransactionLimitMinor, program.Currency, program.StartDate, program.EndDate, program.AuthorizationExecutionID, defaultString(program.Metadata, "{}"))
	return program, err
}

func (r *PostgresRepository) GetPublicWalletPilotProgramSnapshot(ctx context.Context, programID string) (PublicWalletPilotProgramSnapshot, error) {
	var snapshot PublicWalletPilotProgramSnapshot
	err := r.db.QueryRow(ctx, `
		SELECT
			p.id,
			p.city,
			p.status,
			p.participant_limit,
			p.driver_limit,
			COUNT(pp.id) FILTER (WHERE pp.status = 'active'),
			COUNT(pp.id) FILTER (WHERE pp.status = 'active' AND pp.participant_type = 'rider'),
			COUNT(pp.id) FILTER (WHERE pp.status = 'active' AND pp.participant_type = 'driver'),
			p.start_date,
			p.end_date
		FROM public.wallet_pilot_programs p
		LEFT JOIN public.wallet_pilot_participants pp ON pp.program_id = p.id
		WHERE p.id = $1
		GROUP BY p.id
	`, programID).Scan(
		&snapshot.ProgramID,
		&snapshot.City,
		&snapshot.Status,
		&snapshot.ParticipantLimit,
		&snapshot.DriverLimit,
		&snapshot.ActiveParticipantCount,
		&snapshot.ActiveRiderCount,
		&snapshot.ActiveDriverCount,
		&snapshot.StartDate,
		&snapshot.EndDate,
	)
	return snapshot, err
}

func (r *PostgresRepository) CreatePublicWalletPilotParticipant(ctx context.Context, participant PublicWalletPilotParticipant) (PublicWalletPilotParticipant, error) {
	if participant.ID == "" {
		participant.ID = uuidString(fmt.Sprintf("public-wallet-pilot-participant:%s:%s:%s", participant.ProgramID, participant.UserID, participant.ParticipantType))
	}
	_, err := r.db.Exec(ctx, `
		INSERT INTO public.wallet_pilot_participants (
			id,
			program_id,
			user_id,
			participant_type,
			status,
			enrolled_at,
			enrolled_by,
			metadata,
			updated_at
		)
		VALUES ($1,$2,$3,$4,$5,NOW(),$6,$7::jsonb,NOW())
	`, participant.ID, participant.ProgramID, participant.UserID, participant.ParticipantType, participant.Status, participant.EnrolledBy, defaultString(participant.Metadata, "{}"))
	return participant, err
}

func (r *PostgresRepository) UpdatePublicWalletPilotParticipantStatus(ctx context.Context, participantID string, status string, actorID string) (PublicWalletPilotParticipant, error) {
	_, err := r.db.Exec(ctx, `
		UPDATE public.wallet_pilot_participants
		SET status = $2,
		    metadata = metadata || jsonb_build_object('last_status_actor', $3),
		    updated_at = NOW()
		WHERE id = $1
	`, participantID, status, actorID)
	return PublicWalletPilotParticipant{ID: participantID, Status: status, EnrolledBy: actorID}, err
}

func (r *PostgresRepository) GetPublicWalletPilotAccessSnapshot(ctx context.Context, programID string, userID string, participantType string, walletID string) (PublicWalletPilotAccessSnapshot, error) {
	var snapshot PublicWalletPilotAccessSnapshot
	var activeKillSwitches string
	err := r.db.QueryRow(ctx, `
		WITH usage AS (
			SELECT
				COALESCE(SUM(amount_minor) FILTER (WHERE created_at >= date_trunc('day', NOW())), 0) AS daily_used_minor,
				COALESCE(SUM(amount_minor) FILTER (WHERE created_at >= date_trunc('month', NOW())), 0) AS monthly_used_minor
			FROM public.wallet_pilot_transactions
			WHERE program_id = $1
			  AND wallet_id = $4
			  AND status = 'recorded'
		)
		SELECT
			p.id,
			p.city,
			p.status,
			pp.id,
			pp.participant_type,
			pp.status,
			p.start_date,
			p.end_date,
			p.participant_limit,
			p.driver_limit,
			(SELECT COUNT(*) FROM public.wallet_pilot_participants WHERE program_id = p.id AND status = 'active'),
			(SELECT COUNT(*) FROM public.wallet_pilot_participants WHERE program_id = p.id AND status = 'active' AND participant_type = 'rider'),
			(SELECT COUNT(*) FROM public.wallet_pilot_participants WHERE program_id = p.id AND status = 'active' AND participant_type = 'driver'),
			p.wallet_balance_limit_minor,
			p.daily_transaction_limit_minor,
			p.monthly_transaction_limit_minor,
			COALESCE(wa.cached_available_balance_minor, 0),
			usage.daily_used_minor,
			usage.monthly_used_minor,
			COALESCE((SELECT string_agg(control, ',') FROM public.wallet_pilot_kill_switches WHERE program_id = p.id AND status = 'active'), '')
		FROM public.wallet_pilot_programs p
		JOIN public.wallet_pilot_participants pp ON pp.program_id = p.id AND pp.user_id = $2 AND pp.participant_type = $3
		LEFT JOIN public.wallet_accounts wa ON wa.id = $4
		CROSS JOIN usage
		WHERE p.id = $1
	`, programID, userID, participantType, walletID).Scan(
		&snapshot.ProgramID,
		&snapshot.City,
		&snapshot.ProgramStatus,
		&snapshot.ParticipantID,
		&snapshot.ParticipantType,
		&snapshot.ParticipantStatus,
		&snapshot.StartDate,
		&snapshot.EndDate,
		&snapshot.ParticipantLimit,
		&snapshot.DriverLimit,
		&snapshot.ActiveParticipantCount,
		&snapshot.ActiveRiderCount,
		&snapshot.ActiveDriverCount,
		&snapshot.WalletBalanceLimitMinor,
		&snapshot.DailyTransactionLimitMinor,
		&snapshot.MonthlyTransactionLimitMinor,
		&snapshot.CurrentWalletBalanceMinor,
		&snapshot.DailyUsedMinor,
		&snapshot.MonthlyUsedMinor,
		&activeKillSwitches,
	)
	if activeKillSwitches != "" {
		snapshot.KillSwitches = strings.Split(activeKillSwitches, ",")
	}
	return snapshot, err
}

func (r *PostgresRepository) CreatePublicWalletPilotTransaction(ctx context.Context, transaction PublicWalletPilotTransaction) (PublicWalletPilotTransaction, error) {
	if transaction.ID == "" {
		transaction.ID = uuidString(fmt.Sprintf("public-wallet-pilot-transaction:%s:%s:%d", transaction.ProgramID, transaction.WalletID, time.Now().UnixNano()))
	}
	_, err := r.db.Exec(ctx, `
		INSERT INTO public.wallet_pilot_transactions (
			id,
			program_id,
			wallet_id,
			user_id,
			transaction_type,
			amount_minor,
			currency,
			status,
			evidence_id,
			created_at
		)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
	`, transaction.ID, transaction.ProgramID, transaction.WalletID, transaction.UserID, transaction.TransactionType, transaction.AmountMinor, transaction.Currency, transaction.Status, nullString(transaction.EvidenceID))
	return transaction, err
}

func (r *PostgresRepository) CreatePublicWalletPilotReconciliationReport(ctx context.Context, report PublicWalletPilotReconciliationReport) (PublicWalletPilotReconciliationReport, error) {
	if report.ID == "" {
		report.ID = uuidString(fmt.Sprintf("public-wallet-pilot-reconciliation:%s:%s", report.ProgramID, report.ReportDate.Format("2006-01-02")))
	}
	_, err := r.db.Exec(ctx, `
		INSERT INTO public.wallet_pilot_reconciliation_reports (
			id,
			program_id,
			report_date,
			ledger_balance_minor,
			wallet_balance_minor,
			transaction_history_balance_minor,
			variance_minor,
			currency,
			status,
			metadata,
			created_at
		)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,NOW())
	`, report.ID, report.ProgramID, report.ReportDate, report.LedgerBalanceMinor, report.WalletBalanceMinor, report.TransactionHistoryBalanceMinor, report.VarianceMinor, report.Currency, report.Status, defaultString(report.Metadata, "{}"))
	return report, err
}

func (r *PostgresRepository) CreatePublicWalletPilotFraudEvent(ctx context.Context, event PublicWalletPilotFraudEvent) (PublicWalletPilotFraudEvent, error) {
	if event.ID == "" {
		event.ID = uuidString(fmt.Sprintf("public-wallet-pilot-fraud:%s:%s:%d", event.ProgramID, event.UserID, time.Now().UnixNano()))
	}
	_, err := r.db.Exec(ctx, `
		INSERT INTO public.wallet_pilot_fraud_events (
			id,
			program_id,
			user_id,
			event_type,
			severity,
			description,
			status,
			created_at,
			updated_at
		)
		VALUES ($1,$2,$3,$4,$5,$6,$7,NOW(),NOW())
	`, event.ID, event.ProgramID, event.UserID, event.EventType, event.Severity, event.Description, event.Status)
	return event, err
}

func (r *PostgresRepository) CreatePublicWalletPilotKillSwitch(ctx context.Context, killSwitch PublicWalletPilotKillSwitch) (PublicWalletPilotKillSwitch, error) {
	if killSwitch.ID == "" {
		killSwitch.ID = uuidString(fmt.Sprintf("public-wallet-pilot-kill-switch:%s:%s", killSwitch.ProgramID, killSwitch.Control))
	}
	_, err := r.db.Exec(ctx, `
		INSERT INTO public.wallet_pilot_kill_switches (
			id,
			program_id,
			control,
			status,
			operator_id,
			reason,
			metadata,
			activated_at,
			updated_at
		)
		VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,NOW(),NOW())
		ON CONFLICT (program_id, control)
		DO UPDATE SET
			status = EXCLUDED.status,
			operator_id = EXCLUDED.operator_id,
			reason = EXCLUDED.reason,
			metadata = EXCLUDED.metadata,
			activated_at = NOW(),
			updated_at = NOW()
	`, killSwitch.ID, killSwitch.ProgramID, killSwitch.Control, killSwitch.Status, killSwitch.OperatorID, killSwitch.Reason, defaultString(killSwitch.Metadata, "{}"))
	return killSwitch, err
}

func (r *PostgresRepository) AggregatePublicWalletPilotMetrics(ctx context.Context, programID string) (PublicWalletPilotMetrics, error) {
	var metrics PublicWalletPilotMetrics
	err := r.db.QueryRow(ctx, `
		SELECT
			p.id,
			p.city,
			(SELECT COUNT(*) FROM public.wallet_pilot_participants WHERE program_id = p.id AND status = 'active'),
			(SELECT COUNT(*) FROM public.wallet_pilot_participants WHERE program_id = p.id AND status = 'active' AND participant_type = 'rider'),
			(SELECT COUNT(*) FROM public.wallet_pilot_participants WHERE program_id = p.id AND status = 'active' AND participant_type = 'driver'),
			(SELECT COUNT(*) FROM public.wallet_pilot_transactions WHERE program_id = p.id),
			(SELECT COUNT(*) FROM public.wallet_pilot_transactions WHERE program_id = p.id AND transaction_type = 'deposit'),
			(SELECT COUNT(*) FROM public.wallet_pilot_transactions WHERE program_id = p.id AND transaction_type = 'ride_payment'),
			(SELECT COUNT(*) FROM public.wallet_pilot_transactions WHERE program_id = p.id AND transaction_type = 'refund'),
			(SELECT COUNT(*) FROM public.wallet_pilot_transactions WHERE program_id = p.id AND transaction_type = 'adjustment'),
			(SELECT COALESCE(SUM(amount_minor), 0) FROM public.wallet_pilot_transactions WHERE program_id = p.id AND status = 'recorded'),
			(SELECT COUNT(*) FROM public.wallet_pilot_reconciliation_reports WHERE program_id = p.id),
			(SELECT COUNT(*) FROM public.wallet_pilot_reconciliation_reports WHERE program_id = p.id AND status IN ('variance_detected', 'investigating')),
			(SELECT COUNT(*) FROM public.wallet_pilot_reconciliation_reports WHERE program_id = p.id AND status IN ('variance_detected', 'investigating')),
			(SELECT COUNT(*) FROM public.wallet_pilot_fraud_events WHERE program_id = p.id),
			(SELECT COUNT(*) FROM public.wallet_pilot_fraud_events WHERE program_id = p.id AND severity = 'critical'),
			(SELECT COUNT(*) FROM public.wallet_pilot_fraud_events WHERE program_id = p.id AND severity = 'critical' AND status IN ('open', 'investigating')),
			CASE
				WHEN (SELECT COUNT(*) FROM public.wallet_pilot_transactions WHERE program_id = p.id) = 0 THEN 0
				ELSE ((SELECT COUNT(*) FROM public.wallet_pilot_transactions WHERE program_id = p.id AND status = 'recorded') * 100 / (SELECT COUNT(*) FROM public.wallet_pilot_transactions WHERE program_id = p.id))
			END,
			CASE
				WHEN EXISTS (SELECT 1 FROM public.wallet_pilot_reconciliation_reports WHERE program_id = p.id AND status IN ('variance_detected', 'investigating')) THEN 0
				ELSE 100
			END,
			CASE
				WHEN (SELECT COUNT(*) FROM public.wallet_pilot_participants WHERE program_id = p.id) = 0 THEN 0
				ELSE ((SELECT COUNT(*) FROM public.wallet_pilot_participants WHERE program_id = p.id AND status = 'active') * 100 / (SELECT COUNT(*) FROM public.wallet_pilot_participants WHERE program_id = p.id))
			END
		FROM public.wallet_pilot_programs p
		WHERE p.id = $1
	`, programID).Scan(
		&metrics.ProgramID,
		&metrics.City,
		&metrics.ActiveParticipants,
		&metrics.ActiveRiders,
		&metrics.ActiveDrivers,
		&metrics.TransactionCount,
		&metrics.DepositCount,
		&metrics.RidePaymentCount,
		&metrics.RefundCount,
		&metrics.AdjustmentCount,
		&metrics.TotalVolumeMinor,
		&metrics.ReconciliationReports,
		&metrics.VarianceReports,
		&metrics.OpenVarianceReports,
		&metrics.FraudEvents,
		&metrics.CriticalFraudEvents,
		&metrics.OpenCriticalFraudEvents,
		&metrics.WalletSuccessRate,
		&metrics.LedgerAccuracy,
		&metrics.ParticipantComplianceRate,
	)
	return metrics, err
}

func drillJobType(drillType string) string {
	switch drillType {
	case "settlement_failure":
		return FinancialJobTypeSettlementFailureDrill
	case "reconciliation_failure":
		return FinancialJobTypeReconciliationFailureDrill
	case "provider_callback_failure":
		return FinancialJobTypeProviderCallbackDrill
	default:
		return FinancialJobTypeRecoveryDrill
	}
}

func (r *PostgresRepository) RecordFinancialMetric(ctx context.Context, metric FinancialMetric) error {
	if metric.ID == "" {
		metric.ID = uuidString(fmt.Sprintf("financial-metric:%s:%s:%d", metric.MetricType, metric.ReferenceID, time.Now().UnixNano()))
	}
	if metric.Value == 0 {
		metric.Value = 1
	}
	_, err := r.db.Exec(ctx, `
		INSERT INTO public.financial_metrics (
			id,
			metric_type,
			provider,
			reference_type,
			reference_id,
			value,
			metadata,
			created_at
		)
		VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,NOW())
	`, metric.ID, metric.MetricType, nullString(metric.Provider), nullString(metric.ReferenceType), nullString(metric.ReferenceID), metric.Value, defaultString(metric.Metadata, "{}"))
	return err
}

func (r *PostgresRepository) CreateDepositRequest(ctx context.Context, intent PaymentIntent) error {
	_, err := r.db.Exec(ctx, `
		INSERT INTO public.payment_intents (
			id,
			user_id,
			amount,
			amount_minor,
			currency,
			provider,
			payment_method,
			status,
			wallet_account_type,
			operation,
			idempotency_key,
			created_at,
			updated_at
		)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'manual_deposit',$10,NOW(),NOW())
		ON CONFLICT (user_id, provider, operation, idempotency_key) DO NOTHING
	`, nullString(intent.ID), intent.UserID, MinorDecimalString(intent.AmountMinor, intent.Currency), intent.AmountMinor, intent.Currency, intent.Provider, intent.PaymentMethod, intent.Status, nullString(intent.WalletAccountType), intent.IdempotencyKey)
	return err
}

func (r *PostgresRepository) CreateProviderDepositIntent(ctx context.Context, intent PaymentIntent) (PaymentIntent, error) {
	if intent.Provider == "" || intent.PaymentMethod == "" || intent.ProviderReference == "" {
		return PaymentIntent{}, ErrInvalidPaymentMethod
	}
	if intent.UserID == "" || intent.AmountMinor <= 0 {
		return PaymentIntent{}, ErrInvalidLedgerEntry
	}
	if err := ValidateCurrency(intent.Currency); err != nil {
		return PaymentIntent{}, err
	}
	if err := ValidateIdempotencyKey(intent.IdempotencyKey); err != nil {
		return PaymentIntent{}, err
	}
	_, err := r.db.Exec(ctx, `
		INSERT INTO public.payment_intents (
			id,
			user_id,
			amount,
			amount_minor,
			currency,
			provider,
			payment_method,
			status,
			wallet_account_type,
			provider_reference,
			operation,
			idempotency_key,
			expires_at,
			created_at,
			updated_at
		)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'provider_deposit',$11,$12,NOW(),NOW())
		ON CONFLICT (user_id, provider, operation, idempotency_key) DO NOTHING
	`, nullString(intent.ID), intent.UserID, MinorDecimalString(intent.AmountMinor, intent.Currency), intent.AmountMinor, intent.Currency, intent.Provider, intent.PaymentMethod, intent.Status, nullString(intent.WalletAccountType), intent.ProviderReference, intent.IdempotencyKey, intent.ExpiresAt)
	if err != nil {
		return PaymentIntent{}, err
	}
	return r.GetProviderDepositByScopedIdempotency(ctx, intent.UserID, intent.Provider, "provider_deposit", intent.IdempotencyKey)
}

func (r *PostgresRepository) GetProviderDepositByScopedIdempotency(ctx context.Context, userID string, provider string, operation string, key string) (PaymentIntent, error) {
	var intent PaymentIntent
	err := r.db.QueryRow(ctx, `
		SELECT
			id::text,
			user_id::text,
			amount,
			amount_minor,
			currency,
			provider,
			payment_method,
			status,
			COALESCE(wallet_account_type, ''),
			COALESCE(provider_reference, ''),
			idempotency_key,
			expires_at,
			COALESCE(approved_by::text, ''),
			approved_at,
			COALESCE(rejected_by::text, ''),
			rejected_at,
			COALESCE(rejection_reason, ''),
			COALESCE(wallet_transaction_id::text, ''),
			created_at,
			updated_at
		FROM public.payment_intents
		WHERE user_id = $1
		  AND provider = $2
		  AND operation = $3
		  AND idempotency_key = $4
	`, userID, provider, operation, key).Scan(
		&intent.ID,
		&intent.UserID,
		&intent.AmountMinor,
		&intent.Currency,
		&intent.Provider,
		&intent.PaymentMethod,
		&intent.Status,
		&intent.WalletAccountType,
		&intent.ProviderReference,
		&intent.IdempotencyKey,
		&intent.ExpiresAt,
		&intent.ApprovedBy,
		&intent.ApprovedAt,
		&intent.RejectedBy,
		&intent.RejectedAt,
		&intent.RejectionReason,
		&intent.WalletTransactionID,
		&intent.CreatedAt,
		&intent.UpdatedAt,
	)
	return intent, err
}

func (r *PostgresRepository) GetProviderDepositByProviderReference(ctx context.Context, provider string, providerReference string) (PaymentIntent, error) {
	var intent PaymentIntent
	err := r.db.QueryRow(ctx, `
		SELECT
			id::text,
			user_id::text,
			amount,
			amount_minor,
			currency,
			provider,
			payment_method,
			status,
			COALESCE(wallet_account_type, ''),
			COALESCE(provider_reference, ''),
			idempotency_key,
			expires_at,
			COALESCE(approved_by::text, ''),
			approved_at,
			COALESCE(rejected_by::text, ''),
			rejected_at,
			COALESCE(rejection_reason, ''),
			COALESCE(wallet_transaction_id::text, ''),
			created_at,
			updated_at
		FROM public.payment_intents
		WHERE provider = $1
		  AND provider_reference = $2
	`, provider, providerReference).Scan(
		&intent.ID,
		&intent.UserID,
		&intent.AmountMinor,
		&intent.Currency,
		&intent.Provider,
		&intent.PaymentMethod,
		&intent.Status,
		&intent.WalletAccountType,
		&intent.ProviderReference,
		&intent.IdempotencyKey,
		&intent.ExpiresAt,
		&intent.ApprovedBy,
		&intent.ApprovedAt,
		&intent.RejectedBy,
		&intent.RejectedAt,
		&intent.RejectionReason,
		&intent.WalletTransactionID,
		&intent.CreatedAt,
		&intent.UpdatedAt,
	)
	return intent, err
}

func (r *PostgresRepository) GetDepositRequestByIdempotencyKey(ctx context.Context, key string) (PaymentIntent, error) {
	var intent PaymentIntent
	err := r.db.QueryRow(ctx, `
		SELECT
			id::text,
			user_id::text,
			amount,
			amount_minor,
			currency,
			provider,
			payment_method,
			status,
			COALESCE(wallet_account_type, ''),
			COALESCE(provider_reference, ''),
			idempotency_key,
			expires_at,
			COALESCE(approved_by::text, ''),
			approved_at,
			COALESCE(rejected_by::text, ''),
			rejected_at,
			COALESCE(rejection_reason, ''),
			COALESCE(wallet_transaction_id::text, ''),
			created_at,
			updated_at
		FROM public.payment_intents
		WHERE idempotency_key = $1
	`, key).Scan(
		&intent.ID,
		&intent.UserID,
		&intent.AmountMinor,
		&intent.Currency,
		&intent.Provider,
		&intent.PaymentMethod,
		&intent.Status,
		&intent.WalletAccountType,
		&intent.ProviderReference,
		&intent.IdempotencyKey,
		&intent.ExpiresAt,
		&intent.ApprovedBy,
		&intent.ApprovedAt,
		&intent.RejectedBy,
		&intent.RejectedAt,
		&intent.RejectionReason,
		&intent.WalletTransactionID,
		&intent.CreatedAt,
		&intent.UpdatedAt,
	)
	return intent, err
}

func (r *PostgresRepository) ProcessProviderDepositCallback(ctx context.Context, callback ProviderDepositCallback) (PaymentIntent, error) {
	db, ok := r.db.(transactionalDB)
	if !ok {
		return PaymentIntent{}, fmt.Errorf("wallet repository database does not support transactions")
	}
	tx, err := db.Begin(ctx)
	if err != nil {
		return PaymentIntent{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	payload := defaultString(callback.Payload, "{}")
	eventID := uuidString("provider-event:" + callback.Provider + ":" + callback.ProviderEventID)
	tag, err := tx.Exec(ctx, `
		INSERT INTO public.provider_events (
			id,
			provider,
			provider_event_id,
			provider_reference,
			event_type,
			signature_valid,
			payload_hash,
			payload,
			received_at,
			status
		)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,NOW(),'received')
		ON CONFLICT DO NOTHING
	`, eventID, callback.Provider, callback.ProviderEventID, callback.ProviderReference, callback.EventType, callback.SignatureValid, callback.PayloadHash, payload)
	if err != nil {
		return PaymentIntent{}, err
	}

	intent, err := lockDepositByProviderReference(ctx, tx, callback.Provider, callback.ProviderReference)
	if err != nil {
		_ = markProviderEventInTx(ctx, tx, callback.Provider, callback.ProviderEventID, "ignored")
		_ = tx.Commit(ctx)
		return PaymentIntent{}, err
	}
	if tag.RowsAffected() == 0 {
		if intent.Status != DepositStatusCompleted && intent.Status != DepositStatusApproved {
			if err := tx.Commit(ctx); err != nil {
				return PaymentIntent{}, err
			}
			return PaymentIntent{}, ErrInvalidTransactionState
		}
		if err := tx.Commit(ctx); err != nil {
			return PaymentIntent{}, err
		}
		return intent, nil
	}
	if !callback.SignatureValid {
		if err := markProviderEventInTx(ctx, tx, callback.Provider, callback.ProviderEventID, "ignored"); err != nil {
			return PaymentIntent{}, err
		}
		if err := tx.Commit(ctx); err != nil {
			return PaymentIntent{}, err
		}
		return intent, nil
	}
	if intent.Status == DepositStatusCompleted || intent.Status == DepositStatusApproved {
		_ = markProviderEventInTx(ctx, tx, callback.Provider, callback.ProviderEventID, "duplicate")
		if err := tx.Commit(ctx); err != nil {
			return PaymentIntent{}, err
		}
		return intent, nil
	}
	if intent.Status != DepositStatusPendingProvider {
		if err := markProviderEventInTx(ctx, tx, callback.Provider, callback.ProviderEventID, "ignored"); err != nil {
			return PaymentIntent{}, err
		}
		if err := tx.Commit(ctx); err != nil {
			return PaymentIntent{}, err
		}
		return PaymentIntent{}, ErrInvalidTransactionState
	}
	if intent.ExpiresAt != nil && time.Now().After(*intent.ExpiresAt) {
		_, _ = tx.Exec(ctx, `
			UPDATE public.payment_intents
			SET status = 'expired',
			    updated_at = NOW()
			WHERE id = $1
		`, intent.ID)
		if err := markProviderEventInTx(ctx, tx, callback.Provider, callback.ProviderEventID, "ignored"); err != nil {
			return PaymentIntent{}, err
		}
		if err := tx.Commit(ctx); err != nil {
			return PaymentIntent{}, err
		}
		return PaymentIntent{}, ErrInvalidTransactionState
	}
	if !providerDepositStatusAllowsCredit(callback.Status) || callback.AmountMinor != intent.AmountMinor || callback.Currency != intent.Currency {
		if err := markProviderEventInTx(ctx, tx, callback.Provider, callback.ProviderEventID, "ignored"); err != nil {
			return PaymentIntent{}, err
		}
		if err := tx.Commit(ctx); err != nil {
			return PaymentIntent{}, err
		}
		return PaymentIntent{}, ErrInvalidLedgerEntry
	}

	accountType := defaultString(intent.WalletAccountType, AccountTypeRiderWallet)
	ownerRole := OwnerRoleRider
	if accountType == AccountTypeDriverWallet {
		ownerRole = OwnerRoleDriver
	}
	userAccount, err := ensureAccountInTx(ctx, tx, Account{
		ID:          deterministicAccountID(intent.UserID, accountType, intent.Currency),
		OwnerUserID: intent.UserID,
		OwnerRole:   ownerRole,
		AccountType: accountType,
		Currency:    intent.Currency,
		Status:      AccountStatusActive,
	})
	if err != nil {
		return PaymentIntent{}, err
	}
	clearing, err := ensureAccountInTx(ctx, tx, Account{
		ID:          deterministicAccountID(platformOwnerID, AccountTypeProviderClearing, intent.Currency),
		OwnerUserID: platformOwnerID,
		OwnerRole:   OwnerRolePlatform,
		AccountType: AccountTypeProviderClearing,
		Currency:    intent.Currency,
		Status:      AccountStatusActive,
	})
	if err != nil {
		return PaymentIntent{}, err
	}

	transaction := Transaction{
		ID:               uuidString("provider-deposit-transaction:" + intent.ID),
		TransactionType:  TransactionTypeDeposit,
		Status:           TransactionStatusPosted,
		IdempotencyKey:   defaultString(callback.IdempotencyKey, "provider-deposit:"+callback.Provider+":"+callback.ProviderEventID),
		Currency:         intent.Currency,
		TotalAmountMinor: intent.AmountMinor,
		SourceType:       "payment_intent",
		SourceID:         intent.ID,
		OwnerUserID:      intent.UserID,
		PaymentProvider:  callback.Provider,
		PaymentIntentID:  intent.ID,
		CreatedBy:        intent.UserID,
	}
	entries := []LedgerEntry{
		{ID: uuidString("provider-deposit-entry:" + transaction.ID + ":clearing"), TransactionID: transaction.ID, AccountID: clearing.ID, EntryType: EntryTypeDebit, AmountMinor: intent.AmountMinor, Currency: intent.Currency, SourceType: "payment_intent", SourceID: intent.ID, PaymentProvider: callback.Provider},
		{ID: uuidString("provider-deposit-entry:" + transaction.ID + ":wallet"), TransactionID: transaction.ID, AccountID: userAccount.ID, EntryType: EntryTypeCredit, AmountMinor: intent.AmountMinor, Currency: intent.Currency, SourceType: "payment_intent", SourceID: intent.ID, PaymentProvider: callback.Provider},
	}
	if err := ValidateBalancedTransaction(transaction, entries); err != nil {
		return PaymentIntent{}, err
	}
	if err := insertTransactionInTx(ctx, tx, transaction); err != nil {
		return PaymentIntent{}, err
	}
	for _, entry := range entries {
		if err := insertLedgerEntryInTx(ctx, tx, entry); err != nil {
			return PaymentIntent{}, err
		}
	}
	_, err = tx.Exec(ctx, `
		UPDATE public.wallet_accounts
		SET cached_available_balance = cached_available_balance + $2,
		    updated_at = NOW()
		WHERE id = $1
	`, userAccount.ID, MinorDecimalString(intent.AmountMinor, intent.Currency))
	if err != nil {
		return PaymentIntent{}, err
	}
	_, err = tx.Exec(ctx, `
		UPDATE public.wallet_accounts
		SET cached_available_balance = cached_available_balance - $2,
		    updated_at = NOW()
		WHERE id = $1
	`, clearing.ID, MinorDecimalString(intent.AmountMinor, intent.Currency))
	if err != nil {
		return PaymentIntent{}, err
	}
	_, err = tx.Exec(ctx, `
		UPDATE public.payment_intents
		SET status = 'completed',
		    approved_at = NOW(),
		    wallet_transaction_id = $2,
		    updated_at = NOW()
		WHERE id = $1
		  AND status = 'pending_provider_payment'
	`, intent.ID, transaction.ID)
	if err != nil {
		return PaymentIntent{}, err
	}
	if err := markProviderEventInTx(ctx, tx, callback.Provider, callback.ProviderEventID, "processed"); err != nil {
		return PaymentIntent{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return PaymentIntent{}, err
	}
	return r.GetDepositRequest(ctx, intent.ID)
}

func (r *PostgresRepository) RecordProviderCallbackDeadLetter(ctx context.Context, deadLetter ProviderCallbackDeadLetter) error {
	if deadLetter.Provider == "" {
		deadLetter.Provider = "unknown"
	}
	if deadLetter.Payload == "" {
		deadLetter.Payload = "{}"
	}
	if deadLetter.Reason == "" {
		deadLetter.Reason = "provider_callback_rejected"
	}
	metadata := fmt.Sprintf(
		`{"provider":"%s","provider_event_id":"%s","provider_reference":"%s","event_type":"%s","payload_hash":"%s","payload":%s}`,
		escapeJSONString(deadLetter.Provider),
		escapeJSONString(deadLetter.ProviderEventID),
		escapeJSONString(deadLetter.ProviderReference),
		escapeJSONString(deadLetter.EventType),
		escapeJSONString(deadLetter.PayloadHash),
		jsonRawOrString(deadLetter.Payload),
	)
	err := r.CreateFinancialJob(ctx, FinancialJob{
		JobType:        FinancialJobTypeProviderCallbackProcessing,
		Status:         FinancialJobStatusDeadLetter,
		SourceType:     "provider_callback",
		SourceID:       defaultString(deadLetter.ProviderEventID, deadLetter.ProviderReference),
		Provider:       deadLetter.Provider,
		IdempotencyKey: "provider-callback-dead-letter:" + deadLetter.Provider + ":" + defaultString(deadLetter.ProviderEventID, deadLetter.PayloadHash),
		FailureReason:  deadLetter.Reason,
		Metadata:       metadata,
	})
	return err
}

func providerDepositStatusAllowsCredit(status string) bool {
	switch strings.ToUpper(strings.TrimSpace(status)) {
	case "PAID", "SUCCESS", "COMPLETED", "SETTLED":
		return true
	default:
		return false
	}
}

func escapeJSONString(value string) string {
	value = strings.ReplaceAll(value, `\`, `\\`)
	value = strings.ReplaceAll(value, `"`, `\"`)
	value = strings.ReplaceAll(value, "\n", `\n`)
	value = strings.ReplaceAll(value, "\r", `\r`)
	value = strings.ReplaceAll(value, "\t", `\t`)
	return value
}

func jsonRawOrString(value string) string {
	trimmed := strings.TrimSpace(value)
	if (strings.HasPrefix(trimmed, "{") && strings.HasSuffix(trimmed, "}")) || (strings.HasPrefix(trimmed, "[") && strings.HasSuffix(trimmed, "]")) {
		return trimmed
	}
	return `"` + escapeJSONString(value) + `"`
}

func (r *PostgresRepository) GetDepositRequest(ctx context.Context, id string) (PaymentIntent, error) {
	var intent PaymentIntent
	err := r.db.QueryRow(ctx, `
		SELECT
			id::text,
			user_id::text,
			amount,
			currency,
			provider,
			payment_method,
			status,
			COALESCE(wallet_account_type, ''),
			COALESCE(provider_reference, ''),
			idempotency_key,
			expires_at,
			COALESCE(approved_by::text, ''),
			approved_at,
			COALESCE(rejected_by::text, ''),
			rejected_at,
			COALESCE(rejection_reason, ''),
			COALESCE(wallet_transaction_id::text, ''),
			created_at,
			updated_at
		FROM public.payment_intents
		WHERE id = $1
	`, id).Scan(
		&intent.ID,
		&intent.UserID,
		&intent.AmountMinor,
		&intent.Currency,
		&intent.Provider,
		&intent.PaymentMethod,
		&intent.Status,
		&intent.WalletAccountType,
		&intent.ProviderReference,
		&intent.IdempotencyKey,
		&intent.ExpiresAt,
		&intent.ApprovedBy,
		&intent.ApprovedAt,
		&intent.RejectedBy,
		&intent.RejectedAt,
		&intent.RejectionReason,
		&intent.WalletTransactionID,
		&intent.CreatedAt,
		&intent.UpdatedAt,
	)
	return intent, err
}

func (r *PostgresRepository) ApproveDepositRequest(ctx context.Context, id string, adminID string, transactionID string) (PaymentIntent, error) {
	commandTag, err := r.db.Exec(ctx, `
		UPDATE public.payment_intents
		SET status = 'approved',
		    approved_by = $2,
		    approved_at = NOW(),
		    wallet_transaction_id = $3,
		    updated_at = NOW()
		WHERE id = $1
		  AND status = 'pending_admin_approval'
	`, id, adminID, transactionID)
	if err != nil {
		return PaymentIntent{}, err
	}
	if commandTag.RowsAffected() == 0 {
		return PaymentIntent{}, ErrInvalidTransactionState
	}
	return r.GetDepositRequest(ctx, id)
}

func (r *PostgresRepository) RejectDepositRequest(ctx context.Context, id string, adminID string, reason string) (PaymentIntent, error) {
	commandTag, err := r.db.Exec(ctx, `
		UPDATE public.payment_intents
		SET status = 'rejected',
		    rejected_by = $2,
		    rejected_at = NOW(),
		    rejection_reason = $3,
		    updated_at = NOW()
		WHERE id = $1
		  AND status = 'pending_admin_approval'
	`, id, adminID, reason)
	if err != nil {
		return PaymentIntent{}, err
	}
	if commandTag.RowsAffected() == 0 {
		return PaymentIntent{}, ErrInvalidTransactionState
	}
	return r.GetDepositRequest(ctx, id)
}

func (r *PostgresRepository) CreateWithdrawalRequest(ctx context.Context, withdrawal WithdrawalRequest) error {
	_, err := r.db.Exec(ctx, `
		INSERT INTO public.withdrawal_requests (
			id,
			driver_id,
			wallet_account_id,
			amount,
			amount_minor,
			currency,
			provider,
			destination_reference,
			status,
			idempotency_key,
			requested_at,
			updated_at
		)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW(),NOW())
		ON CONFLICT (idempotency_key) DO NOTHING
	`, nullString(withdrawal.ID), withdrawal.DriverID, withdrawal.WalletAccountID, MinorDecimalString(withdrawal.AmountMinor, withdrawal.Currency), withdrawal.AmountMinor, withdrawal.Currency, withdrawal.Provider, withdrawal.DestinationReference, withdrawal.Status, withdrawal.IdempotencyKey)
	return err
}

func (r *PostgresRepository) GetWithdrawalRequest(ctx context.Context, id string) (WithdrawalRequest, error) {
	var withdrawal WithdrawalRequest
	err := r.db.QueryRow(ctx, `
		SELECT
			id::text,
			driver_id::text,
			wallet_account_id::text,
			amount_minor,
			currency,
			provider,
			destination_reference,
			status,
			idempotency_key,
			requested_at
		FROM public.withdrawal_requests
		WHERE id = $1
	`, id).Scan(
		&withdrawal.ID,
		&withdrawal.DriverID,
		&withdrawal.WalletAccountID,
		&withdrawal.AmountMinor,
		&withdrawal.Currency,
		&withdrawal.Provider,
		&withdrawal.DestinationReference,
		&withdrawal.Status,
		&withdrawal.IdempotencyKey,
		&withdrawal.RequestedAt,
	)
	return withdrawal, err
}

func (r *PostgresRepository) ApproveWithdrawalRequest(ctx context.Context, id string, adminID string, transactionID string) (WithdrawalRequest, error) {
	commandTag, err := r.db.Exec(ctx, `
		UPDATE public.withdrawal_requests
		SET status = 'approved',
		    approved_by = $2,
		    approved_at = NOW(),
		    wallet_transaction_id = $3,
		    updated_at = NOW()
		WHERE id = $1
		  AND status = 'pending_approval'
	`, id, adminID, transactionID)
	if err != nil {
		return WithdrawalRequest{}, err
	}
	if commandTag.RowsAffected() == 0 {
		return WithdrawalRequest{}, ErrInvalidTransactionState
	}
	return r.GetWithdrawalRequest(ctx, id)
}

func (r *PostgresRepository) RejectWithdrawalRequest(ctx context.Context, id string, adminID string, reason string) (WithdrawalRequest, error) {
	commandTag, err := r.db.Exec(ctx, `
		UPDATE public.withdrawal_requests
		SET status = 'rejected',
		    rejected_by = $2,
		    rejected_at = NOW(),
		    rejection_reason = $3,
		    updated_at = NOW()
		WHERE id = $1
		  AND status = 'pending_approval'
	`, id, adminID, reason)
	if err != nil {
		return WithdrawalRequest{}, err
	}
	if commandTag.RowsAffected() == 0 {
		return WithdrawalRequest{}, ErrInvalidTransactionState
	}
	return r.GetWithdrawalRequest(ctx, id)
}

func (r *PostgresRepository) CreateAdminAction(ctx context.Context, action AdminAction) error {
	_, err := r.db.Exec(ctx, `
		INSERT INTO public.wallet_admin_actions (
			id,
			admin_user_id,
			action,
			target_type,
			target_id,
			reason,
			previous_status,
			new_status,
			created_at
		)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
	`, nullString(action.ID), action.AdminUserID, action.Action, action.TargetType, action.TargetID, nullString(action.Reason), action.PreviousStatus, action.NewStatus)
	return err
}

func (r *PostgresRepository) ApproveDepositAtomically(ctx context.Context, decision AdminDecision) (PaymentIntent, error) {
	db, ok := r.db.(transactionalDB)
	if !ok {
		return PaymentIntent{}, fmt.Errorf("wallet repository database does not support transactions")
	}
	tx, err := db.Begin(ctx)
	if err != nil {
		return PaymentIntent{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	before, err := lockDepositRequestByID(ctx, tx, decision.TargetID)
	if err != nil {
		return PaymentIntent{}, err
	}
	if before.Status != DepositStatusPendingAdminApproval {
		return PaymentIntent{}, ErrInvalidTransactionState
	}
	accountType := defaultString(before.WalletAccountType, AccountTypeRiderWallet)
	ownerRole := OwnerRoleRider
	if accountType == AccountTypeDriverWallet {
		ownerRole = OwnerRoleDriver
	}
	userAccount, err := ensureAccountInTx(ctx, tx, Account{ID: deterministicAccountID(before.UserID, accountType, before.Currency), OwnerUserID: before.UserID, OwnerRole: ownerRole, AccountType: accountType, Currency: before.Currency, Status: AccountStatusActive})
	if err != nil {
		return PaymentIntent{}, err
	}
	clearing, err := ensureAccountInTx(ctx, tx, Account{ID: deterministicAccountID(platformOwnerID, AccountTypeProviderClearing, before.Currency), OwnerUserID: platformOwnerID, OwnerRole: OwnerRolePlatform, AccountType: AccountTypeProviderClearing, Currency: before.Currency, Status: AccountStatusActive})
	if err != nil {
		return PaymentIntent{}, err
	}
	transactionID := uuidString("deposit-approval:" + before.ID)
	transaction := Transaction{ID: transactionID, TransactionType: TransactionTypeDeposit, Status: TransactionStatusPosted, IdempotencyKey: "deposit-approval:" + before.ID, Currency: before.Currency, TotalAmountMinor: before.AmountMinor, SourceType: "payment_intent", SourceID: before.ID, OwnerUserID: before.UserID, PaymentProvider: "internal", PaymentIntentID: before.ID, CreatedBy: before.UserID, ApprovedBy: decision.AdminUserID}
	entries := []LedgerEntry{
		{ID: uuidString(transactionID + ":clearing"), TransactionID: transaction.ID, AccountID: clearing.ID, EntryType: EntryTypeDebit, AmountMinor: before.AmountMinor, Currency: before.Currency, SourceType: "payment_intent", SourceID: before.ID, PaymentProvider: "internal"},
		{ID: uuidString(transactionID + ":wallet"), TransactionID: transaction.ID, AccountID: userAccount.ID, EntryType: EntryTypeCredit, AmountMinor: before.AmountMinor, Currency: before.Currency, SourceType: "payment_intent", SourceID: before.ID, PaymentProvider: "internal"},
	}
	if err := ValidateBalancedTransaction(transaction, entries); err != nil {
		return PaymentIntent{}, err
	}
	if err := insertTransactionInTx(ctx, tx, transaction); err != nil {
		return PaymentIntent{}, err
	}
	for _, entry := range entries {
		if err := insertLedgerEntryInTx(ctx, tx, entry); err != nil {
			return PaymentIntent{}, err
		}
	}
	if _, err := tx.Exec(ctx, `UPDATE public.wallet_accounts SET cached_available_balance = cached_available_balance - $2, updated_at = NOW() WHERE id = $1`, clearing.ID, MinorDecimalString(before.AmountMinor, before.Currency)); err != nil {
		return PaymentIntent{}, err
	}
	if _, err := tx.Exec(ctx, `UPDATE public.wallet_accounts SET cached_available_balance = cached_available_balance + $2, updated_at = NOW() WHERE id = $1`, userAccount.ID, MinorDecimalString(before.AmountMinor, before.Currency)); err != nil {
		return PaymentIntent{}, err
	}
	tag, err := tx.Exec(ctx, `
		UPDATE public.payment_intents
		SET status = 'approved',
		    approved_by = $2,
		    approved_at = NOW(),
		    wallet_transaction_id = $3,
		    updated_at = NOW()
		WHERE id = $1
		  AND status = 'pending_admin_approval'
	`, before.ID, decision.AdminUserID, transaction.ID)
	if err != nil {
		return PaymentIntent{}, err
	}
	if tag.RowsAffected() == 0 {
		return PaymentIntent{}, ErrInvalidTransactionState
	}
	if err := insertAdminActionInTx(ctx, tx, AdminAction{ID: uuidString("admin-action:approve-deposit:" + before.ID), AdminUserID: decision.AdminUserID, Action: "approve_deposit", TargetType: "payment_intent", TargetID: before.ID, Reason: decision.Reason, PreviousStatus: before.Status, NewStatus: DepositStatusApproved}); err != nil {
		return PaymentIntent{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return PaymentIntent{}, err
	}
	return r.GetDepositRequest(ctx, before.ID)
}

func (r *PostgresRepository) ApproveWithdrawalAtomically(ctx context.Context, decision AdminDecision) (WithdrawalRequest, error) {
	db, ok := r.db.(transactionalDB)
	if !ok {
		return WithdrawalRequest{}, fmt.Errorf("wallet repository database does not support transactions")
	}
	tx, err := db.Begin(ctx)
	if err != nil {
		return WithdrawalRequest{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	before, err := lockWithdrawalRequestByID(ctx, tx, decision.TargetID)
	if err != nil {
		return WithdrawalRequest{}, err
	}
	if before.Status != WithdrawalStatusPendingApproval {
		return WithdrawalRequest{}, ErrInvalidTransactionState
	}
	driverAccount, err := lockAccount(ctx, tx, before.WalletAccountID)
	if err != nil {
		return WithdrawalRequest{}, err
	}
	if driverAccount.CachedAvailableBalanceMinor < before.AmountMinor {
		return WithdrawalRequest{}, ErrInsufficientFunds
	}
	clearing, err := ensureAccountInTx(ctx, tx, Account{ID: deterministicAccountID(platformOwnerID, AccountTypeProviderClearing, before.Currency), OwnerUserID: platformOwnerID, OwnerRole: OwnerRolePlatform, AccountType: AccountTypeProviderClearing, Currency: before.Currency, Status: AccountStatusActive})
	if err != nil {
		return WithdrawalRequest{}, err
	}
	transactionID := uuidString("withdrawal-approval:" + before.ID)
	transaction := Transaction{ID: transactionID, TransactionType: TransactionTypeWithdrawal, Status: TransactionStatusPosted, IdempotencyKey: "withdrawal-approval:" + before.ID, Currency: before.Currency, TotalAmountMinor: before.AmountMinor, SourceType: "withdrawal_request", SourceID: before.ID, OwnerUserID: before.DriverID, PaymentProvider: "internal", CreatedBy: before.DriverID, ApprovedBy: decision.AdminUserID}
	entries := []LedgerEntry{
		{ID: uuidString(transactionID + ":driver"), TransactionID: transaction.ID, AccountID: before.WalletAccountID, EntryType: EntryTypeDebit, AmountMinor: before.AmountMinor, Currency: before.Currency, SourceType: "withdrawal_request", SourceID: before.ID, PaymentProvider: "internal"},
		{ID: uuidString(transactionID + ":clearing"), TransactionID: transaction.ID, AccountID: clearing.ID, EntryType: EntryTypeCredit, AmountMinor: before.AmountMinor, Currency: before.Currency, SourceType: "withdrawal_request", SourceID: before.ID, PaymentProvider: "internal"},
	}
	if err := ValidateBalancedTransaction(transaction, entries); err != nil {
		return WithdrawalRequest{}, err
	}
	if err := insertTransactionInTx(ctx, tx, transaction); err != nil {
		return WithdrawalRequest{}, err
	}
	for _, entry := range entries {
		if err := insertLedgerEntryInTx(ctx, tx, entry); err != nil {
			return WithdrawalRequest{}, err
		}
	}
	if _, err := tx.Exec(ctx, `UPDATE public.wallet_accounts SET cached_available_balance = cached_available_balance - $2, updated_at = NOW() WHERE id = $1`, before.WalletAccountID, MinorDecimalString(before.AmountMinor, before.Currency)); err != nil {
		return WithdrawalRequest{}, err
	}
	if _, err := tx.Exec(ctx, `UPDATE public.wallet_accounts SET cached_available_balance = cached_available_balance + $2, updated_at = NOW() WHERE id = $1`, clearing.ID, MinorDecimalString(before.AmountMinor, before.Currency)); err != nil {
		return WithdrawalRequest{}, err
	}
	tag, err := tx.Exec(ctx, `
		UPDATE public.withdrawal_requests
		SET status = 'approved',
		    approved_by = $2,
		    approved_at = NOW(),
		    wallet_transaction_id = $3,
		    updated_at = NOW()
		WHERE id = $1
		  AND status = 'pending_approval'
	`, before.ID, decision.AdminUserID, transaction.ID)
	if err != nil {
		return WithdrawalRequest{}, err
	}
	if tag.RowsAffected() == 0 {
		return WithdrawalRequest{}, ErrInvalidTransactionState
	}
	if err := insertAdminActionInTx(ctx, tx, AdminAction{ID: uuidString("admin-action:approve-withdrawal:" + before.ID), AdminUserID: decision.AdminUserID, Action: "approve_withdrawal", TargetType: "withdrawal_request", TargetID: before.ID, Reason: decision.Reason, PreviousStatus: before.Status, NewStatus: WithdrawalStatusApproved}); err != nil {
		return WithdrawalRequest{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return WithdrawalRequest{}, err
	}
	return r.GetWithdrawalRequest(ctx, before.ID)
}

func (r *PostgresRepository) RejectDepositAtomically(ctx context.Context, decision AdminDecision) (PaymentIntent, error) {
	db, ok := r.db.(transactionalDB)
	if !ok {
		return PaymentIntent{}, fmt.Errorf("wallet repository database does not support transactions")
	}
	tx, err := db.Begin(ctx)
	if err != nil {
		return PaymentIntent{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	before, err := lockDepositRequestByID(ctx, tx, decision.TargetID)
	if err != nil {
		return PaymentIntent{}, err
	}
	if before.Status != DepositStatusPendingAdminApproval {
		return PaymentIntent{}, ErrInvalidTransactionState
	}
	tag, err := tx.Exec(ctx, `
		UPDATE public.payment_intents
		SET status = 'rejected',
		    rejected_by = $2,
		    rejected_at = NOW(),
		    rejection_reason = $3,
		    updated_at = NOW()
		WHERE id = $1
		  AND status = 'pending_admin_approval'
	`, before.ID, decision.AdminUserID, nullString(decision.Reason))
	if err != nil {
		return PaymentIntent{}, err
	}
	if tag.RowsAffected() == 0 {
		return PaymentIntent{}, ErrInvalidTransactionState
	}
	if err := insertAdminActionInTx(ctx, tx, AdminAction{ID: uuidString("admin-action:reject-deposit:" + before.ID), AdminUserID: decision.AdminUserID, Action: "reject_deposit", TargetType: "payment_intent", TargetID: before.ID, Reason: decision.Reason, PreviousStatus: before.Status, NewStatus: DepositStatusRejected}); err != nil {
		return PaymentIntent{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return PaymentIntent{}, err
	}
	return r.GetDepositRequest(ctx, before.ID)
}

func (r *PostgresRepository) RejectWithdrawalAtomically(ctx context.Context, decision AdminDecision) (WithdrawalRequest, error) {
	db, ok := r.db.(transactionalDB)
	if !ok {
		return WithdrawalRequest{}, fmt.Errorf("wallet repository database does not support transactions")
	}
	tx, err := db.Begin(ctx)
	if err != nil {
		return WithdrawalRequest{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	before, err := lockWithdrawalRequestByID(ctx, tx, decision.TargetID)
	if err != nil {
		return WithdrawalRequest{}, err
	}
	if before.Status != WithdrawalStatusPendingApproval {
		return WithdrawalRequest{}, ErrInvalidTransactionState
	}
	tag, err := tx.Exec(ctx, `
		UPDATE public.withdrawal_requests
		SET status = 'rejected',
		    rejected_by = $2,
		    rejected_at = NOW(),
		    rejection_reason = $3,
		    updated_at = NOW()
		WHERE id = $1
		  AND status = 'pending_approval'
	`, before.ID, decision.AdminUserID, nullString(decision.Reason))
	if err != nil {
		return WithdrawalRequest{}, err
	}
	if tag.RowsAffected() == 0 {
		return WithdrawalRequest{}, ErrInvalidTransactionState
	}
	if err := insertAdminActionInTx(ctx, tx, AdminAction{ID: uuidString("admin-action:reject-withdrawal:" + before.ID), AdminUserID: decision.AdminUserID, Action: "reject_withdrawal", TargetType: "withdrawal_request", TargetID: before.ID, Reason: decision.Reason, PreviousStatus: before.Status, NewStatus: WithdrawalStatusRejected}); err != nil {
		return WithdrawalRequest{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return WithdrawalRequest{}, err
	}
	return r.GetWithdrawalRequest(ctx, before.ID)
}

func (r *PostgresRepository) CreateTransfer(ctx context.Context, req TransferRequest) (TransferResult, error) {
	if req.SenderID == "" || req.ReceiverID == "" || req.SenderID == req.ReceiverID {
		return TransferResult{}, ErrInvalidLedgerEntry
	}
	if req.Currency == "" {
		req.Currency = CurrencyUSD
	}
	if _, err := NewPositiveMoneyFromMinor(req.AmountMinor, req.Currency); err != nil {
		return TransferResult{}, err
	}
	if err := ValidateIdempotencyKey(req.IdempotencyKey); err != nil {
		return TransferResult{}, err
	}
	db, ok := r.db.(transactionalDB)
	if !ok {
		return TransferResult{}, fmt.Errorf("wallet repository database does not support transactions")
	}
	tx, err := db.Begin(ctx)
	if err != nil {
		return TransferResult{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	sender, err := ensureAccountInTx(ctx, tx, Account{ID: deterministicAccountID(req.SenderID, AccountTypeRiderWallet, req.Currency), OwnerUserID: req.SenderID, OwnerRole: OwnerRoleRider, AccountType: AccountTypeRiderWallet, Currency: req.Currency, Status: AccountStatusActive})
	if err != nil {
		return TransferResult{}, err
	}
	if sender.CachedAvailableBalanceMinor < req.AmountMinor {
		return TransferResult{}, ErrInsufficientFunds
	}
	receiver, err := ensureAccountInTx(ctx, tx, Account{ID: deterministicAccountID(req.ReceiverID, AccountTypeRiderWallet, req.Currency), OwnerUserID: req.ReceiverID, OwnerRole: OwnerRoleRider, AccountType: AccountTypeRiderWallet, Currency: req.Currency, Status: AccountStatusActive})
	if err != nil {
		return TransferResult{}, err
	}
	transactionID := uuidString("wallet-transfer:" + req.IdempotencyKey)
	transaction := Transaction{ID: transactionID, TransactionType: TransactionTypeAdminAdjustment, Status: TransactionStatusPosted, IdempotencyKey: req.IdempotencyKey, Currency: req.Currency, TotalAmountMinor: req.AmountMinor, SourceType: "wallet_transfer", SourceID: req.ReceiverID, OwnerUserID: req.SenderID, PaymentProvider: "wallet", CreatedBy: req.SenderID}
	entries := []LedgerEntry{
		{ID: uuidString(transactionID + ":sender"), TransactionID: transaction.ID, AccountID: sender.ID, EntryType: EntryTypeDebit, AmountMinor: req.AmountMinor, Currency: req.Currency, SourceType: "wallet_transfer", SourceID: req.ReceiverID, PaymentProvider: "wallet"},
		{ID: uuidString(transactionID + ":receiver"), TransactionID: transaction.ID, AccountID: receiver.ID, EntryType: EntryTypeCredit, AmountMinor: req.AmountMinor, Currency: req.Currency, SourceType: "wallet_transfer", SourceID: req.SenderID, PaymentProvider: "wallet"},
	}
	if err := ValidateBalancedTransaction(transaction, entries); err != nil {
		return TransferResult{}, err
	}
	if err := insertTransactionInTx(ctx, tx, transaction); err != nil {
		if strings.Contains(err.Error(), "duplicate") {
			if err := tx.Commit(ctx); err != nil {
				return TransferResult{}, err
			}
			return TransferResult{TransactionID: transactionID, AmountMinor: req.AmountMinor, Currency: req.Currency, Reference: transactionID}, nil
		}
		return TransferResult{}, err
	}
	for _, entry := range entries {
		if err := insertLedgerEntryInTx(ctx, tx, entry); err != nil {
			return TransferResult{}, err
		}
	}
	if _, err := tx.Exec(ctx, `UPDATE public.wallet_accounts SET cached_available_balance = cached_available_balance - $2, updated_at = NOW() WHERE id = $1`, sender.ID, MinorDecimalString(req.AmountMinor, req.Currency)); err != nil {
		return TransferResult{}, err
	}
	if _, err := tx.Exec(ctx, `UPDATE public.wallet_accounts SET cached_available_balance = cached_available_balance + $2, updated_at = NOW() WHERE id = $1`, receiver.ID, MinorDecimalString(req.AmountMinor, req.Currency)); err != nil {
		return TransferResult{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return TransferResult{}, err
	}
	return TransferResult{TransactionID: transaction.ID, AmountMinor: req.AmountMinor, Currency: req.Currency, Reference: transaction.ID}, nil
}

func (r *PostgresRepository) PayRideFromWallet(ctx context.Context, req WalletPayRequest) (WalletPayResult, error) {
	if req.RiderID == "" || req.RideID == "" {
		return WalletPayResult{}, ErrInvalidLedgerEntry
	}
	req.IdempotencyKey = defaultString(req.IdempotencyKey, "frontend-pay-ride:"+req.RideID)
	if err := ValidateIdempotencyKey(req.IdempotencyKey); err != nil {
		return WalletPayResult{}, err
	}
	db, ok := r.db.(transactionalDB)
	if !ok {
		return WalletPayResult{}, fmt.Errorf("wallet repository database does not support transactions")
	}
	tx, err := db.Begin(ctx)
	if err != nil {
		return WalletPayResult{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if existing, err := lockSettlementByIdempotency(ctx, tx, walletSettlementIdempotencyKey(req.RideID)); err == nil {
		if existing.RiderID != req.RiderID {
			return WalletPayResult{}, ErrAuthorizationState
		}
		if err := tx.Commit(ctx); err != nil {
			return WalletPayResult{}, err
		}
		return WalletPayResult{SettlementID: existing.ID, AmountMinor: existing.FareMinor, Currency: CurrencyUSD, AlreadyPaid: true, Reference: existing.IdempotencyKey}, nil
	} else if err != pgx.ErrNoRows {
		return WalletPayResult{}, err
	}

	var riderID string
	var driverID string
	var fareDecimal string
	err = tx.QueryRow(ctx, `
		SELECT rider_id::text, COALESCE(driver_id::text, ''), COALESCE(estimated_fare, 0)
		FROM public.rides
		WHERE id = $1
		FOR UPDATE
	`, req.RideID).Scan(&riderID, &driverID, &fareDecimal)
	if err != nil {
		return WalletPayResult{}, err
	}
	if riderID != req.RiderID || driverID == "" {
		return WalletPayResult{}, ErrAuthorizationState
	}
	fare, err := NewPositiveMoneyFromDecimal(fareDecimal, CurrencyUSD)
	if err != nil {
		return WalletPayResult{}, err
	}
	calc, err := CalculateSettlement(fare.MinorUnits, CurrencyUSD)
	if err != nil {
		return WalletPayResult{}, err
	}
	riderWallet, err := lockAccount(ctx, tx, deterministicAccountID(req.RiderID, AccountTypeRiderWallet, CurrencyUSD))
	if err != nil {
		return WalletPayResult{}, err
	}
	if riderWallet.CachedAvailableBalanceMinor < calc.FareMinor {
		return WalletPayResult{}, ErrInsufficientFunds
	}
	driverWallet, err := ensureAccountInTx(ctx, tx, Account{ID: deterministicAccountID(driverID, AccountTypeDriverWallet, CurrencyUSD), OwnerUserID: driverID, OwnerRole: OwnerRoleDriver, AccountType: AccountTypeDriverWallet, Currency: CurrencyUSD, Status: AccountStatusActive})
	if err != nil {
		return WalletPayResult{}, err
	}
	platform, err := ensureAccountInTx(ctx, tx, Account{ID: deterministicAccountID(platformOwnerID, AccountTypePlatformWallet, CurrencyUSD), OwnerUserID: platformOwnerID, OwnerRole: OwnerRolePlatform, AccountType: AccountTypePlatformWallet, Currency: CurrencyUSD, Status: AccountStatusActive})
	if err != nil {
		return WalletPayResult{}, err
	}
	transaction := walletSettlementTransaction(CaptureRequest{RideID: req.RideID, RiderID: req.RiderID, DriverID: driverID, AmountMinor: calc.FareMinor, Currency: CurrencyUSD, IdempotencyKey: req.IdempotencyKey}, calc)
	entries := []LedgerEntry{
		walletSettlementEntry(transaction.ID, riderWallet.ID, EntryTypeDebit, calc.FareMinor, CaptureRequest{RideID: req.RideID, RiderID: req.RiderID, DriverID: driverID}, calc),
		walletSettlementEntry(transaction.ID, driverWallet.ID, EntryTypeCredit, calc.DriverEarningMinor, CaptureRequest{RideID: req.RideID, RiderID: req.RiderID, DriverID: driverID}, calc),
		walletSettlementEntry(transaction.ID, platform.ID, EntryTypeCredit, calc.PlatformFeeMinor, CaptureRequest{RideID: req.RideID, RiderID: req.RiderID, DriverID: driverID}, calc),
	}
	if err := ValidateBalancedTransaction(transaction, entries); err != nil {
		return WalletPayResult{}, err
	}
	if err := insertTransactionInTx(ctx, tx, transaction); err != nil {
		return WalletPayResult{}, err
	}
	for _, entry := range entries {
		if err := insertLedgerEntryInTx(ctx, tx, entry); err != nil {
			return WalletPayResult{}, err
		}
	}
	if _, err := tx.Exec(ctx, `UPDATE public.wallet_accounts SET cached_available_balance = cached_available_balance - $2, updated_at = NOW() WHERE id = $1`, riderWallet.ID, MinorDecimalString(calc.FareMinor, CurrencyUSD)); err != nil {
		return WalletPayResult{}, err
	}
	if _, err := tx.Exec(ctx, `UPDATE public.wallet_accounts SET cached_available_balance = cached_available_balance + $2, updated_at = NOW() WHERE id = $1`, driverWallet.ID, MinorDecimalString(calc.DriverEarningMinor, CurrencyUSD)); err != nil {
		return WalletPayResult{}, err
	}
	if _, err := tx.Exec(ctx, `UPDATE public.wallet_accounts SET cached_available_balance = cached_available_balance + $2, updated_at = NOW() WHERE id = $1`, platform.ID, MinorDecimalString(calc.PlatformFeeMinor, CurrencyUSD)); err != nil {
		return WalletPayResult{}, err
	}
	settlementID := uuidString(walletSettlementIdempotencyKey(req.RideID))
	if _, err := tx.Exec(ctx, `
		INSERT INTO public.settlement_records (
			id, ride_id, driver_id, rider_id, fare, fare_minor, platform_fee, platform_fee_minor,
			driver_earning, driver_earning_minor, payment_method, settlement_mode, status,
			wallet_transaction_id, idempotency_key, created_at, updated_at
		)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'wallet','active','settled',$11,$12,NOW(),NOW())
	`, settlementID, req.RideID, driverID, req.RiderID, MinorDecimalString(calc.FareMinor, CurrencyUSD), calc.FareMinor, MinorDecimalString(calc.PlatformFeeMinor, CurrencyUSD), calc.PlatformFeeMinor, MinorDecimalString(calc.DriverEarningMinor, CurrencyUSD), calc.DriverEarningMinor, transaction.ID, walletSettlementIdempotencyKey(req.RideID)); err != nil {
		return WalletPayResult{}, err
	}
	_, _ = tx.Exec(ctx, `UPDATE public.rides SET payment_status = 'paid', payment_method = 'wallet' WHERE id = $1`, req.RideID)
	if err := tx.Commit(ctx); err != nil {
		return WalletPayResult{}, err
	}
	return WalletPayResult{SettlementID: settlementID, AmountMinor: calc.FareMinor, Currency: CurrencyUSD, Reference: walletSettlementIdempotencyKey(req.RideID)}, nil
}

func (r *PostgresRepository) SetWalletPIN(ctx context.Context, req WalletPINRequest) error {
	if req.UserID == "" || len(strings.TrimSpace(req.PIN)) < 4 {
		return ErrInvalidLedgerEntry
	}
	sum := sha256.Sum256([]byte(req.UserID + ":" + req.PIN))
	_, err := r.db.Exec(ctx, `
		INSERT INTO public.wallet_pins (user_id, pin_hash, updated_at)
		VALUES ($1, $2, NOW())
		ON CONFLICT (user_id)
		DO UPDATE SET pin_hash = EXCLUDED.pin_hash, updated_at = NOW()
	`, req.UserID, hex.EncodeToString(sum[:]))
	return err
}

func (r *PostgresRepository) LookupUserByPickMeAccount(ctx context.Context, pickmeAccount string) (LookupUserResult, error) {
	pickmeAccount = strings.TrimSpace(pickmeAccount)
	if pickmeAccount == "" {
		return LookupUserResult{}, ErrInvalidLedgerEntry
	}
	for _, query := range []string{
		`SELECT p.id::text, COALESCE(to_jsonb(p)->>'full_name', to_jsonb(p)->>'name', ''), to_jsonb(p)->>'pickme_account' FROM public.profiles p WHERE to_jsonb(p)->>'pickme_account' = $1 LIMIT 1`,
		`SELECT u.id::text, COALESCE(to_jsonb(u)->>'full_name', to_jsonb(u)->>'name', ''), to_jsonb(u)->>'pickme_account' FROM public.users u WHERE to_jsonb(u)->>'pickme_account' = $1 LIMIT 1`,
		`SELECT id::text, COALESCE(raw_user_meta_data->>'full_name', raw_user_meta_data->>'name', email, ''), COALESCE(raw_user_meta_data->>'pickme_account', '') FROM auth.users WHERE raw_user_meta_data->>'pickme_account' = $1 LIMIT 1`,
	} {
		var result LookupUserResult
		err := r.db.QueryRow(ctx, query, pickmeAccount).Scan(&result.UserID, &result.FullName, &result.PickMeAccount)
		if err == nil {
			if result.PickMeAccount == "" {
				result.PickMeAccount = pickmeAccount
			}
			return result, nil
		}
	}
	return LookupUserResult{}, pgx.ErrNoRows
}

func (r *PostgresRepository) DriverSummary(ctx context.Context, driverID string) (map[string]any, error) {
	raw, err := queryJSON(ctx, r.db, `
		SELECT json_build_object(
			'driver_id', $1,
			'available_balance_minor', COALESCE((SELECT cached_available_balance FROM public.wallet_accounts WHERE owner_user_id = $1 AND account_type = 'driver_wallet' AND currency = 'USD'), 0),
			'pending_balance_minor', COALESCE((SELECT cached_pending_balance FROM public.wallet_accounts WHERE owner_user_id = $1 AND account_type = 'driver_wallet' AND currency = 'USD'), 0),
			'liability_balance_minor', COALESCE((SELECT cached_liability_balance FROM public.wallet_accounts WHERE owner_user_id = $1 AND account_type = 'cash_liability_wallet' AND currency = 'USD'), 0),
			'total_earnings_minor', COALESCE((SELECT SUM(driver_earning_minor) FROM public.settlement_records WHERE driver_id = $1 AND status IN ('settled','posted','liability_recorded')), 0),
			'currency', 'USD'
		)
	`, driverID)
	if err != nil {
		return nil, err
	}
	return rawToMap(raw)
}

func (r *PostgresRepository) DriverEarnings(ctx context.Context, driverID string, limit int) ([]map[string]any, error) {
	if limit <= 0 {
		limit = 50
	}
	rows, err := queryJSONRows(ctx, r.db, `
		SELECT json_build_object(
			'id', id,
			'ride_id', ride_id,
			'driver_id', driver_id,
			'fare_minor', fare_minor,
			'platform_fee_minor', platform_fee_minor,
			'driver_earning_minor', driver_earning_minor,
			'payment_method', payment_method,
			'status', status,
			'created_at', created_at,
			'currency', 'USD'
		)
		FROM public.settlement_records
		WHERE driver_id = $1
		ORDER BY created_at DESC
		LIMIT $2
	`, driverID, limit)
	return rawRowsToMaps(rows, err)
}

func (r *PostgresRepository) CreateSettlementRecord(ctx context.Context, settlement SettlementRecord) error {
	_, err := r.db.Exec(ctx, `
		INSERT INTO public.settlement_records (
			id,
			ride_id,
			driver_id,
			rider_id,
			fare,
			fare_minor,
			platform_fee,
			platform_fee_minor,
			driver_earning,
			driver_earning_minor,
			payment_method,
			settlement_mode,
			status,
			wallet_transaction_id,
			idempotency_key,
			error,
			created_at,
			updated_at
		)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,NOW(),NOW())
		ON CONFLICT (idempotency_key)
		DO UPDATE SET
			status = EXCLUDED.status,
			wallet_transaction_id = EXCLUDED.wallet_transaction_id,
			error = EXCLUDED.error,
			updated_at = NOW()
	`, nullString(settlement.ID), settlement.RideID, nullString(settlement.DriverID), nullString(settlement.RiderID), MinorDecimalString(settlement.FareMinor, settlement.Currency), settlement.FareMinor, MinorDecimalString(settlement.PlatformFeeMinor, settlement.Currency), settlement.PlatformFeeMinor, MinorDecimalString(settlement.DriverEarningMinor, settlement.Currency), settlement.DriverEarningMinor, settlement.PaymentMethod, settlement.SettlementMode, settlement.Status, nullString(settlement.WalletTransactionID), settlement.IdempotencyKey, nullString(settlement.Error))
	return err
}

func (r *PostgresRepository) PostActiveCashSettlement(ctx context.Context, ride CompletedRide, calc SettlementCalculation) (SettlementRecord, error) {
	db, ok := r.db.(transactionalDB)
	if !ok {
		return SettlementRecord{}, fmt.Errorf("wallet repository database does not support transactions")
	}
	tx, err := db.Begin(ctx)
	if err != nil {
		return SettlementRecord{}, err
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()

	idempotencyKey := activeCashSettlementIdempotencyKey(ride.RideID)
	settlementID := uuidString(idempotencyKey)
	_, err = tx.Exec(ctx, `
		INSERT INTO public.settlement_records (
			id,
			ride_id,
			driver_id,
			rider_id,
			fare,
			fare_minor,
			platform_fee,
			platform_fee_minor,
			driver_earning,
			driver_earning_minor,
			payment_method,
			settlement_mode,
			status,
			idempotency_key,
			created_at,
			updated_at
		)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'cash','active','pending',$11,NOW(),NOW())
		ON CONFLICT (idempotency_key) DO NOTHING
	`, settlementID, ride.RideID, nullString(ride.DriverID), nullString(ride.RiderID), MinorDecimalString(calc.FareMinor, calc.Currency), calc.FareMinor, MinorDecimalString(calc.PlatformFeeMinor, calc.Currency), calc.PlatformFeeMinor, MinorDecimalString(calc.DriverEarningMinor, calc.Currency), calc.DriverEarningMinor, idempotencyKey)
	if err != nil {
		return SettlementRecord{}, err
	}

	settlement, err := lockSettlementByIdempotency(ctx, tx, idempotencyKey)
	if err != nil {
		return SettlementRecord{}, err
	}
	if settlement.Status == SettlementStatusSettled || settlement.Status == SettlementStatusLiabilityRecorded || settlement.Status == SettlementStatusPosted {
		if err := tx.Commit(ctx); err != nil {
			return SettlementRecord{}, err
		}
		return settlement, nil
	}

	_, err = tx.Exec(ctx, `
		UPDATE public.settlement_records
		SET status = 'processing',
		    error = NULL,
		    updated_at = NOW()
		WHERE idempotency_key = $1
	`, idempotencyKey)
	if err != nil {
		return SettlementRecord{}, err
	}

	driverWallet, err := ensureAccountInTx(ctx, tx, Account{
		ID:          deterministicAccountID(ride.DriverID, AccountTypeDriverWallet, calc.Currency),
		OwnerUserID: ride.DriverID,
		OwnerRole:   OwnerRoleDriver,
		AccountType: AccountTypeDriverWallet,
		Currency:    calc.Currency,
		Status:      AccountStatusActive,
	})
	if err != nil {
		return SettlementRecord{}, err
	}
	platform, err := ensureAccountInTx(ctx, tx, Account{
		ID:          deterministicAccountID(platformOwnerID, AccountTypePlatformWallet, calc.Currency),
		OwnerUserID: platformOwnerID,
		OwnerRole:   OwnerRolePlatform,
		AccountType: AccountTypePlatformWallet,
		Currency:    calc.Currency,
		Status:      AccountStatusActive,
	})
	if err != nil {
		return SettlementRecord{}, err
	}

	debitAccount := driverWallet
	finalStatus := SettlementStatusSettled
	if driverWallet.CachedAvailableBalanceMinor < calc.PlatformFeeMinor {
		debitAccount, err = ensureAccountInTx(ctx, tx, Account{
			ID:          deterministicAccountID(ride.DriverID, AccountTypeCashLiabilityWallet, calc.Currency),
			OwnerUserID: ride.DriverID,
			OwnerRole:   OwnerRoleDriver,
			AccountType: AccountTypeCashLiabilityWallet,
			Currency:    calc.Currency,
			Status:      AccountStatusActive,
		})
		if err != nil {
			return SettlementRecord{}, err
		}
		finalStatus = SettlementStatusLiabilityRecorded
	}

	transaction := activeCashSettlementTransaction(ride, calc, calc.PlatformFeeMinor)
	entries := []LedgerEntry{
		activeCashSettlementEntry(transaction.ID, debitAccount.ID, EntryTypeDebit, calc.PlatformFeeMinor, ride, calc),
		activeCashSettlementEntry(transaction.ID, platform.ID, EntryTypeCredit, calc.PlatformFeeMinor, ride, calc),
	}
	if err := ValidateBalancedTransaction(transaction, entries); err != nil {
		return SettlementRecord{}, err
	}
	if err := insertTransactionInTx(ctx, tx, transaction); err != nil {
		return SettlementRecord{}, err
	}
	for _, entry := range entries {
		if err := insertLedgerEntryInTx(ctx, tx, entry); err != nil {
			return SettlementRecord{}, err
		}
	}

	if finalStatus == SettlementStatusSettled {
		_, err = tx.Exec(ctx, `
			UPDATE public.wallet_accounts
			SET cached_available_balance = cached_available_balance - $2,
			    updated_at = NOW()
			WHERE id = $1
		`, driverWallet.ID, MinorDecimalString(calc.PlatformFeeMinor, calc.Currency))
	} else {
		_, err = tx.Exec(ctx, `
			UPDATE public.wallet_accounts
			SET cached_liability_balance = cached_liability_balance + $2,
			    updated_at = NOW()
			WHERE id = $1
		`, debitAccount.ID, MinorDecimalString(calc.PlatformFeeMinor, calc.Currency))
	}
	if err != nil {
		return SettlementRecord{}, err
	}
	_, err = tx.Exec(ctx, `
		UPDATE public.wallet_accounts
		SET cached_available_balance = cached_available_balance + $2,
		    updated_at = NOW()
		WHERE id = $1
	`, platform.ID, MinorDecimalString(calc.PlatformFeeMinor, calc.Currency))
	if err != nil {
		return SettlementRecord{}, err
	}

	_, err = tx.Exec(ctx, `
		UPDATE public.settlement_records
		SET status = $2,
		    wallet_transaction_id = $3,
		    error = NULL,
		    updated_at = NOW()
		WHERE idempotency_key = $1
	`, idempotencyKey, finalStatus, transaction.ID)
	if err != nil {
		return SettlementRecord{}, err
	}
	settlement, err = lockSettlementByIdempotency(ctx, tx, idempotencyKey)
	if err != nil {
		return SettlementRecord{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return SettlementRecord{}, err
	}
	return settlement, nil
}

func (r *PostgresRepository) RecordActiveCashSettlementFailure(ctx context.Context, ride CompletedRide, calc SettlementCalculation, cause error) error {
	idempotencyKey := activeCashSettlementIdempotencyKey(ride.RideID)
	_, err := r.db.Exec(ctx, `
		INSERT INTO public.settlement_records (
			id,
			ride_id,
			driver_id,
			rider_id,
			fare,
			fare_minor,
			platform_fee,
			platform_fee_minor,
			driver_earning,
			driver_earning_minor,
			payment_method,
			settlement_mode,
			status,
			idempotency_key,
			error,
			created_at,
			updated_at
		)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'cash','active','failed',$11,$12,NOW(),NOW())
		ON CONFLICT (idempotency_key)
		DO UPDATE SET
			status = CASE
				WHEN public.settlement_records.status IN ('settled', 'liability_recorded', 'posted') THEN public.settlement_records.status
				ELSE 'failed'
			END,
			error = CASE
				WHEN public.settlement_records.status IN ('settled', 'liability_recorded', 'posted') THEN public.settlement_records.error
				ELSE EXCLUDED.error
			END,
			updated_at = NOW()
	`, uuidString(idempotencyKey+":failed"), ride.RideID, nullString(ride.DriverID), nullString(ride.RiderID), MinorDecimalString(calc.FareMinor, calc.Currency), calc.FareMinor, MinorDecimalString(calc.PlatformFeeMinor, calc.Currency), calc.PlatformFeeMinor, MinorDecimalString(calc.DriverEarningMinor, calc.Currency), calc.DriverEarningMinor, idempotencyKey, cause.Error())
	return err
}

func (r *PostgresRepository) AuthorizeRideFunds(ctx context.Context, req AuthorizationRequest, expiresAt time.Time) (WalletAuthorization, error) {
	db, ok := r.db.(transactionalDB)
	if !ok {
		return WalletAuthorization{}, fmt.Errorf("wallet repository database does not support transactions")
	}
	tx, err := db.Begin(ctx)
	if err != nil {
		return WalletAuthorization{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	existing, err := lockAuthorizationByRide(ctx, tx, req.RideID)
	if err == nil {
		if existing.RiderID != req.RiderID {
			return WalletAuthorization{}, ErrAuthorizationState
		}
		if err := tx.Commit(ctx); err != nil {
			return WalletAuthorization{}, err
		}
		return existing, nil
	}
	if err != pgx.ErrNoRows {
		return WalletAuthorization{}, err
	}

	riderWallet, err := ensureAccountInTx(ctx, tx, Account{
		ID:          deterministicAccountID(req.RiderID, AccountTypeRiderWallet, req.Currency),
		OwnerUserID: req.RiderID,
		OwnerRole:   OwnerRoleRider,
		AccountType: AccountTypeRiderWallet,
		Currency:    req.Currency,
		Status:      AccountStatusActive,
	})
	if err != nil {
		return WalletAuthorization{}, err
	}
	if riderWallet.CachedAvailableBalanceMinor < req.AmountMinor {
		return WalletAuthorization{}, ErrInsufficientFunds
	}

	authorization := WalletAuthorization{
		ID:              uuidString("authorization:" + req.RideID),
		RideID:          req.RideID,
		RiderID:         req.RiderID,
		WalletAccountID: riderWallet.ID,
		AmountMinor:     req.AmountMinor,
		Currency:        req.Currency,
		Status:          AuthorizationStatusAuthorized,
		IdempotencyKey:  req.IdempotencyKey,
		ExpiresAt:       expiresAt,
	}
	_, err = tx.Exec(ctx, `
		INSERT INTO public.wallet_authorizations (
			id,
			ride_id,
			rider_id,
			wallet_account_id,
			amount,
			amount_minor,
			currency,
			status,
			idempotency_key,
			expires_at,
			created_at,
			updated_at
		)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW(),NOW())
	`, authorization.ID, authorization.RideID, authorization.RiderID, authorization.WalletAccountID, MinorDecimalString(authorization.AmountMinor, authorization.Currency), authorization.AmountMinor, authorization.Currency, authorization.Status, authorization.IdempotencyKey, authorization.ExpiresAt)
	if err != nil {
		return WalletAuthorization{}, err
	}
	_, err = tx.Exec(ctx, `
		UPDATE public.wallet_accounts
		SET cached_available_balance = cached_available_balance - $2,
		    cached_pending_balance = cached_pending_balance + $2,
		    updated_at = NOW()
		WHERE id = $1
	`, riderWallet.ID, MinorDecimalString(req.AmountMinor, req.Currency))
	if err != nil {
		return WalletAuthorization{}, err
	}
	if err := insertAuthorizationEvent(ctx, tx, authorization.ID, "authorized", req.AmountMinor, req.IdempotencyKey, "ride wallet funds authorized"); err != nil {
		return WalletAuthorization{}, err
	}
	authorization, err = lockAuthorizationByRide(ctx, tx, req.RideID)
	if err != nil {
		return WalletAuthorization{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return WalletAuthorization{}, err
	}
	return authorization, nil
}

func (r *PostgresRepository) CaptureRideFunds(ctx context.Context, req CaptureRequest) (SettlementRecord, error) {
	db, ok := r.db.(transactionalDB)
	if !ok {
		return SettlementRecord{}, fmt.Errorf("wallet repository database does not support transactions")
	}
	tx, err := db.Begin(ctx)
	if err != nil {
		return SettlementRecord{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	authorization, err := lockAuthorizationByRide(ctx, tx, req.RideID)
	if err != nil {
		if err == pgx.ErrNoRows {
			return SettlementRecord{}, ErrAuthorizationNotFound
		}
		return SettlementRecord{}, err
	}
	if authorization.Status == AuthorizationStatusCaptured {
		if authorization.RiderID != req.RiderID {
			return SettlementRecord{}, ErrAuthorizationState
		}
		settlement, err := lockSettlementByIdempotency(ctx, tx, walletSettlementIdempotencyKey(req.RideID))
		if err != nil {
			return SettlementRecord{}, err
		}
		if err := tx.Commit(ctx); err != nil {
			return SettlementRecord{}, err
		}
		return settlement, nil
	}
	if authorization.Status != AuthorizationStatusAuthorized {
		return SettlementRecord{}, ErrAuthorizationState
	}
	if authorization.RiderID != req.RiderID {
		return SettlementRecord{}, ErrAuthorizationState
	}

	captureAmountMinor := req.AmountMinor
	remainingMinor := authorization.AmountMinor - authorization.CapturedAmountMinor - authorization.ReleasedAmountMinor
	if captureAmountMinor <= 0 {
		captureAmountMinor = remainingMinor
	}
	if captureAmountMinor <= 0 || captureAmountMinor > remainingMinor {
		return SettlementRecord{}, ErrAuthorizationState
	}
	calc, err := CalculateSettlement(captureAmountMinor, defaultString(req.Currency, authorization.Currency))
	if err != nil {
		return SettlementRecord{}, err
	}

	riderWallet, err := lockAccount(ctx, tx, authorization.WalletAccountID)
	if err != nil {
		return SettlementRecord{}, err
	}
	if riderWallet.CachedPendingBalanceMinor < calc.FareMinor {
		return SettlementRecord{}, ErrInsufficientFunds
	}
	driverWallet, err := ensureAccountInTx(ctx, tx, Account{
		ID:          deterministicAccountID(req.DriverID, AccountTypeDriverWallet, calc.Currency),
		OwnerUserID: req.DriverID,
		OwnerRole:   OwnerRoleDriver,
		AccountType: AccountTypeDriverWallet,
		Currency:    calc.Currency,
		Status:      AccountStatusActive,
	})
	if err != nil {
		return SettlementRecord{}, err
	}
	platform, err := ensureAccountInTx(ctx, tx, Account{
		ID:          deterministicAccountID(platformOwnerID, AccountTypePlatformWallet, calc.Currency),
		OwnerUserID: platformOwnerID,
		OwnerRole:   OwnerRolePlatform,
		AccountType: AccountTypePlatformWallet,
		Currency:    calc.Currency,
		Status:      AccountStatusActive,
	})
	if err != nil {
		return SettlementRecord{}, err
	}

	transaction := walletSettlementTransaction(req, calc)
	entries := []LedgerEntry{
		walletSettlementEntry(transaction.ID, riderWallet.ID, EntryTypeDebit, calc.FareMinor, req, calc),
		walletSettlementEntry(transaction.ID, driverWallet.ID, EntryTypeCredit, calc.DriverEarningMinor, req, calc),
		walletSettlementEntry(transaction.ID, platform.ID, EntryTypeCredit, calc.PlatformFeeMinor, req, calc),
	}
	if err := ValidateBalancedTransaction(transaction, entries); err != nil {
		return SettlementRecord{}, err
	}
	if err := insertTransactionInTx(ctx, tx, transaction); err != nil {
		return SettlementRecord{}, err
	}
	for _, entry := range entries {
		if err := insertLedgerEntryInTx(ctx, tx, entry); err != nil {
			return SettlementRecord{}, err
		}
	}

	unusedMinor := authorization.AmountMinor - captureAmountMinor
	_, err = tx.Exec(ctx, `
		UPDATE public.wallet_accounts
		SET cached_pending_balance = cached_pending_balance - $2,
		    cached_available_balance = cached_available_balance + $3,
		    updated_at = NOW()
		WHERE id = $1
	`, riderWallet.ID, MinorDecimalString(authorization.AmountMinor, authorization.Currency), MinorDecimalString(unusedMinor, authorization.Currency))
	if err != nil {
		return SettlementRecord{}, err
	}
	_, err = tx.Exec(ctx, `
		UPDATE public.wallet_accounts
		SET cached_available_balance = cached_available_balance + $2,
		    updated_at = NOW()
		WHERE id = $1
	`, driverWallet.ID, MinorDecimalString(calc.DriverEarningMinor, calc.Currency))
	if err != nil {
		return SettlementRecord{}, err
	}
	_, err = tx.Exec(ctx, `
		UPDATE public.wallet_accounts
		SET cached_available_balance = cached_available_balance + $2,
		    updated_at = NOW()
		WHERE id = $1
	`, platform.ID, MinorDecimalString(calc.PlatformFeeMinor, calc.Currency))
	if err != nil {
		return SettlementRecord{}, err
	}

	settlement := SettlementRecord{
		ID:                  uuidString(walletSettlementIdempotencyKey(req.RideID)),
		RideID:              req.RideID,
		DriverID:            req.DriverID,
		RiderID:             req.RiderID,
		FareMinor:           calc.FareMinor,
		PlatformFeeMinor:    calc.PlatformFeeMinor,
		DriverEarningMinor:  calc.DriverEarningMinor,
		Currency:            calc.Currency,
		PaymentMethod:       "wallet",
		SettlementMode:      SettlementModeActive,
		Status:              SettlementStatusSettled,
		WalletTransactionID: transaction.ID,
		IdempotencyKey:      walletSettlementIdempotencyKey(req.RideID),
	}
	_, err = tx.Exec(ctx, `
		INSERT INTO public.settlement_records (
			id,
			ride_id,
			driver_id,
			rider_id,
			fare,
			fare_minor,
			platform_fee,
			platform_fee_minor,
			driver_earning,
			driver_earning_minor,
			payment_method,
			settlement_mode,
			status,
			wallet_transaction_id,
			idempotency_key,
			created_at,
			updated_at
		)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,NOW(),NOW())
	`, settlement.ID, settlement.RideID, settlement.DriverID, settlement.RiderID, MinorDecimalString(settlement.FareMinor, settlement.Currency), settlement.FareMinor, MinorDecimalString(settlement.PlatformFeeMinor, settlement.Currency), settlement.PlatformFeeMinor, MinorDecimalString(settlement.DriverEarningMinor, settlement.Currency), settlement.DriverEarningMinor, settlement.PaymentMethod, settlement.SettlementMode, settlement.Status, settlement.WalletTransactionID, settlement.IdempotencyKey)
	if err != nil {
		return SettlementRecord{}, err
	}
	_, err = tx.Exec(ctx, `
		UPDATE public.wallet_authorizations
		SET status = 'captured',
		    captured_amount = $2,
		    captured_amount_minor = $3,
		    released_amount = $4,
		    released_amount_minor = $5,
		    updated_at = NOW()
		WHERE id = $1
	`, authorization.ID, MinorDecimalString(captureAmountMinor, authorization.Currency), captureAmountMinor, MinorDecimalString(unusedMinor, authorization.Currency), unusedMinor)
	if err != nil {
		return SettlementRecord{}, err
	}
	if err := insertAuthorizationEvent(ctx, tx, authorization.ID, "captured", captureAmountMinor, req.IdempotencyKey, "ride wallet authorization captured"); err != nil {
		return SettlementRecord{}, err
	}
	if unusedMinor > 0 {
		if err := insertAuthorizationEvent(ctx, tx, authorization.ID, "released_unused", unusedMinor, req.IdempotencyKey, "unused authorization amount released after capture"); err != nil {
			return SettlementRecord{}, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return SettlementRecord{}, err
	}
	return settlement, nil
}

func (r *PostgresRepository) ReleaseRideFunds(ctx context.Context, req ReleaseRequest) (WalletAuthorization, error) {
	db, ok := r.db.(transactionalDB)
	if !ok {
		return WalletAuthorization{}, fmt.Errorf("wallet repository database does not support transactions")
	}
	tx, err := db.Begin(ctx)
	if err != nil {
		return WalletAuthorization{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	authorization, err := lockAuthorizationByRide(ctx, tx, req.RideID)
	if err != nil {
		if err == pgx.ErrNoRows {
			return WalletAuthorization{}, ErrAuthorizationNotFound
		}
		return WalletAuthorization{}, err
	}
	if authorization.Status == AuthorizationStatusReleased || authorization.Status == AuthorizationStatusExpired {
		if authorization.RiderID != req.RiderID {
			return WalletAuthorization{}, ErrAuthorizationState
		}
		if err := tx.Commit(ctx); err != nil {
			return WalletAuthorization{}, err
		}
		return authorization, nil
	}
	if authorization.Status != AuthorizationStatusAuthorized {
		return WalletAuthorization{}, ErrAuthorizationState
	}
	if authorization.RiderID != req.RiderID {
		return WalletAuthorization{}, ErrAuthorizationState
	}
	releaseAmountMinor := authorization.AmountMinor - authorization.CapturedAmountMinor - authorization.ReleasedAmountMinor
	if err := releaseAuthorizationInTx(ctx, tx, authorization, AuthorizationStatusReleased, releaseAmountMinor, req.IdempotencyKey, defaultString(req.Reason, "ride authorization released")); err != nil {
		return WalletAuthorization{}, err
	}
	authorization, err = lockAuthorizationByRide(ctx, tx, req.RideID)
	if err != nil {
		return WalletAuthorization{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return WalletAuthorization{}, err
	}
	return authorization, nil
}

func (r *PostgresRepository) ExpireRideAuthorization(ctx context.Context, rideID string, now time.Time) (WalletAuthorization, error) {
	db, ok := r.db.(transactionalDB)
	if !ok {
		return WalletAuthorization{}, fmt.Errorf("wallet repository database does not support transactions")
	}
	tx, err := db.Begin(ctx)
	if err != nil {
		return WalletAuthorization{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	authorization, err := lockAuthorizationByRide(ctx, tx, rideID)
	if err != nil {
		if err == pgx.ErrNoRows {
			return WalletAuthorization{}, ErrAuthorizationNotFound
		}
		return WalletAuthorization{}, err
	}
	if authorization.Status != AuthorizationStatusAuthorized {
		if err := tx.Commit(ctx); err != nil {
			return WalletAuthorization{}, err
		}
		return authorization, nil
	}
	if now.Before(authorization.ExpiresAt) {
		return WalletAuthorization{}, ErrAuthorizationState
	}
	releaseAmountMinor := authorization.AmountMinor - authorization.CapturedAmountMinor - authorization.ReleasedAmountMinor
	if err := releaseAuthorizationInTx(ctx, tx, authorization, AuthorizationStatusExpired, releaseAmountMinor, "ride-expiration:"+rideID, "ride authorization expired"); err != nil {
		return WalletAuthorization{}, err
	}
	authorization, err = lockAuthorizationByRide(ctx, tx, rideID)
	if err != nil {
		return WalletAuthorization{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return WalletAuthorization{}, err
	}
	return authorization, nil
}

func (r *PostgresRepository) ExpireStaleAuthorizations(ctx context.Context, now time.Time, limit int) ([]WalletAuthorization, error) {
	rows, err := r.db.Query(ctx, `
		SELECT ride_id::text
		FROM public.wallet_authorizations
		WHERE status = 'authorized'
		  AND expires_at <= $1
		ORDER BY expires_at ASC
		LIMIT $2
	`, now, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var rideIDs []string
	for rows.Next() {
		var rideID string
		if err := rows.Scan(&rideID); err != nil {
			return nil, err
		}
		rideIDs = append(rideIDs, rideID)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	expired := make([]WalletAuthorization, 0, len(rideIDs))
	for _, rideID := range rideIDs {
		authorization, err := r.ExpireRideAuthorization(ctx, rideID, now)
		if err != nil {
			return expired, err
		}
		expired = append(expired, authorization)
	}
	return expired, nil
}

func (r *PostgresRepository) RunWalletReconciliation(ctx context.Context) (WalletReconciliationResult, error) {
	var result WalletReconciliationResult
	err := r.db.QueryRow(ctx, `
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
				SELECT
					wallet_account_id,
					SUM(amount - captured_amount - released_amount) AS open_hold_amount
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
			LEFT JOIN public.settlement_records s
			  ON s.ride_id = a.ride_id
			 AND s.payment_method = 'wallet'
			 AND s.settlement_mode = 'active'
			WHERE a.status = 'captured'
			  AND s.id IS NULL
			UNION ALL
			SELECT s.id
			FROM public.settlement_records s
			LEFT JOIN public.wallet_authorizations a
			  ON a.ride_id = s.ride_id
			 AND a.status = 'captured'
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
		SELECT
			(SELECT COUNT(*) FROM account_projection),
			(SELECT COUNT(*) FROM drift),
			(SELECT COUNT(*) FROM orphaned_authorizations),
			(SELECT COUNT(*) FROM settlement_mismatches),
			(SELECT COUNT(*) FROM liability_mismatches),
			(SELECT COUNT(*) FROM public.wallet_authorizations WHERE status = 'authorized'),
			(SELECT COUNT(*) FROM public.wallet_authorizations WHERE status = 'authorized' AND expires_at <= NOW())
	`).Scan(
		&result.CheckedAccountCount,
		&result.DriftCount,
		&result.OrphanedAuthorizationCount,
		&result.SettlementMismatchCount,
		&result.LiabilityMismatchCount,
		&result.OpenAuthorizationCount,
		&result.ExpiredAuthorizationCount,
	)
	if err != nil {
		return WalletReconciliationResult{}, err
	}

	result.RunID = uuidString(fmt.Sprintf("wallet-reconciliation:%d", time.Now().UnixNano()))
	result.Status = "completed"
	mismatchCount := result.DriftCount + result.OrphanedAuthorizationCount + result.SettlementMismatchCount + result.LiabilityMismatchCount
	if mismatchCount > 0 || result.ExpiredAuthorizationCount > 0 {
		result.Status = "requires_review"
	}
	matchedCount := result.CheckedAccountCount - mismatchCount
	if matchedCount < 0 {
		matchedCount = 0
	}
	_, err = r.db.Exec(ctx, `
		INSERT INTO public.reconciliation_runs (
			id,
			provider,
			run_type,
			status,
			started_at,
			completed_at,
			matched_count,
			mismatch_count,
			missing_provider_count,
			missing_ledger_count
		)
		VALUES ($1,'internal','ledger_balance',$2,NOW(),NOW(),$3,$4,$5,$6)
	`, result.RunID, result.Status, matchedCount, mismatchCount, result.OrphanedAuthorizationCount, result.DriftCount)
	if err != nil {
		return WalletReconciliationResult{}, err
	}
	result.CreatedAt = time.Now().UTC()
	return result, nil
}

func (r *PostgresRepository) GetPilotUser(ctx context.Context, userID string) (PilotUser, error) {
	var user PilotUser
	err := r.db.QueryRow(ctx, `
		SELECT
			id::text,
			user_id::text,
			role,
			status,
			COALESCE(group_name, ''),
			COALESCE(enabled_by::text, ''),
			COALESCE(disabled_by::text, ''),
			COALESCE(suspended_by::text, ''),
			COALESCE(removed_by::text, ''),
			COALESCE(reason, ''),
			created_at,
			updated_at
		FROM public.pilot_wallet_users
		WHERE user_id = $1
	`, userID).Scan(
		&user.ID,
		&user.UserID,
		&user.Role,
		&user.Status,
		&user.GroupName,
		&user.EnabledBy,
		&user.DisabledBy,
		&user.SuspendedBy,
		&user.RemovedBy,
		&user.Reason,
		&user.CreatedAt,
		&user.UpdatedAt,
	)
	return user, err
}

func (r *PostgresRepository) SetPilotUser(ctx context.Context, change PilotUserChange) (PilotUser, error) {
	if change.UserID == "" || change.AdminID == "" {
		return PilotUser{}, ErrInvalidLedgerEntry
	}
	id := uuidString("pilot-wallet-user:" + change.UserID)
	_, err := r.db.Exec(ctx, `
		INSERT INTO public.pilot_wallet_users (
			id,
			user_id,
			role,
			status,
			group_name,
			enabled_by,
			disabled_by,
			suspended_by,
			removed_by,
			reason,
			created_at,
			updated_at
		)
		VALUES (
			$1,$2,$3,$4,$5,
			CASE WHEN $4 = 'enabled' THEN $6 ELSE NULL END,
			CASE WHEN $4 = 'disabled' THEN $6 ELSE NULL END,
			CASE WHEN $4 = 'suspended' THEN $6 ELSE NULL END,
			CASE WHEN $4 = 'removed' THEN $6 ELSE NULL END,
			$7,NOW(),NOW()
		)
		ON CONFLICT (user_id)
		DO UPDATE SET
			role = EXCLUDED.role,
			status = EXCLUDED.status,
			group_name = EXCLUDED.group_name,
			enabled_by = CASE WHEN EXCLUDED.status = 'enabled' THEN $6 ELSE pilot_wallet_users.enabled_by END,
			disabled_by = CASE WHEN EXCLUDED.status = 'disabled' THEN $6 ELSE pilot_wallet_users.disabled_by END,
			suspended_by = CASE WHEN EXCLUDED.status = 'suspended' THEN $6 ELSE pilot_wallet_users.suspended_by END,
			removed_by = CASE WHEN EXCLUDED.status = 'removed' THEN $6 ELSE pilot_wallet_users.removed_by END,
			reason = EXCLUDED.reason,
			updated_at = NOW()
	`, id, change.UserID, change.Role, change.Status, nullString(change.GroupName), change.AdminID, nullString(change.Reason))
	if err != nil {
		return PilotUser{}, err
	}
	_, err = r.db.Exec(ctx, `
		INSERT INTO public.pilot_wallet_user_events (
			id,
			user_id,
			admin_user_id,
			action,
			role,
			status,
			group_name,
			reason,
			created_at
		)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
	`, uuidString("pilot-wallet-event:"+change.UserID+":"+change.Status+":"+fmt.Sprint(time.Now().UnixNano())), change.UserID, change.AdminID, "pilot_user_"+change.Status, change.Role, change.Status, nullString(change.GroupName), nullString(change.Reason))
	if err != nil {
		return PilotUser{}, err
	}
	return r.GetPilotUser(ctx, change.UserID)
}

func ensureAccountInTx(ctx context.Context, tx pgx.Tx, account Account) (Account, error) {
	if err := ValidateAccount(account); err != nil {
		return Account{}, err
	}
	_, err := tx.Exec(ctx, `
		INSERT INTO public.wallet_accounts (
			id,
			owner_user_id,
			owner_role,
			account_type,
			currency,
			status,
			cached_available_balance,
			cached_pending_balance,
			cached_liability_balance,
			created_at,
			updated_at
		)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW(),NOW())
		ON CONFLICT (id)
		DO UPDATE SET
			owner_user_id = EXCLUDED.owner_user_id,
			owner_role = EXCLUDED.owner_role,
			account_type = EXCLUDED.account_type,
			currency = EXCLUDED.currency,
			status = EXCLUDED.status,
			updated_at = NOW()
	`, nullString(account.ID), nullString(account.OwnerUserID), account.OwnerRole, account.AccountType, account.Currency, defaultString(account.Status, AccountStatusActive), account.CachedAvailableBalanceMinor, account.CachedPendingBalanceMinor, account.CachedLiabilityBalanceMinor)
	if err != nil {
		return Account{}, err
	}
	return lockAccount(ctx, tx, account.ID)
}

func lockAccount(ctx context.Context, tx pgx.Tx, accountID string) (Account, error) {
	var account Account
	err := tx.QueryRow(ctx, `
		SELECT
			id::text,
			COALESCE(owner_user_id::text, ''),
			owner_role,
			account_type,
			currency,
			status,
			cached_available_balance,
			cached_pending_balance,
			cached_liability_balance,
			created_at,
			updated_at
		FROM public.wallet_accounts
		WHERE id = $1
		FOR UPDATE
	`, accountID).Scan(
		&account.ID,
		&account.OwnerUserID,
		&account.OwnerRole,
		&account.AccountType,
		&account.Currency,
		&account.Status,
		&account.CachedAvailableBalanceMinor,
		&account.CachedPendingBalanceMinor,
		&account.CachedLiabilityBalanceMinor,
		&account.CreatedAt,
		&account.UpdatedAt,
	)
	return account, err
}

func lockSettlementByIdempotency(ctx context.Context, tx pgx.Tx, idempotencyKey string) (SettlementRecord, error) {
	var settlement SettlementRecord
	err := tx.QueryRow(ctx, `
		SELECT
			id::text,
			ride_id::text,
			COALESCE(driver_id::text, ''),
			COALESCE(rider_id::text, ''),
			fare_minor,
			platform_fee_minor,
			driver_earning_minor,
			payment_method,
			settlement_mode,
			status,
			COALESCE(wallet_transaction_id::text, ''),
			idempotency_key,
			COALESCE(error, ''),
			created_at,
			updated_at
		FROM public.settlement_records
		WHERE idempotency_key = $1
		FOR UPDATE
	`, idempotencyKey).Scan(
		&settlement.ID,
		&settlement.RideID,
		&settlement.DriverID,
		&settlement.RiderID,
		&settlement.FareMinor,
		&settlement.PlatformFeeMinor,
		&settlement.DriverEarningMinor,
		&settlement.PaymentMethod,
		&settlement.SettlementMode,
		&settlement.Status,
		&settlement.WalletTransactionID,
		&settlement.IdempotencyKey,
		&settlement.Error,
		&settlement.CreatedAt,
		&settlement.UpdatedAt,
	)
	return settlement, err
}

func insertTransactionInTx(ctx context.Context, tx pgx.Tx, transaction Transaction) error {
	if err := ValidateTransaction(transaction); err != nil {
		return err
	}
	_, err := tx.Exec(ctx, `
		INSERT INTO public.wallet_transactions (
			id,
			transaction_type,
			status,
			idempotency_key,
			currency,
			total_amount,
			source_type,
			source_id,
			owner_user_id,
			ride_id,
			payment_provider,
			payment_intent_id,
			created_by,
			approved_by,
			approved_at,
			created_at,
			updated_at
		)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,NOW(),NOW())
	`, nullString(transaction.ID), transaction.TransactionType, defaultString(transaction.Status, TransactionStatusPending), transaction.IdempotencyKey, transaction.Currency, transaction.TotalAmountMinor, nullString(transaction.SourceType), nullString(transaction.SourceID), nullString(transaction.OwnerUserID), nullString(transaction.RideID), nullString(transaction.PaymentProvider), nullString(transaction.PaymentIntentID), nullString(transaction.CreatedBy), nullString(transaction.ApprovedBy), transaction.ApprovedAt)
	return err
}

func insertLedgerEntryInTx(ctx context.Context, tx pgx.Tx, entry LedgerEntry) error {
	if err := ValidateLedgerEntry(entry); err != nil {
		return err
	}
	_, err := tx.Exec(ctx, `
		INSERT INTO public.wallet_ledger_entries (
			id,
			transaction_id,
			account_id,
			entry_type,
			amount_minor,
			currency,
			ride_id,
			source_type,
			source_id,
			payment_provider,
			created_at
		)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())
	`, nullString(entry.ID), entry.TransactionID, entry.AccountID, entry.EntryType, entry.AmountMinor, entry.Currency, nullString(entry.RideID), nullString(entry.SourceType), nullString(entry.SourceID), nullString(entry.PaymentProvider))
	return err
}

func lockAuthorizationByRide(ctx context.Context, tx pgx.Tx, rideID string) (WalletAuthorization, error) {
	var authorization WalletAuthorization
	err := tx.QueryRow(ctx, `
		SELECT
			id::text,
			ride_id::text,
			rider_id::text,
			wallet_account_id::text,
			amount,
			currency,
			status,
			idempotency_key,
			expires_at,
			captured_amount_minor,
			released_amount_minor,
			COALESCE(failure_reason, ''),
			created_at,
			updated_at
		FROM public.wallet_authorizations
		WHERE ride_id = $1
		FOR UPDATE
	`, rideID).Scan(
		&authorization.ID,
		&authorization.RideID,
		&authorization.RiderID,
		&authorization.WalletAccountID,
		&authorization.AmountMinor,
		&authorization.Currency,
		&authorization.Status,
		&authorization.IdempotencyKey,
		&authorization.ExpiresAt,
		&authorization.CapturedAmountMinor,
		&authorization.ReleasedAmountMinor,
		&authorization.FailureReason,
		&authorization.CreatedAt,
		&authorization.UpdatedAt,
	)
	return authorization, err
}

func lockDepositRequestByID(ctx context.Context, tx pgx.Tx, id string) (PaymentIntent, error) {
	var intent PaymentIntent
	err := tx.QueryRow(ctx, `
		SELECT
			id::text,
			user_id::text,
			amount_minor,
			currency,
			provider,
			payment_method,
			status,
			COALESCE(wallet_account_type, ''),
			COALESCE(provider_reference, ''),
			idempotency_key,
			expires_at,
			COALESCE(approved_by::text, ''),
			approved_at,
			COALESCE(rejected_by::text, ''),
			rejected_at,
			COALESCE(rejection_reason, ''),
			COALESCE(wallet_transaction_id::text, ''),
			created_at,
			updated_at
		FROM public.payment_intents
		WHERE id = $1
		FOR UPDATE
	`, id).Scan(
		&intent.ID,
		&intent.UserID,
		&intent.AmountMinor,
		&intent.Currency,
		&intent.Provider,
		&intent.PaymentMethod,
		&intent.Status,
		&intent.WalletAccountType,
		&intent.ProviderReference,
		&intent.IdempotencyKey,
		&intent.ExpiresAt,
		&intent.ApprovedBy,
		&intent.ApprovedAt,
		&intent.RejectedBy,
		&intent.RejectedAt,
		&intent.RejectionReason,
		&intent.WalletTransactionID,
		&intent.CreatedAt,
		&intent.UpdatedAt,
	)
	return intent, err
}

func lockWithdrawalRequestByID(ctx context.Context, tx pgx.Tx, id string) (WithdrawalRequest, error) {
	var withdrawal WithdrawalRequest
	err := tx.QueryRow(ctx, `
		SELECT
			id::text,
			driver_id::text,
			wallet_account_id::text,
			amount_minor,
			currency,
			provider,
			destination_reference,
			status,
			idempotency_key,
			requested_at
		FROM public.withdrawal_requests
		WHERE id = $1
		FOR UPDATE
	`, id).Scan(
		&withdrawal.ID,
		&withdrawal.DriverID,
		&withdrawal.WalletAccountID,
		&withdrawal.AmountMinor,
		&withdrawal.Currency,
		&withdrawal.Provider,
		&withdrawal.DestinationReference,
		&withdrawal.Status,
		&withdrawal.IdempotencyKey,
		&withdrawal.RequestedAt,
	)
	return withdrawal, err
}

func lockDepositByProviderReference(ctx context.Context, tx pgx.Tx, provider string, providerReference string) (PaymentIntent, error) {
	var intent PaymentIntent
	err := tx.QueryRow(ctx, `
		SELECT
			id::text,
			user_id::text,
			amount_minor,
			currency,
			provider,
			payment_method,
			status,
			COALESCE(wallet_account_type, ''),
			COALESCE(provider_reference, ''),
			idempotency_key,
			expires_at,
			COALESCE(approved_by::text, ''),
			approved_at,
			COALESCE(rejected_by::text, ''),
			rejected_at,
			COALESCE(rejection_reason, ''),
			COALESCE(wallet_transaction_id::text, ''),
			created_at,
			updated_at
		FROM public.payment_intents
		WHERE provider = $1
		  AND provider_reference = $2
		FOR UPDATE
	`, provider, providerReference).Scan(
		&intent.ID,
		&intent.UserID,
		&intent.AmountMinor,
		&intent.Currency,
		&intent.Provider,
		&intent.PaymentMethod,
		&intent.Status,
		&intent.WalletAccountType,
		&intent.ProviderReference,
		&intent.IdempotencyKey,
		&intent.ExpiresAt,
		&intent.ApprovedBy,
		&intent.ApprovedAt,
		&intent.RejectedBy,
		&intent.RejectedAt,
		&intent.RejectionReason,
		&intent.WalletTransactionID,
		&intent.CreatedAt,
		&intent.UpdatedAt,
	)
	return intent, err
}

func markProviderEventInTx(ctx context.Context, tx pgx.Tx, provider string, providerEventID string, status string) error {
	_, err := tx.Exec(ctx, `
		UPDATE public.provider_events
		SET status = $3,
		    processed_at = NOW()
		WHERE provider = $1
		  AND provider_event_id = $2
	`, provider, providerEventID, status)
	return err
}

func insertAdminActionInTx(ctx context.Context, tx pgx.Tx, action AdminAction) error {
	_, err := tx.Exec(ctx, `
		INSERT INTO public.wallet_admin_actions (
			id,
			admin_user_id,
			action,
			target_type,
			target_id,
			reason,
			previous_status,
			new_status,
			created_at
		)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
	`, nullString(action.ID), action.AdminUserID, action.Action, action.TargetType, action.TargetID, nullString(action.Reason), action.PreviousStatus, action.NewStatus)
	return err
}

func releaseAuthorizationInTx(ctx context.Context, tx pgx.Tx, authorization WalletAuthorization, status string, amountMinor int64, idempotencyKey string, reason string) error {
	if amountMinor <= 0 {
		return ErrAuthorizationState
	}
	wallet, err := lockAccount(ctx, tx, authorization.WalletAccountID)
	if err != nil {
		return err
	}
	if _, err := NewPositiveMoneyFromMinor(amountMinor, authorization.Currency); err != nil {
		return err
	}
	if wallet.CachedPendingBalanceMinor < amountMinor {
		return ErrInsufficientFunds
	}
	_, err = tx.Exec(ctx, `
		UPDATE public.wallet_accounts
		SET cached_available_balance = cached_available_balance + $2,
		    cached_pending_balance = cached_pending_balance - $2,
		    updated_at = NOW()
		WHERE id = $1
	`, authorization.WalletAccountID, MinorDecimalString(amountMinor, authorization.Currency))
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `
		UPDATE public.wallet_authorizations
		SET status = $2,
		    released_amount = released_amount + $3,
		    released_amount_minor = released_amount_minor + $4,
		    updated_at = NOW()
		WHERE id = $1
	`, authorization.ID, status, MinorDecimalString(amountMinor, authorization.Currency), amountMinor)
	if err != nil {
		return err
	}
	return insertAuthorizationEvent(ctx, tx, authorization.ID, status, amountMinor, idempotencyKey, reason)
}

func insertAuthorizationEvent(ctx context.Context, tx pgx.Tx, authorizationID string, eventType string, amountMinor int64, idempotencyKey string, reason string) error {
	_, err := tx.Exec(ctx, `
		INSERT INTO public.wallet_authorization_events (
			id,
			authorization_id,
			event_type,
			amount,
			amount_minor,
			idempotency_key,
			reason,
			created_at
		)
		VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
		ON CONFLICT (idempotency_key) DO NOTHING
	`, uuidString("authorization-event:"+idempotencyKey+":"+eventType), authorizationID, eventType, MinorDecimalString(amountMinor, CurrencyUSD), amountMinor, idempotencyKey+":"+eventType, nullString(reason))
	return err
}

func walletSettlementIdempotencyKey(rideID string) string {
	return "wallet-settlement:" + rideID
}

func walletSettlementTransaction(req CaptureRequest, calc SettlementCalculation) Transaction {
	return Transaction{
		ID:               uuidString("wallet-settlement-transaction:" + req.RideID),
		TransactionType:  TransactionTypeWalletSettlement,
		Currency:         calc.Currency,
		TotalAmountMinor: calc.FareMinor,
		Status:           TransactionStatusPosted,
		IdempotencyKey:   defaultString(req.IdempotencyKey, rideCaptureIdempotencyKey(req.RideID)),
		SourceType:       "ride",
		SourceID:         req.RideID,
		OwnerUserID:      req.RiderID,
		RideID:           req.RideID,
		PaymentProvider:  "wallet",
		CreatedBy:        req.RiderID,
	}
}

func walletSettlementEntry(transactionID string, accountID string, entryType string, amountMinor int64, req CaptureRequest, calc SettlementCalculation) LedgerEntry {
	return LedgerEntry{
		ID:              uuidString("wallet-settlement-entry:" + transactionID + ":" + accountID + ":" + entryType),
		TransactionID:   transactionID,
		AccountID:       accountID,
		EntryType:       entryType,
		AmountMinor:     amountMinor,
		Currency:        calc.Currency,
		RideID:          req.RideID,
		SourceType:      "ride",
		SourceID:        req.RideID,
		PaymentProvider: "wallet",
	}
}

func uuidString(seed string) string {
	return deterministicAccountID("system", seed, CurrencyUSD)
}

func validReconciliationStatus(value string) bool {
	switch value {
	case "pending", "running", "completed", "failed", "requires_review":
		return true
	default:
		return false
	}
}

func nullString(value string) any {
	if value == "" {
		return nil
	}
	return value
}
