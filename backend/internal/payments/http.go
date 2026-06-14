package payments

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/gofiber/fiber/v2"

	"pickme-backend/internal/middleware"
	"pickme-backend/internal/wallet"
)

type OneMoneyService interface {
	CreateOneMoneyDepositIntent(ctx context.Context, req DepositIntentRequest) (DepositIntent, error)
	HandleOneMoneyCallback(ctx context.Context, callback ProviderCallback) (wallet.PaymentIntent, error)
	CreateEcoCashDepositIntent(ctx context.Context, req DepositIntentRequest) (DepositIntent, error)
	HandleEcoCashCallback(ctx context.Context, callback ProviderCallback) (wallet.PaymentIntent, error)
	CreateInnbucksDepositIntent(ctx context.Context, req DepositIntentRequest) (DepositIntent, error)
	HandleInnbucksCallback(ctx context.Context, callback ProviderCallback) (wallet.PaymentIntent, error)
	CreatePayPalDepositIntent(ctx context.Context, req DepositIntentRequest) (DepositIntent, error)
	HandlePayPalCallback(ctx context.Context, callback ProviderCallback) (wallet.PaymentIntent, error)
	CreateCardDeposit(ctx context.Context, req DepositIntentRequest) (DepositIntent, error)
	VoidCardPayment(ctx context.Context, req CardVoidRequest) (CardVoid, error)
	RefundCardPayment(ctx context.Context, req CardRefundRequest) (CardRefund, error)
}

type ReportReader interface {
	OneMoneySummary(ctx context.Context) (map[string]any, error)
	OneMoneyTransactions(ctx context.Context, limit int) ([]map[string]any, error)
	OneMoneyReconciliation(ctx context.Context, limit int) ([]map[string]any, error)
	OneMoneyFailures(ctx context.Context, limit int) ([]map[string]any, error)
	EcoCashSummary(ctx context.Context) (map[string]any, error)
	EcoCashTransactions(ctx context.Context, limit int) ([]map[string]any, error)
	EcoCashReconciliation(ctx context.Context, limit int) ([]map[string]any, error)
	EcoCashFailures(ctx context.Context, limit int) ([]map[string]any, error)
	InnbucksSummary(ctx context.Context) (map[string]any, error)
	InnbucksTransactions(ctx context.Context, limit int) ([]map[string]any, error)
	InnbucksReconciliation(ctx context.Context, limit int) ([]map[string]any, error)
	InnbucksFailures(ctx context.Context, limit int) ([]map[string]any, error)
	PayPalSummary(ctx context.Context) (map[string]any, error)
	PayPalTransactions(ctx context.Context, limit int) ([]map[string]any, error)
	PayPalReconciliation(ctx context.Context, limit int) ([]map[string]any, error)
	PayPalFailures(ctx context.Context, limit int) ([]map[string]any, error)
	CardSummary(ctx context.Context) (map[string]any, error)
	CardTransactions(ctx context.Context, limit int) ([]map[string]any, error)
	CardReconciliation(ctx context.Context, limit int) ([]map[string]any, error)
	CardFailures(ctx context.Context, limit int) ([]map[string]any, error)
}

