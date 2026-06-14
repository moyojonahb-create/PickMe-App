package authz

import (
	"context"
	"database/sql"
	"errors"
	"log"
	"time"

	"github.com/google/uuid"

	"pickme-backend/internal/drivers"
)

// DriverAuthorizationService enforces driver eligibility rules.
// Architecture: use Go for all authorization decisions.
// This service delegates schema mapping to internal/drivers repository.
type DriverAuthorizationService struct {
	db *sql.DB
}

// NewDriverAuthorizationService creates a new service without a DB (keeps tests/legacy callers working).
func NewDriverAuthorizationService() *DriverAuthorizationService {
	return &DriverAuthorizationService{db: nil}
}

// NewDriverAuthorizationServiceWithDB creates a service backed by a sql.DB connection.
func NewDriverAuthorizationServiceWithDB(db *sql.DB) *DriverAuthorizationService {
	return &DriverAuthorizationService{db: db}
}

var ErrDriverNotAuthorized = errors.New("driver_not_authorized")

// eligibilityCheck is the single underlying eligibility evaluator used by all public methods.
func (s *DriverAuthorizationService) eligibilityCheck(ctx context.Context, userID uuid.UUID, endpoint string) error {
	status, err := drivers.GetDriverAuthorizationStatus(ctx, userID)
	if err != nil {
		// On DB error, emit security log and deny.
		logSecurityFailure(userID.String(), endpoint, "db_error")
		return ErrDriverNotAuthorized
	}

	// Required: Exists == true, Approved == true, Active == true, Suspended == false, Deleted == false
	if !status.Exists || !status.Approved || !status.Active || status.Suspended || status.Deleted {
		logSecurityFailure(userID.String(), endpoint, "not_eligible")
		return ErrDriverNotAuthorized
	}
	return nil
}

// CanActAsDriver checks whether the user is authorized to act as a driver.
func (s *DriverAuthorizationService) CanActAsDriver(ctx context.Context, userID uuid.UUID) error {
	return s.eligibilityCheck(ctx, userID, "CanActAsDriver")
}

// CanReceiveOffers determines if the user may receive ride offers.
func (s *DriverAuthorizationService) CanReceiveOffers(ctx context.Context, userID uuid.UUID) error {
	return s.eligibilityCheck(ctx, userID, "CanReceiveOffers")
}

// CanUpdateLocation determines if the user may publish driver location updates.
func (s *DriverAuthorizationService) CanUpdateLocation(ctx context.Context, userID uuid.UUID) error {
	return s.eligibilityCheck(ctx, userID, "CanUpdateLocation")
}

// CanAcceptRide determines if the user may accept rides.
func (s *DriverAuthorizationService) CanAcceptRide(ctx context.Context, userID uuid.UUID) error {
	return s.eligibilityCheck(ctx, userID, "CanAcceptRide")
}

// logSecurityFailure emits structured security logging for authz failures.
func logSecurityFailure(userID string, endpoint string, reason string) {
	// SECURITY_DRIVER_AUTHZ_FAILURE structured log
	// Fields: user_id, endpoint, reason, timestamp
	log.Printf("SECURITY_DRIVER_AUTHZ_FAILURE user_id=%s endpoint=%s reason=%s timestamp=%s\n",
		userID, endpoint, reason, time.Now().UTC().Format(time.RFC3339))
}

// LogSecurityFailure is the exported wrapper used by other packages to emit
// the standardized SECURITY_DRIVER_AUTHZ_FAILURE event without accessing
// internal/unexported helpers.
func LogSecurityFailure(userID string, endpoint string, reason string) {
	logSecurityFailure(userID, endpoint, reason)
}
