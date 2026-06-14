package geo

import (
	"context"
	"errors"
	"strconv"
	"strings"
	"time"
)

var ErrUnavailable = errors.New("geo store unavailable")

type Store interface {
	Enabled() bool
	HSet(ctx context.Context, key string, values map[string]string) error
	HGetAll(ctx context.Context, key string) (map[string]string, error)
	Expire(ctx context.Context, key string, ttl time.Duration) error
	GeoAdd(ctx context.Context, key string, longitude float64, latitude float64, member string) error
	GeoSearch(ctx context.Context, key string, longitude float64, latitude float64, radiusKM float64, count int) ([]GeoResult, error)
}

type GeoResult struct {
	Member     string
	DistanceKM float64
}

type Service struct {
	store       Store
	locationTTL time.Duration
	presenceTTL time.Duration
	now         func() time.Time
}

type Config struct {
	LocationTTL time.Duration
	PresenceTTL time.Duration
}

type DriverLocation struct {
	DriverID    string
	Latitude    float64
	Longitude   float64
	Heading     float64
	Speed       float64
	City        string
	VehicleType string
	UpdatedAt   time.Time
}

type DriverPresence struct {
	DriverID          string
	State             string
	Availability      string
	RideID            string
	LastSeenAt        time.Time
	WebsocketInstance string
	PushAvailable     bool
}

type NearbyQuery struct {
	Latitude    float64
	Longitude   float64
	RadiusKM    float64
	Count       int
	City        string
	VehicleType string
}

type NearbyDriver struct {
	DriverID    string
	Latitude    float64
	Longitude   float64
	Heading     float64
	Speed       float64
	City        string
	VehicleType string
	UpdatedAt   time.Time
	DistanceKM  float64
}

func (s *Service) DriverPresence(ctx context.Context, driverID string) (DriverPresence, bool, error) {
	if !s.Enabled() {
		return DriverPresence{}, false, ErrUnavailable
	}
	hash, err := s.store.HGetAll(ctx, DriverPresenceKey(driverID))
	if err != nil {
		return DriverPresence{}, false, err
	}
	if len(hash) == 0 {
		return DriverPresence{}, false, nil
	}
	lastSeenAt, _ := time.Parse(time.RFC3339Nano, hash["last_seen_at"])
	pushAvailable, _ := strconv.ParseBool(hash["push_available"])
	return DriverPresence{
		DriverID:          driverID,
		State:             hash["state"],
		Availability:      hash["availability"],
		RideID:            hash["ride_id"],
		LastSeenAt:        lastSeenAt,
		WebsocketInstance: hash["websocket_instance"],
		PushAvailable:     pushAvailable,
	}, true, nil
}

func NewService(store Store, cfg Config) *Service {
	locationTTL := cfg.LocationTTL
	if locationTTL <= 0 {
		locationTTL = 60 * time.Second
	}
	presenceTTL := cfg.PresenceTTL
	if presenceTTL <= 0 {
		presenceTTL = 90 * time.Second
	}
	return &Service{
		store:       store,
		locationTTL: locationTTL,
		presenceTTL: presenceTTL,
		now:         time.Now,
	}
}

func (s *Service) Enabled() bool {
	return s != nil && s.store != nil && s.store.Enabled()
}

