package business

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"pickme-backend/internal/middleware"
	"pickme-backend/internal/observability"
)

type Handler struct {
	db *pgxpool.Pool
}

func RegisterRoutes(app *fiber.App, db *pgxpool.Pool, requireAuth fiber.Handler) {
	h := &Handler{db: db}

	api := app.Group("/api", requireAuth)
	api.Post("/ratings/driver", h.CreateDriverRating)
	api.Post("/disputes", h.CreateDispute)
	api.Post("/emergency-events", h.CreateEmergencyEvent)
	api.Post("/rides/:rideId/cancel", h.CancelRide)
	api.Post("/notifications", h.CreateNotification)
	api.Post("/notifications/:id/read", h.MarkNotificationRead)
	api.Post("/notifications/read", h.MarkNotificationsRead)
	api.Post("/tips", h.CreateTip)
	api.Post("/fraud-flags", h.CreateFraudFlag)
	api.Post("/ride-stops", h.CreateRideStops)
	api.Post("/ride-preferences", h.CreateRidePreferences)
	api.Post("/student-discount-usage", h.CreateStudentDiscountUsage)
	api.Post("/drivers/applications", h.CreateDriverApplication)
	api.Post("/drivers/applications/upsert", h.UpsertDriverApplication)
	api.Post("/drivers/documents", h.CreateDriverDocument)
	api.Patch("/drivers/me", h.UpdateMyDriver)
	api.Post("/drivers/feedback", h.CreateDriverFeedback)
	api.Patch("/profiles/me", h.UpdateMyProfile)
	api.Patch("/profiles/me/avatar", h.UpdateMyProfileAvatar)
	api.Post("/user-settings", h.UpsertUserSettings)
	api.Patch("/rider-preferences", h.UpdateRiderPreferences)
	api.Post("/favorite-locations", h.CreateFavoriteLocation)
	api.Delete("/favorite-locations/:id", h.DeleteFavoriteLocation)
	api.Post("/messages", h.CreateMessage)
	api.Post("/call-sessions", h.CreateCallSession)
	api.Patch("/call-sessions/:id", h.UpdateCallSession)
	api.Post("/driver-sessions/fatigue-break", h.CreateFatigueBreak)
	api.Post("/dev/places-cache", h.CachePlace)
	api.Get("/drivers/me/can-operate", h.CanDriverOperate)
	api.Get("/drivers/me/top-status", h.IsTopDriver)

	admin := app.Group("/admin", requireAuth)
	admin.Get("/auth/verify", h.AdminVerify)
	admin.Patch("/business/:table/:id", h.AdminUpdateRow)
	admin.Post("/business/:table", h.AdminInsertRow)
	admin.Delete("/business/:table/:id", h.AdminDeleteRow)
	admin.Post("/rides/:rideId/cancel", h.AdminCancelRide)
	admin.Post("/disputes/:id/status", h.AdminUpdateDispute)
	admin.Post("/promos", h.AdminCreatePromo)
	admin.Patch("/promos/:id", h.AdminUpdatePromo)
	admin.Delete("/promos/:id", h.AdminDeletePromo)
	admin.Patch("/town-pricing/:id", h.AdminUpdateTownPricing)
	admin.Post("/live-locations/purge-stale", h.AdminPurgeStaleLiveLocations)
	admin.Post("/drivers/force-offline-ghosts", h.AdminForceOfflineGhostDrivers)
	admin.Post("/rides/cancel-stuck", h.AdminCancelStuckRides)
	admin.Post("/drivers/fatigue-break", h.AdminForceFatigueBreak)
	admin.Post("/system-health/logs/ingest", h.AdminIngestSystemHealthLogs)
	admin.Post("/system-health/logs/:id/resolve", h.AdminResolveSystemHealthLog)
	admin.Post("/ramz-audit", h.AdminCreateRamzAudit)
	admin.Post("/operations/expire-old-rides", h.AdminExpireOldRides)
	admin.Post("/operations/auto-resolve-noise-fraud-flags", h.AdminAutoResolveNoiseFraudFlags)
	admin.Post("/operations/cleanup-old-messages", h.AdminCleanupOldMessages)
	admin.Post("/operations/update-demand-zones", h.AdminUpdateDemandZones)
}

func (h *Handler) AdminVerify(c *fiber.Ctx) error {
	if err := h.requireAdmin(c); err != nil {
		return err
	}
	return c.JSON(fiber.Map{"success": true, "isAdmin": true})
}

func (h *Handler) CreateDriverRating(c *fiber.Ctx) error {
	userID, ok := middleware.AuthenticatedUserID(c)
	if !ok {
		return fiber.NewError(fiber.StatusUnauthorized, "authentication required")
	}

	var in struct {
		RideID   string `json:"ride_id"`
		DriverID string `json:"driver_id"`
		Rating   int    `json:"rating"`
		Comment  string `json:"comment"`
	}
	if err := c.BodyParser(&in); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "invalid request body")
	}
	if in.RideID == "" || in.DriverID == "" || in.Rating < 1 || in.Rating > 5 {
		return fiber.NewError(fiber.StatusBadRequest, "ride_id, driver_id, and rating 1-5 are required")
	}

	_, err := h.db.Exec(c.Context(), `
		INSERT INTO public.driver_ratings (ride_id, rider_id, driver_id, rating, comment)
		VALUES ($1, $2, $3, $4, NULLIF($5, ''))`,
		in.RideID, userID, in.DriverID, in.Rating, strings.TrimSpace(in.Comment))
	if err != nil {
		return err
	}
	return c.JSON(fiber.Map{"success": true})
}

func (h *Handler) CreateDispute(c *fiber.Ctx) error {
	userID, ok := middleware.AuthenticatedUserID(c)
	if !ok {
		return fiber.NewError(fiber.StatusUnauthorized, "authentication required")
	}

	var in struct {
		RideID       string `json:"ride_id"`
		ReporterRole string `json:"reporter_role"`
		Category     string `json:"category"`
		Description  string `json:"description"`
	}
	if err := c.BodyParser(&in); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "invalid request body")
	}
	if in.RideID == "" || in.ReporterRole == "" || in.Category == "" || strings.TrimSpace(in.Description) == "" {
		return fiber.NewError(fiber.StatusBadRequest, "ride_id, reporter_role, category, and description are required")
	}

	_, err := h.db.Exec(c.Context(), `
		INSERT INTO public.disputes (ride_id, reporter_id, reporter_role, category, description)
		VALUES ($1, $2, $3, $4, $5)`,
		in.RideID, userID, in.ReporterRole, in.Category, strings.TrimSpace(in.Description))
	if err != nil {
		return err
	}
	return c.JSON(fiber.Map{"success": true})
}

func (h *Handler) CreateEmergencyEvent(c *fiber.Ctx) error {
	userID, ok := middleware.AuthenticatedUserID(c)
	if !ok {
		return fiber.NewError(fiber.StatusUnauthorized, "authentication required")
	}

	var in struct {
		RideID    *string   `json:"ride_id"`
		Latitude  float64   `json:"latitude"`
		Longitude float64   `json:"longitude"`
		Metadata  fiber.Map `json:"metadata"`
	}
	if err := c.BodyParser(&in); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "invalid request body")
	}
	if in.Latitude < -90 || in.Latitude > 90 || in.Longitude < -180 || in.Longitude > 180 {
		return fiber.NewError(fiber.StatusBadRequest, "invalid coordinates")
	}

	_, err := h.db.Exec(c.Context(), `
		INSERT INTO public.emergency_alerts (ride_id, user_id, latitude, longitude)
		VALUES ($1, $2, $3, $4)`,
		in.RideID, userID, in.Latitude, in.Longitude)
	if err != nil {
		return err
	}
	return c.JSON(fiber.Map{"success": true})
}

