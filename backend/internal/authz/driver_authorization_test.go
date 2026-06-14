package authz

import (
	"context"
	"testing"

	"github.com/google/uuid"

	"pickme-backend/internal/drivers"
)

func TestCanActAsDriver_Types(t *testing.T) {
	ctx := context.Background()
	svc := NewDriverAuthorizationService()
	uid := uuid.New()

	original := drivers.GetDriverAuthorizationStatus
	defer drivers.SetGetDriverAuthStatus(original)

	// Approved driver success
	drivers.SetGetDriverAuthStatus(func(ctx context.Context, userID uuid.UUID) (drivers.DriverAuthorizationStatus, error) {
		return drivers.DriverAuthorizationStatus{
			Exists:    true,
			Approved:  true,
			Active:    true,
			Suspended: false,
			Deleted:   false,
		}, nil
	})
	if err := svc.CanActAsDriver(ctx, uid); err != nil {
		t.Fatalf("expected approved driver to be authorized, got err: %v", err)
	}

	// Suspended driver fails
	drivers.SetGetDriverAuthStatus(func(ctx context.Context, userID uuid.UUID) (drivers.DriverAuthorizationStatus, error) {
		return drivers.DriverAuthorizationStatus{
			Exists:    true,
			Approved:  true,
			Active:    true,
			Suspended: true,
			Deleted:   false,
		}, nil
	})
	if err := svc.CanActAsDriver(ctx, uid); err == nil {
		t.Fatalf("expected suspended driver to be rejected")
	}

	// Deleted driver fails
	drivers.SetGetDriverAuthStatus(func(ctx context.Context, userID uuid.UUID) (drivers.DriverAuthorizationStatus, error) {
		return drivers.DriverAuthorizationStatus{
			Exists:    true,
			Approved:  true,
			Active:    true,
			Suspended: false,
			Deleted:   true,
		}, nil
	})
	if err := svc.CanActAsDriver(ctx, uid); err == nil {
		t.Fatalf("expected deleted driver to be rejected")
	}

	// Inactive driver fails
	drivers.SetGetDriverAuthStatus(func(ctx context.Context, userID uuid.UUID) (drivers.DriverAuthorizationStatus, error) {
		return drivers.DriverAuthorizationStatus{
			Exists:    true,
			Approved:  true,
			Active:    false,
			Suspended: false,
			Deleted:   false,
		}, nil
	})
	if err := svc.CanActAsDriver(ctx, uid); err == nil {
		t.Fatalf("expected inactive driver to be rejected")
	}

	// Non-existent user fails
	drivers.SetGetDriverAuthStatus(func(ctx context.Context, userID uuid.UUID) (drivers.DriverAuthorizationStatus, error) {
		return drivers.DriverAuthorizationStatus{
			Exists: false,
		}, nil
	})
	if err := svc.CanActAsDriver(ctx, uid); err == nil {
		t.Fatalf("expected non-existent driver to be rejected")
	}
}
