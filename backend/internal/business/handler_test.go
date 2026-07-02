package business

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gofiber/fiber/v2"

	"pickme-backend/internal/middleware"
)

func TestBusinessWriteRoutesValidateInput(t *testing.T) {
	app := fiber.New()
	requireAuth := func(c *fiber.Ctx) error {
		c.Locals(middleware.LocalsAuthSubject, "user-1")
		return c.Next()
	}
	RegisterRoutes(app, nil, requireAuth)

	cases := []struct {
		method string
		path   string
		body   string
		status int
	}{
		{method: http.MethodPost, path: "/api/messages", body: `{}`, status: fiber.StatusBadRequest},
		{method: http.MethodPost, path: "/api/call-sessions", body: `{}`, status: fiber.StatusBadRequest},
		{method: http.MethodPost, path: "/api/favorite-locations", body: `{}`, status: fiber.StatusBadRequest},
		{method: http.MethodPost, path: "/api/drivers/documents", body: `{}`, status: fiber.StatusBadRequest},
		{method: http.MethodPatch, path: "/api/drivers/me", body: `{}`, status: fiber.StatusBadRequest},
		{method: http.MethodPost, path: "/api/driver-sessions/fatigue-break", body: `{}`, status: fiber.StatusBadRequest},
	}

	for _, tc := range cases {
		t.Run(tc.method+" "+tc.path, func(t *testing.T) {
			req := httptest.NewRequest(tc.method, tc.path, bytes.NewBufferString(tc.body))
			req.Header.Set("Content-Type", "application/json")
			resp, err := app.Test(req)
			if err != nil {
				t.Fatalf("request failed: %v", err)
			}
			if resp.StatusCode != tc.status {
				t.Fatalf("expected status %d, got %d", tc.status, resp.StatusCode)
			}
		})
	}
}

func TestAdminMutationPolicyRejectsSensitiveRideFields(t *testing.T) {
	policy := adminMutationPolicies["rides"]
	_, err := policy.sanitize("update", map[string]any{
		"driver_id": "driver-1",
	})
	if err == nil {
		t.Fatal("expected sensitive ride field to be rejected")
	}
}

func TestAdminMutationPolicyAllowsLandmarkFields(t *testing.T) {
	policy := adminMutationPolicies["koloi_landmarks"]
	row, err := policy.sanitize("insert", map[string]any{
		"name":      "Harare CBD",
		"latitude":  -17.8292,
		"longitude": 31.0522,
	})
	if err != nil {
		t.Fatalf("expected landmark fields to be allowed: %v", err)
	}
	if len(row) != 3 {
		t.Fatalf("expected sanitized row to keep 3 fields, got %d", len(row))
	}
}
