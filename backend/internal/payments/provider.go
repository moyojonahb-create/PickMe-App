package payments

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"

	"pickme-backend/internal/wallet"
)

const (
	ProviderOneMoney = wallet.ProviderOneMoney
	ProviderEcoCash  = wallet.ProviderEcoCash
	ProviderInnbucks = wallet.ProviderInnbucks
	ProviderPayPal   = wallet.ProviderPayPal

	CallbackStatusPaid   = "paid"
	CallbackStatusFailed = "failed"

	CallbackEventDepositCompleted = "deposit.completed"
	CallbackEventPaymentCompleted = "payment.completed"

	ProviderStatusSuccess   = "SUCCESS"
	ProviderStatusCompleted = "COMPLETED"
	ProviderStatusSettled   = "SETTLED"
)

var (
	ErrPaymentsDisabled        = errors.New("payments provider framework is disabled")
	ErrProviderDisabled        = errors.New("payment provider is disabled")
	ErrInvalidProviderCallback = errors.New("invalid provider callback")
)

const providerCallbackReplayWindow = 10 * time.Minute

var hexSignaturePattern = regexp.MustCompile(`\A[0-9a-fA-F]{64}\z`)

type Provider interface {
	CreateDepositIntent(ctx context.Context, req DepositIntentRequest) (DepositIntent, error)
	VerifyCallback(ctx context.Context, callback ProviderCallback) (VerifiedCallback, error)
	GetTransactionStatus(ctx context.Context, providerReference string) (ProviderTransactionStatus, error)
	CreateWithdrawal(ctx context.Context, req WithdrawalRequest) (WithdrawalResult, error)
	GetProviderName() string
}

type DepositIntentRequest struct {
	UserID         string
	AmountMinor    int64
	Currency       string
	City           string
	IdempotencyKey string
}

type DepositIntent struct {
	ID                string    `json:"id"`
	UserID            string    `json:"user_id"`
	Provider          string    `json:"provider"`
	ProviderReference string    `json:"provider_reference"`
	AmountMinor       int64     `json:"amount_minor"`
	Currency          string    `json:"currency"`
	Status            string    `json:"status"`
	ExpiresAt         time.Time `json:"expires_at"`
	IdempotencyKey    string    `json:"idempotency_key"`
}

type ProviderCallback struct {
	ProviderEventID   string    `json:"provider_event_id"`
	ProviderReference string    `json:"provider_reference"`
	EventType         string    `json:"event_type"`
	AmountMinor       int64     `json:"amount_minor"`
	Currency          string    `json:"currency"`
	Status            string    `json:"status"`
	Timestamp         time.Time `json:"timestamp"`
	Signature         string    `json:"signature"`
	RawPayload        string    `json:"raw_payload"`
}

type VerifiedCallback struct {
	Provider          string
	ProviderEventID   string
	ProviderReference string
	EventType         string
	AmountMinor       int64
	Currency          string
	Status            string
	Timestamp         time.Time
	SignatureValid    bool
	PayloadHash       string
	Payload           string
}

type ProviderTransactionStatus struct {
	ProviderReference string
	Status            string
}

type WithdrawalRequest struct {
	AmountMinor int64
	Currency    string
	Destination string
}

type WithdrawalResult struct {
	ProviderReference string
	Status            string
}

type OneMoneyProvider struct {
	secret         string
	now            func() time.Time
	statusVerifier StatusVerifier
}

type EcoCashProvider struct {
	secret         string
	now            func() time.Time
	statusVerifier StatusVerifier
}

type InnbucksProvider struct {
	secret         string
	now            func() time.Time
	statusVerifier StatusVerifier
}

type PayPalProvider struct {
	secret         string
	now            func() time.Time
	statusVerifier StatusVerifier
}

type StatusVerifier interface {
	GetTransactionStatus(ctx context.Context, provider string, providerReference string) (ProviderTransactionStatus, error)
}

type StaticStatusVerifier struct {
	Status string
}

type HTTPStatusVerifier struct {
	BaseURL     string
	BearerToken string
	Client      *http.Client
}

