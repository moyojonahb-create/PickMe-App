package dispatch

import (
	"context"
	"errors"
	"testing"
	"time"
)

type fakeCandidateProvider struct {
	called     int
	candidates []Candidate
	latency    time.Duration
	err        error
}

func (f *fakeCandidateProvider) NearbyCandidates(ctx context.Context, ride RideContext, radiusKM float64, limit int) ([]Candidate, time.Duration, error) {
	f.called++
	return f.candidates, f.latency, f.err
}

type fakeRepository struct {
	runs       []ShadowRun
	candidates []RankedCandidate
	first      []OfferOutcome
	accepted   []OfferOutcome
	err        error
}

func (f *fakeRepository) CreateShadowRun(ctx context.Context, run ShadowRun) error {
	if f.err != nil {
		return f.err
	}
	f.runs = append(f.runs, run)
	return nil
}

func (f *fakeRepository) InsertShadowCandidates(ctx context.Context, runID string, rideID string, candidates []RankedCandidate) error {
	if f.err != nil {
		return f.err
	}
	f.candidates = append(f.candidates, candidates...)
	return nil
}

func (f *fakeRepository) UpdateShadowWriteLatency(ctx context.Context, runID string, latencyMS float64) error {
	return f.err
}

func (f *fakeRepository) RecordFirstOfferOutcome(ctx context.Context, outcome OfferOutcome) error {
	if f.err != nil {
		return f.err
	}
	f.first = append(f.first, outcome)
	return nil
}

func (f *fakeRepository) RecordAcceptedOfferOutcome(ctx context.Context, outcome OfferOutcome) error {
	if f.err != nil {
		return f.err
	}
	f.accepted = append(f.accepted, outcome)
	return nil
}

func TestDispatchModeOffPerformsNoShadowQueryOrWrite(t *testing.T) {
	provider := &fakeCandidateProvider{}
	repo := &fakeRepository{}
	service := NewService(Config{Mode: ModeOff}, provider, repo)

	run, candidates := service.RunShadowSync(context.Background(), RideContext{
		RideID: "ride-1", PickupLatitude: -17.8, PickupLongitude: 31.0,
	})

	if run.Status != StatusDisabled {
		t.Fatalf("expected disabled run, got %s", run.Status)
	}
	if len(candidates) != 0 || provider.called != 0 || len(repo.runs) != 0 {
		t.Fatalf("off mode should not query/write, candidates=%d provider=%d runs=%d", len(candidates), provider.called, len(repo.runs))
	}
}

func TestShadowModeMissingCoordinatesRecordsNoCoordinates(t *testing.T) {
	repo := &fakeRepository{}
	service := NewService(Config{Mode: ModeShadow}, &fakeCandidateProvider{}, repo)

	run, candidates := service.RunShadowSync(context.Background(), RideContext{RideID: "ride-1"})

	if run.Status != StatusNoCoordinates {
		t.Fatalf("expected no_coordinates, got %s", run.Status)
	}
	if len(candidates) != 0 || len(repo.runs) != 1 {
		t.Fatalf("expected one shadow run and no candidates, runs=%d candidates=%d", len(repo.runs), len(candidates))
	}
}

func TestRedisUnavailableFallbackRecordsFailure(t *testing.T) {
	repo := &fakeRepository{}
	provider := &fakeCandidateProvider{err: ErrCandidatesUnavailable}
	service := NewService(Config{Mode: ModeShadow}, provider, repo)

	run, candidates := service.RunShadowSync(context.Background(), RideContext{
		RideID: "ride-1", PickupLatitude: -17.8, PickupLongitude: 31.0,
	})

	if run.Status != StatusRedisUnavailable {
		t.Fatalf("expected redis_unavailable, got %s", run.Status)
	}
	if len(candidates) != 0 || len(repo.runs) != 1 {
		t.Fatalf("expected recorded failure run, runs=%d candidates=%d", len(repo.runs), len(candidates))
	}
}

