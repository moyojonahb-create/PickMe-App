package jobs

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/hibiken/asynq"
)

type Runtime struct {
	cfg       Config
	redisOpt  asynq.RedisConnOpt
	server    *asynq.Server
	client    *Client
	inspector *asynq.Inspector
	done      chan error
	handlers  map[string]asynq.HandlerFunc
}

func NewRuntime(cfg Config) (*Runtime, error) {
	if !cfg.Enabled {
		return &Runtime{cfg: cfg}, nil
	}
	if cfg.RedisURL == "" {
		return nil, errors.New("ASYNQ_REDIS_URL or REDIS_URL is required when ASYNQ_ENABLED=true")
	}
	redisOpt, err := asynq.ParseRedisURI(cfg.RedisURL)
	if err != nil {
		return nil, err
	}
	concurrency := cfg.Concurrency
	if concurrency <= 0 {
		concurrency = 10
	}
	shutdownTimeout := time.Duration(cfg.ShutdownTimeoutSeconds) * time.Second
	if shutdownTimeout <= 0 {
		shutdownTimeout = 30 * time.Second
	}
	rt := &Runtime{
		cfg:       cfg,
		redisOpt:  redisOpt,
		inspector: asynq.NewInspector(redisOpt),
		done:      make(chan error, 1),
		handlers:  make(map[string]asynq.HandlerFunc),
	}
	rt.client = NewClient(redisOpt, cfg)
	rt.server = asynq.NewServer(redisOpt, asynq.Config{
		Concurrency: concurrency,
		Queues: map[string]int{
			QueueCritical: 6,
			QueueDefault:  3,
			QueueLow:      1,
		},
		RetryDelayFunc: func(n int, err error, task *asynq.Task) time.Duration {
			delay := time.Duration(1<<min(n, 6)) * time.Second
			if delay > time.Minute {
				return time.Minute
			}
			return delay
		},
		ErrorHandler:    asynq.ErrorHandlerFunc(handleTaskError),
		Logger:          structuredLogger{},
		LogLevel:        asynq.InfoLevel,
		ShutdownTimeout: shutdownTimeout,
		HealthCheckFunc: func(err error) {
			if err != nil {
				writeJobLog(map[string]any{"event": "asynq_redis_health_failure", "error": err.Error(), "timestamp": time.Now().UTC().Format(time.RFC3339Nano)})
			}
		},
	})
	return rt, nil
}

func (r *Runtime) Enabled() bool {
	return r != nil && r.cfg.Enabled && r.server != nil
}

func (r *Runtime) Client() *Client {
	if r == nil {
		return nil
	}
	return r.client
}

func (r *Runtime) HandleFunc(taskType string, handler asynq.HandlerFunc) {
	if r == nil || taskType == "" || handler == nil {
		return
	}
	if r.handlers == nil {
		r.handlers = make(map[string]asynq.HandlerFunc)
	}
	r.handlers[taskType] = handler
}

func (r *Runtime) Start() {
	if !r.Enabled() {
		return
	}
	go func() {
		writeJobLog(map[string]any{"event": "asynq_server_start", "queues": Queues, "timestamp": time.Now().UTC().Format(time.RFC3339Nano)})
		r.done <- r.server.Run(newMux(r.handlers))
	}()
}

func (r *Runtime) Done() <-chan error {
	if r == nil || r.done == nil {
		done := make(chan error)
		close(done)
		return done
	}
	return r.done
}

func (r *Runtime) Shutdown(ctx context.Context) error {
	if r == nil {
		return nil
	}
	if r.server != nil {
		r.server.Shutdown()
	}
	if r.client != nil {
		if err := r.client.Close(); err != nil {
			return err
		}
	}
	if r.done == nil {
		return nil
	}
	select {
	case err := <-r.done:
		return err
	case <-ctx.Done():
		return ctx.Err()
	default:
		return nil
	}
}

