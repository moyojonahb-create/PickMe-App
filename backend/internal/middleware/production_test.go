package middleware

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/prometheus/client_golang/prometheus"
)

func TestRequestIDSetsResponseHeader(t *testing.T) {
	app := fiber.New()
	app.Use(RequestID())
	app.Get("/", func(c *fiber.Ctx) error {
		if c.Locals(LocalsRequestID) == "" {
			t.Fatal("expected request id local")
		}
		return c.SendStatus(fiber.StatusNoContent)
	})

	resp, err := app.Test(httptest.NewRequest(http.MethodGet, "/", nil))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.Header.Get(RequestIDHeader) == "" {
		t.Fatal("expected request id response header")
	}
}

func TestRecoverConvertsPanicToHTTP500(t *testing.T) {
	app := fiber.New()
	app.Use(RequestID())
	app.Use(Recover())
	app.Get("/panic", func(c *fiber.Ctx) error {
		panic("boom")
	})

	resp, err := app.Test(httptest.NewRequest(http.MethodGet, "/panic", nil))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != fiber.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", resp.StatusCode)
	}
}

func TestGlobalRateLimitRejectsAfterLimit(t *testing.T) {
	app := fiber.New()
	app.Use(RequestID())
	app.Use(GlobalRateLimit(RateLimitConfig{Max: 1, Window: time.Minute}))
	app.Get("/", func(c *fiber.Ctx) error {
		return c.SendStatus(fiber.StatusNoContent)
	})

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.RemoteAddr = "192.0.2.1:1234"
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	_ = resp.Body.Close()
	if resp.StatusCode != fiber.StatusNoContent {
		t.Fatalf("expected first request allowed, got %d", resp.StatusCode)
	}

	req = httptest.NewRequest(http.MethodGet, "/", nil)
	req.RemoteAddr = "192.0.2.1:1234"
	resp, err = app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != fiber.StatusTooManyRequests {
		t.Fatalf("expected rate limit rejection, got %d", resp.StatusCode)
	}
}

func TestGlobalRateLimitUsesRedisStoreWhenEnabled(t *testing.T) {
	app := fiber.New()
	store := &fakeRateLimitStore{counts: map[string]int64{}}
	app.Use(RequestID())
	app.Use(GlobalRateLimit(RateLimitConfig{Max: 1, Window: time.Minute, Store: store, KeyPrefix: "test"}))
	app.Get("/", func(c *fiber.Ctx) error {
		return c.SendStatus(fiber.StatusNoContent)
	})

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.RemoteAddr = "198.51.100.8:1234"
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	_ = resp.Body.Close()
	if resp.StatusCode != fiber.StatusNoContent {
		t.Fatalf("expected first request allowed, got %d", resp.StatusCode)
	}

	req = httptest.NewRequest(http.MethodGet, "/", nil)
	req.RemoteAddr = "198.51.100.8:1234"
	resp, err = app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != fiber.StatusTooManyRequests {
		t.Fatalf("expected redis-backed rate limit rejection, got %d", resp.StatusCode)
	}
	if len(store.counts) != 1 {
		t.Fatalf("expected one redis rate limit key, got %d", len(store.counts))
	}
}

func TestRequestTimeoutSetsUserContextDeadline(t *testing.T) {
	app := fiber.New()
	app.Use(RequestTimeout(time.Second))
	app.Get("/", func(c *fiber.Ctx) error {
		if _, ok := c.UserContext().Deadline(); !ok {
			t.Fatal("expected user context deadline")
		}
		return c.SendStatus(fiber.StatusNoContent)
	})

	resp, err := app.Test(httptest.NewRequest(http.MethodGet, "/", nil))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != fiber.StatusNoContent {
		t.Fatalf("expected 204, got %d", resp.StatusCode)
	}
}

func TestFixedWindowLimiterSweepExpiredEvictsOnlyExpiredEntries(t *testing.T) {
	limiter := &fixedWindowLimiter{
		max:    10,
		window: time.Minute,
		hits:   map[string]rateLimitEntry{},
	}

	now := time.Now()
	limiter.allow("expired-key", now.Add(-2*time.Minute))
	limiter.allow("fresh-key", now)

	limiter.sweepExpired(now)

	limiter.mu.Lock()
	defer limiter.mu.Unlock()
	if _, exists := limiter.hits["expired-key"]; exists {
		t.Fatal("expected expired entry to be evicted")
	}
	if _, exists := limiter.hits["fresh-key"]; !exists {
		t.Fatal("expected fresh entry to remain")
	}
}

type fakeRateLimitStore struct {
	counts map[string]int64
}

func (s *fakeRateLimitStore) Enabled() bool {
	return true
}

func (s *fakeRateLimitStore) IncrWithTTL(ctx context.Context, key string, ttl time.Duration) (int64, error) {
	s.counts[key]++
	return s.counts[key], nil
}

// erroringRateLimitStore simulates a Redis outage: it reports itself as
// enabled (so GlobalRateLimit attempts the Redis path) but always fails,
// forcing the in-memory fallback branch in allowRequest.
type erroringRateLimitStore struct{}

func (s *erroringRateLimitStore) Enabled() bool {
	return true
}

func (s *erroringRateLimitStore) IncrWithTTL(ctx context.Context, key string, ttl time.Duration) (int64, error) {
	return 0, errors.New("redis unavailable")
}

func TestGlobalRateLimitFallsBackAndRecordsMetricOnStoreError(t *testing.T) {
	before := rateLimiterRedisFallbackCounterValue(t)

	app := fiber.New()
	app.Use(RequestID())
	app.Use(GlobalRateLimit(RateLimitConfig{Max: 5, Window: time.Minute, Store: &erroringRateLimitStore{}, KeyPrefix: "fallback-test"}))
	app.Get("/", func(c *fiber.Ctx) error {
		return c.SendStatus(fiber.StatusNoContent)
	})

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.RemoteAddr = "203.0.113.5:1234"
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != fiber.StatusNoContent {
		t.Fatalf("expected the in-memory fallback to still allow the request (fallback behavior must be unchanged), got %d", resp.StatusCode)
	}

	after := rateLimiterRedisFallbackCounterValue(t)
	if after-before != 1 {
		t.Fatalf("expected the fallback metric to increase by 1, went from %v to %v", before, after)
	}
}

func rateLimiterRedisFallbackCounterValue(t *testing.T) float64 {
	t.Helper()
	families, err := prometheus.DefaultGatherer.Gather()
	if err != nil {
		t.Fatal(err)
	}
	for _, family := range families {
		if family.GetName() != "rate_limiter_redis_fallback_total" {
			continue
		}
		for _, metric := range family.GetMetric() {
			if metric.GetCounter() != nil {
				return metric.GetCounter().GetValue()
			}
		}
	}
	return 0
}
