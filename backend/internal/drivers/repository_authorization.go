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

	// Attempt to query a canonical drivers table. If the table or columns don't exist,
	// treat as non-existent driver record and return Exists=false.
	var approved, active, suspended bool
	var deleted bool

	row := repoPool.QueryRow(ctx, `
SELECT
  COALESCE(approved, false)  AS approved,
  COALESCE(active, true)     AS active,
  COALESCE(suspended, false) AS suspended,
  (deleted_at IS NOT NULL)   AS deleted
FROM public.drivers
WHERE id = $1
LIMIT 1
`, userID.String())

	if err := row.Scan(&approved, &active, &suspended, &deleted); err != nil {
		// If row not found or any error, log at debug and return Exists=false without exposing error.
		// Only return real error on unexpected DB failures.
		log.Println("GetDriverAuthorizationStatus: drivers table missing or row not found:", err)
		return status, nil
	}

	status.Exists = true
	status.Approved = approved
	status.Active = active
	status.Suspended = suspended
	status.Deleted = deleted

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
