package reputation

import (
	"context"
	"encoding/json"
	"strconv"

	"github.com/gofiber/fiber/v2"

	"pickme-backend/internal/middleware"
)

type ReportReader interface {
	Drivers(ctx context.Context, limit int) ([]json.RawMessage, error)
	Driver(ctx context.Context, driverID string) (json.RawMessage, error)
	Events(ctx context.Context, driverID string, limit int) ([]json.RawMessage, error)
	TopDrivers(ctx context.Context, limit int) ([]json.RawMessage, error)
	LowScoreDrivers(ctx context.Context, limit int) ([]json.RawMessage, error)
}

type PostgresReports struct {
	db DB
}

func NewPostgresReports(db DB) *PostgresReports {
	return &PostgresReports{db: db}
}

func RegisterAdminRoutes(app fiber.Router, reports ReportReader, requireAuth fiber.Handler) {
	app.Get("/admin/reputation/drivers", requireAuth, middleware.AdminOnly(), reputationDriversHandler(reports))
	app.Get("/admin/reputation/drivers/:driverID", requireAuth, middleware.AdminOnly(), reputationDriverHandler(reports))
	app.Get("/admin/reputation/drivers/:driverID/events", requireAuth, middleware.AdminOnly(), reputationEventsHandler(reports))
	app.Get("/admin/reputation/top-drivers", requireAuth, middleware.AdminOnly(), reputationTopDriversHandler(reports))
	app.Get("/admin/reputation/low-score-drivers", requireAuth, middleware.AdminOnly(), reputationLowScoreDriversHandler(reports))
}

func (r *PostgresReports) Drivers(ctx context.Context, limit int) ([]json.RawMessage, error) {
	return queryJSONRows(ctx, r.db, driverSelectSQL()+`
		FROM public.driver_reputation
		ORDER BY updated_at DESC
		LIMIT $1
	`, limit)
}

func (r *PostgresReports) Driver(ctx context.Context, driverID string) (json.RawMessage, error) {
	return queryJSON(ctx, r.db, driverSelectSQL()+`
		FROM public.driver_reputation
		WHERE driver_id = $1
	`, driverID)
}

func (r *PostgresReports) Events(ctx context.Context, driverID string, limit int) ([]json.RawMessage, error) {
	return queryJSONRows(ctx, r.db, `
		SELECT json_build_object(
			'id', id,
			'driver_id', driver_id,
			'event_type', event_type,
			'ride_id', ride_id,
			'offer_id', offer_id,
			'score_before', score_before,
			'score_after', score_after,
			'metadata', metadata,
			'created_at', created_at
		)
		FROM public.driver_reputation_events
		WHERE driver_id = $1
		ORDER BY created_at DESC
		LIMIT $2
	`, driverID, limit)
}

func (r *PostgresReports) TopDrivers(ctx context.Context, limit int) ([]json.RawMessage, error) {
	return queryJSONRows(ctx, r.db, driverSelectSQL()+`
		FROM public.driver_reputation
		ORDER BY dispatch_score DESC, completed_rides DESC
		LIMIT $1
	`, limit)
}

func (r *PostgresReports) LowScoreDrivers(ctx context.Context, limit int) ([]json.RawMessage, error) {
	return queryJSONRows(ctx, r.db, driverSelectSQL()+`
		FROM public.driver_reputation
		ORDER BY dispatch_score ASC, cancellation_rate DESC
		LIMIT $1
	`, limit)
}

func driverSelectSQL() string {
	return `
		SELECT json_build_object(
			'driver_id', driver_id,
			'rating_avg', rating_avg,
			'rating_count', rating_count,
			'acceptance_rate', acceptance_rate,
			'completion_rate', completion_rate,
			'cancellation_rate', cancellation_rate,
			'cancel_after_accept_rate', cancel_after_accept_rate,
			'reliability_score', reliability_score,
			'freshness_score', freshness_score,
			'dispatch_score', dispatch_score,
			'completed_rides', completed_rides,
			'accepted_rides', accepted_rides,
			'offered_rides', offered_rides,
			'rejected_offers', rejected_offers,
			'timed_out_offers', timed_out_offers,
			'cancelled_rides', cancelled_rides,
			'last_completed_ride_at', last_completed_ride_at,
			'last_offer_at', last_offer_at,
			'updated_at', updated_at
		)
	`
}

func reputationDriversHandler(reports ReportReader) fiber.Handler {
	return func(c *fiber.Ctx) error {
		rows, err := reports.Drivers(middleware.RequestContext(c), limitParam(c, 50))
		return jsonRowsResponse(c, rows, err)
	}
}

func reputationDriverHandler(reports ReportReader) fiber.Handler {
	return func(c *fiber.Ctx) error {
		result, err := reports.Driver(middleware.RequestContext(c), c.Params("driverID"))
		return jsonResponse(c, result, err)
	}
}

func reputationEventsHandler(reports ReportReader) fiber.Handler {
	return func(c *fiber.Ctx) error {
		rows, err := reports.Events(middleware.RequestContext(c), c.Params("driverID"), limitParam(c, 50))
		return jsonRowsResponse(c, rows, err)
	}
}

func reputationTopDriversHandler(reports ReportReader) fiber.Handler {
	return func(c *fiber.Ctx) error {
		rows, err := reports.TopDrivers(middleware.RequestContext(c), limitParam(c, 50))
		return jsonRowsResponse(c, rows, err)
	}
}

func reputationLowScoreDriversHandler(reports ReportReader) fiber.Handler {
	return func(c *fiber.Ctx) error {
		rows, err := reports.LowScoreDrivers(middleware.RequestContext(c), limitParam(c, 50))
		return jsonRowsResponse(c, rows, err)
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

func limitParam(c *fiber.Ctx, fallback int) int {
	value := c.Query("limit")
	if value == "" {
		return fallback
	}
	parsed, err := strconv.Atoi(value)
	if err != nil || parsed <= 0 {
		return fallback
	}
	if parsed > 500 {
		return 500
	}
	return parsed
}
