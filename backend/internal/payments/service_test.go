package payments

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"pickme-backend/internal/wallet"
)

type fakeWalletRepo struct {
	created         []wallet.PaymentIntent
	callbacks       []wallet.ProviderDepositCallback
	deadLetters     []wallet.ProviderCallbackDeadLetter
	intent          wallet.PaymentIntent
	err             error
	creditedByEvent map[string]bool
	creditedByRef   map[string]bool
}

type fakeWalletPilotRuntimeEnforcer struct {
	err     error
	guards  []wallet.WalletPilotMutationRequest
	records []wallet.WalletPilotMutationRequest
}

type fakePilotGate struct {
	enabled  bool
	eligible bool
}

func (r *fakeWalletRepo) CreateProviderDepositIntent(ctx context.Context, intent wallet.PaymentIntent) (wallet.PaymentIntent, error) {
	r.created = append(r.created, intent)
	if r.err != nil {
		return wallet.PaymentIntent{}, r.err
	}
	intent.Status = wallet.DepositStatusPendingProvider
	return intent, nil
}

func (r *fakeWalletRepo) ProcessProviderDepositCallback(ctx context.Context, callback wallet.ProviderDepositCallback) (wallet.PaymentIntent, error) {
	if r.creditedByEvent == nil {
		r.creditedByEvent = map[string]bool{}
	}
	if r.creditedByRef == nil {
		r.creditedByRef = map[string]bool{}
	}
	eventKey := callback.Provider + ":" + callback.ProviderEventID
	refKey := callback.Provider + ":" + callback.ProviderReference
	if r.creditedByEvent[eventKey] || r.creditedByRef[refKey] {
		if r.intent.ID != "" {
			intent := r.intent
			intent.Status = wallet.DepositStatusCompleted
			return intent, nil
		}
		return wallet.PaymentIntent{ID: "intent-1", Provider: callback.Provider, ProviderReference: callback.ProviderReference, Status: wallet.DepositStatusCompleted, AmountMinor: callback.AmountMinor, Currency: callback.Currency}, nil
	}
	r.creditedByEvent[eventKey] = true
	r.creditedByRef[refKey] = true
	r.callbacks = append(r.callbacks, callback)
	if r.err != nil {
		return wallet.PaymentIntent{}, r.err
	}
	if r.intent.ID != "" {
		return r.intent, nil
	}
	return wallet.PaymentIntent{ID: "intent-1", Provider: callback.Provider, ProviderReference: callback.ProviderReference, Status: wallet.DepositStatusCompleted, AmountMinor: callback.AmountMinor, Currency: callback.Currency}, nil
}

func (r *fakeWalletRepo) RecordProviderCallbackDeadLetter(ctx context.Context, deadLetter wallet.ProviderCallbackDeadLetter) error {
	r.deadLetters = append(r.deadLetters, deadLetter)
	return nil
}

func (r *fakeWalletRepo) GetProviderDepositByProviderReference(ctx context.Context, provider string, providerReference string) (wallet.PaymentIntent, error) {
	if r.intent.ID != "" {
		return r.intent, nil
	}
	return wallet.PaymentIntent{ID: "intent-1", UserID: "user-1", Provider: provider, ProviderReference: providerReference, Status: wallet.DepositStatusPendingProvider, AmountMinor: 2000, Currency: wallet.CurrencyUSD}, nil
}

func (g fakePilotGate) Enabled() bool {
	return g.enabled
}

func (g fakePilotGate) IsPilotEligible(ctx context.Context, userID string, role string) bool {
	return g.enabled && g.eligible
}

func (e *fakeWalletPilotRuntimeEnforcer) Enabled() bool {
	return true
}

func (e *fakeWalletPilotRuntimeEnforcer) GuardWalletMutation(ctx context.Context, req wallet.WalletPilotMutationRequest) error {
	e.guards = append(e.guards, req)
	return e.err
}

func (e *fakeWalletPilotRuntimeEnforcer) RecordWalletMutation(ctx context.Context, req wallet.WalletPilotMutationRequest) error {
	e.records = append(e.records, req)
	return nil
}

func secureProviderCallback(provider string, eventID string, reference string, amountMinor int64) ProviderCallback {
	callback := ProviderCallback{
		ProviderEventID:   eventID,
		ProviderReference: reference,
		EventType:         CallbackEventDepositCompleted,
		AmountMinor:       amountMinor,
		Currency:          wallet.CurrencyUSD,
		Status:            CallbackStatusPaid,
		Timestamp:         time.Now().UTC(),
	}
	switch provider {
	case ProviderEcoCash:
		callback.Signature = SignEcoCashCallback("secret", callback)
	case ProviderInnbucks:
		callback.Signature = SignInnbucksCallback("secret", callback)
	case ProviderPayPal:
		callback.Signature = SignPayPalCallback("secret", callback)
	default:
		callback.Signature = SignOneMoneyCallback("secret", callback)
	}
	return callback
}

