package rides

import "time"

type RideRequest struct {
	RiderID         string `json:"rider_id"`
	PickupLocation  string `json:"pickup_location"`
	DropoffLocation string `json:"dropoff_location"`
	// PickupAddress/DropoffAddress are the field names the current frontend
	// actually sends (see src/lib/requestRide.ts's ridePayload). The handler
	// falls back to these when PickupLocation/DropoffLocation are empty —
	// see Handler.Request.
	PickupAddress      string  `json:"pickup_address,omitempty"`
	DropoffAddress     string  `json:"dropoff_address,omitempty"`
	EstimatedFare      float64 `json:"estimated_fare"`
	EstimatedFareMinor int64   `json:"-"`
	PaymentMethod      string  `json:"payment_method"`
	// PickupLatitude/PickupLongitude only bind pickup_latitude/pickup_longitude
	// via the default JSON tags below. The frontend actually sends
	// pickup_lat/pickup_lon (see requestRide.ts's ridePayload) — UnmarshalJSON
	// falls back to those when these are absent, since without it the value
	// stays 0 and authoritative dispatch refuses to run (see
	// dispatch/service.go's dispatchRide coordinate check).
	PickupLatitude   float64 `json:"pickup_latitude,omitempty"`
	PickupLongitude  float64 `json:"pickup_longitude,omitempty"`
	DropoffLatitude  float64 `json:"dropoff_lat,omitempty"`
	DropoffLongitude float64 `json:"dropoff_lon,omitempty"`
	City             string  `json:"city,omitempty"`
	VehicleType      string  `json:"vehicle_type,omitempty"`
	// Status carries the frontend's "pending" vs "scheduled" distinction
	// (see requestRide.ts's ridePayload) straight through to the rides.status
	// column. Empty defaults to "pending" in Handler.Request.
	Status           string     `json:"status,omitempty"`
	DistanceKm       float64    `json:"distance_km,omitempty"`
	DurationMinutes  int        `json:"duration_minutes,omitempty"`
	RoutePolyline    string     `json:"route_polyline,omitempty"`
	PassengerCount   int        `json:"passenger_count,omitempty"`
	TownID           string     `json:"town_id,omitempty"`
	GenderPreference string     `json:"gender_preference,omitempty"`
	PassengerName    string     `json:"passenger_name,omitempty"`
	PassengerPhone   string     `json:"passenger_phone,omitempty"`
	ScheduledAt      *time.Time `json:"scheduled_at,omitempty"`
}

type AcceptRideRequest struct {
	DriverID string `json:"driver_id"`
}

type SubmitOfferRequest struct {
	DriverID           string  `json:"driver_id"`
	Amount             float64 `json:"amount,omitempty"`
	AmountMinor        int64   `json:"-"`
	Price              float64 `json:"price,omitempty"`
	PriceMinor         int64   `json:"-"`
	OfferedFare        float64 `json:"offered_fare,omitempty"`
	OfferedFareMinor   int64   `json:"-"`
	EstimatedFare      float64 `json:"estimated_fare,omitempty"`
	EstimatedFareMinor int64   `json:"-"`
	ETA                int     `json:"eta,omitempty"`
	ETAMinutes         int     `json:"eta_minutes,omitempty"`
	Message            string  `json:"message,omitempty"`
}

type OfferResponse struct {
	ID               string    `json:"id"`
	OfferID          string    `json:"offer_id"`
	RideID           string    `json:"ride_id"`
	RequestID        string    `json:"request_id,omitempty"`
	DriverID         string    `json:"driver_id"`
	Amount           float64   `json:"amount,omitempty"`
	AmountMinor      int64     `json:"-"`
	Price            float64   `json:"price,omitempty"`
	Fare             float64   `json:"fare,omitempty"`
	FareMinor        int64     `json:"-"`
	OfferedFare      float64   `json:"offered_fare,omitempty"`
	OfferedFareMinor int64     `json:"-"`
	ETAMinutes       int       `json:"eta_minutes,omitempty"`
	Message          string    `json:"message,omitempty"`
	Status           string    `json:"status"`
	CreatedAt        time.Time `json:"created_at"`
}

type OfferRecord struct {
	ID       string
	RideID   string
	DriverID string
	Status   string
}

type JoinRideRoomRequest struct {
	RideID string `json:"ride_id"`
	UserID string `json:"user_id"`
}

type RideOfferBroadcast struct {
	Event              string  `json:"event"`
	RideID             string  `json:"ride_id"`
	RiderID            string  `json:"rider_id"`
	PickupLocation     string  `json:"pickup_location"`
	DropoffLocation    string  `json:"dropoff_location"`
	EstimatedFare      float64 `json:"estimated_fare"`
	EstimatedFareMinor int64   `json:"-"`
	PaymentMethod      string  `json:"payment_method"`
}

type RideLifecycleBroadcast struct {
	Event      string `json:"event"`
	RideID     string `json:"ride_id"`
	DriverID   string `json:"driver_id"`
	RideStatus string `json:"ride_status"`
	Room       string `json:"room"`
}

type RideRecord struct {
	ID                 string
	RiderID            string
	PickupLocation     string
	DropoffLocation    string
	EstimatedFare      float64
	EstimatedFareMinor int64
	RideStatus         string
	CreatedAt          time.Time
}
