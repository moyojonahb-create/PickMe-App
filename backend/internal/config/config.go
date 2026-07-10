package config

import (
	"errors"
	"os"
	"strconv"
	"strings"

	"github.com/joho/godotenv"
)

type Config struct {
	DatabaseURL      string
	Port             string
	AppEnv           string
	ReadinessProfile string
	CORS             CORSConfig
	HTTP             HTTPConfig
	Auth             AuthConfig
	Redis            RedisConfig
	Dispatch         DispatchConfig
	Wallet           WalletConfig
	Payments         PaymentsConfig
	Observability    ObservabilityConfig
	Jobs             JobsConfig
	Notification     NotificationConfig
	Deployment       DeploymentConfig
}

type CORSConfig struct {
	AllowOrigins string
	AllowMethods string
	AllowHeaders string
}

type HTTPConfig struct {
	RequestTimeoutSeconds int
	RateLimitMax          int
	RateLimitWindowSecs   int
}

type AuthConfig struct {
	SupabaseURL       string
	SupabaseJWTSecret string
	Audience          string
	Issuer            string
}

type RedisConfig struct {
	URL                      string
	Enabled                  bool
	DriverLocationTTLSeconds int
	DriverPresenceTTLSeconds int
	PoolSize                 int
}

type DispatchConfig struct {
	Mode                 string
	ShadowRadiusKM       float64
	CandidateLimit       int
	SelectedLimit        int
	RankingVersion       string
	OfferTTLSeconds      int
	RideLockTTLSeconds   int
	DriverLockTTLSeconds int
	QueueName            string
}

type WalletConfig struct {
	ActiveSettlementEnabled                bool
	ActiveCashSettlementEnabled            bool
	RideAuthorizationEnabled               bool
	RideAuthorizationTTLMinutes            int
	AuthorizationExpirationWorkerEnabled   bool
	AuthorizationExpirationIntervalSeconds int
	AuthorizationExpirationBatchLimit      int
	InternalPilotEnabled                   bool
	InternalPilotPercentage                int
	PublicWalletPilotEnabled               bool
	PublicWalletPilotProgramID             string
	PublicWalletPilotCity                  string
}

type PaymentsConfig struct {
	ProviderEnabled     bool
	OneMoneyEnabled     bool
	OneMoneyPilotOnly   bool
	OneMoneySecret      string
	OneMoneyStatusURL   string
	OneMoneyStatusToken string
	EcoCashEnabled      bool
	EcoCashPilotOnly    bool
	EcoCashSecret       string
	EcoCashStatusURL    string
	EcoCashStatusToken  string
	InnbucksEnabled     bool
	InnbucksPilotOnly   bool
	InnbucksSecret      string
	InnbucksStatusURL   string
	InnbucksStatusToken string
	PayPalEnabled       bool
	PayPalPilotOnly     bool
	PayPalSecret        string
	PayPalStatusURL     string
	PayPalStatusToken   string
	CardPaymentsEnabled bool
	CardPilotOnly       bool
}

type ObservabilityConfig struct {
	SentryDSN            string
	SentryEnvironment    string
	SentryRelease        string
	OTELEnabled          bool
	OTLPExporterEndpoint string
}

type JobsConfig struct {
	Enabled                bool
	RedisURL               string
	Concurrency            int
	RetryMax               int
	ShutdownTimeoutSeconds int
}

type NotificationConfig struct {
	RateLimitPerMinute int
	FCMEndpoint        string
	FCMToken           string
	SMSEndpoint        string
	SMSToken           string
	EmailEndpoint      string
	EmailToken         string
}

// DeploymentConfig carries operator-declared facts about how this process is
// being run. It does not enable or configure clustering — it exists only so
// the backend can warn loudly when it is told it's one of several replicas,
// since the in-memory WebSocket driver/rider registries and the in-memory
// rate-limit fallback are per-process only. See
// docs/deployment/websocket-scaling.md for the full constraint.
type DeploymentConfig struct {
	InstanceCount int
}