func TestOneMoneyProviderImplementsProviderInterface(t *testing.T) {
	var _ Provider = (*OneMoneyProvider)(nil)
	var _ Provider = (*EcoCashProvider)(nil)
	var _ Provider = (*InnbucksProvider)(nil)
	var _ Provider = (*PayPalProvider)(nil)
	var _ CardProcessor = (*MockCardProcessor)(nil)
}

func TestOneMoneyDepositIntentCreation(t *testing.T) {
	provider := NewOneMoneyProvider("secret")
	provider.now = func() time.Time { return time.Unix(100, 0) }
	intent, err := provider.CreateDepositIntent(context.Background(), DepositIntentRequest{UserID: "user-1", AmountMinor: 1013, Currency: wallet.CurrencyUSD, IdempotencyKey: "intent-key-1"})
	if err != nil {
		t.Fatal(err)
	}
	if intent.Provider != ProviderOneMoney || intent.ProviderReference == "" || intent.AmountMinor != 1013 || intent.Status != wallet.DepositStatusPendingProvider {
		t.Fatalf("unexpected intent: %#v", intent)
	}
	if !intent.ExpiresAt.After(time.Unix(100, 0)) {
		t.Fatal("expected provider intent expiry")
	}
}

func TestEcoCashDepositIntentCreation(t *testing.T) {
	provider := NewEcoCashProvider("secret")
	provider.now = func() time.Time { return time.Unix(200, 0) }
	intent, err := provider.CreateDepositIntent(context.Background(), DepositIntentRequest{UserID: "user-1", AmountMinor: 1555, Currency: wallet.CurrencyUSD, IdempotencyKey: "ecocash-intent-key-1"})
	if err != nil {
		t.Fatal(err)
	}
	if intent.Provider != ProviderEcoCash || !strings.HasPrefix(intent.ProviderReference, "EC-") || intent.AmountMinor != 1555 || intent.Status != wallet.DepositStatusPendingProvider {
		t.Fatalf("unexpected EcoCash intent: %#v", intent)
	}
}

func TestInnbucksDepositIntentCreation(t *testing.T) {
	provider := NewInnbucksProvider("secret")
	provider.now = func() time.Time { return time.Unix(300, 0) }
	intent, err := provider.CreateDepositIntent(context.Background(), DepositIntentRequest{UserID: "user-1", AmountMinor: 1844, Currency: wallet.CurrencyUSD, IdempotencyKey: "innbucks-intent-key-1"})
	if err != nil {
		t.Fatal(err)
	}
	if intent.Provider != ProviderInnbucks || !strings.HasPrefix(intent.ProviderReference, "IB-") || intent.AmountMinor != 1844 || intent.Status != wallet.DepositStatusPendingProvider {
		t.Fatalf("unexpected Innbucks intent: %#v", intent)
	}
}

func TestPayPalDepositIntentCreation(t *testing.T) {
	provider := NewPayPalProvider("secret")
	provider.now = func() time.Time { return time.Unix(400, 0) }
	intent, err := provider.CreateDepositIntent(context.Background(), DepositIntentRequest{UserID: "user-1", AmountMinor: 2222, Currency: wallet.CurrencyUSD, IdempotencyKey: "paypal-intent-key-1"})
	if err != nil {
		t.Fatal(err)
	}
	if intent.Provider != ProviderPayPal || !strings.HasPrefix(intent.ProviderReference, "PP-") || intent.AmountMinor != 2222 || intent.Status != wallet.DepositStatusPendingProvider {
		t.Fatalf("unexpected PayPal intent: %#v", intent)
	}
}

