package dispatch

import (
	"context"
	"encoding/json"
	"strconv"

	"github.com/gofiber/fiber/v2"

	"pickme-backend/internal/middleware"
)

type ReportReader interface {
	Summary(ctx context.Context, days int) (json.RawMessage, error)
	DailyStats(ctx context.Context, days int) ([]json.RawMessage, error)
	RecentRuns(ctx context.Context, limit int) ([]json.RawMessage, error)
	Candidates(ctx context.Context, runID string, limit int) ([]json.RawMessage, error)
	Outcomes(ctx context.Context, limit int) ([]json.RawMessage, error)
	Failures(ctx context.Context, limit int) ([]json.RawMessage, error)
	Health(ctx context.Context, days int) (json.RawMessage, error)
}

type PostgresReports struct {
	db DB
}

func NewPostgresReports(db DB) *PostgresReports {
	return &PostgresReports{db: db}
}

func RegisterShadowAdminRoutes(app fiber.Router, reports ReportReader, requireAuth fiber.Handler) {
	app.Get("/admin/dispatch/shadow/summary", requireAuth, middleware.AdminOnly(), shadowSummaryHandler(reports))
	app.Get("/admin/dispatch/shadow/daily", requireAuth, middleware.AdminOnly(), shadowDailyHandler(reports))
	app.Get("/admin/dispatch/shadow/recent", requireAuth, middleware.AdminOnly(), shadowRecentHandler(reports))
	app.Get("/admin/dispatch/shadow/runs/:id/candidates", requireAuth, middleware.AdminOnly(), shadowCandidatesHandler(reports))
	app.Get("/admin/dispatch/shadow/outcomes", requireAuth, middleware.AdminOnly(), shadowOutcomesHandler(reports))
	app.Get("/admin/dispatch/shadow/failures", requireAuth, middleware.AdminOnly(), shadowFailuresHandler(reports))
	app.Get("/admin/dispatch/shadow/health", requireAuth, middleware.AdminOnly(), shadowHealthHandler(reports))
}

func (r *PostgresReports) Summary(ctx context.Context, days int) (json.RawMessage, error) {
	return queryJSON(ctx, r.db, `
		SELECT json_build_object(
			'total_shadow_runs', COUNT(r.*),
			'average_candidate_count', COALESCE(AVG(r.candidate_count), 0),
			'average_dispatch_latency_ms', COALESCE(AVG(r.dispatch_latency_ms), 0),
			'average_redis_geo_latency_ms', COALESCE(AVG(r.redis_latency_ms), 0),
			'average_candidate_discovery_latency_ms', COALESCE(AVG(r.candidate_discovery_latency_ms), 0),
			'average_ranking_latency_ms', COALESCE(AVG(r.ranking_latency_ms), 0),
			'average_shadow_write_latency_ms', COALESCE(AVG(r.shadow_write_latency_ms), 0),
			'actual_driver_was_candidate_rate', COALESCE(AVG(CASE WHEN o.actual_driver_was_candidate THEN 1.0 WHEN o.actual_driver_was_candidate = false THEN 0.0 END), 0),
			'actual_driver_was_selected_rate', COALESCE(AVG(CASE WHEN o.actual_driver_was_selected THEN 1.0 WHEN o.actual_driver_was_selected = false THEN 0.0 END), 0),
			'average_shadow_rank', COALESCE(AVG(o.actual_driver_shadow_rank), 0),
			'average_first_offer_time_seconds', COALESCE(AVG(o.seconds_to_first_offer), 0),
			'average_acceptance_time_seconds', COALESCE(AVG(o.seconds_to_acceptance), 0)
		)
		FROM public.dispatch_shadow_runs r
		LEFT JOIN public.dispatch_shadow_outcomes o ON o.ride_id = r.ride_id
		WHERE r.created_at >= NOW() - ($1::int * INTERVAL '1 day')
	`, days)
}

func (r *PostgresReports) DailyStats(ctx context.Context, days int) ([]json.RawMessage, error) {
	return queryJSONRows(ctx, r.db, `
		SELECT json_build_object(
			'day', day,
			'total_shadow_runs', total_shadow_runs,
			'average_candidate_count', average_candidate_count,
			'average_dispatch_latency_ms', average_dispatch_latency_ms,
			'average_redis_geo_latency_ms', average_redis_geo_latency_ms,
			'average_candidate_discovery_latency_ms', average_candidate_discovery_latency_ms,
			'average_ranking_latency_ms', average_ranking_latency_ms,
			'average_shadow_write_latency_ms', average_shadow_write_latency_ms,
			'actual_driver_was_candidate_rate', actual_driver_was_candidate_rate,
			'actual_driver_was_selected_rate', actual_driver_was_selected_rate,
			'average_shadow_rank', average_shadow_rank,
			'average_first_offer_time_seconds', average_first_offer_time_seconds,
			'average_acceptance_time_seconds', average_acceptance_time_seconds,
			'redis_unavailable_count', redis_unavailable_count,
			'no_coordinates_count', no_coordinates_count,
			'low_candidate_count', low_candidate_count,
			'updated_at', updated_at
		)
		FROM public.dispatch_shadow_daily_stats
		WHERE day >= CURRENT_DATE - ($1::int - 1)
		ORDER BY day DESC
	`, days)
}