func (h *Handler) CancelRide(c *fiber.Ctx) error {
	userID, ok := middleware.AuthenticatedUserID(c)
	if !ok {
		return fiber.NewError(fiber.StatusUnauthorized, "authentication required")
	}
	return h.cancelRide(c.Context(), c.Params("rideId"), userID, false, c)
}

func (h *Handler) AdminCancelRide(c *fiber.Ctx) error {
	if err := h.requireAdmin(c); err != nil {
		return err
	}
	return h.cancelRide(c.Context(), c.Params("rideId"), "", true, c)
}

func (h *Handler) cancelRide(ctx context.Context, rideID string, userID string, admin bool, c *fiber.Ctx) error {
	var in struct {
		CancellationFee float64 `json:"cancellation_fee"`
		Reason          string  `json:"reason"`
	}
	_ = c.BodyParser(&in)
	if rideID == "" {
		return fiber.NewError(fiber.StatusBadRequest, "ride id is required")
	}
	if in.CancellationFee < 0 {
		return fiber.NewError(fiber.StatusBadRequest, "cancellation_fee cannot be negative")
	}

	tx, err := h.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	if in.CancellationFee > 0 {
		_, err = tx.Exec(ctx, `
			INSERT INTO public.cancellation_fees (ride_id, amount, reason)
			VALUES ($1, $2, NULLIF($3, ''))`,
			rideID, in.CancellationFee, strings.TrimSpace(in.Reason))
		if err != nil {
			return err
		}
	}

	var tag pgconn.CommandTag
	if admin {
		tag, err = tx.Exec(ctx, `
			UPDATE public.rides
			SET status = 'cancelled', ride_status = 'cancelled', cancellation_fee = $2, updated_at = now()
			WHERE id = $1`,
			rideID, in.CancellationFee)
	} else {
		tag, err = tx.Exec(ctx, `
			UPDATE public.rides
			SET status = 'cancelled', ride_status = 'cancelled', cancellation_fee = $3, updated_at = now()
			WHERE id = $1 AND (user_id = $2 OR rider_id = $2)`,
			rideID, userID, in.CancellationFee)
	}
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return fiber.NewError(fiber.StatusNotFound, "ride not found or not allowed")
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	observability.RecordRideCancelled()
	return c.JSON(fiber.Map{"success": true, "cancelled": tag.RowsAffected()})
}

func (h *Handler) CreateNotification(c *fiber.Ctx) error {
	if _, ok := middleware.AuthenticatedUserID(c); !ok {
		return fiber.NewError(fiber.StatusUnauthorized, "authentication required")
	}
	payload, err := decodeMap(c)
	if err != nil {
		return err
	}
	allowed := only(payload, "user_id", "type", "notification_type", "title", "message", "body", "ride_id", "data")
	if allowed["type"] == nil && allowed["notification_type"] != nil {
		allowed["type"] = allowed["notification_type"]
	}
	if allowed["notification_type"] == nil && allowed["type"] != nil {
		allowed["notification_type"] = allowed["type"]
	}
	if allowed["message"] == nil && allowed["body"] != nil {
		allowed["message"] = allowed["body"]
	}
	if allowed["body"] == nil && allowed["message"] != nil {
		allowed["body"] = allowed["message"]
	}
	if allowed["user_id"] == nil || allowed["notification_type"] == nil || allowed["title"] == nil || allowed["body"] == nil {
		return fiber.NewError(fiber.StatusBadRequest, "user_id, notification_type, title, and body are required")
	}
	delete(allowed, "type")
	delete(allowed, "message")
	if err := h.insertOne(c.Context(), "notifications", allowed); err != nil {
		return err
	}
	return c.JSON(fiber.Map{"success": true})
}

func (h *Handler) MarkNotificationRead(c *fiber.Ctx) error {
	userID, ok := middleware.AuthenticatedUserID(c)
	if !ok {
		return fiber.NewError(fiber.StatusUnauthorized, "authentication required")
	}
	tag, err := h.db.Exec(c.Context(), `
		UPDATE public.notifications
		SET is_read = true, read_at = now()
		WHERE id = $1 AND user_id = $2`,
		c.Params("id"), userID)
	if err != nil {
		return err
	}
	return c.JSON(fiber.Map{"success": true, "updated": tag.RowsAffected()})
}

func (h *Handler) MarkNotificationsRead(c *fiber.Ctx) error {
	userID, ok := middleware.AuthenticatedUserID(c)
	if !ok {
		return fiber.NewError(fiber.StatusUnauthorized, "authentication required")
	}
	var in struct {
		IDs []string `json:"ids"`
	}
	if err := c.BodyParser(&in); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "invalid request body")
	}
	if len(in.IDs) == 0 {
		return c.JSON(fiber.Map{"success": true, "updated": 0})
	}
	tag, err := h.db.Exec(c.Context(), `
		UPDATE public.notifications
		SET is_read = true, read_at = now()
		WHERE user_id = $1 AND id = ANY($2)`,
		userID, in.IDs)
	if err != nil {
		return err
	}
	return c.JSON(fiber.Map{"success": true, "updated": tag.RowsAffected()})
}

func (h *Handler) CreateTip(c *fiber.Ctx) error {
	userID, ok := middleware.AuthenticatedUserID(c)
	if !ok {
		return fiber.NewError(fiber.StatusUnauthorized, "authentication required")
	}
	payload, err := decodeMap(c)
	if err != nil {
		return err
	}
	payload = only(payload, "ride_id", "driver_id", "amount", "message")
	payload["rider_id"] = userID
	if payload["ride_id"] == nil || payload["driver_id"] == nil || payload["amount"] == nil {
		return fiber.NewError(fiber.StatusBadRequest, "ride_id, driver_id, and amount are required")
	}
	if err := h.insertOne(c.Context(), "tips", payload); err != nil {
		return err
	}
	return c.JSON(fiber.Map{"success": true})
}

func (h *Handler) CreateFraudFlag(c *fiber.Ctx) error {
	payload, err := decodeMap(c)
	if err != nil {
		return err
	}
	payload = only(payload, "user_id", "flag_type", "severity", "description", "metadata", "details")
	if payload["details"] == nil && payload["metadata"] != nil {
		payload["details"] = payload["metadata"]
	}
	if payload["user_id"] == nil || payload["flag_type"] == nil || payload["severity"] == nil {
		return fiber.NewError(fiber.StatusBadRequest, "user_id, flag_type, and severity are required")
	}
	if err := h.insertOne(c.Context(), "fraud_flags", payload); err != nil {
		return err
	}
	return c.JSON(fiber.Map{"success": true})
}

func (h *Handler) CreateRideStops(c *fiber.Ctx) error {
	payload, err := decodeMap(c)
	if err != nil {
		return err
	}
	if rows, ok := payload["rows"].([]any); ok {
		for _, item := range rows {
			row, ok := item.(map[string]any)
			if !ok {
				return fiber.NewError(fiber.StatusBadRequest, "rows must contain objects")
			}
			if err := h.insertOne(c.Context(), "ride_stops", row); err != nil {
				return err
			}
		}
		return c.JSON(fiber.Map{"success": true, "inserted": len(rows)})
	}
	if err := h.insertOne(c.Context(), "ride_stops", payload); err != nil {
		return err
	}
	return c.JSON(fiber.Map{"success": true})
}

func (h *Handler) CreateRidePreferences(c *fiber.Ctx) error {
	payload, err := decodeMap(c)
	if err != nil {
		return err
	}
	if err := h.insertOne(c.Context(), "ride_preferences", payload); err != nil {
		return err
	}
	return c.JSON(fiber.Map{"success": true})
}

func (h *Handler) CreateStudentDiscountUsage(c *fiber.Ctx) error {
	userID, ok := middleware.AuthenticatedUserID(c)
	if !ok {
		return fiber.NewError(fiber.StatusUnauthorized, "authentication required")
	}
	payload, err := decodeMap(c)
	if err != nil {
		return err
	}
	payload = only(payload, "ride_id", "discount_amount")
	payload["user_id"] = userID
	if payload["ride_id"] == nil || payload["discount_amount"] == nil {
		return fiber.NewError(fiber.StatusBadRequest, "ride_id and discount_amount are required")
	}
	if err := h.insertOne(c.Context(), "student_discount_usage", payload); err != nil {
		return err
	}
	return c.JSON(fiber.Map{"success": true})
}