func TestMockCardProcessorAuthorizationCaptureVoidAndRefund(t *testing.T) {
	processor := NewMockCardProcessor()
	intent, err := processor.CreatePaymentIntent(context.Background(), CardPaymentIntentRequest{UserID: "user-1", AmountMinor: 4044, Currency: wallet.CurrencyUSD, IdempotencyKey: "card-intent-key-1"})
	if err != nil {
		t.Fatal(err)
	}
	if intent.Processor != "mock_card" || !strings.HasPrefix(intent.ProcessorReference, "CARD-") || intent.AmountMinor != 4044 || intent.Status != CardStatusPending {
		t.Fatalf("unexpected card intent: %#v", intent)
	}

	auth, err := processor.Authorize(context.Background(), CardAuthorizationRequest{ProcessorReference: intent.ProcessorReference, AmountMinor: intent.AmountMinor, Currency: intent.Currency, IdempotencyKey: "card-auth-key-1"})
	if err != nil {
		t.Fatal(err)
	}
	if auth.Status != CardStatusAuthorized || auth.ProcessorEventHash == "" {
		t.Fatalf("unexpected authorization: %#v", auth)
	}

	capture, err := processor.Capture(context.Background(), CardCaptureRequest{ProcessorReference: intent.ProcessorReference, AmountMinor: intent.AmountMinor, Currency: intent.Currency, IdempotencyKey: "card-capture-key-1"})
	if err != nil {
		t.Fatal(err)
	}
	duplicateCapture, err := processor.Capture(context.Background(), CardCaptureRequest{ProcessorReference: intent.ProcessorReference, AmountMinor: intent.AmountMinor, Currency: intent.Currency, IdempotencyKey: "card-capture-key-2"})
	if err != nil {
		t.Fatal(err)
	}
	if capture.Status != CardStatusCaptured || duplicateCapture.CaptureID != capture.CaptureID {
		t.Fatalf("expected idempotent capture, got %#v then %#v", capture, duplicateCapture)
	}

	voided, err := processor.Void(context.Background(), CardVoidRequest{ProcessorReference: intent.ProcessorReference, IdempotencyKey: "card-void-key-1"})
	if err != nil {
		t.Fatal(err)
	}
	if voided.Status != CardStatusVoided {
		t.Fatalf("unexpected void: %#v", voided)
	}

	refund, err := processor.Refund(context.Background(), CardRefundRequest{ProcessorReference: intent.ProcessorReference, AmountMinor: 500, Currency: wallet.CurrencyUSD, IdempotencyKey: "card-refund-key-1"})
	if err != nil {
		t.Fatal(err)
	}
	if refund.Status != CardStatusRefunded {
		t.Fatalf("unexpected refund: %#v", refund)
	}
}

func TestCardProcessorDoesNotExposeRawCardFields(t *testing.T) {
	source, err := os.ReadFile("card.go")
	if err != nil {
		t.Fatal(err)
	}
	banned := []string{"CardNumber", "card_number", "PAN", "CVV", "CVC", "cvv", "cvc"}
	for _, pattern := range banned {
		if strings.Contains(string(source), pattern) {
			t.Fatalf("card processor must not expose raw PCI-sensitive field %s", pattern)
		}
	}
}

func TestOneMoneyCallbackVerification(t *testing.T) {
	provider := NewOneMoneyProvider("secret")
	callback := secureProviderCallback(ProviderOneMoney, "evt-1", "OM-1", 2000)
	verified, err := provider.VerifyCallback(context.Background(), callback)
	if err != nil {
		t.Fatal(err)
	}
	if !verified.SignatureValid || verified.PayloadHash == "" {
		t.Fatalf("expected valid signed callback, got %#v", verified)
	}

	callback.AmountMinor = 2100
	verified, err = provider.VerifyCallback(context.Background(), callback)
	if err != nil {
		t.Fatal(err)
	}
	if verified.SignatureValid {
		t.Fatal("tampered amount must invalidate signature")
	}
}

func TestEcoCashCallbackVerification(t *testing.T) {
	provider := NewEcoCashProvider("secret")
	callback := secureProviderCallback(ProviderEcoCash, "evt-1", "EC-1", 2000)
	verified, err := provider.VerifyCallback(context.Background(), callback)
	if err != nil {
		t.Fatal(err)
	}
	if !verified.SignatureValid || verified.Provider != ProviderEcoCash || verified.PayloadHash == "" {
		t.Fatalf("expected valid signed EcoCash callback, got %#v", verified)
	}

	callback.ProviderReference = "EC-tampered"
	verified, err = provider.VerifyCallback(context.Background(), callback)
	if err != nil {
		t.Fatal(err)
	}
	if verified.SignatureValid {
		t.Fatal("tampered EcoCash reference must invalidate signature")
	}
}

func TestInnbucksCallbackVerification(t *testing.T) {
	provider := NewInnbucksProvider("secret")
	callback := secureProviderCallback(ProviderInnbucks, "evt-1", "IB-1", 3000)
	verified, err := provider.VerifyCallback(context.Background(), callback)
	if err != nil {
		t.Fatal(err)
	}
	if !verified.SignatureValid || verified.Provider != ProviderInnbucks || verified.PayloadHash == "" {
		t.Fatalf("expected valid signed Innbucks callback, got %#v", verified)
	}

	callback.AmountMinor = 3100
	verified, err = provider.VerifyCallback(context.Background(), callback)
	if err != nil {
		t.Fatal(err)
	}
	if verified.SignatureValid {
		t.Fatal("tampered Innbucks amount must invalidate signature")
	}
}

