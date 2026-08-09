package drivers

import (
	"context"
	"log"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

type Service struct {
	db *pgxpool.Pool
}

func NewService(db *pgxpool.Pool) *Service {
	return &Service{db: db}
}

func (s *Service) StartCleanupWorker() {
	go func() {
		for {
			_, err := s.db.Exec(
				context.Background(),
				`
				UPDATE public.drivers
				SET is_online = false, updated_at = NOW()
				WHERE is_online = true
				AND updated_at < NOW() - INTERVAL '2 minutes'
				`,
			)

			if err != nil {
				log.Println("Driver cleanup worker error:", err)
			}

			_, err = s.db.Exec(
				context.Background(),
				`
				UPDATE public.live_locations
				SET is_online = false, updated_at = NOW()
				WHERE is_online = true
				AND updated_at < NOW() - INTERVAL '2 minutes'
				`,
			)

			if err != nil {
				log.Println("Driver cleanup worker error:", err)
			}

			time.Sleep(30 * time.Second)
		}
	}()
}
