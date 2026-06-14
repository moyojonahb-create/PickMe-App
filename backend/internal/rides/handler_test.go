package rides

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"pickme-backend/internal/dispatch"
	"pickme-backend/internal/middleware"
	"pickme-backend/internal/wallet"
	"pickme-backend/internal/websocket"

	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

type fakeDB struct {
	beginFn    func(ctx context.Context) (Tx, error)
	execFn     func(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
	queryFn    func(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	queryRowFn func(ctx context.Context, sql string, args ...any) pgx.Row
}

func (f *fakeDB) Begin(ctx context.Context) (Tx, error) {
	return f.beginFn(ctx)
}

func (f *fakeDB) Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error) {
	return f.execFn(ctx, sql, args...)
}

func (f *fakeDB) Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error) {
	return f.queryFn(ctx, sql, args...)
}

func (f *fakeDB) QueryRow(ctx context.Context, sql string, args ...any) pgx.Row {
	return f.queryRowFn(ctx, sql, args...)
}

type fakeTx struct {
	queryRowFn func(ctx context.Context, sql string, args ...any) pgx.Row
	execFn     func(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
	commitFn   func(ctx context.Context) error
	rollbackFn func(ctx context.Context) error
}

func (t *fakeTx) QueryRow(ctx context.Context, sql string, args ...any) pgx.Row {
	return t.queryRowFn(ctx, sql, args...)
}

func (t *fakeTx) Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error) {
	return t.execFn(ctx, sql, args...)
}

func (t *fakeTx) Commit(ctx context.Context) error {
	return t.commitFn(ctx)
}

func (t *fakeTx) Rollback(ctx context.Context) error {
	return t.rollbackFn(ctx)
}

type fakeRow struct {
	values []any
	err    error
}

func (r *fakeRow) Scan(dest ...any) error {
	if r.err != nil {
		return r.err
	}
	if len(dest) != len(r.values) {
		return pgx.ErrNoRows
	}
	for i := range dest {
		switch d := dest[i].(type) {
		case *string:
			v, ok := r.values[i].(string)
			if !ok {
				return pgx.ErrNoRows
			}
			*d = v
		case *time.Time:
			v, ok := r.values[i].(time.Time)
			if !ok {
				return pgx.ErrNoRows
			}
			*d = v
		case *float64:
			v, ok := r.values[i].(float64)
			if !ok {
				return pgx.ErrNoRows
			}
			*d = v
		case *int:
			v, ok := r.values[i].(int)
			if !ok {
				return pgx.ErrNoRows
			}
			*d = v
		case *int64:
			v, ok := r.values[i].(int64)
			if !ok {
				return pgx.ErrNoRows
			}
			*d = v
		default:
			return pgx.ErrNoRows
		}
	}
	return nil
}

type fakeRows struct {
	rows   [][]any
	index  int
	closed bool
}

func (r *fakeRows) Close() {
	r.closed = true
}

func (r *fakeRows) Err() error {
	return nil
}

func (r *fakeRows) CommandTag() pgconn.CommandTag {
	return pgconn.NewCommandTag("SELECT")
}

func (r *fakeRows) FieldDescriptions() []pgconn.FieldDescription {
	return nil
}

func (r *fakeRows) Next() bool {
	if r.index >= len(r.rows) {
		r.closed = true
		return false
	}
	r.index++
	return true
}

func (r *fakeRows) Scan(dest ...any) error {
	row := &fakeRow{values: r.rows[r.index-1]}
	return row.Scan(dest...)
}

func (r *fakeRows) Values() ([]any, error) {
	return r.rows[r.index-1], nil
}

func (r *fakeRows) RawValues() [][]byte {
	return nil
}

func (r *fakeRows) Conn() *pgx.Conn {
	return nil
}

func makeHandlerWithDB(db DB) *Handler {
	return NewHandler(db, websocket.NewManager(), websocket.NewConnectionRegistry(), websocket.NewConnectionRegistry())
}

type fakeLifecycleNotifier struct {
	events []fakeLifecycleEvent
}

type fakeRideOfferNotifier struct {
	events []RideOfferBroadcast
}

type fakeDispatchObserver struct {
	rides          []dispatch.RideContext
	firstOffers    []dispatch.OfferOutcome
	acceptedOffers []dispatch.OfferOutcome
}

type fakeShadowSettler struct {
	rides []wallet.CompletedRide
}

type fakeActiveCashSettler struct {
	rides []wallet.CompletedRide
}

type fakeWalletAuthorizer struct {
	enabled       bool
	authorizeErr  error
	authorized    []wallet.AuthorizationRequest
	captured      []wallet.CaptureRequest
	released      []wallet.ReleaseRequest
	captureNotify chan struct{}
}

type fakePilotGate struct {
	enabled         bool
	eligible        bool
	roleEligibility map[string]bool
}

type fakeWalletPilotEnforcer struct {
	err     error
	guards  []wallet.WalletPilotMutationRequest
	records []wallet.WalletPilotMutationRequest
}

func (f *fakeWalletPilotEnforcer) Enabled() bool {
	return true
}

func (f *fakeWalletPilotEnforcer) GuardWalletMutation(ctx context.Context, req wallet.WalletPilotMutationRequest) error {
	f.guards = append(f.guards, req)
	return f.err
}

func (f *fakeWalletPilotEnforcer) RecordWalletMutation(ctx context.Context, req wallet.WalletPilotMutationRequest) error {
	f.records = append(f.records, req)
	return nil
}

type fakeLifecycleEvent struct {
	payload  RideLifecycleBroadcast
	riderID  string
	driverID string
}

func (n *fakeLifecycleNotifier) NotifyRideLifecycle(payload RideLifecycleBroadcast, riderID string, driverID string) {
	n.events = append(n.events, fakeLifecycleEvent{
		payload:  payload,
		riderID:  riderID,
		driverID: driverID,
	})
}

func (n *fakeRideOfferNotifier) NotifyRideOffer(payload RideOfferBroadcast) {
	n.events = append(n.events, payload)
}

func (o *fakeDispatchObserver) ObserveRide(ctx context.Context, ride dispatch.RideContext) {
	o.rides = append(o.rides, ride)
}

