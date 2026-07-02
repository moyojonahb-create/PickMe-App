package notification

type NotificationType string

const (
	NotificationTypeRideOffer             NotificationType = "ride_offer"
	NotificationTypeRideAccepted          NotificationType = "ride_accepted"
	NotificationTypeDriverArrived         NotificationType = "driver_arrived"
	NotificationTypeRideStarted           NotificationType = "ride_started"
	NotificationTypeRideCompleted         NotificationType = "ride_completed"
	NotificationTypeWalletDepositApproved NotificationType = "wallet_deposit_approved"
	NotificationTypeWithdrawalApproved    NotificationType = "withdrawal_approved"
	NotificationTypeDriverVerification    NotificationType = "driver_verification_approved"
	NotificationTypeStudentVerification   NotificationType = "student_verification_approved"
	NotificationTypeEmergencyAlert        NotificationType = "emergency_alert"
)

type ChannelType string

const (
	ChannelPush          ChannelType = "push"
	ChannelSMS           ChannelType = "sms"
	ChannelEmail         ChannelType = "email"
	ChannelMarketing     ChannelType = "marketing"
	ChannelTransactional ChannelType = "transactional"
)

type Platform string

const (
	PlatformIOS     Platform = "ios"
	PlatformAndroid Platform = "android"
	PlatformWeb     Platform = "web"
)

type Device struct {
	ID          string   `json:"id,omitempty"`
	UserID      string   `json:"user_id"`
	Platform    Platform `json:"platform"`
	DeviceToken string   `json:"device_token"`
	LastSeen    string   `json:"last_seen,omitempty"`
	AppVersion  string   `json:"app_version,omitempty"`
}

type Preference struct {
	UserID        string `json:"user_id"`
	Push          bool   `json:"push"`
	SMS           bool   `json:"sms"`
	Email         bool   `json:"email"`
	Marketing     bool   `json:"marketing"`
	Transactional bool   `json:"transactional"`
}

type NotificationPayload struct {
	ID            string           `json:"id,omitempty"`
	UserID        string           `json:"user_id"`
	Type          NotificationType `json:"type"`
	Title         string           `json:"title"`
	Body          string           `json:"body"`
	Data          map[string]any   `json:"data,omitempty"`
	RideID        string           `json:"ride_id,omitempty"`
	DriverID      string           `json:"driver_id,omitempty"`
	WalletID      string           `json:"wallet_id,omitempty"`
	Amount        float64          `json:"amount,omitempty"`
	Currency      string           `json:"currency,omitempty"`
	Channels      []ChannelType    `json:"channels"`
	Priority      string           `json:"priority,omitempty"`
	RecipientType string           `json:"recipient_type,omitempty"`
	Metadata      map[string]any   `json:"metadata,omitempty"`
}

type NotificationHistory struct {
	ID           string           `json:"id,omitempty"`
	UserID       string           `json:"user_id"`
	Type         NotificationType `json:"type"`
	Channel      ChannelType      `json:"channel"`
	Title        string           `json:"title"`
	Body         string           `json:"body"`
	Status       string           `json:"status"`
	Provider     string           `json:"provider,omitempty"`
	ProviderID   string           `json:"provider_id,omitempty"`
	ErrorMessage string           `json:"error_message,omitempty"`
	SentAt       string           `json:"sent_at,omitempty"`
	DeliveredAt  string           `json:"delivered_at,omitempty"`
	CreatedAt    string           `json:"created_at,omitempty"`
}

type TemplateData struct {
	RideID        string  `json:"ride_id,omitempty"`
	Pickup        string  `json:"pickup,omitempty"`
	Dropoff       string  `json:"dropoff,omitempty"`
	DriverName    string  `json:"driver_name,omitempty"`
	DriverPhone   string  `json:"driver_phone,omitempty"`
	Amount        float64 `json:"amount,omitempty"`
	Currency      string  `json:"currency,omitempty"`
	WalletBalance float64 `json:"wallet_balance,omitempty"`
	Time          string  `json:"time,omitempty"`
	Date          string  `json:"date,omitempty"`
	Reference     string  `json:"reference,omitempty"`
	Message       string  `json:"message,omitempty"`
}

type Stats struct {
	SentTotal         int64            `json:"sent_total"`
	FailedTotal       int64            `json:"failed_total"`
	QueuedTotal       int64            `json:"queued_total"`
	SkippedTotal      int64            `json:"skipped_total"`
	ByChannelStatus   []ChannelStat    `json:"by_channel_status"`
	RecentFailures    []HistoryFailure `json:"recent_failures"`
	RegisteredDevices int64            `json:"registered_devices"`
}

type ChannelStat struct {
	Channel ChannelType `json:"channel"`
	Status  string      `json:"status"`
	Count   int64       `json:"count"`
}

type HistoryFailure struct {
	ID           string           `json:"id"`
	UserID       string           `json:"user_id"`
	Type         NotificationType `json:"type"`
	Channel      ChannelType      `json:"channel"`
	ErrorMessage string           `json:"error_message"`
	CreatedAt    string           `json:"created_at"`
}