func Load() (Config, error) {
	_ = godotenv.Load()

	appEnv := envOrDefault("APP_ENV", "production")

	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		return Config{}, errors.New("DATABASE_URL is missing in .env")
	}
	if !isExplicitDevelopmentAppEnv(appEnv) && !hasRequiredDatabaseSSLMode(databaseURL) {
		return Config{}, errors.New("DATABASE_URL must include sslmode=require, sslmode=verify-full, or sslmode=verify-ca when APP_ENV is not development, dev, or local")
	}

	port := os.Getenv("PORT")
	if port == "" {
		port = "3000"
	}

	corsAllowOrigins := os.Getenv("CORS_ALLOW_ORIGINS")
	if corsAllowOrigins == "" {
		if isExplicitDevelopmentAppEnv(appEnv) {
			corsAllowOrigins = "http://localhost:8080,http://localhost:5173"
		} else {
			return Config{}, errors.New("CORS_ALLOW_ORIGINS is required when APP_ENV is not development, dev, or local")
		}
	}

	supabaseURL := os.Getenv("SUPABASE_URL")
	jwtIssuer := os.Getenv("SUPABASE_JWT_ISSUER")
	if supabaseURL == "" && jwtIssuer == "" && !isExplicitDevelopmentAppEnv(appEnv) {
		return Config{}, errors.New("SUPABASE_URL or SUPABASE_JWT_ISSUER is required when APP_ENV is not development, dev, or local")
	}
	auth := AuthConfig{
		SupabaseURL:       supabaseURL,
		SupabaseJWTSecret: os.Getenv("SUPABASE_JWT_SECRET"),
		Audience:          envOrDefault("SUPABASE_JWT_AUDIENCE", "authenticated"),
		Issuer:            jwtIssuer,
	}
	if auth.Issuer == "" && supabaseURL != "" {
		auth.Issuer = supabaseURL + "/auth/v1"
	}

	redis := RedisConfig{
		URL:                      os.Getenv("REDIS_URL"),
		Enabled:                  envBool("REDIS_ENABLED", false),
		DriverLocationTTLSeconds: envInt("REDIS_DRIVER_LOCATION_TTL_SECONDS", 60),
		DriverPresenceTTLSeconds: envInt("REDIS_DRIVER_PRESENCE_TTL_SECONDS", 90),
		PoolSize:                 envInt("REDIS_POOL_SIZE", 16),
	}
	dispatch := DispatchConfig{
		Mode:                 envOrDefault("DISPATCH_MODE", "off"),
		ShadowRadiusKM:       envFloat("DISPATCH_SHADOW_RADIUS_KM", 5),
		CandidateLimit:       envInt("DISPATCH_SHADOW_CANDIDATE_LIMIT", 20),
		SelectedLimit:        envInt("DISPATCH_SHADOW_SELECTED_LIMIT", 3),
		RankingVersion:       envOrDefault("DISPATCH_SHADOW_RANKING_VERSION", "v2.0-b-simple"),
		OfferTTLSeconds:      envInt("DISPATCH_OFFER_TTL_SECONDS", 30),
		RideLockTTLSeconds:   envInt("DISPATCH_RIDE_LOCK_TTL_SECONDS", 45),
		DriverLockTTLSeconds: envInt("DISPATCH_DRIVER_LOCK_TTL_SECONDS", 45),
		QueueName:            envOrDefault("DISPATCH_QUEUE_NAME", "dispatch:rides"),
	}
	wallet := WalletConfig{
		ActiveSettlementEnabled:                envBool("WALLET_ACTIVE_SETTLEMENT_ENABLED", false),
		ActiveCashSettlementEnabled:            envBool("WALLET_ACTIVE_CASH_SETTLEMENT_ENABLED", false),
		RideAuthorizationEnabled:               envBool("WALLET_RIDE_AUTHORIZATION_ENABLED", false),
		RideAuthorizationTTLMinutes:            envInt("WALLET_RIDE_AUTHORIZATION_TTL_MINUTES", 30),
		AuthorizationExpirationWorkerEnabled:   envBool("WALLET_AUTHORIZATION_EXPIRATION_WORKER_ENABLED", false),
		AuthorizationExpirationIntervalSeconds: envInt("WALLET_AUTHORIZATION_EXPIRATION_INTERVAL_SECONDS", 60),
		AuthorizationExpirationBatchLimit:      envInt("WALLET_AUTHORIZATION_EXPIRATION_BATCH_LIMIT", 100),
		InternalPilotEnabled:                   envBool("WALLET_INTERNAL_PILOT_ENABLED", false),
		InternalPilotPercentage:                envPercent("WALLET_INTERNAL_PILOT_PERCENTAGE", 0),
		PublicWalletPilotEnabled:               envBool("PUBLIC_WALLET_PILOT_ENABLED", false),
		PublicWalletPilotProgramID:             os.Getenv("PUBLIC_WALLET_PILOT_PROGRAM_ID"),
		PublicWalletPilotCity:                  envOrDefault("PUBLIC_WALLET_PILOT_CITY", "Gwanda"),
	}
	payments := PaymentsConfig{
		ProviderEnabled:     envBool("PAYMENTS_PROVIDER_ENABLED", false),
		OneMoneyEnabled:     envBool("ONEMONEY_ENABLED", false),
		OneMoneyPilotOnly:   envBool("ONEMONEY_PILOT_ONLY", true),
		OneMoneySecret:      os.Getenv("ONEMONEY_WEBHOOK_SECRET"),
		OneMoneyStatusURL:   os.Getenv("ONEMONEY_STATUS_URL"),
		OneMoneyStatusToken: os.Getenv("ONEMONEY_STATUS_TOKEN"),
		EcoCashEnabled:      envBool("ECOCASH_ENABLED", false),
		EcoCashPilotOnly:    envBool("ECOCASH_PILOT_ONLY", true),
		EcoCashSecret:       os.Getenv("ECOCASH_WEBHOOK_SECRET"),
		EcoCashStatusURL:    os.Getenv("ECOCASH_STATUS_URL"),
		EcoCashStatusToken:  os.Getenv("ECOCASH_STATUS_TOKEN"),
		InnbucksEnabled:     envBool("INNBUCKS_ENABLED", false),
		InnbucksPilotOnly:   envBool("INNBUCKS_PILOT_ONLY", true),
		InnbucksSecret:      os.Getenv("INNBUCKS_WEBHOOK_SECRET"),
		InnbucksStatusURL:   os.Getenv("INNBUCKS_STATUS_URL"),
		InnbucksStatusToken: os.Getenv("INNBUCKS_STATUS_TOKEN"),
		PayPalEnabled:       envBool("PAYPAL_ENABLED", false),
		PayPalPilotOnly:     envBool("PAYPAL_PILOT_ONLY", true),
		PayPalSecret:        os.Getenv("PAYPAL_WEBHOOK_SECRET"),
		PayPalStatusURL:     os.Getenv("PAYPAL_STATUS_URL"),
		PayPalStatusToken:   os.Getenv("PAYPAL_STATUS_TOKEN"),
		CardPaymentsEnabled: envBool("CARD_PAYMENTS_ENABLED", false),
		CardPilotOnly:       envBool("CARD_PILOT_ONLY", true),
	}
	observability := ObservabilityConfig{
		SentryDSN:            os.Getenv("SENTRY_DSN"),
		SentryEnvironment:    envOrDefault("SENTRY_ENVIRONMENT", envOrDefault("APP_ENV", "production")),
		SentryRelease:        os.Getenv("SENTRY_RELEASE"),
		OTELEnabled:          envBool("OTEL_ENABLED", false),
		OTLPExporterEndpoint: os.Getenv("OTEL_EXPORTER_OTLP_ENDPOINT"),
	}
	jobs := JobsConfig{
		Enabled:                envBool("ASYNQ_ENABLED", redis.Enabled),
		RedisURL:               envOrDefault("ASYNQ_REDIS_URL", redis.URL),
		Concurrency:            envInt("ASYNQ_CONCURRENCY", 10),
		RetryMax:               envInt("ASYNQ_RETRY_MAX", 5),
		ShutdownTimeoutSeconds: envInt("ASYNQ_SHUTDOWN_TIMEOUT_SECONDS", 30),
	}
	notification := NotificationConfig{
		RateLimitPerMinute: envInt("NOTIFICATION_RATE_LIMIT_PER_MINUTE", 60),
		FCMEndpoint:        os.Getenv("NOTIFICATION_FCM_ENDPOINT"),
		FCMToken:           os.Getenv("NOTIFICATION_FCM_TOKEN"),
		SMSEndpoint:        os.Getenv("NOTIFICATION_SMS_ENDPOINT"),
		SMSToken:           os.Getenv("NOTIFICATION_SMS_TOKEN"),
		EmailEndpoint:      os.Getenv("NOTIFICATION_EMAIL_ENDPOINT"),
		EmailToken:         os.Getenv("NOTIFICATION_EMAIL_TOKEN"),
	}
	deployment := DeploymentConfig{
		InstanceCount: envInt("BACKEND_INSTANCE_COUNT", 1),
	}

	return Config{
		DatabaseURL:      databaseURL,
		Port:             port,
		AppEnv:           appEnv,
		ReadinessProfile: envOrDefault("READINESS_PROFILE", envOrDefault("APP_PROFILE", appEnv)),
		CORS: CORSConfig{
			AllowOrigins: corsAllowOrigins,
			AllowMethods: "GET,POST,PUT,DELETE,OPTIONS",
			AllowHeaders: "Origin, Content-Type, Accept, Authorization",
		},
		HTTP: HTTPConfig{
			RequestTimeoutSeconds: envInt("HTTP_REQUEST_TIMEOUT_SECONDS", 15),
			RateLimitMax:          envInt("HTTP_RATE_LIMIT_MAX", 120),
			RateLimitWindowSecs:   envInt("HTTP_RATE_LIMIT_WINDOW_SECONDS", 60),
		},
		Auth:          auth,
		Redis:         redis,
		Dispatch:      dispatch,
		Wallet:        wallet,
		Payments:      payments,
		Observability: observability,
		Jobs:          jobs,
		Notification:  notification,
		Deployment:    deployment,
	}, nil
}