func (h *Handler) CreateDriverApplication(c *fiber.Ctx) error {
	userID, ok := middleware.AuthenticatedUserID(c)
	if !ok {
		return fiber.NewError(fiber.StatusUnauthorized, "authentication required")
	}
	payload, err := decodeMap(c)
	if err != nil {
		return err
	}
	row := only(payload, "vehicle_type", "vehicle_make", "vehicle_model", "vehicle_year", "vehicle_color", "plate_number", "gender", "status", "is_online")
	row["user_id"] = userID
	if row["status"] == nil {
		row["status"] = "pending"
	}
	if row["is_online"] == nil {
		row["is_online"] = false
	}
	id, err := h.insertReturningID(c.Context(), "drivers", row)
	if err != nil {
		return err
	}
	return c.JSON(fiber.Map{"success": true, "id": id})
}

func (h *Handler) UpsertDriverApplication(c *fiber.Ctx) error {
	userID, ok := middleware.AuthenticatedUserID(c)
	if !ok {
		return fiber.NewError(fiber.StatusUnauthorized, "authentication required")
	}
	payload, err := decodeMap(c)
	if err != nil {
		return err
	}
	profile, _ := payload["profile"].(map[string]any)
	driver, _ := payload["driver"].(map[string]any)
	if len(driver) == 0 {
		driver = payload
	}
	driver = only(driver, "vehicle_type", "vehicle_make", "vehicle_model", "vehicle_year", "vehicle_color", "plate_number", "gender", "status", "is_online")
	if len(driver) == 0 {
		return fiber.NewError(fiber.StatusBadRequest, "driver fields are required")
	}
	driver["user_id"] = userID
	if driver["status"] == nil {
		driver["status"] = "pending"
	}
	if driver["is_online"] == nil {
		driver["is_online"] = false
	}

	tx, err := h.db.BeginTx(c.Context(), pgx.TxOptions{})
	if err != nil {
		return err
	}
	defer tx.Rollback(c.Context())

	if len(profile) > 0 {
		profile = only(profile, "full_name", "phone", "avatar_url", "gender")
		profile["user_id"] = userID
		if err := h.upsertProfileTx(c.Context(), tx, profile); err != nil {
			return err
		}
	}

	id, err := h.upsertDriverTx(c.Context(), tx, userID, driver)
	if err != nil {
		return err
	}
	if err := tx.Commit(c.Context()); err != nil {
		return err
	}
	return c.JSON(fiber.Map{"success": true, "id": id})
}

func (h *Handler) CreateDriverDocument(c *fiber.Ctx) error {
	userID, ok := middleware.AuthenticatedUserID(c)
	if !ok {
		return fiber.NewError(fiber.StatusUnauthorized, "authentication required")
	}
	payload, err := decodeMap(c)
	if err != nil {
		return err
	}
	row := only(payload, "driver_id", "document_type", "file_url", "status", "rejection_reason")
	if row["driver_id"] == nil || row["document_type"] == nil || row["file_url"] == nil {
		return fiber.NewError(fiber.StatusBadRequest, "driver_id, document_type, and file_url are required")
	}
	if row["status"] == nil {
		row["status"] = "pending"
	}
	var allowed bool
	if err := h.db.QueryRow(c.Context(), `SELECT EXISTS (SELECT 1 FROM public.drivers WHERE id = $1 AND user_id = $2)`, row["driver_id"], userID).Scan(&allowed); err != nil {
		return err
	}
	if !allowed {
		return fiber.NewError(fiber.StatusForbidden, "driver document owner mismatch")
	}
	id, err := h.insertReturningID(c.Context(), "driver_documents", row)
	if err != nil {
		return err
	}
	return c.JSON(fiber.Map{"success": true, "id": id})
}

func (h *Handler) UpdateMyDriver(c *fiber.Ctx) error {
	userID, ok := middleware.AuthenticatedUserID(c)
	if !ok {
		return fiber.NewError(fiber.StatusUnauthorized, "authentication required")
	}
	payload, err := decodeMap(c)
	if err != nil {
		return err
	}
	changes := only(payload, "avatar_url", "preferred_service_area", "earning_notifications", "ecocash_number", "vehicle_type", "vehicle_make", "vehicle_model", "vehicle_year", "vehicle_color", "plate_number", "gender")
	if len(changes) == 0 {
		return fiber.NewError(fiber.StatusBadRequest, "no writable driver fields provided")
	}
	tag, err := h.updateWhere(c.Context(), "drivers", changes, "user_id = $%d", userID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return fiber.NewError(fiber.StatusNotFound, "driver not found")
	}
	return c.JSON(fiber.Map{"success": true, "updated": tag.RowsAffected()})
}

func (h *Handler) CreateDriverFeedback(c *fiber.Ctx) error {
	userID, ok := middleware.AuthenticatedUserID(c)
	if !ok {
		return fiber.NewError(fiber.StatusUnauthorized, "authentication required")
	}
	payload, err := decodeMap(c)
	if err != nil {
		return err
	}
	row := only(payload, "type", "message")
	row["driver_id"] = userID
	if row["type"] == nil || strings.TrimSpace(fmt.Sprint(row["message"])) == "" {
		return fiber.NewError(fiber.StatusBadRequest, "type and message are required")
	}
	if err := h.insertOne(c.Context(), "driver_feedback", row); err != nil {
		return err
	}
	return c.JSON(fiber.Map{"success": true})
}

func (h *Handler) UpdateMyProfile(c *fiber.Ctx) error {
	userID, ok := middleware.AuthenticatedUserID(c)
	if !ok {
		return fiber.NewError(fiber.StatusUnauthorized, "authentication required")
	}
	payload, err := decodeMap(c)
	if err != nil {
		return err
	}
	row := only(payload, "full_name", "phone", "avatar_url", "gender", "quiet_ride", "cool_temperature", "wav_required", "hearing_impaired", "gender_preference")
	row["user_id"] = userID
	if err := h.upsertProfile(c.Context(), row); err != nil {
		return err
	}
	return c.JSON(fiber.Map{"success": true})
}

func (h *Handler) UpdateMyProfileAvatar(c *fiber.Ctx) error {
	userID, ok := middleware.AuthenticatedUserID(c)
	if !ok {
		return fiber.NewError(fiber.StatusUnauthorized, "authentication required")
	}
	var in struct {
		AvatarURL string `json:"avatar_url"`
	}
	if err := c.BodyParser(&in); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "invalid request body")
	}
	if strings.TrimSpace(in.AvatarURL) == "" {
		return fiber.NewError(fiber.StatusBadRequest, "avatar_url is required")
	}
	if err := h.upsertProfile(c.Context(), map[string]any{"user_id": userID, "avatar_url": strings.TrimSpace(in.AvatarURL)}); err != nil {
		return err
	}
	return c.JSON(fiber.Map{"success": true})
}

func (h *Handler) UpsertUserSettings(c *fiber.Ctx) error {
	userID, ok := middleware.AuthenticatedUserID(c)
	if !ok {
		return fiber.NewError(fiber.StatusUnauthorized, "authentication required")
	}
	payload, err := decodeMap(c)
	if err != nil {
		return err
	}
	row := only(payload, "notifications_enabled", "promo_notifications", "ride_update_notifications")
	row["user_id"] = userID
	if err := h.upsertByConflict(c.Context(), "user_settings", row, "user_id"); err != nil {
		return err
	}
	return c.JSON(fiber.Map{"success": true})
}

