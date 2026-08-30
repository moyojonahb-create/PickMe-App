package drivers

import (
	"context"
	"encoding/json"
	"log"
	"math"
	"strconv"
	"sync"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"pickme-backend/internal/geo"
	"pickme-backend/internal/middleware"
	"pickme-backend/internal/websocket"
)

type DB interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

func (h *Handler) writeRedisDriverLocation(ctx context.Context, req DriverLocationRequest) {
	if h.geo == nil || !h.geo.Enabled() {
		return
	}
	city := req.City
	vehicleType := req.VehicleType
	if vehicleType == "" {
		vehicleType = "economy"
	}
	err := h.geo.WriteDriverLocation(ctx, geo.DriverLocation{
		DriverID:    req.DriverID,
		Latitude:    req.Latitude,
		Longitude:   req.Longitude,
		Heading:     req.Heading,
		Speed:       req.Speed,
		City:        city,
		VehicleType: vehicleType,
		UpdatedAt:   timeNowUTC(),
	})
	if err != nil {
		log.Println("Redis driver location hot-state warning:", err)
	}
}

func (h *Handler) writeRedisDriverPresence(ctx context.Context, presence geo.DriverPresence) {
	if h.geo == nil || !h.geo.Enabled() {
		return
	}
	if presence.LastSeenAt.IsZero() {
		presence.LastSeenAt = timeNowUTC()
	}
	if err := h.geo.WriteDriverPresence(ctx, presence); err != nil {
		log.Println("Redis driver presence hot-state warning:", err)
	}
}

func timeNowUTC() time.Time {
	return time.Now().UTC()
}

type DriverAuthorizer interface {
	CanUpdateLocation(ctx context.Context, userID uuid.UUID) error
	CanActAsDriver(ctx context.Context, userID uuid.UUID) error
}

type Handler struct {
	db                    DB
	ws                    *websocket.Manager
	geo                   *geo.Service
	reputation            driverReputationTracker
	authz                 DriverAuthorizer
	locationMu            sync.Mutex
	lastLocationUpdates   map[string]time.Time
	lastValidatedLocation map[string]validatedLocation
}

type validatedLocation struct {
	Latitude  float64
	Longitude float64
	At        time.Time
}

const (
	minimumLocationUpdateInterval = 500 * time.Millisecond
	maxDriverLocationSpeedMPS     = 100.0
)

type driverReputationTracker interface {
	RecordLocationFreshness(ctx context.Context, driverID string, fresh bool)
}

func NewHandler(db DB, ws *websocket.Manager, extras ...any) *Handler {
	var service *geo.Service
	var reputation driverReputationTracker
	var authzSvc DriverAuthorizer
	for _, extra := range extras {
		if typed, ok := extra.(*geo.Service); ok {
			service = typed
		}
		if typed, ok := extra.(driverReputationTracker); ok {
			reputation = typed
		}
		if typed, ok := extra.(DriverAuthorizer); ok {
			authzSvc = typed
		}
	}
	return &Handler{
		db:                    db,
		ws:                    ws,
		geo:                   service,
		reputation:            reputation,
		authz:                 authzSvc,
		lastLocationUpdates:   make(map[string]time.Time),
		lastValidatedLocation: make(map[string]validatedLocation),
	}
}

func RegisterRoutes(app fiber.Router, h *Handler, requireAuth fiber.Handler) {
	app.Post("/drivers/location", requireAuth, h.UpdateLocation)
	app.Post("/drivers/online", requireAuth, h.Online)
	app.Post("/drivers/heartbeat", requireAuth, h.Heartbeat)
	app.Post("/drivers/offline", requireAuth, h.Offline)
	app.Get("/drivers/nearby", requireAuth, middleware.AdminOnly(), h.Nearby)
}

func RegisterCompatibilityRoutes(app fiber.Router, h *Handler, requireAuth fiber.Handler) {
	app.Post("/api/drivers/me/presence", requireAuth, h.Presence)
	app.Post("/api/drivers/me/location", requireAuth, h.UpdateLocation)
}

