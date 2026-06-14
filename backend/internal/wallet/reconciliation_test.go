package wallet

import (
	"context"
	"errors"
	"testing"
)

type fakeReconciliationRepo struct {
	result WalletReconciliationResult
	err    error
	calls  int
}

func (f *fakeReconciliationRepo) RunWalletReconciliation(ctx context.Context) (WalletReconciliationResult, error) {
	f.calls++
	if f.err != nil {
		return WalletReconciliationResult{}, f.err
	}
	return f.result, nil
}

func TestReconciliationServiceRunsRepository(t *testing.T) {
	repo := &fakeReconciliationRepo{result: WalletReconciliationResult{RunID: "run-1", Status: "completed", CheckedAccountCount: 3}}
	service := NewReconciliationService(repo)

	result, err := service.RunWalletReconciliation(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if result.RunID != "run-1" || result.CheckedAccountCount != 3 || repo.calls != 1 {
		t.Fatalf("unexpected reconciliation result: %#v calls=%d", result, repo.calls)
	}
}

func TestReconciliationServicePropagatesErrors(t *testing.T) {
	expected := errors.New("db unavailable")
	service := NewReconciliationService(&fakeReconciliationRepo{err: expected})

	_, err := service.RunWalletReconciliation(context.Background())
	if !errors.Is(err, expected) {
		t.Fatalf("expected reconciliation error, got %v", err)
	}
}

func TestNilReconciliationServiceIsNoop(t *testing.T) {
	service := NewReconciliationService(nil)
	result, err := service.RunWalletReconciliation(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if result.RunID != "" {
		t.Fatalf("nil reconciliation service should return zero result, got %#v", result)
	}
}