func TestPayPalCallbackVerification(t *testing.T) {
	provider := NewPayPalProvider("secret")
	callback := secureProviderCallback(ProviderPayPal, "evt-1", "PP-1", 3500)
	verified, err := provider.VerifyCallback(context.Background(), callback)
	if err != nil {
		t.Fatal(err)
	}
	if !verified.SignatureValid || verified.Provider != ProviderPayPal || verified.PayloadHash == "" {
		t.Fatalf("expected valid signed PayPal callback, got %#v", verified)
	}

	callback.ProviderReference = "PP-tampered"
	verified, err = provider.VerifyCallback(context.Background(), callback)
	if err != nil {
		t.Fatal(err)
	}
	if verified.SignatureValid {
		t.Fatal("tampered PayPal reference must invalidate signature")
	}
}

func TestPaymentServiceFeatureFlags(t *testing.T) {
	service := NewService(&fakeWalletRepo{}, NewOneMoneyProvider("secret"), fakePilotGate{enabled: true, eligible: true}, Config{})
	_, err := service.CreateOneMoneyDepositIntent(context.Background(), DepositIntentRequest{UserID: "user-1", AmountMinor: 1000, Currency: wallet.CurrencyUSD, IdempotencyKey: "intent-key-1"})
	if !errors.Is(err, ErrPaymentsDisabled) {
		t.Fatalf("expected payments disabled, got %v", err)
	}

	service = NewService(&fakeWalletRepo{}, NewOneMoneyProvider("secret"), fakePilotGate{enabled: true, eligible: true}, Config{ProviderEnabled: true})
	_, err = service.CreateOneMoneyDepositIntent(context.Background(), DepositIntentRequest{UserID: "user-1", AmountMinor: 1000, Currency: wallet.CurrencyUSD, IdempotencyKey: "intent-key-1"})
	if !errors.Is(err, ErrProviderDisabled) {
		t.Fatalf("expected provider disabled, got %v", err)
	}
}

func TestEcoCashPaymentServicePilotGate(t *testing.T) {
	service := NewServiceWithProviders(&fakeWalletRepo{}, fakePilotGate{enabled: true, eligible: false}, Config{ProviderEnabled: true, EcoCashEnabled: true, EcoCashPilotOnly: true}, NewEcoCashProvider("secret"))
	_, err := service.CreateEcoCashDepositIntent(context.Background(), DepositIntentRequest{UserID: "user-1", AmountMinor: 1000, Currency: wallet.CurrencyUSD, IdempotencyKey: "ecocash-intent-key-1"})
	if !errors.Is(err, wallet.ErrPilotAccessDenied) {
		t.Fatalf("expected pilot access denial, got %v", err)
	}
}

func TestInnbucksPaymentServicePilotGate(t *testing.T) {
	service := NewServiceWithProviders(&fakeWalletRepo{}, fakePilotGate{enabled: true, eligible: false}, Config{ProviderEnabled: true, InnbucksEnabled: true, InnbucksPilotOnly: true}, NewInnbucksProvider("secret"))
	_, err := service.CreateInnbucksDepositIntent(context.Background(), DepositIntentRequest{UserID: "user-1", AmountMinor: 1000, Currency: wallet.CurrencyUSD, IdempotencyKey: "innbucks-intent-key-1"})
	if !errors.Is(err, wallet.ErrPilotAccessDenied) {
		t.Fatalf("expected pilot access denial, got %v", err)
	}
}

func TestPayPalPaymentServicePilotGate(t *testing.T) {
	service := NewServiceWithProviders(&fakeWalletRepo{}, fakePilotGate{enabled: true, eligible: false}, Config{ProviderEnabled: true, PayPalEnabled: true, PayPalPilotOnly: true}, NewPayPalProvider("secret"))
	_, err := service.CreatePayPalDepositIntent(context.Background(), DepositIntentRequest{UserID: "user-1", AmountMinor: 1000, Currency: wallet.CurrencyUSD, IdempotencyKey: "paypal-intent-key-1"})
	if !errors.Is(err, wallet.ErrPilotAccessDenied) {
		t.Fatalf("expected pilot access denial, got %v", err)
	}
}

