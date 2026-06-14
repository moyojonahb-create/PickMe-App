package redis

import (
	"context"
	"time"

	"github.com/gofiber/fiber/v2"
)

func HealthHandler(client *Client) fiber.Handler {
	return func(c *fiber.Ctx) error {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()

		if client == nil {
			return c.JSON(Health{Enabled: false})
		}
		health := client.Health(ctx)
		status := fiber.StatusOK
		if health.Enabled && !health.Connected {
			status = fiber.StatusServiceUnavailable
		}
		return c.Status(status).JSON(health)
	}
}
