package websocket

import (
	"context"
	"encoding/json"
	"log"
	"time"

	fasthttpws "github.com/fasthttp/websocket"
	"github.com/gofiber/contrib/socketio"
	"github.com/gofiber/fiber/v2"

	"pickme-backend/internal/auth"
	"pickme-backend/internal/observability"
)

func NewHandler(manager *Manager, riders *ConnectionRegistry, drivers *ConnectionRegistry, verifier *auth.SupabaseJWT, authorizer RoomAuthorizer, driverAuthz DriverAuthorizer) fiber.Handler {
	socketHandler := socketio.New(func(kws *socketio.Websocket) {
		roomID := localString(kws, LocalsRoomID)
		userID := localString(kws, LocalsUserID)
		registerAsRider := localBool(kws, LocalsRegisterAsRider)
		registerAsDriver := localBool(kws, LocalsRegisterAsDriver)

		log.Println("Authenticated WebSocket client connected:", userID)

		manager.AddClient(kws)
		kws.Conn.SetReadLimit(64 * 1024)
		_ = kws.Conn.SetReadDeadline(time.Now().Add(defaultPongWait))
		kws.Conn.SetPongHandler(func(string) error {
			return kws.Conn.SetReadDeadline(time.Now().Add(defaultPongWait))
		})

		if registerAsRider {
			if existing, exists := riders.Get(userID); exists && existing != kws {
				manager.RemoveClient(existing)
				riders.Delete(userID)
			}
			riders.Set(userID, kws)
			log.Println("Rider registered:", userID)
			log.Println("Registered riders:", riders.Count())
		}

		// If the server-side authorization flagged this connection as a driver, register it.
		if registerAsDriver {
			if existing, exists := drivers.Get(userID); exists && existing != kws {
				manager.RemoveClient(existing)
				drivers.Delete(userID)
			}
			drivers.Set(userID, kws)
			log.Println("Driver registered:", userID)
			log.Println("Registered drivers:", drivers.Count())
		}

		if roomID != "" {
			manager.JoinRoom(roomID, kws)
			log.Println("Client joined room:", roomID)
		}

		manager.Send(kws, mustJSON(fiber.Map{
			"event":              "ws_ready",
			"user_id":            userID,
			"room_id":            roomID,
			"heartbeat_interval": defaultPingInterval.Seconds(),
			"server_time":        time.Now().UTC(),
		}))

		defer func() {
			manager.RemoveClient(kws)

			if roomID != "" {
				manager.LeaveRoom(roomID, kws)
			}
			if registerAsDriver {
				drivers.Delete(userID)
				log.Println("Driver disconnected:", userID)
			}
			if registerAsRider {
				riders.Delete(userID)
			}
			log.Println("WebSocket client disconnected")
		}()

		messageLimiter := newConnectionMessageLimiter(defaultMessageRateLimit, defaultMessageRateWindow)

		for {
			_, msg, err := kws.Conn.ReadMessage()
			if err != nil {
				observability.CaptureError(err)
				log.Println("Read error:", err)
				break
			}

			observability.RecordWebSocketMessageReceived()
			log.Printf("WEBSOCKET_MESSAGE_RECEIVED user_id=%s bytes=%d", userID, len(msg))

			if !messageLimiter.Allow(time.Now()) {
				log.Printf("WEBSOCKET_RATE_LIMIT_EXCEEDED user_id=%s limit=%d window=%s timestamp=%s",
					userID, defaultMessageRateLimit, defaultMessageRateWindow, time.Now().UTC().Format(time.RFC3339))
				closePayload := fasthttpws.FormatCloseMessage(fasthttpws.ClosePolicyViolation, "rate limit exceeded")
				_ = kws.Conn.WriteControl(fasthttpws.CloseMessage, closePayload, time.Now().Add(defaultWriteTimeout))
				break
			}

			if handleControlMessage(kws, manager, authorizer, userID, msg) {
				continue
			}
			manager.Send(kws, mustJSON(fiber.Map{
				"event":       "ack",
				"server_time": time.Now().UTC(),
			}))
		}
	})

	return func(c *fiber.Ctx) error {
		conn, status, err := AuthenticateRequest(c, verifier, authorizer, driverAuthz)
		if err != nil {
			return c.Status(status).JSON(fiber.Map{"error": err.Error()})
		}

		SetAuthenticatedLocals(c, conn)
		return socketHandler(c)
	}
}

func localString(kws *socketio.Websocket, key string) string {
	value, _ := kws.Locals(key).(string)
	return value
}

func localBool(kws *socketio.Websocket, key string) bool {
	value, _ := kws.Locals(key).(bool)
	return value
}

func handleControlMessage(kws *socketio.Websocket, manager *Manager, authorizer RoomAuthorizer, userID string, msg []byte) bool {
	var incoming struct {
		Type   string `json:"type"`
		Event  string `json:"event"`
		RoomID string `json:"room_id"`
	}
	if err := json.Unmarshal(msg, &incoming); err != nil {
		return false
	}
	event := incoming.Event
	if event == "" {
		event = incoming.Type
	}
	switch event {
	case "ping":
		manager.Send(kws, mustJSON(fiber.Map{"event": "pong", "server_time": time.Now().UTC()}))
		return true
	case "join_room":
		roomID := incoming.RoomID
		rideID, ok := RideIDFromRoom(roomID)
		if !ok {
			manager.Send(kws, mustJSON(fiber.Map{"event": "join_room_denied", "room_id": roomID, "reason": "invalid_room"}))
			return true
		}
		allowed, err := authorizer.CanJoinRideRoom(context.Background(), rideID, userID)
		if err != nil || !allowed {
			manager.Send(kws, mustJSON(fiber.Map{"event": "join_room_denied", "room_id": roomID, "reason": "forbidden"}))
			return true
		}
		manager.JoinRoom(roomID, kws)
		manager.Send(kws, mustJSON(fiber.Map{"event": "room_joined", "room_id": roomID, "server_time": time.Now().UTC()}))
		return true
	case "leave_room":
		if incoming.RoomID != "" {
			manager.LeaveRoom(incoming.RoomID, kws)
			manager.Send(kws, mustJSON(fiber.Map{"event": "room_left", "room_id": incoming.RoomID, "server_time": time.Now().UTC()}))
		}
		return true
	default:
		return false
	}
}

func mustJSON(payload fiber.Map) []byte {
	raw, err := json.Marshal(payload)
	if err != nil {
		return []byte(`{"event":"serialization_error"}`)
	}
	return raw
}
