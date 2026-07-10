package middleware

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"log"
	"sync"
	"time"

	"github.com/gofiber/fiber/v2"

	"pickme-backend/internal/observability"
)

const (
	LocalsRequestID = "request_id"
	RequestIDHeader = "X-Request-ID"
)

func RequestID() fiber.Handler {
	return func(c *fiber.Ctx) error {
		requestID := c.Get(RequestIDHeader)
		if requestID == "" {
			requestID = newRequestID()
		}
		c.Locals(LocalsRequestID, requestID)
		c.Set(RequestIDHeader, requestID)
		return c.Next()
	}
}

func Recover() fiber.Handler {
	return func(c *fiber.Ctx) (err error) {
		defer func() {
			if recovered := recover(); recovered != nil {
				observability.CapturePanic(recovered)
				requestID, _ := c.Locals(LocalsRequestID).(string)
				log.Printf("HTTP_PANIC_RECOVERED request_id=%s method=%s path=%s timestamp=%s",
					requestID,
					c.Method(),
					c.Path(),
					time.Now().UTC().Format(time.RFC3339),
				)
				err = c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "internal_server_error"})
			}
		}()
		return c.Next()
	}
}

func RequestTimeout(timeout time.Duration) fiber.Handler {
	if timeout <= 0 {
		timeout = 15 * time.Second
	}
	return func(c *fiber.Ctx) error {
		parent := c.UserContext()
		if parent == nil {
			parent = context.Background()
		}
		ctx, cancel := context.WithTimeout(parent, timeout)
		defer cancel()
		c.SetUserContext(ctx)
		return c.Next()
	}
}

func RequestContext(c *fiber.Ctx) context.Context {
	if c == nil {
		return context.Background()
	}
	if ctx := c.UserContext(); ctx != nil {
		return ctx
	}
	return c.Context()
}

type RateLimitConfig struct {
	Max        int
	Window     time.Duration
	KeyFunc    func(*fiber.Ctx) string
	StatusCode int
	Store      RateLimitStore
	KeyPrefix  string
}

type RateLimitStore interface {
	Enabled() bool
	IncrWithTTL(ctx context.Context, key string, ttl time.Duration) (int64, error)
}

func GlobalRateLimit(cfg RateLimitConfig) fiber.Handler {
	if cfg.Max <= 0 {
		cfg.Max = 120
	}
	if cfg.Window <= 0 {
		cfg.Window = time.Minute
	}
	if cfg.StatusCode == 0 {
		cfg.StatusCode = fiber.StatusTooManyRequests
	}
	if cfg.KeyFunc == nil {
		cfg.KeyFunc = func(c *fiber.Ctx) string {
			if subject, ok := AuthenticatedUserID(c); ok {
				return "user:" + subject
			}
			return "ip:" + c.IP()
		}
	}
	if cfg.KeyPrefix == "" {
		cfg.KeyPrefix = "http:global"
	}

	limiter := &fixedWindowLimiter{
		max:    cfg.Max,
		window: cfg.Window,
		hits:   map[string]rateLimitEntry{},
	}
	go limiter.startCleanup(cfg.Window)

	return func(c *fiber.Ctx) error {
		key := cfg.KeyFunc(c)
		if key == "" {
			key = "ip:" + c.IP()
		}
		now := time.Now()
		allowed, remaining, resetAt := allowRequest(cfg, limiter, key, now, c)
		c.Set("X-RateLimit-Limit", intString(cfg.Max))
		c.Set("X-RateLimit-Remaining", intString(remaining))
		c.Set("X-RateLimit-Reset", resetAt.UTC().Format(time.RFC3339))
		if !allowed {
			requestID, _ := c.Locals(LocalsRequestID).(string)
			log.Printf("HTTP_RATE_LIMIT_REJECTED request_id=%s key=%s method=%s path=%s timestamp=%s",
				requestID,
				key,
				c.Method(),
				c.Path(),
				time.Now().UTC().Format(time.RFC3339),
			)
			return c.Status(cfg.StatusCode).JSON(fiber.Map{"error": "rate_limited"})
		}
		return c.Next()
	}
}

