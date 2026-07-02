package rides

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"pickme-backend/internal/authz"
	"pickme-backend/internal/dispatch"
	"pickme-backend/internal/middleware"
	"pickme-backend/internal/observability"
	"pickme-backend/internal/wallet"
	"pickme-backend/internal/websocket"
)

type DB interface {
	Begin(ctx context.Context) (Tx, error)
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

type Tx interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
	Commit(ctx context.Context) error
	Rollback(ctx context.Context) error
}

type DriverAuthorizer interface {
	CanReceiveOffers(ctx context.Context, userID uuid.UUID) error
	CanAcceptRide(ctx context.Context, userID uuid.UUID) error
}

type rideAPIRecord struct {
	ID             string
	RiderID        string
	DriverID       string
	PickupAddress  string
	DropoffAddress string
	PickupLat      float64
	PickupLon      float64
	DropoffLat     float64
	DropoffLon     float64
	FareDecimal    string
	PaymentMethod  string
	RideStatus     string
	CreatedAt      time.Time
	ExpiresAt      time.Time
}

func publicRideStatus(rideStatus string) string {
	switch rideStatus {
	case "pending", "requested":
		return "requested"
	case "ongoing", "in_progress":
		return "in_progress"
	case "driver_arrived":
		return "arrived"
	case "enroute_pickup":
		return "enroute"
	default:
		if rideStatus == "" {
			return "requested"
		}
		return rideStatus
	}
}

func canonicalRideStatus(status string) (string, bool) {
	status = strings.ToLower(strings.TrimSpace(status))
	switch status {
	case "", "ongoing", "in_progress":
		return "ongoing", true
	case "pending", "requested":
		return "requested", true
	case "accepted":
		return "accepted", true
	case "enroute", "enroute_pickup":
		return "enroute", true
	case "arrived", "driver_arrived":
		return "arrived", true
	case "completed":
		return "completed", true
	case "cancelled", "canceled":
		return "cancelled", true
	default:
		return "", false
	}
}

func rideAPIResponse(ride rideAPIRecord) fiber.Map {
	fareMoney, _ := wallet.NewMoneyFromDecimal(ride.FareDecimal, wallet.CurrencyUSD)
	status := publicRideStatus(ride.RideStatus)
	driverID := any(nil)
	if ride.DriverID != "" {
		driverID = ride.DriverID
	}
	return fiber.Map{
		"id":               ride.ID,
		"ride_id":          ride.ID,
		"user_id":          ride.RiderID,
		"rider_id":         ride.RiderID,
		"driver_id":        driverID,
		"pickup_address":   ride.PickupAddress,
		"pickup_location":  ride.PickupAddress,
		"dropoff_address":  ride.DropoffAddress,
		"dropoff_location": ride.DropoffAddress,
		"pickup_lat":       ride.PickupLat,
		"pickup_lon":       ride.PickupLon,
		"dropoff_lat":      ride.DropoffLat,
		"dropoff_lon":      ride.DropoffLon,
		"fare":             decimalUSDFromMinor(fareMoney.MinorUnits),
		"estimated_fare":   decimalUSDFromMinor(fareMoney.MinorUnits),
		"payment_method":   ride.PaymentMethod,
		"ride_status":      ride.RideStatus,
		"status":           status,
		"created_at":       ride.CreatedAt,
		"expires_at":       ride.ExpiresAt,
	}
}

type Handler struct {
	db                DB
	ws                *websocket.Manager
	riders            *websocket.ConnectionRegistry
	drivers           *websocket.ConnectionRegistry
	offerNotifier     rideOfferNotifier
	lifecycleNotifier rideLifecycleNotifier
	dispatchObserver  dispatchObserver
	reputationTracker reputationTracker
	shadowSettler     shadowSettler
	activeCashSettler activeCashSettler
	walletAuthorizer  walletAuthorizer
	pilotGate         pilotGate
	walletPilot       wallet.WalletPilotRuntimeEnforcer
	authz             DriverAuthorizer
}

func NewHandler(db DB, ws *websocket.Manager, riders *websocket.ConnectionRegistry, drivers *websocket.ConnectionRegistry, observers ...any) *Handler {
	var dispatchObs dispatchObserver
	var reputationObs reputationTracker
	var settlementObs shadowSettler
	var activeCashObs activeCashSettler
	var walletAuthObs walletAuthorizer
	var pilotObs pilotGate
	var walletPilotObs wallet.WalletPilotRuntimeEnforcer
	for _, observer := range observers {
		if typed, ok := observer.(dispatchObserver); ok {
			dispatchObs = typed
		}
		if typed, ok := observer.(reputationTracker); ok {
			reputationObs = typed
		}
		if typed, ok := observer.(shadowSettler); ok {
			settlementObs = typed
		}
		if typed, ok := observer.(activeCashSettler); ok {
			activeCashObs = typed
		}
		if typed, ok := observer.(walletAuthorizer); ok {
			walletAuthObs = typed
		}
		if typed, ok := observer.(pilotGate); ok {
			pilotObs = typed
		}
		if typed, ok := observer.(wallet.WalletPilotRuntimeEnforcer); ok {
			walletPilotObs = typed
		}
	}
	return &Handler{
		db:      db,
		ws:      ws,
		riders:  riders,
		drivers: drivers,
		offerNotifier: websocketRideOfferNotifier{
			ws:      ws,
			drivers: drivers,
		},
		lifecycleNotifier: websocketRideLifecycleNotifier{
			ws:      ws,
			riders:  riders,
			drivers: drivers,
		},
		dispatchObserver:  dispatchObs,
		reputationTracker: reputationObs,
		shadowSettler:     settlementObs,
		activeCashSettler: activeCashObs,
		walletAuthorizer:  walletAuthObs,
		pilotGate:         pilotObs,
		walletPilot:       walletPilotObs,
	}
}

const defaultOfferTTL = 30 * time.Second

type rideOfferNotifier interface {
	NotifyRideOffer(payload RideOfferBroadcast)
}

type rideLifecycleNotifier interface {
	NotifyRideLifecycle(payload RideLifecycleBroadcast, riderID string, driverID string)
}

type dispatchObserver interface {
	ObserveRide(ctx context.Context, ride dispatch.RideContext)
	RecordFirstOffer(ctx context.Context, outcome dispatch.OfferOutcome)
	RecordAcceptedOffer(ctx context.Context, outcome dispatch.OfferOutcome)
}

type authoritativeDispatchObserver interface {
	Authoritative() bool
}

type driverAvailabilityDispatchObserver interface {
	SetDriverAvailability(ctx context.Context, driverID string, availability string, rideID string)
}

type reputationTracker interface {
	RecordOfferSent(ctx context.Context, driverIDs []string, rideID string)
	RecordOfferSubmitted(ctx context.Context, driverID string, rideID string, offerID string)
	RecordOfferAccepted(ctx context.Context, driverID string, rideID string, offerID string)
	RecordRideCompleted(ctx context.Context, driverID string, rideID string)
	RecordRideCancelled(ctx context.Context, driverID string, rideID string)
}

type shadowSettler interface {
	RecordCompletedRide(ctx context.Context, ride wallet.CompletedRide)
}

type activeCashSettler interface {
	RecordCompletedCashRide(ctx context.Context, ride wallet.CompletedRide)
}

