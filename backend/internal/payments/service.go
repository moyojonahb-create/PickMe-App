package payments

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"log"
	"strings"
	"time"

	"pickme-backend/internal/wallet"
)

type Config struct {
	ProviderEnabled     bool
	OneMoneyEnabled     bool
	OneMoneyPilotOnly   bool
	EcoCashEnabled      bool
	EcoCashPilotOnly    bool
	InnbucksEnabled     bool
	InnbucksPilotOnly   bool
	PayPalEnabled       bool
	PayPalPilotOnly     bool
	CardPaymentsEnabled bool
	CardPilotOnly       bool
}

type WalletRepository interface {
	CreateProviderDepositIntent(ctx context.Context, intent wallet.PaymentIntent) (wallet.PaymentIntent, error)
	ProcessProviderDepositCallback(ctx context.Context, callback wallet.ProviderDepositCallback) (wallet.PaymentIntent, error)
}

type PilotGate interface {
	Enabled() bool
	IsPilotEligible(ctx context.Context, userID string, role string) bool
}

type Service struct {
	repo          WalletRepository
	providers     map[string]Provider
	cardProcessor CardProcessor
	pilot         PilotGate
	walletPilot   wallet.WalletPilotRuntimeEnforcer
	config        Config
}

func NewService(repo WalletRepository, provider Provider, pilot PilotGate, config Config) *Service {
	return NewServiceWithProviders(repo, pilot, config, provider)
}

func NewServiceWithProviders(repo WalletRepository, pilot PilotGate, config Config, providers ...Provider) *Service {
	service := &Service{repo: repo, providers: map[string]Provider{}, pilot: pilot, config: config}
	for _, provider := range providers {
		if provider != nil {
			service.providers[provider.GetProviderName()] = provider
		}
	}
	return service
}

func NewServiceWithCardProcessor(repo WalletRepository, pilot PilotGate, config Config, cardProcessor CardProcessor, providers ...Provider) *Service {
	service := NewServiceWithProviders(repo, pilot, config, providers...)
	service.cardProcessor = cardProcessor
	return service
}

func (s *Service) WithWalletPilotEnforcer(enforcer wallet.WalletPilotRuntimeEnforcer) *Service {
	if s != nil {
		s.walletPilot = enforcer
	}
	return s
}

func (s *Service) CreateOneMoneyDepositIntent(ctx context.Context, req DepositIntentRequest) (DepositIntent, error) {
	return s.createProviderDepositIntent(ctx, ProviderOneMoney, req)
}

func (s *Service) CreateEcoCashDepositIntent(ctx context.Context, req DepositIntentRequest) (DepositIntent, error) {
	return s.createProviderDepositIntent(ctx, ProviderEcoCash, req)
}

func (s *Service) CreateInnbucksDepositIntent(ctx context.Context, req DepositIntentRequest) (DepositIntent, error) {
	return s.createProviderDepositIntent(ctx, ProviderInnbucks, req)
}

func (s *Service) CreatePayPalDepositIntent(ctx context.Context, req DepositIntentRequest) (DepositIntent, error) {
	return s.createProviderDepositIntent(ctx, ProviderPayPal, req)
}