func allowRequest(cfg RateLimitConfig, limiter *fixedWindowLimiter, key string, now time.Time, c *fiber.Ctx) (bool, int, time.Time) {
	if cfg.Store != nil && cfg.Store.Enabled() {
		redisKey := cfg.KeyPrefix + ":" + key
		count, err := cfg.Store.IncrWithTTL(RequestContext(c), redisKey, cfg.Window)
		if err == nil && count > 0 {
			remaining := cfg.Max - int(count)
			if remaining < 0 {
				remaining = 0
			}
			return count <= int64(cfg.Max), remaining, now.Add(cfg.Window)
		}
		requestID, _ := c.Locals(LocalsRequestID).(string)
		log.Printf("HTTP_RATE_LIMIT_REDIS_FALLBACK request_id=%s key=%s error=%v timestamp=%s",
			requestID,
			key,
			err,
			now.UTC().Format(time.RFC3339),
		)
		observability.RecordRateLimiterRedisFallback()
	}
	return limiter.allow(key, now)
}

func Observability() fiber.Handler {
	return func(c *fiber.Ctx) error {
		start := time.Now()
		err := c.Next()
		requestID, _ := c.Locals(LocalsRequestID).(string)
		userID, _ := AuthenticatedUserID(c)
		log.Printf("HTTP_REQUEST request_id=%s method=%s path=%s status=%d duration_ms=%d user_id=%s timestamp=%s",
			requestID,
			c.Method(),
			c.Path(),
			c.Response().StatusCode(),
			time.Since(start).Milliseconds(),
			userID,
			time.Now().UTC().Format(time.RFC3339),
		)
		return err
	}
}

type rateLimitEntry struct {
	count   int
	resetAt time.Time
}

type fixedWindowLimiter struct {
	mu     sync.Mutex
	max    int
	window time.Duration
	hits   map[string]rateLimitEntry
}

func (l *fixedWindowLimiter) allow(key string, now time.Time) (bool, int, time.Time) {
	l.mu.Lock()
	defer l.mu.Unlock()

	entry := l.hits[key]
	if entry.resetAt.IsZero() || !now.Before(entry.resetAt) {
		entry = rateLimitEntry{resetAt: now.Add(l.window)}
	}
	entry.count++
	l.hits[key] = entry
	if entry.count > l.max {
		return false, 0, entry.resetAt
	}
	return true, l.max - entry.count, entry.resetAt
}

// startCleanup periodically evicts expired entries so this in-process
// fallback map does not grow without bound for the lifetime of the server.
// It is only ever exercised when the Redis-backed store is disabled or
// transiently unavailable; entries are otherwise never removed.
func (l *fixedWindowLimiter) startCleanup(interval time.Duration) {
	if interval <= 0 {
		interval = time.Minute
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for now := range ticker.C {
		l.sweepExpired(now)
	}
}

func (l *fixedWindowLimiter) sweepExpired(now time.Time) {
	l.mu.Lock()
	defer l.mu.Unlock()
	for key, entry := range l.hits {
		if !entry.resetAt.IsZero() && now.After(entry.resetAt) {
			delete(l.hits, key)
		}
	}
}

func newRequestID() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return hex.EncodeToString([]byte(time.Now().UTC().Format(time.RFC3339Nano)))
	}
	return hex.EncodeToString(b[:])
}

func intString(value int) string {
	if value == 0 {
		return "0"
	}
	negative := value < 0
	if negative {
		value = -value
	}
	var buf [20]byte
	i := len(buf)
	for value > 0 {
		i--
		buf[i] = byte('0' + value%10)
		value /= 10
	}
	if negative {
		i--
		buf[i] = '-'
	}
	return string(buf[i:])
}