func RegisterRoutes(app fiber.Router, service OneMoneyService, reports ReportReader, requireAuth fiber.Handler) {
	app.Post("/api/payments/onemoney/deposits", requireAuth, createOneMoneyDepositHandler(service))
	app.Post("/api/payments/onemoney/callback", oneMoneyCallbackHandler(service))
	app.Post("/api/payments/ecocash/deposits", requireAuth, createEcoCashDepositHandler(service))
	app.Post("/api/payments/ecocash/callback", ecoCashCallbackHandler(service))
	app.Post("/api/payments/innbucks/deposits", requireAuth, createInnbucksDepositHandler(service))
	app.Post("/api/payments/innbucks/callback", innbucksCallbackHandler(service))
	app.Post("/api/payments/paypal/deposits", requireAuth, createPayPalDepositHandler(service))
	app.Post("/api/payments/paypal/callback", payPalCallbackHandler(service))
	app.Post("/api/payments/cards/deposits", requireAuth, createCardDepositHandler(service))

	app.Get("/admin/payments/onemoney/summary", requireAuth, middleware.AdminOnly(), oneMoneySummaryHandler(reports))
	app.Get("/admin/payments/onemoney/transactions", requireAuth, middleware.AdminOnly(), oneMoneyTransactionsHandler(reports))
	app.Get("/admin/payments/onemoney/reconciliation", requireAuth, middleware.AdminOnly(), oneMoneyReconciliationHandler(reports))
	app.Get("/admin/payments/onemoney/failures", requireAuth, middleware.AdminOnly(), oneMoneyFailuresHandler(reports))
	app.Get("/admin/payments/ecocash/summary", requireAuth, middleware.AdminOnly(), ecoCashSummaryHandler(reports))
	app.Get("/admin/payments/ecocash/transactions", requireAuth, middleware.AdminOnly(), ecoCashTransactionsHandler(reports))
	app.Get("/admin/payments/ecocash/reconciliation", requireAuth, middleware.AdminOnly(), ecoCashReconciliationHandler(reports))
	app.Get("/admin/payments/ecocash/failures", requireAuth, middleware.AdminOnly(), ecoCashFailuresHandler(reports))
	app.Get("/admin/payments/innbucks/summary", requireAuth, middleware.AdminOnly(), innbucksSummaryHandler(reports))
	app.Get("/admin/payments/innbucks/transactions", requireAuth, middleware.AdminOnly(), innbucksTransactionsHandler(reports))
	app.Get("/admin/payments/innbucks/reconciliation", requireAuth, middleware.AdminOnly(), innbucksReconciliationHandler(reports))
	app.Get("/admin/payments/innbucks/failures", requireAuth, middleware.AdminOnly(), innbucksFailuresHandler(reports))
	app.Get("/admin/payments/paypal/summary", requireAuth, middleware.AdminOnly(), payPalSummaryHandler(reports))
	app.Get("/admin/payments/paypal/transactions", requireAuth, middleware.AdminOnly(), payPalTransactionsHandler(reports))
	app.Get("/admin/payments/paypal/reconciliation", requireAuth, middleware.AdminOnly(), payPalReconciliationHandler(reports))
	app.Get("/admin/payments/paypal/failures", requireAuth, middleware.AdminOnly(), payPalFailuresHandler(reports))
	app.Get("/admin/payments/cards/summary", requireAuth, middleware.AdminOnly(), cardSummaryHandler(reports))
	app.Get("/admin/payments/cards/transactions", requireAuth, middleware.AdminOnly(), cardTransactionsHandler(reports))
	app.Get("/admin/payments/cards/reconciliation", requireAuth, middleware.AdminOnly(), cardReconciliationHandler(reports))
	app.Get("/admin/payments/cards/failures", requireAuth, middleware.AdminOnly(), cardFailuresHandler(reports))
}

func createOneMoneyDepositHandler(service OneMoneyService) fiber.Handler {
	return func(c *fiber.Ctx) error {
		userID, ok := middleware.AuthenticatedUserID(c)
		if !ok {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Authentication required"})
		}
		var body struct {
			Amount         json.RawMessage `json:"amount"`
			Currency       string          `json:"currency"`
			City           string          `json:"city"`
			IdempotencyKey string          `json:"idempotency_key"`
		}
		if err := c.BodyParser(&body); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request body"})
		}
		amountMinor, err := parseJSONAmountMinor(body.Amount, body.Currency)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid amount"})
		}
		result, err := service.CreateOneMoneyDepositIntent(middleware.RequestContext(c), DepositIntentRequest{UserID: userID, AmountMinor: amountMinor, Currency: body.Currency, City: body.City, IdempotencyKey: body.IdempotencyKey})
		return paymentResult(c, fiber.StatusCreated, result, err)
	}
}

func oneMoneyCallbackHandler(service OneMoneyService) fiber.Handler {
	return func(c *fiber.Ctx) error {
		var body ProviderCallback
		if err := c.BodyParser(&body); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request body"})
		}
		if body.Signature == "" {
			body.Signature = c.Get("X-OneMoney-Signature")
		}
		body.RawPayload = string(c.Body())
		result, err := service.HandleOneMoneyCallback(middleware.RequestContext(c), body)
		return paymentResult(c, fiber.StatusOK, result, err)
	}
}

