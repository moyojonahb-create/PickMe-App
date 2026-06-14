package dispatch

import (
	"context"
	"errors"
	"log"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
)

type CandidateProvider interface {
	NearbyCandidates(ctx context.Context, ride RideContext, radiusKM float64, limit int) ([]Candidate, time.Duration, error)
}

type Repository interface {
	CreateShadowRun(ctx context.Context, run ShadowRun) error
	InsertShadowCandidates(ctx context.Context, runID string, rideID string, candidates []RankedCandidate) error
	UpdateShadowWriteLatency(ctx context.Context, runID string, latencyMS float64) error
	RecordFirstOfferOutcome(ctx context.Context, outcome OfferOutcome) error
	RecordAcceptedOfferOutcome(ctx context.Context, outcome OfferOutcome) error
}

type Service struct {
	cfg        Config
	candidates CandidateProvider
	repo       Repository
	now        func() time.Time
}

func NewService(cfg Config, candidates CandidateProvider, repo Repository) *Service {
	cfg.Mode = strings.ToLower(cfg.Mode)
	if cfg.Mode == "" {
		cfg.Mode = ModeOff
	}
	if cfg.RadiusKM <= 0 {
		cfg.RadiusKM = 5
	}
	if cfg.CandidateLimit <= 0 {
		cfg.CandidateLimit = 20
	}
	if cfg.SelectedLimit <= 0 {
		cfg.SelectedLimit = 3
	}
	if cfg.RankingVersion == "" {
		cfg.RankingVersion = "v2.0-b-simple"
	}
	return &Service{
		cfg:        cfg,
		candidates: candidates,
		repo:       repo,
		now:        time.Now,
	}
}

func (s *Service) Enabled() bool {
	return s != nil && s.cfg.Mode == ModeShadow
}

func (s *Service) ObserveRide(ctx context.Context, ride RideContext) {
	if !s.Enabled() {
		return
	}
	go s.runShadow(context.Background(), ride)
}

func (s *Service) RecordFirstOffer(ctx context.Context, outcome OfferOutcome) {
	if !s.Enabled() || s.repo == nil {
		return
	}
	go func() {
		if err := s.repo.RecordFirstOfferOutcome(context.Background(), normalizeOutcome(outcome, s.now())); err != nil {
			log.Println("Smart dispatch shadow first-offer comparison warning:", err)
		}
	}()
}

func (s *Service) RecordAcceptedOffer(ctx context.Context, outcome OfferOutcome) {
	if !s.Enabled() || s.repo == nil {
		return
	}
	go func() {
		if err := s.repo.RecordAcceptedOfferOutcome(context.Background(), normalizeOutcome(outcome, s.now())); err != nil {
			log.Println("Smart dispatch shadow accepted-offer comparison warning:", err)
		}
	}()
}

func (s *Service) RunShadowSync(ctx context.Context, ride RideContext) (ShadowRun, []RankedCandidate) {
	return s.runShadow(ctx, ride)
}

func (s *Service) runShadow(ctx context.Context, ride RideContext) (ShadowRun, []RankedCandidate) {
	start := s.now().UTC()
	run := ShadowRun{
		ID:              uuid.NewString(),
		RideID:          ride.RideID,
		RiderID:         ride.RiderID,
		PickupLatitude:  ride.PickupLatitude,
		PickupLongitude: ride.PickupLongitude,
		PickupLocation:  ride.PickupLocation,
		DropoffLocation: ride.DropoffLocation,
		VehicleType:     defaultString(ride.VehicleType, "economy"),
		City:            defaultString(ride.City, "default"),
		Mode:            ModeShadow,
		Status:          StatusCompleted,
		RankingVersion:  s.cfg.RankingVersion,
		StartedAt:       start,
	}
	defer func() {
		if run.Status != StatusDisabled {
			log.Printf("Smart dispatch shadow: ride_id=%s run_id=%s status=%s candidates=%d selected_driver_id=%s selected_rank=%d latency_ms=%.2f redis_ms=%.2f ranking=%s",
				run.RideID,
				run.ID,
				run.Status,
				run.CandidateCount,
				run.SelectedDriverID,
				run.SelectedRank,
				run.DispatchLatencyMS,
				run.RedisLatencyMS,
				run.RankingVersion,
			)
		}
	}()

	if !s.Enabled() {
		run.Status = StatusDisabled
		run.CompletedAt = s.now().UTC()
		return run, nil
	}
	if ride.PickupLatitude == 0 || ride.PickupLongitude == 0 {
		run.Status = StatusNoCoordinates
		run.CompletedAt = s.now().UTC()
		run.DispatchLatencyMS = millis(run.CompletedAt.Sub(start))
		s.bestEffortRun(ctx, run, nil)
		return run, nil
	}
	if s.candidates == nil {
		run.Status = StatusRedisUnavailable
		run.Error = "candidate provider is not configured"
		run.CompletedAt = s.now().UTC()
		run.DispatchLatencyMS = millis(run.CompletedAt.Sub(start))
		s.bestEffortRun(ctx, run, nil)
		return run, nil
	}

	candidates, redisLatency, err := s.candidates.NearbyCandidates(ctx, ride, s.cfg.RadiusKM, s.cfg.CandidateLimit)
	run.RedisLatencyMS = millis(redisLatency)
	run.CandidateDiscoveryLatencyMS = millis(redisLatency)
	if err != nil {
		run.Status = statusForCandidateError(err)
		run.Error = err.Error()
		run.CompletedAt = s.now().UTC()
		run.DispatchLatencyMS = millis(run.CompletedAt.Sub(start))
		s.bestEffortRun(ctx, run, nil)
		return run, nil
	}
	run.RedisAvailable = true

	rankingStart := time.Now()
	ranked := RankCandidates(candidates, s.cfg.RadiusKM, s.now())
	run.RankingLatencyMS = millis(time.Since(rankingStart))
	if len(ranked) == 0 {
		run.Status = StatusNoCandidates
	}
	selectedLimit := s.cfg.SelectedLimit
	if selectedLimit > len(ranked) {
		selectedLimit = len(ranked)
	}
	for i := 0; i < selectedLimit; i++ {
		ranked[i].Selected = true
	}
	run.CandidateCount = len(ranked)
	run.SelectedCount = selectedLimit
	if selectedLimit > 0 {
		run.SelectedDriverID = ranked[0].DriverID
		run.SelectedRank = ranked[0].Rank
	}
	run.CompletedAt = s.now().UTC()
	run.DispatchLatencyMS = millis(run.CompletedAt.Sub(start))
	s.bestEffortRun(ctx, run, ranked)
	return run, ranked
}

