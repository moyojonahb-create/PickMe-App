package websocket

import (
	"context"
	"errors"
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"

	"pickme-backend/internal/auth"
	"pickme-backend/internal/middleware"
)

const (
	LocalsUserID           = "websocket_user_id"
	LocalsRoomID           = "websocket_room_id"
	LocalsRegisterAsRider  = "websocket_register_as_rider"
	LocalsRegisterAsDriver = "websocket_register_as_driver"
)

type AuthenticatedConnection struct {
	UserID           string
	RoomID           string
	RegisterAsRider  bool
	RegisterAsDriver bool
}

type RoomAuthorizer interface {
	CanJoinRideRoom(ctx context.Context, rideID string, userID string) (bool, error)
}

// DriverAuthorizer defines the minimal interface websocket needs to decide driver registration.
// Kept here to avoid import cycles; concrete authz.Service implements this.
type DriverAuthorizer interface {
	CanActAsDriver(ctx context.Context, userID uuid.UUID) error
}

func AuthenticateRequest(c *fiber.Ctx, verifier *auth.SupabaseJWT, authorizer RoomAuthorizer, driverAuthz DriverAuthorizer) (AuthenticatedConnection, int, error) {
	token := websocketToken(c)
	if token == "" {
		return AuthenticatedConnection{}, fiber.StatusUnauthorized, errors.New("websocket token is required")
	}

	claims, err := verifier.Validate(token)
	if err != nil {
		return AuthenticatedConnection{}, fiber.StatusUnauthorized, errors.New("invalid or expired websocket token")
	}

	userID := claims.Subject
	riderID := c.Query("rider_id")
	driverID := c.Query("driver_id")

	if riderID != "" && riderID != userID {
		return AuthenticatedConnection{}, fiber.StatusForbidden, errors.New("rider_id does not match authenticated user")
	}
	if driverID != "" && driverID != userID {
		return AuthenticatedConnection{}, fiber.StatusForbidden, errors.New("driver_id does not match authenticated user")
	}

	roomID := c.Query("room")
	if roomID != "" {
		rideID, ok := RideIDFromRoom(roomID)
		if !ok {
			return AuthenticatedConnection{}, fiber.StatusForbidden, errors.New("invalid ride room")
		}

		allowed, err := authorizer.CanJoinRideRoom(middleware.RequestContext(c), rideID, userID)
		if err != nil {
			return AuthenticatedConnection{}, fiber.StatusInternalServerError, err
		}
		if !allowed {
			return AuthenticatedConnection{}, fiber.StatusForbidden, errors.New("user is not assigned to this ride room")
		}
	}

	// Determine roles server-side. Do not trust any client-supplied ?role parameter.
	registerAsDriver := false
	registerAsRider := false

	// Server-side decision: if authz says the user can act as driver, mark driver.
	if driverAuthz != nil {
		if uid, parseErr := uuid.Parse(userID); parseErr == nil {
			if driverAuthz.CanActAsDriver(middleware.RequestContext(c), uid) == nil {
				registerAsDriver = true
			}
		}
	}

	// If a rider_id was provided explicitly, always register as rider.
	if riderID != "" {
		registerAsRider = true
	} else if !registerAsDriver {
		// Default to rider when not authorized as driver.
		registerAsRider = true
	}

	conn := AuthenticatedConnection{
		UserID:           userID,
		RoomID:           roomID,
		RegisterAsRider:  registerAsRider,
		RegisterAsDriver: registerAsDriver,
	}

	return conn, fiber.StatusOK, nil
}

func SetAuthenticatedLocals(c *fiber.Ctx, conn AuthenticatedConnection) {
	c.Locals(LocalsUserID, conn.UserID)
	c.Locals(LocalsRoomID, conn.RoomID)
	c.Locals(LocalsRegisterAsRider, conn.RegisterAsRider)
	c.Locals(LocalsRegisterAsDriver, conn.RegisterAsDriver)
}

func websocketToken(c *fiber.Ctx) string {
	authHeader := c.Get("Authorization")
	if token, ok := strings.CutPrefix(authHeader, "Bearer "); ok {
		return strings.TrimSpace(token)
	}

	if token := c.Query("access_token"); token != "" {
		return token
	}

	return c.Query("token")
}

func RideIDFromRoom(roomID string) (string, bool) {
	rideID, ok := strings.CutPrefix(roomID, "ride_")
	return rideID, ok && rideID != ""
}
