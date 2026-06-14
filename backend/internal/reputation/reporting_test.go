package reputation

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gofiber/fiber/v2"

	"pickme-backend/internal/middleware"
)

type fakeReports struct {
	err error
}

func (f *fakeReports) Drivers(ctx context.Context, limit int) ([]json.RawMessage, error) {
	return []json.RawMessage{json.RawMessage(`{"driver_id":"driver-1"}`)}, f.err
}

func (f *fakeReports) Driver(ctx context.Context, driverID string) (json.RawMessage, error) {
	return json.RawMessage(`{"driver_id":"driver-1","dispatch_score":0.75}`), f.err
}

func (f *fakeReports) Events(ctx context.Context, driverID string, limit int) ([]json.RawMessage, error) {
	return []json.RawMessage{json.RawMessage(`{"event_type":"ride_completed"}`)}, f.err
}

func (f *fakeReports) TopDrivers(ctx context.Context, limit int) ([]json.RawMessage, error) {
	return []json.RawMessage{json.RawMessage(`{"driver_id":"driver-1"}`)}, f.err
}

func (f *fakeReports) LowScoreDrivers(ctx context.Context, limit int) ([]json.RawMessage, error) {
	return []json.RawMessage{json.RawMessage(`{"driver_id":"driver-2"}`)}, f.err
}

func TestAdminEndpointsReturnSafeJSON(t *testing.T) {
	app := fiber.New()
	RegisterAdminRoutes(app, &fakeReports{}, reputationAuthAs("admin-1", "admin"))

	paths := []string{
		"/admin/reputation/drivers",
		"/admin/reputation/drivers/driver-1",
		"/admin/reputation/drivers/driver-1/events",
		"/admin/reputation/top-drivers",
		"/admin/reputation/low-score-drivers",
	}

	for _, path := range paths {
		resp := reputationTestRequest(t, app, path)
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("expected %s to return 200, got %d", path, resp.StatusCode)
		}
	}
}

func TestAdminEndpointsReturnErrorsSafely(t *testing.T) {
	app := fiber.New()
	RegisterAdminRoutes(app, &fakeReports{err: errors.New("db unavailable")}, reputationAuthAs("admin-1", "admin"))

	resp := reputationTestRequest(t, app, "/admin/reputation/drivers")
	if resp.StatusCode != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", resp.StatusCode)
	}
}

func TestReputationAdminRoutesRequireAdminRole(t *testing.T) {
	for _, tc := range []struct {
		name string
		role string
	}{
		{name: "rider", role: "authenticated"},
		{name: "driver", role: "driver"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			app := fiber.New()
			RegisterAdminRoutes(app, &fakeReports{}, reputationAuthAs(tc.name+"-1", tc.role))

			resp := reputationTestRequest(t, app, "/admin/reputation/drivers")
			assertAdminNotAuthorized(t, resp)
		})
	}
}

func reputationAuthAs(userID string, role string) fiber.Handler {
	return func(c *fiber.Ctx) error {
		c.Locals(middleware.LocalsAuthSubject, userID)
		c.Locals(middleware.LocalsAuthRole, role)
		return c.Next()
	}
}

func assertAdminNotAuthorized(t *testing.T, resp *http.Response) {
	t.Helper()
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("expected 403, got %d", resp.StatusCode)
	}
	var body map[string]string
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if body["error"] != "admin_not_authorized" {
		t.Fatalf("expected admin_not_authorized, got %#v", body)
	}
}

func reputationTestRequest(t *testing.T, app *fiber.App, path string) *http.Response {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, path, nil)
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	return resp
}