type walletAuthorizer interface {
	Enabled() bool
	AuthorizeRideFunds(ctx context.Context, req wallet.AuthorizationRequest) (wallet.WalletAuthorization, error)
	CaptureRideFunds(ctx context.Context, req wallet.CaptureRequest) (wallet.SettlementRecord, error)
	ReleaseRideFunds(ctx context.Context, req wallet.ReleaseRequest) (wallet.WalletAuthorization, error)
}

type pilotGate interface {
	Enabled() bool
	IsPilotEligible(ctx context.Context, userID string, role string) bool
}

type websocketRideOfferNotifier struct {
	ws      *websocket.Manager
	drivers *websocket.ConnectionRegistry
}

type websocketRideLifecycleNotifier struct {
	ws      *websocket.Manager
	riders  *websocket.ConnectionRegistry
	drivers *websocket.ConnectionRegistry
}

func (n websocketRideOfferNotifier) NotifyRideOffer(payload RideOfferBroadcast) {
	payloadBytes, err := json.Marshal(payload)
	if err != nil {
		log.Println("Offer marshal error:", err)
		return
	}

	for driverID, driverSocket := range n.drivers.Snapshot() {
		if n.ws == nil || !n.ws.Send(driverSocket, payloadBytes) {
			log.Println("Targeted ride offer send failed")
			n.drivers.Delete(driverID)
			continue
		}

		log.Println("Ride offer sent to driver:", driverID)
	}
}

func (n websocketRideLifecycleNotifier) NotifyRideLifecycle(payload RideLifecycleBroadcast, riderID string, driverID string) {
	payloadBytes, err := json.Marshal(payload)
	if err != nil {
		log.Println("Ride lifecycle marshal error:", err)
		return
	}

	roomClients := n.ws.RoomSnapshot(payload.Room)
	n.ws.BroadcastRoom(payload.Room, payloadBytes)

	if riderSocket, exists := n.riders.Get(riderID); exists {
		if !roomClients[riderSocket] {
			if n.ws == nil || !n.ws.Send(riderSocket, payloadBytes) {
				log.Println("Ride lifecycle rider send failed")
				n.riders.Delete(riderID)
			}
		}
	}

	if driverSocket, exists := n.drivers.Get(driverID); exists {
		if !roomClients[driverSocket] {
			if n.ws == nil || !n.ws.Send(driverSocket, payloadBytes) {
				log.Println("Ride lifecycle driver send failed")
				n.drivers.Delete(driverID)
			}
		}
	}
}

type pgxDB struct {
	pool *pgxpool.Pool
}

type pgxTx struct {
	tx pgx.Tx
}

func NewDB(pool *pgxpool.Pool) DB {
	return &pgxDB{pool: pool}
}

func (d *pgxDB) Begin(ctx context.Context) (Tx, error) {
	observability.RecordPostgresQuery("rides_begin")
	tx, err := d.pool.Begin(ctx)
	if err != nil {
		observability.RecordPostgresFailure("rides_begin")
		observability.CaptureError(err)
		return nil, err
	}
	return &pgxTx{tx: tx}, nil
}

func (d *pgxDB) Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error) {
	observability.RecordPostgresQuery("rides_exec")
	tag, err := d.pool.Exec(ctx, sql, args...)
	if err != nil {
		observability.RecordPostgresFailure("rides_exec")
		observability.CaptureError(err)
	}
	return tag, err
}

func (d *pgxDB) Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error) {
	observability.RecordPostgresQuery("rides_query")
	rows, err := d.pool.Query(ctx, sql, args...)
	if err != nil {
		observability.RecordPostgresFailure("rides_query")
		observability.CaptureError(err)
	}
	return rows, err
}

func (d *pgxDB) QueryRow(ctx context.Context, sql string, args ...any) pgx.Row {
	observability.RecordPostgresQuery("rides_query_row")
	return d.pool.QueryRow(ctx, sql, args...)
}

func (t *pgxTx) Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error) {
	observability.RecordPostgresQuery("rides_tx_exec")
	tag, err := t.tx.Exec(ctx, sql, args...)
	if err != nil {
		observability.RecordPostgresFailure("rides_tx_exec")
		observability.CaptureError(err)
	}
	return tag, err
}

func (t *pgxTx) QueryRow(ctx context.Context, sql string, args ...any) pgx.Row {
	observability.RecordPostgresQuery("rides_tx_query_row")
	return t.tx.QueryRow(ctx, sql, args...)
}

func (t *pgxTx) Commit(ctx context.Context) error {
	return t.tx.Commit(ctx)
}

func (t *pgxTx) Rollback(ctx context.Context) error {
	return t.tx.Rollback(ctx)
}

func RegisterRoutes(app fiber.Router, h *Handler, requireAuth fiber.Handler) {
	app.Get("/rides", requireAuth, h.List)
	app.Post("/rides/request", requireAuth, h.Request)
	app.Post("/rides/:id/accept", requireAuth, h.Accept)
	app.Post("/rides/:id/start", requireAuth, h.Start)
	app.Post("/rides/:id/complete", requireAuth, h.Complete)
	app.Post("/rides/join-room", h.JoinRoom)
}

func RegisterCompatibilityRoutes(app fiber.Router, h *Handler, requireAuth fiber.Handler) {
	app.Post("/api/rides", requireAuth, h.Request)
	app.Get("/api/rides/open", requireAuth, h.ListOpenRides)
	app.Get("/api/rides/:rideId", requireAuth, h.GetRide)
	app.Patch("/api/rides/:rideId", requireAuth, h.PatchRide)
	app.Post("/api/rides/:rideId/offers", requireAuth, h.SubmitOffer)
	app.Get("/api/rides/:rideId/offers", requireAuth, h.ListOffers)
	app.Post("/api/rides/:rideId/offers/:offerId/accept", requireAuth, h.AcceptOffer)
	app.Post("/api/rides/:rideId/offers/:offerId/reject", requireAuth, h.RejectOffer)
	app.Post("/api/rides/offers/:offerId/reject", requireAuth, h.RejectOfferByID)
	app.Post("/api/rides/:rideId/status", requireAuth, h.UpdateStatus)
	app.Post("/api/rides/:rideId/complete", requireAuth, h.CompleteRide)
	app.Post("/api/rides/:rideId/settle", requireAuth, h.SettleRide)
}

func (h *Handler) List(c *fiber.Ctx) error {
	authUserID, ok := middleware.AuthenticatedUserID(c)
	if !ok {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Authentication required"})
	}
	role, _ := c.Locals(middleware.LocalsAuthRole).(string)

	query := `
		SELECT id, rider_id, pickup_location, dropoff_location,
		       estimated_fare, ride_status, created_at
		FROM public.rides
	`
	args := []any{}
	if role != "admin" && role != "service_role" {
		query += `
		WHERE rider_id::text = $1
		   OR driver_id::text = $1
		`
		args = append(args, authUserID)
	}
	query += `
		ORDER BY created_at DESC
		LIMIT 20
	`
	rows, err := h.db.Query(middleware.RequestContext(c), query, args...)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}
	defer rows.Close()

	var response []fiber.Map
	for rows.Next() {
		var ride RideRecord
		var estimatedFareDecimal string
		err := rows.Scan(
			&ride.ID,
			&ride.RiderID,
			&ride.PickupLocation,
			&ride.DropoffLocation,
			&estimatedFareDecimal,
			&ride.RideStatus,
			&ride.CreatedAt,
		)
		if err != nil {
			continue
		}
		if fareMoney, err := wallet.NewMoneyFromDecimal(estimatedFareDecimal, wallet.CurrencyUSD); err == nil {
			ride.EstimatedFareMinor = fareMoney.MinorUnits
		}

		response = append(response, fiber.Map{
			"id":               ride.ID,
			"rider_id":         ride.RiderID,
			"user_id":          ride.RiderID,
			"pickup_location":  ride.PickupLocation,
			"dropoff_location": ride.DropoffLocation,
			"estimated_fare":   decimalUSDFromMinor(ride.EstimatedFareMinor),
			"ride_status":      ride.RideStatus,
			"status":           publicRideStatus(ride.RideStatus),
			"created_at":       ride.CreatedAt,
		})
	}

	return c.JSON(response)
}

