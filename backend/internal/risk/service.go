package risk

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strings"
	"time"

	"github.com/hibiken/asynq"

	"pickme-backend/internal/jobs"
	"pickme-backend/internal/observability"
)

type CounterStore interface {
	IncrWithTTL(ctx context.Context, key string, ttl time.Duration) (int64, error)
}

type JobClient interface {
	Enqueue(ctx context.Context, taskType string, queue string, payload jobs.Payload) (*asynq.TaskInfo, error)
}

type Service struct {
	repo       Repository
	redis      CounterStore
	jobs       JobClient
	counterTTL time.Duration
}

func NewService(repo Repository, redis CounterStore, jobClient JobClient) *Service {
	return &Service{repo: repo, redis: redis, jobs: jobClient, counterTTL: 15 * time.Minute}
}

func (s *Service) RecordEvent(ctx context.Context, event Event) (Decision, error) {
	if event.UserID == "" || event.Area == "" || event.EventType == "" {
		return Decision{}, errors.New("user_id, area, and event_type are required")
	}
	if event.Metadata == nil {
		event.Metadata = map[string]any{}
	}
	stored, err := s.repo.CreateEvent(ctx, event)
	if err != nil {
		return Decision{}, err
	}
	riskEventsTotal.WithLabelValues(string(event.Area), event.EventType).Inc()
	if err := s.repo.UpsertDeviceFingerprint(ctx, event.UserID, event.DeviceFingerprint, event.Phone, event.Metadata); err != nil {
		observability.CaptureError(err)
	}

	counterWeight, err := s.recordCounters(ctx, event)
	if err != nil {
		observability.CaptureError(err)
	}
	score, err := s.recalculateFromEvent(ctx, stored, counterWeight)
	if err != nil {
		observability.CaptureError(err)
		return Decision{}, err
	}
	s.enqueueScans(ctx, stored)
	action := ActionAllow
	if score.RiskLevel == LevelBlocked {
		action = ActionBlock
	}
	return Decision{Action: action, Score: score}, nil
}

func (s *Service) GetScore(ctx context.Context, userID string) (Score, error) {
	return s.repo.GetScore(ctx, userID)
}

func (s *Service) ListUsers(ctx context.Context, limit int) ([]UserSummary, error) {
	return s.repo.ListUsers(ctx, limit)
}

func (s *Service) UserDetail(ctx context.Context, userID string) (UserDetail, error) {
	return s.repo.UserDetail(ctx, userID)
}

func (s *Service) AdminAction(ctx context.Context, action RecordedAction) (RecordedAction, error) {
	current, err := s.repo.GetScore(ctx, action.UserID)
	if err != nil {
		return RecordedAction{}, err
	}
	next := current
	switch action.Action {
	case ActionBlock:
		next.RiskLevel = LevelBlocked
		next.RiskScore = max(next.RiskScore, 95)
		next.FraudScore = max(next.FraudScore, 95)
		next.TrustScore = min(next.TrustScore, 5)
	case ActionReview:
		next.RiskLevel = maxLevel(next.RiskLevel, LevelMedium)
		next.RiskScore = max(next.RiskScore, 50)
	case ActionRequireVerification:
		next.RiskLevel = maxLevel(next.RiskLevel, LevelMedium)
		next.RiskScore = max(next.RiskScore, 60)
	case ActionRateLimit:
		next.RiskLevel = maxLevel(next.RiskLevel, LevelHigh)
		next.RiskScore = max(next.RiskScore, 80)
	case ActionAllow:
		next.RiskLevel = LevelLow
		next.RiskScore = min(next.RiskScore, 20)
		next.FraudScore = min(next.FraudScore, 20)
		next.TrustScore = max(next.TrustScore, 80)
	default:
		return RecordedAction{}, fmt.Errorf("unsupported risk action %s", action.Action)
	}
	riskActionsTotal.WithLabelValues(string(action.Action)).Inc()
	return s.repo.CreateAction(ctx, action, next)
}

func (s *Service) Stats(ctx context.Context) (Stats, error) {
	return s.repo.Stats(ctx)
}

func (s *Service) ProcessScan(taskType string) asynq.HandlerFunc {
	return func(ctx context.Context, task *asynq.Task) error {
		var payload jobs.Payload
		if len(task.Payload()) > 0 {
			if err := json.Unmarshal(task.Payload(), &payload); err != nil {
				fraudScanFailuresTotal.WithLabelValues(taskType).Inc()
				observability.CaptureError(err)
				return err
			}
		}
		if payload.UserID == "" {
			err := errors.New("risk scan missing user_id")
			fraudScanFailuresTotal.WithLabelValues(taskType).Inc()
			observability.CaptureError(err)
			return err
		}
		if _, err := s.recalculateUser(ctx, payload.UserID); err != nil {
			fraudScanFailuresTotal.WithLabelValues(taskType).Inc()
			observability.CaptureError(err)
			return err
		}
		return nil
	}
}

