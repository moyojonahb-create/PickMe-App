package drivers

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"pickme-backend/internal/geo"
	"pickme-backend/internal/middleware"
	"pickme-backend/internal/websocket"
)

type fakeDriverDB struct {
	execFn     func(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
	queryRowFn func(ctx context.Context, sql string, args ...any) pgx.Row
}

func (f fakeDriverDB) Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error) {
	return f.execFn(ctx, sql, args...)
}

func (f fakeDriverDB) Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error) {
	return nil, errors.New("not implemented")
}

func (f fakeDriverDB) QueryRow(ctx context.Context, sql string, args ...any) pgx.Row {
	if f.queryRowFn != nil {
		return f.queryRowFn(ctx, sql, args...)
	}
	return fakeDriverRow{err: pgx.ErrNoRows}
}

type fakeDriverRow struct {
	boolValue bool
	err       error
}

func (r fakeDriverRow) Scan(dest ...any) error {
	if r.err == nil && len(dest) > 0 {
		if typed, ok := dest[0].(*bool); ok {
			*typed = r.boolValue
		}
	}
	return r.err
}

type failingGeoStore struct {
	enabled bool
	err     error
	hsets   int
	geoAdds int
}

func (f *failingGeoStore) Enabled() bool {
	return f.enabled
}

func (f *failingGeoStore) HSet(ctx context.Context, key string, values map[string]string) error {
	f.hsets++
	return f.err
}

func (f *failingGeoStore) HGetAll(ctx context.Context, key string) (map[string]string, error) {
	return nil, f.err
}

func (f *failingGeoStore) Expire(ctx context.Context, key string, ttl time.Duration) error {
	return f.err
}

func (f *failingGeoStore) GeoAdd(ctx context.Context, key string, longitude float64, latitude float64, member string) error {
	f.geoAdds++
	return f.err
}

func (f *failingGeoStore) GeoSearch(ctx context.Context, key string, longitude float64, latitude float64, radiusKM float64, count int) ([]geo.GeoResult, error) {
	return nil, f.err
}

func TestRedisDisabledDoesNotBreakDriverLocationUpdate(t *testing.T) {
	store := &failingGeoStore{enabled: false}
	app := makeDriverApp(t, store, nil)

	resp := doDriverRequest(t, app, http.MethodPost, "/drivers/location", DriverLocationRequest{
		Latitude: -17.826, Longitude: 31.034, Speed: 30, Heading: 90,
	})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected status 200, got %d", resp.StatusCode)
	}
	if store.hsets != 0 || store.geoAdds != 0 {
		t.Fatalf("redis disabled should not write, got hsets=%d geoAdds=%d", store.hsets, store.geoAdds)
	}
}

func TestRedisUnavailableDoesNotBreakDriverLocationUpdate(t *testing.T) {
	store := &failingGeoStore{enabled: true, err: errors.New("redis down")}
	app := makeDriverApp(t, store, nil)

	resp := doDriverRequest(t, app, http.MethodPost, "/drivers/location", DriverLocationRequest{
		Latitude: -17.826, Longitude: 31.034, Speed: 30, Heading: 90,
	})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected status 200, got %d", resp.StatusCode)
	}
	if store.hsets == 0 {
		t.Fatal("expected redis location write attempt")
	}
}

func TestPresenceUpdateAttemptsRedisHashWhenEnabled(t *testing.T) {
	store := &failingGeoStore{enabled: true}
	app := makeDriverApp(t, store, nil)

	resp := doDriverRequest(t, app, http.MethodPost, "/drivers/online", DriverOnlineRequest{
		Latitude: -17.826, Longitude: 31.034, VehicleType: "economy",
	})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected status 200, got %d", resp.StatusCode)
	}
	if store.hsets == 0 {
		t.Fatal("expected redis presence/location write attempt")
	}
}

func TestDriverLocationWithoutRideDoesNotUseGlobalBroadcastPath(t *testing.T) {
	source, err := os.ReadFile("handler.go")
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(source), "h.ws.Broadcast(broadcastBytes)") {
		t.Fatal("driver_location must never use global websocket broadcast")
	}
}

func TestDriverLocationAssignedRideAccepted(t *testing.T) {
	app := makeDriverAppWithOptions(t, &failingGeoStore{enabled: false}, nil, true, "driver-1", "driver")

	resp := doDriverRequest(t, app, http.MethodPost, "/drivers/location", DriverLocationRequest{
		RideID: "ride-1", Latitude: -17.826, Longitude: 31.034, Speed: 30, Heading: 90,
	})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected assigned ride location update 200, got %d", resp.StatusCode)
	}
}