func TestCardPaymentServicePilotGate(t *testing.T) {
	service := NewServiceWithCardProcessor(&fakeWalletRepo{}, fakePilotGate{enabled: true, eligible: false}, Config{ProviderEnabled: true, CardPaymentsEnabled: true, CardPilotOnly: true}, NewMockCardProcessor())
	_, err := service.CreateCardDeposit(context.Background(), DepositIntentRequest{UserID: "user-1", AmountMinor: 1000, Currency: wallet.CurrencyUSD, IdempotencyKey: "card-intent-key-1"})
	if !errors.Is(err, wallet.ErrPilotAccessDenied) {
		t.Fatalf("expected pilot access denial, got %v", err)
	}
}

func TestPaymentServicePilotGate(t *testing.T) {
	service := NewService(&fakeWalletRepo{}, NewOneMoneyProvider("secret"), fakePilotGate{enabled: true, eligible: false}, Config{ProviderEnabled: true, OneMoneyEnabled: true, OneMoneyPilotOnly: true})
	_, err := service.CreateOneMoneyDepositIntent(context.Background(), DepositIntentRequest{UserID: "user-1", AmountMinor: 1000, Currency: wallet.CurrencyUSD, IdempotencyKey: "intent-key-1"})
	if !errors.Is(err, wallet.ErrPilotAccessDenied) {
		t.Fatalf("expected pilot access denial, got %v", err)
	}
}

func TestProviderDepositIntentEnforcesPublicWalletPilot(t *testing.T) {
	repo := &fakeWalletRepo{}
	enforcer := &fakeWalletPilotRuntimeEnforcer{err: wallet.ErrWalletPilotNotAuthorized}
	service := NewService(repo, NewOneMoneyProvider("secret"), fakePilotGate{enabled: true, eligible: true}, Config{ProviderEnabled: true, OneMoneyEnabled: true, OneMoneyPilotOnly: true}).WithWalletPilotEnforcer(enforcer)

	_, err := service.CreateOneMoneyDepositIntent(context.Background(), DepositIntentRequest{UserID: "user-1", AmountMinor: 1000, Currency: wallet.CurrencyUSD, City: wallet.WalletPilotCityGwanda, IdempotencyKey: "intent-key-1"})
	if !errors.Is(err, wallet.ErrWalletPilotNotAuthorized) {
		t.Fatalf("expected wallet pilot denial, got %v", err)
	}
	if len(repo.created) != 0 {
		t.Fatalf("pilot denial must block provider intent creation, got %#v", repo.created)
	}
	if len(enforcer.guards) != 1 || enforcer.guards[0].TransactionType != wallet.WalletPilotTransactionTypeDeposit {
		t.Fatalf("expected deposit guard, got %#v", enforcer.guards)
	}
}

func TestProviderCallbackCreditEnforcesPublicWalletPilot(t *testing.T) {
	repo := &fakeWalletRepo{intent: wallet.PaymentIntent{ID: "intent-1", UserID: "user-1", Provider: wallet.ProviderOneMoney, ProviderReference: "OM-1", Status: wallet.DepositStatusPendingProvider, AmountMinor: 2000, Currency: wallet.CurrencyUSD}}
	enforcer := &fakeWalletPilotRuntimeEnforcer{err: wallet.ErrWalletPilotNotAuthorized}
	provider := NewOneMoneyProvider("secret")
	service := NewService(repo, provider, fakePilotGate{enabled: true, eligible: true}, Config{ProviderEnabled: true, OneMoneyEnabled: true, OneMoneyPilotOnly: true}).WithWalletPilotEnforcer(enforcer)
	callback := secureProviderCallback(ProviderOneMoney, "evt-1", "OM-1", 2000)

	_, err := service.HandleOneMoneyCallback(context.Background(), callback)
	if !errors.Is(err, wallet.ErrWalletPilotNotAuthorized) {
		t.Fatalf("expected wallet pilot denial, got %v", err)
	}
	if len(repo.callbacks) != 0 {
		t.Fatalf("pilot denial must block provider callback wallet credit, got %#v", repo.callbacks)
	}
	if len(enforcer.guards) != 1 || enforcer.guards[0].UserID != "user-1" || enforcer.guards[0].TransactionType != wallet.WalletPilotTransactionTypeDeposit {
		t.Fatalf("expected callback deposit guard, got %#v", enforcer.guards)
	}
}