func (s *Service) CreateCardDeposit(ctx context.Context, req DepositIntentRequest) (DepositIntent, error) {
	if !s.config.ProviderEnabled {
		return DepositIntent{}, ErrPaymentsDisabled
	}
	if !s.config.CardPaymentsEnabled || s.cardProcessor == nil {
		return DepositIntent{}, ErrProviderDisabled
	}
	if s.config.CardPilotOnly && !s.pilotEligible(ctx, req.UserID, wallet.PilotRoleRider) {
		return DepositIntent{}, wallet.ErrPilotAccessDenied
	}
	if req.Currency == "" {
		req.Currency = wallet.CurrencyUSD
	}
	if err := s.guardWalletPilot(ctx, wallet.WalletPilotMutationRequest{
		Endpoint:        "/api/payments/cards/deposits",
		UserID:          req.UserID,
		ParticipantType: wallet.WalletPilotParticipantTypeRider,
		City:            req.City,
		TransactionType: wallet.WalletPilotTransactionTypeDeposit,
		AmountMinor:     req.AmountMinor,
		Currency:        req.Currency,
	}); err != nil {
		return DepositIntent{}, err
	}
	intent, err := s.cardProcessor.CreatePaymentIntent(ctx, CardPaymentIntentRequest{
		UserID:         req.UserID,
		AmountMinor:    req.AmountMinor,
		Currency:       req.Currency,
		IdempotencyKey: req.IdempotencyKey,
	})
	if err != nil {
		return DepositIntent{}, err
	}
	auth, err := s.cardProcessor.Authorize(ctx, CardAuthorizationRequest{
		ProcessorReference: intent.ProcessorReference,
		AmountMinor:        intent.AmountMinor,
		Currency:           intent.Currency,
		IdempotencyKey:     "card-auth:" + intent.ProcessorReference,
	})
	if err != nil {
		return DepositIntent{}, err
	}
	expiresAt := intent.ExpiresAt
	stored, err := s.repo.CreateProviderDepositIntent(ctx, wallet.PaymentIntent{
		ID:                intent.ID,
		UserID:            intent.UserID,
		AmountMinor:       intent.AmountMinor,
		Currency:          intent.Currency,
		Provider:          ProviderCard,
		PaymentMethod:     ProviderCard,
		Status:            wallet.DepositStatusPendingProvider,
		WalletAccountType: wallet.AccountTypeRiderWallet,
		ProviderReference: intent.ProcessorReference,
		IdempotencyKey:    intent.IdempotencyKey,
		ExpiresAt:         &expiresAt,
	})
	if err != nil {
		return DepositIntent{}, err
	}
	capture, err := s.cardProcessor.Capture(ctx, CardCaptureRequest{
		ProcessorReference: auth.ProcessorReference,
		AmountMinor:        auth.AmountMinor,
		Currency:           auth.Currency,
		IdempotencyKey:     "card-capture:" + auth.ProcessorReference,
	})
	if err != nil {
		return DepositIntent{}, err
	}
	completed, err := s.repo.ProcessProviderDepositCallback(ctx, wallet.ProviderDepositCallback{
		Provider:          ProviderCard,
		ProviderEventID:   capture.ProcessorEventID,
		ProviderReference: capture.ProcessorReference,
		EventType:         "card_capture",
		AmountMinor:       capture.AmountMinor,
		Currency:          capture.Currency,
		Status:            CallbackStatusPaid,
		SignatureValid:    true,
		PayloadHash:       capture.ProcessorEventHash,
		Payload:           "{}",
		IdempotencyKey:    "provider-deposit:" + ProviderCard + ":" + capture.ProcessorEventID,
	})
	if err != nil {
		return DepositIntent{}, err
	}
	_ = s.recordWalletPilot(ctx, wallet.WalletPilotMutationRequest{
		Endpoint:        "/api/payments/cards/deposits",
		UserID:          completed.UserID,
		ParticipantType: wallet.WalletPilotParticipantTypeRider,
		City:            req.City,
		TransactionType: wallet.WalletPilotTransactionTypeDeposit,
		AmountMinor:     completed.AmountMinor,
		Currency:        completed.Currency,
		EvidenceID:      completed.WalletTransactionID,
	})
	result := depositIntentFromWallet(completed)
	if result.ID == "" {
		result = depositIntentFromWallet(stored)
	}
	return result, nil
}

func (s *Service) VoidCardPayment(ctx context.Context, req CardVoidRequest) (CardVoid, error) {
	if !s.config.ProviderEnabled {
		return CardVoid{}, ErrPaymentsDisabled
	}
	if !s.config.CardPaymentsEnabled || s.cardProcessor == nil {
		return CardVoid{}, ErrProviderDisabled
	}
	return s.cardProcessor.Void(ctx, req)
}

func (s *Service) RefundCardPayment(ctx context.Context, req CardRefundRequest) (CardRefund, error) {
	if !s.config.ProviderEnabled {
		return CardRefund{}, ErrPaymentsDisabled
	}
	if !s.config.CardPaymentsEnabled || s.cardProcessor == nil {
		return CardRefund{}, ErrProviderDisabled
	}
	return s.cardProcessor.Refund(ctx, req)
}

