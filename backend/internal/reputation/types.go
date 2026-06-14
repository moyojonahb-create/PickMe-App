package reputation

import "time"

const (
	EventOfferSent         = "offer_sent"
	EventOfferSubmitted    = "offer_submitted"
	EventOfferAccepted     = "offer_accepted"
	EventRideCompleted     = "ride_completed"
	EventRideCancelled     = "ride_cancelled"
	EventLocationFreshness = "location_freshness"
)

type DriverReputation struct {
	DriverID              string     `json:"driver_id"`
	RatingAvg             float64    `json:"rating_avg"`
	RatingCount           int        `json:"rating_count"`
	AcceptanceRate        float64    `json:"acceptance_rate"`
	CompletionRate        float64    `json:"completion_rate"`
	CancellationRate      float64    `json:"cancellation_rate"`
	CancelAfterAcceptRate float64    `json:"cancel_after_accept_rate"`
	ReliabilityScore      float64    `json:"reliability_score"`
	FreshnessScore        float64    `json:"freshness_score"`
	DispatchScore         float64    `json:"dispatch_score"`
	CompletedRides        int        `json:"completed_rides"`
	AcceptedRides         int        `json:"accepted_rides"`
	OfferedRides          int        `json:"offered_rides"`
	RejectedOffers        int        `json:"rejected_offers"`
	TimedOutOffers        int        `json:"timed_out_offers"`
	CancelledRides        int        `json:"cancelled_rides"`
	LastCompletedRideAt   *time.Time `json:"last_completed_ride_at,omitempty"`
	LastOfferAt           *time.Time `json:"last_offer_at,omitempty"`
	UpdatedAt             time.Time  `json:"updated_at"`
}

type Event struct {
	DriverID string
	Type     string
	RideID   string
	OfferID  string
	At       time.Time
	Metadata map[string]any
}