func (h *Handler) Presence(c *fiber.Ctx) error {
	var body struct {
		Status   string `json:"status"`
		State    string `json:"state"`
		Action   string `json:"action"`
		IsOnline *bool  `json:"is_online"`
		Online   *bool  `json:"online"`
	}

	if err := c.BodyParser(&body); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request body"})
	}

	switch {
	case body.IsOnline != nil && !*body.IsOnline:
		return h.Offline(c)
	case body.Online != nil && !*body.Online:
		return h.Offline(c)
	case body.Status == "offline" || body.State == "offline" || body.Action == "offline":
		return h.Offline(c)
	case body.Status == "heartbeat" || body.State == "heartbeat" || body.Action == "heartbeat":
		return h.Heartbeat(c)
	default:
		return h.Online(c)
	}
}

func (h *Handler) UpdateLocation(c *fiber.Ctx) error {
	authUserID, ok := middleware.AuthenticatedUserID(c)
	if !ok {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Authentication required"})
	}
	// Enforce driver authorization
	if h.authz != nil {
		uid, err := uuid.Parse(authUserID)
		if err != nil {
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "driver_not_authorized"})
		}
		if err := h.authz.CanUpdateLocation(middleware.RequestContext(c), uid); err != nil {
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "driver_not_authorized"})
		}
	}

	var req DriverLocationRequest

	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request body"})
	}

	if req.DriverID != "" && req.DriverID != authUserID {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "Cannot update another driver's location"})
	}
	req.DriverID = authUserID

	if req.Latitude == 0 || req.Longitude == 0 {
		return c.Status(400).JSON(fiber.Map{
			"error": "latitude and longitude are required",
		})
	}
	if err := h.validateLocationUpdate(req); err != nil {
		logLocationAccessDenied(authUserID, "UpdateLocation", req.RideID, err.Error())
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid_location_update"})
	}

	if req.RideID != "" {
		allowed, err := h.canBroadcastLocationToRide(middleware.RequestContext(c), req.RideID, authUserID)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"error": err.Error()})
		}
		if !allowed {
			logLocationAccessDenied(authUserID, "UpdateLocation", req.RideID, "ride_not_assigned_to_driver")
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "Cannot broadcast location to a ride assigned to another driver"})
		}
	}

	// Two dead write paths removed here, both silently broken on every call:
	//
	//  - public.driver_locations is a read-only VIEW over live_locations
	//    (SELECT user_id AS driver_user_id, latitude, longitude, is_online,
	//    updated_at FROM live_locations WHERE user_type = 'driver'), with no
	//    INSTEAD OF trigger — never writable — and the INSERT here also
	//    referenced driver_id/speed/heading, none of which exist on it.
	//  - public.driver_sessions only has (id, driver_id, went_online_at,
	//    went_offline_at, forced_break_until, created_at) — no latitude,
	//    longitude, speed, heading, last_seen, or is_online. This UPDATE
	//    referenced all six and had been failing every time (logged, never
	//    surfaced to the caller, which is why it went unnoticed).
	//
	// The live_locations upsert right below already writes everything both
	// of these were attempting, and is what the view reads from and what
	// useNearbyDrivers/useDriverTracking on the frontend actually consume —
	// nothing else reads driver_locations or looks at driver_sessions for
	// location data. driver_sessions' real job (going online/offline) is
	// handled by Online()/Offline() elsewhere, not here.

	// live_locations is the table rider-side "nearby drivers"/tracking reads
	// (see useNearbyDrivers/useDriverTracking on the frontend) — it was
	// previously only written by Online()/Offline()/Heartbeat(), so a
	// driver's position froze at whatever Online() wrote (often 0,0) for
	// their entire online session. Keep it fresh here on every periodic
	// location update instead.
	if _, err := h.db.Exec(context.Background(), `
		INSERT INTO public.live_locations (
			user_id,
			user_type,
			latitude,
			longitude,
			heading,
			speed,
			is_online,
			updated_at
		)
		VALUES ($1,'driver',$2,$3,$4,$5,true,NOW())
		ON CONFLICT (user_id)
		DO UPDATE SET
			latitude = EXCLUDED.latitude,
			longitude = EXCLUDED.longitude,
			heading = EXCLUDED.heading,
			speed = EXCLUDED.speed,
			is_online = true,
			updated_at = NOW()
	`,
		req.DriverID,
		req.Latitude,
		req.Longitude,
		req.Heading,
		req.Speed,
	); err != nil {
		log.Println("live_locations update error:", err)
	}

	h.writeRedisDriverLocation(middleware.RequestContext(c), req)
	h.recordLocationFreshness(middleware.RequestContext(c), req.DriverID, true)

	roomID := ""
	if req.RideID != "" {
		roomID = "ride_" + req.RideID
	}

	broadcast := DriverLocationBroadcast{
		Event:     "driver_location",
		Room:      roomID,
		RideID:    req.RideID,
		DriverID:  req.DriverID,
		Latitude:  req.Latitude,
		Longitude: req.Longitude,
		Speed:     req.Speed,
		Heading:   req.Heading,
	}

	broadcastBytes, err := json.Marshal(broadcast)
	if err != nil {
		log.Println("Broadcast marshal error:", err)
	} else if roomID != "" {
		h.ws.BroadcastRoom(roomID, broadcastBytes)
	}

	return c.JSON(fiber.Map{
		"message":   "Driver location updated successfully 🚖",
		"driver_id": req.DriverID,
		"ride_id":   req.RideID,
		"room":      roomID,
		"latitude":  req.Latitude,
		"longitude": req.Longitude,
		"speed":     req.Speed,
		"heading":   req.Heading,
	})
}

