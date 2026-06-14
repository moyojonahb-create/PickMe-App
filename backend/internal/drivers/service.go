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
				UPDATE public.driver_sessions
				SET is_online = false
				WHERE is_online = true
				AND last_seen < NOW() - INTERVAL '2 minutes'
				`,
			)

			if err != nil {
				log.Println("Driver cleanup worker error:", err)
			}

			time.Sleep(30 * time.Second)
		}
	}()
}
