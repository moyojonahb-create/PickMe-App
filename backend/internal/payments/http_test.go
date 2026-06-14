package payments

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gofiber/fiber/v2"

	"pickme-backend/internal/middleware"
	"pickme-backend/internal/wallet"
)

type fakeOneMoneyService struct {
	createdOneMoney bool
	createdEcoCash  bool
	createdInnbucks bool
	createdPayPal   bool
	createdCard     bool
	callbacks       []ProviderCallback
	err             error
}

type fakePaymentReports struct{}

func (s *fakeOneMoneyService) CreateOneMoneyDepositIntent(ctx context.Context, req DepositIntentRequest) (DepositIntent, error) {
	s.createdOneMoney = true
	if s.err != nil {
		return DepositIntent{}, s.err
	}
	return DepositIntent{ID: "intent-1", UserID: req.UserID, Provider: ProviderOneMoney, ProviderReference: "OM-1", AmountMinor: req.AmountMinor, Currency: req.Currency, Status: wallet.DepositStatusPendingProvider, IdempotencyKey: req.IdempotencyKey}, nil
}

func (s *fakeOneMoneyService) HandleOneMoneyCallback(ctx context.Context, callback ProviderCallback) (wallet.PaymentIntent, error) {
	s.callbacks = append(s.callbacks, callback)
	if s.err != nil {
		return wallet.PaymentIntent{}, s.err
	}
	return wallet.PaymentIntent{ID: "intent-1", Provider: wallet.ProviderOneMoney, ProviderReference: callback.ProviderReference, Status: wallet.DepositStatusCompleted}, nil
}

func (s *fakeOneMoneyService) CreateEcoCashDepositIntent(ctx context.Context, req DepositIntentRequest) (DepositIntent, error) {
	s.createdEcoCash = true
	if s.err != nil {
		return DepositIntent{}, s.err
	}
	return DepositIntent{ID: "intent-1", UserID: req.UserID, Provider: ProviderEcoCash, ProviderReference: "EC-1", AmountMinor: req.AmountMinor, Currency: req.Currency, Status: wallet.DepositStatusPendingProvider, IdempotencyKey: req.IdempotencyKey}, nil
}

func (s *fakeOneMoneyService) HandleEcoCashCallback(ctx context.Context, callback ProviderCallback) (wallet.PaymentIntent, error) {
	s.callbacks = append(s.callbacks, callback)
	if s.err != nil {
		return wallet.PaymentIntent{}, s.err
	}
	return wallet.PaymentIntent{ID: "intent-1", Provider: wallet.ProviderEcoCash, ProviderReference: callback.ProviderReference, Status: wallet.DepositStatusCompleted}, nil
}

func (s *fakeOneMoneyService) CreateInnbucksDepositIntent(ctx context.Context, req DepositIntentRequest) (DepositIntent, error) {
	s.createdInnbucks = true
	if s.err != nil {
		return DepositIntent{}, s.err
	}
	return DepositIntent{ID: "intent-1", UserID: req.UserID, Provider: ProviderInnbucks, ProviderReference: "IB-1", AmountMinor: req.AmountMinor, Currency: req.Currency, Status: wallet.DepositStatusPendingProvider, IdempotencyKey: req.IdempotencyKey}, nil
}

func (s *fakeOneMoneyService) HandleInnbucksCallback(ctx context.Context, callback ProviderCallback) (wallet.PaymentIntent, error) {
	s.callbacks = append(s.callbacks, callback)
	if s.err != nil {
		return wallet.PaymentIntent{}, s.err
	}
	return wallet.PaymentIntent{ID: "intent-1", Provider: wallet.ProviderInnbucks, ProviderReference: callback.ProviderReference, Status: wallet.DepositStatusCompleted}, nil
}

func (s *fakeOneMoneyService) CreatePayPalDepositIntent(ctx context.Context, req DepositIntentRequest) (DepositIntent, error) {
	s.createdPayPal = true
	if s.err != nil {
		return DepositIntent{}, s.err
	}
	return DepositIntent{ID: "intent-1", UserID: req.UserID, Provider: ProviderPayPal, ProviderReference: "PP-1", AmountMinor: req.AmountMinor, Currency: req.Currency, Status: wallet.DepositStatusPendingProvider, IdempotencyKey: req.IdempotencyKey}, nil
}