func (h *Handler) validateLocationUpdate(req DriverLocationRequest) error {
	if req.Latitude < -90 || req.Latitude > 90 || req.Longitude < -180 || req.Longitude > 180 {
		return errLocationInvalidCoordinates
	}
	if req.Speed < 0 || req.Speed > 250 {
		return errLocationInvalidSpeed
	}

	now := timeNowUTC()
	h.locationMu.Lock()
	defer h.locationMu.Unlock()

	if lastUpdate, ok := h.lastLocationUpdates[req.DriverID]; ok && now.Sub(lastUpdate) < minimumLocationUpdateInterval {
		return errLocationRateLimited
	}

	if previous, ok := h.lastValidatedLocation[req.DriverID]; ok {
		elapsed := now.Sub(previous.At).Seconds()
		if elapsed > 0 {
			distanceM := haversineMeters(previous.Latitude, previous.Longitude, req.Latitude, req.Longitude)
			if distanceM/elapsed > maxDriverLocationSpeedMPS {
				return errLocationImpossibleJump
			}
		}
	}

	h.lastLocationUpdates[req.DriverID] = now
	h.lastValidatedLocation[req.DriverID] = validatedLocation{Latitude: req.Latitude, Longitude: req.Longitude, At: now}
	return nil
}

var (
	errLocationInvalidCoordinates = locationValidationError("invalid_coordinates")
	errLocationInvalidSpeed       = locationValidationError("invalid_speed")
	errLocationRateLimited        = locationValidationError("rate_limited")
	errLocationImpossibleJump     = locationValidationError("impossible_jump")
)

type locationValidationError string

func (e locationValidationError) Error() string { return string(e) }

func haversineMeters(lat1, lon1, lat2, lon2 float64) float64 {
	const earthRadiusM = 6371000.0
	dLat := degreesToRadians(lat2 - lat1)
	dLon := degreesToRadians(lon2 - lon1)
	a := math.Sin(dLat/2)*math.Sin(dLat/2) + math.Cos(degreesToRadians(lat1))*math.Cos(degreesToRadians(lat2))*math.Sin(dLon/2)*math.Sin(dLon/2)
	c := 2 * math.Atan2(math.Sqrt(a), math.Sqrt(1-a))
	return earthRadiusM * c
}

func degreesToRadians(degrees float64) float64 {
	return degrees * math.Pi / 180
}

func logLocationAccessDenied(userID string, endpoint string, rideID string, reason string) {
	log.Printf("SECURITY_LOCATION_ACCESS_DENIED user_id=%s endpoint=%s ride_id=%s reason=%s timestamp=%s\n",
		userID, endpoint, rideID, reason, timeNowUTC().Format(time.RFC3339))
}

func (h *Handler) recordLocationFreshness(ctx context.Context, driverID string, fresh bool) {
	if h.reputation == nil {
		return
	}
	h.reputation.RecordLocationFreshness(ctx, driverID, fresh)
}

