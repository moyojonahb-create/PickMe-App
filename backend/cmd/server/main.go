package main

import (
	"context"
	"errors"
	"log"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"

	"pickme-backend/internal/auth"
	"pickme-backend/internal/authz"
	"pickme-backend/internal/config"
	"pickme-backend/internal/database"
	"pickme-backend/internal/dispatch"
	"pickme-backend/internal/drivers"
	"pickme-backend/internal/geo"
	"pickme-backend/internal/middleware"
	"pickme-backend/internal/payments"
	redisclient "pickme-backend/internal/redis"
	"pickme-backend/internal/reputation"
	"pickme-backend/internal/rides"
	"pickme-backend/internal/wallet"
	"pickme-backend/internal/websocket"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatal(err)
	}

	dbpool, err := database.NewPool(cfg.DatabaseURL)
	if err != nil {
		log.Fatal("Database connection failed:", err)
	}
	defer dbpool.Close()

	// Wire drivers repository pool for authorization repository lookups.
	drivers.SetRepositoryPool(dbpool)

	// Create driver authorization service (single source of truth for driver eligibility).
	authzSvc := authz.NewDriverAuthorizationService()

	redisClient, err := redisclient.NewClient(cfg.Redis)
	if err != nil {
		log.Println("Redis disabled due to configuration error:", err)
		redisClient, _ = redisclient.NewClient(config.RedisConfig{Enabled: false})
	}
	if redisClient != nil {
		defer func() {
			if err := redisClient.Close(); err != nil {
				log.Println("Redis close error:", err)
			}
		}()
	}
	geoService := geo.NewService(redisClient, geo.Config{
		LocationTTL: time.Duration(cfg.Redis.DriverLocationTTLSeconds) * time.Second,
		PresenceTTL: time.Duration(cfg.Redis.DriverPresenceTTLSeconds) * time.Second,
	})
	dispatchService := dispatch.NewService(dispatch.Config{
		Mode:           cfg.Dispatch.Mode,
		RadiusKM:       cfg.Dispatch.ShadowRadiusKM,
		CandidateLimit: cfg.Dispatch.CandidateLimit,
		SelectedLimit:  cfg.Dispatch.SelectedLimit,
		RankingVersion: cfg.Dispatch.RankingVersion,
	}, dispatch.NewGeoCandidateProvider(geoService), dispatch.NewPostgresRepository(dbpool))
	reputationRepo := reputation.NewPostgresRepository(dbpool)
	reputationService := reputation.NewService(reputationRepo)
	walletRepo := wallet.NewPostgresRepository(dbpool)
	publicWalletPilotService := wallet.NewPublicWalletPilotService(walletRepo)
	publicWalletPilotEnforcer := wallet.NewPublicWalletPilotRuntimeEnforcer(publicWalletPilotService, wallet.PublicWalletPilotEnforcementConfig{
		Enabled:         cfg.Wallet.PublicWalletPilotEnabled,
		ProgramID:       cfg.Wallet.PublicWalletPilotProgramID,
		City:            cfg.Wallet.PublicWalletPilotCity,
		DefaultCurrency: wallet.CurrencyUSD,
	})
	shadowSettlementService := wallet.NewShadowSettlementService(walletRepo)
	activeCashSettlementService := wallet.NewActiveCashSettlementService(walletRepo, wallet.ActiveSettlementConfig{
		Enabled:     cfg.Wallet.ActiveSettlementEnabled,
		CashEnabled: cfg.Wallet.ActiveCashSettlementEnabled,
	})
	walletAuthorizationService := wallet.NewAuthorizationService(walletRepo, wallet.AuthorizationConfig{
		Enabled:         cfg.Wallet.RideAuthorizationEnabled,
		HoldTTL:         time.Duration(cfg.Wallet.RideAuthorizationTTLMinutes) * time.Minute,
		DefaultCurrency: wallet.CurrencyUSD,
	}).WithWalletPilotEnforcer(publicWalletPilotEnforcer)
	walletReconciliationService := wallet.NewReconciliationService(walletRepo)
	walletPilotService := wallet.NewPilotService(walletRepo, wallet.PilotConfig{
		Enabled:    cfg.Wallet.InternalPilotEnabled,
		Percentage: cfg.Wallet.InternalPilotPercentage,
	})
	walletAdminFlowService := wallet.NewAdminFlowService(walletRepo).WithWalletPilotEnforcer(publicWalletPilotEnforcer)
	walletRecoveryService := wallet.NewRecoveryService(walletRepo)
	oneMoneyStatusVerifier, err := providerStatusVerifierForConfig(cfg, payments.ProviderOneMoney)
	if err != nil {
		log.Printf("SECURITY_PAYMENT_PROVIDER_MISCONFIGURATION provider=%s reason=%s app_env=%s timestamp=%s", payments.ProviderOneMoney, err.Error(), cfg.AppEnv, time.Now().UTC().Format(time.RFC3339))
		log.Fatal(err)
	}
	ecoCashStatusVerifier, err := providerStatusVerifierForConfig(cfg, payments.ProviderEcoCash)
	if err != nil {
		log.Printf("SECURITY_PAYMENT_PROVIDER_MISCONFIGURATION provider=%s reason=%s app_env=%s timestamp=%s", payments.ProviderEcoCash, err.Error(), cfg.AppEnv, time.Now().UTC().Format(time.RFC3339))
		log.Fatal(err)
	}
	innbucksStatusVerifier, err := providerStatusVerifierForConfig(cfg, payments.ProviderInnbucks)
	if err != nil {
		log.Printf("SECURITY_PAYMENT_PROVIDER_MISCONFIGURATION provider=%s reason=%s app_env=%s timestamp=%s", payments.ProviderInnbucks, err.Error(), cfg.AppEnv, time.Now().UTC().Format(time.RFC3339))
		log.Fatal(err)
	}
	payPalStatusVerifier, err := providerStatusVerifierForConfig(cfg, payments.ProviderPayPal)
	if err != nil {
		log.Printf("SECURITY_PAYMENT_PROVIDER_MISCONFIGURATION provider=%s reason=%s app_env=%s timestamp=%s", payments.ProviderPayPal, err.Error(), cfg.AppEnv, time.Now().UTC().Format(time.RFC3339))
		log.Fatal(err)
	}
	oneMoneyProvider := payments.NewOneMoneyProvider(cfg.Payments.OneMoneySecret).WithStatusVerifier(oneMoneyStatusVerifier)
	ecoCashProvider := payments.NewEcoCashProvider(cfg.Payments.EcoCashSecret).WithStatusVerifier(ecoCashStatusVerifier)
	innbucksProvider := payments.NewInnbucksProvider(cfg.Payments.InnbucksSecret).WithStatusVerifier(innbucksStatusVerifier)
	payPalProvider := payments.NewPayPalProvider(cfg.Payments.PayPalSecret).WithStatusVerifier(payPalStatusVerifier)
	cardProcessor, err := cardProcessorForConfig(cfg)
	if err != nil {
		log.Printf("SECURITY_PAYMENT_PROVIDER_MISCONFIGURATION provider=card reason=%s app_env=%s timestamp=%s", err.Error(), cfg.AppEnv, time.Now().UTC().Format(time.RFC3339))
		log.Fatal(err)
	}
	paymentService := payments.NewServiceWithCardProcessor(walletRepo, walletPilotService, payments.Config{
		ProviderEnabled:     cfg.Payments.ProviderEnabled,
		OneMoneyEnabled:     cfg.Payments.OneMoneyEnabled,
		OneMoneyPilotOnly:   cfg.Payments.OneMoneyPilotOnly,
		EcoCashEnabled:      cfg.Payments.EcoCashEnabled,
		EcoCashPilotOnly:    cfg.Payments.EcoCashPilotOnly,
		InnbucksEnabled:     cfg.Payments.InnbucksEnabled,
		InnbucksPilotOnly:   cfg.Payments.InnbucksPilotOnly,
		PayPalEnabled:       cfg.Payments.PayPalEnabled,
		PayPalPilotOnly:     cfg.Payments.PayPalPilotOnly,
		CardPaymentsEnabled: cfg.Payments.CardPaymentsEnabled,
		CardPilotOnly:       cfg.Payments.CardPilotOnly,
	}, cardProcessor, oneMoneyProvider, ecoCashProvider, innbucksProvider, payPalProvider).WithWalletPilotEnforcer(publicWalletPilotEnforcer)
	if cfg.Wallet.AuthorizationExpirationWorkerEnabled {
		walletAuthorizationService.StartExpirationWorker(
			context.Background(),
			time.Duration(cfg.Wallet.AuthorizationExpirationIntervalSeconds)*time.Second,
			cfg.Wallet.AuthorizationExpirationBatchLimit,
		)
	}

	wsManager := websocket.NewManager()
	driverRegistry := websocket.NewConnectionRegistry()
	riderRegistry := websocket.NewConnectionRegistry()

	driverService := drivers.NewService(dbpool)
	driverService.StartCleanupWorker()

	jwtVerifier, err := auth.NewSupabaseJWT(cfg.Auth)
	if err != nil {
		log.Fatal(err)
	}
	requireAuth := middleware.SupabaseJWT(jwtVerifier)

	app := fiber.New(fiber.Config{
		ReadTimeout:  time.Duration(cfg.HTTP.RequestTimeoutSeconds) * time.Second,
		WriteTimeout: time.Duration(cfg.HTTP.RequestTimeoutSeconds) * time.Second,
		IdleTimeout:  2 * time.Duration(cfg.HTTP.RequestTimeoutSeconds) * time.Second,
	})
	app.Use(middleware.RequestID())
	app.Use(middleware.Recover())
	app.Use(middleware.RequestTimeout(time.Duration(cfg.HTTP.RequestTimeoutSeconds) * time.Second))
	app.Use(middleware.GlobalRateLimit(middleware.RateLimitConfig{
		Max:    cfg.HTTP.RateLimitMax,
		Window: time.Duration(cfg.HTTP.RateLimitWindowSecs) * time.Second,
	}))
	app.Use(middleware.Observability())
	app.Use(middleware.CORS(cfg.CORS))
	app.Use("/ws", websocket.NewHandler(wsManager, riderRegistry, driverRegistry, jwtVerifier, websocket.NewPostgresRoomAuthorizer(dbpool), authzSvc))

	app.Get("/", func(c *fiber.Ctx) error {
		return c.JSON(fiber.Map{"message": "PickMe Go Backend Running 🚖"})
	})

	app.Get("/health", database.HealthHandler())
	app.Get("/health/redis", redisclient.HealthHandler(redisClient))
	app.Get("/test-db", database.TestHandler(dbpool))

	rideHandler := rides.NewHandler(rides.NewDB(dbpool), wsManager, riderRegistry, driverRegistry, dispatchService, reputationService, shadowSettlementService, activeCashSettlementService, walletAuthorizationService, walletPilotService, publicWalletPilotEnforcer, authzSvc)
	driverHandler := drivers.NewHandler(dbpool, wsManager, geoService, reputationService, authzSvc)

	rides.RegisterRoutes(app, rideHandler, requireAuth)
	rides.RegisterCompatibilityRoutes(app, rideHandler, requireAuth)
	drivers.RegisterRoutes(app, driverHandler, requireAuth)
	drivers.RegisterCompatibilityRoutes(app, driverHandler, requireAuth)
	dispatch.RegisterShadowAdminRoutes(app, dispatch.NewPostgresReports(dbpool), requireAuth)
	reputation.RegisterAdminRoutes(app, reputation.NewPostgresReports(dbpool), requireAuth)
	reputation.RegisterCalibrationAdminRoutes(app, reputation.NewPostgresReports(dbpool), requireAuth)
	wallet.RegisterAdminRoutes(app, wallet.NewPostgresReports(dbpool), requireAuth)
	wallet.RegisterOperationRoutes(app, walletAdminFlowService, walletAuthorizationService, walletReconciliationService, walletPilotService, walletRecoveryService, wallet.NewPostgresReports(dbpool), requireAuth)
	payments.RegisterRoutes(app, paymentService, payments.NewReports(dbpool), requireAuth)

	log.Println("PickMe Go Backend running on port", cfg.Port)
	log.Fatal(app.Listen(":" + cfg.Port))
}