func NewOneMoneyProvider(secret string) *OneMoneyProvider {
	return &OneMoneyProvider{secret: secret, now: time.Now, statusVerifier: StaticStatusVerifier{Status: ProviderStatusCompleted}}
}

func NewEcoCashProvider(secret string) *EcoCashProvider {
	return &EcoCashProvider{secret: secret, now: time.Now, statusVerifier: StaticStatusVerifier{Status: ProviderStatusCompleted}}
}

func NewInnbucksProvider(secret string) *InnbucksProvider {
	return &InnbucksProvider{secret: secret, now: time.Now, statusVerifier: StaticStatusVerifier{Status: ProviderStatusCompleted}}
}

func NewPayPalProvider(secret string) *PayPalProvider {
	return &PayPalProvider{secret: secret, now: time.Now, statusVerifier: StaticStatusVerifier{Status: ProviderStatusCompleted}}
}

func (p *OneMoneyProvider) WithStatusVerifier(verifier StatusVerifier) *OneMoneyProvider {
	if verifier != nil {
		p.statusVerifier = verifier
	}
	return p
}

func (p *EcoCashProvider) WithStatusVerifier(verifier StatusVerifier) *EcoCashProvider {
	if verifier != nil {
		p.statusVerifier = verifier
	}
	return p
}

func (p *InnbucksProvider) WithStatusVerifier(verifier StatusVerifier) *InnbucksProvider {
	if verifier != nil {
		p.statusVerifier = verifier
	}
	return p
}

func (p *PayPalProvider) WithStatusVerifier(verifier StatusVerifier) *PayPalProvider {
	if verifier != nil {
		p.statusVerifier = verifier
	}
	return p
}

func (p *OneMoneyProvider) GetProviderName() string {
	return ProviderOneMoney
}

func (p *EcoCashProvider) GetProviderName() string {
	return ProviderEcoCash
}

func (p *InnbucksProvider) GetProviderName() string {
	return ProviderInnbucks
}

func (p *PayPalProvider) GetProviderName() string {
	return ProviderPayPal
}

func (p *OneMoneyProvider) CreateDepositIntent(ctx context.Context, req DepositIntentRequest) (DepositIntent, error) {
	return createMobileMoneyDepositIntent(req, ProviderOneMoney, "OM-", p.now)
}

func (p *EcoCashProvider) CreateDepositIntent(ctx context.Context, req DepositIntentRequest) (DepositIntent, error) {
	return createMobileMoneyDepositIntent(req, ProviderEcoCash, "EC-", p.now)
}

func (p *InnbucksProvider) CreateDepositIntent(ctx context.Context, req DepositIntentRequest) (DepositIntent, error) {
	return createMobileMoneyDepositIntent(req, ProviderInnbucks, "IB-", p.now)
}

func (p *PayPalProvider) CreateDepositIntent(ctx context.Context, req DepositIntentRequest) (DepositIntent, error) {
	return createMobileMoneyDepositIntent(req, ProviderPayPal, "PP-", p.now)
}

func createMobileMoneyDepositIntent(req DepositIntentRequest, provider string, prefix string, nowFn func() time.Time) (DepositIntent, error) {
	if req.UserID == "" || req.AmountMinor <= 0 {
		return DepositIntent{}, wallet.ErrInvalidLedgerEntry
	}
	if req.Currency == "" {
		req.Currency = wallet.CurrencyUSD
	}
	if err := wallet.ValidateCurrency(req.Currency); err != nil {
		return DepositIntent{}, err
	}
	if err := wallet.ValidateIdempotencyKey(req.IdempotencyKey); err != nil {
		return DepositIntent{}, err
	}
	now := nowFn()
	return DepositIntent{
		ID:                uuid.NewString(),
		UserID:            req.UserID,
		Provider:          provider,
		ProviderReference: prefix + uuid.NewString(),
		AmountMinor:       req.AmountMinor,
		Currency:          req.Currency,
		Status:            wallet.DepositStatusPendingProvider,
		ExpiresAt:         now.Add(30 * time.Minute),
		IdempotencyKey:    req.IdempotencyKey,
	}, nil
}

