package risk

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Repository interface {
	CreateEvent(ctx context.Context, event Event) (Event, error)
	GetScore(ctx context.Context, userID string) (Score, error)
	UpsertScore(ctx context.Context, score Score) (Score, error)
	ListUsers(ctx context.Context, limit int) ([]UserSummary, error)
	UserDetail(ctx context.Context, userID string) (UserDetail, error)
	CreateAction(ctx context.Context, action RecordedAction, score Score) (RecordedAction, error)
	Stats(ctx context.Context) (Stats, error)
	UpsertDeviceFingerprint(ctx context.Context, userID, fingerprint, phone string, metadata map[string]any) error
}

type PostgresRepository struct {
	db *pgxpool.Pool
}

func NewPostgresRepository(db *pgxpool.Pool) *PostgresRepository {
	return &PostgresRepository{db: db}
}

func (r *PostgresRepository) CreateEvent(ctx context.Context, event Event) (Event, error) {
	raw, err := json.Marshal(event.Metadata)
	if err != nil {
		return Event{}, err
	}
	err = r.db.QueryRow(ctx, `
		INSERT INTO public.risk_events (
			user_id, actor_type, area, event_type, severity, device_fingerprint,
			phone, ip_address, latitude, longitude, metadata
		)
		VALUES ($1,$2,$3,$4,$5,NULLIF($6,''),NULLIF($7,''),NULLIF($8,''),$9,$10,$11)
		RETURNING id::text, created_at
	`, event.UserID, event.ActorType, event.Area, event.EventType, event.Severity, event.DeviceFingerprint, event.Phone, event.IPAddress, event.Latitude, event.Longitude, raw).Scan(&event.ID, &event.CreatedAt)
	return event, err
}

func (r *PostgresRepository) GetScore(ctx context.Context, userID string) (Score, error) {
	score := defaultScore(userID)
	err := r.db.QueryRow(ctx, `
		SELECT user_id::text, risk_score, trust_score, fraud_score, risk_level, updated_at
		FROM public.risk_scores
		WHERE user_id = $1
	`, userID).Scan(&score.UserID, &score.RiskScore, &score.TrustScore, &score.FraudScore, &score.RiskLevel, &score.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return score, nil
	}
	return score, err
}

func (r *PostgresRepository) UpsertScore(ctx context.Context, score Score) (Score, error) {
	err := r.db.QueryRow(ctx, `
		INSERT INTO public.risk_scores (user_id, risk_score, trust_score, fraud_score, risk_level, updated_at)
		VALUES ($1,$2,$3,$4,$5,now())
		ON CONFLICT (user_id)
		DO UPDATE SET
			risk_score = EXCLUDED.risk_score,
			trust_score = EXCLUDED.trust_score,
			fraud_score = EXCLUDED.fraud_score,
			risk_level = CASE WHEN public.risk_scores.risk_level = 'blocked' THEN 'blocked' ELSE EXCLUDED.risk_level END,
			updated_at = now()
		RETURNING user_id::text, risk_score, trust_score, fraud_score, risk_level, updated_at
	`, score.UserID, score.RiskScore, score.TrustScore, score.FraudScore, score.RiskLevel).Scan(
		&score.UserID, &score.RiskScore, &score.TrustScore, &score.FraudScore, &score.RiskLevel, &score.UpdatedAt,
	)
	return score, err
}