func (o *fakeDispatchObserver) RecordFirstOffer(ctx context.Context, outcome dispatch.OfferOutcome) {
	o.firstOffers = append(o.firstOffers, outcome)
}

func (o *fakeDispatchObserver) RecordAcceptedOffer(ctx context.Context, outcome dispatch.OfferOutcome) {
	o.acceptedOffers = append(o.acceptedOffers, outcome)
}

func (s *fakeShadowSettler) RecordCompletedRide(ctx context.Context, ride wallet.CompletedRide) {
	s.rides = append(s.rides, ride)
}

func (s *fakeActiveCashSettler) RecordCompletedCashRide(ctx context.Context, ride wallet.CompletedRide) {
	s.rides = append(s.rides, ride)
}

func (a *fakeWalletAuthorizer) Enabled() bool {
	return a.enabled
}

func (a *fakeWalletAuthorizer) AuthorizeRideFunds(ctx context.Context, req wallet.AuthorizationRequest) (wallet.WalletAuthorization, error) {
	a.authorized = append(a.authorized, req)
	if a.authorizeErr != nil {
		return wallet.WalletAuthorization{}, a.authorizeErr
	}
	return wallet.WalletAuthorization{ID: "auth-1", RideID: req.RideID, RiderID: req.RiderID, AmountMinor: req.AmountMinor, Status: wallet.AuthorizationStatusAuthorized}, nil
}

func (a *fakeWalletAuthorizer) CaptureRideFunds(ctx context.Context, req wallet.CaptureRequest) (wallet.SettlementRecord, error) {
	a.captured = append(a.captured, req)
	if a.captureNotify != nil {
		close(a.captureNotify)
	}
	return wallet.SettlementRecord{ID: "settlement-1", RideID: req.RideID, Status: wallet.SettlementStatusSettled}, nil
}

func (a *fakeWalletAuthorizer) ReleaseRideFunds(ctx context.Context, req wallet.ReleaseRequest) (wallet.WalletAuthorization, error) {
	a.released = append(a.released, req)
	return wallet.WalletAuthorization{ID: "auth-1", RideID: req.RideID, RiderID: req.RiderID, Status: wallet.AuthorizationStatusReleased}, nil
}

func (g fakePilotGate) Enabled() bool {
	return g.enabled
}

func (g fakePilotGate) IsPilotEligible(ctx context.Context, userID string, role string) bool {
	if g.roleEligibility != nil {
		return !g.enabled || g.roleEligibility[role]
	}
	return !g.enabled || g.eligible
}

func makeAuthApp(handler fiber.Handler, authUser string) *fiber.App {
	app := fiber.New()
	app.Post("/test/:rideId/:offerId", func(c *fiber.Ctx) error {
		c.Locals(middleware.LocalsAuthSubject, authUser)
		return handler(c)
	})
	return app
}

func doRequest(t *testing.T, app *fiber.App, path string, body any) *http.Response {
	t.Helper()
	var reader io.Reader
	if body != nil {
		payload, err := json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
		reader = bytes.NewReader(payload)
	}
	req := httptest.NewRequest(http.MethodPost, path, reader)
	req.Header.Set("Content-Type", "application/json")
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	return resp
}

func doRawRequest(t *testing.T, app *fiber.App, method string, path string, body any) *http.Response {
	t.Helper()
	var reader io.Reader
	if body != nil {
		payload, err := json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
		reader = bytes.NewReader(payload)
	}
	req := httptest.NewRequest(method, path, reader)
	req.Header.Set("Content-Type", "application/json")
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	return resp
}

func makeAuthRideApp(method string, path string, handler fiber.Handler, authUser string) *fiber.App {
	app := fiber.New()
	app.Add(method, path, func(c *fiber.Ctx) error {
		c.Locals(middleware.LocalsAuthSubject, authUser)
		return handler(c)
	})
	return app
}

func makeAuthRideAppWithRole(method string, path string, handler fiber.Handler, authUser string, role string) *fiber.App {
	app := fiber.New()
	app.Add(method, path, func(c *fiber.Ctx) error {
		c.Locals(middleware.LocalsAuthSubject, authUser)
		c.Locals(middleware.LocalsAuthRole, role)
		return handler(c)
	})
	return app
}

func readResponseBody(t *testing.T, resp *http.Response) []byte {
	t.Helper()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatal(err)
	}
	return body
}

func TestListRequiresAuthenticationThroughRegisteredRoute(t *testing.T) {
	db := &fakeDB{}
	h := makeHandlerWithDB(db)
	app := fiber.New()
	RegisterRoutes(app, h, func(c *fiber.Ctx) error {
		return c.Status(http.StatusUnauthorized).JSON(fiber.Map{"error": "Authentication required"})
	})

	req := httptest.NewRequest(http.MethodGet, "/rides", nil)
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("expected unauthenticated /rides to return 401, got %d", resp.StatusCode)
	}
}

func TestListScopesRiderToOwnRides(t *testing.T) {
	now := time.Now()
	db := &fakeDB{
		queryFn: func(ctx context.Context, sql string, args ...any) (pgx.Rows, error) {
			if !strings.Contains(sql, "WHERE rider_id::text = $1") || !strings.Contains(sql, "driver_id::text = $1") {
				t.Fatalf("expected scoped rider/driver SQL, got %s", sql)
			}
			if len(args) != 1 || args[0] != "rider-1" {
				t.Fatalf("expected authenticated subject arg, got %#v", args)
			}
			return &fakeRows{rows: [][]any{{"ride-1", "rider-1", "pickup", "dropoff", "10.55", "requested", now}}}, nil
		},
	}
	h := makeHandlerWithDB(db)
	app := makeAuthRideAppWithRole(http.MethodGet, "/rides", h.List, "rider-1", "authenticated")

	resp := doRawRequest(t, app, http.MethodGet, "/rides", nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}
	var rides []map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&rides); err != nil {
		t.Fatal(err)
	}
	if len(rides) != 1 || rides[0]["rider_id"] != "rider-1" {
		t.Fatalf("expected only rider's ride, got %#v", rides)
	}
}