func (s *fakeOneMoneyService) HandlePayPalCallback(ctx context.Context, callback ProviderCallback) (wallet.PaymentIntent, error) {
	s.callbacks = append(s.callbacks, callback)
	if s.err != nil {
		return wallet.PaymentIntent{}, s.err
	}
	return wallet.PaymentIntent{ID: "intent-1", Provider: wallet.ProviderPayPal, ProviderReference: callback.ProviderReference, Status: wallet.DepositStatusCompleted}, nil
}

func (s *fakeOneMoneyService) CreateCardDeposit(ctx context.Context, req DepositIntentRequest) (DepositIntent, error) {
	s.createdCard = true
	if s.err != nil {
		return DepositIntent{}, s.err
	}
	return DepositIntent{ID: "intent-1", UserID: req.UserID, Provider: ProviderCard, ProviderReference: "CARD-1", AmountMinor: req.AmountMinor, Currency: req.Currency, Status: wallet.DepositStatusCompleted, IdempotencyKey: req.IdempotencyKey}, nil
}

func (s *fakeOneMoneyService) VoidCardPayment(ctx context.Context, req CardVoidRequest) (CardVoid, error) {
	if s.err != nil {
		return CardVoid{}, s.err
	}
	return CardVoid{VoidID: "void-1", ProcessorReference: req.ProcessorReference, Status: CardStatusVoided, IdempotencyKey: req.IdempotencyKey}, nil
}

func (s *fakeOneMoneyService) RefundCardPayment(ctx context.Context, req CardRefundRequest) (CardRefund, error) {
	if s.err != nil {
		return CardRefund{}, s.err
	}
	return CardRefund{RefundID: "refund-1", ProcessorReference: req.ProcessorReference, AmountMinor: req.AmountMinor, Currency: req.Currency, Status: CardStatusRefunded, IdempotencyKey: req.IdempotencyKey}, nil
}

func (r fakePaymentReports) OneMoneySummary(ctx context.Context) (map[string]any, error) {
	return map[string]any{"completed_intents": 1}, nil
}

func (r fakePaymentReports) OneMoneyTransactions(ctx context.Context, limit int) ([]map[string]any, error) {
	return []map[string]any{{"provider_reference": "OM-1"}}, nil
}

func (r fakePaymentReports) OneMoneyReconciliation(ctx context.Context, limit int) ([]map[string]any, error) {
	return []map[string]any{{"status": "completed"}}, nil
}

func (r fakePaymentReports) OneMoneyFailures(ctx context.Context, limit int) ([]map[string]any, error) {
	return []map[string]any{{"status": "ignored"}}, nil
}

func (r fakePaymentReports) EcoCashSummary(ctx context.Context) (map[string]any, error) {
	return map[string]any{"completed_intents": 1}, nil
}

func (r fakePaymentReports) EcoCashTransactions(ctx context.Context, limit int) ([]map[string]any, error) {
	return []map[string]any{{"provider_reference": "EC-1"}}, nil
}

func (r fakePaymentReports) EcoCashReconciliation(ctx context.Context, limit int) ([]map[string]any, error) {
	return []map[string]any{{"status": "completed"}}, nil
}

func (r fakePaymentReports) EcoCashFailures(ctx context.Context, limit int) ([]map[string]any, error) {
	return []map[string]any{{"status": "ignored"}}, nil
}

func (r fakePaymentReports) InnbucksSummary(ctx context.Context) (map[string]any, error) {
	return map[string]any{"completed_intents": 1}, nil
}

func (r fakePaymentReports) InnbucksTransactions(ctx context.Context, limit int) ([]map[string]any, error) {
	return []map[string]any{{"provider_reference": "IB-1"}}, nil
}