func (h *Handler) UpdateRiderPreferences(c *fiber.Ctx) error {
	userID, ok := middleware.AuthenticatedUserID(c)
	if !ok {
		return fiber.NewError(fiber.StatusUnauthorized, "authentication required")
	}
	payload, err := decodeMap(c)
	if err != nil {
		return err
	}
	row := only(payload, "quiet_ride", "cool_temperature", "wav_required", "hearing_impaired", "gender_preference")
	row["user_id"] = userID
	if err := h.upsertProfile(c.Context(), row); err != nil {
		return err
	}
	return c.JSON(fiber.Map{"success": true})
}

func (h *Handler) CreateFavoriteLocation(c *fiber.Ctx) error {
	userID, ok := middleware.AuthenticatedUserID(c)
	if !ok {
		return fiber.NewError(fiber.StatusUnauthorized, "authentication required")
	}
	payload, err := decodeMap(c)
	if err != nil {
		return err
	}
	row := only(payload, "name", "address", "latitude", "longitude", "icon")
	row["user_id"] = userID
	if row["name"] == nil || row["address"] == nil || row["latitude"] == nil || row["longitude"] == nil {
		return fiber.NewError(fiber.StatusBadRequest, "name, address, latitude, and longitude are required")
	}
	if row["icon"] == nil {
		row["icon"] = "star"
	}
	id, err := h.insertReturningID(c.Context(), "favorite_locations", row)
	if err != nil {
		return err
	}
	row["id"] = id
	return c.JSON(row)
}

func (h *Handler) DeleteFavoriteLocation(c *fiber.Ctx) error {
	userID, ok := middleware.AuthenticatedUserID(c)
	if !ok {
		return fiber.NewError(fiber.StatusUnauthorized, "authentication required")
	}
	tag, err := h.db.Exec(c.Context(), `DELETE FROM public.favorite_locations WHERE id = $1 AND user_id = $2`, c.Params("id"), userID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return fiber.NewError(fiber.StatusNotFound, "favorite location not found")
	}
	return c.JSON(fiber.Map{"success": true, "deleted": tag.RowsAffected()})
}

func (h *Handler) CreateMessage(c *fiber.Ctx) error {
	userID, ok := middleware.AuthenticatedUserID(c)
	if !ok {
		return fiber.NewError(fiber.StatusUnauthorized, "authentication required")
	}
	payload, err := decodeMap(c)
	if err != nil {
		return err
	}
	rideID, _ := payload["ride_id"].(string)
	text := strings.TrimSpace(fmt.Sprint(payload["text"]))
	if rideID == "" || text == "" {
		return fiber.NewError(fiber.StatusBadRequest, "ride_id and text are required")
	}
	id, err := h.insertReturningID(c.Context(), "messages", map[string]any{
		"ride_id":   rideID,
		"sender_id": userID,
		"text":      text,
	})
	if err != nil {
		return err
	}
	return c.JSON(fiber.Map{"success": true, "id": id})
}

func (h *Handler) CreateCallSession(c *fiber.Ctx) error {
	userID, ok := middleware.AuthenticatedUserID(c)
	if !ok {
		return fiber.NewError(fiber.StatusUnauthorized, "authentication required")
	}
	payload, err := decodeMap(c)
	if err != nil {
		return err
	}
	row := only(payload, "ride_id", "callee_id", "status")
	row["caller_id"] = userID
	if row["ride_id"] == nil || row["callee_id"] == nil {
		return fiber.NewError(fiber.StatusBadRequest, "ride_id and callee_id are required")
	}
	if row["status"] == nil {
		row["status"] = "ringing"
	}
	id, err := h.insertReturningID(c.Context(), "call_sessions", row)
	if err != nil {
		return err
	}
	return c.JSON(fiber.Map{"success": true, "id": id})
}

func (h *Handler) UpdateCallSession(c *fiber.Ctx) error {
	userID, ok := middleware.AuthenticatedUserID(c)
	if !ok {
		return fiber.NewError(fiber.StatusUnauthorized, "authentication required")
	}
	payload, err := decodeMap(c)
	if err != nil {
		return err
	}
	changes := only(payload, "status", "ended_at")
	if len(changes) == 0 {
		return fiber.NewError(fiber.StatusBadRequest, "no call session changes provided")
	}
	tag, err := h.updateWhere(c.Context(), "call_sessions", changes, "id = $%d AND (caller_id = $%d OR callee_id = $%d)", c.Params("id"), userID, userID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return fiber.NewError(fiber.StatusNotFound, "call session not found")
	}
	return c.JSON(fiber.Map{"success": true, "updated": tag.RowsAffected()})
}

func (h *Handler) CreateFatigueBreak(c *fiber.Ctx) error {
	userID, ok := middleware.AuthenticatedUserID(c)
	if !ok {
		return fiber.NewError(fiber.StatusUnauthorized, "authentication required")
	}
	var in struct {
		WentOnlineAt     string `json:"went_online_at"`
		WentOfflineAt    string `json:"went_offline_at"`
		ForcedBreakUntil string `json:"forced_break_until"`
	}
	if err := c.BodyParser(&in); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "invalid request body")
	}
	if in.ForcedBreakUntil == "" {
		return fiber.NewError(fiber.StatusBadRequest, "forced_break_until is required")
	}
	row := map[string]any{
		"driver_id":          userID,
		"went_online_at":     defaultTimeString(in.WentOnlineAt),
		"went_offline_at":    defaultTimeString(in.WentOfflineAt),
		"forced_break_until": in.ForcedBreakUntil,
	}
	if err := h.insertOne(c.Context(), "driver_sessions", row); err != nil {
		return err
	}
	return c.JSON(fiber.Map{"success": true})
}

func (h *Handler) CachePlace(c *fiber.Ctx) error {
	payload, err := decodeMap(c)
	if err != nil {
		return err
	}
	row := only(payload, "name", "display_name", "lat", "lon", "osm_type", "osm_id", "class", "type", "address")
	if row["display_name"] == nil || row["lat"] == nil || row["lon"] == nil {
		return fiber.NewError(fiber.StatusBadRequest, "display_name, lat, and lon are required")
	}
	if err := h.insertOne(c.Context(), "places_cache", row); err != nil {
		return err
	}
	return c.JSON(fiber.Map{"success": true})
}

func (h *Handler) AdminCreateRamzAudit(c *fiber.Ctx) error {
	if err := h.requireAdmin(c); err != nil {
		return err
	}
	payload, err := decodeMap(c)
	if err != nil {
		return err
	}
	userID, _ := middleware.AuthenticatedUserID(c)
	row := only(payload, "admin_id", "file_path", "finding_title", "finding_severity", "finding_category", "finding_line", "ai_summary", "action", "verification_status", "verification_findings", "original_content", "patched_content")
	if row["admin_id"] == nil {
		row["admin_id"] = userID
	}
	id, err := h.insertReturningID(c.Context(), "ramz_patch_audit", row)
	if err != nil {
		return err
	}
	return c.JSON(fiber.Map{"success": true, "id": id})
}

func (h *Handler) AdminUpdateDispute(c *fiber.Ctx) error {
	if err := h.requireAdmin(c); err != nil {
		return err
	}
	payload, err := decodeMap(c)
	if err != nil {
		return err
	}
	changes := only(payload, "status", "admin_response", "resolved_at")
	if err := h.updateByID(c.Context(), "disputes", c.Params("id"), changes); err != nil {
		return err
	}
	return c.JSON(fiber.Map{"success": true})
}

func (h *Handler) AdminCreatePromo(c *fiber.Ctx) error {
	if err := h.requireAdmin(c); err != nil {
		return err
	}
	payload, err := decodeMap(c)
	if err != nil {
		return err
	}
	if err := h.insertOne(c.Context(), "promo_codes", payload); err != nil {
		return err
	}
	return c.JSON(fiber.Map{"success": true})
}

