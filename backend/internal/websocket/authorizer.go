package websocket

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"
)

type PostgresRoomAuthorizer struct {
	db *pgxpool.Pool
}

func NewPostgresRoomAuthorizer(db *pgxpool.Pool) *PostgresRoomAuthorizer {
	return &PostgresRoomAuthorizer{db: db}
}

func (a *PostgresRoomAuthorizer) CanJoinRideRoom(ctx context.Context, rideID string, userID string) (bool, error) {
	var allowed bool
	err := a.db.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1
			FROM public.rides
			WHERE id = $1
			  AND (
				rider_id = $2
				OR driver_id = $2
			  )
		)
	`, rideID, userID).Scan(&allowed)
	if err != nil {
		return false, err
	}

	return allowed, nil
}
