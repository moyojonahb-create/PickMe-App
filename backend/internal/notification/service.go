package notification

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/hibiken/asynq"

	"pickme-backend/internal/jobs"
	"pickme-backend/internal/observability"
)

type JobClient interface {
	Enqueue(ctx context.Context, taskType string, queue string, payload jobs.Payload) (*asynq.TaskInfo, error)
}

type ServiceConfig struct {
	RateLimitPerMinute int
}

type Service struct {
	repo      Repository
	jobs      JobClient
	providers Providers
	limit     int
	mu        sync.Mutex
	windows   map[string]rateWindow
}

type rateWindow struct {
	resetAt time.Time
	count   int
}

func NewService(repo Repository, jobClient JobClient, providers Providers, cfg ServiceConfig) *Service {
	limit := cfg.RateLimitPerMinute
	if limit <= 0 {
		limit = 60
	}
	return &Service{
		repo:      repo,
		jobs:      jobClient,
		providers: providers,
		limit:     limit,
		windows:   make(map[string]rateWindow),
	}
}

func (s *Service) RegisterDevice(ctx context.Context, device Device) (Device, error) {
	if device.UserID == "" || device.Platform == "" || device.DeviceToken == "" {
		return Device{}, errors.New("user_id, platform, and device_token are required")
	}
	return s.repo.UpsertDevice(ctx, device)
}

func (s *Service) SavePreferences(ctx context.Context, pref Preference) (Preference, error) {
	if pref.UserID == "" {
		return Preference{}, errors.New("user_id is required")
	}
	return s.repo.UpsertPreferences(ctx, pref)
}