func cardProcessorForConfig(cfg config.Config) (payments.CardProcessor, error) {
	if !cfg.Payments.CardPaymentsEnabled {
		return nil, nil
	}
	if !explicitDevelopmentMode(cfg.AppEnv) {
		return nil, errors.New("mock card processor cannot be enabled outside explicit development mode")
	}
	return payments.NewMockCardProcessor(), nil
}

func explicitDevelopmentMode(appEnv string) bool {
	switch strings.ToLower(strings.TrimSpace(appEnv)) {
	case "development", "dev", "local":
		return true
	default:
		return false
	}
}

func providerStatusVerifierForConfig(cfg config.Config, provider string) (payments.StatusVerifier, error) {
	statusURL, statusToken, enabled := providerStatusConfig(cfg, provider)
	if !enabled {
		return payments.StaticStatusVerifier{Status: payments.ProviderStatusCompleted}, nil
	}
	if statusURL == "" {
		if explicitDevelopmentMode(cfg.AppEnv) {
			return payments.StaticStatusVerifier{Status: payments.ProviderStatusCompleted}, nil
		}
		return nil, errors.New("provider status verification endpoint is required outside explicit development mode")
	}
	return payments.NewHTTPStatusVerifier(statusURL, statusToken), nil
}

func providerStatusConfig(cfg config.Config, provider string) (string, string, bool) {
	switch provider {
	case payments.ProviderOneMoney:
		return cfg.Payments.OneMoneyStatusURL, cfg.Payments.OneMoneyStatusToken, cfg.Payments.OneMoneyEnabled
	case payments.ProviderEcoCash:
		return cfg.Payments.EcoCashStatusURL, cfg.Payments.EcoCashStatusToken, cfg.Payments.EcoCashEnabled
	case payments.ProviderInnbucks:
		return cfg.Payments.InnbucksStatusURL, cfg.Payments.InnbucksStatusToken, cfg.Payments.InnbucksEnabled
	case payments.ProviderPayPal:
		return cfg.Payments.PayPalStatusURL, cfg.Payments.PayPalStatusToken, cfg.Payments.PayPalEnabled
	default:
		return "", "", false
	}
}
