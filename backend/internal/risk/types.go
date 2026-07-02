package risk

import "time"

type Area string

const (
	AreaRiderFraud        Area = "rider_fraud"
	AreaDriverFraud       Area = "driver_fraud"
	AreaWalletAbuse       Area = "wallet_abuse"
	AreaReferralAbuse     Area = "referral_abuse"
	AreaStudentAbuse      Area = "student_discount_abuse"
	AreaGPSSpoofing       Area = "gps_spoofing"
	AreaFakeRideCreation  Area = "fake_ride_creation"
	AreaMultiAccountAbuse Area = "multi_account_abuse"
	AreaPaymentAbuse      Area = "payment_abuse"
	AreaEmergencyAbuse    Area = "emergency_sos_abuse"
)

type Level string

const (
	LevelLow     Level = "low"
	LevelMedium  Level = "medium"
	LevelHigh    Level = "high"
	LevelBlocked Level = "blocked"
)

type Action string

const (
	ActionAllow               Action = "allow"
	ActionReview              Action = "review"
	ActionRateLimit           Action = "rate_limit"
	ActionRequireVerification Action = "require_verification"
	ActionBlock               Action = "block"
)

type Event struct {
	ID                string         `json:"id,omitempty"`
	UserID            string         `json:"user_id"`
	ActorType         string         `json:"actor_type,omitempty"`
	Area              Area           `json:"area"`
	EventType         string         `json:"event_type"`
	Severity          string         `json:"severity,omitempty"`
	DeviceFingerprint string         `json:"device_fingerprint,omitempty"`
	Phone             string         `json:"phone,omitempty"`
	IPAddress         string         `json:"ip_address,omitempty"`
	Latitude          *float64       `json:"latitude,omitempty"`
	Longitude         *float64       `json:"longitude,omitempty"`
	Metadata          map[string]any `json:"metadata,omitempty"`
	CreatedAt         time.Time      `json:"created_at,omitempty"`
}

type Score struct {
	UserID     string    `json:"user_id"`
	RiskScore  int       `json:"risk_score"`
	TrustScore int       `json:"trust_score"`
	FraudScore int       `json:"fraud_score"`
	RiskLevel  Level     `json:"risk_level"`
	UpdatedAt  time.Time `json:"updated_at,omitempty"`
}

type Decision struct {
	Action Action `json:"action"`
	Score  Score  `json:"score"`
}

type UserSummary struct {
	UserID     string    `json:"user_id"`
	RiskScore  int       `json:"risk_score"`
	TrustScore int       `json:"trust_score"`
	FraudScore int       `json:"fraud_score"`
	RiskLevel  Level     `json:"risk_level"`
	UpdatedAt  time.Time `json:"updated_at"`
}

type UserDetail struct {
	Score   Score            `json:"score"`
	Events  []Event          `json:"events"`
	Actions []RecordedAction `json:"actions"`
}

type RecordedAction struct {
	ID        string         `json:"id,omitempty"`
	UserID    string         `json:"user_id"`
	AdminID   string         `json:"admin_id"`
	Action    Action         `json:"action"`
	Reason    string         `json:"reason,omitempty"`
	Metadata  map[string]any `json:"metadata,omitempty"`
	CreatedAt time.Time      `json:"created_at,omitempty"`
}

type Stats struct {
	EventsTotal    int64            `json:"events_total"`
	HighUsersTotal int64            `json:"high_users_total"`
	BlockedTotal   int64            `json:"blocked_total"`
	ByArea         []AreaStat       `json:"by_area"`
	ByLevel        []LevelStat      `json:"by_level"`
	RecentActions  []RecordedAction `json:"recent_actions"`
}

type AreaStat struct {
	Area  Area  `json:"area"`
	Count int64 `json:"count"`
}

type LevelStat struct {
	Level Level `json:"level"`
	Count int64 `json:"count"`
}
