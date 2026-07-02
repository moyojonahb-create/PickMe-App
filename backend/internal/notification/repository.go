package notification

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Repository interface {
	UpsertDevice(ctx context.Context, device Device) (Device, error)
	UpsertPreferences(ctx context.Context, pref Preference) (Preference, error)
	GetPreferences(ctx context.Context, userID string) (Preference, error)
	ListDevices(ctx context.Context, userID string) ([]Device, error)
	CreateHistory(ctx context.Context, item NotificationHistory, metadata map[string]any) (string, error)
	UpdateHistory(ctx context.Context, id string, status string, provider string, providerID string, errMessage string) error
	Stats(ctx context.Context) (Stats, error)
}

type PostgresRepository struct {
	db *pgxpool.Pool
}

func NewPostgresRepository(db *pgxpool.Pool) *PostgresRepository {
	return &PostgresRepository{db: db}
}

func (r *PostgresRepository) UpsertDevice(ctx context.Context, device Device) (Device, error) {
	var lastSeen time.Time
	err := r.db.QueryRow(ctx, `
		INSERT INTO public.notification_devices (user_id, platform, device_token, last_seen, app_version)
		VALUES ($1, $2, $3, now(), NULLIF($4, ''))
		ON CONFLICT (device_token)
		DO UPDATE SET
			user_id = EXCLUDED.user_id,
			platform = EXCLUDED.platform,
			last_seen = now(),
			app_version = EXCLUDED.app_version
		RETURNING id::text, last_seen
	`, device.UserID, device.Platform, device.DeviceToken, device.AppVersion).Scan(&device.ID, &lastSeen)
	device.LastSeen = lastSeen.Format(time.RFC3339)
	return device, err
}

func (r *PostgresRepository) UpsertPreferences(ctx context.Context, pref Preference) (Preference, error) {
	err := r.db.QueryRow(ctx, `
		INSERT INTO public.notification_preferences (user_id, push, sms, email, marketing, transactional, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, now())
		ON CONFLICT (user_id)
		DO UPDATE SET
			push = EXCLUDED.push,
			sms = EXCLUDED.sms,
			email = EXCLUDED.email,
			marketing = EXCLUDED.marketing,
			transactional = EXCLUDED.transactional,
			updated_at = now()
		RETURNING user_id::text, push, sms, email, marketing, transactional
	`, pref.UserID, pref.Push, pref.SMS, pref.Email, pref.Marketing, pref.Transactional).Scan(
		&pref.UserID, &pref.Push, &pref.SMS, &pref.Email, &pref.Marketing, &pref.Transactional,
	)
	return pref, err
}

func (r *PostgresRepository) GetPreferences(ctx context.Context, userID string) (Preference, error) {
	pref := defaultPreference(userID)
	err := r.db.QueryRow(ctx, `
		SELECT user_id::text, push, sms, email, marketing, transactional
		FROM public.notification_preferences
		WHERE user_id = $1
	`, userID).Scan(&pref.UserID, &pref.Push, &pref.SMS, &pref.Email, &pref.Marketing, &pref.Transactional)
	if errors.Is(err, pgx.ErrNoRows) {
		return pref, nil
	}
	return pref, err
}