func (s *Service) Notify(ctx context.Context, payload NotificationPayload) error {
	if payload.UserID == "" || payload.Type == "" {
		return errors.New("user_id and type are required")
	}
	if payload.Title == "" || payload.Body == "" {
		template := RenderTemplate(payload.Type, templateDataFromPayload(payload))
		if payload.Title == "" {
			payload.Title = template.Title
		}
		if payload.Body == "" {
			payload.Body = template.Body
		}
	}
	if len(payload.Channels) == 0 {
		payload.Channels = []ChannelType{ChannelPush}
	}

	pref, err := s.repo.GetPreferences(ctx, payload.UserID)
	if err != nil {
		return err
	}

	for _, channel := range payload.Channels {
		if !isDeliveryChannel(channel) || !s.allowed(pref, channel, payload) {
			continue
		}
		if !s.allowRate(payload.UserID, payload.Type, channel) {
			if err := s.recordSkipped(ctx, payload, channel, "rate_limited"); err != nil {
				return err
			}
			continue
		}
		if err := s.enqueueChannel(ctx, payload, channel); err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) BulkNotify(ctx context.Context, payloads []NotificationPayload) error {
	for _, payload := range payloads {
		if err := s.Notify(ctx, payload); err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) ProcessJob(_ string) asynq.HandlerFunc {
	return func(ctx context.Context, task *asynq.Task) error {
		var payload jobs.Payload
		if err := json.Unmarshal(task.Payload(), &payload); err != nil {
			return err
		}
		notificationType := NotificationType(stringMeta(payload.Metadata, "type"))
		channel := ChannelType(stringMeta(payload.Metadata, "channel"))
		if retried, _ := asynq.GetRetryCount(ctx); retried > 0 {
			recordRetry(notificationType, channel)
		}
		return s.Deliver(ctx, payload)
	}
}

func (s *Service) Deliver(ctx context.Context, payload jobs.Payload) error {
	start := time.Now()
	req := DeliveryRequest{
		HistoryID: payload.ID,
		UserID:    payload.UserID,
		Type:      NotificationType(stringMeta(payload.Metadata, "type")),
		Channel:   ChannelType(stringMeta(payload.Metadata, "channel")),
		Title:     stringMeta(payload.Metadata, "title"),
		Body:      stringMeta(payload.Metadata, "body"),
		Data:      mapMeta(payload.Metadata, "data"),
	}
	if req.HistoryID == "" || req.UserID == "" || req.Type == "" || req.Channel == "" {
		return errors.New("notification job is missing required metadata")
	}

	provider, err := s.providerFor(req.Channel)
	if err != nil {
		_ = s.repo.UpdateHistory(ctx, req.HistoryID, "failed", "", "", err.Error())
		recordFailure(req.Type, req.Channel, start)
		observability.CaptureError(err)
		return err
	}
	if req.Channel == ChannelPush {
		devices, err := s.repo.ListDevices(ctx, req.UserID)
		if err != nil {
			_ = s.repo.UpdateHistory(ctx, req.HistoryID, "failed", "", "", err.Error())
			recordFailure(req.Type, req.Channel, start)
			observability.CaptureError(err)
			return err
		}
		for _, device := range devices {
			req.DeviceTokens = append(req.DeviceTokens, device.DeviceToken)
		}
		if len(req.DeviceTokens) == 0 {
			_ = s.repo.UpdateHistory(ctx, req.HistoryID, "skipped", "", "", "no registered device")
			return nil
		}
	}

	result, err := provider.Send(ctx, req)
	if err != nil {
		_ = s.repo.UpdateHistory(ctx, req.HistoryID, "failed", result.Provider, result.ProviderID, err.Error())
		recordFailure(req.Type, req.Channel, start)
		observability.CaptureError(err)
		return err
	}
	if err := s.repo.UpdateHistory(ctx, req.HistoryID, "sent", result.Provider, result.ProviderID, ""); err != nil {
		return err
	}
	recordSent(req.Type, req.Channel, start)
	return nil
}

func (s *Service) Stats(ctx context.Context) (Stats, error) {
	return s.repo.Stats(ctx)
}

func (s *Service) enqueueChannel(ctx context.Context, payload NotificationPayload, channel ChannelType) error {
	historyID, err := s.repo.CreateHistory(ctx, NotificationHistory{
		UserID:  payload.UserID,
		Type:    payload.Type,
		Channel: channel,
		Title:   payload.Title,
		Body:    payload.Body,
		Status:  "queued",
	}, payloadMetadata(payload, channel))
	if err != nil {
		return err
	}

	jobPayload := jobs.Payload{
		ID:       historyID,
		UserID:   payload.UserID,
		RideID:   payload.RideID,
		DriverID: payload.DriverID,
		WalletID: payload.WalletID,
		Metadata: payloadMetadata(payload, channel),
	}
	if s.jobs == nil {
		return s.Deliver(ctx, jobPayload)
	}
	taskType := taskTypeForChannel(channel)
	_, err = s.jobs.Enqueue(ctx, taskType, queueForPayload(payload), jobPayload)
	if err != nil {
		_ = s.repo.UpdateHistory(ctx, historyID, "failed", "", "", err.Error())
		observability.CaptureError(err)
		return err
	}
	return nil
}

func (s *Service) recordSkipped(ctx context.Context, payload NotificationPayload, channel ChannelType, reason string) error {
	_, err := s.repo.CreateHistory(ctx, NotificationHistory{
		UserID:       payload.UserID,
		Type:         payload.Type,
		Channel:      channel,
		Title:        payload.Title,
		Body:         payload.Body,
		Status:       "skipped",
		ErrorMessage: reason,
	}, payloadMetadata(payload, channel))
	return err
}

func (s *Service) allowed(pref Preference, channel ChannelType, payload NotificationPayload) bool {
	marketing := boolMeta(payload.Metadata, "marketing")
	if marketing && !pref.Marketing {
		return false
	}
	if !marketing && !pref.Transactional {
		return false
	}
	switch channel {
	case ChannelPush:
		return pref.Push
	case ChannelSMS:
		return pref.SMS
	case ChannelEmail:
		return pref.Email
	default:
		return false
	}
}

func (s *Service) allowRate(userID string, notificationType NotificationType, channel ChannelType) bool {
	key := fmt.Sprintf("%s:%s:%s", userID, notificationType, channel)
	now := time.Now()
	s.mu.Lock()
	defer s.mu.Unlock()
	window := s.windows[key]
	if window.resetAt.IsZero() || now.After(window.resetAt) {
		window = rateWindow{resetAt: now.Add(time.Minute)}
	}
	if window.count >= s.limit {
		s.windows[key] = window
		return false
	}
	window.count++
	s.windows[key] = window
	return true
}

func (s *Service) providerFor(channel ChannelType) (Provider, error) {
	switch channel {
	case ChannelPush:
		return s.providers.Push, nil
	case ChannelSMS:
		return s.providers.SMS, nil
	case ChannelEmail:
		return s.providers.Email, nil
	default:
		return nil, fmt.Errorf("unsupported notification channel %s", channel)
	}
}

func isDeliveryChannel(channel ChannelType) bool {
	return channel == ChannelPush || channel == ChannelSMS || channel == ChannelEmail
}

func taskTypeForChannel(channel ChannelType) string {
	switch channel {
	case ChannelPush:
		return jobs.TypePushNotification
	case ChannelSMS:
		return jobs.TypeSMSNotification
	case ChannelEmail:
		return jobs.TypeEmailNotification
	default:
		return jobs.TypePushNotification
	}
}

func queueForPayload(payload NotificationPayload) string {
	if payload.Type == NotificationTypeEmergencyAlert {
		return jobs.QueueCritical
	}
	if payload.Priority == "low" {
		return jobs.QueueLow
	}
	return jobs.QueueDefault
}

func payloadMetadata(payload NotificationPayload, channel ChannelType) map[string]any {
	metadata := make(map[string]any, len(payload.Metadata)+8)
	for k, v := range payload.Metadata {
		metadata[k] = v
	}
	metadata["type"] = string(payload.Type)
	metadata["channel"] = string(channel)
	metadata["title"] = payload.Title
	metadata["body"] = payload.Body
	if payload.RideID != "" {
		metadata["ride_id"] = payload.RideID
	}
	if payload.Data != nil {
		metadata["data"] = payload.Data
	}
	return metadata
}

func templateDataFromPayload(payload NotificationPayload) TemplateData {
	return TemplateData{
		RideID:     payload.RideID,
		DriverName: stringMeta(payload.Metadata, "driver_name"),
		Pickup:     stringMeta(payload.Metadata, "pickup"),
		Dropoff:    stringMeta(payload.Metadata, "dropoff"),
		Amount:     payload.Amount,
		Currency:   payload.Currency,
		Message:    stringMeta(payload.Metadata, "message"),
	}
}

func stringMeta(metadata map[string]any, key string) string {
	if metadata == nil {
		return ""
	}
	value, _ := metadata[key].(string)
	return value
}

func boolMeta(metadata map[string]any, key string) bool {
	if metadata == nil {
		return false
	}
	value, _ := metadata[key].(bool)
	return value
}

func mapMeta(metadata map[string]any, key string) map[string]any {
	if metadata == nil {
		return nil
	}
	value, _ := metadata[key].(map[string]any)
	return value
}