func (h *Handler) GetRide(c *fiber.Ctx) error {
	authUserID, ok := middleware.AuthenticatedUserID(c)
	if !ok {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Authentication required"})
	}
	rideID := c.Params("rideId")
	var ride rideAPIRecord
	err := h.db.QueryRow(middleware.RequestContext(c), `
		SELECT id, rider_id::text, COALESCE(driver_id::text, ''),
		       COALESCE(pickup_location, pickup_address, ''),
		       COALESCE(dropoff_location, dropoff_address, ''),
		       COALESCE(pickup_lat, 0), COALESCE(pickup_lon, 0),
		       COALESCE(dropoff_lat, 0), COALESCE(dropoff_lon, 0),
		       COALESCE(estimated_fare, fare, 0), COALESCE(payment_method, 'cash'),
		       COALESCE(ride_status, status, 'requested'), created_at,
		       COALESCE(expires_at, created_at + interval '5 minutes')
		FROM public.rides
		WHERE id = $1
		  AND (rider_id::text = $2 OR driver_id::text = $2)
	`, rideID, authUserID).Scan(
		&ride.ID,
		&ride.RiderID,
		&ride.DriverID,
		&ride.PickupAddress,
		&ride.DropoffAddress,
		&ride.PickupLat,
		&ride.PickupLon,
		&ride.DropoffLat,
		&ride.DropoffLon,
		&ride.FareDecimal,
		&ride.PaymentMethod,
		&ride.RideStatus,
		&ride.CreatedAt,
		&ride.ExpiresAt,
	)
	if err != nil {
		if err == pgx.ErrNoRows {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Ride not found"})
		}
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(rideAPIResponse(ride))
}

func (h *Handler) ListOpenRides(c *fiber.Ctx) error {
	if _, ok := middleware.AuthenticatedUserID(c); !ok {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Authentication required"})
	}
	rows, err := h.db.Query(middleware.RequestContext(c), `
		SELECT id, rider_id::text, COALESCE(driver_id::text, ''),
		       COALESCE(pickup_location, pickup_address, ''),
		       COALESCE(dropoff_location, dropoff_address, ''),
		       COALESCE(pickup_lat, 0), COALESCE(pickup_lon, 0),
		       COALESCE(dropoff_lat, 0), COALESCE(dropoff_lon, 0),
		       COALESCE(estimated_fare, fare, 0), COALESCE(payment_method, 'cash'),
		       COALESCE(ride_status, status, 'requested'), created_at,
		       COALESCE(expires_at, created_at + interval '5 minutes')
		FROM public.rides
		WHERE COALESCE(ride_status, status) IN ('requested', 'pending')
		  AND created_at >= NOW() - interval '5 minutes'
		ORDER BY created_at DESC
		LIMIT 30
	`)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	defer rows.Close()
	var rides []fiber.Map
	for rows.Next() {
		var ride rideAPIRecord
		if err := rows.Scan(
			&ride.ID,
			&ride.RiderID,
			&ride.DriverID,
			&ride.PickupAddress,
			&ride.DropoffAddress,
			&ride.PickupLat,
			&ride.PickupLon,
			&ride.DropoffLat,
			&ride.DropoffLon,
			&ride.FareDecimal,
			&ride.PaymentMethod,
			&ride.RideStatus,
			&ride.CreatedAt,
			&ride.ExpiresAt,
		); err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
		}
		rides = append(rides, rideAPIResponse(ride))
	}
	return c.JSON(rides)
}

func (h *Handler) Request(c *fiber.Ctx) error {
	ctx, span := observability.StartSpan(middleware.RequestContext(c), "Ride Request")
	defer span.End()

	authUserID, ok := middleware.AuthenticatedUserID(c)
	if !ok {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Authentication required"})
	}

	var req RideRequest

	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request body"})
	}

	if req.RiderID != "" && req.RiderID != authUserID {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "Cannot create a ride for another rider"})
	}
	req.RiderID = authUserID

	if req.PickupLocation == "" || req.DropoffLocation == "" {
		return c.Status(400).JSON(fiber.Map{
			"error": "pickup_location and dropoff_location are required",
		})
	}

	if req.PaymentMethod == "" {
		req.PaymentMethod = "cash"
	}

	var rideID string
	var createdAt time.Time
	var authorization wallet.WalletAuthorization
	var err error
	walletAuthorizationRequired := req.PaymentMethod == "wallet" && h.walletAuthorizer != nil && h.walletAuthorizer.Enabled()
	if walletAuthorizationRequired {
		if h.pilotGate != nil && h.pilotGate.Enabled() && !h.pilotGate.IsPilotEligible(ctx, req.RiderID, wallet.PilotRoleRider) {
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "Wallet internal pilot access required"})
		}
		if err := h.guardWalletPilot(ctx, wallet.WalletPilotMutationRequest{
			Endpoint:        "/rides/request",
			UserID:          req.RiderID,
			ParticipantType: wallet.WalletPilotParticipantTypeRider,
			City:            req.City,
			TransactionType: wallet.WalletPilotTransactionTypeRidePayment,
			AmountMinor:     req.EstimatedFareMinor,
			Currency:        wallet.CurrencyUSD,
		}); err != nil {
			return walletPilotDeniedResponse(c, err)
		}
		rideID = uuid.NewString()
		authorization, err = h.walletAuthorizer.AuthorizeRideFunds(ctx, wallet.AuthorizationRequest{
			RideID:         rideID,
			RiderID:        req.RiderID,
			AmountMinor:    req.EstimatedFareMinor,
			Currency:       wallet.CurrencyUSD,
			City:           req.City,
			IdempotencyKey: "ride-request-authorization:" + rideID,
		})
		if err != nil {
			return c.Status(walletAuthorizationStatus(err)).JSON(fiber.Map{"error": walletAuthorizationError(err)})
		}
	}

	if walletAuthorizationRequired {
		err = h.db.QueryRow(ctx, `
		INSERT INTO public.rides (
			id,
			rider_id,
			pickup_location,
			dropoff_location,
			estimated_fare,
			payment_method,
			payment_status,
			ride_status,
			created_at
		)
		VALUES ($1,$2,$3,$4,$5,$6,'pending','requested',NOW())
		RETURNING created_at
	`,
			rideID,
			req.RiderID,
			req.PickupLocation,
			req.DropoffLocation,
			wallet.MinorDecimalString(req.EstimatedFareMinor, wallet.CurrencyUSD),
			req.PaymentMethod,
		).Scan(&createdAt)
	} else {
		err = h.db.QueryRow(ctx, `
			INSERT INTO public.rides (
				rider_id,
				pickup_location,
				dropoff_location,
				estimated_fare,
				payment_method,
				payment_status,
				ride_status,
				created_at
			)
			VALUES ($1,$2,$3,$4,$5,'pending','requested',NOW())
			RETURNING id, created_at
		`,
			req.RiderID,
			req.PickupLocation,
			req.DropoffLocation,
			wallet.MinorDecimalString(req.EstimatedFareMinor, wallet.CurrencyUSD),
			req.PaymentMethod,
		).Scan(&rideID, &createdAt)
	}

	if err != nil {
		observability.RecordPostgresFailure("rides_create")
		observability.CaptureError(err)
		if walletAuthorizationRequired {
			_, releaseErr := h.walletAuthorizer.ReleaseRideFunds(ctx, wallet.ReleaseRequest{
				RideID:         authorization.RideID,
				RiderID:        authorization.RiderID,
				Reason:         "ride insert failed after wallet authorization",
				IdempotencyKey: "ride-request-insert-failed:" + authorization.RideID,
			})
			if releaseErr != nil {
				log.Println("Wallet authorization release warning:", releaseErr)
			}
		}
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}
	observability.RecordRideCreated()

	offer := RideOfferBroadcast{
		Event:              "ride_offer",
		RideID:             rideID,
		RiderID:            req.RiderID,
		PickupLocation:     req.PickupLocation,
		DropoffLocation:    req.DropoffLocation,
		EstimatedFare:      decimalUSDFromMinor(req.EstimatedFareMinor),
		EstimatedFareMinor: req.EstimatedFareMinor,
		PaymentMethod:      req.PaymentMethod,
	}

	if !h.authoritativeDispatchEnabled() {
		h.offerNotifier.NotifyRideOffer(offer)
		h.recordReputationOfferSent(context.Background(), rideID, h.driverIDsSnapshot())
	}
	h.observeDispatchRide(ctx, dispatch.RideContext{
		RideID:             rideID,
		RiderID:            req.RiderID,
		PickupLocation:     req.PickupLocation,
		DropoffLocation:    req.DropoffLocation,
		PickupLatitude:     req.PickupLatitude,
		PickupLongitude:    req.PickupLongitude,
		City:               req.City,
		VehicleType:        req.VehicleType,
		EstimatedFareMinor: req.EstimatedFareMinor,
		CreatedAt:          createdAt,
	})

	return c.Status(201).JSON(fiber.Map{
		"message":     "Ride request created and broadcast successfully 🚖",
		"ride_id":     rideID,
		"ride_status": "requested",
		"status":      publicRideStatus("requested"),
		"created_at":  createdAt,
	})
}

