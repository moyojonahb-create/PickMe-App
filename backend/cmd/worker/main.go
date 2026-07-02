package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"

	"pickme-backend/internal/config"
	"pickme-backend/internal/database"
	"pickme-backend/internal/jobs"
	"pickme-backend/internal/notification"
	"pickme-backend/internal/observability"
	redisclient "pickme-backend/internal/redis"
	"pickme-backend/internal/risk"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatal(err)
	}
	obsShutdown, err := observability.Init(context.Background(), observability.Config{
		ServiceName:  "pickme-worker",
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
	if !jobRuntime.Enabled() {
		log.Fatal("Asynq worker requires ASYNQ_ENABLED=true and a Redis URL")
	}

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

	riskRepo := risk.NewPostgresRepository(dbpool)
	riskService := risk.NewService(riskRepo, redisClient, jobRuntime.Client())

	jobRuntime.HandleFunc(jobs.TypePushNotification, notificationService.ProcessJob(jobs.TypePushNotification))
	jobRuntime.HandleFunc(jobs.TypeSMSNotification, notificationService.ProcessJob(jobs.TypeSMSNotification))
	jobRuntime.HandleFunc(jobs.TypeEmailNotification, notificationService.ProcessJob(jobs.TypeEmailNotification))
	jobRuntime.HandleFunc(jobs.TypeFraudScan, riskService.ProcessScan(jobs.TypeFraudScan))
	jobRuntime.HandleFunc(jobs.TypeRiskRecalculateUser, riskService.ProcessScan(jobs.TypeRiskRecalculateUser))
	jobRuntime.HandleFunc(jobs.TypeRiskMultiAccount, riskService.ProcessScan(jobs.TypeRiskMultiAccount))
	jobRuntime.HandleFunc(jobs.TypeRiskWalletAbuse, riskService.ProcessScan(jobs.TypeRiskWalletAbuse))
	jobRuntime.HandleFunc(jobs.TypeRiskStudentAbuse, riskService.ProcessScan(jobs.TypeRiskStudentAbuse))
	jobRuntime.HandleFunc(jobs.TypeRiskGPSSpoofing, riskService.ProcessScan(jobs.TypeRiskGPSSpoofing))
	jobRuntime.Start()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, os.Interrupt, syscall.SIGTERM)

	log.Println("PickMe Asynq worker running")
	select {
	case sig := <-quit:
		log.Println("Worker shutdown signal received:", sig)
	case err := <-jobRuntime.Done():
		if err != nil {
			log.Fatal("Asynq worker stopped:", err)
		}
		log.Println("Asynq worker stopped")
	}

	ctx, cancel := context.WithTimeout(context.Background(), time.Duration(cfg.Jobs.ShutdownTimeoutSeconds)*time.Second)
	defer cancel()
	if err := jobRuntime.Shutdown(ctx); err != nil {
		log.Println("Asynq shutdown error:", err)
	}
}
