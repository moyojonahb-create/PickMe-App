package reputation

import (
	"context"
	"encoding/json"

	"github.com/gofiber/fiber/v2"

	"pickme-backend/internal/middleware"
)

type CalibrationReportReader interface {
	Health(ctx context.Context) (json.RawMessage, error)
	Distribution(ctx context.Context) (json.RawMessage, error)
	Cohorts(ctx context.Context) (json.RawMessage, error)
	Calibration(ctx context.Context, limit int) ([]json.RawMessage, error)
	DispatchAnalysis(ctx context.Context) (json.RawMessage, error)
}

func RegisterCalibrationAdminRoutes(app fiber.Router, reports CalibrationReportReader, requireAuth fiber.Handler) {
	app.Get("/admin/reputation/health", requireAuth, middleware.AdminOnly(), reputationHealthHandler(reports))
	app.Get("/admin/reputation/distribution", requireAuth, middleware.AdminOnly(), reputationDistributionHandler(reports))
	app.Get("/admin/reputation/cohorts", requireAuth, middleware.AdminOnly(), reputationCohortsHandler(reports))
	app.Get("/admin/reputation/calibration", requireAuth, middleware.AdminOnly(), reputationCalibrationHandler(reports))
	app.Get("/admin/reputation/dispatch-analysis", requireAuth, middleware.AdminOnly(), reputationDispatchAnalysisHandler(reports))
}

func (r *PostgresReports) Health(ctx context.Context) (json.RawMessage, error) {
	return queryJSON(ctx, r.db, `
		SELECT json_build_object(
			'driver_count', COUNT(*),
			'average_dispatch_score', COALESCE(AVG(dispatch_score), 0),
			'median_dispatch_score', COALESCE(percentile_cont(0.50) WITHIN GROUP (ORDER BY dispatch_score), 0),
			'p25_score', COALESCE(percentile_cont(0.25) WITHIN GROUP (ORDER BY dispatch_score), 0),
			'p50_score', COALESCE(percentile_cont(0.50) WITHIN GROUP (ORDER BY dispatch_score), 0),
			'p75_score', COALESCE(percentile_cont(0.75) WITHIN GROUP (ORDER BY dispatch_score), 0),
			'p90_score', COALESCE(percentile_cont(0.90) WITHIN GROUP (ORDER BY dispatch_score), 0),
			'p95_score', COALESCE(percentile_cont(0.95) WITHIN GROUP (ORDER BY dispatch_score), 0),
			'score_inflation_detected', COALESCE(percentile_cont(0.75) WITHIN GROUP (ORDER BY dispatch_score), 0) > 0.90,
			'score_compression_detected', (
				COALESCE(percentile_cont(0.75) WITHIN GROUP (ORDER BY dispatch_score), 0) -
				COALESCE(percentile_cont(0.25) WITHIN GROUP (ORDER BY dispatch_score), 0)
			) < 0.10 AND COUNT(*) > 0,
			'score_starvation_detected', COALESCE(percentile_cont(0.50) WITHIN GROUP (ORDER BY dispatch_score), 0) < 0.35 AND COUNT(*) > 0,
			'new_driver_disadvantage_detected', COALESCE(AVG(dispatch_score) FILTER (WHERE completed_rides = 0), 0) + 0.10 <
				COALESCE(AVG(dispatch_score) FILTER (WHERE completed_rides >= 10), 0),
			'over_rewarded_veterans_detected', COALESCE(AVG(dispatch_score) FILTER (WHERE completed_rides >= 50), 0) > 0.90,
			'abnormal_score_clustering', (
				COALESCE(percentile_cont(0.95) WITHIN GROUP (ORDER BY dispatch_score), 0) -
				COALESCE(percentile_cont(0.50) WITHIN GROUP (ORDER BY dispatch_score), 0)
			) < 0.05 AND COUNT(*) > 0
		)
		FROM public.driver_reputation
	`)
}

func (r *PostgresReports) Distribution(ctx context.Context) (json.RawMessage, error) {
	return queryJSON(ctx, r.db, `
		SELECT json_build_object(
			'score_distribution', COALESCE(json_agg(bucket ORDER BY bucket_start), '[]'::json),
			'acceptance_distribution', (
				SELECT COALESCE(json_agg(row_to_json(x) ORDER BY bucket_start), '[]'::json)
				FROM (
					SELECT width_bucket(acceptance_rate, 0, 1, 10) AS bucket_start, COUNT(*) AS driver_count
					FROM public.driver_reputation
					GROUP BY 1
				) x
			),
			'completion_distribution', (
				SELECT COALESCE(json_agg(row_to_json(x) ORDER BY bucket_start), '[]'::json)
				FROM (
					SELECT width_bucket(completion_rate, 0, 1, 10) AS bucket_start, COUNT(*) AS driver_count
					FROM public.driver_reputation
					GROUP BY 1
				) x
			),
			'cancellation_distribution', (
				SELECT COALESCE(json_agg(row_to_json(x) ORDER BY bucket_start), '[]'::json)
				FROM (
					SELECT width_bucket(cancellation_rate, 0, 1, 10) AS bucket_start, COUNT(*) AS driver_count
					FROM public.driver_reputation
					GROUP BY 1
				) x
			),
			'freshness_distribution', (
				SELECT COALESCE(json_agg(row_to_json(x) ORDER BY bucket_start), '[]'::json)
				FROM (
					SELECT width_bucket(freshness_score, 0, 1, 10) AS bucket_start, COUNT(*) AS driver_count
					FROM public.driver_reputation
					GROUP BY 1
				) x
			),
			'rating_distribution', (
				SELECT COALESCE(json_agg(row_to_json(x) ORDER BY bucket_start), '[]'::json)
				FROM (
					SELECT width_bucket(rating_avg, 0, 5, 10) AS bucket_start, COUNT(*) AS driver_count
					FROM public.driver_reputation
					WHERE rating_count > 0
					GROUP BY 1
				) x
			)
		)
		FROM (
			SELECT json_build_object(
				'bucket_start', (bucket - 1) / 10.0,
				'bucket_end', bucket / 10.0,
				'driver_count', COUNT(*)
			) AS bucket,
			(bucket - 1) / 10.0 AS bucket_start
			FROM (
				SELECT GREATEST(1, LEAST(10, width_bucket(dispatch_score, 0, 1, 10))) AS bucket
				FROM public.driver_reputation
			) scores
			GROUP BY bucket
		) buckets
	`)
}