func (r *Runtime) Stats(ctx context.Context) (Stats, error) {
	stats := Stats{Enabled: r.Enabled(), Queues: make([]QueueStats, 0, len(Queues))}
	if !r.Enabled() || r.inspector == nil {
		return stats, nil
	}
	for _, queue := range Queues {
		info, err := r.inspector.GetQueueInfo(queue)
		if err != nil {
			return stats, err
		}
		stat := QueueStats{
			Queue:          info.Queue,
			Size:           info.Size,
			Pending:        info.Pending,
			Active:         info.Active,
			Scheduled:      info.Scheduled,
			Retry:          info.Retry,
			DeadLetter:     info.Archived,
			Completed:      info.Completed,
			Processed:      info.Processed,
			Failed:         info.Failed,
			ProcessedTotal: info.ProcessedTotal,
			FailedTotal:    info.FailedTotal,
			LatencySeconds: info.Latency.Seconds(),
			Paused:         info.Paused,
			Timestamp:      info.Timestamp,
		}
		recordQueueStats(stat)
		stats.Queues = append(stats.Queues, stat)
	}
	return stats, nil
}

func newMux(handlers map[string]asynq.HandlerFunc) *asynq.ServeMux {
	mux := asynq.NewServeMux()
	registerHandler(mux, handlers, TypeRideOfferRetry)
	registerHandler(mux, handlers, TypePushNotification)
	registerHandler(mux, handlers, TypeSMSNotification)
	registerHandler(mux, handlers, TypeEmailNotification)
	registerHandler(mux, handlers, TypeEmailReceipt)
	registerHandler(mux, handlers, TypeWalletReconciliation)
	registerHandler(mux, handlers, TypeFraudScan)
	registerHandler(mux, handlers, TypeRiskRecalculateUser)
	registerHandler(mux, handlers, TypeRiskMultiAccount)
	registerHandler(mux, handlers, TypeRiskWalletAbuse)
	registerHandler(mux, handlers, TypeRiskStudentAbuse)
	registerHandler(mux, handlers, TypeRiskGPSSpoofing)
	registerHandler(mux, handlers, TypeDriverCleanup)
	registerHandler(mux, handlers, TypeStudentVerification)
	return mux
}

func registerHandler(mux *asynq.ServeMux, handlers map[string]asynq.HandlerFunc, taskType string) {
	if handler, ok := handlers[taskType]; ok {
		mux.HandleFunc(taskType, handler)
		return
	}
	mux.HandleFunc(taskType, processJob)
}

func processJob(ctx context.Context, task *asynq.Task) error {
	var payload Payload
	if len(task.Payload()) > 0 {
		if err := json.Unmarshal(task.Payload(), &payload); err != nil {
			return err
		}
	}
	queue, _ := asynq.GetQueueName(ctx)
	if queue == "" {
		queue = QueueDefault
	}
	writeJobLog(map[string]any{
		"event":      "job_processed",
		"type":       task.Type(),
		"queue":      queue,
		"payload_id": payload.ID,
		"timestamp":  time.Now().UTC().Format(time.RFC3339Nano),
	})
	jobsProcessedTotal.WithLabelValues(task.Type(), queue).Inc()
	return nil
}

func handleTaskError(ctx context.Context, task *asynq.Task, err error) {
	queue, _ := asynq.GetQueueName(ctx)
	if queue == "" {
		queue = QueueDefault
	}
	retried, _ := asynq.GetRetryCount(ctx)
	maxRetry, _ := asynq.GetMaxRetry(ctx)
	jobsFailedTotal.WithLabelValues(task.Type(), queue).Inc()
	if maxRetry > 0 && retried >= maxRetry {
		jobsDeadLetterTotal.WithLabelValues(task.Type(), queue).Inc()
	}
	writeJobLog(map[string]any{
		"event":       "job_failed",
		"type":        task.Type(),
		"queue":       queue,
		"retried":     retried,
		"max_retry":   maxRetry,
		"error":       fmt.Sprint(err),
		"timestamp":   time.Now().UTC().Format(time.RFC3339Nano),
		"dead_letter": maxRetry > 0 && retried >= maxRetry,
	})
}