func (h *Handler) AdminUpdatePromo(c *fiber.Ctx) error {
	if err := h.requireAdmin(c); err != nil {
		return err
	}
	payload, err := decodeMap(c)
	if err != nil {
		return err
	}
	if err := h.updateByID(c.Context(), "promo_codes", c.Params("id"), payload); err != nil {
		return err
	}
	return c.JSON(fiber.Map{"success": true})
}

func (h *Handler) AdminDeletePromo(c *fiber.Ctx) error {
	if err := h.requireAdmin(c); err != nil {
		return err
	}
	if err := h.deleteByID(c.Context(), "promo_codes", c.Params("id")); err != nil {
		return err
	}
	return c.JSON(fiber.Map{"success": true})
}

func (h *Handler) AdminUpdateTownPricing(c *fiber.Ctx) error {
	if err := h.requireAdmin(c); err != nil {
		return err
	}
	payload, err := decodeMap(c)
	if err != nil {
		return err
	}
	if err := h.updateByID(c.Context(), "town_pricing", c.Params("id"), payload); err != nil {
		return err
	}
	return c.JSON(fiber.Map{"success": true})
}

func (h *Handler) AdminPurgeStaleLiveLocations(c *fiber.Ctx) error {
	if err := h.requireAdmin(c); err != nil {
		return err
	}
	var in struct {
		Cutoff string `json:"cutoff"`
	}
	if err := c.BodyParser(&in); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "invalid request body")
	}
	cutoff, err := time.Parse(time.RFC3339, in.Cutoff)
	if err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "cutoff must be RFC3339")
	}
	tag, err := h.db.Exec(c.Context(), `DELETE FROM public.live_locations WHERE updated_at < $1`, cutoff)
	if err != nil {
		return err
	}
	return c.JSON(fiber.Map{"success": true, "deleted": tag.RowsAffected()})
}

func (h *Handler) AdminForceOfflineGhostDrivers(c *fiber.Ctx) error {
	if err := h.requireAdmin(c); err != nil {
		return err
	}
	var in struct {
		Cutoff string `json:"cutoff"`
	}
	if err := c.BodyParser(&in); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "invalid request body")
	}
	cutoff, err := time.Parse(time.RFC3339, in.Cutoff)
	if err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "cutoff must be RFC3339")
	}
	tag, err := h.db.Exec(c.Context(), `
		UPDATE public.drivers d
		SET is_online = false, updated_at = now()
		WHERE d.status = 'approved'
		  AND d.is_online = true
		  AND NOT EXISTS (
			SELECT 1 FROM public.live_locations l
			WHERE l.user_id = d.user_id AND l.updated_at >= $1
		  )`, cutoff)
	if err != nil {
		return err
	}
	return c.JSON(fiber.Map{"success": true, "updated": tag.RowsAffected()})
}

func (h *Handler) AdminCancelStuckRides(c *fiber.Ctx) error {
	if err := h.requireAdmin(c); err != nil {
		return err
	}
	var in struct {
		Cutoff string `json:"cutoff"`
	}
	if err := c.BodyParser(&in); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "invalid request body")
	}
	cutoff, err := time.Parse(time.RFC3339, in.Cutoff)
	if err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "cutoff must be RFC3339")
	}
	tag, err := h.db.Exec(c.Context(), `
		UPDATE public.rides
		SET status = 'cancelled', ride_status = 'cancelled', updated_at = now()
		WHERE (status = 'accepted' OR ride_status = 'accepted') AND updated_at < $1`, cutoff)
	if err != nil {
		return err
	}
	return c.JSON(fiber.Map{"success": true, "updated": tag.RowsAffected()})
}

func (h *Handler) AdminForceFatigueBreak(c *fiber.Ctx) error {
	if err := h.requireAdmin(c); err != nil {
		return err
	}
	var in struct {
		Cutoff string `json:"cutoff"`
	}
	if err := c.BodyParser(&in); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "invalid request body")
	}
	cutoff, err := time.Parse(time.RFC3339, in.Cutoff)
	if err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "cutoff must be RFC3339")
	}
	tag, err := h.db.Exec(c.Context(), `
		WITH affected AS (
			UPDATE public.drivers
			SET is_online = false, updated_at = now()
			WHERE is_online = true AND last_online_at < $1
			RETURNING user_id
		)
		UPDATE public.driver_sessions ds
		SET is_online = false, availability = 'offline', updated_at = now()
		FROM affected a
		WHERE ds.driver_id = a.user_id`, cutoff)
	if err != nil {
		return err
	}
	return c.JSON(fiber.Map{"success": true, "updated": tag.RowsAffected()})
}

func (h *Handler) CanDriverOperate(c *fiber.Ctx) error {
	userID, ok := middleware.AuthenticatedUserID(c)
	if !ok {
		return fiber.NewError(fiber.StatusUnauthorized, "authentication required")
	}
	var canOperate bool
	if err := h.db.QueryRow(c.Context(), `SELECT public.can_driver_operate($1::uuid)`, userID).Scan(&canOperate); err != nil {
		return err
	}
	return c.JSON(fiber.Map{"can_operate": canOperate})
}

func (h *Handler) IsTopDriver(c *fiber.Ctx) error {
	userID, ok := middleware.AuthenticatedUserID(c)
	if !ok {
		return fiber.NewError(fiber.StatusUnauthorized, "authentication required")
	}
	var isTopDriver bool
	if err := h.db.QueryRow(c.Context(), `SELECT public.is_top_driver($1::uuid)`, userID).Scan(&isTopDriver); err != nil {
		return err
	}
	return c.JSON(fiber.Map{"is_top_driver": isTopDriver})
}

func (h *Handler) AdminExpireOldRides(c *fiber.Ctx) error {
	return h.runAdminCountOperation(c, "expire_old_rides", `SELECT public.expire_old_rides()`)
}

func (h *Handler) AdminAutoResolveNoiseFraudFlags(c *fiber.Ctx) error {
	return h.runAdminCountOperation(c, "auto_resolve_noise_fraud_flags", `SELECT public.auto_resolve_noise_fraud_flags()`)
}

func (h *Handler) AdminCleanupOldMessages(c *fiber.Ctx) error {
	return h.runAdminCountOperation(c, "cleanup_old_messages", `SELECT public.cleanup_old_messages()`)
}

func (h *Handler) AdminUpdateDemandZones(c *fiber.Ctx) error {
	if err := h.requireAdmin(c); err != nil {
		return err
	}
	if _, err := h.db.Exec(c.Context(), `SELECT public.update_demand_zones()`); err != nil {
		return err
	}
	h.logAdminOperation(c, "update_demand_zones", 0)
	return c.JSON(fiber.Map{"success": true})
}

func (h *Handler) runAdminCountOperation(c *fiber.Ctx, name string, query string) error {
	if err := h.requireAdmin(c); err != nil {
		return err
	}
	var count int64
	if err := h.db.QueryRow(c.Context(), query).Scan(&count); err != nil {
		return err
	}
	h.logAdminOperation(c, name, count)
	return c.JSON(fiber.Map{"success": true, "count": count})
}

func (h *Handler) AdminUpdateRow(c *fiber.Ctx) error {
	if err := h.requireAdmin(c); err != nil {
		return err
	}
	policy, ok := adminMutationPolicies[c.Params("table")]
	if !ok {
		return fiber.NewError(fiber.StatusBadRequest, "table is not writable through this endpoint")
	}
	if !policy.AllowUpdate {
		return fiber.NewError(fiber.StatusForbidden, "update is not allowed for this table")
	}
	payload, err := decodeMap(c)
	if err != nil {
		return err
	}
	changes := payload
	if nested, ok := payload["changes"].(map[string]any); ok {
		changes = nested
	}
	changes, err = policy.sanitize("update", changes)
	if err != nil {
		h.logAdminMutationDenied(c, "update", policy.Table, c.Params("id"), err)
		return err
	}
	if err := h.updateByID(c.Context(), policy.Table, c.Params("id"), changes); err != nil {
		return err
	}
	h.logAdminMutation(c, "update", policy.Table, c.Params("id"), sortedKeys(changes), 1)
	return c.JSON(fiber.Map{"success": true})
}

