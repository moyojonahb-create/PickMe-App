package reputation

import (
	"context"
	"encoding/json"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

type DB interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

type PostgresRepository struct {
	db DB
}

func NewPostgresRepository(db DB) *PostgresRepository {
	return &PostgresRepository{db: db}
}

func (r *PostgresRepository) Get(ctx context.Context, driverID string) (DriverReputation, error) {
	var rep DriverReputation
	err := r.db.QueryRow(ctx, `
		SELECT
			driver_id::text,
			rating_avg,
			rating_count,
			acceptance_rate,
			completion_rate,
			cancellation_rate,
			cancel_after_accept_rate,
			reliability_score,
			freshness_score,
			dispatch_score,
			completed_rides,
			accepted_rides,
			offered_rides,
			rejected_offers,
			timed_out_offers,
			cancelled_rides,
			last_completed_ride_at,
			last_offer_at,
			updated_at
		FROM public.driver_reputation
		WHERE driver_id = $1
	`, driverID).Scan(
		&rep.DriverID,
		&rep.RatingAvg,
		&rep.RatingCount,
		&rep.AcceptanceRate,
		&rep.CompletionRate,
		&rep.CancellationRate,
		&rep.CancelAfterAcceptRate,
		&rep.ReliabilityScore,
		&rep.FreshnessScore,
		&rep.DispatchScore,
		&rep.CompletedRides,
		&rep.AcceptedRides,
		&rep.OfferedRides,
		&rep.RejectedOffers,
		&rep.TimedOutOffers,
		&rep.CancelledRides,
		&rep.LastCompletedRideAt,
		&rep.LastOfferAt,
		&rep.UpdatedAt,
	)
	return rep, err
}

func (r *PostgresRepository) Save(ctx context.Context, before DriverReputation, after DriverReputation, event Event) error {
	_, err := r.db.Exec(ctx, `
		INSERT INTO public.driver_reputation (
			driver_id,
			rating_avg,
			rating_count,
			acceptance_rate,
			completion_rate,
			cancellation_rate,
			cancel_after_accept_rate,
			reliability_score,
			freshness_score,
			dispatch_score,
			completed_rides,
			accepted_rides,
			offered_rides,
			rejected_offers,
			timed_out_offers,
			cancelled_rides,
			last_completed_ride_at,
			last_offer_at,
			updated_at
		)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
		ON CONFLICT (driver_id)
		DO UPDATE SET
			rating_avg = EXCLUDED.rating_avg,
			rating_count = EXCLUDED.rating_count,
			acceptance_rate = EXCLUDED.acceptance_rate,
			completion_rate = EXCLUDED.completion_rate,
			cancellation_rate = EXCLUDED.cancellation_rate,
			cancel_after_accept_rate = EXCLUDED.cancel_after_accept_rate,
			reliability_score = EXCLUDED.reliability_score,
			freshness_score = EXCLUDED.freshness_score,
			dispatch_score = EXCLUDED.dispatch_score,
			completed_rides = EXCLUDED.completed_rides,
			accepted_rides = EXCLUDED.accepted_rides,
			offered_rides = EXCLUDED.offered_rides,
			rejected_offers = EXCLUDED.rejected_offers,
			timed_out_offers = EXCLUDED.timed_out_offers,
			cancelled_rides = EXCLUDED.cancelled_rides,
			last_completed_ride_at = EXCLUDED.last_completed_ride_at,
			last_offer_at = EXCLUDED.last_offer_at,
			updated_at = EXCLUDED.updated_at
	`, after.DriverID, after.RatingAvg, after.RatingCount, after.AcceptanceRate, after.CompletionRate, after.CancellationRate, after.CancelAfterAcceptRate, after.ReliabilityScore, after.FreshnessScore, after.DispatchScore, after.CompletedRides, after.AcceptedRides, after.OfferedRides, after.RejectedOffers, after.TimedOutOffers, after.CancelledRides, after.LastCompletedRideAt, after.LastOfferAt, after.UpdatedAt)
	if err != nil {
		return err
	}

	if event.Metadata == nil {
		event.Metadata = map[string]any{}
	}
	metadata, err := json.Marshal(event.Metadata)
	if err != nil {
		metadata = []byte(`{}`)
	}
	_, err = r.db.Exec(ctx, `
		INSERT INTO public.driver_reputation_events (
			driver_id,
			event_type,
			ride_id,
			offer_id,
			score_before,
			score_after,
			metadata,
			created_at
		)
		VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)
	`, after.DriverID, event.Type, nullString(event.RideID), nullString(event.OfferID), before.DispatchScore, after.DispatchScore, string(metadata), after.UpdatedAt)
	if err != nil {
		return err
	}

	_, err = r.db.Exec(ctx, `
		INSERT INTO public.driver_reputation_snapshots (
			driver_id,
			rating_avg,
			acceptance_rate,
			completion_rate,
			cancellation_rate,
			reliability_score,
			dispatch_score,
			snapshot_date,
			created_at
		)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8::date,NOW())
	`, after.DriverID, after.RatingAvg, after.AcceptanceRate, after.CompletionRate, after.CancellationRate, after.ReliabilityScore, after.DispatchScore, after.UpdatedAt.Format("2006-01-02"))
	return err
}

func nullString(value string) any {
	if value == "" {
		return nil
	}
	return value
}
