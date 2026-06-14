package payments

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"sync"
	"time"

	"github.com/google/uuid"

	"pickme-backend/internal/wallet"
)

const (
	ProviderCard = wallet.ProviderCard

	CardStatusPending    = "pending"
	CardStatusAuthorized = "authorized"
	CardStatusCaptured   = "captured"
	CardStatusVoided     = "voided"
	CardStatusRefunded   = "refunded"
	CardStatusFailed     = "failed"
)

type CardProcessor interface {
	CreatePaymentIntent(ctx context.Context, req CardPaymentIntentRequest) (CardPaymentIntent, error)
	Authorize(ctx context.Context, req CardAuthorizationRequest) (CardAuthorization, error)
	Capture(ctx context.Context, req CardCaptureRequest) (CardCapture, error)
	Void(ctx context.Context, req CardVoidRequest) (CardVoid, error)
	Refund(ctx context.Context, req CardRefundRequest) (CardRefund, error)
	GetTransactionStatus(ctx context.Context, processorReference string) (CardTransactionStatus, error)
	GetProcessorName() string
}

type CardPaymentIntentRequest struct {
	UserID         string
	AmountMinor    int64
	Currency       string
	IdempotencyKey string
}

type CardPaymentIntent struct {
	ID                 string    `json:"id"`
	UserID             string    `json:"user_id"`
	Processor          string    `json:"processor"`
	ProcessorReference string    `json:"processor_reference"`
	AmountMinor        int64     `json:"amount_minor"`
	Currency           string    `json:"currency"`
	Status             string    `json:"status"`
	ExpiresAt          time.Time `json:"expires_at"`
	IdempotencyKey     string    `json:"idempotency_key"`
}

type CardAuthorizationRequest struct {
	ProcessorReference string
	AmountMinor        int64
	Currency           string
	IdempotencyKey     string
}

type CardAuthorization struct {
	AuthorizationID    string
	ProcessorReference string
	AmountMinor        int64
	Currency           string
	Status             string
	IdempotencyKey     string
	ProcessorEventID   string
	ProcessorEventHash string
}

type CardCaptureRequest struct {
	ProcessorReference string
	AmountMinor        int64
	Currency           string
	IdempotencyKey     string
}

type CardCapture struct {
	CaptureID          string
	ProcessorReference string
	AmountMinor        int64
	Currency           string
	Status             string
	IdempotencyKey     string
	ProcessorEventID   string
	ProcessorEventHash string
}

type CardVoidRequest struct {
	ProcessorReference string
	IdempotencyKey     string
}

type CardVoid struct {
	VoidID             string
	ProcessorReference string
	Status             string
	IdempotencyKey     string
}

type CardRefundRequest struct {
	ProcessorReference string
	AmountMinor        int64
	Currency           string
	IdempotencyKey     string
}

type CardRefund struct {
	RefundID           string
	ProcessorReference string
	AmountMinor        int64
	Currency           string
	Status             string
	IdempotencyKey     string
}

type CardTransactionStatus struct {
	ProcessorReference string
	Status             string
}

type MockCardProcessor struct {
	mu       sync.Mutex
	intents  map[string]CardPaymentIntent
	auths    map[string]CardAuthorization
	captures map[string]CardCapture
	voids    map[string]CardVoid
	refunds  map[string]CardRefund
	now      func() time.Time
}

func NewMockCardProcessor() *MockCardProcessor {
	return &MockCardProcessor{
		intents:  map[string]CardPaymentIntent{},
		auths:    map[string]CardAuthorization{},
		captures: map[string]CardCapture{},
		voids:    map[string]CardVoid{},
		refunds:  map[string]CardRefund{},
		now:      time.Now,
	}
}

func (p *MockCardProcessor) GetProcessorName() string {
	return "mock_card"
}