func TestRankingAndShadowSelectionAreDeterministic(t *testing.T) {
	now := time.Date(2026, 6, 1, 12, 0, 0, 0, time.UTC)
	provider := &fakeCandidateProvider{latency: 12 * time.Millisecond, candidates: []Candidate{
		{DriverID: "far", DistanceKM: 4, LocationAt: now.Add(-5 * time.Second), State: "online", Availability: "available"},
		{DriverID: "near", DistanceKM: 1, LocationAt: now.Add(-5 * time.Second), State: "online", Availability: "available"},
		{DriverID: "busy", DistanceKM: 0.5, LocationAt: now.Add(-5 * time.Second), State: "online", Availability: "busy"},
		{DriverID: "stale", DistanceKM: 0.2, LocationAt: now.Add(-45 * time.Second), State: "online", Availability: "available"},
	}}
	repo := &fakeRepository{}
	service := NewService(Config{Mode: ModeShadow, RadiusKM: 5, SelectedLimit: 3}, provider, repo)
	service.now = func() time.Time { return now }

	run, candidates := service.RunShadowSync(context.Background(), RideContext{
		RideID: "ride-1", PickupLatitude: -17.8, PickupLongitude: 31.0,
	})

	if run.Status != StatusCompleted {
		t.Fatalf("expected completed, got %s", run.Status)
	}
	if len(candidates) != 2 {
		t.Fatalf("expected two rankable candidates, got %d", len(candidates))
	}
	if candidates[0].DriverID != "near" || !candidates[0].Selected || candidates[0].Rank != 1 {
		t.Fatalf("unexpected top candidate: %#v", candidates[0])
	}
	if candidates[1].DriverID != "far" {
		t.Fatalf("expected far second, got %#v", candidates[1])
	}
	if run.SelectedDriverID != "near" || run.SelectedRank != 1 || run.CandidateCount != 2 || run.RedisLatencyMS != 12 {
		t.Fatalf("unexpected metrics: %#v", run)
	}
	if run.CandidateDiscoveryLatencyMS != 12 || run.RankingLatencyMS < 0 || run.DispatchLatencyMS < 0 {
		t.Fatalf("expected dispatch health metrics to be recorded: %#v", run)
	}
}

func TestShadowWriteFailureDoesNotPanicOrBlockResult(t *testing.T) {
	service := NewService(
		Config{Mode: ModeShadow},
		&fakeCandidateProvider{candidates: []Candidate{{DriverID: "driver-1", DistanceKM: 1, LocationAt: time.Now(), State: "online", Availability: "available"}}},
		&fakeRepository{err: errors.New("db down")},
	)

	run, candidates := service.RunShadowSync(context.Background(), RideContext{
		RideID: "ride-1", PickupLatitude: -17.8, PickupLongitude: 31.0,
	})
	if run.Status != StatusCompleted || len(candidates) != 1 {
		t.Fatalf("shadow write failure should not change computed result: run=%#v candidates=%#v", run, candidates)
	}
}

func TestComparisonLogicRecordsOfferOutcomes(t *testing.T) {
	repo := &fakeRepository{}
	service := NewService(Config{Mode: ModeShadow}, nil, repo)

	service.RecordFirstOffer(context.Background(), OfferOutcome{RideID: "ride-1", OfferID: "offer-1", DriverID: "driver-1"})
	service.RecordAcceptedOffer(context.Background(), OfferOutcome{RideID: "ride-1", OfferID: "offer-1", DriverID: "driver-1"})

	time.Sleep(50 * time.Millisecond)
	if len(repo.first) != 1 || repo.first[0].DriverID != "driver-1" {
		t.Fatalf("expected first offer outcome, got %#v", repo.first)
	}
	if len(repo.accepted) != 1 || repo.accepted[0].OfferID != "offer-1" {
		t.Fatalf("expected accepted offer outcome, got %#v", repo.accepted)
	}
}