func walletAuthorizationStatus(err error) int {
	if errors.Is(err, wallet.ErrInsufficientFunds) {
		return fiber.StatusPaymentRequired
	}
	return fiber.StatusConflict
}

func walletAuthorizationError(err error) string {
	if errors.Is(err, wallet.ErrInsufficientFunds) {
		return "Insufficient wallet balance"
	}
	return "Wallet authorization could not be completed"
}

func (h *Handler) guardWalletPilot(ctx context.Context, req wallet.WalletPilotMutationRequest) error {
	if h == nil || h.walletPilot == nil {
		return nil
	}
	return h.walletPilot.GuardWalletMutation(ctx, req)
}

func walletPilotDeniedResponse(c *fiber.Ctx, err error) error {
	switch {
	case errors.Is(err, wallet.ErrWalletPilotDisabled):
		return c.Status(fiber.StatusLocked).JSON(fiber.Map{"error": "wallet_pilot_disabled"})
	case errors.Is(err, wallet.ErrWalletPilotLimitExceeded):
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "wallet_pilot_limit_exceeded"})
	case errors.Is(err, wallet.ErrWalletPilotNotAuthorized):
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "wallet_pilot_not_authorized"})
	default:
		return c.Status(fiber.StatusConflict).JSON(fiber.Map{"error": "Wallet authorization could not be completed"})
	}
}

func (h *Handler) Accept(c *fiber.Ctx) error {
	return h.acceptRide(c, c.Params("id"))
}

func (h *Handler) acceptRide(c *fiber.Ctx, rideID string) error {
	authUserID, ok := middleware.AuthenticatedUserID(c)
	if !ok {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Authentication required"})
	}

	var req AcceptRideRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request body"})
	}

	if req.DriverID != "" && req.DriverID != authUserID {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "Cannot accept a ride for another driver"})
	}
	req.DriverID = authUserID

	// Enforce driver authorization for accepting rides
	if h.authz != nil {
		uid, err := uuid.Parse(authUserID)
		if err != nil {
			authz.LogSecurityFailure(authUserID, "acceptRide", "invalid_userid")
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "driver_not_authorized"})
		}
		if err := h.authz.CanAcceptRide(middleware.RequestContext(c), uid); err != nil {
			authz.LogSecurityFailure(authUserID, "acceptRide", "not_authorized")
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "driver_not_authorized"})
		}
	}

	var riderID string
	var paymentMethod string
	err := h.db.QueryRow(
		context.Background(),
		`SELECT rider_id, COALESCE(payment_method, 'cash') FROM public.rides WHERE id = $1`,
		rideID,
	).Scan(&riderID, &paymentMethod)
	if err != nil {
		if err == pgx.ErrNoRows {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Ride not found"})
		}
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	if h.walletPilotRequiredForDriver(context.Background(), paymentMethod, req.DriverID) {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "Wallet internal pilot access required"})
	}

	commandTag, err := h.db.Exec(context.Background(), `
		UPDATE public.rides
		SET driver_id = $1,
		    ride_status = 'accepted',
		    status = 'accepted',
		    updated_at = NOW()
		WHERE id = $2
		  AND ride_status = 'requested'
	`, req.DriverID, rideID)

	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}

	if commandTag.RowsAffected() == 0 {
		return c.Status(409).JSON(fiber.Map{
			"error": "Ride already accepted or not found",
		})
	}
	h.setDispatchDriverAvailability(context.Background(), req.DriverID, "busy", rideID)

	roomID := "ride_" + rideID

	if riderSocket, exists := h.riders.Get(riderID); exists {
		acceptMsg := fiber.Map{
			"event":       "ride_accepted",
			"ride_id":     rideID,
			"driver_id":   req.DriverID,
			"room":        roomID,
			"ride_status": "accepted",
			"status":      publicRideStatus("accepted"),
		}

		msgBytes, _ := json.Marshal(acceptMsg)
		if h.ws == nil || !h.ws.Send(riderSocket, msgBytes) {
			log.Println("Ride acceptance send failed")
			h.riders.Delete(riderID)
		} else {
			log.Println("Ride acceptance sent to rider:", riderID)
		}
	}

	return c.JSON(fiber.Map{
		"message":     "Ride accepted successfully 🚖",
		"ride_id":     rideID,
		"driver_id":   req.DriverID,
		"ride_status": "accepted",
		"status":      publicRideStatus("accepted"),
		"room":        roomID,
	})
}

