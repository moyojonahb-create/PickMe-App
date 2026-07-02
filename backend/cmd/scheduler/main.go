package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/hibiken/asynq"

	"pickme-backend/internal/config"
	"pickme-backend/internal/observability"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatal(err)
	}
	obsShutdown, err := observability.Init(context.Background(), observability.Config{
		ServiceName:  "pickme-scheduler",
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

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, os.Interrupt, syscall.SIGTERM)

	if !cfg.Jobs.Enabled {
		log.Println("PickMe Asynq scheduler disabled because ASYNQ_ENABLED=false")
		<-quit
		log.Println("Scheduler shutdown signal received")
		return
	}
	if cfg.Jobs.RedisURL == "" {
		log.Fatal("Asynq scheduler requires ASYNQ_REDIS_URL or REDIS_URL")
	}

	redisOpt, err := asynq.ParseRedisURI(cfg.Jobs.RedisURL)
	if err != nil {
		log.Fatal("Asynq scheduler Redis configuration failed:", err)
	}
	scheduler := asynq.NewScheduler(redisOpt, &asynq.SchedulerOpts{Location: time.UTC})
	done := make(chan error, 1)
	go func() {
		done <- scheduler.Run()
	}()

	log.Println("PickMe Asynq scheduler running; no recurring jobs are registered in this release")
	select {
	case sig := <-quit:
		log.Println("Scheduler shutdown signal received:", sig)
	case err := <-done:
		if err != nil {
			log.Fatal("Asynq scheduler stopped:", err)
		}
		log.Println("Asynq scheduler stopped")
	}
	scheduler.Shutdown()
}
