package reputation

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gofiber/fiber/v2"
)

type fakeCalibrationReports struct {
	err error
}

func (f *fakeCalibrationReports) Health(ctx context.Context) (json.RawMessage, error) {
	return json.RawMessage(`{"average_dispatch_score":0.62}`), f.err
}

func (f *fakeCalibrationReports) Distribution(ctx context.Context) (json.RawMessage, error) {
	return json.RawMessage(`{"score_distribution":[]}`), f.err
}

func (f *fakeCalibrationReports) Cohorts(ctx context.Context) (json.RawMessage, error) {
	return json.RawMessage(`[{"cohort":"new"}]`), f.err
}

func (f *fakeCalibrationReports) Calibration(ctx context.Context, limit int) ([]json.RawMessage, error) {
	return []json.RawMessage{json.RawMessage(`{"recommendation":"not_ready"}`)}, f.err
}

func (f *fakeCalibrationReports) DispatchAnalysis(ctx context.Context) (json.RawMessage, error) {
	return json.RawMessage(`{"actual_driver_was_selected_rate":0.4}`), f.err
}

func TestCalibrationAdminEndpointsReturnSafeJSON(t *testing.T) {
	app := fiber.New()
	RegisterCalibrationAdminRoutes(app, &fakeCalibrationReports{}, reputationAuthAs("admin-1", "admin"))

	paths := []string{
		"/admin/reputation/health",
		"/admin/reputation/distribution",
		"/admin/reputation/cohorts",
		"/admin/reputation/calibration",
		"/admin/reputation/dispatch-analysis",
	}
	for _, path := range paths {
		resp := calibrationTestRequest(t, app, path)
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("expected %s to return 200, got %d", path, resp.StatusCode)
		}
	}
}

func TestCalibrationAdminEndpointsReturnErrorsSafely(t *testing.T) {
	app := fiber.New()
	RegisterCalibrationAdminRoutes(app, &fakeCalibrationReports{err: errors.New("db unavailable")}, reputationAuthAs("admin-1", "admin"))

	resp := calibrationTestRequest(t, app, "/admin/reputation/health")
	if resp.StatusCode != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", resp.StatusCode)
	}
}

func TestCalibrationAdminRoutesRequireAdminRole(t *testing.T) {
	for _, tc := range []struct {
		name string
		role string
	}{
		{name: "rider", role: "authenticated"},
		{name: "driver", role: "driver"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			app := fiber.New()
			RegisterCalibrationAdminRoutes(app, &fakeCalibrationReports{}, reputationAuthAs(tc.name+"-1", tc.role))

			resp := calibrationTestRequest(t, app, "/admin/reputation/health")
			assertAdminNotAuthorized(t, resp)
		})
	}
}

func calibrationTestRequest(t *testing.T, app *fiber.App, path string) *http.Response {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, path, nil)
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	return resp
}
