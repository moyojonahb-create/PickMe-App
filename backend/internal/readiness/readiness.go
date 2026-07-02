package readiness

import (
	"context"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5/pgxpool"

	"pickme-backend/internal/jobs"
	redisclient "pickme-backend/internal/redis"
)

type RedisDependency interface {
	Enabled() bool
	Health(ctx context.Context) redisclient.Health
}

type JobsDependency interface {
	Enabled() bool
	Stats(ctx context.Context) (jobs.Stats, error)
}

type Config struct {
	Postgres             *pgxpool.Pool
	Redis                RedisDependency
	Jobs                 JobsDependency
	Profile              string
	DispatchMode         string
	NotificationFCM      string
	NotificationSMS      string
	NotificationEmail    string
	PostgresTimeout      time.Duration
	QueueSaturationLimit int
}

type Checker struct {
	cfg Config
}

type DependencyStatus struct {
	Name      string         `json:"name"`
	Status    string         `json:"status"`
	Ready     bool           `json:"ready"`
	LatencyMS float64        `json:"latency_ms,omitempty"`
	Error     string         `json:"error,omitempty"`
	Details   map[string]any `json:"details,omitempty"`
}

type Snapshot struct {
	Status       string             `json:"status"`
	Ready        bool               `json:"ready"`
	Score        int                `json:"score"`
	GeneratedAt  time.Time          `json:"generated_at"`
	Dependencies []DependencyStatus `json:"dependencies"`
}

func NewChecker(cfg Config) *Checker {
	if cfg.QueueSaturationLimit <= 0 {
		cfg.QueueSaturationLimit = 10000
	}
	if cfg.PostgresTimeout <= 0 {
		cfg.PostgresTimeout = 2 * time.Second
	}
	if strings.TrimSpace(cfg.Profile) == "" {
		cfg.Profile = "local"
	}
	return &Checker{cfg: cfg}
}

func LiveHandler() fiber.Handler {
	return func(c *fiber.Ctx) error {
		return c.JSON(fiber.Map{
			"status":       "live",
			"generated_at": time.Now().UTC(),
		})
	}
}

func ReadyHandler(checker *Checker) fiber.Handler {
	return func(c *fiber.Ctx) error {
		snapshot := checker.Check(c.Context())
		if !snapshot.Ready {
			return c.Status(fiber.StatusServiceUnavailable).JSON(snapshot)
		}
		return c.JSON(snapshot)
	}
}

func DependenciesHandler(checker *Checker) fiber.Handler {
	return func(c *fiber.Ctx) error {
		return c.JSON(checker.Check(c.Context()))
	}
}

func (c *Checker) Check(ctx context.Context) Snapshot {
	if c == nil {
		pilotReadinessScore.Set(0)
		dependencyFailuresTotal.WithLabelValues("checker").Inc()
		systemDegradationEventsTotal.WithLabelValues("checker", "not_configured").Inc()
		return Snapshot{
			Status:      "unhealthy",
			Ready:       false,
			Score:       0,
			GeneratedAt: time.Now().UTC(),
			Dependencies: []DependencyStatus{{
				Name:   "checker",
				Status: "not_configured",
				Ready:  false,
				Error:  "readiness checker is not configured",
			}},
		}
	}

	dependencies := []DependencyStatus{
		c.checkPostgres(ctx),
		c.checkRedis(ctx),
		c.checkJobs(ctx),
		c.checkNotification(),
		c.checkDispatch(),
	}
	score := 100
	ready := true
	for _, dep := range dependencies {
		if !dep.Ready {
			ready = false
			score -= 20
			reason := dep.Status
			if reason == "" {
				reason = "unhealthy"
			}
			dependencyFailuresTotal.WithLabelValues(dep.Name).Inc()
			systemDegradationEventsTotal.WithLabelValues(dep.Name, reason).Inc()
		}
	}
	if score < 0 {
		score = 0
	}
	pilotReadinessScore.Set(float64(score))

	status := "ready"
	if !ready {
		status = "degraded"
	}
	return Snapshot{
		Status:       status,
		Ready:        ready,
		Score:        score,
		GeneratedAt:  time.Now().UTC(),
		Dependencies: dependencies,
	}
}

func (c *Checker) checkPostgres(ctx context.Context) DependencyStatus {
	if c.cfg.Postgres == nil {
		return DependencyStatus{Name: "postgresql", Status: "not_configured", Ready: false}
	}
	checkCtx, cancel := context.WithTimeout(ctx, c.cfg.PostgresTimeout)
	defer cancel()
	acquireStart := time.Now()
	conn, err := c.cfg.Postgres.Acquire(checkCtx)
	acquireMS := millis(acquireStart)
	if err != nil {
		return DependencyStatus{Name: "postgresql", Status: "unhealthy", Ready: false, LatencyMS: acquireMS, Error: err.Error(), Details: postgresStats(c.cfg.Postgres, acquireMS, 0, c.cfg.PostgresTimeout)}
	}
	defer conn.Release()
	queryStart := time.Now()
	if err := conn.Ping(checkCtx); err != nil {
		return DependencyStatus{Name: "postgresql", Status: "unhealthy", Ready: false, LatencyMS: acquireMS + millis(queryStart), Error: err.Error(), Details: postgresStats(c.cfg.Postgres, acquireMS, millis(queryStart), c.cfg.PostgresTimeout)}
	}
	return DependencyStatus{
		Name:      "postgresql",
		Status:    "ok",
		Ready:     true,
		LatencyMS: acquireMS + millis(queryStart),
		Details:   postgresStats(c.cfg.Postgres, acquireMS, millis(queryStart), c.cfg.PostgresTimeout),
	}
}