func (h *Handler) Online(c *fiber.Ctx) error {
	authUserID, ok := middleware.AuthenticatedUserID(c)
	if !ok {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Authentication required"})
	}
	// Enforce driver authorization
	if h.authz != nil {
		uid, err := uuid.Parse(authUserID)
		if err != nil {
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "driver_not_authorized"})
		}
		if err := h.authz.CanActAsDriver(middleware.RequestContext(c), uid); err != nil {
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "driver_not_authorized"})
		}
	}

	var req DriverOnlineRequest

	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request body"})
	}

	if req.DriverID != "" && req.DriverID != authUserID {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "Cannot bring another driver online"})
	}
	req.DriverID = authUserID

	if req.VehicleType == "" {
		req.VehicleType = "economy"
	}

	cmdTag, err := h.db.Exec(context.Background(), `
		UPDATE public.drivers
		SET is_online = true,
		    vehicle_type = $2,
		    updated_at = NOW()
		WHERE user_id = $1
	`,
		req.DriverID,
		req.VehicleType,
	)

	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}

	if cmdTag.RowsAffected() == 0 {
		return c.Status(404).JSON(fiber.Map{"error": "Driver profile not found"})
	}

	_, err = h.db.Exec(context.Background(), `
		INSERT INTO public.live_locations (
			user_id,
			user_type,
			latitude,
			longitude,
			heading,
			speed,
			is_online,
			updated_at
		)
		VALUES ($1,'driver',$2,$3,$4,$5,true,NOW())
		ON CONFLICT (user_id)
		DO UPDATE SET
			latitude = EXCLUDED.latitude,
			longitude = EXCLUDED.longitude,
			heading = EXCLUDED.heading,
			speed = EXCLUDED.speed,
			is_online = true,
			updated_at = NOW()
	`,
		req.DriverID,
		req.Latitude,
		req.Longitude,
		req.Heading,
		req.Speed,
	)

	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}

	h.writeRedisDriverPresence(middleware.RequestContext(c), geo.DriverPresence{
		DriverID:     req.DriverID,
		State:        "online",
		Availability: "available",
		LastSeenAt:   timeNowUTC(),
	})
	if req.Latitude != 0 && req.Longitude != 0 {
		h.writeRedisDriverLocation(middleware.RequestContext(c), DriverLocationRequest{
			DriverID:    req.DriverID,
			Latitude:    req.Latitude,
			Longitude:   req.Longitude,
			Speed:       req.Speed,
			Heading:     req.Heading,
			VehicleType: req.VehicleType,
		})
	}

	return c.JSON(fiber.Map{
		"message":      "Driver is now online 🚖",
		"driver_id":    req.DriverID,
		"is_online":    true,
		"vehicle_type": req.VehicleType,
	})
}

func (h *Handler) Heartbeat(c *fiber.Ctx) error {
	authUserID, ok := middleware.AuthenticatedUserID(c)
	if !ok {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Authentication required"})
	}
	// Enforce driver authorization
	if h.authz != nil {
		uid, err := uuid.Parse(authUserID)
		if err != nil {
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "driver_not_authorized"})
		}
		if err := h.authz.CanActAsDriver(middleware.RequestContext(c), uid); err != nil {
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "driver_not_authorized"})
		}
	}

	var req DriverHeartbeatRequest

	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request body"})
	}

	if req.DriverID != "" && req.DriverID != authUserID {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "Cannot send heartbeat for another driver"})
	}
  req.DriverID = authUserID

	// Going online is Online()'s job; a heartbeat only refreshes a driver who is
	// already online, so an admin force-offline is not undone by the driver's
	// next beat.
	commandTag, err := h.db.Exec(context.Background(), `
		UPDATE public.drivers
		SET updated_at = NOW()
		WHERE user_id = $1
		  AND is_online = true
	`, req.DriverID)

	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}

	if commandTag.RowsAffected() == 0 {
		return c.Status(409).JSON(fiber.Map{"error": "driver_not_online"})
	}

	if _, err := h.db.Exec(context.Background(), `
		UPDATE public.live_locations
		SET is_online = true,
		    updated_at = NOW()
		WHERE user_id = $1
		  AND is_online = true
	`, req.DriverID); err != nil {
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}

	h.writeRedisDriverPresence(middleware.RequestContext(c), geo.DriverPresence{
		DriverID:     req.DriverID,
		State:        "online",
		Availability: "available",
		LastSeenAt:   timeNowUTC(),
	})

	return c.JSON(fiber.Map{
		"message":   "Heartbeat received ❤️",
		"driver_id": req.DriverID,
		"is_online": true,
	})
}

