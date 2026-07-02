package dispatch

import (
	"context"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"pickme-backend/internal/observability"
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
	observability.RecordPostgresQuery("dispatch_create_shadow_run")
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
	if err != nil {
		observability.RecordPostgresFailure("dispatch_create_shadow_run")
		observability.CaptureError(err)
	}
	return err
}

func (r *PostgresRepository) InsertShadowCandidates(ctx context.Context, runID string, rideID string, candidates []RankedCandidate) error {
	if len(candidates) == 0 {
		return nil
	}
	observability.RecordPostgresQuery("dispatch_insert_shadow_candidate_batch")
	args := make([]any, 0, len(candidates)*13)
	values := make([]string, 0, len(candidates))
	for i, candidate := range candidates {
		base := i*13 + 1
		values = append(values, "("+placeholders(base, 13)+",NOW())")
		args = append(args,
			runID,
			rideID,
			candidate.DriverID,
			candidate.Rank,
			candidate.Selected,
			candidate.DistanceKM,
			candidate.Score,
			candidate.ProximityScore,
			candidate.FreshnessScore,
			candidate.AvailabilityScore,
			candidate.LocationAt,
			candidate.VehicleType,
			candidate.City,
		)
	}
	_, err := r.db.Exec(ctx, `
			INSERT INTO public.dispatch_shadow_candidates (
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
			VALUES `+strings.Join(values, ",")+`
	`, args...)
	if err != nil {
		observability.RecordPostgresFailure("dispatch_insert_shadow_candidate_batch")
		observability.CaptureError(err)
		return err
	}
	return nil
}

func (r *PostgresRepository) UpdateShadowWriteLatency(ctx context.Context, runID string, latencyMS float64) error {
	observability.RecordPostgresQuery("dispatch_update_shadow_latency")
	_, err := r.db.Exec(ctx, `
		UPDATE public.dispatch_shadow_runs
		SET shadow_write_latency_ms = $2
		WHERE id = $1
	`, runID, latencyMS)
	if err != nil {
		observability.RecordPostgresFailure("dispatch_update_shadow_latency")
		observability.CaptureError(err)
	}
	return err
}

func (r *PostgresRepository) RecordFirstOfferOutcome(ctx context.Context, outcome OfferOutcome) error {
	observability.RecordPostgresQuery("dispatch_record_first_offer")
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
	if err != nil {
		observability.RecordPostgresFailure("dispatch_record_first_offer")
		observability.CaptureError(err)
	}
	return err
}

func (r *PostgresRepository) RecordAcceptedOfferOutcome(ctx context.Context, outcome OfferOutcome) error {
	observability.RecordPostgresQuery("dispatch_record_accepted_offer")
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
	if err != nil {
		observability.RecordPostgresFailure("dispatch_record_accepted_offer")
		observability.CaptureError(err)
	}
	return err
}

func (r *PostgresRepository) CreateOfferWave(ctx context.Context, wave OfferWave) error {
	if len(wave.Offers) == 0 {
		return nil
	}
	observability.RecordPostgresQuery("dispatch_create_offer_wave_batch")
	args := make([]any, 0, len(wave.Offers)*6)
	values := make([]string, 0, len(wave.Offers))
	for i, offer := range wave.Offers {
		base := i*6 + 1
		values = append(values, "($"+strconv.Itoa(base)+",$"+strconv.Itoa(base+1)+",$"+strconv.Itoa(base+2)+",$"+strconv.Itoa(base+3)+",$"+strconv.Itoa(base+3)+",$"+strconv.Itoa(base+4)+",'pending',$"+strconv.Itoa(base+5)+",NOW())")
		args = append(args, offer.OfferID, wave.Ride.RideID, offer.DriverID, minorDecimal(offer.AmountMinor), offer.ETAMinutes, wave.ExpiresAt)
	}
	_, err := r.db.Exec(ctx, `
			INSERT INTO public.ride_offers (
				id,
				ride_id,
				driver_id,
				offered_fare,
				offer_price,
				eta_minutes,
				status,
				expires_at,
				created_at
			)
			VALUES `+strings.Join(values, ",")+`
			ON CONFLICT (driver_id, ride_id)
			DO UPDATE SET
				offered_fare = EXCLUDED.offered_fare,
				offer_price = EXCLUDED.offer_price,
				eta_minutes = EXCLUDED.eta_minutes,
				status = 'pending',
				expires_at = EXCLUDED.expires_at,
				created_at = NOW()
	`, args...)
	if err != nil {
		observability.RecordPostgresFailure("dispatch_create_offer_wave_batch")
		observability.CaptureError(err)
		return err
	}
	return nil
}

func (r *PostgresRepository) ExpireRideOffers(ctx context.Context, rideID string, now time.Time) (int64, error) {
	observability.RecordPostgresQuery("dispatch_expire_offers")
	tag, err := r.db.Exec(ctx, `
		UPDATE public.ride_offers
		SET status = 'expired',
		    expired_at = $2
		WHERE ride_id = $1
		  AND status = 'pending'
		  AND expires_at <= $2
	`, rideID, now)
	if err != nil {
		observability.RecordPostgresFailure("dispatch_expire_offers")
		observability.CaptureError(err)
		return 0, err
	}
	return tag.RowsAffected(), nil
}

func (r *PostgresRepository) SetDriverAvailability(ctx context.Context, driverID string, availability string, rideID string) error {
	observability.RecordPostgresQuery("dispatch_set_driver_availability")
	_, err := r.db.Exec(ctx, `
		INSERT INTO public.driver_sessions (
			driver_id,
			is_online,
			availability,
			current_ride_id,
			last_seen,
			updated_at
		)
		VALUES ($1,true,$2,$3,NOW(),NOW())
		ON CONFLICT (driver_id)
		DO UPDATE SET
			availability = EXCLUDED.availability,
			current_ride_id = EXCLUDED.current_ride_id,
			updated_at = NOW()
	`, driverID, availability, nullable(rideID))
	if err != nil {
		observability.RecordPostgresFailure("dispatch_set_driver_availability")
		observability.CaptureError(err)
	}
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

func minorDecimal(amountMinor int64) string {
	sign := ""
	if amountMinor < 0 {
		sign = "-"
		amountMinor = -amountMinor
	}
	return sign + strconv.FormatInt(amountMinor/100, 10) + "." + twoDigits(amountMinor%100)
}

func twoDigits(value int64) string {
	if value < 10 {
		return "0" + strconv.FormatInt(value, 10)
	}
	return strconv.FormatInt(value, 10)
}

func placeholders(start int, count int) string {
	parts := make([]string, count)
	for i := 0; i < count; i++ {
		parts[i] = "$" + strconv.Itoa(start+i)
	}
	return strings.Join(parts, ",")
}