func (r *PostgresReports) Cohorts(ctx context.Context) (json.RawMessage, error) {
	return queryJSON(ctx, r.db, `
		SELECT COALESCE(json_agg(row_to_json(cohorts) ORDER BY cohort), '[]'::json)
		FROM (
			SELECT
				CASE
					WHEN completed_rides = 0 THEN 'new'
					WHEN completed_rides < 10 THEN 'low_volume'
					WHEN completed_rides < 50 THEN 'medium_volume'
					ELSE 'high_volume'
				END AS cohort,
				COUNT(*) AS driver_count,
				COALESCE(AVG(dispatch_score), 0) AS average_dispatch_score,
				COALESCE(AVG(acceptance_rate), 0) AS average_acceptance_rate,
				COALESCE(AVG(completion_rate), 0) AS average_completion_rate,
				COALESCE(AVG(cancellation_rate), 0) AS average_cancellation_rate
			FROM public.driver_reputation
			GROUP BY 1
		) cohorts
	`)
}

func (r *PostgresReports) Calibration(ctx context.Context, limit int) ([]json.RawMessage, error) {
	return queryJSONRows(ctx, r.db, `
		SELECT json_build_object(
			'id', id,
			'run_date', run_date,
			'driver_count', driver_count,
			'score_inflation_detected', score_inflation_detected,
			'score_compression_detected', score_compression_detected,
			'score_starvation_detected', score_starvation_detected,
			'new_driver_disadvantage_detected', new_driver_disadvantage_detected,
			'actual_driver_was_selected_rate', actual_driver_was_selected_rate,
			'average_actual_driver_rank', average_actual_driver_rank,
			'reputation_acceptance_correlation', reputation_acceptance_correlation,
			'reputation_completion_correlation', reputation_completion_correlation,
			'recommendation', recommendation,
			'metadata', metadata,
			'created_at', created_at
		)
		FROM public.reputation_calibration_runs
		ORDER BY created_at DESC
		LIMIT $1
	`, limit)
}

func (r *PostgresReports) DispatchAnalysis(ctx context.Context) (json.RawMessage, error) {
	return queryJSON(ctx, r.db, `
		SELECT json_build_object(
			'actual_driver_was_selected_rate', COALESCE(AVG(CASE WHEN o.actual_driver_was_selected THEN 1.0 WHEN o.actual_driver_was_selected = false THEN 0.0 END), 0),
			'actual_driver_rank_distribution', COALESCE(json_agg(o.actual_driver_shadow_rank) FILTER (WHERE o.actual_driver_shadow_rank IS NOT NULL), '[]'::json),
			'average_actual_driver_rank', COALESCE(AVG(o.actual_driver_shadow_rank), 0),
			'reputation_vs_actual_acceptance', COALESCE(corr(rep.dispatch_score, rep.acceptance_rate), 0),
			'reputation_vs_completion', COALESCE(corr(rep.dispatch_score, rep.completion_rate), 0),
			'sample_count', COUNT(o.*)
		)
		FROM public.dispatch_shadow_outcomes o
		LEFT JOIN public.driver_reputation rep ON rep.driver_id = o.actual_driver_id
		WHERE o.actual_driver_id IS NOT NULL
	`)
}

func reputationHealthHandler(reports CalibrationReportReader) fiber.Handler {
	return func(c *fiber.Ctx) error {
		result, err := reports.Health(middleware.RequestContext(c))
		return jsonResponse(c, result, err)
	}
}

func reputationDistributionHandler(reports CalibrationReportReader) fiber.Handler {
	return func(c *fiber.Ctx) error {
		result, err := reports.Distribution(middleware.RequestContext(c))
		return jsonResponse(c, result, err)
	}
}

func reputationCohortsHandler(reports CalibrationReportReader) fiber.Handler {
	return func(c *fiber.Ctx) error {
		result, err := reports.Cohorts(middleware.RequestContext(c))
		return jsonResponse(c, result, err)
	}
}

func reputationCalibrationHandler(reports CalibrationReportReader) fiber.Handler {
	return func(c *fiber.Ctx) error {
		rows, err := reports.Calibration(middleware.RequestContext(c), limitParam(c, 20))
		return jsonRowsResponse(c, rows, err)
	}
}

func reputationDispatchAnalysisHandler(reports CalibrationReportReader) fiber.Handler {
	return func(c *fiber.Ctx) error {
		result, err := reports.DispatchAnalysis(middleware.RequestContext(c))
		return jsonResponse(c, result, err)
	}
}
