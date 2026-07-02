package jobs

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/hibiken/asynq"
)

type Client struct {
	client   *asynq.Client
	enabled  bool
	retryMax int
}

func NewClient(redisOpt asynq.RedisConnOpt, cfg Config) *Client {
	retryMax := cfg.RetryMax
	if retryMax <= 0 {
		retryMax = 5
	}
	return &Client{
		client:   asynq.NewClient(redisOpt),
		enabled:  cfg.Enabled,
		retryMax: retryMax,
	}
}

func (c *Client) Close() error {
	if c == nil || c.client == nil {
		return nil
	}
	return c.client.Close()
}

func (c *Client) EnqueueRideOfferRetry(ctx context.Context, payload Payload) (*asynq.TaskInfo, error) {
	return c.Enqueue(ctx, TypeRideOfferRetry, QueueCritical, payload)
}

func (c *Client) EnqueuePushNotification(ctx context.Context, payload Payload) (*asynq.TaskInfo, error) {
	return c.Enqueue(ctx, TypePushNotification, QueueDefault, payload)
}

func (c *Client) EnqueueSMSNotification(ctx context.Context, payload Payload) (*asynq.TaskInfo, error) {
	return c.Enqueue(ctx, TypeSMSNotification, QueueDefault, payload)
}

func (c *Client) EnqueueEmailReceipt(ctx context.Context, payload Payload) (*asynq.TaskInfo, error) {
	return c.Enqueue(ctx, TypeEmailNotification, QueueLow, payload)
}

func (c *Client) EnqueueWalletReconciliation(ctx context.Context, payload Payload) (*asynq.TaskInfo, error) {
	return c.Enqueue(ctx, TypeWalletReconciliation, QueueCritical, payload)
}

func (c *Client) EnqueueFraudScan(ctx context.Context, payload Payload) (*asynq.TaskInfo, error) {
	return c.Enqueue(ctx, TypeFraudScan, QueueCritical, payload)
}

func (c *Client) EnqueueDriverCleanup(ctx context.Context, payload Payload) (*asynq.TaskInfo, error) {
	return c.Enqueue(ctx, TypeDriverCleanup, QueueLow, payload)
}

func (c *Client) EnqueueStudentVerification(ctx context.Context, payload Payload) (*asynq.TaskInfo, error) {
	return c.Enqueue(ctx, TypeStudentVerification, QueueDefault, payload)
}

func (c *Client) Enqueue(ctx context.Context, taskType string, queue string, payload Payload) (*asynq.TaskInfo, error) {
	if c == nil || c.client == nil || !c.enabled {
		return nil, errors.New("jobs client is disabled")
	}
	if queue == "" {
		queue = QueueDefault
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	task := asynq.NewTask(taskType, raw)
	info, err := c.client.EnqueueContext(ctx, task,
		asynq.Queue(queue),
		asynq.MaxRetry(c.retryMax),
		asynq.Timeout(2*time.Minute),
		asynq.Retention(72*time.Hour),
	)
	if err != nil {
		return nil, err
	}
	jobsEnqueuedTotal.WithLabelValues(taskType, queue).Inc()
	return info, nil
}