func TestUnauthorizedRideLocationUpdateRejected(t *testing.T) {
	app := makeDriverAppWithOptions(t, &failingGeoStore{enabled: false}, nil, false, "driver-1", "driver")

	resp := doDriverRequest(t, app, http.MethodPost, "/drivers/location", DriverLocationRequest{
		RideID: "ride-2", Latitude: -17.826, Longitude: 31.034, Speed: 30, Heading: 90,
	})
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("expected unauthorized ride location update 403, got %d", resp.StatusCode)
	}
}

func TestInvalidDriverLocationCoordinatesRejected(t *testing.T) {
	app := makeDriverApp(t, &failingGeoStore{enabled: false}, nil)

	resp := doDriverRequest(t, app, http.MethodPost, "/drivers/location", DriverLocationRequest{
		Latitude: 100, Longitude: 31.034, Speed: 30, Heading: 90,
	})
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("expected invalid coordinates 400, got %d", resp.StatusCode)
	}
}

func TestLocationRateLimitRejectsSpam(t *testing.T) {
	app := makeDriverApp(t, &failingGeoStore{enabled: false}, nil)

	first := doDriverRequest(t, app, http.MethodPost, "/drivers/location", DriverLocationRequest{
		Latitude: -17.826, Longitude: 31.034, Speed: 30, Heading: 90,
	})
	if first.StatusCode != http.StatusOK {
		t.Fatalf("expected first location update 200, got %d", first.StatusCode)
	}
	second := doDriverRequest(t, app, http.MethodPost, "/drivers/location", DriverLocationRequest{
		Latitude: -17.8261, Longitude: 31.0341, Speed: 30, Heading: 90,
	})
	if second.StatusCode != http.StatusBadRequest {
		t.Fatalf("expected second rapid location update 400, got %d", second.StatusCode)
	}
}

func TestImpossibleLocationJumpRejected(t *testing.T) {
	handler := NewHandler(fakeDriverDB{}, websocket.NewManager())
	handler.lastValidatedLocation["driver-1"] = validatedLocation{Latitude: -17.826, Longitude: 31.034, At: timeNowUTC().Add(-10 * time.Second)}
	handler.lastLocationUpdates["driver-1"] = timeNowUTC().Add(-10 * time.Second)

	err := handler.validateLocationUpdate(DriverLocationRequest{DriverID: "driver-1", Latitude: -18.826, Longitude: 32.034, Speed: 30})
	if !errors.Is(err, errLocationImpossibleJump) {
		t.Fatalf("expected impossible jump error, got %v", err)
	}
}

func TestNearbyDriversRequiresAdmin(t *testing.T) {
	app := makeDriverAppWithOptions(t, &failingGeoStore{enabled: false}, nil, false, "rider-1", "authenticated")

	resp := doDriverRequest(t, app, http.MethodGet, "/drivers/nearby?lat=-17.826&lng=31.034", nil)
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("expected nearby non-admin 403, got %d", resp.StatusCode)
	}
}

func makeDriverApp(t *testing.T, store *failingGeoStore, execFn func(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)) *fiber.App {
	return makeDriverAppWithOptions(t, store, execFn, false, "driver-1", "driver")
}

func makeDriverAppWithOptions(t *testing.T, store *failingGeoStore, execFn func(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error), rideAllowed bool, userID string, role string) *fiber.App {
	t.Helper()
	if execFn == nil {
		execFn = func(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error) {
			if strings.Contains(sql, "UPDATE public.driver_sessions") {
				return pgconn.NewCommandTag("UPDATE 1"), nil
			}
			return pgconn.NewCommandTag("INSERT 1"), nil
		}
	}
	app := fiber.New()
	app.Use(func(c *fiber.Ctx) error {
		c.Locals(middleware.LocalsAuthSubject, userID)
		c.Locals(middleware.LocalsAuthRole, role)
		return c.Next()
	})
	handler := NewHandler(fakeDriverDB{
		execFn: execFn,
		queryRowFn: func(ctx context.Context, sql string, args ...any) pgx.Row {
			return fakeDriverRow{boolValue: rideAllowed}
		},
	}, websocket.NewManager(), geo.NewService(store, geo.Config{}))
	RegisterRoutes(app, handler, func(c *fiber.Ctx) error { return c.Next() })
	return app
}

func doDriverRequest(t *testing.T, app *fiber.App, method string, path string, body any) *http.Response {
	t.Helper()
	var reader *bytes.Reader
	if body != nil {
		payload, err := json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
		reader = bytes.NewReader(payload)
	} else {
		reader = bytes.NewReader(nil)
	}
	req := httptest.NewRequest(method, path, reader)
	req.Header.Set("Content-Type", "application/json")
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	return resp
}
