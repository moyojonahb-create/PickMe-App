package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gofiber/fiber/v2"
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