func (h *Handler) SubmitOffer(c *fiber.Ctx) error {
	ctx, span := observability.StartSpan(middleware.RequestContext(c), "Offer Creation")
	defer span.End()

	authUserID, ok := middleware.AuthenticatedUserID(c)
	if !ok {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Authentication required"})
	}

	var req SubmitOfferRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request body"})
	}

	if req.DriverID != "" && req.DriverID != authUserID {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "Cannot submit an offer for another driver"})
	}
	req.DriverID = authUserID

	// Enforce driver authorization for offer submission
	if h.authz != nil {
		uid, err := uuid.Parse(authUserID)
		if err != nil {
			authz.LogSecurityFailure(authUserID, "SubmitOffer", "invalid_userid")
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "driver_not_authorized"})
		}
		if err := h.authz.CanReceiveOffers(middleware.RequestContext(c), uid); err != nil {
			authz.LogSecurityFailure(authUserID, "SubmitOffer", "not_authorized")
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "driver_not_authorized"})
		}
	}

	rideID := c.Params("rideId")
	var rideStatus string
	var paymentMethod string
	err := h.db.QueryRow(ctx, `
		SELECT ride_status, COALESCE(payment_method, 'cash')
		FROM public.rides
		WHERE id = $1
	`, rideID).Scan(&rideStatus, &paymentMethod)
	if err != nil {
		observability.RecordPostgresFailure("rides_submit_offer_lookup")
		observability.CaptureError(err)
		if err == pgx.ErrNoRows {
			return c.Status(404).JSON(fiber.Map{"error": "Ride not found"})
		}
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}
	if h.walletPilotRequiredForDriver(ctx, paymentMethod, req.DriverID) {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "Wallet internal pilot access required"})
	}

	if rideStatus != "requested" {
		return c.Status(409).JSON(fiber.Map{"error": "Cannot submit an offer for a ride that is not requested"})
	}

	amountMinor := offerAmountMinor(req)
	if amountMinor <= 0 {
		return c.Status(400).JSON(fiber.Map{"error": "offer amount is required"})
	}
	etaMinutes := req.ETAMinutes
	if etaMinutes == 0 {
		etaMinutes = req.ETA
	}

	offerID := uuid.NewString()
	expiresAt := time.Now().Add(defaultOfferTTL)
	var createdAt time.Time

	err = h.db.QueryRow(ctx, `
		INSERT INTO public.ride_offers (
			id,
			ride_id,
			driver_id,
			offered_fare,
			offer_price,
			eta_minutes,
			status,
			expires_at,
			created_at
		)
		VALUES ($1,$2,$3,$4,$4,$5,'pending',$6,NOW())
		RETURNING created_at, expires_at
	`, offerID, rideID, req.DriverID, wallet.MinorDecimalString(amountMinor, wallet.CurrencyUSD), etaMinutes, expiresAt).Scan(&createdAt, &expiresAt)
	if err != nil {
		observability.RecordPostgresFailure("rides_submit_offer")
		observability.CaptureError(err)
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}

	h.recordDispatchFirstOffer(context.Background(), dispatch.OfferOutcome{
		RideID:   rideID,
		OfferID:  offerID,
		DriverID: req.DriverID,
		At:       createdAt,
	})
	h.recordReputationOfferSubmitted(context.Background(), req.DriverID, rideID, offerID)

	return c.Status(201).JSON(OfferResponse{
		ID:               offerID,
		OfferID:          offerID,
		RideID:           rideID,
		RequestID:        rideID,
		DriverID:         req.DriverID,
		Amount:           decimalUSDFromMinor(amountMinor),
		AmountMinor:      amountMinor,
		Price:            decimalUSDFromMinor(amountMinor),
		Fare:             decimalUSDFromMinor(amountMinor),
		FareMinor:        amountMinor,
		OfferedFare:      decimalUSDFromMinor(amountMinor),
		OfferedFareMinor: amountMinor,
		ETAMinutes:       etaMinutes,
		Status:           "pending",
		ExpiresAt:        expiresAt,
		CreatedAt:        createdAt,
	})
}

func offerAmountMinor(req SubmitOfferRequest) int64 {
	switch {
	case req.AmountMinor > 0:
		return req.AmountMinor
	case req.PriceMinor > 0:
		return req.PriceMinor
	case req.OfferedFareMinor > 0:
		return req.OfferedFareMinor
	case req.EstimatedFareMinor > 0:
		return req.EstimatedFareMinor
	default:
		return 0
	}
}

func (h *Handler) ListOffers(c *fiber.Ctx) error {
	authUserID, ok := middleware.AuthenticatedUserID(c)
	if !ok {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Authentication required"})
	}

	rideID := c.Params("rideId")
	var riderID string
	err := h.db.QueryRow(context.Background(), `
		SELECT rider_id
		FROM public.rides
		WHERE id = $1
	`, rideID).Scan(&riderID)
	if err != nil {
		if err == pgx.ErrNoRows {
			return c.Status(404).JSON(fiber.Map{"error": "Ride not found"})
		}
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}

	if riderID != authUserID {
		return c.Status(403).JSON(fiber.Map{"error": "Cannot view offers for another rider"})
	}

	rows, err := h.db.Query(context.Background(), `
		SELECT id, driver_id, offered_fare, COALESCE(eta_minutes, 0), status, expires_at, created_at
		FROM public.ride_offers
		WHERE ride_id = $1
		  AND (status = 'accepted' OR (status = 'pending' AND expires_at > NOW()))
		ORDER BY created_at ASC
	`, rideID)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}
	defer rows.Close()

	var offers []OfferResponse
	for rows.Next() {
		var offer OfferResponse
		if err := rows.Scan(
			&offer.OfferID,
			&offer.DriverID,
			&offer.OfferedFareMinor,
			&offer.ETAMinutes,
			&offer.Status,
			&offer.ExpiresAt,
			&offer.CreatedAt,
		); err != nil {
			return c.Status(500).JSON(fiber.Map{"error": err.Error()})
		}
		offer.RideID = rideID
		offer.ID = offer.OfferID
		offer.RequestID = rideID
		offer.AmountMinor = offer.OfferedFareMinor
		offer.FareMinor = offer.OfferedFareMinor
		offer.Amount = decimalUSDFromMinor(offer.OfferedFareMinor)
		offer.Fare = offer.Amount
		offer.Price = offer.Amount
		offer.OfferedFare = offer.Amount
		offers = append(offers, offer)
	}

	return c.JSON(offers)
}

func (h *Handler) RejectOffer(c *fiber.Ctx) error {
	return h.rejectOffer(c, c.Params("rideId"), c.Params("offerId"))
}

func (h *Handler) RejectOfferByID(c *fiber.Ctx) error {
	return h.rejectOffer(c, "", c.Params("offerId"))
}

func (h *Handler) rejectOffer(c *fiber.Ctx, rideID string, offerID string) error {
	authUserID, ok := middleware.AuthenticatedUserID(c)
	if !ok {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Authentication required"})
	}

	if rideID == "" {
		err := h.db.QueryRow(context.Background(), `
			SELECT ride_id
			FROM public.ride_offers
			WHERE id = $1
			  AND driver_id = $2
		`, offerID, authUserID).Scan(&rideID)
		if err != nil {
			if err == pgx.ErrNoRows {
				return c.Status(404).JSON(fiber.Map{"error": "Offer not found"})
			}
			return c.Status(500).JSON(fiber.Map{"error": err.Error()})
		}
	}

	commandTag, err := h.db.Exec(context.Background(), `
		UPDATE public.ride_offers
		SET status = 'declined',
		    declined_at = NOW()
		WHERE id = $1
		  AND ride_id = $2
		  AND driver_id = $3
		  AND status = 'pending'
	`, offerID, rideID, authUserID)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}

	if commandTag.RowsAffected() == 0 {
		return c.Status(409).JSON(fiber.Map{"error": "Offer cannot be rejected"})
	}
	h.setDispatchDriverAvailability(context.Background(), authUserID, "available", "")

	return c.JSON(fiber.Map{
		"message":  "Offer declined successfully",
		"offer_id": offerID,
		"status":   "declined",
	})
}

