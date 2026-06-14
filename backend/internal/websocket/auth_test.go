package websocket

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"

	"pickme-backend/internal/auth"
	"pickme-backend/internal/config"
)

type fakeRoomAuthorizer struct {
	allowed bool
	rideID  string
	userID  string
	err     error
}

func (f *fakeRoomAuthorizer) CanJoinRideRoom(ctx context.Context, rideID string, userID string) (bool, error) {
	f.rideID = rideID
	f.userID = userID
	return f.allowed, f.err
}

// fakeDriverAuthorizer implements the minimal DriverAuthorizer used by websocket.AuthenticateRequest in tests.
type fakeDriverAuthorizer struct {
	allowed bool
}

func (f *fakeDriverAuthorizer) CanActAsDriver(ctx context.Context, userID uuid.UUID) error {
	if f.allowed {
		return nil
	}
	return errors.New("not_authorized")
}

func TestAuthenticateRequestRequiresToken(t *testing.T) {
	status := websocketAuthStatus(t, "/ws", true)
	if status != fiber.StatusUnauthorized {
		t.Fatalf("expected status %d, got %d", fiber.StatusUnauthorized, status)
	}
}

func TestAuthenticateRequestRejectsMismatchedRiderID(t *testing.T) {
	token := testJWT(t, "user-1")
	status := websocketAuthStatus(t, "/ws?access_token="+token+"&rider_id=user-2", true)
	if status != fiber.StatusForbidden {
		t.Fatalf("expected status %d, got %d", fiber.StatusForbidden, status)
	}
}

func TestAuthenticateRequestAuthorizesRideRoomMembership(t *testing.T) {
	token := testJWT(t, "user-1")
	authorizer := &fakeRoomAuthorizer{allowed: true}
	status := websocketAuthStatusWithAuthorizer(t, "/ws?access_token="+token+"&role=rider&room=ride_ride-1", authorizer)

	if status != fiber.StatusOK {
		t.Fatalf("expected status %d, got %d", fiber.StatusOK, status)
	}
	if authorizer.rideID != "ride-1" {
		t.Fatalf("expected ride id ride-1, got %s", authorizer.rideID)
	}
	if authorizer.userID != "user-1" {
		t.Fatalf("expected user id user-1, got %s", authorizer.userID)
	}
}

func TestAuthenticateRequestRejectsUnauthorizedRideRoom(t *testing.T) {
	token := testJWT(t, "user-1")
	status := websocketAuthStatus(t, "/ws?access_token="+token+"&role=driver&room=ride_ride-1", false)
	if status != fiber.StatusForbidden {
		t.Fatalf("expected status %d, got %d", fiber.StatusForbidden, status)
	}
}

func websocketAuthStatus(t *testing.T, target string, roomAllowed bool) int {
	t.Helper()
	return websocketAuthStatusWithAuthorizer(t, target, &fakeRoomAuthorizer{allowed: roomAllowed})
}

func websocketAuthStatusWithAuthorizer(t *testing.T, target string, authorizer *fakeRoomAuthorizer) int {
	t.Helper()

	verifier, err := auth.NewSupabaseJWT(config.AuthConfig{
		SupabaseJWTSecret: "test-secret",
		Audience:          "authenticated",
		Issuer:            "test-issuer",
	})
	if err != nil {
		t.Fatal(err)
	}

	app := fiber.New()
	app.Get("/ws", func(c *fiber.Ctx) error {
		conn, status, err := AuthenticateRequest(c, verifier, authorizer, &fakeDriverAuthorizer{allowed: true})
		if err != nil {
			return c.SendStatus(status)
		}
		SetAuthenticatedLocals(c, conn)
		return c.SendStatus(fiber.StatusOK)
	})

	req := httptest.NewRequest(http.MethodGet, target, nil)
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()

	return resp.StatusCode
}

func testJWT(t *testing.T, subject string) string {
	t.Helper()

	header := map[string]string{
		"alg": "HS256",
		"typ": "JWT",
	}
	claims := map[string]any{
		"sub": subject,
		"aud": "authenticated",
		"iss": "test-issuer",
		"exp": time.Now().Add(time.Hour).Unix(),
	}

	encodedHeader := encodeJSON(t, header)
	encodedClaims := encodeJSON(t, claims)
	signingInput := encodedHeader + "." + encodedClaims

	mac := hmac.New(sha256.New, []byte("test-secret"))
	_, _ = mac.Write([]byte(signingInput))
	signature := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))

	return signingInput + "." + signature
}

func encodeJSON(t *testing.T, value any) string {
	t.Helper()

	raw, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return base64.RawURLEncoding.EncodeToString(raw)
}