func (h *Handler) AdminInsertRow(c *fiber.Ctx) error {
	if err := h.requireAdmin(c); err != nil {
		return err
	}
	policy, ok := adminMutationPolicies[c.Params("table")]
	if !ok {
		return fiber.NewError(fiber.StatusBadRequest, "table is not writable through this endpoint")
	}
	if !policy.AllowInsert {
		return fiber.NewError(fiber.StatusForbidden, "insert is not allowed for this table")
	}
	payload, err := decodeMap(c)
	if err != nil {
		return err
	}
	if rows, ok := payload["rows"].([]any); ok {
		for _, item := range rows {
			row, ok := item.(map[string]any)
			if !ok {
				return fiber.NewError(fiber.StatusBadRequest, "rows must contain objects")
			}
			row, err = policy.sanitize("insert", row)
			if err != nil {
				h.logAdminMutationDenied(c, "insert", policy.Table, "", err)
				return err
			}
			if err := h.insertOne(c.Context(), policy.Table, row); err != nil {
				return err
			}
			h.logAdminMutation(c, "insert", policy.Table, "", sortedKeys(row), 1)
		}
		return c.JSON(fiber.Map{"success": true, "inserted": len(rows)})
	}
	payload, err = policy.sanitize("insert", payload)
	if err != nil {
		h.logAdminMutationDenied(c, "insert", policy.Table, "", err)
		return err
	}
	if err := h.insertOne(c.Context(), policy.Table, payload); err != nil {
		return err
	}
	h.logAdminMutation(c, "insert", policy.Table, "", sortedKeys(payload), 1)
	return c.JSON(fiber.Map{"success": true})
}

func (h *Handler) AdminDeleteRow(c *fiber.Ctx) error {
	if err := h.requireAdmin(c); err != nil {
		return err
	}
	policy, ok := adminMutationPolicies[c.Params("table")]
	if !ok {
		return fiber.NewError(fiber.StatusBadRequest, "table is not writable through this endpoint")
	}
	if !policy.AllowDelete {
		return fiber.NewError(fiber.StatusForbidden, "delete is not allowed for this table")
	}
	if err := h.deleteByID(c.Context(), policy.Table, c.Params("id")); err != nil {
		return err
	}
	h.logAdminMutation(c, "delete", policy.Table, c.Params("id"), nil, 1)
	return c.JSON(fiber.Map{"success": true})
}

func (h *Handler) requireAdmin(c *fiber.Ctx) error {
	var lookup middleware.AdminRoleLookup
	if h.db != nil {
		lookup = h.db
	}
	return middleware.RequireAdmin(c, lookup)
}

type adminMutationPolicy struct {
	Table        string
	AllowInsert  bool
	AllowUpdate  bool
	AllowDelete  bool
	InsertFields map[string]bool
	UpdateFields map[string]bool
}

func (p adminMutationPolicy) sanitize(action string, payload map[string]any) (map[string]any, error) {
	if len(payload) == 0 {
		return nil, fiber.NewError(fiber.StatusBadRequest, "no fields provided")
	}
	allowed := p.UpdateFields
	if action == "insert" {
		allowed = p.InsertFields
	}
	out := make(map[string]any, len(payload))
	for key, value := range payload {
		if !identPattern.MatchString(key) {
			return nil, fiber.NewError(fiber.StatusBadRequest, "invalid field name")
		}
		if !allowed[key] {
			return nil, fiber.NewError(fiber.StatusBadRequest, "field is not writable through this endpoint")
		}
		out[key] = value
	}
	return out, nil
}

var adminMutationPolicies = map[string]adminMutationPolicy{
	"drivers": {
		Table:       "drivers",
		AllowUpdate: true,
		UpdateFields: fieldSet("status", "availability", "is_online", "approved_at", "suspended_at", "rejection_reason",
			"admin_notes", "vehicle_type", "vehicle_make", "vehicle_model", "vehicle_year", "plate_number",
			"license_number", "updated_at"),
	},
	"driver_documents": {
		Table:        "driver_documents",
		AllowUpdate:  true,
		UpdateFields: fieldSet("status", "verified", "verified_at", "rejection_reason", "admin_notes", "updated_at"),
	},
	"student_profiles": {
		Table:        "student_profiles",
		AllowUpdate:  true,
		UpdateFields: fieldSet("status", "verification_status", "verified", "verified_at", "rejection_reason", "admin_notes", "updated_at"),
	},
	"system_error_logs": {
		Table:        "system_error_logs",
		AllowUpdate:  true,
		UpdateFields: fieldSet("resolved", "resolved_at", "status", "severity", "admin_notes", "updated_at"),
	},
	"promo_codes": {
		Table:       "promo_codes",
		AllowInsert: true,
		AllowUpdate: true,
		AllowDelete: true,
		InsertFields: fieldSet("code", "discount_type", "discount_value", "max_uses", "uses_count", "expires_at",
			"active", "is_active", "min_fare", "max_discount", "description", "created_by", "created_at", "updated_at"),
		UpdateFields: fieldSet("code", "discount_type", "discount_value", "max_uses", "uses_count", "expires_at",
			"active", "is_active", "min_fare", "max_discount", "description", "updated_at"),
	},
	"town_pricing": {
		Table:       "town_pricing",
		AllowInsert: true,
		AllowUpdate: true,
		AllowDelete: true,
		InsertFields: fieldSet("town_id", "base_fare", "per_km", "per_minute", "minimum_fare", "booking_fee",
			"surge_multiplier", "student_discount_percent", "active", "created_at", "updated_at"),
		UpdateFields: fieldSet("base_fare", "per_km", "per_minute", "minimum_fare", "booking_fee",
			"surge_multiplier", "student_discount_percent", "active", "updated_at"),
	},
	"pricing_settings": {
		Table:        "pricing_settings",
		AllowInsert:  true,
		AllowUpdate:  true,
		AllowDelete:  true,
		InsertFields: fieldSet("key", "value", "description", "active", "created_at", "updated_at"),
		UpdateFields: fieldSet("value", "description", "active", "updated_at"),
	},
	"disputes": {
		Table:        "disputes",
		AllowUpdate:  true,
		UpdateFields: fieldSet("status", "resolution", "admin_response", "resolved_at", "assigned_to", "updated_at"),
	},
	"rides": {
		Table:        "rides",
		AllowUpdate:  true,
		UpdateFields: fieldSet("ride_status", "status", "cancelled_at", "cancelled_by", "cancellation_fee", "admin_notes", "updated_at"),
	},
	"live_locations": {
		Table:        "live_locations",
		AllowUpdate:  true,
		UpdateFields: fieldSet("is_online", "availability", "updated_at"),
	},
	"driver_sessions": {
		Table:        "driver_sessions",
		AllowUpdate:  true,
		UpdateFields: fieldSet("availability", "is_online", "went_offline_at", "fatigue_break_until", "updated_at"),
	},
	"notifications": {
		Table:        "notifications",
		AllowUpdate:  true,
		UpdateFields: fieldSet("read", "read_at", "status", "updated_at"),
	},
	"koloi_landmarks": {
		Table:       "koloi_landmarks",
		AllowInsert: true,
		AllowUpdate: true,
		AllowDelete: true,
		InsertFields: fieldSet("name", "category", "description", "address", "latitude", "longitude", "town_id",
			"is_active", "metadata", "created_at", "updated_at"),
		UpdateFields: fieldSet("name", "category", "description", "address", "latitude", "longitude", "town_id",
			"is_active", "metadata", "updated_at"),
	},
}

