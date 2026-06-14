package wallet

import (
	"context"
	"testing"
	"time"
)

type fakeControlRoomRepo struct {
	snapshot ControlRoomSnapshot
	close    DailyFinanceClose
	review   DailyCloseReview
	metrics  DailyReliabilityMetrics
	pilot    PilotMonitoringSnapshot
}

func (f *fakeControlRoomRepo) CreateControlRoomSnapshot(ctx context.Context, snapshot ControlRoomSnapshot) (ControlRoomSnapshot, error) {
	f.snapshot = snapshot
	return snapshot, nil
}

func (f *fakeControlRoomRepo) CreateDailyFinanceClose(ctx context.Context, close DailyFinanceClose) (DailyFinanceClose, error) {
	f.close = close
	return close, nil
}

func (f *fakeControlRoomRepo) ReviewDailyClose(ctx context.Context, review DailyCloseReview) (DailyCloseReview, error) {
	f.review = review
	return review, nil
}

func (f *fakeControlRoomRepo) CreateDailyReliabilityMetrics(ctx context.Context, metrics DailyReliabilityMetrics) (DailyReliabilityMetrics, error) {
	f.metrics = metrics
	return metrics, nil
}

func (f *fakeControlRoomRepo) CreatePilotMonitoringSnapshot(ctx context.Context, snapshot PilotMonitoringSnapshot) (PilotMonitoringSnapshot, error) {
	f.pilot = snapshot
	return snapshot, nil
}

func TestControlRoomSnapshotRequiresHealthSignals(t *testing.T) {
	repo := &fakeControlRoomRepo{}
	service := NewControlRoomService(repo)

	_, err := service.CreateControlRoomSnapshot(context.Background(), ControlRoomSnapshot{
		SettlementHealth:      "green",
		ProviderHealth:        "green",
		ReconciliationHealth:  "green",
		AuthorizationHealth:   "green",
		LaunchReadinessHealth: "yellow",
		CreatedBy:             "admin-1",
	})
	if err != nil {
		t.Fatal(err)
	}
	if repo.snapshot.LaunchReadinessHealth != "yellow" {
		t.Fatalf("unexpected snapshot: %#v", repo.snapshot)
	}
}

func TestDailyCloseDefaultsOpenAndRequiresFinanceOrOperationsReview(t *testing.T) {
	repo := &fakeControlRoomRepo{}
	service := NewControlRoomService(repo)

	close, err := service.CreateDailyFinanceClose(context.Background(), DailyFinanceClose{CloseDate: time.Now(), ReconciliationStatus: "completed", OpenedBy: "admin-1"})
	if err != nil {
		t.Fatal(err)
	}
	if close.Status != DailyCloseStatusOpen {
		t.Fatalf("expected open close, got %#v", close)
	}
	_, err = service.ReviewDailyClose(context.Background(), DailyCloseReview{CloseID: "close-1", ReviewRole: "risk", ReviewerID: "admin-2", Status: "approved"})
	if err == nil {
		t.Fatal("expected non finance/operations review to be rejected")
	}
}

func TestDailyReliabilityMetricsAndPilotMonitoringValidation(t *testing.T) {
	repo := &fakeControlRoomRepo{}
	service := NewControlRoomService(repo)

	metrics, err := service.CreateDailyReliabilityMetrics(context.Background(), DailyReliabilityMetrics{
		MetricDate:                  time.Now(),
		SettlementSuccessRate:       99,
		ProviderCallbackSuccessRate: 98,
		ReconciliationSuccessRate:   100,
		RefundSuccessRate:           97,
		DisputeResolutionRate:       96,
		CreatedBy:                   "admin-1",
	})
	if err != nil {
		t.Fatal(err)
	}
	pilot, err := service.CreatePilotMonitoringSnapshot(context.Background(), PilotMonitoringSnapshot{PilotUsers: 3, PilotTransactions: 5, PilotDeposits: 2, PilotWithdrawals: 1, CreatedBy: "admin-1"})
	if err != nil {
		t.Fatal(err)
	}
	if metrics.SettlementSuccessRate != 99 || pilot.PilotUsers != 3 {
		t.Fatalf("unexpected metrics/pilot: %#v %#v", metrics, pilot)
	}
}
