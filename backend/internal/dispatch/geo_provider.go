package dispatch

import (
	"context"
	"errors"
	"time"

	"pickme-backend/internal/geo"
)

type GeoService interface {
	NearbyDrivers(ctx context.Context, query geo.NearbyQuery) ([]geo.NearbyDriver, error)
	DriverPresence(ctx context.Context, driverID string) (geo.DriverPresence, bool, error)
}

type GeoCandidateProvider struct {
	geo GeoService
}

func NewGeoCandidateProvider(geoService GeoService) *GeoCandidateProvider {
	return &GeoCandidateProvider{geo: geoService}
}

func (p *GeoCandidateProvider) NearbyCandidates(ctx context.Context, ride RideContext, radiusKM float64, limit int) ([]Candidate, time.Duration, error) {
	if p == nil || p.geo == nil {
		return nil, 0, ErrCandidatesUnavailable
	}
	start := time.Now()
	drivers, err := p.geo.NearbyDrivers(ctx, geo.NearbyQuery{
		Latitude:    ride.PickupLatitude,
		Longitude:   ride.PickupLongitude,
		RadiusKM:    radiusKM,
		Count:       limit,
		City:        ride.City,
		VehicleType: ride.VehicleType,
	})
	latency := time.Since(start)
	if err != nil {
		if errors.Is(err, geo.ErrUnavailable) {
			return nil, latency, ErrCandidatesUnavailable
		}
		return nil, latency, err
	}

	candidates := make([]Candidate, 0, len(drivers))
	for _, driver := range drivers {
		presence, exists, err := p.geo.DriverPresence(ctx, driver.DriverID)
		if err != nil {
			return nil, latency, err
		}
		if !exists {
			continue
		}
		if presence.State != "online" || presence.Availability != "available" {
			continue
		}
		candidates = append(candidates, Candidate{
			DriverID:     driver.DriverID,
			Latitude:     driver.Latitude,
			Longitude:    driver.Longitude,
			DistanceKM:   driver.DistanceKM,
			VehicleType:  driver.VehicleType,
			City:         driver.City,
			LocationAt:   driver.UpdatedAt,
			State:        presence.State,
			Availability: presence.Availability,
		})
	}
	return candidates, latency, nil
}
