package dispatch

import (
	"context"

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

func (r *PostgresRepository) CreateShadowRun(ctx context.Context, run ShadowRun) error {
	_, err := r.db.Exec(ctx, `
		INSERT INTO public.dispatch_shadow_runs (
			id,
			ride_id,
			rider_id,
			pickup_lat,
			pickup_lng,
			pickup_location,
			dropoff_location,
			vehicle_type,
			city,
			mode,
			status,
			candidate_count,
			selected_count,
			redis_available,
			redis_latency_ms,
			candidate_discovery_latency_ms,
			ranking_latency_ms,
			dispatch_latency_ms,
			shadow_write_latency_ms,
			selected_driver_id,
			selected_rank,
			ranking_version,
			error,
			started_at,
			completed_at,
			created_at
		)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,NOW())
	`, run.ID, run.RideID, nullable(run.RiderID), zeroNil(run.PickupLatitude), zeroNil(run.PickupLongitude), run.PickupLocation, run.DropoffLocation, run.VehicleType, run.City, run.Mode, run.Status, run.CandidateCount, run.SelectedCount, run.RedisAvailable, run.RedisLatencyMS, run.CandidateDiscoveryLatencyMS, run.RankingLatencyMS, run.DispatchLatencyMS, zeroNil(run.ShadowWriteLatencyMS), nullable(run.SelectedDriverID), zeroIntNil(run.SelectedRank), run.RankingVersion, nullable(run.Error), run.StartedAt, run.CompletedAt)
	return err
}

func (r *PostgresRepository) InsertShadowCandidates(ctx context.Context, runID string, rideID string, candidates []RankedCandidate) error {
	for _, candidate := range candidates {
		_, err := r.db.Exec(ctx, `
			INSERT INTO public.dispatch_shadow_candidates (
				id,
				shadow_run_id,
				ride_id,
				driver_id,
				rank,
				selected,
				distance_km,
				score,
				proximity_score,
				freshness_score,
				availability_score,
				location_updated_at,
				vehicle_type,
				city,
				created_at
			)
			VALUES (gen_random_uuid(),$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW())
		`, runID, rideID, candidate.DriverID, candidate.Rank, candidate.Selected, candidate.DistanceKM, candidate.Score, candidate.ProximityScore, candidate.FreshnessScore, candidate.AvailabilityScore, candidate.LocationAt, candidate.VehicleType, candidate.City)
		if err != nil {
			return err
		}
	}
	return nil
}

func (r *PostgresRepository) UpdateShadowWriteLatency(ctx context.Context, runID string, latencyMS float64) error {
	_, err := r.db.Exec(ctx, `
		UPDATE public.dispatch_shadow_runs
		SET shadow_write_latency_ms = $2
		WHERE id = $1
	`, runID, latencyMS)
	return err
}

func (r *PostgresRepository) RecordFirstOfferOutcome(ctx context.Context, outcome OfferOutcome) error {
	_, err := r.db.Exec(ctx, `
		INSERT INTO public.dispatch_shadow_outcomes (
			id,
			ride_id,
			shadow_run_id,
			first_offer_driver_id,
			first_offer_was_candidate,
			first_offer_was_selected,
			first_offer_shadow_rank,
			seconds_to_first_offer,
			created_at,
			updated_at
		)
		SELECT
			gen_random_uuid(),
			$1,
			r.id,
			$2,
			c.driver_id IS NOT NULL,
			COALESCE(c.selected, false),
			c.rank,
			CASE WHEN r.started_at IS NULL THEN NULL ELSE EXTRACT(EPOCH FROM ($3::timestamptz - r.started_at))::integer END,
			NOW(),
			NOW()
		FROM public.dispatch_shadow_runs r
		LEFT JOIN public.dispatch_shadow_candidates c
		  ON c.shadow_run_id = r.id
		 AND c.driver_id = $2
		WHERE r.ride_id = $1
		ORDER BY r.created_at DESC
		LIMIT 1
		ON CONFLICT (ride_id)
		DO UPDATE SET
			first_offer_driver_id = COALESCE(public.dispatch_shadow_outcomes.first_offer_driver_id, EXCLUDED.first_offer_driver_id),
			first_offer_was_candidate = COALESCE(public.dispatch_shadow_outcomes.first_offer_was_candidate, EXCLUDED.first_offer_was_candidate),
			first_offer_was_selected = COALESCE(public.dispatch_shadow_outcomes.first_offer_was_selected, EXCLUDED.first_offer_was_selected),
			first_offer_shadow_rank = COALESCE(public.dispatch_shadow_outcomes.first_offer_shadow_rank, EXCLUDED.first_offer_shadow_rank),
			seconds_to_first_offer = COALESCE(public.dispatch_shadow_outcomes.seconds_to_first_offer, EXCLUDED.seconds_to_first_offer),
			updated_at = NOW()
	`, outcome.RideID, outcome.DriverID, outcome.At)
	return err
}

func (r *PostgresRepository) RecordAcceptedOfferOutcome(ctx context.Context, outcome OfferOutcome) error {
	_, err := r.db.Exec(ctx, `
		INSERT INTO public.dispatch_shadow_outcomes (
			id,
			ride_id,
			shadow_run_id,
			actual_driver_id,
			actual_offer_id,
			actual_driver_was_candidate,
			actual_driver_was_selected,
			actual_driver_shadow_rank,
			actual_driver_shadow_score,
			seconds_to_acceptance,
			created_at,
			updated_at
		)
		SELECT
			gen_random_uuid(),
			$1,
			r.id,
			$2,
			$3,
			c.driver_id IS NOT NULL,
			COALESCE(c.selected, false),
			c.rank,
			c.score,
			CASE WHEN r.started_at IS NULL THEN NULL ELSE EXTRACT(EPOCH FROM ($4::timestamptz - r.started_at))::integer END,
			NOW(),
			NOW()
		FROM public.dispatch_shadow_runs r
		LEFT JOIN public.dispatch_shadow_candidates c
		  ON c.shadow_run_id = r.id
		 AND c.driver_id = $2
		WHERE r.ride_id = $1
		ORDER BY r.created_at DESC
		LIMIT 1
		ON CONFLICT (ride_id)
		DO UPDATE SET
			actual_driver_id = EXCLUDED.actual_driver_id,
			actual_offer_id = EXCLUDED.actual_offer_id,
			actual_driver_was_candidate = EXCLUDED.actual_driver_was_candidate,
			actual_driver_was_selected = EXCLUDED.actual_driver_was_selected,
			actual_driver_shadow_rank = EXCLUDED.actual_driver_shadow_rank,
			actual_driver_shadow_score = EXCLUDED.actual_driver_shadow_score,
			seconds_to_acceptance = EXCLUDED.seconds_to_acceptance,
			updated_at = NOW()
	`, outcome.RideID, outcome.DriverID, outcome.OfferID, outcome.At)
	return err
}

func nullable(value string) any {
	if value == "" {
		return nil
	}
	return value
}

func zeroNil(value float64) any {
	if value == 0 {
		return nil
	}
	return value
}

func zeroIntNil(value int) any {
	if value == 0 {
		return nil
	}
	return value
}