func (s *Service) bestEffortRun(ctx context.Context, run ShadowRun, candidates []RankedCandidate) {
	if s.repo == nil {
		return
	}
	writeStart := time.Now()
	if err := s.repo.CreateShadowRun(ctx, run); err != nil {
		log.Println("Smart dispatch shadow run write warning:", err)
		return
	}
	if len(candidates) > 0 {
		if err := s.repo.InsertShadowCandidates(ctx, run.ID, run.RideID, candidates); err != nil {
			log.Println("Smart dispatch shadow candidate write warning:", err)
		}
	}
	latencyMS := millis(time.Since(writeStart))
	if err := s.repo.UpdateShadowWriteLatency(ctx, run.ID, latencyMS); err != nil {
		log.Println("Smart dispatch shadow write latency update warning:", err)
		return
	}
}

func RankCandidates(candidates []Candidate, radiusKM float64, now time.Time) []RankedCandidate {
	ranked := make([]RankedCandidate, 0, len(candidates))
	for _, candidate := range candidates {
		if candidate.DriverID == "" {
			continue
		}
		if candidate.State != "online" || candidate.Availability != "available" {
			continue
		}
		proximity := proximityScore(candidate.DistanceKM, radiusKM)
		freshness := freshnessScore(now.Sub(candidate.LocationAt))
		if freshness == 0 {
			continue
		}
		availability := 1.0
		score := 0.45*proximity + 0.25*freshness + 0.20*availability + 0.10*0.5
		ranked = append(ranked, RankedCandidate{
			Candidate:         candidate,
			Score:             score,
			ProximityScore:    proximity,
			FreshnessScore:    freshness,
			AvailabilityScore: availability,
		})
	}
	sort.SliceStable(ranked, func(i, j int) bool {
		if ranked[i].Score == ranked[j].Score {
			return ranked[i].DistanceKM < ranked[j].DistanceKM
		}
		return ranked[i].Score > ranked[j].Score
	})
	for i := range ranked {
		ranked[i].Rank = i + 1
	}
	return ranked
}

func proximityScore(distanceKM float64, radiusKM float64) float64 {
	if radiusKM <= 0 {
		return 0
	}
	if distanceKM <= 0 {
		return 1
	}
	if distanceKM >= radiusKM {
		return 0
	}
	return 1 - (distanceKM / radiusKM)
}

func freshnessScore(age time.Duration) float64 {
	switch {
	case age <= 10*time.Second:
		return 1
	case age <= 30*time.Second:
		return 0.5
	default:
		return 0
	}
}

func statusForCandidateError(err error) string {
	if errors.Is(err, ErrCandidatesUnavailable) {
		return StatusRedisUnavailable
	}
	return StatusFailed
}

var ErrCandidatesUnavailable = errors.New("dispatch candidates unavailable")

func normalizeOutcome(outcome OfferOutcome, now time.Time) OfferOutcome {
	if outcome.At.IsZero() {
		outcome.At = now.UTC()
	}
	return outcome
}

func millis(duration time.Duration) float64 {
	return float64(duration.Microseconds()) / 1000
}

func defaultString(value string, fallback string) string {
	if value == "" {
		return fallback
	}
	return value
}