func TestEcoCashPaymentServiceCallbackPostsToWalletRepository(t *testing.T) {
	repo := &fakeWalletRepo{}
	service := NewServiceWithProviders(repo, fakePilotGate{enabled: true, eligible: true}, Config{ProviderEnabled: true, EcoCashEnabled: true, EcoCashPilotOnly: true}, NewEcoCashProvider("secret"))
	callback := secureProviderCallback(ProviderEcoCash, "evt-1", "EC-1", 2000)

	intent, err := service.HandleEcoCashCallback(context.Background(), callback)
	if err != nil {
		t.Fatal(err)
	}
	if intent.Provider != wallet.ProviderEcoCash || intent.Status != wallet.DepositStatusCompleted {
		t.Fatalf("expected completed EcoCash intent, got %#v", intent)
	}
	if len(repo.callbacks) != 1 || !repo.callbacks[0].SignatureValid || repo.callbacks[0].Provider != wallet.ProviderEcoCash {
		t.Fatalf("expected verified EcoCash callback to be stored, got %#v", repo.callbacks)
	}
}

func TestInnbucksPaymentServiceCallbackPostsToWalletRepository(t *testing.T) {
	repo := &fakeWalletRepo{}
	service := NewServiceWithProviders(repo, fakePilotGate{enabled: true, eligible: true}, Config{ProviderEnabled: true, InnbucksEnabled: true, InnbucksPilotOnly: true}, NewInnbucksProvider("secret"))
	callback := secureProviderCallback(ProviderInnbucks, "evt-1", "IB-1", 3000)

	intent, err := service.HandleInnbucksCallback(context.Background(), callback)
	if err != nil {
		t.Fatal(err)
	}
	if intent.Provider != wallet.ProviderInnbucks || intent.Status != wallet.DepositStatusCompleted {
		t.Fatalf("expected completed Innbucks intent, got %#v", intent)
	}
	if len(repo.callbacks) != 1 || !repo.callbacks[0].SignatureValid || repo.callbacks[0].Provider != wallet.ProviderInnbucks {
		t.Fatalf("expected verified Innbucks callback to be stored, got %#v", repo.callbacks)
	}
}

func TestPayPalPaymentServiceCallbackPostsToWalletRepository(t *testing.T) {
	repo := &fakeWalletRepo{}
	service := NewServiceWithProviders(repo, fakePilotGate{enabled: true, eligible: true}, Config{ProviderEnabled: true, PayPalEnabled: true, PayPalPilotOnly: true}, NewPayPalProvider("secret"))
	callback := secureProviderCallback(ProviderPayPal, "evt-1", "PP-1", 3500)

	intent, err := service.HandlePayPalCallback(context.Background(), callback)
	if err != nil {
		t.Fatal(err)
	}
	if intent.Provider != wallet.ProviderPayPal || intent.Status != wallet.DepositStatusCompleted {
		t.Fatalf("expected completed PayPal intent, got %#v", intent)
	}
	if len(repo.callbacks) != 1 || !repo.callbacks[0].SignatureValid || repo.callbacks[0].Provider != wallet.ProviderPayPal {
		t.Fatalf("expected verified PayPal callback to be stored, got %#v", repo.callbacks)
	}
}

func TestCardPaymentServiceCapturePostsToWalletRepository(t *testing.T) {
	repo := &fakeWalletRepo{}
	service := NewServiceWithCardProcessor(repo, fakePilotGate{enabled: true, eligible: true}, Config{ProviderEnabled: true, CardPaymentsEnabled: true, CardPilotOnly: true}, NewMockCardProcessor())

	intent, err := service.CreateCardDeposit(context.Background(), DepositIntentRequest{UserID: "user-1", AmountMinor: 2500, Currency: wallet.CurrencyUSD, IdempotencyKey: "card-intent-key-2"})
	if err != nil {
		t.Fatal(err)
	}
	if intent.Provider != wallet.ProviderCard || intent.Status != wallet.DepositStatusCompleted {
		t.Fatalf("expected completed card intent, got %#v", intent)
	}
	if len(repo.created) != 1 || repo.created[0].Provider != wallet.ProviderCard || repo.created[0].PaymentMethod != wallet.ProviderCard {
		t.Fatalf("expected card payment intent to be stored, got %#v", repo.created)
	}
	if len(repo.callbacks) != 1 || !repo.callbacks[0].SignatureValid || repo.callbacks[0].Provider != wallet.ProviderCard || repo.callbacks[0].Status != CallbackStatusPaid {
		t.Fatalf("expected card capture callback to be stored, got %#v", repo.callbacks)
	}
}