func TestListScopesDriverToAssignedRides(t *testing.T) {
	now := time.Now()
	db := &fakeDB{
		queryFn: func(ctx context.Context, sql string, args ...any) (pgx.Rows, error) {
			if !strings.Contains(sql, "driver_id::text = $1") {
				t.Fatalf("expected driver assignment scope, got %s", sql)
			}
			if len(args) != 1 || args[0] != "driver-1" {
				t.Fatalf("expected authenticated driver arg, got %#v", args)
			}
			return &fakeRows{rows: [][]any{{"ride-2", "rider-2", "pickup", "dropoff", "12.00", "accepted", now}}}, nil
		},
	}
	h := makeHandlerWithDB(db)
	app := makeAuthRideAppWithRole(http.MethodGet, "/rides", h.List, "driver-1", "authenticated")

	resp := doRawRequest(t, app, http.MethodGet, "/rides", nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}
}

func TestListAllowsAdminToSeeAllRides(t *testing.T) {
	now := time.Now()
	db := &fakeDB{
		queryFn: func(ctx context.Context, sql string, args ...any) (pgx.Rows, error) {
			if strings.Contains(sql, "WHERE rider_id::text = $1") || len(args) != 0 {
				t.Fatalf("expected unscoped admin SQL and no args, sql=%s args=%#v", sql, args)
			}
			return &fakeRows{rows: [][]any{
				{"ride-1", "rider-1", "pickup", "dropoff", "10.55", "requested", now},
				{"ride-2", "rider-2", "pickup2", "dropoff2", "12.00", "accepted", now},
			}}, nil
		},
	}
	h := makeHandlerWithDB(db)
	app := makeAuthRideAppWithRole(http.MethodGet, "/rides", h.List, "admin-1", "admin")

	resp := doRawRequest(t, app, http.MethodGet, "/rides", nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}
	var rides []map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&rides); err != nil {
		t.Fatal(err)
	}
	if len(rides) != 2 {
		t.Fatalf("expected admin to see all rides, got %#v", rides)
	}
}

func TestRequestSendsRideOfferExactlyOnceThroughDriverNotifier(t *testing.T) {
	now := time.Now()
	notifier := &fakeRideOfferNotifier{}
	db := &fakeDB{
		queryRowFn: func(ctx context.Context, sql string, args ...any) pgx.Row {
			if !strings.Contains(sql, "INSERT INTO public.rides") {
				return &fakeRow{err: pgx.ErrNoRows}
			}
			if args[0] != "rider-1" || args[1] != "pickup" || args[2] != "dropoff" || args[3] != "10.50" || args[4] != "cash" {
				t.Fatalf("unexpected ride request insert args: %#v", args)
			}
			return &fakeRow{values: []any{"ride-1", now}}
		},
	}

	h := makeHandlerWithDB(db)
	h.offerNotifier = notifier
	app := makeAuthRideApp(http.MethodPost, "/test/rides", h.Request, "rider-1")

	resp := doRequest(t, app, "/test/rides", RideRequest{
		RiderID:            "rider-1",
		PickupLocation:     "pickup",
		DropoffLocation:    "dropoff",
		EstimatedFareMinor: 1050,
		PaymentMethod:      "cash",
	})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("expected status 201, got %d", resp.StatusCode)
	}
	if len(notifier.events) != 1 {
		t.Fatalf("expected exactly one ride_offer notification, got %d", len(notifier.events))
	}

	event := notifier.events[0]
	if event.Event != "ride_offer" ||
		event.RideID != "ride-1" ||
		event.RiderID != "rider-1" ||
		event.PickupLocation != "pickup" ||
		event.DropoffLocation != "dropoff" ||
		event.EstimatedFareMinor != 1050 ||
		event.PaymentMethod != "cash" {
		t.Fatalf("unexpected ride_offer payload: %#v", event)
	}
}

func TestRequestShadowObserverDoesNotChangeRideOfferDelivery(t *testing.T) {
	now := time.Now()
	notifier := &fakeRideOfferNotifier{}
	observer := &fakeDispatchObserver{}
	db := &fakeDB{
		queryRowFn: func(ctx context.Context, sql string, args ...any) pgx.Row {
			if strings.Contains(sql, "INSERT INTO public.rides") {
				return &fakeRow{values: []any{"ride-1", now}}
			}
			return &fakeRow{err: pgx.ErrNoRows}
		},
	}

	h := NewHandler(db, websocket.NewManager(), websocket.NewConnectionRegistry(), websocket.NewConnectionRegistry(), observer)
	h.offerNotifier = notifier
	app := makeAuthRideApp(http.MethodPost, "/test/rides", h.Request, "rider-1")

	resp := doRequest(t, app, "/test/rides", RideRequest{
		PickupLocation:     "pickup",
		DropoffLocation:    "dropoff",
		EstimatedFareMinor: 1050,
		PaymentMethod:      "cash",
		PickupLatitude:     -17.826,
		PickupLongitude:    31.034,
	})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("expected status 201, got %d", resp.StatusCode)
	}
	if len(notifier.events) != 1 {
		t.Fatalf("expected exactly one production ride_offer, got %d", len(notifier.events))
	}
	if len(observer.rides) != 1 {
		t.Fatalf("expected one shadow observation, got %d", len(observer.rides))
	}
	if observer.rides[0].PickupLatitude != -17.826 || observer.rides[0].PickupLongitude != 31.034 {
		t.Fatalf("unexpected shadow ride context: %#v", observer.rides[0])
	}
}

