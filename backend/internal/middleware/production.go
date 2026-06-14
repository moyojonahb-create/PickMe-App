package middleware

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"log"
	"sync"
	"time"

	"github.com/gofiber/fiber/v2"
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

	limiter := &fixedWindowLimiter{
		max:    cfg.Max,
		window: cfg.Window,
		hits:   map[string]rateLimitEntry{},
	}

	return func(c *fiber.Ctx) error {
		key := cfg.KeyFunc(c)
		if key == "" {
			key = "ip:" + c.IP()
		}
		allowed, remaining, resetAt := limiter.allow(key, time.Now())
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
