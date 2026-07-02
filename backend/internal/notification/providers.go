package notification

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

type DeliveryRequest struct {
	HistoryID    string           `json:"history_id"`
	UserID       string           `json:"user_id"`
	Type         NotificationType `json:"type"`
	Channel      ChannelType      `json:"channel"`
	Title        string           `json:"title"`
	Body         string           `json:"body"`
	DeviceTokens []string         `json:"device_tokens,omitempty"`
	Data         map[string]any   `json:"data,omitempty"`
}

type DeliveryResult struct {
	Provider   string
	ProviderID string
}

type Provider interface {
	Send(ctx context.Context, req DeliveryRequest) (DeliveryResult, error)
}

type Providers struct {
	Push  Provider
	SMS   Provider
	Email Provider
}

type HTTPProviderConfig struct {
	Name     string
	Endpoint string
	Token    string
}

type HTTPProvider struct {
	name     string
	endpoint string
	token    string
	client   *http.Client
}

func NewHTTPProvider(cfg HTTPProviderConfig) *HTTPProvider {
	return &HTTPProvider{
		name:     cfg.Name,
		endpoint: cfg.Endpoint,
		token:    cfg.Token,
		client:   &http.Client{Timeout: 10 * time.Second},
	}
}

func (p *HTTPProvider) Send(ctx context.Context, req DeliveryRequest) (DeliveryResult, error) {
	if p == nil {
		return DeliveryResult{}, fmt.Errorf("notification provider is nil")
	}
	if p.endpoint == "" {
		return DeliveryResult{Provider: p.name, ProviderID: "noop:" + req.HistoryID}, nil
	}
	raw, err := json.Marshal(req)
	if err != nil {
		return DeliveryResult{}, err
	}
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, p.endpoint, bytes.NewReader(raw))
	if err != nil {
		return DeliveryResult{}, err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	if p.token != "" {
		httpReq.Header.Set("Authorization", "Bearer "+p.token)
	}
	resp, err := p.client.Do(httpReq)
	if err != nil {
		return DeliveryResult{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return DeliveryResult{}, fmt.Errorf("%s provider returned status %d", p.name, resp.StatusCode)
	}
	return DeliveryResult{Provider: p.name, ProviderID: resp.Header.Get("X-Provider-Message-ID")}, nil
}
