package wallet

import (
	"context"
	"errors"
	"testing"
	"time"
)

type fakeFinancialJobStore struct {
	jobs         []FinancialJob
	succeeded    []string
	failed       []string
	deadLettered []string
}

func (f *fakeFinancialJobStore) LeaseDueFinancialJobs(ctx context.Context, workerID string, now time.Time, limit int, lockFor time.Duration) ([]FinancialJob, error) {
	return f.jobs, nil
}

func (f *fakeFinancialJobStore) MarkFinancialJobSucceeded(ctx context.Context, id string) error {
	f.succeeded = append(f.succeeded, id)
	return nil
}

func (f *fakeFinancialJobStore) MarkFinancialJobFailed(ctx context.Context, id string, failureReason string, nextAttemptAt time.Time) error {
	f.failed = append(f.failed, id)
	return nil
}

func (f *fakeFinancialJobStore) MarkFinancialJobDeadLettered(ctx context.Context, id string, failureReason string) error {
	f.deadLettered = append(f.deadLettered, id)
	return nil
}

func TestFinancialJobWorkerSuccessRetryAndDeadLetter(t *testing.T) {
	store := &fakeFinancialJobStore{jobs: []FinancialJob{
		{ID: "job-success", JobType: FinancialJobTypeWalletCapture, AttemptCount: 1, MaxAttempts: 3},
		{ID: "job-retry", JobType: FinancialJobTypeAuthorizationRelease, AttemptCount: 1, MaxAttempts: 3},
		{ID: "job-dead", JobType: FinancialJobTypeReconciliationRun, AttemptCount: 3, MaxAttempts: 3},
		{ID: "job-unhandled", JobType: FinancialJobTypeProviderCallbackProcessing, AttemptCount: 1, MaxAttempts: 3},
	}}
	worker := NewFinancialJobWorker(store, "worker-1")
	worker.Register(FinancialJobTypeWalletCapture, func(ctx context.Context, job FinancialJob) error {
		return nil
	})
	worker.Register(FinancialJobTypeAuthorizationRelease, func(ctx context.Context, job FinancialJob) error {
		return errors.New("temporary release failure")
	})
	worker.Register(FinancialJobTypeReconciliationRun, func(ctx context.Context, job FinancialJob) error {
		return errors.New("reconciliation failed")
	})

	processed, err := worker.RunOnce(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if processed != 4 {
		t.Fatalf("expected 4 processed jobs, got %d", processed)
	}
	if len(store.succeeded) != 1 || store.succeeded[0] != "job-success" {
		t.Fatalf("expected success marker for job-success, got %#v", store.succeeded)
	}
	if len(store.failed) != 1 || store.failed[0] != "job-retry" {
		t.Fatalf("expected retry marker for job-retry, got %#v", store.failed)
	}
	if len(store.deadLettered) != 2 {
		t.Fatalf("expected two dead-lettered jobs, got %#v", store.deadLettered)
	}
}