func (r fakePaymentReports) InnbucksReconciliation(ctx context.Context, limit int) ([]map[string]any, error) {
	return []map[string]any{{"status": "completed"}}, nil
}

func (r fakePaymentReports) InnbucksFailures(ctx context.Context, limit int) ([]map[string]any, error) {
	return []map[string]any{{"status": "ignored"}}, nil
}

func (r fakePaymentReports) CardSummary(ctx context.Context) (map[string]any, error) {
	return map[string]any{"completed_intents": 1}, nil
}

func (r fakePaymentReports) CardTransactions(ctx context.Context, limit int) ([]map[string]any, error) {
	return []map[string]any{{"provider_reference": "CARD-1"}}, nil
}

func (r fakePaymentReports) CardReconciliation(ctx context.Context, limit int) ([]map[string]any, error) {
	return []map[string]any{{"status": "completed"}}, nil
}

func (r fakePaymentReports) CardFailures(ctx context.Context, limit int) ([]map[string]any, error) {
	return []map[string]any{{"status": "ignored"}}, nil
}

func (r fakePaymentReports) PayPalSummary(ctx context.Context) (map[string]any, error) {
	return map[string]any{"completed_intents": 1}, nil
}

func (r fakePaymentReports) PayPalTransactions(ctx context.Context, limit int) ([]map[string]any, error) {
	return []map[string]any{{"provider_reference": "PP-1"}}, nil
}

func (r fakePaymentReports) PayPalReconciliation(ctx context.Context, limit int) ([]map[string]any, error) {
	return []map[string]any{{"status": "completed"}}, nil
}

func (r fakePaymentReports) PayPalFailures(ctx context.Context, limit int) ([]map[string]any, error) {
	return []map[string]any{{"status": "ignored"}}, nil
}

func TestOneMoneyDepositEndpoint(t *testing.T) {
	service := &fakeOneMoneyService{}
	app := fiber.New()
	RegisterRoutes(app, service, fakePaymentReports{}, authAs("rider-1", "authenticated"))

	resp := paymentHTTPTestRequest(t, app, http.MethodPost, "/api/payments/onemoney/deposits", map[string]any{"amount": 10, "currency": wallet.CurrencyUSD, "idempotency_key": "onemoney-intent-1"}, "")
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("expected 201, got %d", resp.StatusCode)
	}
	if !service.createdOneMoney {
		t.Fatal("expected deposit intent service call")
	}
}

func TestEcoCashDepositEndpoint(t *testing.T) {
	service := &fakeOneMoneyService{}
	app := fiber.New()
	RegisterRoutes(app, service, fakePaymentReports{}, authAs("rider-1", "authenticated"))

	resp := paymentHTTPTestRequest(t, app, http.MethodPost, "/api/payments/ecocash/deposits", map[string]any{"amount": 10, "currency": wallet.CurrencyUSD, "idempotency_key": "ecocash-intent-1"}, "")
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("expected 201, got %d", resp.StatusCode)
	}
	if !service.createdEcoCash {
		t.Fatal("expected EcoCash deposit intent service call")
	}
}

func TestInnbucksDepositEndpoint(t *testing.T) {
	service := &fakeOneMoneyService{}
	app := fiber.New()
	RegisterRoutes(app, service, fakePaymentReports{}, authAs("rider-1", "authenticated"))

	resp := paymentHTTPTestRequest(t, app, http.MethodPost, "/api/payments/innbucks/deposits", map[string]any{"amount": 10, "currency": wallet.CurrencyUSD, "idempotency_key": "innbucks-intent-1"}, "")
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("expected 201, got %d", resp.StatusCode)
	}
	if !service.createdInnbucks {
		t.Fatal("expected Innbucks deposit intent service call")
	}
}

func TestCardDepositEndpoint(t *testing.T) {
	service := &fakeOneMoneyService{}
	app := fiber.New()
	RegisterRoutes(app, service, fakePaymentReports{}, authAs("rider-1", "authenticated"))

	resp := paymentHTTPTestRequest(t, app, http.MethodPost, "/api/payments/cards/deposits", map[string]any{"amount": 10, "currency": wallet.CurrencyUSD, "idempotency_key": "card-intent-1"}, "")
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("expected 201, got %d", resp.StatusCode)
	}
	if !service.createdCard {
		t.Fatal("expected card deposit service call")
	}
}

