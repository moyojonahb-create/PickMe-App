package wallet

import (
	"context"
	"errors"
	"time"
)

type FinancialJobStore interface {
	LeaseDueFinancialJobs(ctx context.Context, workerID string, now time.Time, limit int, lockFor time.Duration) ([]FinancialJob, error)
	MarkFinancialJobSucceeded(ctx context.Context, id string) error
	MarkFinancialJobFailed(ctx context.Context, id string, failureReason string, nextAttemptAt time.Time) error
	MarkFinancialJobDeadLettered(ctx context.Context, id string, failureReason string) error
}

type FinancialJobHandler func(ctx context.Context, job FinancialJob) error

type FinancialJobWorker struct {
	store        FinancialJobStore
	workerID     string
	handlers     map[string]FinancialJobHandler
	now          func() time.Time
	batchLimit   int
	lockFor      time.Duration
	retryBackoff time.Duration
}

func NewFinancialJobWorker(store FinancialJobStore, workerID string) *FinancialJobWorker {
	if workerID == "" {
		workerID = "financial-worker"
	}
	return &FinancialJobWorker{
		store:        store,
		workerID:     workerID,
		handlers:     map[string]FinancialJobHandler{},
		now:          func() time.Time { return time.Now().UTC() },
		batchLimit:   100,
		lockFor:      5 * time.Minute,
		retryBackoff: time.Minute,
	}
}

func (w *FinancialJobWorker) Register(jobType string, handler FinancialJobHandler) {
	if w == nil || handler == nil || jobType == "" {
		return
	}
	w.handlers[jobType] = handler
}

func (w *FinancialJobWorker) RunOnce(ctx context.Context) (int, error) {
	if w == nil || w.store == nil {
		return 0, nil
	}
	jobs, err := w.store.LeaseDueFinancialJobs(ctx, w.workerID, w.now(), w.batchLimit, w.lockFor)
	if err != nil {
		return 0, err
	}
	for _, job := range jobs {
		handler, ok := w.handlers[job.JobType]
		if !ok {
			err := errors.New("no handler registered for financial job type")
			if markErr := w.store.MarkFinancialJobDeadLettered(ctx, job.ID, err.Error()); markErr != nil {
				return 0, markErr
			}
			continue
		}
		if err := handler(ctx, job); err != nil {
			if job.AttemptCount >= job.MaxAttempts {
				if markErr := w.store.MarkFinancialJobDeadLettered(ctx, job.ID, err.Error()); markErr != nil {
					return 0, markErr
				}
				continue
			}
			nextAttempt := w.now().Add(time.Duration(job.AttemptCount) * w.retryBackoff)
			if markErr := w.store.MarkFinancialJobFailed(ctx, job.ID, err.Error(), nextAttempt); markErr != nil {
				return 0, markErr
			}
			continue
		}
		if err := w.store.MarkFinancialJobSucceeded(ctx, job.ID); err != nil {
			return 0, err
		}
	}
	return len(jobs), nil
}