func (h *Handler) AdminIngestSystemHealthLogs(c *fiber.Ctx) error {
	if err := h.requireAdmin(c); err != nil {
		return err
	}
	payload, err := decodeMap(c)
	if err != nil {
		return err
	}
	rows, ok := payload["rows"].([]any)
	if !ok {
		return fiber.NewError(fiber.StatusBadRequest, "rows are required")
	}
	cutoffRaw, _ := payload["today_start"].(string)
	cutoff, err := time.Parse(time.RFC3339, cutoffRaw)
	if err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "today_start must be RFC3339")
	}

	tx, err := h.db.BeginTx(c.Context(), pgx.TxOptions{})
	if err != nil {
		return err
	}
	defer tx.Rollback(c.Context())

	if _, err := tx.Exec(c.Context(), `
		UPDATE public.system_error_logs
		SET period = 'week', updated_at = now()
		WHERE period = 'today' AND created_at < $1`, cutoff); err != nil {
		return err
	}
	for _, item := range rows {
		row, ok := item.(map[string]any)
		if !ok {
			return fiber.NewError(fiber.StatusBadRequest, "rows must contain objects")
		}
		if err := h.insertOneTx(c.Context(), tx, "system_error_logs", row); err != nil {
			return err
		}
	}
	if err := tx.Commit(c.Context()); err != nil {
		return err
	}
	return c.JSON(fiber.Map{"success": true, "inserted": len(rows)})
}

func (h *Handler) AdminResolveSystemHealthLog(c *fiber.Ctx) error {
	if err := h.requireAdmin(c); err != nil {
		return err
	}
	if err := h.updateByID(c.Context(), "system_error_logs", c.Params("id"), map[string]any{
		"resolved":    true,
		"resolved_at": time.Now().UTC().Format(time.RFC3339),
	}); err != nil {
		return err
	}
	return c.JSON(fiber.Map{"success": true})
}

var identPattern = regexp.MustCompile(`^[a-zA-Z_][a-zA-Z0-9_]*$`)

func decodeMap(c *fiber.Ctx) (map[string]any, error) {
	var payload map[string]any
	if err := json.Unmarshal(c.Body(), &payload); err != nil {
		return nil, fiber.NewError(fiber.StatusBadRequest, "invalid request body")
	}
	return payload, nil
}

func only(payload map[string]any, keys ...string) map[string]any {
	out := make(map[string]any, len(keys))
	for _, key := range keys {
		if value, ok := payload[key]; ok {
			out[key] = value
		}
	}
	return out
}

func fieldSet(keys ...string) map[string]bool {
	out := make(map[string]bool, len(keys))
	for _, key := range keys {
		out[key] = true
	}
	return out
}

func (h *Handler) logAdminMutation(c *fiber.Ctx, action string, table string, rowID string, fields []string, affected int64) {
	userID, _ := middleware.AuthenticatedUserID(c)
	log.Printf("SECURITY_ADMIN_MUTATION user_id=%s action=%s table=%s row_id=%s fields=%s affected=%d timestamp=%s",
		userID,
		action,
		table,
		rowID,
		strings.Join(fields, ","),
		affected,
		time.Now().UTC().Format(time.RFC3339),
	)
}

func (h *Handler) logAdminMutationDenied(c *fiber.Ctx, action string, table string, rowID string, err error) {
	userID, _ := middleware.AuthenticatedUserID(c)
	log.Printf("SECURITY_ADMIN_MUTATION_DENIED user_id=%s action=%s table=%s row_id=%s reason=%s timestamp=%s",
		userID,
		action,
		table,
		rowID,
		err.Error(),
		time.Now().UTC().Format(time.RFC3339),
	)
}

func (h *Handler) logAdminOperation(c *fiber.Ctx, operation string, affected int64) {
	userID, _ := middleware.AuthenticatedUserID(c)
	log.Printf("SECURITY_ADMIN_OPERATION user_id=%s operation=%s affected=%d timestamp=%s",
		userID,
		operation,
		affected,
		time.Now().UTC().Format(time.RFC3339),
	)
}

func (h *Handler) insertOne(ctx context.Context, table string, payload map[string]any) error {
	return h.insertOneExec(ctx, h.db, table, payload)
}

func (h *Handler) insertReturningID(ctx context.Context, table string, payload map[string]any) (string, error) {
	if len(payload) == 0 {
		return "", fiber.NewError(fiber.StatusBadRequest, "no fields provided")
	}
	keys := sortedKeys(payload)
	cols := make([]string, 0, len(keys))
	holders := make([]string, 0, len(keys))
	args := make([]any, 0, len(keys))
	for i, key := range keys {
		if !identPattern.MatchString(key) {
			return "", fiber.NewError(fiber.StatusBadRequest, "invalid field name")
		}
		cols = append(cols, key)
		holders = append(holders, fmt.Sprintf("$%d", i+1))
		args = append(args, payload[key])
	}
	var id string
	query := fmt.Sprintf("INSERT INTO public.%s (%s) VALUES (%s) RETURNING id", table, strings.Join(cols, ", "), strings.Join(holders, ", "))
	observability.RecordPostgresQuery("business_insert_returning")
	if err := h.db.QueryRow(ctx, query, args...).Scan(&id); err != nil {
		observability.RecordPostgresFailure("business_insert_returning")
		observability.CaptureError(err)
		return "", err
	}
	return id, nil
}

type execer interface {
	Exec(context.Context, string, ...any) (pgconn.CommandTag, error)
}

func (h *Handler) insertOneTx(ctx context.Context, tx pgx.Tx, table string, payload map[string]any) error {
	return h.insertOneExec(ctx, tx, table, payload)
}

func (h *Handler) insertOneExec(ctx context.Context, exec execer, table string, payload map[string]any) error {
	if len(payload) == 0 {
		return fiber.NewError(fiber.StatusBadRequest, "no fields provided")
	}
	keys := sortedKeys(payload)
	cols := make([]string, 0, len(keys))
	holders := make([]string, 0, len(keys))
	args := make([]any, 0, len(keys))
	for i, key := range keys {
		if !identPattern.MatchString(key) {
			return fiber.NewError(fiber.StatusBadRequest, "invalid field name")
		}
		cols = append(cols, key)
		holders = append(holders, fmt.Sprintf("$%d", i+1))
		args = append(args, payload[key])
	}
	query := fmt.Sprintf("INSERT INTO public.%s (%s) VALUES (%s)", table, strings.Join(cols, ", "), strings.Join(holders, ", "))
	observability.RecordPostgresQuery("business_insert")
	_, err := exec.Exec(ctx, query, args...)
	if err != nil {
		observability.RecordPostgresFailure("business_insert")
		observability.CaptureError(err)
	}
	return err
}

func (h *Handler) updateByID(ctx context.Context, table string, id string, payload map[string]any) error {
	if len(payload) == 0 {
		return fiber.NewError(fiber.StatusBadRequest, "no fields provided")
	}
	keys := sortedKeys(payload)
	sets := make([]string, 0, len(keys))
	args := make([]any, 0, len(keys)+1)
	for i, key := range keys {
		if !identPattern.MatchString(key) {
			return fiber.NewError(fiber.StatusBadRequest, "invalid field name")
		}
		sets = append(sets, fmt.Sprintf("%s = $%d", key, i+1))
		args = append(args, payload[key])
	}
	args = append(args, id)
	query := fmt.Sprintf("UPDATE public.%s SET %s WHERE id = $%d", table, strings.Join(sets, ", "), len(args))
	observability.RecordPostgresQuery("business_update_by_id")
	tag, err := h.db.Exec(ctx, query, args...)
	if err != nil {
		observability.RecordPostgresFailure("business_update_by_id")
		observability.CaptureError(err)
		return err
	}
	if tag.RowsAffected() == 0 {
		return fiber.NewError(fiber.StatusNotFound, "row not found")
	}
	return nil
}