func TestPaymentServiceCallbackPostsToWalletRepository(t *testing.T) {
	repo := &fakeWalletRepo{}
	provider := NewOneMoneyProvider("secret")
	service := NewService(repo, provider, fakePilotGate{enabled: true, eligible: true}, Config{ProviderEnabled: true, OneMoneyEnabled: true, OneMoneyPilotOnly: true})
	callback := secureProviderCallback(ProviderOneMoney, "evt-1", "OM-1", 2000)

	intent, err := service.HandleOneMoneyCallback(context.Background(), callback)
	if err != nil {
		t.Fatal(err)
	}
	if intent.Status != wallet.DepositStatusCompleted {
		t.Fatalf("expected completed intent, got %#v", intent)
	}
	if len(repo.callbacks) != 1 || !repo.callbacks[0].SignatureValid || repo.callbacks[0].Provider != wallet.ProviderOneMoney {
		t.Fatalf("expected verified callback to be stored, got %#v", repo.callbacks)
	}
}

func TestPaymentServiceInvalidSignatureDeadLettersBeforeWalletCredit(t *testing.T) {
	repo := &fakeWalletRepo{}
	service := NewService(repo, NewOneMoneyProvider("secret"), fakePilotGate{enabled: true, eligible: true}, Config{ProviderEnabled: true, OneMoneyEnabled: true, OneMoneyPilotOnly: true})
	callback := secureProviderCallback(ProviderOneMoney, "evt-1", "OM-1", 2000)
	callback.Signature = strings.Repeat("0", 64)

	_, err := service.HandleOneMoneyCallback(context.Background(), callback)
	if !errors.Is(err, ErrInvalidProviderCallback) {
		t.Fatalf("expected invalid callback error, got %v", err)
	}
	if len(repo.callbacks) != 0 {
		t.Fatalf("invalid signature must not reach wallet credit path, got %#v", repo.callbacks)
	}
	if len(repo.deadLetters) != 1 || repo.deadLetters[0].Reason != "invalid_signature" {
		t.Fatalf("expected dead-letter for invalid signature, got %#v", repo.deadLetters)
	}
}

func TestPaymentServiceForgedUnsignedCallbackRejected(t *testing.T) {
	repo := &fakeWalletRepo{}
	service := NewService(repo, NewOneMoneyProvider("secret"), fakePilotGate{enabled: true, eligible: true}, Config{ProviderEnabled: true, OneMoneyEnabled: true, OneMoneyPilotOnly: true})
	callback := secureProviderCallback(ProviderOneMoney, "evt-forged", "OM-1", 2000)
	callback.Signature = ""

	_, err := service.HandleOneMoneyCallback(context.Background(), callback)
	if !errors.Is(err, ErrInvalidProviderCallback) {
		t.Fatalf("expected forged callback rejection, got %v", err)
	}
	if len(repo.callbacks) != 0 || len(repo.deadLetters) != 1 {
		t.Fatalf("forged callback must be dead-lettered without credit, callbacks=%#v deadLetters=%#v", repo.callbacks, repo.deadLetters)
	}
}

func TestPaymentServiceMalformedSignatureRejected(t *testing.T) {
	repo := &fakeWalletRepo{}
	service := NewService(repo, NewOneMoneyProvider("secret"), fakePilotGate{enabled: true, eligible: true}, Config{ProviderEnabled: true, OneMoneyEnabled: true, OneMoneyPilotOnly: true})
	callback := secureProviderCallback(ProviderOneMoney, "evt-malformed", "OM-1", 2000)
	callback.Signature = "not-hex"

	_, err := service.HandleOneMoneyCallback(context.Background(), callback)
	if !errors.Is(err, ErrInvalidProviderCallback) {
		t.Fatalf("expected malformed signature rejection, got %v", err)
	}
	if len(repo.callbacks) != 0 {
		t.Fatalf("malformed signature must not credit wallet, got %#v", repo.callbacks)
	}
}

func TestPaymentServiceOldTimestampRejected(t *testing.T) {
	repo := &fakeWalletRepo{}
	provider := NewOneMoneyProvider("secret")
	service := NewService(repo, provider, fakePilotGate{enabled: true, eligible: true}, Config{ProviderEnabled: true, OneMoneyEnabled: true, OneMoneyPilotOnly: true})
	callback := secureProviderCallback(ProviderOneMoney, "evt-old", "OM-1", 2000)
	callback.Timestamp = time.Now().UTC().Add(-30 * time.Minute)
	callback.Signature = SignOneMoneyCallback("secret", callback)

	_, err := service.HandleOneMoneyCallback(context.Background(), callback)
	if !errors.Is(err, ErrInvalidProviderCallback) {
		t.Fatalf("expected old timestamp rejection, got %v", err)
	}
	if len(repo.callbacks) != 0 {
		t.Fatalf("old callback must not credit wallet, got %#v", repo.callbacks)
	}
}