func (h *Handler) Offline(c *fiber.Ctx) error {
	authUserID, ok := middleware.AuthenticatedUserID(c)
	if !ok {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Authentication required"})
	}
	// Enforce driver authorization
	if h.authz != nil {
		uid, err := uuid.Parse(authUserID)
		if err != nil {
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "driver_not_authorized"})
		}
		if err := h.authz.CanActAsDriver(middleware.RequestContext(c), uid); err != nil {
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "driver_not_authorized"})
		}
	}

	var body struct {
		DriverID string `json:"driver_id"`
	}

	if err := c.BodyParser(&body); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request body"})
	}

	if body.DriverID != "" && body.DriverID != authUserID {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "Cannot take another driver offline"})
	}
	body.DriverID = authUserID

	commandTag, err := h.db.Exec(context.Background(), `
		UPDATE public.drivers
		SET is_online = false,
		    updated_at = NOW()
		WHERE user_id = $1
	`, body.DriverID)

	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}

	if commandTag.RowsAffected() == 0 {
		return c.Status(404).JSON(fiber.Map{"error": "Driver session not found"})
	}

	if _, err := h.db.Exec(context.Background(), `
		UPDATE public.live_locations
		SET is_online = false,
		    updated_at = NOW()
		WHERE user_id = $1
	`, body.DriverID); err != nil {
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}

	h.writeRedisDriverPresence(middleware.RequestContext(c), geo.DriverPresence{
		DriverID:     body.DriverID,
		State:        "offline",
		Availability: "offline",
		LastSeenAt:   timeNowUTC(),
	})

	return c.JSON(fiber.Map{
		"message":   "Driver is now offline 📴",
		"driver_id": body.DriverID,
		"is_online": false,
	})
}

func (h *Handler) canBroadcastLocationToRide(ctx context.Context, rideID string, driverID string) (bool, error) {
	var allowed bool
	err := h.db.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1
			FROM public.rides
			WHERE id = $1
			  AND driver_id = $2
			  AND ride_status IN ('accepted', 'ongoing')
		)
	`, rideID, driverID).Scan(&allowed)
	if err != nil {
		return false, err
	}

	return allowed, nil
}

func (h *Handler) Nearby(c *fiber.Ctx) error {
	latStr := c.Query("lat")
	lngStr := c.Query("lng")
	radiusStr := c.Query("radius", "5")

	if latStr == "" || lngStr == "" {
		return c.Status(400).JSON(fiber.Map{
			"error": "lat and lng query params are required. Example: /drivers/nearby?lat=-20.3&lng=30.0&radius=5",
		})
	}

	lat, err := strconv.ParseFloat(latStr, 64)
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid lat value"})
	}

	lng, err := strconv.ParseFloat(lngStr, 64)
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid lng value"})
	}

	radius, err := strconv.ParseFloat(radiusStr, 64)
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid radius value"})
	}

	rows, err := h.db.Query(context.Background(), `
		SELECT
			ll.user_id AS driver_id,
			ll.latitude,
			ll.longitude,
			d.vehicle_type,
			ll.speed,
			ll.heading,
			ll.updated_at AS last_seen,
			(
				6371 * acos(
					LEAST(
						1,
						GREATEST(
							-1,
							cos(radians($1)) *
							cos(radians(ll.latitude)) *
							cos(radians(ll.longitude) - radians($2)) +
							sin(radians($1)) *
							sin(radians(ll.latitude))
						)
					)
				)
			) AS distance_km
		FROM public.live_locations ll
		JOIN public.drivers d ON d.user_id = ll.user_id
		WHERE ll.is_online = true
		  AND ll.user_type = 'driver'
		  AND ll.updated_at >= NOW() - INTERVAL '5 minutes'
		  AND (
				6371 * acos(
					LEAST(
						1,
						GREATEST(
							-1,
							cos(radians($1)) *
							cos(radians(ll.latitude)) *
							cos(radians(ll.longitude) - radians($2)) +
							sin(radians($1)) *
							sin(radians(ll.latitude))
						)
					)
				)
		  ) <= $3
		ORDER BY distance_km ASC
		LIMIT 50
	`, lat, lng, radius)

	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}
	defer rows.Close()

	var drivers []NearbyDriver
	for rows.Next() {
		var driver NearbyDriver

		err := rows.Scan(
			&driver.DriverID,
			&driver.Latitude,
			&driver.Longitude,
			&driver.VehicleType,
			&driver.Speed,
			&driver.Heading,
			&driver.LastSeen,
			&driver.DistanceKM,
		)
		if err != nil {
			continue
		}

		drivers = append(drivers, driver)
	}

	return c.JSON(fiber.Map{
		"center": fiber.Map{
			"latitude":  lat,
			"longitude": lng,
		},
		"radius_km": radius,
		"count":     len(drivers),
		"drivers":   drivers,
	})
}