// isExplicitDevelopmentAppEnv mirrors the explicit-development-mode convention
// used elsewhere in this backend (e.g. mock card processor, payment status
// verifier fallbacks): only these values are treated as safe to relax
// production-grade requirements for.
func isExplicitDevelopmentAppEnv(appEnv string) bool {
	switch strings.ToLower(strings.TrimSpace(appEnv)) {
	case "development", "dev", "local":
		return true
	default:
		return false
	}
}

// hasRequiredDatabaseSSLMode reports whether databaseURL declares one of the
// sslmode values that actually enforces a TLS connection to Postgres.
// sslmode=prefer/allow silently fall back to plaintext if TLS negotiation
// fails, so they are deliberately not accepted here. This works against
// both URL-style (postgres://...?sslmode=require) and keyword/value
// (host=... sslmode=require) connection strings, since both spell the
// keyword as a literal "sslmode=" substring.
func hasRequiredDatabaseSSLMode(databaseURL string) bool {
	lower := strings.ToLower(databaseURL)
	for _, mode := range []string{"sslmode=require", "sslmode=verify-full", "sslmode=verify-ca"} {
		if strings.Contains(lower, mode) {
			return true
		}
	}
	return false
}

func envOrDefault(key, fallback string) string {
	value := os.Getenv(key)
	if value == "" {
		return fallback
	}
	return value
}

func envBool(key string, fallback bool) bool {
	value := os.Getenv(key)
	if value == "" {
		return fallback
	}
	parsed, err := strconv.ParseBool(value)
	if err != nil {
		return fallback
	}
	return parsed
}

func envInt(key string, fallback int) int {
	value := os.Getenv(key)
	if value == "" {
		return fallback
	}
	parsed, err := strconv.Atoi(value)
	if err != nil || parsed <= 0 {
		return fallback
	}
	return parsed
}

func envFloat(key string, fallback float64) float64 {
	value := os.Getenv(key)
	if value == "" {
		return fallback
	}
	parsed, err := strconv.ParseFloat(value, 64)
	if err != nil || parsed <= 0 {
		return fallback
	}
	return parsed
}

func envPercent(key string, fallback int) int {
	value := os.Getenv(key)
	if value == "" {
		return fallback
	}
	parsed, err := strconv.Atoi(value)
	if err != nil || parsed < 0 {
		return fallback
	}
	if parsed > 100 {
		return 100
	}
	return parsed
}