func (r *PostgresReports) RecentRuns(ctx context.Context, limit int) ([]json.RawMessage, error) {
	return queryJSONRows(ctx, r.db, `
		SELECT json_build_object(
			'id', id,
			'ride_id', ride_id,
			'rider_id', rider_id,
			'status', status,
			'candidate_count', candidate_count,
			'selected_count', selected_count,
			'selected_driver_id', selected_driver_id,
			'selected_rank', selected_rank,
			'redis_available', redis_available,
			'redis_latency_ms', redis_latency_ms,
			'candidate_discovery_latency_ms', candidate_discovery_latency_ms,
			'ranking_latency_ms', ranking_latency_ms,
			'shadow_write_latency_ms', shadow_write_latency_ms,
			'dispatch_latency_ms', dispatch_latency_ms,
			'created_at', created_at
		)
		FROM public.dispatch_shadow_runs
		ORDER BY created_at DESC
		LIMIT $1
	`, limit)
}

func (r *PostgresReports) Candidates(ctx context.Context, runID string, limit int) ([]json.RawMessage, error) {
	return queryJSONRows(ctx, r.db, `
		SELECT json_build_object(
			'id', id,
			'shadow_run_id', shadow_run_id,
			'ride_id', ride_id,
			'driver_id', driver_id,
			'rank', rank,
			'selected', selected,
			'distance_km', distance_km,
			'score', score,
			'proximity_score', proximity_score,
			'freshness_score', freshness_score,
			'availability_score', availability_score,
			'location_updated_at', location_updated_at,
			'vehicle_type', vehicle_type,
			'city', city
		)
		FROM public.dispatch_shadow_candidates
		WHERE shadow_run_id = $1
		ORDER BY rank ASC
		LIMIT $2
	`, runID, limit)
}

func (r *PostgresReports) Outcomes(ctx context.Context, limit int) ([]json.RawMessage, error) {
	return queryJSONRows(ctx, r.db, `
		SELECT json_build_object(
			'ride_id', ride_id,
			'shadow_run_id', shadow_run_id,
			'actual_driver_id', actual_driver_id,
			'actual_offer_id', actual_offer_id,
			'actual_driver_was_candidate', actual_driver_was_candidate,
			'actual_driver_was_selected', actual_driver_was_selected,
			'actual_driver_shadow_rank', actual_driver_shadow_rank,
			'actual_driver_shadow_score', actual_driver_shadow_score,
			'first_offer_driver_id', first_offer_driver_id,
			'first_offer_was_candidate', first_offer_was_candidate,
			'first_offer_was_selected', first_offer_was_selected,
			'first_offer_shadow_rank', first_offer_shadow_rank,
			'seconds_to_first_offer', seconds_to_first_offer,
			'seconds_to_acceptance', seconds_to_acceptance,
			'updated_at', updated_at
		)
		FROM public.dispatch_shadow_outcomes
		ORDER BY updated_at DESC
		LIMIT $1
	`, limit)
}

func (r *PostgresReports) Failures(ctx context.Context, limit int) ([]json.RawMessage, error) {
	return queryJSONRows(ctx, r.db, `
		SELECT json_build_object(
			'id', id,
			'ride_id', ride_id,
			'status', status,
			'error', error,
			'redis_available', redis_available,
			'candidate_count', candidate_count,
			'redis_latency_ms', redis_latency_ms,
			'dispatch_latency_ms', dispatch_latency_ms,
			'created_at', created_at
		)
		FROM public.dispatch_shadow_runs
		WHERE status IN ('failed', 'redis_unavailable', 'no_coordinates', 'no_candidates')
		ORDER BY created_at DESC
		LIMIT $1
	`, limit)
}

