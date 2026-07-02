package rides

import "time"

type RideRequest struct {
	RiderID            string  `json:"rider_id"`
	PickupLocation     string  `json:"pickup_location"`
	DropoffLocation    string  `json:"dropoff_location"`
	EstimatedFare      float64 `json:"estimated_fare"`
	EstimatedFareMinor int64   `json:"-"`
	PaymentMethod      string  `json:"payment_method"`
	PickupLatitude     float64 `json:"pickup_latitude,omitempty"`
	PickupLongitude    float64 `json:"pickup_longitude,omitempty"`
	City               string  `json:"city,omitempty"`
	VehicleType        string  `json:"vehicle_type,omitempty"`
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
	Status           string    `json:"status"`
	ExpiresAt        time.Time `json:"expires_at"`
	CreatedAt        time.Time `json:"created_at"`
}

type OfferRecord struct {
	ID        string
	RideID    string
	DriverID  string
	Status    string
	ExpiresAt time.Time
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