func (p *MockCardProcessor) CreatePaymentIntent(ctx context.Context, req CardPaymentIntentRequest) (CardPaymentIntent, error) {
	if req.UserID == "" || req.AmountMinor <= 0 {
		return CardPaymentIntent{}, wallet.ErrInvalidLedgerEntry
	}
	if req.Currency == "" {
		req.Currency = wallet.CurrencyUSD
	}
	if err := wallet.ValidateCurrency(req.Currency); err != nil {
		return CardPaymentIntent{}, err
	}
	if err := wallet.ValidateIdempotencyKey(req.IdempotencyKey); err != nil {
		return CardPaymentIntent{}, err
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	if existing, ok := p.intents[req.IdempotencyKey]; ok {
		return existing, nil
	}
	intent := CardPaymentIntent{
		ID:                 uuid.NewString(),
		UserID:             req.UserID,
		Processor:          p.GetProcessorName(),
		ProcessorReference: "CARD-" + uuid.NewString(),
		AmountMinor:        req.AmountMinor,
		Currency:           req.Currency,
		Status:             CardStatusPending,
		ExpiresAt:          p.now().Add(30 * time.Minute),
		IdempotencyKey:     req.IdempotencyKey,
	}
	p.intents[req.IdempotencyKey] = intent
	return intent, nil
}

func (p *MockCardProcessor) Authorize(ctx context.Context, req CardAuthorizationRequest) (CardAuthorization, error) {
	if req.ProcessorReference == "" || req.AmountMinor <= 0 {
		return CardAuthorization{}, ErrInvalidProviderCallback
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	if existing, ok := p.auths[req.IdempotencyKey]; ok {
		return existing, nil
	}
	auth := CardAuthorization{
		AuthorizationID:    "AUTH-" + uuid.NewString(),
		ProcessorReference: req.ProcessorReference,
		AmountMinor:        req.AmountMinor,
		Currency:           req.Currency,
		Status:             CardStatusAuthorized,
		IdempotencyKey:     req.IdempotencyKey,
		ProcessorEventID:   "card-auth-" + uuid.NewString(),
	}
	auth.ProcessorEventHash = cardEventHash(auth.ProcessorEventID, auth.ProcessorReference, auth.AmountMinor, auth.Currency, auth.Status)
	p.auths[req.IdempotencyKey] = auth
	return auth, nil
}

func (p *MockCardProcessor) Capture(ctx context.Context, req CardCaptureRequest) (CardCapture, error) {
	if req.ProcessorReference == "" || req.AmountMinor <= 0 {
		return CardCapture{}, ErrInvalidProviderCallback
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	if existing, ok := p.captures[req.IdempotencyKey]; ok {
		return existing, nil
	}
	for _, capture := range p.captures {
		if capture.ProcessorReference == req.ProcessorReference {
			return capture, nil
		}
	}
	capture := CardCapture{
		CaptureID:          "CAP-" + uuid.NewString(),
		ProcessorReference: req.ProcessorReference,
		AmountMinor:        req.AmountMinor,
		Currency:           req.Currency,
		Status:             CardStatusCaptured,
		IdempotencyKey:     req.IdempotencyKey,
		ProcessorEventID:   "card-capture-" + uuid.NewString(),
	}
	capture.ProcessorEventHash = cardEventHash(capture.ProcessorEventID, capture.ProcessorReference, capture.AmountMinor, capture.Currency, capture.Status)
	p.captures[req.IdempotencyKey] = capture
	return capture, nil
}

func (p *MockCardProcessor) Void(ctx context.Context, req CardVoidRequest) (CardVoid, error) {
	if req.ProcessorReference == "" {
		return CardVoid{}, ErrInvalidProviderCallback
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	if existing, ok := p.voids[req.IdempotencyKey]; ok {
		return existing, nil
	}
	void := CardVoid{VoidID: "VOID-" + uuid.NewString(), ProcessorReference: req.ProcessorReference, Status: CardStatusVoided, IdempotencyKey: req.IdempotencyKey}
	p.voids[req.IdempotencyKey] = void
	return void, nil
}

func (p *MockCardProcessor) Refund(ctx context.Context, req CardRefundRequest) (CardRefund, error) {
	if req.ProcessorReference == "" || req.AmountMinor <= 0 {
		return CardRefund{}, ErrInvalidProviderCallback
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	if existing, ok := p.refunds[req.IdempotencyKey]; ok {
		return existing, nil
	}
	refund := CardRefund{RefundID: "REF-" + uuid.NewString(), ProcessorReference: req.ProcessorReference, AmountMinor: req.AmountMinor, Currency: req.Currency, Status: CardStatusRefunded, IdempotencyKey: req.IdempotencyKey}
	p.refunds[req.IdempotencyKey] = refund
	return refund, nil
}

func (p *MockCardProcessor) GetTransactionStatus(ctx context.Context, processorReference string) (CardTransactionStatus, error) {
	if processorReference == "" {
		return CardTransactionStatus{}, ErrInvalidProviderCallback
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	status := CardStatusPending
	for _, capture := range p.captures {
		if capture.ProcessorReference == processorReference {
			status = capture.Status
		}
	}
	for _, void := range p.voids {
		if void.ProcessorReference == processorReference {
			status = void.Status
		}
	}
	for _, refund := range p.refunds {
		if refund.ProcessorReference == processorReference {
			status = refund.Status
		}
	}
	return CardTransactionStatus{ProcessorReference: processorReference, Status: status}, nil
}

func cardEventHash(eventID string, reference string, amountMinor int64, currency string, status string) string {
	sum := sha256.Sum256([]byte(fmt.Sprintf("%s|%s|%s|%s|%s", eventID, reference, wallet.MinorDecimalString(amountMinor, currency), currency, status)))
	return hex.EncodeToString(sum[:])
}