func (s *Service) createProviderDepositIntent(ctx context.Context, providerName string, req DepositIntentRequest) (DepositIntent, error) {
	if !s.config.ProviderEnabled {
		return DepositIntent{}, ErrPaymentsDisabled
	}
	provider := s.providers[providerName]
	if !s.providerEnabled(providerName) || provider == nil {
		return DepositIntent{}, ErrProviderDisabled
	}
	if s.providerPilotOnly(providerName) && !s.pilotEligible(ctx, req.UserID, wallet.PilotRoleRider) {
		return DepositIntent{}, wallet.ErrPilotAccessDenied
	}
	if req.Currency == "" {
		req.Currency = wallet.CurrencyUSD
	}
	if err := s.guardWalletPilot(ctx, wallet.WalletPilotMutationRequest{
		Endpoint:        "/api/payments/" + providerName + "/deposits",
		UserID:          req.UserID,
		ParticipantType: wallet.WalletPilotParticipantTypeRider,
		City:            req.City,
		TransactionType: wallet.WalletPilotTransactionTypeDeposit,
		AmountMinor:     req.AmountMinor,
		Currency:        req.Currency,
	}); err != nil {
		return DepositIntent{}, err
	}
	intent, err := provider.CreateDepositIntent(ctx, req)
	if err != nil {
		return DepositIntent{}, err
	}
	expiresAt := intent.ExpiresAt
	stored, err := s.repo.CreateProviderDepositIntent(ctx, wallet.PaymentIntent{
		ID:                intent.ID,
		UserID:            intent.UserID,
		AmountMinor:       intent.AmountMinor,
		Currency:          intent.Currency,
		Provider:          intent.Provider,
		PaymentMethod:     intent.Provider,
		Status:            wallet.DepositStatusPendingProvider,
		WalletAccountType: wallet.AccountTypeRiderWallet,
		ProviderReference: intent.ProviderReference,
		IdempotencyKey:    intent.IdempotencyKey,
		ExpiresAt:         &expiresAt,
	})
	if err != nil {
		return DepositIntent{}, err
	}
	return depositIntentFromWallet(stored), nil
}

func (s *Service) HandleOneMoneyCallback(ctx context.Context, callback ProviderCallback) (wallet.PaymentIntent, error) {
	return s.handleProviderCallback(ctx, ProviderOneMoney, callback)
}

func (s *Service) HandleEcoCashCallback(ctx context.Context, callback ProviderCallback) (wallet.PaymentIntent, error) {
	return s.handleProviderCallback(ctx, ProviderEcoCash, callback)
}

func (s *Service) HandleInnbucksCallback(ctx context.Context, callback ProviderCallback) (wallet.PaymentIntent, error) {
	return s.handleProviderCallback(ctx, ProviderInnbucks, callback)
}

func (s *Service) HandlePayPalCallback(ctx context.Context, callback ProviderCallback) (wallet.PaymentIntent, error) {
	return s.handleProviderCallback(ctx, ProviderPayPal, callback)
}

