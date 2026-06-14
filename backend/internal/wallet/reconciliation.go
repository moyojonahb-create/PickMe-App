package wallet

import "context"

type WalletReconciliationRepository interface {
	RunWalletReconciliation(ctx context.Context) (WalletReconciliationResult, error)
}

type ReconciliationService struct {
	repo WalletReconciliationRepository
}

func NewReconciliationService(repo WalletReconciliationRepository) *ReconciliationService {
	return &ReconciliationService{repo: repo}
}

func (s *ReconciliationService) RunWalletReconciliation(ctx context.Context) (WalletReconciliationResult, error) {
	if s == nil || s.repo == nil {
		return WalletReconciliationResult{}, nil
	}
	result, err := s.repo.RunWalletReconciliation(ctx)
	if err == nil && result.Status == "requires_review" {
		if observer, ok := s.repo.(FinancialJobRepository); ok {
			_ = observer.CreateFinancialJob(ctx, FinancialJob{
				JobType:        FinancialJobTypeReconciliationRun,
				Status:         FinancialJobStatusPending,
				SourceType:     "reconciliation_run",
				SourceID:       result.RunID,
				Provider:       "internal",
				IdempotencyKey: "reconciliation-review:" + result.RunID,
				Metadata:       "{}",
			})
			_ = observer.RecordFinancialMetric(ctx, FinancialMetric{
				MetricType:    FinancialMetricReconciliationDrift,
				Provider:      "internal",
				ReferenceType: "reconciliation_run",
				ReferenceID:   result.RunID,
				Value:         result.DriftCount,
				Metadata:      "{}",
			})
		}
	}
	return result, err
}
