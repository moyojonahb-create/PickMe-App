package middleware

import (
	"context"
	"log"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5"

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

type AdminRoleLookup interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// AdminOnly is the centralized admin authorization middleware used across admin routes.
// On denial it emits a structured SECURITY_ADMIN_AUTHZ_FAILURE log and returns 403 with
// a generic {"error":"admin_not_authorized"} payload.
func AdminOnly() fiber.Handler {
	return AdminOnlyWithDB(nil)
}

func AdminOnlyWithDB(lookup AdminRoleLookup) fiber.Handler {
	return func(c *fiber.Ctx) error {
		if err := RequireAdmin(c, lookup); err != nil {
			userID, _ := AuthenticatedUserID(c)
			LogAdminSecurityFailure(userID, c.Path(), "not_admin")
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "admin_not_authorized"})
		}
		return c.Next()
	}
}

func RequireAdmin(c *fiber.Ctx, lookup AdminRoleLookup) error {
	userID, ok := AuthenticatedUserID(c)
	if !ok {
		return fiber.NewError(fiber.StatusUnauthorized, "authentication required")
	}
	role, _ := c.Locals(LocalsAuthRole).(string)
	if role == "admin" || role == "service_role" {
		return nil
	}
	if lookup == nil {
		return fiber.NewError(fiber.StatusForbidden, "admin role required")
	}

	var exists bool
	if err := lookup.QueryRow(c.Context(), `
		SELECT EXISTS (
			SELECT 1 FROM public.user_roles
			WHERE user_id = $1 AND role = 'admin'
		)`, userID).Scan(&exists); err != nil {
		return err
	}
	if !exists {
		return fiber.NewError(fiber.StatusForbidden, "admin role required")
	}
	return nil
}

// LogAdminSecurityFailure emits a standardized SECURITY_ADMIN_AUTHZ_FAILURE event to logs.
func LogAdminSecurityFailure(userID string, endpoint string, reason string) {
	// SECURITY_ADMIN_AUTHZ_FAILURE structured log
	// Fields: user_id, endpoint, reason, timestamp
	log.Printf("SECURITY_ADMIN_AUTHZ_FAILURE user_id=%s endpoint=%s reason=%s timestamp=%s\n",
		userID, endpoint, reason, time.Now().UTC().Format(time.RFC3339))
}