func (s *Service) handleProviderCallback(ctx context.Context, providerName string, callback ProviderCallback) (wallet.PaymentIntent, error) {
	if !s.config.ProviderEnabled {
		return wallet.PaymentIntent{}, ErrPaymentsDisabled
	}
	provider := s.providers[providerName]
	if !s.providerEnabled(providerName) || provider == nil {
		return wallet.PaymentIntent{}, ErrProviderDisabled
	}
	verified, err := provider.VerifyCallback(ctx, callback)
	if err != nil {
		return wallet.PaymentIntent{}, s.rejectProviderCallback(ctx, providerName, callback, "verification_failed", err)
	}
	if verified.Provider != providerName || !verified.SignatureValid {
		return wallet.PaymentIntent{}, s.rejectProviderCallback(ctx, providerName, callback, "invalid_signature", ErrInvalidProviderCallback)
	}
	if !allowedCallbackEvent(verified.EventType) {
		return wallet.PaymentIntent{}, s.rejectProviderCallback(ctx, providerName, callback, "unsupported_event", ErrInvalidProviderCallback)
	}
	if !allowedCallbackStatus(verified.Status) {
		return wallet.PaymentIntent{}, s.rejectProviderCallback(ctx, providerName, callback, "unsupported_status", ErrInvalidProviderCallback)
	}
	status, err := provider.GetTransactionStatus(ctx, verified.ProviderReference)
	if err != nil || !providerStatusAllowsCredit(status.Status) {
		return wallet.PaymentIntent{}, s.rejectProviderCallback(ctx, providerName, callback, "provider_status_mismatch", ErrInvalidProviderCallback)
	}
	pendingIntent, err := s.providerIntentForCallback(ctx, verified.Provider, verified.ProviderReference)
	if err != nil {
		return wallet.PaymentIntent{}, s.rejectProviderCallback(ctx, providerName, callback, "provider_reference_not_found", err)
	}
	if pendingIntent.Provider != "" && pendingIntent.Provider != verified.Provider {
		return wallet.PaymentIntent{}, s.rejectProviderCallback(ctx, providerName, callback, "provider_impersonation", ErrInvalidProviderCallback)
	}
	if pendingIntent.AmountMinor != 0 && (pendingIntent.AmountMinor != verified.AmountMinor || pendingIntent.Currency != verified.Currency) {
		return wallet.PaymentIntent{}, s.rejectProviderCallback(ctx, providerName, callback, "intent_amount_mismatch", ErrInvalidProviderCallback)
	}
	if err := s.guardWalletPilot(ctx, wallet.WalletPilotMutationRequest{
		Endpoint:        "/api/payments/" + providerName + "/callback",
		UserID:          pendingIntent.UserID,
		ParticipantType: wallet.WalletPilotParticipantTypeRider,
		City:            "",
		TransactionType: wallet.WalletPilotTransactionTypeDeposit,
		AmountMinor:     verified.AmountMinor,
		Currency:        verified.Currency,
	}); err != nil {
		return wallet.PaymentIntent{}, s.rejectProviderCallback(ctx, providerName, callback, "wallet_pilot_rejected", err)
	}
	intent, processErr := s.repo.ProcessProviderDepositCallback(ctx, wallet.ProviderDepositCallback{
		Provider:          verified.Provider,
		ProviderEventID:   verified.ProviderEventID,
		ProviderReference: verified.ProviderReference,
		EventType:         verified.EventType,
		AmountMinor:       verified.AmountMinor,
		Currency:          verified.Currency,
		Status:            verified.Status,
		SignatureValid:    verified.SignatureValid,
		PayloadHash:       verified.PayloadHash,
		Payload:           verified.Payload,
		IdempotencyKey:    "provider-deposit:" + verified.Provider + ":" + verified.ProviderEventID,
	})
	if processErr != nil {
		return wallet.PaymentIntent{}, s.rejectProviderCallback(ctx, providerName, callback, "wallet_credit_failed", processErr)
	}
	_ = s.recordWalletPilot(ctx, wallet.WalletPilotMutationRequest{
		Endpoint:        "/api/payments/" + providerName + "/callback",
		UserID:          intent.UserID,
		ParticipantType: wallet.WalletPilotParticipantTypeRider,
		TransactionType: wallet.WalletPilotTransactionTypeDeposit,
		AmountMinor:     intent.AmountMinor,
		Currency:        intent.Currency,
		EvidenceID:      intent.WalletTransactionID,
	})
	return intent, nil
}

func (s *Service) rejectProviderCallback(ctx context.Context, provider string, callback ProviderCallback, reason string, cause error) error {
	if cause == nil {
		cause = ErrInvalidProviderCallback
	}
	s.securityLogProviderCallbackRejected(provider, callback, reason)
	s.recordProviderCallbackDeadLetter(ctx, provider, callback, reason)
	s.recordCallbackFailure(ctx, provider, callback.ProviderReference, cause)
	if cause == ErrInvalidProviderCallback {
		return cause
	}
	return cause
}

func (s *Service) securityLogProviderCallbackRejected(provider string, callback ProviderCallback, reason string) {
	log.Printf("SECURITY_PROVIDER_CALLBACK_REJECTED provider=%s provider_event_id=%s provider_reference=%s reason=%s timestamp=%s",
		provider,
		callback.ProviderEventID,
		callback.ProviderReference,
		reason,
		time.Now().UTC().Format(time.RFC3339),
	)
}

func (s *Service) recordProviderCallbackDeadLetter(ctx context.Context, provider string, callback ProviderCallback, reason string) {
	type deadLetterRecorder interface {
		RecordProviderCallbackDeadLetter(context.Context, wallet.ProviderCallbackDeadLetter) error
	}
	recorder, ok := s.repo.(deadLetterRecorder)
	if !ok {
		return
	}
	payload := callback.RawPayload
	if payload == "" {
		payload = callbackDeadLetterPayload(callback)
	}
	hash := sha256.Sum256([]byte(payload))
	_ = recorder.RecordProviderCallbackDeadLetter(ctx, wallet.ProviderCallbackDeadLetter{
		Provider:          provider,
		ProviderEventID:   callback.ProviderEventID,
		ProviderReference: callback.ProviderReference,
		EventType:         callback.EventType,
		PayloadHash:       hex.EncodeToString(hash[:]),
		Payload:           payload,
		Reason:            reason,
		CreatedAt:         time.Now().UTC(),
	})
}