func TestWalletRideRequestAuthorizesBeforeBroadcast(t *testing.T) {
	now := time.Now()
	notifier := &fakeRideOfferNotifier{}
	authorizer := &fakeWalletAuthorizer{enabled: true}
	db := &fakeDB{
		queryRowFn: func(ctx context.Context, sql string, args ...any) pgx.Row {
			if !strings.Contains(sql, "INSERT INTO public.rides") {
				return &fakeRow{err: pgx.ErrNoRows}
			}
			if !strings.Contains(sql, "id,") || !strings.Contains(sql, "RETURNING created_at") {
				t.Fatalf("wallet ride request must insert pre-authorized ride id: %s", sql)
			}
			if args[1] != "rider-1" || args[4] != "25.00" || args[5] != "wallet" {
				t.Fatalf("unexpected wallet ride insert args: %#v", args)
			}
			return &fakeRow{values: []any{now}}
		},
	}

	h := NewHandler(db, websocket.NewManager(), websocket.NewConnectionRegistry(), websocket.NewConnectionRegistry(), authorizer)
	h.offerNotifier = notifier
	app := makeAuthRideApp(http.MethodPost, "/test/rides", h.Request, "rider-1")

	resp := doRequest(t, app, "/test/rides", RideRequest{
		PickupLocation:     "pickup",
		DropoffLocation:    "dropoff",
		EstimatedFareMinor: 2500,
		PaymentMethod:      "wallet",
	})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("expected status 201, got %d", resp.StatusCode)
	}
	if len(authorizer.authorized) != 1 {
		t.Fatalf("expected one wallet authorization, got %d", len(authorizer.authorized))
	}
	if len(notifier.events) != 1 {
		t.Fatalf("expected wallet ride offer after authorization, got %d", len(notifier.events))
	}
	if notifier.events[0].RideID != authorizer.authorized[0].RideID {
		t.Fatalf("offer ride id must match authorized ride id")
	}
}

func TestWalletRideInsufficientFundsDoesNotBroadcast(t *testing.T) {
	notifier := &fakeRideOfferNotifier{}
	authorizer := &fakeWalletAuthorizer{enabled: true, authorizeErr: wallet.ErrInsufficientFunds}
	db := &fakeDB{
		queryRowFn: func(ctx context.Context, sql string, args ...any) pgx.Row {
			t.Fatalf("wallet ride with insufficient funds must not insert ride: %s", sql)
			return &fakeRow{err: pgx.ErrNoRows}
		},
	}

	h := NewHandler(db, websocket.NewManager(), websocket.NewConnectionRegistry(), websocket.NewConnectionRegistry(), authorizer)
	h.offerNotifier = notifier
	app := makeAuthRideApp(http.MethodPost, "/test/rides", h.Request, "rider-1")

	resp := doRequest(t, app, "/test/rides", RideRequest{
		PickupLocation:     "pickup",
		DropoffLocation:    "dropoff",
		EstimatedFareMinor: 2500,
		PaymentMethod:      "wallet",
	})
	if resp.StatusCode != http.StatusPaymentRequired {
		t.Fatalf("expected 402 for insufficient wallet funds, got %d", resp.StatusCode)
	}
	if len(notifier.events) != 0 {
		t.Fatalf("insufficient wallet funds must not broadcast ride_offer, got %d", len(notifier.events))
	}
}

func TestWalletRideRequestRequiresPilotEligibilityWhenPilotEnabled(t *testing.T) {
	notifier := &fakeRideOfferNotifier{}
	authorizer := &fakeWalletAuthorizer{enabled: true}
	pilot := fakePilotGate{enabled: true, eligible: false}
	db := &fakeDB{
		queryRowFn: func(ctx context.Context, sql string, args ...any) pgx.Row {
			t.Fatalf("non-pilot wallet ride must not insert ride: %s", sql)
			return &fakeRow{err: pgx.ErrNoRows}
		},
	}

	h := NewHandler(db, websocket.NewManager(), websocket.NewConnectionRegistry(), websocket.NewConnectionRegistry(), authorizer, pilot)
	h.offerNotifier = notifier
	app := makeAuthRideApp(http.MethodPost, "/test/rides", h.Request, "rider-1")

	resp := doRequest(t, app, "/test/rides", RideRequest{
		PickupLocation:     "pickup",
		DropoffLocation:    "dropoff",
		EstimatedFareMinor: 2500,
		PaymentMethod:      "wallet",
	})
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("expected non-pilot wallet ride to be forbidden, got %d", resp.StatusCode)
	}
	if len(authorizer.authorized) != 0 {
		t.Fatalf("pilot gate must block before authorization, got %#v", authorizer.authorized)
	}
	if len(notifier.events) != 0 {
		t.Fatalf("non-pilot wallet request must not broadcast ride_offer, got %d", len(notifier.events))
	}
}

func TestWalletRideRequestEnforcesPublicWalletPilotBeforeAuthorization(t *testing.T) {
	notifier := &fakeRideOfferNotifier{}
	authorizer := &fakeWalletAuthorizer{enabled: true}
	enforcer := &fakeWalletPilotEnforcer{err: wallet.ErrWalletPilotNotAuthorized}
	db := &fakeDB{
		queryRowFn: func(ctx context.Context, sql string, args ...any) pgx.Row {
			t.Fatalf("public wallet pilot denial must block before ride insert: %s", sql)
			return &fakeRow{err: pgx.ErrNoRows}
		},
	}

	h := NewHandler(db, websocket.NewManager(), websocket.NewConnectionRegistry(), websocket.NewConnectionRegistry(), authorizer, enforcer)
	h.offerNotifier = notifier
	app := makeAuthRideApp(http.MethodPost, "/test/rides", h.Request, "rider-1")

	resp := doRequest(t, app, "/test/rides", RideRequest{
		PickupLocation:     "pickup",
		DropoffLocation:    "dropoff",
		EstimatedFareMinor: 2500,
		PaymentMethod:      "wallet",
		City:               wallet.WalletPilotCityGwanda,
	})
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("expected wallet pilot denial 403, got %d", resp.StatusCode)
	}
	if !strings.Contains(string(readResponseBody(t, resp)), "wallet_pilot_not_authorized") {
		t.Fatal("expected wallet_pilot_not_authorized response")
	}
	if len(enforcer.guards) != 1 || enforcer.guards[0].TransactionType != wallet.WalletPilotTransactionTypeRidePayment || enforcer.guards[0].City != wallet.WalletPilotCityGwanda {
		t.Fatalf("expected ride payment guard, got %#v", enforcer.guards)
	}
	if len(authorizer.authorized) != 0 {
		t.Fatalf("pilot guard must block before authorization, got %#v", authorizer.authorized)
	}
	if len(notifier.events) != 0 {
		t.Fatalf("pilot guard must block before broadcast, got %d", len(notifier.events))
	}
}