func (r *PostgresRepository) ListUsers(ctx context.Context, limit int) ([]UserSummary, error) {
	if limit <= 0 || limit > 200 {
		limit = 100
	}
	rows, err := r.db.Query(ctx, `
		SELECT user_id::text, risk_score, trust_score, fraud_score, risk_level, updated_at
		FROM public.risk_scores
		ORDER BY risk_score DESC, updated_at DESC
		LIMIT $1
	`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var users []UserSummary
	for rows.Next() {
		var user UserSummary
		if err := rows.Scan(&user.UserID, &user.RiskScore, &user.TrustScore, &user.FraudScore, &user.RiskLevel, &user.UpdatedAt); err != nil {
			return nil, err
		}
		users = append(users, user)
	}
	return users, rows.Err()
}

func (r *PostgresRepository) UserDetail(ctx context.Context, userID string) (UserDetail, error) {
	score, err := r.GetScore(ctx, userID)
	if err != nil {
		return UserDetail{}, err
	}
	detail := UserDetail{Score: score}
	events, err := r.db.Query(ctx, `
		SELECT id::text, user_id::text, COALESCE(actor_type,''), area, event_type, COALESCE(severity,''),
		       COALESCE(device_fingerprint,''), COALESCE(phone,''), COALESCE(ip_address,''), latitude, longitude, metadata, created_at
		FROM public.risk_events
		WHERE user_id = $1
		ORDER BY created_at DESC
		LIMIT 100
	`, userID)
	if err != nil {
		return detail, err
	}
	for events.Next() {
		var event Event
		var raw []byte
		if err := events.Scan(&event.ID, &event.UserID, &event.ActorType, &event.Area, &event.EventType, &event.Severity, &event.DeviceFingerprint, &event.Phone, &event.IPAddress, &event.Latitude, &event.Longitude, &raw, &event.CreatedAt); err != nil {
			events.Close()
			return detail, err
		}
		_ = json.Unmarshal(raw, &event.Metadata)
		detail.Events = append(detail.Events, event)
	}
	events.Close()
	if err := events.Err(); err != nil {
		return detail, err
	}

	actions, err := r.db.Query(ctx, `
		SELECT id::text, user_id::text, admin_id::text, action, COALESCE(reason,''), metadata, created_at
		FROM public.risk_actions
		WHERE user_id = $1
		ORDER BY created_at DESC
		LIMIT 50
	`, userID)
	if err != nil {
		return detail, err
	}
	defer actions.Close()
	for actions.Next() {
		var action RecordedAction
		var raw []byte
		if err := actions.Scan(&action.ID, &action.UserID, &action.AdminID, &action.Action, &action.Reason, &raw, &action.CreatedAt); err != nil {
			return detail, err
		}
		_ = json.Unmarshal(raw, &action.Metadata)
		detail.Actions = append(detail.Actions, action)
	}
	return detail, actions.Err()
}

func (r *PostgresRepository) CreateAction(ctx context.Context, action RecordedAction, score Score) (RecordedAction, error) {
	raw, err := json.Marshal(action.Metadata)
	if err != nil {
		return RecordedAction{}, err
	}
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return RecordedAction{}, err
	}
	defer tx.Rollback(ctx)
	err = tx.QueryRow(ctx, `
		INSERT INTO public.risk_actions (user_id, admin_id, action, reason, metadata)
		VALUES ($1,$2,$3,NULLIF($4,''),$5)
		RETURNING id::text, created_at
	`, action.UserID, action.AdminID, action.Action, action.Reason, raw).Scan(&action.ID, &action.CreatedAt)
	if err != nil {
		return RecordedAction{}, err
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO public.risk_scores (user_id, risk_score, trust_score, fraud_score, risk_level, updated_at)
		VALUES ($1,$2,$3,$4,$5,now())
		ON CONFLICT (user_id)
		DO UPDATE SET risk_score=$2, trust_score=$3, fraud_score=$4, risk_level=$5, updated_at=now()
	`, score.UserID, score.RiskScore, score.TrustScore, score.FraudScore, score.RiskLevel); err != nil {
		return RecordedAction{}, err
	}
	return action, tx.Commit(ctx)
}

func (r *PostgresRepository) Stats(ctx context.Context) (Stats, error) {
	var stats Stats
	if err := r.db.QueryRow(ctx, `SELECT COUNT(*) FROM public.risk_events`).Scan(&stats.EventsTotal); err != nil {
		return stats, err
	}
	if err := r.db.QueryRow(ctx, `SELECT COUNT(*) FROM public.risk_scores WHERE risk_level IN ('high','blocked')`).Scan(&stats.HighUsersTotal); err != nil {
		return stats, err
	}
	riskHighUsersTotal.Set(float64(stats.HighUsersTotal))
	if err := r.db.QueryRow(ctx, `SELECT COUNT(*) FROM public.risk_scores WHERE risk_level = 'blocked'`).Scan(&stats.BlockedTotal); err != nil {
		return stats, err
	}
	rows, err := r.db.Query(ctx, `SELECT area, COUNT(*) FROM public.risk_events GROUP BY area ORDER BY area`)
	if err != nil {
		return stats, err
	}
	for rows.Next() {
		var item AreaStat
		if err := rows.Scan(&item.Area, &item.Count); err != nil {
			rows.Close()
			return stats, err
		}
		stats.ByArea = append(stats.ByArea, item)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return stats, err
	}
	levels, err := r.db.Query(ctx, `SELECT risk_level, COUNT(*) FROM public.risk_scores GROUP BY risk_level ORDER BY risk_level`)
	if err != nil {
		return stats, err
	}
	for levels.Next() {
		var item LevelStat
		if err := levels.Scan(&item.Level, &item.Count); err != nil {
			levels.Close()
			return stats, err
		}
		stats.ByLevel = append(stats.ByLevel, item)
	}
	levels.Close()
	if err := levels.Err(); err != nil {
		return stats, err
	}
	actions, err := r.db.Query(ctx, `
		SELECT id::text, user_id::text, admin_id::text, action, COALESCE(reason,''), metadata, created_at
		FROM public.risk_actions
		ORDER BY created_at DESC
		LIMIT 20
	`)
	if err != nil {
		return stats, err
	}
	defer actions.Close()
	for actions.Next() {
		var action RecordedAction
		var raw []byte
		if err := actions.Scan(&action.ID, &action.UserID, &action.AdminID, &action.Action, &action.Reason, &raw, &action.CreatedAt); err != nil {
			return stats, err
		}
		_ = json.Unmarshal(raw, &action.Metadata)
		stats.RecentActions = append(stats.RecentActions, action)
	}
	return stats, actions.Err()
}

func (r *PostgresRepository) UpsertDeviceFingerprint(ctx context.Context, userID, fingerprint, phone string, metadata map[string]any) error {
	if fingerprint == "" {
		return nil
	}
	raw, err := json.Marshal(metadata)
	if err != nil {
		return err
	}
	_, err = r.db.Exec(ctx, `
		INSERT INTO public.risk_device_fingerprints (device_fingerprint, user_id, phone, metadata, first_seen, last_seen)
		VALUES ($1,$2,NULLIF($3,''),$4,now(),now())
		ON CONFLICT (device_fingerprint, user_id)
		DO UPDATE SET phone = COALESCE(NULLIF($3,''), public.risk_device_fingerprints.phone), metadata = $4, last_seen = now()
	`, fingerprint, userID, phone, raw)
	return err
}

func defaultScore(userID string) Score {
	return Score{UserID: userID, RiskScore: 0, TrustScore: 100, FraudScore: 0, RiskLevel: LevelLow}
}
