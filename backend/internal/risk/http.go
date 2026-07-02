package risk

import (
	"strconv"

	"github.com/gofiber/fiber/v2"

	"pickme-backend/internal/middleware"
)

func RegisterRoutes(app fiber.Router, service *Service, requireAuth fiber.Handler) {
	api := app.Group("/api/risk", requireAuth)
	api.Post("/events", recordEventHandler(service))
	api.Get("/me", meHandler(service))

	admin := app.Group("/admin/risk", requireAuth, middleware.AdminOnly())
	admin.Get("/users", adminUsersHandler(service))
	admin.Get("/users/:userId", adminUserDetailHandler(service))
	admin.Post("/users/:userId/action", adminActionHandler(service))
	admin.Get("/stats", adminStatsHandler(service))
}

func recordEventHandler(service *Service) fiber.Handler {
	return func(c *fiber.Ctx) error {
		userID, ok := middleware.AuthenticatedUserID(c)
		if !ok {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "authentication required"})
		}
		var event Event
		if err := c.BodyParser(&event); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid request body"})
		}
		event.UserID = userID
		if event.IPAddress == "" {
			event.IPAddress = c.IP()
		}
		decision, err := service.RecordEvent(c.Context(), event)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
		}
		return c.JSON(decision)
	}
}

func meHandler(service *Service) fiber.Handler {
	return func(c *fiber.Ctx) error {
		userID, ok := middleware.AuthenticatedUserID(c)
		if !ok {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "authentication required"})
		}
		score, err := service.GetScore(c.Context(), userID)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
		}
		action := ActionAllow
		if score.RiskLevel == LevelBlocked {
			action = ActionBlock
		}
		return c.JSON(Decision{Action: action, Score: score})
	}
}

func adminUsersHandler(service *Service) fiber.Handler {
	return func(c *fiber.Ctx) error {
		limit, _ := strconv.Atoi(c.Query("limit", "100"))
		users, err := service.ListUsers(c.Context(), limit)
		if err != nil {
			return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{"error": err.Error()})
		}
		return c.JSON(fiber.Map{"users": users})
	}
}

func adminUserDetailHandler(service *Service) fiber.Handler {
	return func(c *fiber.Ctx) error {
		detail, err := service.UserDetail(c.Context(), c.Params("userId"))
		if err != nil {
			return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{"error": err.Error()})
		}
		return c.JSON(detail)
	}
}

func adminActionHandler(service *Service) fiber.Handler {
	return func(c *fiber.Ctx) error {
		adminID, ok := middleware.AuthenticatedUserID(c)
		if !ok {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "authentication required"})
		}
		var body struct {
			Action   Action         `json:"action"`
			Reason   string         `json:"reason"`
			Metadata map[string]any `json:"metadata"`
		}
		if err := c.BodyParser(&body); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid request body"})
		}
		action, err := service.AdminAction(c.Context(), RecordedAction{
			UserID:   c.Params("userId"),
			AdminID:  adminID,
			Action:   body.Action,
			Reason:   body.Reason,
			Metadata: body.Metadata,
		})
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
		}
		return c.JSON(fiber.Map{"success": true, "action": action})
	}
}

func adminStatsHandler(service *Service) fiber.Handler {
	return func(c *fiber.Ctx) error {
		stats, err := service.Stats(c.Context())
		if err != nil {
			return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{"error": err.Error()})
		}
		return c.JSON(stats)
	}
}