func (c *Checker) checkRedis(ctx context.Context) DependencyStatus {
	if c.cfg.Redis == nil || !c.cfg.Redis.Enabled() {
		return DependencyStatus{Name: "redis", Status: "disabled", Ready: !c.pilotProfile()}
	}
	health := c.cfg.Redis.Health(ctx)
	status := DependencyStatus{
		Name:      "redis",
		Status:    "ok",
		Ready:     health.Connected,
		LatencyMS: health.LatencyMS,
		Details: map[string]any{
			"enabled": health.Enabled,
		},
	}
	if !health.Connected {
		status.Status = "unhealthy"
		status.Error = health.Error
	}
	return status
}

func (c *Checker) checkJobs(ctx context.Context) DependencyStatus {
	if c.cfg.Jobs == nil || !c.cfg.Jobs.Enabled() {
		return DependencyStatus{Name: "asynq", Status: "disabled", Ready: !c.pilotProfile()}
	}
	stats, err := c.cfg.Jobs.Stats(ctx)
	if err != nil {
		return DependencyStatus{Name: "asynq", Status: "unhealthy", Ready: false, Error: err.Error()}
	}
	totalDepth := 0
	deadLetter := 0
	for _, queue := range stats.Queues {
		totalDepth += queue.Pending + queue.Active + queue.Scheduled + queue.Retry
		deadLetter += queue.DeadLetter
	}
	status := "ok"
	ready := true
	if totalDepth >= c.cfg.QueueSaturationLimit {
		status = "saturated"
		ready = false
	}
	return DependencyStatus{
		Name:   "asynq",
		Status: status,
		Ready:  ready,
		Details: map[string]any{
			"enabled":             stats.Enabled,
			"queue_depth":         totalDepth,
			"dead_letter":         deadLetter,
			"saturation_limit":    c.cfg.QueueSaturationLimit,
			"queues_configured":   len(stats.Queues),
			"critical_queue_name": jobs.QueueCritical,
		},
	}
}

func (c *Checker) checkNotification() DependencyStatus {
	providers := map[string]string{
		"push":  providerMode(c.cfg.NotificationFCM),
		"sms":   providerMode(c.cfg.NotificationSMS),
		"email": providerMode(c.cfg.NotificationEmail),
	}
	mode := aggregateProviderMode(providers)
	ready := true
	status := "ok"
	if c.pilotProfile() && mode == "noop" {
		ready = false
		status = "noop"
	}
	return DependencyStatus{
		Name:   "notification",
		Status: status,
		Ready:  ready,
		Details: map[string]any{
			"providers": providers,
			"mode":      mode,
		},
	}
}

func (c *Checker) checkDispatch() DependencyStatus {
	mode := strings.TrimSpace(c.cfg.DispatchMode)
	if mode == "" {
		mode = "off"
	}
	ready := true
	status := "ok"
	if c.pilotProfile() && strings.EqualFold(mode, "off") {
		ready = false
		status = "off"
	}
	return DependencyStatus{
		Name:   "dispatch",
		Status: status,
		Ready:  ready,
		Details: map[string]any{
			"mode": mode,
		},
	}
}

func (c *Checker) pilotProfile() bool {
	profile := strings.ToLower(strings.TrimSpace(c.cfg.Profile))
	return profile == "pilot" || profile == "staging-pilot" || profile == "production"
}

func providerMode(endpoint string) string {
	if strings.TrimSpace(endpoint) == "" {
		return "noop"
	}
	return "configured"
}

func aggregateProviderMode(providers map[string]string) string {
	for _, mode := range providers {
		if mode == "configured" {
			return "provider"
		}
	}
	return "noop"
}

func millis(start time.Time) float64 {
	return float64(time.Since(start).Microseconds()) / 1000
}

func postgresStats(pool *pgxpool.Pool, acquireMS float64, queryMS float64, timeout time.Duration) map[string]any {
	stats := pool.Stat()
	return map[string]any{
		"acquire_latency_ms":        acquireMS,
		"query_latency_ms":          queryMS,
		"timeout_ms":                timeout.Milliseconds(),
		"acquired_connections":      stats.AcquiredConns(),
		"idle_connections":          stats.IdleConns(),
		"total_connections":         stats.TotalConns(),
		"max_connections":           stats.MaxConns(),
		"constructing_connections":  stats.ConstructingConns(),
		"acquire_count":             stats.AcquireCount(),
		"acquire_duration_ms_total": float64(stats.AcquireDuration().Microseconds()) / 1000,
		"empty_acquire_count":       stats.EmptyAcquireCount(),
		"canceled_acquire_count":    stats.CanceledAcquireCount(),
		"pooler_guidance":           "For Supabase, compare direct database latency with pooler latency; use direct/session pooling for prepared statement cache or set PGX_QUERY_EXEC_MODE=describe_exec for transaction pooler.",
	}
}
