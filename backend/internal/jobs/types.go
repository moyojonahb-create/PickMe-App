package jobs

import "time"

const (
	QueueCritical = "critical"
	QueueDefault  = "default"
	QueueLow      = "low"
)

var Queues = []string{QueueCritical, QueueDefault, QueueLow}

const (
	TypeRideOfferRetry       = "ride.offer_retry"
	TypePushNotification     = "notification.push"
	TypeSMSNotification      = "notification.sms"
	TypeEmailNotification    = "notification.email"
	TypeEmailReceipt         = "receipt.email"
	TypeWalletReconciliation = "wallet.reconciliation"
	TypeFraudScan            = "fraud.scan"
	TypeRiskRecalculateUser  = "risk.recalculate_user"
	TypeRiskMultiAccount     = "risk.detect_multi_account"
	TypeRiskWalletAbuse      = "risk.detect_wallet_abuse"
	TypeRiskStudentAbuse     = "risk.detect_student_abuse"
	TypeRiskGPSSpoofing      = "risk.detect_gps_spoofing"
	TypeDriverCleanup        = "driver.cleanup"
	TypeStudentVerification  = "student.verification"
)

type Config struct {
	Enabled                bool
	RedisURL               string
	Concurrency            int
	RetryMax               int
	ShutdownTimeoutSeconds int
}

type Payload struct {
	ID        string         `json:"id,omitempty"`
	UserID    string         `json:"user_id,omitempty"`
	RideID    string         `json:"ride_id,omitempty"`
	DriverID  string         `json:"driver_id,omitempty"`
	StudentID string         `json:"student_id,omitempty"`
	WalletID  string         `json:"wallet_id,omitempty"`
	Metadata  map[string]any `json:"metadata,omitempty"`
}

type QueueStats struct {
	Queue          string    `json:"queue"`
	Size           int       `json:"size"`
	Pending        int       `json:"pending"`
	Active         int       `json:"active"`
	Scheduled      int       `json:"scheduled"`
	Retry          int       `json:"retry"`
	DeadLetter     int       `json:"dead_letter"`
	Completed      int       `json:"completed"`
	Processed      int       `json:"processed"`
	Failed         int       `json:"failed"`
	ProcessedTotal int       `json:"processed_total"`
	FailedTotal    int       `json:"failed_total"`
	LatencySeconds float64   `json:"latency_seconds"`
	Paused         bool      `json:"paused"`
	Timestamp      time.Time `json:"timestamp"`
}

type Stats struct {
	Enabled bool         `json:"enabled"`
	Queues  []QueueStats `json:"queues"`
}