func callbackDeadLetterPayload(callback ProviderCallback) string {
	payload, err := json.Marshal(map[string]any{
		"provider_event_id":  callback.ProviderEventID,
		"provider_reference": callback.ProviderReference,
		"event_type":         callback.EventType,
		"amount_minor":       callback.AmountMinor,
		"currency":           callback.Currency,
		"status":             callback.Status,
		"timestamp":          callback.Timestamp.UTC().Format(time.RFC3339Nano),
	})
	if err != nil {
		return "{}"
	}
	return string(payload)
}

func providerStatusAllowsCredit(status string) bool {
	switch strings.ToUpper(strings.TrimSpace(status)) {
	case ProviderStatusSuccess, ProviderStatusCompleted, ProviderStatusSettled:
		return true
	default:
		return false
	}
}

func (s *Service) providerIntentForCallback(ctx context.Context, provider string, reference string) (wallet.PaymentIntent, error) {
	if s.walletPilot == nil {
		return wallet.PaymentIntent{}, nil
	}
	type providerReferenceLookup interface {
		GetProviderDepositByProviderReference(ctx context.Context, provider string, providerReference string) (wallet.PaymentIntent, error)
	}
	lookup, ok := s.repo.(providerReferenceLookup)
	if !ok {
		return wallet.PaymentIntent{}, wallet.ErrWalletPilotNotAuthorized
	}
	return lookup.GetProviderDepositByProviderReference(ctx, provider, reference)
}

func (s *Service) guardWalletPilot(ctx context.Context, req wallet.WalletPilotMutationRequest) error {
	if s == nil || s.walletPilot == nil {
		return nil
	}
	return s.walletPilot.GuardWalletMutation(ctx, req)
}

func (s *Service) recordWalletPilot(ctx context.Context, req wallet.WalletPilotMutationRequest) error {
	if s == nil || s.walletPilot == nil {
		return nil
	}
	return s.walletPilot.RecordWalletMutation(ctx, req)
}

func (s *Service) recordCallbackFailure(ctx context.Context, provider string, reference string, cause error) {
	type financialObserver interface {
		RecordFinancialMetric(context.Context, wallet.FinancialMetric) error
		CreateFinancialJob(context.Context, wallet.FinancialJob) error
	}
	observer, ok := s.repo.(financialObserver)
	if !ok {
		return
	}
	_ = observer.CreateFinancialJob(ctx, wallet.FinancialJob{
		JobType:        wallet.FinancialJobTypeProviderCallbackProcessing,
		Status:         wallet.FinancialJobStatusPending,
		SourceType:     "provider_reference",
		SourceID:       reference,
		Provider:       provider,
		IdempotencyKey: "provider-callback-processing:" + provider + ":" + reference,
		FailureReason:  cause.Error(),
		Metadata:       "{}",
	})
	_ = observer.RecordFinancialMetric(ctx, wallet.FinancialMetric{
		MetricType:    wallet.FinancialMetricCallbackFailure,
		Provider:      provider,
		ReferenceType: "provider_reference",
		ReferenceID:   reference,
		Metadata:      "{}",
	})
}

func (s *Service) providerEnabled(providerName string) bool {
	switch providerName {
	case ProviderOneMoney:
		return s.config.OneMoneyEnabled
	case ProviderEcoCash:
		return s.config.EcoCashEnabled
	case ProviderInnbucks:
		return s.config.InnbucksEnabled
	case ProviderPayPal:
		return s.config.PayPalEnabled
	default:
		return false
	}
}

func (s *Service) providerPilotOnly(providerName string) bool {
	switch providerName {
	case ProviderOneMoney:
		return s.config.OneMoneyPilotOnly
	case ProviderEcoCash:
		return s.config.EcoCashPilotOnly
	case ProviderInnbucks:
		return s.config.InnbucksPilotOnly
	case ProviderPayPal:
		return s.config.PayPalPilotOnly
	default:
		return true
	}
}

func (s *Service) pilotEligible(ctx context.Context, userID string, role string) bool {
	if s.pilot == nil {
		return false
	}
	return s.pilot.Enabled() && s.pilot.IsPilotEligible(ctx, userID, role)
}

func depositIntentFromWallet(intent wallet.PaymentIntent) DepositIntent {
	expiresAt := time.Time{}
	if intent.ExpiresAt != nil {
		expiresAt = *intent.ExpiresAt
	}
	return DepositIntent{
		ID:                intent.ID,
		UserID:            intent.UserID,
		Provider:          intent.Provider,
		ProviderReference: intent.ProviderReference,
		AmountMinor:       intent.AmountMinor,
		Currency:          intent.Currency,
		Status:            intent.Status,
		ExpiresAt:         expiresAt,
		IdempotencyKey:    intent.IdempotencyKey,
	}
}