func TestSubmitOfferSuccessful(t *testing.T) {
	insertedIntoRideOffers := false
	now := time.Now()
	db := &fakeDB{
		queryRowFn: func(ctx context.Context, sql string, args ...any) pgx.Row {
			if strings.Contains(sql, "SELECT ride_status") {
				return &fakeRow{values: []any{"requested", "cash"}}
			}
			if strings.Contains(sql, "INSERT INTO public.ride_offers") {
				insertedIntoRideOffers = true
				if args[1] != "ride-1" || args[2] != "driver-1" || args[3] != "12.50" || args[4] != 4 {
					t.Fatalf("unexpected insert args: %#v", args)
				}
				if strings.Contains(sql, "request"+"_id") || strings.Contains(sql, "ride_"+"request"+"_id") {
					t.Fatalf("offer insert must use ride_id, not request_id columns: %s", sql)
				}
				return &fakeRow{values: []any{now, now.Add(defaultOfferTTL)}}
			}
			return &fakeRow{err: pgx.ErrNoRows}
		},
	}

	h := makeHandlerWithDB(db)
	app := makeAuthRideApp(http.MethodPost, "/test/:rideId/offers", h.SubmitOffer, "driver-1")

	resp := doRequest(t, app, "/test/ride-1/offers", SubmitOfferRequest{AmountMinor: 1250, ETAMinutes: 4})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("expected status 201, got %d", resp.StatusCode)
	}
	if !insertedIntoRideOffers {
		t.Fatal("expected insert into public.ride_offers")
	}
}

func TestWalletRideSubmitOfferRequiresPilotDriver(t *testing.T) {
	db := &fakeDB{
		queryRowFn: func(ctx context.Context, sql string, args ...any) pgx.Row {
			if strings.Contains(sql, "SELECT ride_status") {
				return &fakeRow{values: []any{"requested", "wallet"}}
			}
			t.Fatalf("non-pilot wallet driver must not insert offer: %s", sql)
			return &fakeRow{err: pgx.ErrNoRows}
		},
	}

	h := NewHandler(db, websocket.NewManager(), websocket.NewConnectionRegistry(), websocket.NewConnectionRegistry(), &fakeWalletAuthorizer{enabled: true}, fakePilotGate{enabled: true, eligible: false})
	app := makeAuthRideApp(http.MethodPost, "/test/:rideId/offers", h.SubmitOffer, "driver-1")

	resp := doRequest(t, app, "/test/ride-1/offers", SubmitOfferRequest{AmountMinor: 1250, ETAMinutes: 4})
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("expected non-pilot driver wallet offer to be forbidden, got %d", resp.StatusCode)
	}
}

func TestListOffersReturnsPendingNonExpiredOffers(t *testing.T) {
	now := time.Now()
	db := &fakeDB{
		queryRowFn: func(ctx context.Context, sql string, args ...any) pgx.Row {
			return &fakeRow{values: []any{"rider-1"}}
		},
		queryFn: func(ctx context.Context, sql string, args ...any) (pgx.Rows, error) {
			if !strings.Contains(sql, "FROM public.ride_offers") ||
				!strings.Contains(sql, "ride_id = $1") ||
				!strings.Contains(sql, "status = 'pending'") ||
				!strings.Contains(sql, "expires_at > NOW()") {
				t.Fatalf("unexpected list offers SQL: %s", sql)
			}
			return &fakeRows{rows: [][]any{{"offer-1", "driver-1", int64(1250), 4, "pending", now.Add(time.Minute), now}}}, nil
		},
	}

	h := makeHandlerWithDB(db)
	app := makeAuthRideApp(http.MethodGet, "/test/:rideId/offers", h.ListOffers, "rider-1")

	req := httptest.NewRequest(http.MethodGet, "/test/ride-1/offers", nil)
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected status 200, got %d", resp.StatusCode)
	}
}

func TestAcceptOfferSuccessful(t *testing.T) {
	tx := &fakeTx{
		queryRowFn: func(ctx context.Context, sql string, args ...any) pgx.Row {
			if strings.Contains(sql, "FROM public.ride_offers") {
				return &fakeRow{values: []any{"offer-1", "ride-1", "driver-1", "pending", time.Now().Add(time.Minute)}}
			}
			return &fakeRow{values: []any{"rider-1", "requested", "cash"}, err: nil}
		},
		execFn: func(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error) {
			return pgconn.NewCommandTag("UPDATE 1"), nil
		},
		commitFn: func(ctx context.Context) error {
			return nil
		},
		rollbackFn: func(ctx context.Context) error {
			return nil
		},
	}
	db := &fakeDB{
		beginFn: func(ctx context.Context) (Tx, error) {
			return tx, nil
		},
	}

	h := makeHandlerWithDB(db)
	app := makeAuthApp(h.AcceptOffer, "rider-1")

	resp := doRequest(t, app, "/test/ride-1/offer-1", AcceptRideRequest{})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected status 200, got %d", resp.StatusCode)
	}

	body := readResponseBody(t, resp)
	var result map[string]any
	if err := json.Unmarshal(body, &result); err != nil {
		t.Fatal(err)
	}
	if result["ride_status"] != "accepted" {
		t.Fatalf("expected ride_status accepted, got %v", result["ride_status"])
	}
	if result["offer_id"] != "offer-1" {
		t.Fatalf("expected offer_id offer-1, got %v", result["offer_id"])
	}
}

func TestAcceptOfferExpiredOfferRejected(t *testing.T) {
	tx := &fakeTx{
		queryRowFn: func(ctx context.Context, sql string, args ...any) pgx.Row {
			return &fakeRow{values: []any{"offer-1", "ride-1", "driver-1", "pending", time.Now().Add(-time.Minute)}}
		},
		execFn: func(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error) {
			return pgconn.NewCommandTag("UPDATE 0"), nil
		},
		commitFn:   func(ctx context.Context) error { return nil },
		rollbackFn: func(ctx context.Context) error { return nil },
	}
	db := &fakeDB{beginFn: func(ctx context.Context) (Tx, error) { return tx, nil }}

	h := makeHandlerWithDB(db)
	app := makeAuthApp(h.AcceptOffer, "rider-1")

	resp := doRequest(t, app, "/test/ride-1/offer-1", AcceptRideRequest{})
	if resp.StatusCode != http.StatusConflict {
		t.Fatalf("expected status 409, got %d", resp.StatusCode)
	}
}

