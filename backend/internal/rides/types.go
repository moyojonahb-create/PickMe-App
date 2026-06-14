package rides

import "time"

type RideRequest struct {
	RiderID            string  `json:"rider_id"`
	PickupLocation     string  `json:"pickup_location"`
	DropoffLocation    string  `json:"dropoff_location"`
	EstimatedFareMinor int64   `json:"estimated_fare_minor"`
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
	DriverID           string `json:"driver_id"`
	AmountMinor        int64  `json:"amount_minor,omitempty"`
	PriceMinor         int64  `json:"price_minor,omitempty"`
	OfferedFareMinor   int64  `json:"offered_fare_minor,omitempty"`
	EstimatedFareMinor int64  `json:"estimated_fare_minor,omitempty"`
	ETA                int    `json:"eta,omitempty"`
	ETAMinutes         int    `json:"eta_minutes,omitempty"`
}

type OfferResponse struct {
	OfferID          string    `json:"offer_id"`
	RideID           string    `json:"ride_id"`
	DriverID         string    `json:"driver_id"`
	AmountMinor      int64     `json:"amount_minor,omitempty"`
	FareMinor        int64     `json:"fare_minor,omitempty"`
	OfferedFareMinor int64     `json:"offered_fare_minor,omitempty"`
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
	Event              string `json:"event"`
	RideID             string `json:"ride_id"`
	RiderID            string `json:"rider_id"`
	PickupLocation     string `json:"pickup_location"`
	DropoffLocation    string `json:"dropoff_location"`
	EstimatedFareMinor int64  `json:"estimated_fare_minor"`
	PaymentMethod      string `json:"payment_method"`
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
	EstimatedFareMinor int64
	RideStatus         string
	CreatedAt          time.Time
}
