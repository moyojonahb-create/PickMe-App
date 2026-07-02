package notification

import (
	"github.com/gofiber/fiber/v2"

	"pickme-backend/internal/middleware"
)

func RegisterRoutes(app fiber.Router, service *Service, requireAuth fiber.Handler) {
	api := app.Group("/api/notifications", requireAuth)
	api.Post("/device", registerDeviceHandler(service))
	api.Post("/preferences", preferencesHandler(service))

	admin := app.Group("/admin/notifications", requireAuth, middleware.AdminOnly())
	admin.Get("/stats", statsHandler(service))
}

func registerDeviceHandler(service *Service) fiber.Handler {
	return func(c *fiber.Ctx) error {
		userID, ok := middleware.AuthenticatedUserID(c)
		if !ok {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "authentication required"})
		}
		var body struct {
			Platform    Platform `json:"platform"`
			DeviceToken string   `json:"device_token"`
			AppVersion  string   `json:"app_version"`
		}
		if err := c.BodyParser(&body); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid request body"})
		}
		device, err := service.RegisterDevice(c.Context(), Device{
			UserID:      userID,
			Platform:    body.Platform,
			DeviceToken: body.DeviceToken,
			AppVersion:  body.AppVersion,
		})
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
		}
		return c.JSON(fiber.Map{"success": true, "device": device})
	}
}

func preferencesHandler(service *Service) fiber.Handler {
	return func(c *fiber.Ctx) error {
		userID, ok := middleware.AuthenticatedUserID(c)
		if !ok {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "authentication required"})
		}
		var body struct {
			Push          *bool `json:"push"`
			SMS           *bool `json:"sms"`
			Email         *bool `json:"email"`
			Marketing     *bool `json:"marketing"`
			Transactional *bool `json:"transactional"`
		}
		if err := c.BodyParser(&body); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid request body"})
		}
		pref, err := service.repo.GetPreferences(c.Context(), userID)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
		}
		if body.Push != nil {
			pref.Push = *body.Push
		}
		if body.SMS != nil {
			pref.SMS = *body.SMS
		}
		if body.Email != nil {
			pref.Email = *body.Email
		}
		if body.Marketing != nil {
			pref.Marketing = *body.Marketing
		}
		if body.Transactional != nil {
			pref.Transactional = *body.Transactional
		}
		pref.UserID = userID
		updated, err := service.SavePreferences(c.Context(), pref)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
		}
		return c.JSON(fiber.Map{"success": true, "preferences": updated})
	}
}

func statsHandler(service *Service) fiber.Handler {
	return func(c *fiber.Ctx) error {
		stats, err := service.Stats(c.Context())
		if err != nil {
			return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{"error": err.Error()})
		}
		return c.JSON(stats)
	}
}