func createEcoCashDepositHandler(service OneMoneyService) fiber.Handler {
	return func(c *fiber.Ctx) error {
		userID, ok := middleware.AuthenticatedUserID(c)
		if !ok {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Authentication required"})
		}
		var body struct {
			Amount         json.RawMessage `json:"amount"`
			Currency       string          `json:"currency"`
			City           string          `json:"city"`
			IdempotencyKey string          `json:"idempotency_key"`
		}
		if err := c.BodyParser(&body); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request body"})
		}
		amountMinor, err := parseJSONAmountMinor(body.Amount, body.Currency)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid amount"})
		}
		result, err := service.CreateEcoCashDepositIntent(middleware.RequestContext(c), DepositIntentRequest{UserID: userID, AmountMinor: amountMinor, Currency: body.Currency, City: body.City, IdempotencyKey: body.IdempotencyKey})
		return paymentResult(c, fiber.StatusCreated, result, err)
	}
}

func ecoCashCallbackHandler(service OneMoneyService) fiber.Handler {
	return func(c *fiber.Ctx) error {
		var body ProviderCallback
		if err := c.BodyParser(&body); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request body"})
		}
		if body.Signature == "" {
			body.Signature = c.Get("X-EcoCash-Signature")
		}
		body.RawPayload = string(c.Body())
		result, err := service.HandleEcoCashCallback(middleware.RequestContext(c), body)
		return paymentResult(c, fiber.StatusOK, result, err)
	}
}

func createInnbucksDepositHandler(service OneMoneyService) fiber.Handler {
	return func(c *fiber.Ctx) error {
		userID, ok := middleware.AuthenticatedUserID(c)
		if !ok {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Authentication required"})
		}
		var body struct {
			Amount         json.RawMessage `json:"amount"`
			Currency       string          `json:"currency"`
			City           string          `json:"city"`
			IdempotencyKey string          `json:"idempotency_key"`
		}
		if err := c.BodyParser(&body); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request body"})
		}
		amountMinor, err := parseJSONAmountMinor(body.Amount, body.Currency)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid amount"})
		}
		result, err := service.CreateInnbucksDepositIntent(middleware.RequestContext(c), DepositIntentRequest{UserID: userID, AmountMinor: amountMinor, Currency: body.Currency, City: body.City, IdempotencyKey: body.IdempotencyKey})
		return paymentResult(c, fiber.StatusCreated, result, err)
	}
}

func innbucksCallbackHandler(service OneMoneyService) fiber.Handler {
	return func(c *fiber.Ctx) error {
		var body ProviderCallback
		if err := c.BodyParser(&body); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request body"})
		}
		if body.Signature == "" {
			body.Signature = c.Get("X-Innbucks-Signature")
		}
		body.RawPayload = string(c.Body())
		result, err := service.HandleInnbucksCallback(middleware.RequestContext(c), body)
		return paymentResult(c, fiber.StatusOK, result, err)
	}
}

func createPayPalDepositHandler(service OneMoneyService) fiber.Handler {
	return func(c *fiber.Ctx) error {
		userID, ok := middleware.AuthenticatedUserID(c)
		if !ok {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Authentication required"})
		}
		var body struct {
			Amount         json.RawMessage `json:"amount"`
			Currency       string          `json:"currency"`
			City           string          `json:"city"`
			IdempotencyKey string          `json:"idempotency_key"`
		}
		if err := c.BodyParser(&body); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request body"})
		}
		amountMinor, err := parseJSONAmountMinor(body.Amount, body.Currency)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid amount"})
		}
		result, err := service.CreatePayPalDepositIntent(middleware.RequestContext(c), DepositIntentRequest{UserID: userID, AmountMinor: amountMinor, Currency: body.Currency, City: body.City, IdempotencyKey: body.IdempotencyKey})
		return paymentResult(c, fiber.StatusCreated, result, err)
	}
}