func (p *OneMoneyProvider) VerifyCallback(ctx context.Context, callback ProviderCallback) (VerifiedCallback, error) {
	return verifySignedCallback(p.secret, ProviderOneMoney, callback, p.now, SignOneMoneyCallback, canonicalOneMoneyPayload)
}

func (p *EcoCashProvider) VerifyCallback(ctx context.Context, callback ProviderCallback) (VerifiedCallback, error) {
	return verifySignedCallback(p.secret, ProviderEcoCash, callback, p.now, SignEcoCashCallback, canonicalEcoCashPayload)
}

func (p *InnbucksProvider) VerifyCallback(ctx context.Context, callback ProviderCallback) (VerifiedCallback, error) {
	return verifySignedCallback(p.secret, ProviderInnbucks, callback, p.now, SignInnbucksCallback, canonicalInnbucksPayload)
}

func (p *PayPalProvider) VerifyCallback(ctx context.Context, callback ProviderCallback) (VerifiedCallback, error) {
	return verifySignedCallback(p.secret, ProviderPayPal, callback, p.now, SignPayPalCallback, canonicalPayPalPayload)
}

func verifySignedCallback(secret string, provider string, callback ProviderCallback, nowFn func() time.Time, sign func(string, ProviderCallback) string, canonical func(ProviderCallback) string) (VerifiedCallback, error) {
	if secret == "" {
		return VerifiedCallback{}, ErrProviderDisabled
	}
	if callback.ProviderEventID == "" || callback.ProviderReference == "" || callback.AmountMinor <= 0 || callback.Currency == "" || callback.Timestamp.IsZero() {
		return VerifiedCallback{}, ErrInvalidProviderCallback
	}
	if !allowedCallbackEvent(callback.EventType) || !allowedCallbackStatus(callback.Status) {
		return VerifiedCallback{}, ErrInvalidProviderCallback
	}
	if callback.Signature == "" || !hexSignaturePattern.MatchString(callback.Signature) {
		return VerifiedCallback{}, ErrInvalidProviderCallback
	}
	if nowFn == nil {
		nowFn = time.Now
	}
	now := nowFn().UTC()
	timestamp := callback.Timestamp.UTC()
	if timestamp.Before(now.Add(-providerCallbackReplayWindow)) || timestamp.After(now.Add(providerCallbackReplayWindow)) {
		return VerifiedCallback{}, ErrInvalidProviderCallback
	}
	payload := callback.RawPayload
	if payload == "" {
		payload = canonical(callback)
	}
	hash := sha256.Sum256([]byte(payload))
	expected := sign(secret, callback)
	signatureValid := hmac.Equal([]byte(expected), []byte(callback.Signature))
	if !signatureValid {
		return VerifiedCallback{
			Provider:          provider,
			ProviderEventID:   callback.ProviderEventID,
			ProviderReference: callback.ProviderReference,
			EventType:         callback.EventType,
			AmountMinor:       callback.AmountMinor,
			Currency:          callback.Currency,
			Status:            callback.Status,
			Timestamp:         callback.Timestamp,
			SignatureValid:    false,
			PayloadHash:       hex.EncodeToString(hash[:]),
			Payload:           providerPayloadJSON(callback, payload),
		}, nil
	}
	return VerifiedCallback{
		Provider:          provider,
		ProviderEventID:   callback.ProviderEventID,
		ProviderReference: callback.ProviderReference,
		EventType:         callback.EventType,
		AmountMinor:       callback.AmountMinor,
		Currency:          callback.Currency,
		Status:            callback.Status,
		Timestamp:         callback.Timestamp,
		SignatureValid:    true,
		PayloadHash:       hex.EncodeToString(hash[:]),
		Payload:           providerPayloadJSON(callback, payload),
	}, nil
}

func (p *OneMoneyProvider) GetTransactionStatus(ctx context.Context, providerReference string) (ProviderTransactionStatus, error) {
	return p.statusVerifier.GetTransactionStatus(ctx, ProviderOneMoney, providerReference)
}

func (p *EcoCashProvider) GetTransactionStatus(ctx context.Context, providerReference string) (ProviderTransactionStatus, error) {
	return p.statusVerifier.GetTransactionStatus(ctx, ProviderEcoCash, providerReference)
}