func (s *Service) recalculateFromEvent(ctx context.Context, event Event, counterWeight int) (Score, error) {
	current, err := s.repo.GetScore(ctx, event.UserID)
	if err != nil {
		return Score{}, err
	}
	if current.RiskLevel == LevelBlocked {
		return current, nil
	}
	delta := eventWeight(event) + counterWeight
	current.RiskScore = clamp(current.RiskScore+delta, 0, 100)
	current.FraudScore = clamp(current.FraudScore+delta, 0, 100)
	current.TrustScore = clamp(100-current.RiskScore, 0, 100)
	current.RiskLevel = levelForScore(current.RiskScore)
	return s.repo.UpsertScore(ctx, current)
}

func (s *Service) recalculateUser(ctx context.Context, userID string) (Score, error) {
	current, err := s.repo.GetScore(ctx, userID)
	if err != nil {
		return Score{}, err
	}
	if current.RiskLevel == LevelBlocked {
		return current, nil
	}
	current.TrustScore = clamp(100-current.RiskScore, 0, 100)
	current.FraudScore = current.RiskScore
	current.RiskLevel = levelForScore(current.RiskScore)
	return s.repo.UpsertScore(ctx, current)
}

func (s *Service) recordCounters(ctx context.Context, event Event) (int, error) {
	if s.redis == nil {
		return 0, nil
	}
	counterName := counterForEvent(event)
	if counterName == "" {
		return 0, nil
	}
	key := fmt.Sprintf("risk:%s:%s", counterName, event.UserID)
	if counterName == "device_accounts_count" && event.DeviceFingerprint != "" {
		key = fmt.Sprintf("risk:%s:%s", counterName, event.DeviceFingerprint)
	}
	if counterName == "phone_accounts_count" && event.Phone != "" {
		key = fmt.Sprintf("risk:%s:%s", counterName, event.Phone)
	}
	value, err := s.redis.IncrWithTTL(ctx, key, s.counterTTL)
	if err != nil {
		return 0, err
	}
	switch {
	case value >= 20:
		return 20, nil
	case value >= 10:
		return 10, nil
	case value >= 5:
		return 5, nil
	default:
		return 0, nil
	}
}

func (s *Service) enqueueScans(ctx context.Context, event Event) {
	if s.jobs == nil {
		return
	}
	payload := jobs.Payload{UserID: event.UserID, ID: event.ID, Metadata: map[string]any{"area": string(event.Area), "event_type": event.EventType}}
	_, _ = s.jobs.Enqueue(ctx, jobs.TypeFraudScan, jobs.QueueLow, payload)
	_, _ = s.jobs.Enqueue(ctx, jobs.TypeRiskRecalculateUser, jobs.QueueDefault, payload)
	switch event.Area {
	case AreaMultiAccountAbuse:
		_, _ = s.jobs.Enqueue(ctx, jobs.TypeRiskMultiAccount, jobs.QueueDefault, payload)
	case AreaWalletAbuse, AreaPaymentAbuse:
		_, _ = s.jobs.Enqueue(ctx, jobs.TypeRiskWalletAbuse, jobs.QueueDefault, payload)
	case AreaStudentAbuse:
		_, _ = s.jobs.Enqueue(ctx, jobs.TypeRiskStudentAbuse, jobs.QueueDefault, payload)
	case AreaGPSSpoofing:
		_, _ = s.jobs.Enqueue(ctx, jobs.TypeRiskGPSSpoofing, jobs.QueueDefault, payload)
	}
}

func counterForEvent(event Event) string {
	eventType := strings.ToLower(event.EventType)
	switch {
	case event.Area == AreaFakeRideCreation || eventType == "ride_request":
		return "ride_requests_per_user"
	case event.Area == AreaWalletAbuse || eventType == "wallet_transfer":
		return "wallet_transfers_per_user"
	case eventType == "failed_login":
		return "failed_login_attempts"
	case event.Area == AreaMultiAccountAbuse && event.DeviceFingerprint != "":
		return "device_accounts_count"
	case event.Area == AreaMultiAccountAbuse && event.Phone != "":
		return "phone_accounts_count"
	case event.Area == AreaGPSSpoofing || eventType == "suspicious_location_jump":
		return "suspicious_location_jumps"
	default:
		return ""
	}
}

func eventWeight(event Event) int {
	weight := 5
	switch event.Area {
	case AreaWalletAbuse, AreaPaymentAbuse, AreaEmergencyAbuse:
		weight = 15
	case AreaGPSSpoofing, AreaMultiAccountAbuse, AreaStudentAbuse:
		weight = 12
	case AreaFakeRideCreation, AreaReferralAbuse:
		weight = 10
	}
	switch strings.ToLower(event.Severity) {
	case "critical":
		weight += 30
	case "high":
		weight += 20
	case "medium":
		weight += 10
	case "low":
		weight += 2
	}
	return weight
}

func levelForScore(score int) Level {
	switch {
	case score >= 85:
		return LevelHigh
	case score >= 50:
		return LevelMedium
	default:
		return LevelLow
	}
}

func maxLevel(current Level, proposed Level) Level {
	order := map[Level]int{LevelLow: 1, LevelMedium: 2, LevelHigh: 3, LevelBlocked: 4}
	if order[proposed] > order[current] {
		return proposed
	}
	return current
}

func clamp(value, lo, hi int) int {
	return int(math.Max(float64(lo), math.Min(float64(hi), float64(value))))
}

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