func payPalCallbackHandler(service OneMoneyService) fiber.Handler {
	return func(c *fiber.Ctx) error {
		var body ProviderCallback
		if err := c.BodyParser(&body); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request body"})
		}
		if body.Signature == "" {
			body.Signature = c.Get("X-PayPal-Signature")
		}
		body.RawPayload = string(c.Body())
		result, err := service.HandlePayPalCallback(middleware.RequestContext(c), body)
		return paymentResult(c, fiber.StatusOK, result, err)
	}
}

func createCardDepositHandler(service OneMoneyService) fiber.Handler {
	return func(c *fiber.Ctx) error {
		userID, ok := middleware.AuthenticatedUserID(c)
		if !ok {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Authentication required"})
		}
		var body struct {
			Amount         json.RawMessage `json:"amount"`
			Currency       string          `json:"currency"`
			City           string          `json:"city"`
			IdempotencyKey string          `json:"idempotency_key"`
		}
		if err := c.BodyParser(&body); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request body"})
		}
		amountMinor, err := parseJSONAmountMinor(body.Amount, body.Currency)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid amount"})
		}
		result, err := service.CreateCardDeposit(middleware.RequestContext(c), DepositIntentRequest{UserID: userID, AmountMinor: amountMinor, Currency: body.Currency, City: body.City, IdempotencyKey: body.IdempotencyKey})
		return paymentResult(c, fiber.StatusCreated, result, err)
	}
}

func oneMoneySummaryHandler(reports ReportReader) fiber.Handler {
	return func(c *fiber.Ctx) error {
		result, err := reports.OneMoneySummary(middleware.RequestContext(c))
		return paymentResult(c, fiber.StatusOK, result, err)
	}
}

func oneMoneyTransactionsHandler(reports ReportReader) fiber.Handler {
	return func(c *fiber.Ctx) error {
		result, err := reports.OneMoneyTransactions(middleware.RequestContext(c), limitParam(c, 100))
		return paymentResult(c, fiber.StatusOK, result, err)
	}
}

func oneMoneyReconciliationHandler(reports ReportReader) fiber.Handler {
	return func(c *fiber.Ctx) error {
		result, err := reports.OneMoneyReconciliation(middleware.RequestContext(c), limitParam(c, 50))
		return paymentResult(c, fiber.StatusOK, result, err)
	}
}

func oneMoneyFailuresHandler(reports ReportReader) fiber.Handler {
	return func(c *fiber.Ctx) error {
		result, err := reports.OneMoneyFailures(middleware.RequestContext(c), limitParam(c, 100))
		return paymentResult(c, fiber.StatusOK, result, err)
	}
}

func ecoCashSummaryHandler(reports ReportReader) fiber.Handler {
	return func(c *fiber.Ctx) error {
		result, err := reports.EcoCashSummary(middleware.RequestContext(c))
		return paymentResult(c, fiber.StatusOK, result, err)
	}
}

func ecoCashTransactionsHandler(reports ReportReader) fiber.Handler {
	return func(c *fiber.Ctx) error {
		result, err := reports.EcoCashTransactions(middleware.RequestContext(c), limitParam(c, 100))
		return paymentResult(c, fiber.StatusOK, result, err)
	}
}

func ecoCashReconciliationHandler(reports ReportReader) fiber.Handler {
	return func(c *fiber.Ctx) error {
		result, err := reports.EcoCashReconciliation(middleware.RequestContext(c), limitParam(c, 50))
		return paymentResult(c, fiber.StatusOK, result, err)
	}
}

func ecoCashFailuresHandler(reports ReportReader) fiber.Handler {
	return func(c *fiber.Ctx) error {
		result, err := reports.EcoCashFailures(middleware.RequestContext(c), limitParam(c, 100))
		return paymentResult(c, fiber.StatusOK, result, err)
	}
}

func innbucksSummaryHandler(reports ReportReader) fiber.Handler {
	return func(c *fiber.Ctx) error {
		result, err := reports.InnbucksSummary(middleware.RequestContext(c))
		return paymentResult(c, fiber.StatusOK, result, err)
	}
}

func innbucksTransactionsHandler(reports ReportReader) fiber.Handler {
	return func(c *fiber.Ctx) error {
		result, err := reports.InnbucksTransactions(middleware.RequestContext(c), limitParam(c, 100))
		return paymentResult(c, fiber.StatusOK, result, err)
	}
}