func (p *InnbucksProvider) GetTransactionStatus(ctx context.Context, providerReference string) (ProviderTransactionStatus, error) {
	return p.statusVerifier.GetTransactionStatus(ctx, ProviderInnbucks, providerReference)
}

func (p *PayPalProvider) GetTransactionStatus(ctx context.Context, providerReference string) (ProviderTransactionStatus, error) {
	return p.statusVerifier.GetTransactionStatus(ctx, ProviderPayPal, providerReference)
}

func (v StaticStatusVerifier) GetTransactionStatus(ctx context.Context, provider string, providerReference string) (ProviderTransactionStatus, error) {
	if providerReference == "" {
		return ProviderTransactionStatus{}, ErrInvalidProviderCallback
	}
	status := strings.TrimSpace(v.Status)
	if status == "" {
		status = ProviderStatusCompleted
	}
	return ProviderTransactionStatus{ProviderReference: providerReference, Status: status}, nil
}

func NewHTTPStatusVerifier(baseURL string, bearerToken string) HTTPStatusVerifier {
	return HTTPStatusVerifier{
		BaseURL:     strings.TrimRight(strings.TrimSpace(baseURL), "/"),
		BearerToken: bearerToken,
		Client:      &http.Client{Timeout: 5 * time.Second},
	}
}

