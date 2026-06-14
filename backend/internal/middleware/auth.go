package middleware

import (
	"log"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"

	"pickme-backend/internal/auth"
)

const (
	LocalsAuthSubject = "auth_subject"
	LocalsAuthRole    = "auth_role"
	LocalsAuthClaims  = "auth_claims"
)

// AuthenticatedUserID returns the authenticated subject stored in locals.
func AuthenticatedUserID(c *fiber.Ctx) (string, bool) {
	userID, ok := c.Locals(LocalsAuthSubject).(string)
	return userID, ok && userID != ""
}

func SupabaseJWT(verifier *auth.SupabaseJWT) fiber.Handler {
	return func(c *fiber.Ctx) error {
		authHeader := c.Get("Authorization")
		if authHeader == "" {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Authorization header is required"})
		}

		token, ok := strings.CutPrefix(authHeader, "Bearer ")
		if !ok || token == "" {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Bearer token is required"})
		}

		claims, err := verifier.Validate(token)
		if err != nil {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Invalid or expired token"})
		}

		c.Locals(LocalsAuthSubject, claims.Subject)
		c.Locals(LocalsAuthRole, claims.Role)
		c.Locals(LocalsAuthClaims, claims)

		return c.Next()
	}
}

// AdminOnly is the centralized admin authorization middleware used across admin routes.
// On denial it emits a structured SECURITY_ADMIN_AUTHZ_FAILURE log and returns 403 with
// a generic {"error":"admin_not_authorized"} payload.
func AdminOnly() fiber.Handler {
	return func(c *fiber.Ctx) error {
		role, _ := c.Locals(LocalsAuthRole).(string)
		userID, _ := AuthenticatedUserID(c)
		if role != "admin" && role != "service_role" {
			// Structured log for admin authorization failures. Never expose internal reason to client.
			LogAdminSecurityFailure(userID, c.Path(), "not_admin")
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "admin_not_authorized"})
		}
		return c.Next()
	}
}

// LogAdminSecurityFailure emits a standardized SECURITY_ADMIN_AUTHZ_FAILURE event to logs.
func LogAdminSecurityFailure(userID string, endpoint string, reason string) {
	// SECURITY_ADMIN_AUTHZ_FAILURE structured log
	// Fields: user_id, endpoint, reason, timestamp
	log.Printf("SECURITY_ADMIN_AUTHZ_FAILURE user_id=%s endpoint=%s reason=%s timestamp=%s\n",
		userID, endpoint, reason, time.Now().UTC().Format(time.RFC3339))
}
