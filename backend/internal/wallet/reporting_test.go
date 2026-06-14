package wallet

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gofiber/fiber/v2"
)

type fakeReports struct {
	err error
}

func (f *fakeReports) ShadowSettlementSummary(ctx context.Context, days int) (json.RawMessage, error) {
	return json.RawMessage(`{"total_shadow_settlements":1}`), f.err
}

func (f *fakeReports) RecentShadowSettlements(ctx context.Context, limit int) ([]json.RawMessage, error) {
	return []json.RawMessage{json.RawMessage(`{"ride_id":"ride-1"}`)}, f.err
}

func (f *fakeReports) FailedShadowSettlements(ctx context.Context, limit int) ([]json.RawMessage, error) {
	return []json.RawMessage{json.RawMessage(`{"status":"failed"}`)}, f.err
}

func (f *fakeReports) ActiveSettlementSummary(ctx context.Context, days int) (json.RawMessage, error) {
	return json.RawMessage(`{"total_active_cash_settlements":1}`), f.err
}

func (f *fakeReports) DriverLiabilities(ctx context.Context, limit int) ([]json.RawMessage, error) {
	return []json.RawMessage{json.RawMessage(`{"driver_id":"driver-1"}`)}, f.err
}

func (f *fakeReports) FailedActiveSettlements(ctx context.Context, limit int) ([]json.RawMessage, error) {
	return []json.RawMessage{json.RawMessage(`{"status":"failed"}`)}, f.err
}

func TestWalletAdminRoutesReturnSafeJSON(t *testing.T) {
	app := fiber.New()
	RegisterAdminRoutes(app, &fakeReports{}, authAs("admin-1", "admin"))

	paths := []string{
		"/admin/wallets/shadow-settlements/summary",
		"/admin/wallets/shadow-settlements/recent",
		"/admin/wallets/shadow-settlements/failed",
		"/admin/wallets/active-settlements/summary",
		"/admin/wallets/driver-liabilities",
		"/admin/wallets/active-settlements/failed",
	}
	for _, path := range paths {
		resp := walletTestRequest(t, app, path)
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("expected %s to return 200, got %d", path, resp.StatusCode)
		}
	}
}

func TestWalletAdminRoutesReturnErrorsSafely(t *testing.T) {
	app := fiber.New()
	RegisterAdminRoutes(app, &fakeReports{err: errors.New("db unavailable")}, authAs("admin-1", "admin"))

	resp := walletTestRequest(t, app, "/admin/wallets/shadow-settlements/summary")
	if resp.StatusCode != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", resp.StatusCode)
	}
}

func TestWalletReportingRoutesRequireAdminRole(t *testing.T) {
	paths := []string{
		"/admin/wallets/shadow-settlements/summary",
		"/admin/wallets/shadow-settlements/recent",
		"/admin/wallets/shadow-settlements/failed",
		"/admin/wallets/active-settlements/summary",
		"/admin/wallets/driver-liabilities",
		"/admin/wallets/active-settlements/failed",
	}

	for _, role := range []string{"authenticated", "driver"} {
		app := fiber.New()
		RegisterAdminRoutes(app, &fakeReports{}, authAs(role+"-1", role))
		for _, path := range paths {
			resp := walletTestRequest(t, app, path)
			assertAdminNotAuthorized(t, resp)
		}
	}

	app := fiber.New()
	RegisterAdminRoutes(app, &fakeReports{}, authAs("admin-1", "admin"))
	for _, path := range paths {
		resp := walletTestRequest(t, app, path)
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("expected admin to access %s, got %d", path, resp.StatusCode)
		}
	}
}

func walletTestRequest(t *testing.T, app *fiber.App, path string) *http.Response {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, path, nil)
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	return resp
}