func TestPayPalDepositEndpoint(t *testing.T) {
	service := &fakeOneMoneyService{}
	app := fiber.New()
	RegisterRoutes(app, service, fakePaymentReports{}, authAs("rider-1", "authenticated"))

	resp := paymentHTTPTestRequest(t, app, http.MethodPost, "/api/payments/paypal/deposits", map[string]any{"amount": 10, "currency": wallet.CurrencyUSD, "idempotency_key": "paypal-intent-1"}, "")
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("expected 201, got %d", resp.StatusCode)
	}
	if !service.createdPayPal {
		t.Fatal("expected PayPal deposit intent service call")
	}
}

func TestOneMoneyCallbackEndpointUsesSignatureHeader(t *testing.T) {
	service := &fakeOneMoneyService{}
	app := fiber.New()
	RegisterRoutes(app, service, fakePaymentReports{}, authAs("rider-1", "authenticated"))

	resp := paymentHTTPTestRequest(t, app, http.MethodPost, "/api/payments/onemoney/callback", map[string]any{"provider_event_id": "evt-1", "provider_reference": "OM-1", "amount": 10, "currency": wallet.CurrencyUSD, "status": CallbackStatusPaid}, "sig-1")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}
	if len(service.callbacks) != 1 || service.callbacks[0].Signature != "sig-1" {
		t.Fatalf("expected signature header to be used, got %#v", service.callbacks)
	}
}

func TestEcoCashCallbackEndpointUsesSignatureHeader(t *testing.T) {
	service := &fakeOneMoneyService{}
	app := fiber.New()
	RegisterRoutes(app, service, fakePaymentReports{}, authAs("rider-1", "authenticated"))

	resp := paymentHTTPTestRequestWithHeader(t, app, http.MethodPost, "/api/payments/ecocash/callback", map[string]any{"provider_event_id": "evt-1", "provider_reference": "EC-1", "amount": 10, "currency": wallet.CurrencyUSD, "status": CallbackStatusPaid}, "X-EcoCash-Signature", "eco-sig-1")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}
	if len(service.callbacks) != 1 || service.callbacks[0].Signature != "eco-sig-1" {
		t.Fatalf("expected EcoCash signature header to be used, got %#v", service.callbacks)
	}
}

func TestInnbucksCallbackEndpointUsesSignatureHeader(t *testing.T) {
	service := &fakeOneMoneyService{}
	app := fiber.New()
	RegisterRoutes(app, service, fakePaymentReports{}, authAs("rider-1", "authenticated"))

	resp := paymentHTTPTestRequestWithHeader(t, app, http.MethodPost, "/api/payments/innbucks/callback", map[string]any{"provider_event_id": "evt-1", "provider_reference": "IB-1", "amount": 10, "currency": wallet.CurrencyUSD, "status": CallbackStatusPaid}, "X-Innbucks-Signature", "ib-sig-1")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}
	if len(service.callbacks) != 1 || service.callbacks[0].Signature != "ib-sig-1" {
		t.Fatalf("expected Innbucks signature header to be used, got %#v", service.callbacks)
	}
}

func TestPayPalCallbackEndpointUsesSignatureHeader(t *testing.T) {
	service := &fakeOneMoneyService{}
	app := fiber.New()
	RegisterRoutes(app, service, fakePaymentReports{}, authAs("rider-1", "authenticated"))

	resp := paymentHTTPTestRequestWithHeader(t, app, http.MethodPost, "/api/payments/paypal/callback", map[string]any{"provider_event_id": "evt-1", "provider_reference": "PP-1", "amount": 10, "currency": wallet.CurrencyUSD, "status": CallbackStatusPaid}, "X-PayPal-Signature", "paypal-sig-1")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}
	if len(service.callbacks) != 1 || service.callbacks[0].Signature != "paypal-sig-1" {
		t.Fatalf("expected PayPal signature header to be used, got %#v", service.callbacks)
	}
}