func (h *Handler) PatchRide(c *fiber.Ctx) error {
	authUserID, ok := middleware.AuthenticatedUserID(c)
	if !ok {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Authentication required"})
	}

	var req struct {
		FareMinor          int64 `json:"fare_minor"`
		EstimatedFareMinor int64 `json:"estimated_fare_minor"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request body"})
	}

	amountMinor := req.FareMinor
	if amountMinor <= 0 {
		amountMinor = req.EstimatedFareMinor
	}
	if amountMinor <= 0 {
		return c.Status(400).JSON(fiber.Map{"error": "fare_minor is required"})
	}

	rideID := c.Params("rideId")
	commandTag, err := h.db.Exec(context.Background(), `
		UPDATE public.rides
		SET estimated_fare = $3,
		    updated_at = NOW()
		WHERE id = $1
		  AND rider_id = $2
		  AND COALESCE(ride_status, status) IN ('requested', 'pending')
	`, rideID, authUserID, wallet.MinorDecimalString(amountMinor, wallet.CurrencyUSD))
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}
	if commandTag.RowsAffected() == 0 {
		return c.Status(409).JSON(fiber.Map{"error": "Ride cannot be updated"})
	}

	return c.JSON(fiber.Map{
		"ok":         true,
		"ride_id":    rideID,
		"fare":       decimalUSDFromMinor(amountMinor),
		"fare_minor": amountMinor,
	})
}

func (h *Handler) AcceptOffer(c *fiber.Ctx) error {
	return h.acceptOffer(c, c.Params("rideId"), c.Params("offerId"))
}

func (h *Handler) acceptOffer(c *fiber.Ctx, rideID, offerID string) error {
	ctx, span := observability.StartSpan(middleware.RequestContext(c), "Offer Acceptance")
	defer span.End()

	authUserID, ok := middleware.AuthenticatedUserID(c)
	if !ok {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Authentication required"})
	}

	var req AcceptRideRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request body"})
	}

	tx, err := h.db.Begin(ctx)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()

	var offer OfferRecord
	err = tx.QueryRow(ctx, `
		SELECT id, ride_id, driver_id, status, expires_at
		FROM public.ride_offers
		WHERE id = $1
		FOR UPDATE
	`, offerID).Scan(
		&offer.ID,
		&offer.RideID,
		&offer.DriverID,
		&offer.Status,
		&offer.ExpiresAt,
	)
	if err != nil {
		if err == pgx.ErrNoRows {
			return c.Status(404).JSON(fiber.Map{"error": "Offer not found"})
		}
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}

	if offer.RideID != rideID {
		return c.Status(404).JSON(fiber.Map{"error": "Offer does not belong to ride"})
	}

	if offer.Status != "pending" {
		return c.Status(409).JSON(fiber.Map{"error": "Offer is not pending"})
	}

	if time.Now().After(offer.ExpiresAt) {
		return c.Status(409).JSON(fiber.Map{"error": "Offer has expired"})
	}

	var riderID string
	var rideStatus string
	var paymentMethod string
	err = tx.QueryRow(ctx, `
		SELECT rider_id, ride_status, COALESCE(payment_method, 'cash')
		FROM public.rides
		WHERE id = $1
		FOR UPDATE
	`, rideID).Scan(&riderID, &rideStatus, &paymentMethod)
	if err != nil {
		if err == pgx.ErrNoRows {
			return c.Status(404).JSON(fiber.Map{"error": "Ride not found"})
		}
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}

	if riderID != authUserID {
		return c.Status(403).JSON(fiber.Map{"error": "Cannot accept offers for another rider"})
	}
	if h.walletPilotRequiredForDriver(ctx, paymentMethod, offer.DriverID) {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "Wallet internal pilot access required"})
	}

	if rideStatus != "requested" {
		return c.Status(409).JSON(fiber.Map{"error": "Ride cannot be accepted in its current state"})
	}

	commandTag, err := tx.Exec(ctx, `
		UPDATE public.rides
		SET driver_id = $1,
		    ride_status = 'accepted',
		    status = 'accepted',
		    updated_at = NOW()
		WHERE id = $2
		  AND ride_status = 'requested'
	`, offer.DriverID, rideID)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}
	if commandTag.RowsAffected() == 0 {
		return c.Status(409).JSON(fiber.Map{"error": "Ride already accepted or not found"})
	}

	commandTag, err = tx.Exec(ctx, `
		UPDATE public.ride_offers
		SET status = 'accepted',
		    accepted_at = NOW()
		WHERE id = $1
		  AND status = 'pending'
		  AND expires_at > NOW()
	`, offerID)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}
	if commandTag.RowsAffected() == 0 {
		return c.Status(409).JSON(fiber.Map{"error": "Offer no longer available"})
	}

	commandTag, err = tx.Exec(ctx, `
		UPDATE public.ride_offers
		SET status = 'expired',
		    expired_at = NOW()
		WHERE ride_id = $1
		  AND id != $2
		  AND status = 'pending'
	`, rideID, offerID)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}
	observability.RecordDispatchOfferExpired(commandTag.RowsAffected())

	if err = tx.Commit(ctx); err != nil {
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}

	log.Printf("Offer accepted: offer_id=%s ride_id=%s driver_id=%s rider_id=%s", offerID, rideID, offer.DriverID, authUserID)
	observability.RecordDispatchOfferAcceptance()
	h.recordDispatchAcceptedOffer(ctx, dispatch.OfferOutcome{
		RideID:   rideID,
		OfferID:  offerID,
		DriverID: offer.DriverID,
		At:       time.Now(),
	})
	h.setDispatchDriverAvailability(ctx, offer.DriverID, "busy", rideID)
	h.recordReputationOfferAccepted(ctx, offer.DriverID, rideID, offerID)

	roomID := "ride_" + rideID
	if riderSocket, exists := h.riders.Get(riderID); exists {
		acceptMsg := fiber.Map{
			"event":       "ride_accepted",
			"ride_id":     rideID,
			"driver_id":   offer.DriverID,
			"offer_id":    offerID,
			"room":        roomID,
			"ride_status": "accepted",
			"status":      publicRideStatus("accepted"),
		}

		msgBytes, _ := json.Marshal(acceptMsg)
		if h.ws == nil || !h.ws.Send(riderSocket, msgBytes) {
			log.Println("Ride acceptance send failed")
			h.riders.Delete(riderID)
		} else {
			log.Println("Ride acceptance sent to rider:", riderID)
		}
	}

	return c.JSON(fiber.Map{
		"message":     "Offer accepted successfully 🚖",
		"ride_id":     rideID,
		"offer_id":    offerID,
		"driver_id":   offer.DriverID,
		"ride_status": "accepted",
		"status":      publicRideStatus("accepted"),
		"room":        roomID,
	})
}

func (h *Handler) observeDispatchRide(ctx context.Context, ride dispatch.RideContext) {
	if h.dispatchObserver == nil {
		return
	}
	h.dispatchObserver.ObserveRide(ctx, ride)
}

func (h *Handler) authoritativeDispatchEnabled() bool {
	observer, ok := h.dispatchObserver.(authoritativeDispatchObserver)
	return ok && observer.Authoritative()
}

func (h *Handler) setDispatchDriverAvailability(ctx context.Context, driverID string, availability string, rideID string) {
	observer, ok := h.dispatchObserver.(driverAvailabilityDispatchObserver)
	if !ok {
		return
	}
	observer.SetDriverAvailability(ctx, driverID, availability, rideID)
}

func (h *Handler) recordDispatchFirstOffer(ctx context.Context, outcome dispatch.OfferOutcome) {
	if h.dispatchObserver == nil {
		return
	}
	h.dispatchObserver.RecordFirstOffer(ctx, outcome)
}

func (h *Handler) recordDispatchAcceptedOffer(ctx context.Context, outcome dispatch.OfferOutcome) {
	if h.dispatchObserver == nil {
		return
	}
	h.dispatchObserver.RecordAcceptedOffer(ctx, outcome)
}

func (h *Handler) driverIDsSnapshot() []string {
	drivers := h.drivers.Snapshot()
	driverIDs := make([]string, 0, len(drivers))
	for driverID := range drivers {
		driverIDs = append(driverIDs, driverID)
	}
	return driverIDs
}

func (h *Handler) recordReputationOfferSent(ctx context.Context, rideID string, driverIDs []string) {
	if h.reputationTracker == nil {
		return
	}
	h.reputationTracker.RecordOfferSent(ctx, driverIDs, rideID)
}

func (h *Handler) recordReputationOfferSubmitted(ctx context.Context, driverID string, rideID string, offerID string) {
	if h.reputationTracker == nil {
		return
	}
	h.reputationTracker.RecordOfferSubmitted(ctx, driverID, rideID, offerID)
}

func (h *Handler) recordReputationOfferAccepted(ctx context.Context, driverID string, rideID string, offerID string) {
	if h.reputationTracker == nil {
		return
	}
	h.reputationTracker.RecordOfferAccepted(ctx, driverID, rideID, offerID)
}

func (h *Handler) recordReputationRideCompleted(ctx context.Context, driverID string, rideID string) {
	if h.reputationTracker == nil {
		return
	}
	h.reputationTracker.RecordRideCompleted(ctx, driverID, rideID)
}

func (h *Handler) recordReputationRideCancelled(ctx context.Context, driverID string, rideID string) {
	if h.reputationTracker == nil {
		return
	}
	h.reputationTracker.RecordRideCancelled(ctx, driverID, rideID)
}

func (h *Handler) recordShadowSettlement(ctx context.Context, ride wallet.CompletedRide) {
	if h.shadowSettler == nil {
		return
	}
	h.shadowSettler.RecordCompletedRide(ctx, ride)
}

func (h *Handler) recordActiveCashSettlement(ctx context.Context, ride wallet.CompletedRide) {
	if h.activeCashSettler == nil {
		return
	}
	h.activeCashSettler.RecordCompletedCashRide(ctx, ride)
}

func (h *Handler) captureWalletSettlement(ctx context.Context, ride wallet.CompletedRide) {
	ctx, span := observability.StartSpan(ctx, "Wallet Settlement")
	defer span.End()

	if h.walletAuthorizer == nil || !h.walletAuthorizer.Enabled() || ride.PaymentMethod != "wallet" {
		return
	}
	if h.pilotGate != nil && h.pilotGate.Enabled() && !h.pilotGate.IsPilotEligible(ctx, ride.RiderID, wallet.PilotRoleRider) {
		log.Println("Wallet ride capture skipped for non-pilot rider:", ride.RiderID)
		return
	}
	if h.pilotGate != nil && h.pilotGate.Enabled() && !h.pilotGate.IsPilotEligible(ctx, ride.DriverID, wallet.PilotRoleDriver) {
		log.Println("Wallet ride capture skipped for non-pilot driver:", ride.DriverID)
		return
	}
	go func() {
		_, err := h.walletAuthorizer.CaptureRideFunds(context.Background(), wallet.CaptureRequest{
			RideID:         ride.RideID,
			RiderID:        ride.RiderID,
			DriverID:       ride.DriverID,
			AmountMinor:    ride.FareMinor,
			Currency:       ride.Currency,
			IdempotencyKey: "ride-completion-capture:" + ride.RideID,
		})
		if err != nil {
			observability.RecordWalletFailure("ride_capture")
			observability.CaptureError(err)
			log.Println("Wallet ride capture warning:", err)
		}
	}()
}

func (h *Handler) walletPilotRequiredForDriver(ctx context.Context, paymentMethod string, driverID string) bool {
	return paymentMethod == "wallet" &&
		h.walletAuthorizer != nil &&
		h.walletAuthorizer.Enabled() &&
		h.pilotGate != nil &&
		h.pilotGate.Enabled() &&
		!h.pilotGate.IsPilotEligible(ctx, driverID, wallet.PilotRoleDriver)
}

func (h *Handler) Start(c *fiber.Ctx) error {
	return h.startRide(c, c.Params("id"))
}

func (h *Handler) UpdateStatus(c *fiber.Ctx) error {
	var req struct {
		Status         string `json:"status"`
		RideStatus     string `json:"ride_status"`
		ExpectedStatus string `json:"expected_status"`
	}
	if len(c.Body()) > 0 {
		if err := c.BodyParser(&req); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request body"})
		}
	}

	status := req.RideStatus
	if status == "" {
		status = req.Status
	}
	canonicalStatus, ok := canonicalRideStatus(status)
	if !ok {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Unsupported ride status"})
	}
	switch canonicalStatus {
	case "ongoing":
		return h.startRide(c, c.Params("rideId"))
	case "completed":
		return h.completeRide(c, c.Params("rideId"))
	case "enroute", "arrived", "cancelled":
		return h.updateRideStatus(c, c.Params("rideId"), canonicalStatus, req.ExpectedStatus)
	default:
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Unsupported ride status transition"})
	}
}

func (h *Handler) updateRideStatus(c *fiber.Ctx, rideID string, rideStatus string, expectedStatus string) error {
	ctx := middleware.RequestContext(c)
	authUserID, ok := middleware.AuthenticatedUserID(c)
	if !ok {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Authentication required"})
	}

	if expectedStatus != "" {
		if canonicalExpected, ok := canonicalRideStatus(expectedStatus); ok {
			expectedStatus = canonicalExpected
		}
	}

	var allowedPrevious []string
	event := "ride_status_updated"
	if rideStatus == "enroute" {
		allowedPrevious = []string{"accepted"}
	} else if rideStatus == "arrived" {
		allowedPrevious = []string{"accepted", "enroute"}
	} else {
		allowedPrevious = []string{"requested", "accepted", "enroute", "arrived", "ongoing"}
		event = "ride_cancelled"
	}

	var riderID string
	var driverID string
	var err error
	if rideStatus == "cancelled" {
		err = h.db.QueryRow(ctx, `
			UPDATE public.rides
			SET ride_status = 'cancelled',
			    status = 'cancelled',
			    updated_at = NOW()
			WHERE id = $1
			  AND (rider_id::text = $2 OR driver_id::text = $2)
			  AND ride_status = ANY($3)
			  AND ($4 = '' OR ride_status = $4)
			RETURNING rider_id::text, COALESCE(driver_id::text, '')
		`, rideID, authUserID, allowedPrevious, expectedStatus).Scan(&riderID, &driverID)
	} else {
		authorized, authErr := h.isAssignedDriver(rideID, authUserID)
		if authErr != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": authErr.Error()})
		}
		if !authorized {
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "Cannot update a ride assigned to another driver"})
		}
		err = h.db.QueryRow(ctx, `
			UPDATE public.rides
			SET ride_status = $1,
			    status = $1,
			    updated_at = NOW()
			WHERE id = $2
			  AND driver_id::text = $3
			  AND ride_status = ANY($4)
			  AND ($5 = '' OR ride_status = $5)
			RETURNING rider_id::text, driver_id::text
		`, rideStatus, rideID, authUserID, allowedPrevious, expectedStatus).Scan(&riderID, &driverID)
	}
	if err != nil {
		observability.RecordPostgresFailure("rides_update_status")
		observability.CaptureError(err)
		if err == pgx.ErrNoRows {
			return c.Status(fiber.StatusConflict).JSON(fiber.Map{"error": "Ride cannot transition to requested status"})
		}
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}

	h.emitRideLifecycle(event, rideID, driverID, rideStatus, riderID)
	if rideStatus == "cancelled" && driverID != "" {
		h.recordReputationRideCancelled(ctx, driverID, rideID)
		h.setDispatchDriverAvailability(ctx, driverID, "available", "")
	}

	return c.JSON(fiber.Map{
		"message":     "Ride status updated successfully",
		"ride_id":     rideID,
		"ride_status": rideStatus,
		"status":      publicRideStatus(rideStatus),
	})
}

func (h *Handler) startRide(c *fiber.Ctx, rideID string) error {
	ctx, span := observability.StartSpan(middleware.RequestContext(c), "Ride Start")
	defer span.End()

	authUserID, ok := middleware.AuthenticatedUserID(c)
	if !ok {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Authentication required"})
	}

	authorized, err := h.isAssignedDriver(rideID, authUserID)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}
	if !authorized {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "Cannot start a ride assigned to another driver"})
	}

	var riderID string
	var driverID string
	err = h.db.QueryRow(ctx, `
		UPDATE public.rides
		SET ride_status = 'ongoing',
		    status = 'in_progress',
		    started_at = COALESCE(started_at, NOW()),
		    updated_at = NOW()
		WHERE id = $1
		  AND ride_status IN ('accepted', 'enroute', 'arrived')
		  AND driver_id = $2
		RETURNING rider_id::text, driver_id::text
	`, rideID, authUserID).Scan(&riderID, &driverID)
	if err != nil {
		observability.RecordPostgresFailure("rides_start")
		observability.CaptureError(err)
		if err == pgx.ErrNoRows {
			return c.Status(409).JSON(fiber.Map{
				"error": "Ride must be accepted before it can start",
			})
		}
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}

	observability.RecordRideStarted()
	h.emitRideLifecycle("ride_started", rideID, driverID, "ongoing", riderID)

	return c.JSON(fiber.Map{
		"message":     "Ride started successfully ðŸš–",
		"ride_id":     rideID,
		"ride_status": "ongoing",
		"status":      publicRideStatus("ongoing"),
	})
}

func (h *Handler) emitRideLifecycle(event string, rideID string, driverID string, rideStatus string, riderID string) {
	roomID := "ride_" + rideID
	h.lifecycleNotifier.NotifyRideLifecycle(RideLifecycleBroadcast{
		Event:      event,
		RideID:     rideID,
		DriverID:   driverID,
		RideStatus: rideStatus,
		Room:       roomID,
	}, riderID, driverID)
}

func (h *Handler) Complete(c *fiber.Ctx) error {
	return h.completeRide(c, c.Params("id"))
}

func (h *Handler) CompleteRide(c *fiber.Ctx) error {
	return h.completeRide(c, c.Params("rideId"))
}

func (h *Handler) SettleRide(c *fiber.Ctx) error {
	return h.completeRide(c, c.Params("rideId"))
}

func (h *Handler) completeRide(c *fiber.Ctx, rideID string) error {
	ctx, span := observability.StartSpan(middleware.RequestContext(c), "Ride Complete")
	defer span.End()

	authUserID, ok := middleware.AuthenticatedUserID(c)
	if !ok {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Authentication required"})
	}

	authorized, err := h.isAssignedDriver(rideID, authUserID)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}
	if !authorized {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "Cannot complete a ride assigned to another driver"})
	}

	var riderID string
	var driverID string
	var fareDecimal string
	var paymentMethod string
	err = h.db.QueryRow(ctx, `
		UPDATE public.rides
		SET ride_status = 'completed',
		    status = 'completed',
		    completed_at = NOW(),
		    updated_at = NOW()
		WHERE id = $1
		  AND ride_status IN ('ongoing', 'in_progress')
		  AND driver_id = $2
		RETURNING rider_id::text, driver_id::text, COALESCE(estimated_fare, 0), COALESCE(payment_method, 'cash')
	`, rideID, authUserID).Scan(&riderID, &driverID, &fareDecimal, &paymentMethod)
	if err != nil {
		observability.RecordPostgresFailure("rides_complete")
		observability.CaptureError(err)
		if err == pgx.ErrNoRows {
			return c.Status(409).JSON(fiber.Map{
				"error": "Ride must be ongoing before it can be completed",
			})
		}
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}

	observability.RecordRideCompleted()
	h.emitRideLifecycle("ride_completed", rideID, driverID, "completed", riderID)
	h.recordReputationRideCompleted(ctx, driverID, rideID)
	fareMoney, err := wallet.NewPositiveMoneyFromDecimal(fareDecimal, wallet.CurrencyUSD)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}
	completedRide := wallet.CompletedRide{
		RideID:        rideID,
		RiderID:       riderID,
		DriverID:      driverID,
		FareMinor:     fareMoney.MinorUnits,
		PaymentMethod: paymentMethod,
		Currency:      wallet.CurrencyUSD,
		City:          wallet.WalletPilotCityGwanda,
		CompletedAt:   time.Now().UTC(),
	}
	h.recordShadowSettlement(ctx, completedRide)
	h.recordActiveCashSettlement(ctx, completedRide)
	h.captureWalletSettlement(ctx, completedRide)
	h.setDispatchDriverAvailability(ctx, driverID, "available", "")

	return c.JSON(fiber.Map{
		"message":     "Ride completed successfully ðŸš–",
		"ride_id":     rideID,
		"ride_status": "completed",
		"status":      publicRideStatus("completed"),
	})
}

func (h *Handler) isAssignedDriver(rideID string, authUserID string) (bool, error) {
	var driverID string
	err := h.db.QueryRow(
		context.Background(),
		`SELECT COALESCE(driver_id::text, '') FROM public.rides WHERE id = $1`,
		rideID,
	).Scan(&driverID)
	if err != nil {
		if err == pgx.ErrNoRows {
			return true, nil
		}
		return false, err
	}
	if driverID == "" {
		return true, nil
	}
	return driverID == authUserID, nil
}

func (h *Handler) JoinRoom(c *fiber.Ctx) error {
	var req JoinRideRoomRequest

	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request body"})
	}

	if req.RideID == "" {
		return c.Status(400).JSON(fiber.Map{"error": "ride_id is required"})
	}

	return c.JSON(fiber.Map{
		"message": "Room ready",
		"room":    "ride_" + req.RideID,
		"ws_url":  "ws://localhost:3000/ws?room=ride_" + req.RideID,
	})
}