func (r *PostgresReports) Health(ctx context.Context, days int) (json.RawMessage, error) {
	return queryJSON(ctx, r.db, `
		SELECT json_build_object(
			'redis_unavailable_count', COUNT(*) FILTER (WHERE status = 'redis_unavailable'),
			'no_coordinates_count', COUNT(*) FILTER (WHERE status = 'no_coordinates'),
			'low_candidate_count', COUNT(*) FILTER (WHERE candidate_count > 0 AND candidate_count < 3),
			'no_candidate_count', COUNT(*) FILTER (WHERE status = 'no_candidates'),
			'average_redis_geo_latency_ms', COALESCE(AVG(redis_latency_ms), 0),
			'average_candidate_discovery_latency_ms', COALESCE(AVG(candidate_discovery_latency_ms), 0),
			'average_ranking_latency_ms', COALESCE(AVG(ranking_latency_ms), 0),
			'average_shadow_write_latency_ms', COALESCE(AVG(shadow_write_latency_ms), 0),
			'stale_driver_density', COALESCE((
				SELECT AVG(CASE WHEN c.freshness_score < 1 THEN 1.0 ELSE 0.0 END)
				FROM public.dispatch_shadow_candidates c
				WHERE c.created_at >= NOW() - ($1::int * INTERVAL '1 day')
			), 0)
		)
		FROM public.dispatch_shadow_runs
		WHERE created_at >= NOW() - ($1::int * INTERVAL '1 day')
	`, days)
}

func shadowSummaryHandler(reports ReportReader) fiber.Handler {
	return func(c *fiber.Ctx) error {
		result, err := reports.Summary(middleware.RequestContext(c), daysParam(c, 7))
		return jsonResponse(c, result, err)
	}
}

func shadowDailyHandler(reports ReportReader) fiber.Handler {
	return func(c *fiber.Ctx) error {
		result, err := reports.DailyStats(middleware.RequestContext(c), daysParam(c, 30))
		return jsonRowsResponse(c, result, err)
	}
}

func shadowRecentHandler(reports ReportReader) fiber.Handler {
	return func(c *fiber.Ctx) error {
		result, err := reports.RecentRuns(middleware.RequestContext(c), limitParam(c, 50))
		return jsonRowsResponse(c, result, err)
	}
}

func shadowCandidatesHandler(reports ReportReader) fiber.Handler {
	return func(c *fiber.Ctx) error {
		result, err := reports.Candidates(middleware.RequestContext(c), c.Params("id"), limitParam(c, 50))
		return jsonRowsResponse(c, result, err)
	}
}

func shadowOutcomesHandler(reports ReportReader) fiber.Handler {
	return func(c *fiber.Ctx) error {
		result, err := reports.Outcomes(middleware.RequestContext(c), limitParam(c, 50))
		return jsonRowsResponse(c, result, err)
	}
}

func shadowFailuresHandler(reports ReportReader) fiber.Handler {
	return func(c *fiber.Ctx) error {
		result, err := reports.Failures(middleware.RequestContext(c), limitParam(c, 50))
		return jsonRowsResponse(c, result, err)
	}
}

func shadowHealthHandler(reports ReportReader) fiber.Handler {
	return func(c *fiber.Ctx) error {
		result, err := reports.Health(middleware.RequestContext(c), daysParam(c, 7))
		return jsonResponse(c, result, err)
	}
}

func queryJSON(ctx context.Context, db DB, sql string, args ...any) (json.RawMessage, error) {
	var payload []byte
	if err := db.QueryRow(ctx, sql, args...).Scan(&payload); err != nil {
		return nil, err
	}
	return json.RawMessage(payload), nil
}

func queryJSONRows(ctx context.Context, db DB, sql string, args ...any) ([]json.RawMessage, error) {
	rows, err := db.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var results []json.RawMessage
	for rows.Next() {
		var payload []byte
		if err := rows.Scan(&payload); err != nil {
			return nil, err
		}
		results = append(results, json.RawMessage(payload))
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if results == nil {
		results = []json.RawMessage{}
	}
	return results, nil
}

func jsonResponse(c *fiber.Ctx, result json.RawMessage, err error) error {
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	c.Set(fiber.HeaderContentType, fiber.MIMEApplicationJSONCharsetUTF8)
	return c.Send(result)
}

func jsonRowsResponse(c *fiber.Ctx, rows []json.RawMessage, err error) error {
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(rows)
}

func daysParam(c *fiber.Ctx, fallback int) int {
	return positiveInt(c.Query("days"), fallback, 365)
}

func limitParam(c *fiber.Ctx, fallback int) int {
	return positiveInt(c.Query("limit"), fallback, 500)
}

func positiveInt(value string, fallback int, max int) int {
	if value == "" {
		return fallback
	}
	parsed, err := strconv.Atoi(value)
	if err != nil || parsed <= 0 {
		return fallback
	}
	if parsed > max {
		return max
	}
	return parsed
}