func TestAcceptOfferDuplicateAcceptanceAttempt(t *testing.T) {
	tx := &fakeTx{
		queryRowFn: func(ctx context.Context, sql string, args ...any) pgx.Row {
			if strings.Contains(sql, "FROM public.ride_offers") {
				return &fakeRow{values: []any{"offer-1", "ride-1", "driver-1", "pending", time.Now().Add(time.Minute)}}
			}
			return &fakeRow{values: []any{"rider-1", "requested", "cash"}}
		},
		execFn: func(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error) {
			if strings.Contains(sql, "UPDATE public.rides") {
				return pgconn.NewCommandTag("UPDATE 0"), nil
			}
			return pgconn.NewCommandTag("UPDATE 0"), nil
		},
		commitFn:   func(ctx context.Context) error { return nil },
		rollbackFn: func(ctx context.Context) error { return nil },
	}
	db := &fakeDB{beginFn: func(ctx context.Context) (Tx, error) { return tx, nil }}

	h := makeHandlerWithDB(db)
	app := makeAuthApp(h.AcceptOffer, "rider-1")

	resp := doRequest(t, app, "/test/ride-1/offer-1", AcceptRideRequest{})
	if resp.StatusCode != http.StatusConflict {
		t.Fatalf("expected status 409, got %d", resp.StatusCode)
	}
}

func TestAcceptOfferRaceConditionReturnsConflict(t *testing.T) {
	callCount := 0
	tx := &fakeTx{
		queryRowFn: func(ctx context.Context, sql string, args ...any) pgx.Row {
			if strings.Contains(sql, "FROM public.ride_offers") {
				return &fakeRow{values: []any{"offer-1", "ride-1", "driver-1", "pending", time.Now().Add(time.Minute)}}
			}
			return &fakeRow{values: []any{"rider-1", "requested", "cash"}}
		},
		execFn: func(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error) {
			callCount++
			if callCount == 1 && strings.Contains(sql, "UPDATE public.rides") {
				return pgconn.NewCommandTag("UPDATE 1"), nil
			}
			if strings.Contains(sql, "UPDATE public.ride_offers") {
				return pgconn.NewCommandTag("UPDATE 0"), nil
			}
			return pgconn.NewCommandTag("UPDATE 1"), nil
		},
		commitFn:   func(ctx context.Context) error { return nil },
		rollbackFn: func(ctx context.Context) error { return nil },
	}
	db := &fakeDB{beginFn: func(ctx context.Context) (Tx, error) { return tx, nil }}

	h := makeHandlerWithDB(db)
	app := makeAuthApp(h.AcceptOffer, "rider-1")

	resp := doRequest(t, app, "/test/ride-1/offer-1", AcceptRideRequest{})
	if resp.StatusCode != http.StatusConflict {
		t.Fatalf("expected status 409, got %d", resp.StatusCode)
	}
}

func TestRejectOfferSuccessful(t *testing.T) {
	var updateSQL string
	db := &fakeDB{
		execFn: func(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error) {
			updateSQL = sql
			if args[0] != "offer-1" || args[1] != "ride-1" || args[2] != "driver-1" {
				t.Fatalf("unexpected reject args: %#v", args)
			}
			return pgconn.NewCommandTag("UPDATE 1"), nil
		},
	}

	h := makeHandlerWithDB(db)
	app := makeAuthApp(h.RejectOffer, "driver-1")

	resp := doRequest(t, app, "/test/ride-1/offer-1", nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected status 200, got %d", resp.StatusCode)
	}
	if !strings.Contains(updateSQL, "UPDATE public.ride_offers") ||
		!strings.Contains(updateSQL, "ride_id = $2") ||
		!strings.Contains(updateSQL, "status = 'declined'") ||
		!strings.Contains(updateSQL, "declined_at = NOW()") {
		t.Fatalf("unexpected reject SQL: %s", updateSQL)
	}
}

func TestDriverCannotRejectAnotherDriversOffer(t *testing.T) {
	db := &fakeDB{
		execFn: func(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error) {
			if args[2] != "driver-2" {
				t.Fatalf("expected authenticated driver id in reject args, got %#v", args)
			}
			return pgconn.NewCommandTag("UPDATE 0"), nil
		},
	}

	h := makeHandlerWithDB(db)
	app := makeAuthApp(h.RejectOffer, "driver-2")

	resp := doRequest(t, app, "/test/ride-1/offer-1", nil)
	if resp.StatusCode != http.StatusConflict {
		t.Fatalf("expected status 409, got %d", resp.StatusCode)
	}
}

func TestRiderCannotAcceptOfferForAnotherRidersRide(t *testing.T) {
	tx := &fakeTx{
		queryRowFn: func(ctx context.Context, sql string, args ...any) pgx.Row {
			if strings.Contains(sql, "FROM public.ride_offers") {
				return &fakeRow{values: []any{"offer-1", "ride-1", "driver-1", "pending", time.Now().Add(time.Minute)}}
			}
			return &fakeRow{values: []any{"other-rider", "requested", "cash"}}
		},
		execFn: func(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error) {
			return pgconn.NewCommandTag("UPDATE 0"), nil
		},
		commitFn:   func(ctx context.Context) error { return nil },
		rollbackFn: func(ctx context.Context) error { return nil },
	}
	db := &fakeDB{beginFn: func(ctx context.Context) (Tx, error) { return tx, nil }}

	h := makeHandlerWithDB(db)
	app := makeAuthApp(h.AcceptOffer, "rider-1")

	resp := doRequest(t, app, "/test/ride-1/offer-1", AcceptRideRequest{})
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("expected status 403, got %d", resp.StatusCode)
	}
}

