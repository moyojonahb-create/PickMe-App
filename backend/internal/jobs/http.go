package jobs

import (
	"github.com/gofiber/fiber/v2"

	"pickme-backend/internal/middleware"
)

func RegisterAdminRoutes(app *fiber.App, runtime *Runtime, requireAuth fiber.Handler) {
	app.Get("/admin/jobs/stats", requireAuth, middleware.AdminOnly(), statsHandler(runtime))
}

func statsHandler(runtime *Runtime) fiber.Handler {
	return func(c *fiber.Ctx) error {
		if runtime == nil {
			return c.JSON(Stats{Enabled: false, Queues: []QueueStats{}})
		}
		stats, err := runtime.Stats(c.Context())
		if err != nil {
			return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{"error": err.Error()})
		}
		return c.JSON(stats)
	}
}
