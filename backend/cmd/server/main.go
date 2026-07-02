package main

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/gofiber/fiber/v2"

	"pickme-backend/internal/auth"
	"pickme-backend/internal/authz"
	"pickme-backend/internal/business"
	"pickme-backend/internal/config"
	"pickme-backend/internal/database"
	"pickme-backend/internal/dispatch"
	"pickme-backend/internal/drivers"
	"pickme-backend/internal/geo"
	"pickme-backend/internal/jobs"
	"pickme-backend/internal/middleware"
	"pickme-backend/internal/notification"
	"pickme-backend/internal/observability"
	"pickme-backend/internal/payments"
	"pickme-backend/internal/readiness"
	redisclient "pickme-backend/internal/redis"
	"pickme-backend/internal/reputation"
	"pickme-backend/internal/rides"
	"pickme-backend/internal/risk"
	"pickme-backend/internal/wallet"
	"pickme-backend/internal/websocket"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatal(err)
	}
	obsShutdown, err := observability.Init(context.Background(), observability.Config{
		ServiceName:  "pickme-backend",
		Environment:  cfg.Observability.SentryEnvironment,
		Release:      cfg.Observability.SentryRelease,
		SentryDSN:    cfg.Observability.SentryDSN,
		OTELEnabled:  cfg.Observability.OTELEnabled,
		OTLPEndpoint: cfg.Observability.OTLPExporterEndpoint,
	})
	if err != nil {
		log.Fatal("Observability initialization failed:", err)
	}
	defer func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := obsShutdown(ctx); err != nil {
			log.Println("Observability shutdown error:", err)
		}
	}()

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
	jobRuntime, err := jobs.NewRuntime(jobs.Config{
		Enabled:                cfg.Jobs.Enabled,
		RedisURL:               cfg.Jobs.RedisURL,
		Concurrency:            cfg.Jobs.Concurrency,
		RetryMax:               cfg.Jobs.RetryMax,
		ShutdownTimeoutSeconds: cfg.Jobs.ShutdownTimeoutSeconds,
	})
	if err != nil {
		log.Fatal("Asynq initialization failed:", err)
	}
	defer func() {
		ctx, cancel := context.WithTimeout(context.Background(), time.Duration(cfg.Jobs.ShutdownTimeoutSeconds)*time.Second)
		defer cancel()
		if err := jobRuntime.Shutdown(ctx); err != nil {
			log.Println("Asynq shutdown error:", err)
		}
	}()
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
		OfferTTL:       time.Duration(cfg.Dispatch.OfferTTLSeconds) * time.Second,
		RideLockTTL:    time.Duration(cfg.Dispatch.RideLockTTLSeconds) * time.Second,
		DriverLockTTL:  time.Duration(cfg.Dispatch.DriverLockTTLSeconds) * time.Second,
		QueueName:      cfg.Dispatch.QueueName,
	}, dispatch.NewGeoCandidateProvider(geoService), dispatch.NewPostgresRepository(dbpool)).
		WithQueue(redisClient).
		WithLocker(redisClient)
	reputationRepo := reputation.NewPostgresRepository(dbpool)
	reputationService := reputation.NewService(reputationRepo)
	walletRepo := wallet.NewPostgresRepository(dbpool)
	riskRepo := risk.NewPostgresRepository(dbpool)
	riskService := risk.NewService(riskRepo, redisClient, jobRuntime.Client())
	notificationRepo := notification.NewPostgresRepository(dbpool)
	notificationService := notification.NewService(notificationRepo, jobRuntime.Client(), notification.Providers{
		Push: notification.NewHTTPProvider(notification.HTTPProviderConfig{
			Name:     "firebase_fcm",
			Endpoint: cfg.Notification.FCMEndpoint,
			Token:    cfg.Notification.FCMToken,
		}),
		SMS: notification.NewHTTPProvider(notification.HTTPProviderConfig{
			Name:     "sms_provider",
			Endpoint: cfg.Notification.SMSEndpoint,
			Token:    cfg.Notification.SMSToken,
		}),
		Email: notification.NewHTTPProvider(notification.HTTPProviderConfig{
			Name:     "email_provider",
			Endpoint: cfg.Notification.EmailEndpoint,
			Token:    cfg.Notification.EmailToken,
		}),
	}, notification.ServiceConfig{RateLimitPerMinute: cfg.Notification.RateLimitPerMinute})
	readinessChecker := readiness.NewChecker(readiness.Config{
		Postgres:             dbpool,
		Redis:                redisClient,
		Jobs:                 jobRuntime,
		Profile:              cfg.ReadinessProfile,
		DispatchMode:         cfg.Dispatch.Mode,
		NotificationFCM:      cfg.Notification.FCMEndpoint,
		NotificationSMS:      cfg.Notification.SMSEndpoint,
		NotificationEmail:    cfg.Notification.EmailEndpoint,
		QueueSaturationLimit: 10000,
	})
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

	wsManager := websocket.NewManager().WithPubSub(redisClient)
	wsManager.StartPubSub(context.Background())
	driverRegistry := websocket.NewConnectionRegistry()
	riderRegistry := websocket.NewConnectionRegistry()
	dispatchService.WithOfferNotifier(dispatch.OfferNotifierFunc(func(ctx context.Context, offer dispatch.DriverOffer, ride dispatch.RideContext, expiresAt time.Time) {
		driverSocket, exists := driverRegistry.Get(offer.DriverID)
		if !exists {
			return
		}
		payload, err := json.Marshal(fiber.Map{
			"event":                "ride_offer",
			"offer_id":             offer.OfferID,
			"ride_id":              ride.RideID,
			"rider_id":             ride.RiderID,
			"pickup_location":      ride.PickupLocation,
			"dropoff_location":     ride.DropoffLocation,
			"estimated_fare":       wallet.MinorDecimalString(offer.AmountMinor, wallet.CurrencyUSD),
			"estimated_fare_minor": offer.AmountMinor,
			"payment_method":       "cash",
			"eta_minutes":          offer.ETAMinutes,
			"expires_at":           expiresAt,
		})
		if err != nil {
			log.Println("Authoritative dispatch offer marshal warning:", err)
			return
		}
		if !wsManager.Send(driverSocket, payload) {
			driverRegistry.Delete(offer.DriverID)
		}
	}))

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
		Store:  redisClient,
	}))
	app.Use(observability.HTTPMiddleware())
	app.Use(middleware.Observability())
	app.Use(middleware.CORS(cfg.CORS))
	app.Use("/ws", websocket.NewHandler(wsManager, riderRegistry, driverRegistry, jwtVerifier, websocket.NewPostgresRoomAuthorizer(dbpool), authzSvc))

	app.Get("/", func(c *fiber.Ctx) error {
		return c.JSON(fiber.Map{"message": "PickMe Go Backend Running 🚖"})
	})

	app.Get("/health", database.HealthHandler())
	app.Get("/health/live", readiness.LiveHandler())
	app.Get("/health/ready", readiness.ReadyHandler(readinessChecker))
	app.Get("/health/dependencies", readiness.DependenciesHandler(readinessChecker))
	app.Get("/health/redis", redisclient.HealthHandler(redisClient))
	adminOnly := middleware.AdminOnlyWithDB(dbpool)
	if explicitDevelopmentMode(cfg.AppEnv) {
		app.Get("/test-db", database.TestHandler(dbpool, true))
		app.Get("/metrics", observability.MetricsHandler)
	} else {
		app.Get("/test-db", requireAuth, adminOnly, database.TestHandler(dbpool, false))
		app.Get("/metrics", requireAuth, adminOnly, observability.MetricsHandler)
	}

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
	jobs.RegisterAdminRoutes(app, jobRuntime, requireAuth)
	notification.RegisterRoutes(app, notificationService, requireAuth)
	risk.RegisterRoutes(app, riskService, requireAuth)
	business.RegisterRoutes(app, dbpool, requireAuth)

	go func() {
		quit := make(chan os.Signal, 1)
		signal.Notify(quit, os.Interrupt, syscall.SIGTERM)
		<-quit
		log.Println("Shutdown signal received")
		ctx, cancel := context.WithTimeout(context.Background(), time.Duration(cfg.Jobs.ShutdownTimeoutSeconds)*time.Second)
		defer cancel()
		if err := jobRuntime.Shutdown(ctx); err != nil {
			log.Println("Asynq shutdown error:", err)
		}
		if err := app.Shutdown(); err != nil {
			log.Println("Fiber shutdown error:", err)
		}
	}()

	log.Println("PickMe Go Backend running on port", cfg.Port)
	if err := app.Listen(":" + cfg.Port); err != nil {
		log.Fatal(err)
	}
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