func TestPaymentServiceUnsupportedEventRejected(t *testing.T) {
	repo := &fakeWalletRepo{}
	service := NewService(repo, NewOneMoneyProvider("secret"), fakePilotGate{enabled: true, eligible: true}, Config{ProviderEnabled: true, OneMoneyEnabled: true, OneMoneyPilotOnly: true})
	callback := secureProviderCallback(ProviderOneMoney, "evt-unsupported", "OM-1", 2000)
	callback.EventType = "account.updated"
	callback.Signature = SignOneMoneyCallback("secret", callback)

	_, err := service.HandleOneMoneyCallback(context.Background(), callback)
	if !errors.Is(err, ErrInvalidProviderCallback) {
		t.Fatalf("expected unsupported event rejection, got %v", err)
	}
	if len(repo.callbacks) != 0 {
		t.Fatalf("unsupported event must not credit wallet, got %#v", repo.callbacks)
	}
}

type fakeStatusProvider struct {
	*OneMoneyProvider
	status string
}

func (p fakeStatusProvider) GetTransactionStatus(ctx context.Context, providerReference string) (ProviderTransactionStatus, error) {
	return ProviderTransactionStatus{ProviderReference: providerReference, Status: p.status}, nil
}

func TestPaymentServiceProviderStatusMismatchRejected(t *testing.T) {
	repo := &fakeWalletRepo{}
	provider := fakeStatusProvider{OneMoneyProvider: NewOneMoneyProvider("secret"), status: "FAILED"}
	service := NewService(repo, provider, fakePilotGate{enabled: true, eligible: true}, Config{ProviderEnabled: true, OneMoneyEnabled: true, OneMoneyPilotOnly: true})
	callback := secureProviderCallback(ProviderOneMoney, "evt-status", "OM-1", 2000)

	_, err := service.HandleOneMoneyCallback(context.Background(), callback)
	if !errors.Is(err, ErrInvalidProviderCallback) {
		t.Fatalf("expected provider status mismatch rejection, got %v", err)
	}
	if len(repo.callbacks) != 0 {
		t.Fatalf("status mismatch must not credit wallet, got %#v", repo.callbacks)
	}
}

func TestHTTPStatusVerifierRequiresMatchingSuccessfulStatus(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer status-token" {
			t.Fatal("expected bearer status token")
		}
		if r.Header.Get("X-PickMe-Provider") != ProviderOneMoney {
			t.Fatal("expected provider header")
		}
		_, _ = w.Write([]byte(`{"provider_reference":"OM-1","status":"COMPLETED"}`))
	}))
	defer server.Close()

	verifier := NewHTTPStatusVerifier(server.URL, "status-token")
	status, err := verifier.GetTransactionStatus(context.Background(), ProviderOneMoney, "OM-1")
	if err != nil {
		t.Fatal(err)
	}
	if status.Status != ProviderStatusCompleted {
		t.Fatalf("expected completed status, got %#v", status)
	}
}

func TestHTTPStatusVerifierRejectsReferenceMismatch(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"provider_reference":"OM-other","status":"COMPLETED"}`))
	}))
	defer server.Close()

	verifier := NewHTTPStatusVerifier(server.URL, "")
	_, err := verifier.GetTransactionStatus(context.Background(), ProviderOneMoney, "OM-1")
	if !errors.Is(err, ErrInvalidProviderCallback) {
		t.Fatalf("expected reference mismatch rejection, got %v", err)
	}
}

func TestPaymentServiceDuplicateEventAndReferenceCreditOnce(t *testing.T) {
	repo := &fakeWalletRepo{}
	service := NewService(repo, NewOneMoneyProvider("secret"), fakePilotGate{enabled: true, eligible: true}, Config{ProviderEnabled: true, OneMoneyEnabled: true, OneMoneyPilotOnly: true})
	callback := secureProviderCallback(ProviderOneMoney, "evt-dup", "OM-1", 2000)

	if _, err := service.HandleOneMoneyCallback(context.Background(), callback); err != nil {
		t.Fatal(err)
	}
	if _, err := service.HandleOneMoneyCallback(context.Background(), callback); err != nil {
		t.Fatal(err)
	}
	secondEventSameReference := secureProviderCallback(ProviderOneMoney, "evt-dup-2", "OM-1", 2000)
	if _, err := service.HandleOneMoneyCallback(context.Background(), secondEventSameReference); err != nil {
		t.Fatal(err)
	}
	if len(repo.callbacks) != 1 {
		t.Fatalf("expected exactly one wallet credit, got %#v", repo.callbacks)
	}
}
