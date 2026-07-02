package dispatch

import "time"

const (
	ModeOff           = "off"
	ModeShadow        = "shadow"
	ModeAuthoritative = "authoritative"

	StatusCompleted        = "completed"
	StatusDisabled         = "disabled"
	StatusNoCoordinates    = "no_coordinates"
	StatusRedisUnavailable = "redis_unavailable"
	StatusNoCandidates     = "no_candidates"
	StatusQueued           = "queued"
	StatusOffered          = "offered"
	StatusFailed           = "failed"
)

type Config struct {
	Mode           string
	RadiusKM       float64
	CandidateLimit int
	SelectedLimit  int
	RankingVersion string
	OfferTTL       time.Duration
	RideLockTTL    time.Duration
	DriverLockTTL  time.Duration
	QueueName      string
}

type RideContext struct {
	RideID             string
	RiderID            string
	PickupLocation     string
	DropoffLocation    string
	PickupLatitude     float64
	PickupLongitude    float64
	City               string
	VehicleType        string
	EstimatedFareMinor int64
	CreatedAt          time.Time
}

type Candidate struct {
	DriverID     string
	Latitude     float64
	Longitude    float64
	DistanceKM   float64
	VehicleType  string
	City         string
	LocationAt   time.Time
	State        string
	Availability string
}

type RankedCandidate struct {
	Candidate
	Rank              int
	Selected          bool
	Score             float64
	ProximityScore    float64
	FreshnessScore    float64
	AvailabilityScore float64
}

type Metrics struct {
	CandidateCount      int
	DispatchLatencyMS   float64
	RedisQueryLatencyMS float64
	SelectedDriverID    string
	SelectedRank        int
}

type ShadowRun struct {
	ID                          string
	RideID                      string
	RiderID                     string
	PickupLatitude              float64
	PickupLongitude             float64
	PickupLocation              string
	DropoffLocation             string
	VehicleType                 string
	City                        string
	Mode                        string
	Status                      string
	CandidateCount              int
	SelectedCount               int
	RedisAvailable              bool
	RedisLatencyMS              float64
	CandidateDiscoveryLatencyMS float64
	RankingLatencyMS            float64
	DispatchLatencyMS           float64
	ShadowWriteLatencyMS        float64
	SelectedDriverID            string
	SelectedRank                int
	RankingVersion              string
	Error                       string
	StartedAt                   time.Time
	CompletedAt                 time.Time
}

type OfferOutcome struct {
	RideID   string
	OfferID  string
	DriverID string
	At       time.Time
}

type DispatchJob struct {
	ID       string
	Ride     RideContext
	QueuedAt time.Time
	Attempt  int
}

type OfferWave struct {
	Ride      RideContext
	Offers    []DriverOffer
	ExpiresAt time.Time
	CreatedAt time.Time
}

type DriverOffer struct {
	OfferID     string
	DriverID    string
	Rank        int
	AmountMinor int64
	ETAMinutes  int
	DistanceKM  float64
}