func TestOneMoneyPilotGateErrorMapsToForbidden(t *testing.T) {
	service := &fakeOneMoneyService{err: wallet.ErrPilotAccessDenied}
	app := fiber.New()
	RegisterRoutes(app, service, fakePaymentReports{}, authAs("rider-1", "authenticated"))

	resp := paymentHTTPTestRequest(t, app, http.MethodPost, "/api/payments/onemoney/deposits", map[string]any{"amount": 10, "currency": wallet.CurrencyUSD, "idempotency_key": "onemoney-intent-1"}, "")
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("expected 403, got %d", resp.StatusCode)
	}
}

func TestOneMoneyAdminReports(t *testing.T) {
	app := fiber.New()
	RegisterRoutes(app, &fakeOneMoneyService{}, fakePaymentReports{}, authAs("admin-1", "admin"))
	for _, path := range []string{
		"/admin/payments/onemoney/summary",
		"/admin/payments/onemoney/transactions",
		"/admin/payments/onemoney/reconciliation",
		"/admin/payments/onemoney/failures",
		"/admin/payments/ecocash/summary",
		"/admin/payments/ecocash/transactions",
		"/admin/payments/ecocash/reconciliation",
		"/admin/payments/ecocash/failures",
		"/admin/payments/innbucks/summary",
		"/admin/payments/innbucks/transactions",
		"/admin/payments/innbucks/reconciliation",
		"/admin/payments/innbucks/failures",
		"/admin/payments/paypal/summary",
		"/admin/payments/paypal/transactions",
		"/admin/payments/paypal/reconciliation",
		"/admin/payments/paypal/failures",
		"/admin/payments/cards/summary",
		"/admin/payments/cards/transactions",
		"/admin/payments/cards/reconciliation",
		"/admin/payments/cards/failures",
	} {
		resp := paymentHTTPTestRequest(t, app, http.MethodGet, path, nil, "")
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("expected %s 200, got %d", path, resp.StatusCode)
		}
	}
}

func TestPaymentAdminRoutesRequireAdminRole(t *testing.T) {
	for _, tc := range []struct {
		name string
		role string
	}{
		{name: "rider", role: "authenticated"},
		{name: "driver", role: "driver"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			app := fiber.New()
			RegisterRoutes(app, &fakeOneMoneyService{}, fakePaymentReports{}, authAs(tc.name+"-1", tc.role))

			resp := paymentHTTPTestRequest(t, app, http.MethodGet, "/admin/payments/onemoney/summary", nil, "")
			assertAdminNotAuthorized(t, resp)
		})
	}
}

func authAs(userID string, role string) fiber.Handler {
	return func(c *fiber.Ctx) error {
		c.Locals(middleware.LocalsAuthSubject, userID)
		c.Locals(middleware.LocalsAuthRole, role)
		return c.Next()
	}
}

func assertAdminNotAuthorized(t *testing.T, resp *http.Response) {
	t.Helper()
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("expected 403, got %d", resp.StatusCode)
	}
	var body map[string]string
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if body["error"] != "admin_not_authorized" {
		t.Fatalf("expected admin_not_authorized, got %#v", body)
	}
}

func paymentHTTPTestRequest(t *testing.T, app *fiber.App, method string, path string, body any, signature string) *http.Response {
	return paymentHTTPTestRequestWithHeader(t, app, method, path, body, "X-OneMoney-Signature", signature)
}

func paymentHTTPTestRequestWithHeader(t *testing.T, app *fiber.App, method string, path string, body any, signatureHeader string, signature string) *http.Response {
	t.Helper()
	var reader *bytes.Reader
	if body != nil {
		payload, err := json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
		reader = bytes.NewReader(payload)
	} else {
		reader = bytes.NewReader(nil)
	}
	req := httptest.NewRequest(method, path, reader)
	req.Header.Set("Content-Type", "application/json")
	if signature != "" {
		req.Header.Set(signatureHeader, signature)
	}
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	return resp
}
