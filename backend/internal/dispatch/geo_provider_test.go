package dispatch

import (
	"context"
	"errors"
	"testing"
	"time"

	"pickme-backend/internal/geo"
)

type fakeGeoService struct {
	drivers   []geo.NearbyDriver
	presences map[string]geo.DriverPresence
	err       error
}

func (f fakeGeoService) NearbyDrivers(ctx context.Context, query geo.NearbyQuery) ([]geo.NearbyDriver, error) {
	return f.drivers, f.err
}

func (f fakeGeoService) DriverPresence(ctx context.Context, driverID string) (geo.DriverPresence, bool, error) {
	presence, ok := f.presences[driverID]
	return presence, ok, nil
}

func TestGeoCandidateProviderFiltersOnlineAvailableDrivers(t *testing.T) {
	now := time.Now()
	provider := NewGeoCandidateProvider(fakeGeoService{
		drivers: []geo.NearbyDriver{
			{DriverID: "online", DistanceKM: 1, UpdatedAt: now},
			{DriverID: "offline", DistanceKM: 2, UpdatedAt: now},
			{DriverID: "missing-presence", DistanceKM: 3, UpdatedAt: now},
		},
		presences: map[string]geo.DriverPresence{
			"online":  {State: "online", Availability: "available"},
			"offline": {State: "offline", Availability: "offline"},
		},
	})

	candidates, _, err := provider.NearbyCandidates(context.Background(), RideContext{
		PickupLatitude: -17.8, PickupLongitude: 31.0,
	}, 5, 20)
	if err != nil {
		t.Fatal(err)
	}
	if len(candidates) != 1 || candidates[0].DriverID != "online" {
		t.Fatalf("unexpected candidates: %#v", candidates)
	}
}

func TestGeoCandidateProviderMapsRedisUnavailable(t *testing.T) {
	provider := NewGeoCandidateProvider(fakeGeoService{err: geo.ErrUnavailable})

	_, _, err := provider.NearbyCandidates(context.Background(), RideContext{
		PickupLatitude: -17.8, PickupLongitude: 31.0,
	}, 5, 20)
	if !errors.Is(err, ErrCandidatesUnavailable) {
		t.Fatalf("expected ErrCandidatesUnavailable, got %v", err)
	}
}
