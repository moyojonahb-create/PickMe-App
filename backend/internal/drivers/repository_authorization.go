package drivers

import (
	"context"
	"log"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// DriverAuthorizationStatus represents canonical driver state mapped from existing schema.
type DriverAuthorizationStatus struct {
	Exists    bool
	Approved  bool
	Active    bool
	Suspended bool
	Deleted   bool
}

var repoPool *pgxpool.Pool

// SetRepositoryPool must be called at startup to provide a DB pool for authorization checks.
func SetRepositoryPool(p *pgxpool.Pool) {
	repoPool = p
}

// GetDriverAuthStatusFunc is the function signature used to obtain driver authorization status.
// Tests may override this via SetGetDriverAuthStatus.
type GetDriverAuthStatusFunc func(ctx context.Context, userID uuid.UUID) (DriverAuthorizationStatus, error)

var defaultGetDriverAuthStatus GetDriverAuthStatusFunc = func(ctx context.Context, userID uuid.UUID) (DriverAuthorizationStatus, error) {
	status := DriverAuthorizationStatus{}

	if repoPool == nil {
		// No DB configured for repo checks: deny by default (Exists=false)
		return status, nil
	}

	// public.drivers has no approved/active/suspended/deleted_at columns and
	// is keyed by user_id (its own `id` is an unrelated internal PK) — the
	// previous query here selected columns that don't exist and joined on
	// the wrong key, so it always failed to scan and fell through to
	// Exists=false, denying every real driver unconditionally. Eligibility
	// is actually carried entirely by the `status` text column (see the
	// 'pending' | 'approved' | 'suspended' | 'banned' check constraint).
	var driverStatus string

	row := repoPool.QueryRow(ctx, `
SELECT status
FROM public.drivers
WHERE user_id = $1
LIMIT 1
`, userID.String())

	if err := row.Scan(&driverStatus); err != nil {
		// If row not found or any error, log at debug and return Exists=false without exposing error.
		// Only return real error on unexpected DB failures.
		log.Println("GetDriverAuthorizationStatus: drivers table missing or row not found:", err)
		return status, nil
	}

	status.Exists = true
	status.Approved = driverStatus == "approved"
	status.Active = driverStatus != "banned"
	status.Suspended = driverStatus == "suspended"
	status.Deleted = false

	return status, nil
}

// getDriverAuthStatus is the active function used by GetDriverAuthorizationStatus.
// It defaults to defaultGetDriverAuthStatus but can be swapped in tests.
var getDriverAuthStatus GetDriverAuthStatusFunc = defaultGetDriverAuthStatus

// SetGetDriverAuthStatus replaces the function used to obtain driver authorization status.
// Passing nil will restore the default implementation.
func SetGetDriverAuthStatus(f GetDriverAuthStatusFunc) {
	if f == nil {
		getDriverAuthStatus = defaultGetDriverAuthStatus
		return
	}
	getDriverAuthStatus = f
}

// GetDriverAuthorizationStatus returns authorization status for the given user id.
// This delegates to the currently configured getDriverAuthStatus function.
func GetDriverAuthorizationStatus(ctx context.Context, userID uuid.UUID) (DriverAuthorizationStatus, error) {
	return getDriverAuthStatus(ctx, userID)
}