func (r *PostgresRepository) ListDevices(ctx context.Context, userID string) ([]Device, error) {
	rows, err := r.db.Query(ctx, `
		SELECT id::text, user_id::text, platform, device_token, last_seen, COALESCE(app_version, '')
		FROM public.notification_devices
		WHERE user_id = $1 AND revoked_at IS NULL
		ORDER BY last_seen DESC
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var devices []Device
	for rows.Next() {
		var d Device
		var lastSeen time.Time
		if err := rows.Scan(&d.ID, &d.UserID, &d.Platform, &d.DeviceToken, &lastSeen, &d.AppVersion); err != nil {
			return nil, err
		}
		d.LastSeen = lastSeen.Format(time.RFC3339)
		devices = append(devices, d)
	}
	return devices, rows.Err()
}

func (r *PostgresRepository) CreateHistory(ctx context.Context, item NotificationHistory, metadata map[string]any) (string, error) {
	rawMetadata, err := json.Marshal(metadata)
	if err != nil {
		return "", err
	}
	rideID, _ := metadata["ride_id"].(string)
	var id string
	err = r.db.QueryRow(ctx, `
		INSERT INTO public.notification_history (
			user_id, type, channel, title, body, status, provider, provider_id,
			error_message, ride_id, metadata, created_at
		)
		VALUES ($1,$2,$3,$4,$5,$6,NULLIF($7,''),NULLIF($8,''),NULLIF($9,''),NULLIF($10,'')::uuid,$11,now())
		RETURNING id::text
	`, item.UserID, item.Type, item.Channel, item.Title, item.Body, item.Status, item.Provider, item.ProviderID, item.ErrorMessage, rideID, rawMetadata).Scan(&id)
	return id, err
}

func (r *PostgresRepository) UpdateHistory(ctx context.Context, id string, status string, provider string, providerID string, errMessage string) error {
	_, err := r.db.Exec(ctx, `
		UPDATE public.notification_history
		SET status = $2,
		    provider = COALESCE(NULLIF($3, ''), provider),
		    provider_id = COALESCE(NULLIF($4, ''), provider_id),
		    error_message = NULLIF($5, ''),
		    sent_at = CASE WHEN $2 = 'sent' THEN now() ELSE sent_at END,
		    delivered_at = CASE WHEN $2 = 'delivered' THEN now() ELSE delivered_at END,
		    updated_at = now()
		WHERE id = $1
	`, id, status, provider, providerID, errMessage)
	return err
}

func (r *PostgresRepository) Stats(ctx context.Context) (Stats, error) {
	stats := Stats{}
	err := r.db.QueryRow(ctx, `
		SELECT
			COUNT(*) FILTER (WHERE status IN ('sent','delivered')),
			COUNT(*) FILTER (WHERE status = 'failed'),
			COUNT(*) FILTER (WHERE status = 'queued'),
			COUNT(*) FILTER (WHERE status = 'skipped')
		FROM public.notification_history
	`).Scan(&stats.SentTotal, &stats.FailedTotal, &stats.QueuedTotal, &stats.SkippedTotal)
	if err != nil {
		return stats, err
	}
	if err := r.db.QueryRow(ctx, `SELECT COUNT(*) FROM public.notification_devices WHERE revoked_at IS NULL`).Scan(&stats.RegisteredDevices); err != nil {
		return stats, err
	}

	rows, err := r.db.Query(ctx, `
		SELECT channel, status, COUNT(*)
		FROM public.notification_history
		GROUP BY channel, status
		ORDER BY channel, status
	`)
	if err != nil {
		return stats, err
	}
	for rows.Next() {
		var stat ChannelStat
		if err := rows.Scan(&stat.Channel, &stat.Status, &stat.Count); err != nil {
			rows.Close()
			return stats, err
		}
		stats.ByChannelStatus = append(stats.ByChannelStatus, stat)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return stats, err
	}

	failures, err := r.db.Query(ctx, `
		SELECT id::text, user_id::text, type, channel, COALESCE(error_message, ''), created_at
		FROM public.notification_history
		WHERE status = 'failed'
		ORDER BY created_at DESC
		LIMIT 20
	`)
	if err != nil {
		return stats, err
	}
	defer failures.Close()
	for failures.Next() {
		var failure HistoryFailure
		var createdAt time.Time
		if err := failures.Scan(&failure.ID, &failure.UserID, &failure.Type, &failure.Channel, &failure.ErrorMessage, &createdAt); err != nil {
			return stats, err
		}
		failure.CreatedAt = createdAt.Format(time.RFC3339)
		stats.RecentFailures = append(stats.RecentFailures, failure)
	}
	return stats, failures.Err()
}

func defaultPreference(userID string) Preference {
	return Preference{
		UserID:        userID,
		Push:          true,
		SMS:           true,
		Email:         true,
		Marketing:     false,
		Transactional: true,
	}
}
