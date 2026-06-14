package wallet

import (
	"context"
	"hash/fnv"
)

type PilotConfig struct {
	Enabled    bool
	Percentage int
}

type PilotRepository interface {
	GetPilotUser(ctx context.Context, userID string) (PilotUser, error)
	SetPilotUser(ctx context.Context, change PilotUserChange) (PilotUser, error)
}

type PilotService struct {
	repo   PilotRepository
	config PilotConfig
}

func NewPilotService(repo PilotRepository, config PilotConfig) *PilotService {
	if config.Percentage < 0 {
		config.Percentage = 0
	}
	if config.Percentage > 100 {
		config.Percentage = 100
	}
	return &PilotService{repo: repo, config: config}
}

func (s *PilotService) Enabled() bool {
	return s != nil && s.config.Enabled
}

func (s *PilotService) IsPilotEligible(ctx context.Context, userID string, role string) bool {
	if !s.Enabled() {
		return true
	}
	if userID == "" {
		return false
	}
	if s.repo != nil {
		user, err := s.repo.GetPilotUser(ctx, userID)
		if err == nil {
			if user.Status != PilotStatusEnabled {
				return false
			}
			return user.Role == role || user.Role == PilotRoleAdmin
		}
	}
	return s.config.Percentage > 0 && pilotBucket(userID) < s.config.Percentage
}

func (s *PilotService) SetPilotUser(ctx context.Context, change PilotUserChange) (PilotUser, error) {
	if change.Role == "" {
		change.Role = PilotRoleRider
	}
	if change.Status == "" {
		change.Status = PilotStatusEnabled
	}
	return s.repo.SetPilotUser(ctx, change)
}

func pilotBucket(userID string) int {
	h := fnv.New32a()
	_, _ = h.Write([]byte(userID))
	return int(h.Sum32() % 100)
}
