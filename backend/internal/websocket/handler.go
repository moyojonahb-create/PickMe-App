package websocket

import (
	"log"

	"github.com/gofiber/contrib/socketio"
	"github.com/gofiber/fiber/v2"

	"pickme-backend/internal/auth"
)

func NewHandler(manager *Manager, riders *ConnectionRegistry, drivers *ConnectionRegistry, verifier *auth.SupabaseJWT, authorizer RoomAuthorizer, driverAuthz DriverAuthorizer) fiber.Handler {
	socketHandler := socketio.New(func(kws *socketio.Websocket) {
		roomID := localString(kws, LocalsRoomID)
		userID := localString(kws, LocalsUserID)
		registerAsRider := localBool(kws, LocalsRegisterAsRider)
		registerAsDriver := localBool(kws, LocalsRegisterAsDriver)

		log.Println("Authenticated WebSocket client connected:", userID)

		manager.AddClient(kws)

		if registerAsRider {
			riders.Set(userID, kws)
			log.Println("Rider registered:", userID)
			log.Println("Registered riders:", riders.Count())
		}

		// If the server-side authorization flagged this connection as a driver, register it.
		if registerAsDriver {
			drivers.Set(userID, kws)
			log.Println("Driver registered:", userID)
			log.Println("Registered drivers:", drivers.Count())
		}

		if roomID != "" {
			manager.JoinRoom(roomID, kws)
			log.Println("Client joined room:", roomID)
		}

		if registerAsDriver {
			drivers.Set(userID, kws)
			log.Println("Driver registered:", userID)
			log.Println("Registered drivers:", drivers.Count())
		}

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

		for {
			_, msg, err := kws.Conn.ReadMessage()
			if err != nil {
				log.Println("Read error:", err)
				break
			}

			log.Printf("WEBSOCKET_MESSAGE_RECEIVED user_id=%s bytes=%d", userID, len(msg))
			manager.Send(kws, []byte("SERVER RECEIVED: "+string(msg)))
			manager.Send(kws, []byte("SERVER RECEIVED: "+string(msg)))
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