func TestStartRideEmitsRideStartedExactlyOnce(t *testing.T) {
	notifier := &fakeLifecycleNotifier{}
	db := &fakeDB{
		queryRowFn: func(ctx context.Context, sql string, args ...any) pgx.Row {
			switch {
			case strings.Contains(sql, "COALESCE(driver_id"):
				return &fakeRow{values: []any{"driver-1"}}
			case strings.Contains(sql, "UPDATE public.rides"):
				if !strings.Contains(sql, "RETURNING rider_id::text, driver_id::text") {
					t.Fatalf("expected start update to return lifecycle identities: %s", sql)
				}
				return &fakeRow{values: []any{"rider-1", "driver-1"}}
			default:
				return &fakeRow{err: pgx.ErrNoRows}
			}
		},
	}

	h := makeHandlerWithDB(db)
	h.lifecycleNotifier = notifier
	app := makeAuthRideApp(http.MethodPost, "/test/:rideId/status", h.UpdateStatus, "driver-1")

	resp := doRequest(t, app, "/test/ride-1/status", nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected status 200, got %d", resp.StatusCode)
	}
	if len(notifier.events) != 1 {
		t.Fatalf("expected exactly one lifecycle event, got %d", len(notifier.events))
	}

	event := notifier.events[0]
	if event.payload.Event != "ride_started" ||
		event.payload.RideID != "ride-1" ||
		event.payload.DriverID != "driver-1" ||
		event.payload.RideStatus != "ongoing" ||
		event.payload.Room != "ride_ride-1" ||
		event.riderID != "rider-1" ||
		event.driverID != "driver-1" {
		t.Fatalf("unexpected ride_started event: %#v", event)
	}
}

func TestCompleteRideEmitsRideCompletedExactlyOnce(t *testing.T) {
	notifier := &fakeLifecycleNotifier{}
	db := &fakeDB{
		queryRowFn: func(ctx context.Context, sql string, args ...any) pgx.Row {
			switch {
			case strings.Contains(sql, "COALESCE(driver_id"):
				return &fakeRow{values: []any{"driver-1"}}
			case strings.Contains(sql, "UPDATE public.rides"):
				if !strings.Contains(sql, "RETURNING rider_id::text, driver_id::text") {
					t.Fatalf("expected complete update to return lifecycle identities: %s", sql)
				}
				return &fakeRow{values: []any{"rider-1", "driver-1", "100.00", "cash"}}
			default:
				return &fakeRow{err: pgx.ErrNoRows}
			}
		},
	}

	h := makeHandlerWithDB(db)
	h.lifecycleNotifier = notifier
	app := makeAuthRideApp(http.MethodPost, "/test/:rideId/complete", h.CompleteRide, "driver-1")

	resp := doRequest(t, app, "/test/ride-1/complete", nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected status 200, got %d", resp.StatusCode)
	}
	if len(notifier.events) != 1 {
		t.Fatalf("expected exactly one lifecycle event, got %d", len(notifier.events))
	}

	event := notifier.events[0]
	if event.payload.Event != "ride_completed" ||
		event.payload.RideID != "ride-1" ||
		event.payload.DriverID != "driver-1" ||
		event.payload.RideStatus != "completed" ||
		event.payload.Room != "ride_ride-1" ||
		event.riderID != "rider-1" ||
		event.driverID != "driver-1" {
		t.Fatalf("unexpected ride_completed event: %#v", event)
	}
}

func TestCompleteRideTriggersShadowSettlementWithoutChangingResponse(t *testing.T) {
	settler := &fakeShadowSettler{}
	db := &fakeDB{
		queryRowFn: func(ctx context.Context, sql string, args ...any) pgx.Row {
			switch {
			case strings.Contains(sql, "COALESCE(driver_id"):
				return &fakeRow{values: []any{"driver-1"}}
			case strings.Contains(sql, "UPDATE public.rides"):
				return &fakeRow{values: []any{"rider-1", "driver-1", "50.00", "wallet"}}
			default:
				return &fakeRow{err: pgx.ErrNoRows}
			}
		},
	}

	h := NewHandler(db, websocket.NewManager(), websocket.NewConnectionRegistry(), websocket.NewConnectionRegistry(), settler)
	h.lifecycleNotifier = &fakeLifecycleNotifier{}
	app := makeAuthRideApp(http.MethodPost, "/test/:rideId/complete", h.CompleteRide, "driver-1")

	resp := doRequest(t, app, "/test/ride-1/complete", nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected status 200, got %d", resp.StatusCode)
	}
	if len(settler.rides) != 1 {
		t.Fatalf("expected one shadow settlement observation, got %d", len(settler.rides))
	}
	if settler.rides[0].FareMinor != 5000 || settler.rides[0].PaymentMethod != "wallet" {
		t.Fatalf("unexpected settlement ride: %#v", settler.rides[0])
	}
}

func TestCompleteRideTriggersActiveCashSettlementAfterRideCompletedEvent(t *testing.T) {
	notifier := &fakeLifecycleNotifier{}
	activeSettler := &fakeActiveCashSettler{}
	db := &fakeDB{
		queryRowFn: func(ctx context.Context, sql string, args ...any) pgx.Row {
			switch {
			case strings.Contains(sql, "COALESCE(driver_id"):
				return &fakeRow{values: []any{"driver-1"}}
			case strings.Contains(sql, "UPDATE public.rides"):
				return &fakeRow{values: []any{"rider-1", "driver-1", "100.00", "cash"}}
			default:
				return &fakeRow{err: pgx.ErrNoRows}
			}
		},
	}

	h := NewHandler(db, websocket.NewManager(), websocket.NewConnectionRegistry(), websocket.NewConnectionRegistry(), activeSettler)
	h.lifecycleNotifier = notifier
	app := makeAuthRideApp(http.MethodPost, "/test/:rideId/complete", h.CompleteRide, "driver-1")

	resp := doRequest(t, app, "/test/ride-1/complete", nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected status 200, got %d", resp.StatusCode)
	}
	if len(notifier.events) != 1 || notifier.events[0].payload.Event != "ride_completed" {
		t.Fatalf("expected ride_completed websocket event before settlement side effects, got %#v", notifier.events)
	}
	if len(activeSettler.rides) != 1 {
		t.Fatalf("expected active cash settlement observation, got %d", len(activeSettler.rides))
	}
	if activeSettler.rides[0].PaymentMethod != "cash" || activeSettler.rides[0].FareMinor != 10000 {
		t.Fatalf("unexpected active cash settlement ride: %#v", activeSettler.rides[0])
	}
}

