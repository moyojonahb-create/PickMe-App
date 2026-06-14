package drivers

import "time"

type DriverLocationRequest struct {
	DriverID    string  `json:"driver_id"`
	RideID      string  `json:"ride_id"`
	Latitude    float64 `json:"latitude"`
	Longitude   float64 `json:"longitude"`
	Speed       float64 `json:"speed"`
	Heading     float64 `json:"heading"`
	City        string  `json:"city,omitempty"`
	VehicleType string  `json:"vehicle_type,omitempty"`
}

type DriverOnlineRequest struct {
	DriverID    string  `json:"driver_id"`
	Latitude    float64 `json:"latitude"`
	Longitude   float64 `json:"longitude"`
	Heading     float64 `json:"heading"`
	Speed       float64 `json:"speed"`
	VehicleType string  `json:"vehicle_type"`
}

type DriverHeartbeatRequest struct {
	DriverID string `json:"driver_id"`
}

type NearbyDriver struct {
	DriverID    string    `json:"driver_id"`
	Latitude    float64   `json:"latitude"`
	Longitude   float64   `json:"longitude"`
	VehicleType string    `json:"vehicle_type"`
	Speed       float64   `json:"speed"`
	Heading     float64   `json:"heading"`
	DistanceKM  float64   `json:"distance_km"`
	LastSeen    time.Time `json:"last_seen"`
}

type DriverLocationBroadcast struct {
	Event     string  `json:"event"`
	Room      string  `json:"room,omitempty"`
	RideID    string  `json:"ride_id,omitempty"`
	DriverID  string  `json:"driver_id"`
	Latitude  float64 `json:"latitude"`
	Longitude float64 `json:"longitude"`
	Speed     float64 `json:"speed"`
	Heading   float64 `json:"heading"`
}