func (s *Service) WriteDriverLocation(ctx context.Context, location DriverLocation) error {
	if !s.Enabled() {
		return nil
	}
	if location.DriverID == "" {
		return nil
	}
	location.City = normalizeOrDefault(location.City, "default")
	location.VehicleType = normalizeOrDefault(location.VehicleType, "economy")
	if location.UpdatedAt.IsZero() {
		location.UpdatedAt = s.now().UTC()
	}

	key := DriverLocationKey(location.DriverID)
	values := map[string]string{
		"latitude":     formatFloat(location.Latitude),
		"longitude":    formatFloat(location.Longitude),
		"heading":      formatFloat(location.Heading),
		"speed":        formatFloat(location.Speed),
		"city":         location.City,
		"vehicle_type": location.VehicleType,
		"updated_at":   location.UpdatedAt.Format(time.RFC3339Nano),
	}
	if err := s.store.HSet(ctx, key, values); err != nil {
		return err
	}
	if err := s.store.Expire(ctx, key, s.locationTTL); err != nil {
		return err
	}
	if location.Latitude != 0 && location.Longitude != 0 {
		if err := s.store.GeoAdd(ctx, DriverGeoKey(location.City, location.VehicleType), location.Longitude, location.Latitude, location.DriverID); err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) WriteDriverPresence(ctx context.Context, presence DriverPresence) error {
	if !s.Enabled() {
		return nil
	}
	if presence.DriverID == "" {
		return nil
	}
	if presence.LastSeenAt.IsZero() {
		presence.LastSeenAt = s.now().UTC()
	}
	key := DriverPresenceKey(presence.DriverID)
	values := map[string]string{
		"state":              emptyDefault(presence.State, "online"),
		"availability":       emptyDefault(presence.Availability, "available"),
		"ride_id":            presence.RideID,
		"last_seen_at":       presence.LastSeenAt.Format(time.RFC3339Nano),
		"websocket_instance": presence.WebsocketInstance,
		"push_available":     strconv.FormatBool(presence.PushAvailable),
	}
	if err := s.store.HSet(ctx, key, values); err != nil {
		return err
	}
	return s.store.Expire(ctx, key, s.presenceTTL)
}

func (s *Service) NearbyDrivers(ctx context.Context, query NearbyQuery) ([]NearbyDriver, error) {
	if !s.Enabled() {
		return nil, ErrUnavailable
	}
	if query.RadiusKM <= 0 {
		return nil, nil
	}
	query.City = normalizeOrDefault(query.City, "default")
	query.VehicleType = normalizeOrDefault(query.VehicleType, "economy")
	results, err := s.store.GeoSearch(ctx, DriverGeoKey(query.City, query.VehicleType), query.Longitude, query.Latitude, query.RadiusKM, query.Count)
	if err != nil {
		return nil, err
	}

	now := s.now()
	drivers := make([]NearbyDriver, 0, len(results))
	for _, result := range results {
		hash, err := s.store.HGetAll(ctx, DriverLocationKey(result.Member))
		if err != nil {
			return nil, err
		}
		if len(hash) == 0 {
			continue
		}
		updatedAt, err := time.Parse(time.RFC3339Nano, hash["updated_at"])
		if err != nil || now.Sub(updatedAt) > s.locationTTL {
			continue
		}
		latitude, _ := strconv.ParseFloat(hash["latitude"], 64)
		longitude, _ := strconv.ParseFloat(hash["longitude"], 64)
		heading, _ := strconv.ParseFloat(hash["heading"], 64)
		speed, _ := strconv.ParseFloat(hash["speed"], 64)
		drivers = append(drivers, NearbyDriver{
			DriverID:    result.Member,
			Latitude:    latitude,
			Longitude:   longitude,
			Heading:     heading,
			Speed:       speed,
			City:        hash["city"],
			VehicleType: hash["vehicle_type"],
			UpdatedAt:   updatedAt,
			DistanceKM:  result.DistanceKM,
		})
	}
	return drivers, nil
}

func DriverGeoKey(city string, vehicleType string) string {
	return "drivers:geo:" + normalizeOrDefault(city, "default") + ":" + normalizeOrDefault(vehicleType, "economy")
}

func DriverLocationKey(driverID string) string {
	return "driver:" + driverID + ":location"
}

func DriverPresenceKey(driverID string) string {
	return "driver:" + driverID + ":presence"
}

func normalizeOrDefault(value string, fallback string) string {
	value = strings.TrimSpace(strings.ToLower(value))
	if value == "" {
		return fallback
	}
	value = strings.ReplaceAll(value, " ", "_")
	return value
}

func emptyDefault(value string, fallback string) string {
	if value == "" {
		return fallback
	}
	return value
}

func formatFloat(value float64) string {
	return strconv.FormatFloat(value, 'f', -1, 64)
}