func TestCompleteWalletRideTriggersCaptureWithoutChangingResponse(t *testing.T) {
	notifier := &fakeLifecycleNotifier{}
	authorizer := &fakeWalletAuthorizer{enabled: true, captureNotify: make(chan struct{})}
	db := &fakeDB{
		queryRowFn: func(ctx context.Context, sql string, args ...any) pgx.Row {
			switch {
			case strings.Contains(sql, "COALESCE(driver_id"):
				return &fakeRow{values: []any{"driver-1"}}
			case strings.Contains(sql, "UPDATE public.rides"):
				return &fakeRow{values: []any{"rider-1", "driver-1", "50.00", "wallet"}}
			default:
				return &fakeRow{err: pgx.ErrNoRows}
			}
		},
	}

	h := NewHandler(db, websocket.NewManager(), websocket.NewConnectionRegistry(), websocket.NewConnectionRegistry(), authorizer)
	h.lifecycleNotifier = notifier
	app := makeAuthRideApp(http.MethodPost, "/test/:rideId/complete", h.CompleteRide, "driver-1")

	resp := doRequest(t, app, "/test/ride-1/complete", nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected status 200, got %d", resp.StatusCode)
	}
	select {
	case <-authorizer.captureNotify:
	case <-time.After(time.Second):
		t.Fatal("expected wallet capture to be triggered")
	}
	if len(notifier.events) != 1 || notifier.events[0].payload.Event != "ride_completed" {
		t.Fatalf("expected ride_completed event, got %#v", notifier.events)
	}
	if len(authorizer.captured) != 1 || authorizer.captured[0].AmountMinor != 5000 {
		t.Fatalf("unexpected wallet capture request: %#v", authorizer.captured)
	}
}

func TestCompleteWalletRideSkipsCaptureForNonPilotDriver(t *testing.T) {
	notifier := &fakeLifecycleNotifier{}
	authorizer := &fakeWalletAuthorizer{enabled: true, captureNotify: make(chan struct{})}
	db := &fakeDB{
		queryRowFn: func(ctx context.Context, sql string, args ...any) pgx.Row {
			switch {
			case strings.Contains(sql, "COALESCE(driver_id"):
				return &fakeRow{values: []any{"driver-1"}}
			case strings.Contains(sql, "UPDATE public.rides"):
				return &fakeRow{values: []any{"rider-1", "driver-1", "50.00", "wallet"}}
			default:
				return &fakeRow{err: pgx.ErrNoRows}
			}
		},
	}

	h := NewHandler(db, websocket.NewManager(), websocket.NewConnectionRegistry(), websocket.NewConnectionRegistry(), authorizer, fakePilotGate{enabled: true, roleEligibility: map[string]bool{
		wallet.PilotRoleRider:  true,
		wallet.PilotRoleDriver: false,
	}})
	h.lifecycleNotifier = notifier
	app := makeAuthRideApp(http.MethodPost, "/test/:rideId/complete", h.CompleteRide, "driver-1")

	resp := doRequest(t, app, "/test/ride-1/complete", nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected ride completion to remain successful, got %d", resp.StatusCode)
	}
	select {
	case <-authorizer.captureNotify:
		t.Fatal("non-pilot wallet driver must not trigger wallet capture")
	case <-time.After(50 * time.Millisecond):
	}
	if len(notifier.events) != 1 || notifier.events[0].payload.Event != "ride_completed" {
		t.Fatalf("expected ride_completed event, got %#v", notifier.events)
	}
}

func TestDuplicateLifecycleTransitionDoesNotEmitDuplicateEvent(t *testing.T) {
	notifier := &fakeLifecycleNotifier{}
	updateAttempts := 0
	db := &fakeDB{
		queryRowFn: func(ctx context.Context, sql string, args ...any) pgx.Row {
			switch {
			case strings.Contains(sql, "COALESCE(driver_id"):
				return &fakeRow{values: []any{"driver-1"}}
			case strings.Contains(sql, "UPDATE public.rides"):
				updateAttempts++
				if updateAttempts == 1 {
					return &fakeRow{values: []any{"rider-1", "driver-1"}}
				}
				return &fakeRow{err: pgx.ErrNoRows}
			default:
				return &fakeRow{err: pgx.ErrNoRows}
			}
		},
	}

	h := makeHandlerWithDB(db)
	h.lifecycleNotifier = notifier
	app := makeAuthRideApp(http.MethodPost, "/test/:rideId/status", h.UpdateStatus, "driver-1")

	first := doRequest(t, app, "/test/ride-1/status", nil)
	if first.StatusCode != http.StatusOK {
		t.Fatalf("expected first status 200, got %d", first.StatusCode)
	}
	second := doRequest(t, app, "/test/ride-1/status", nil)
	if second.StatusCode != http.StatusConflict {
		t.Fatalf("expected second status 409, got %d", second.StatusCode)
	}
	if len(notifier.events) != 1 {
		t.Fatalf("expected exactly one lifecycle event across duplicate transitions, got %d", len(notifier.events))
	}
}

func TestOfferSQLDoesNotUseLegacyMarketplaceTables(t *testing.T) {
	source, err := os.ReadFile("handler.go")
	if err != nil {
		t.Fatal(err)
	}

	banned := []string{
		"app." + "ride_requests",
		"app." + "ride_offers",
		"app." + "rides",
		"app." + "offers",
		"app." + "driver_offers",
		"public." + "active_driver_offers",
		"public." + "driver_offers",
	}

	for _, table := range banned {
		if strings.Contains(string(source), table) {
			t.Fatalf("offer SQL must not use legacy marketplace table %s", table)
		}
	}
	if !strings.Contains(string(source), "public."+"ride_offers") {
		t.Fatal("offer SQL should use public.ride_offers")
	}
}

func TestRideOfferDoesNotUseGlobalBroadcastPath(t *testing.T) {
	source, err := os.ReadFile("handler.go")
	if err != nil {
		t.Fatal(err)
	}

	if strings.Contains(string(source), "h.ws.Broadcast(offerBytes)") {
		t.Fatal("ride_offer must not use global websocket broadcast")
	}
	if strings.Contains(string(source), "BROADCASTING RIDE OFFER") {
		t.Fatal("ride_offer logs must not describe global broadcasting")
	}
	if !strings.Contains(string(source), "NotifyRideOffer(offer)") {
		t.Fatal("ride request should notify ride_offer through the driver-targeted notifier")
	}
}