func innbucksReconciliationHandler(reports ReportReader) fiber.Handler {
	return func(c *fiber.Ctx) error {
		result, err := reports.InnbucksReconciliation(middleware.RequestContext(c), limitParam(c, 50))
		return paymentResult(c, fiber.StatusOK, result, err)
	}
}

func innbucksFailuresHandler(reports ReportReader) fiber.Handler {
	return func(c *fiber.Ctx) error {
		result, err := reports.InnbucksFailures(middleware.RequestContext(c), limitParam(c, 100))
		return paymentResult(c, fiber.StatusOK, result, err)
	}
}

func payPalSummaryHandler(reports ReportReader) fiber.Handler {
	return func(c *fiber.Ctx) error {
		result, err := reports.PayPalSummary(middleware.RequestContext(c))
		return paymentResult(c, fiber.StatusOK, result, err)
	}
}

func payPalTransactionsHandler(reports ReportReader) fiber.Handler {
	return func(c *fiber.Ctx) error {
		result, err := reports.PayPalTransactions(middleware.RequestContext(c), limitParam(c, 100))
		return paymentResult(c, fiber.StatusOK, result, err)
	}
}

func payPalReconciliationHandler(reports ReportReader) fiber.Handler {
	return func(c *fiber.Ctx) error {
		result, err := reports.PayPalReconciliation(middleware.RequestContext(c), limitParam(c, 50))
		return paymentResult(c, fiber.StatusOK, result, err)
	}
}

func payPalFailuresHandler(reports ReportReader) fiber.Handler {
	return func(c *fiber.Ctx) error {
		result, err := reports.PayPalFailures(middleware.RequestContext(c), limitParam(c, 100))
		return paymentResult(c, fiber.StatusOK, result, err)
	}
}

func cardSummaryHandler(reports ReportReader) fiber.Handler {
	return func(c *fiber.Ctx) error {
		result, err := reports.CardSummary(middleware.RequestContext(c))
		return paymentResult(c, fiber.StatusOK, result, err)
	}
}

func cardTransactionsHandler(reports ReportReader) fiber.Handler {
	return func(c *fiber.Ctx) error {
		result, err := reports.CardTransactions(middleware.RequestContext(c), limitParam(c, 100))
		return paymentResult(c, fiber.StatusOK, result, err)
	}
}

func cardReconciliationHandler(reports ReportReader) fiber.Handler {
	return func(c *fiber.Ctx) error {
		result, err := reports.CardReconciliation(middleware.RequestContext(c), limitParam(c, 50))
		return paymentResult(c, fiber.StatusOK, result, err)
	}
}

func cardFailuresHandler(reports ReportReader) fiber.Handler {
	return func(c *fiber.Ctx) error {
		result, err := reports.CardFailures(middleware.RequestContext(c), limitParam(c, 100))
		return paymentResult(c, fiber.StatusOK, result, err)
	}
}

func paymentResult(c *fiber.Ctx, status int, result any, err error) error {
	if err != nil {
		switch {
		case errors.Is(err, wallet.ErrWalletPilotDisabled):
			return c.Status(fiber.StatusLocked).JSON(fiber.Map{"error": "wallet_pilot_disabled"})
		case errors.Is(err, wallet.ErrWalletPilotLimitExceeded):
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "wallet_pilot_limit_exceeded"})
		case errors.Is(err, wallet.ErrWalletPilotNotAuthorized):
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "wallet_pilot_not_authorized"})
		case errors.Is(err, wallet.ErrPilotAccessDenied):
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "Payment provider pilot access required"})
		case errors.Is(err, ErrPaymentsDisabled), errors.Is(err, ErrProviderDisabled):
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "Payment provider is disabled"})
		case errors.Is(err, ErrInvalidProviderCallback):
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Invalid provider callback"})
		default:
			return c.Status(fiber.StatusConflict).JSON(fiber.Map{"error": "Payment operation could not be completed"})
		}
	}
	return c.Status(status).JSON(result)
}

func limitParam(c *fiber.Ctx, fallback int) int {
	value := c.QueryInt("limit", fallback)
	if value <= 0 {
		return fallback
	}
	if value > 500 {
		return 500
	}
	return value
}
