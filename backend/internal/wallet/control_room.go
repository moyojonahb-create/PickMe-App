package wallet

import "context"

type ControlRoomRepository interface {
	CreateControlRoomSnapshot(ctx context.Context, snapshot ControlRoomSnapshot) (ControlRoomSnapshot, error)
	CreateDailyFinanceClose(ctx context.Context, close DailyFinanceClose) (DailyFinanceClose, error)
	ReviewDailyClose(ctx context.Context, review DailyCloseReview) (DailyCloseReview, error)
	CreateDailyReliabilityMetrics(ctx context.Context, metrics DailyReliabilityMetrics) (DailyReliabilityMetrics, error)
	CreatePilotMonitoringSnapshot(ctx context.Context, snapshot PilotMonitoringSnapshot) (PilotMonitoringSnapshot, error)
}

type ControlRoomService struct {
	repo ControlRoomRepository
}

func NewControlRoomService(repo ControlRoomRepository) *ControlRoomService {
	return &ControlRoomService{repo: repo}
}

func (s *ControlRoomService) CreateControlRoomSnapshot(ctx context.Context, snapshot ControlRoomSnapshot) (ControlRoomSnapshot, error) {
	if s == nil || s.repo == nil {
		return ControlRoomSnapshot{}, nil
	}
	if snapshot.SettlementHealth == "" || snapshot.ProviderHealth == "" || snapshot.ReconciliationHealth == "" || snapshot.AuthorizationHealth == "" || snapshot.LaunchReadinessHealth == "" || snapshot.CreatedBy == "" {
		return ControlRoomSnapshot{}, ErrInvalidLedgerEntry
	}
	return s.repo.CreateControlRoomSnapshot(ctx, snapshot)
}

func (s *ControlRoomService) CreateDailyFinanceClose(ctx context.Context, close DailyFinanceClose) (DailyFinanceClose, error) {
	if s == nil || s.repo == nil {
		return DailyFinanceClose{}, nil
	}
	if close.CloseDate.IsZero() || close.OpenedBy == "" || close.ReconciliationStatus == "" {
		return DailyFinanceClose{}, ErrInvalidLedgerEntry
	}
	if close.Status == "" {
		close.Status = DailyCloseStatusOpen
	}
	return s.repo.CreateDailyFinanceClose(ctx, close)
}

func (s *ControlRoomService) ReviewDailyClose(ctx context.Context, review DailyCloseReview) (DailyCloseReview, error) {
	if s == nil || s.repo == nil {
		return DailyCloseReview{}, nil
	}
	if review.CloseID == "" || review.ReviewRole == "" || review.ReviewerID == "" || review.Status == "" {
		return DailyCloseReview{}, ErrInvalidLedgerEntry
	}
	if review.ReviewRole != "finance" && review.ReviewRole != "operations" {
		return DailyCloseReview{}, ErrInvalidLedgerEntry
	}
	if review.Status != "approved" && review.Status != "rejected" && review.Status != "pending" {
		return DailyCloseReview{}, ErrInvalidLedgerEntry
	}
	return s.repo.ReviewDailyClose(ctx, review)
}

func (s *ControlRoomService) CreateDailyReliabilityMetrics(ctx context.Context, metrics DailyReliabilityMetrics) (DailyReliabilityMetrics, error) {
	if s == nil || s.repo == nil {
		return DailyReliabilityMetrics{}, nil
	}
	if metrics.MetricDate.IsZero() || metrics.CreatedBy == "" {
		return DailyReliabilityMetrics{}, ErrInvalidLedgerEntry
	}
	for _, score := range []int{metrics.SettlementSuccessRate, metrics.ProviderCallbackSuccessRate, metrics.ReconciliationSuccessRate, metrics.RefundSuccessRate, metrics.DisputeResolutionRate} {
		if score < 0 || score > 100 {
			return DailyReliabilityMetrics{}, ErrInvalidLedgerEntry
		}
	}
	return s.repo.CreateDailyReliabilityMetrics(ctx, metrics)
}

func (s *ControlRoomService) CreatePilotMonitoringSnapshot(ctx context.Context, snapshot PilotMonitoringSnapshot) (PilotMonitoringSnapshot, error) {
	if s == nil || s.repo == nil {
		return PilotMonitoringSnapshot{}, nil
	}
	if snapshot.CreatedBy == "" || snapshot.PilotUsers < 0 || snapshot.PilotTransactions < 0 || snapshot.PilotDeposits < 0 || snapshot.PilotWithdrawals < 0 || snapshot.PilotFailures < 0 {
		return PilotMonitoringSnapshot{}, ErrInvalidLedgerEntry
	}
	return s.repo.CreatePilotMonitoringSnapshot(ctx, snapshot)
}