func (h *Handler) updateWhere(ctx context.Context, table string, payload map[string]any, whereFormat string, whereArgs ...any) (pgconn.CommandTag, error) {
	if len(payload) == 0 {
		return pgconn.CommandTag{}, fiber.NewError(fiber.StatusBadRequest, "no fields provided")
	}
	keys := sortedKeys(payload)
	sets := make([]string, 0, len(keys))
	args := make([]any, 0, len(keys)+len(whereArgs))
	for i, key := range keys {
		if !identPattern.MatchString(key) {
			return pgconn.CommandTag{}, fiber.NewError(fiber.StatusBadRequest, "invalid field name")
		}
		sets = append(sets, fmt.Sprintf("%s = $%d", key, i+1))
		args = append(args, payload[key])
	}
	wherePlaceholders := make([]any, len(whereArgs))
	for i, arg := range whereArgs {
		wherePlaceholders[i] = len(args) + i + 1
		args = append(args, arg)
	}
	query := fmt.Sprintf("UPDATE public.%s SET %s WHERE %s", table, strings.Join(sets, ", "), fmt.Sprintf(whereFormat, wherePlaceholders...))
	observability.RecordPostgresQuery("business_update_where")
	tag, err := h.db.Exec(ctx, query, args...)
	if err != nil {
		observability.RecordPostgresFailure("business_update_where")
		observability.CaptureError(err)
	}
	return tag, err
}

func (h *Handler) upsertProfile(ctx context.Context, payload map[string]any) error {
	tx, err := h.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if err := h.upsertProfileTx(ctx, tx, payload); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (h *Handler) upsertProfileTx(ctx context.Context, tx pgx.Tx, payload map[string]any) error {
	return h.upsertByConflictExec(ctx, tx, "profiles", payload, "user_id")
}

func (h *Handler) upsertByConflict(ctx context.Context, table string, payload map[string]any, conflictColumn string) error {
	return h.upsertByConflictExec(ctx, h.db, table, payload, conflictColumn)
}

func (h *Handler) upsertByConflictExec(ctx context.Context, exec execer, table string, payload map[string]any, conflictColumn string) error {
	if len(payload) == 0 {
		return fiber.NewError(fiber.StatusBadRequest, "no fields provided")
	}
	if !identPattern.MatchString(conflictColumn) {
		return fiber.NewError(fiber.StatusBadRequest, "invalid conflict field")
	}
	keys := sortedKeys(payload)
	cols := make([]string, 0, len(keys))
	holders := make([]string, 0, len(keys))
	updates := make([]string, 0, len(keys))
	args := make([]any, 0, len(keys))
	for i, key := range keys {
		if !identPattern.MatchString(key) {
			return fiber.NewError(fiber.StatusBadRequest, "invalid field name")
		}
		cols = append(cols, key)
		holders = append(holders, fmt.Sprintf("$%d", i+1))
		args = append(args, payload[key])
		if key != conflictColumn {
			updates = append(updates, fmt.Sprintf("%s = EXCLUDED.%s", key, key))
		}
	}
	if len(updates) == 0 {
		updates = append(updates, fmt.Sprintf("%s = EXCLUDED.%s", conflictColumn, conflictColumn))
	}
	query := fmt.Sprintf("INSERT INTO public.%s (%s) VALUES (%s) ON CONFLICT (%s) DO UPDATE SET %s", table, strings.Join(cols, ", "), strings.Join(holders, ", "), conflictColumn, strings.Join(updates, ", "))
	observability.RecordPostgresQuery("business_upsert")
	_, err := exec.Exec(ctx, query, args...)
	if err != nil {
		observability.RecordPostgresFailure("business_upsert")
		observability.CaptureError(err)
	}
	return err
}

func (h *Handler) upsertDriverTx(ctx context.Context, tx pgx.Tx, userID string, payload map[string]any) (string, error) {
	if len(payload) == 0 {
		return "", fiber.NewError(fiber.StatusBadRequest, "no fields provided")
	}
	keys := sortedKeys(payload)
	cols := make([]string, 0, len(keys))
	holders := make([]string, 0, len(keys))
	updates := make([]string, 0, len(keys))
	args := make([]any, 0, len(keys))
	for i, key := range keys {
		if !identPattern.MatchString(key) {
			return "", fiber.NewError(fiber.StatusBadRequest, "invalid field name")
		}
		cols = append(cols, key)
		holders = append(holders, fmt.Sprintf("$%d", i+1))
		args = append(args, payload[key])
		if key != "user_id" {
			updates = append(updates, fmt.Sprintf("%s = EXCLUDED.%s", key, key))
		}
	}
	var id string
	query := fmt.Sprintf("INSERT INTO public.drivers (%s) VALUES (%s) ON CONFLICT (user_id) DO UPDATE SET %s RETURNING id", strings.Join(cols, ", "), strings.Join(holders, ", "), strings.Join(updates, ", "))
	observability.RecordPostgresQuery("business_upsert_driver")
	if err := tx.QueryRow(ctx, query, args...).Scan(&id); err != nil {
		observability.RecordPostgresFailure("business_upsert_driver")
		var existingID string
		observability.RecordPostgresQuery("business_select_driver")
		if fallbackErr := tx.QueryRow(ctx, `SELECT id FROM public.drivers WHERE user_id = $1`, userID).Scan(&existingID); fallbackErr != nil {
			observability.RecordPostgresFailure("business_select_driver")
			observability.CaptureError(err)
			return "", err
		}
		if _, updateErr := h.updateWhereTx(ctx, tx, "drivers", withoutKey(payload, "user_id"), "user_id = $%d", userID); updateErr != nil {
			return "", updateErr
		}
		return existingID, nil
	}
	return id, nil
}

func (h *Handler) updateWhereTx(ctx context.Context, tx pgx.Tx, table string, payload map[string]any, whereFormat string, whereArgs ...any) (pgconn.CommandTag, error) {
	if len(payload) == 0 {
		return pgconn.CommandTag{}, nil
	}
	keys := sortedKeys(payload)
	sets := make([]string, 0, len(keys))
	args := make([]any, 0, len(keys)+len(whereArgs))
	for i, key := range keys {
		if !identPattern.MatchString(key) {
			return pgconn.CommandTag{}, fiber.NewError(fiber.StatusBadRequest, "invalid field name")
		}
		sets = append(sets, fmt.Sprintf("%s = $%d", key, i+1))
		args = append(args, payload[key])
	}
	wherePlaceholders := make([]any, len(whereArgs))
	for i, arg := range whereArgs {
		wherePlaceholders[i] = len(args) + i + 1
		args = append(args, arg)
	}
	query := fmt.Sprintf("UPDATE public.%s SET %s WHERE %s", table, strings.Join(sets, ", "), fmt.Sprintf(whereFormat, wherePlaceholders...))
	observability.RecordPostgresQuery("business_update_where_tx")
	tag, err := tx.Exec(ctx, query, args...)
	if err != nil {
		observability.RecordPostgresFailure("business_update_where_tx")
		observability.CaptureError(err)
	}
	return tag, err
}

func (h *Handler) deleteByID(ctx context.Context, table string, id string) error {
	observability.RecordPostgresQuery("business_delete_by_id")
	tag, err := h.db.Exec(ctx, fmt.Sprintf("DELETE FROM public.%s WHERE id = $1", table), id)
	if err != nil {
		observability.RecordPostgresFailure("business_delete_by_id")
		observability.CaptureError(err)
		return err
	}
	if tag.RowsAffected() == 0 {
		return fiber.NewError(fiber.StatusNotFound, "row not found")
	}
	return nil
}

func withoutKey(payload map[string]any, key string) map[string]any {
	out := make(map[string]any, len(payload))
	for k, v := range payload {
		if k != key {
			out[k] = v
		}
	}
	return out
}

func defaultTimeString(value string) string {
	if strings.TrimSpace(value) != "" {
		return value
	}
	return time.Now().UTC().Format(time.RFC3339)
}

func sortedKeys(payload map[string]any) []string {
	keys := make([]string, 0, len(payload))
	for key := range payload {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}
