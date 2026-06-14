package dispatch

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
	summaryCalled bool
	recentCalled  bool
	err           error
}

func (f *fakeReports) Summary(ctx context.Context, days int) (json.RawMessage, error) {
	f.summaryCalled = true
	return json.RawMessage(`{"total_shadow_runs":10,"actual_driver_was_candidate_rate":0.7}`), f.err
}

func (f *fakeReports) DailyStats(ctx context.Context, days int) ([]json.RawMessage, error) {
	return []json.RawMessage{json.RawMessage(`{"day":"2026-06-01"}`)}, f.err
}

func (f *fakeReports) RecentRuns(ctx context.Context, limit int) ([]json.RawMessage, error) {
	f.recentCalled = true
	return []json.RawMessage{json.RawMessage(`{"id":"run-1"}`)}, f.err
}

func (f *fakeReports) Candidates(ctx context.Context, runID string, limit int) ([]json.RawMessage, error) {
	return []json.RawMessage{json.RawMessage(`{"driver_id":"driver-1","rank":1}`)}, f.err
}

func (f *fakeReports) Outcomes(ctx context.Context, limit int) ([]json.RawMessage, error) {
	return []json.RawMessage{json.RawMessage(`{"ride_id":"ride-1"}`)}, f.err
}

func (f *fakeReports) Failures(ctx context.Context, limit int) ([]json.RawMessage, error) {
	return []json.RawMessage{json.RawMessage(`{"status":"redis_unavailable"}`)}, f.err
}

func (f *fakeReports) Health(ctx context.Context, days int) (json.RawMessage, error) {
	return json.RawMessage(`{"redis_unavailable_count":1,"no_coordinates_count":2}`), f.err
}

func TestRegisterShadowAdminRoutesServesSummaryAndRecentRuns(t *testing.T) {
	reports := &fakeReports{}
	app := fiber.New()
	RegisterShadowAdminRoutes(app, reports, dispatchAuthAs("admin-1", "admin"))

	paths := []string{
		"/admin/dispatch/shadow/summary",
		"/admin/dispatch/shadow/daily",
		"/admin/dispatch/shadow/recent",
		"/admin/dispatch/shadow/runs/run-1/candidates",
		"/admin/dispatch/shadow/outcomes",
		"/admin/dispatch/shadow/failures",
		"/admin/dispatch/shadow/health",
	}
	for _, path := range paths {
		resp := testRequest(t, app, path)
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("expected %s to return 200, got %d", path, resp.StatusCode)
		}
	}
	if !reports.summaryCalled || !reports.recentCalled {
		t.Fatalf("expected reports to be called: %#v", reports)
	}
}

func TestShadowAdminRoutesReturnErrorsSafely(t *testing.T) {
	reports := &fakeReports{err: errors.New("db unavailable")}
	app := fiber.New()
	RegisterShadowAdminRoutes(app, reports, dispatchAuthAs("admin-1", "admin"))

	resp := testRequest(t, app, "/admin/dispatch/shadow/summary")
	if resp.StatusCode != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", resp.StatusCode)
	}
}

func TestShadowAdminRoutesRequireAdminRole(t *testing.T) {
	for _, tc := range []struct {
		name string
		role string
	}{
		{name: "rider", role: "authenticated"},
		{name: "driver", role: "driver"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			app := fiber.New()
			RegisterShadowAdminRoutes(app, &fakeReports{}, dispatchAuthAs(tc.name+"-1", tc.role))

			resp := testRequest(t, app, "/admin/dispatch/shadow/summary")
			assertAdminNotAuthorized(t, resp)
		})
	}
}

func dispatchAuthAs(userID string, role string) fiber.Handler {
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

func testRequest(t *testing.T, app *fiber.App, path string) *http.Response {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, path, nil)
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	return resp
}