func (v HTTPStatusVerifier) GetTransactionStatus(ctx context.Context, provider string, providerReference string) (ProviderTransactionStatus, error) {
	if providerReference == "" || provider == "" {
		return ProviderTransactionStatus{}, ErrInvalidProviderCallback
	}
	if v.BaseURL == "" {
		return ProviderTransactionStatus{}, ErrProviderDisabled
	}
	client := v.Client
	if client == nil {
		client = &http.Client{Timeout: 5 * time.Second}
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, v.BaseURL+"/"+providerReference, nil)
	if err != nil {
		return ProviderTransactionStatus{}, err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("X-PickMe-Provider", provider)
	if v.BearerToken != "" {
		req.Header.Set("Authorization", "Bearer "+v.BearerToken)
	}
	resp, err := client.Do(req)
	if err != nil {
		return ProviderTransactionStatus{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return ProviderTransactionStatus{}, ErrInvalidProviderCallback
	}
	var body struct {
		ProviderReference string `json:"provider_reference"`
		Status            string `json:"status"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return ProviderTransactionStatus{}, err
	}
	if body.ProviderReference != "" && body.ProviderReference != providerReference {
		return ProviderTransactionStatus{}, ErrInvalidProviderCallback
	}
	if !providerStatusAllowsCredit(body.Status) {
		return ProviderTransactionStatus{ProviderReference: providerReference, Status: body.Status}, nil
	}
	return ProviderTransactionStatus{ProviderReference: providerReference, Status: strings.ToUpper(strings.TrimSpace(body.Status))}, nil
}

func (p *OneMoneyProvider) CreateWithdrawal(ctx context.Context, req WithdrawalRequest) (WithdrawalResult, error) {
	return WithdrawalResult{}, ErrProviderDisabled
}

func (p *EcoCashProvider) CreateWithdrawal(ctx context.Context, req WithdrawalRequest) (WithdrawalResult, error) {
	return WithdrawalResult{}, ErrProviderDisabled
}

func (p *InnbucksProvider) CreateWithdrawal(ctx context.Context, req WithdrawalRequest) (WithdrawalResult, error) {
	return WithdrawalResult{}, ErrProviderDisabled
}

func (p *PayPalProvider) CreateWithdrawal(ctx context.Context, req WithdrawalRequest) (WithdrawalResult, error) {
	return WithdrawalResult{}, ErrProviderDisabled
}

func SignOneMoneyCallback(secret string, callback ProviderCallback) string {
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(canonicalOneMoneyPayload(callback)))
	return hex.EncodeToString(mac.Sum(nil))
}

func canonicalOneMoneyPayload(callback ProviderCallback) string {
	return fmt.Sprintf("%s|%s|%s|%s|%s|%s|%s", callback.ProviderEventID, callback.ProviderReference, callback.EventType, wallet.MinorDecimalString(callback.AmountMinor, callback.Currency), callback.Currency, callback.Status, callback.Timestamp.UTC().Format(time.RFC3339Nano))
}

func SignEcoCashCallback(secret string, callback ProviderCallback) string {
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(canonicalEcoCashPayload(callback)))
	return hex.EncodeToString(mac.Sum(nil))
}

func canonicalEcoCashPayload(callback ProviderCallback) string {
	return fmt.Sprintf("%s:%s:%s:%s:%s:%s:%s", callback.ProviderReference, callback.ProviderEventID, callback.EventType, wallet.MinorDecimalString(callback.AmountMinor, callback.Currency), callback.Currency, callback.Status, callback.Timestamp.UTC().Format(time.RFC3339Nano))
}

func SignInnbucksCallback(secret string, callback ProviderCallback) string {
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(canonicalInnbucksPayload(callback)))
	return hex.EncodeToString(mac.Sum(nil))
}

func canonicalInnbucksPayload(callback ProviderCallback) string {
	return fmt.Sprintf("%s~%s~%s~%s~%s~%s~%s", callback.ProviderEventID, callback.EventType, callback.Status, callback.ProviderReference, wallet.MinorDecimalString(callback.AmountMinor, callback.Currency), callback.Currency, callback.Timestamp.UTC().Format(time.RFC3339Nano))
}

func SignPayPalCallback(secret string, callback ProviderCallback) string {
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(canonicalPayPalPayload(callback)))
	return hex.EncodeToString(mac.Sum(nil))
}

func canonicalPayPalPayload(callback ProviderCallback) string {
	return fmt.Sprintf("%s#%s#%s#%s#%s#%s#%s", callback.ProviderReference, callback.EventType, callback.Status, callback.ProviderEventID, wallet.MinorDecimalString(callback.AmountMinor, callback.Currency), callback.Currency, callback.Timestamp.UTC().Format(time.RFC3339Nano))
}

func allowedCallbackEvent(eventType string) bool {
	switch eventType {
	case CallbackEventDepositCompleted, CallbackEventPaymentCompleted:
		return true
	default:
		return false
	}
}

func allowedCallbackStatus(status string) bool {
	switch strings.ToUpper(strings.TrimSpace(status)) {
	case "PAID", ProviderStatusSuccess, ProviderStatusCompleted, ProviderStatusSettled:
		return true
	default:
		return false
	}
}

func providerPayloadJSON(callback ProviderCallback, rawPayload string) string {
	payload, err := json.Marshal(map[string]any{
		"provider_event_id":   callback.ProviderEventID,
		"provider_reference":  callback.ProviderReference,
		"event_type":          callback.EventType,
		"amount_minor":        callback.AmountMinor,
		"currency":            callback.Currency,
		"status":              callback.Status,
		"timestamp":           callback.Timestamp.UTC().Format(time.RFC3339Nano),
		"raw_payload_present": rawPayload != "",
	})
	if err != nil {
		return "{}"
	}
	return string(payload)
}

func (c *ProviderCallback) UnmarshalJSON(data []byte) error {
	type providerCallback ProviderCallback
	var aux struct {
		providerCallback
		Amount json.RawMessage `json:"amount"`
	}
	if err := json.Unmarshal(data, &aux); err != nil {
		return err
	}
	*c = ProviderCallback(aux.providerCallback)
	if len(aux.Amount) > 0 && string(aux.Amount) != "null" {
		amount, err := parseJSONAmountMinor(aux.Amount, c.Currency)
		if err != nil {
			return err
		}
		c.AmountMinor = amount
	}
	return nil
}

func parseJSONAmountMinor(raw json.RawMessage, currency string) (int64, error) {
	if currency == "" {
		currency = wallet.CurrencyUSD
	}
	text := strings.TrimSpace(string(raw))
	text = strings.Trim(text, `"`)
	money, err := wallet.NewPositiveMoneyFromDecimal(text, currency)
	if err != nil {
		return 0, err
	}
	return money.MinorUnits, nil
}
