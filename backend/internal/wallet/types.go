package wallet

import "time"

const (
	AccountTypeRiderWallet          = "rider_wallet"
	AccountTypeDriverWallet         = "driver_wallet"
	AccountTypePlatformWallet       = "platform_wallet"
	AccountTypeCashLiabilityWallet  = "cash_liability_wallet"
	AccountTypePendingDepositWallet = "pending_deposit_wallet"
	AccountTypeProviderClearing     = "provider_clearing_wallet"

	OwnerRoleRider    = "rider"
	OwnerRoleDriver   = "driver"
	OwnerRolePlatform = "platform"
	OwnerRoleSystem   = "system"

	AccountStatusActive = "active"
	AccountStatusFrozen = "frozen"
	AccountStatusClosed = "closed"

	TransactionTypeRideSettlement   = "ride_settlement"
	TransactionTypeCashLiability    = "cash_liability"
	TransactionTypeDeposit          = "deposit"
	TransactionTypeWithdrawal       = "withdrawal"
	TransactionTypeRefund           = "refund"
	TransactionTypeReversal         = "reversal"
	TransactionTypeAdminAdjustment  = "admin_adjustment"
	TransactionTypeShadowSettlement = "shadow_settlement"
	TransactionTypeCashPlatformFee  = "cash_platform_fee"
	TransactionTypeWalletSettlement = "wallet_settlement"

	TransactionStatusPending          = "pending"
	TransactionStatusPosted           = "posted"
	TransactionStatusReversed         = "reversed"
	TransactionStatusFailed           = "failed"
	TransactionStatusCancelled        = "cancelled"
	TransactionStatusRequiresApproval = "requires_approval"

	EntryTypeDebit  = "debit"
	EntryTypeCredit = "credit"

	CurrencyUSD = "USD"
	CurrencyZWG = "ZWG"

	SettlementModeShadow = "shadow"
	SettlementModeActive = "active"

	SettlementStatusPending           = "pending"
	SettlementStatusPosted            = "posted"
	SettlementStatusProcessing        = "processing"
	SettlementStatusSettled           = "settled"
	SettlementStatusLiabilityRecorded = "liability_recorded"
	SettlementStatusFailed            = "failed"
	SettlementStatusReversed          = "reversed"
	SettlementStatusCanceled          = "cancelled"

	DepositStatusPendingAdminApproval = "pending_admin_approval"
	DepositStatusPendingProvider      = "pending_provider_payment"
	DepositStatusApproved             = "approved"
	DepositStatusCompleted            = "completed"
	DepositStatusRejected             = "rejected"

	WithdrawalStatusPendingApproval = "pending_approval"
	WithdrawalStatusApproved        = "approved"
	WithdrawalStatusRejected        = "rejected"

	AuthorizationStatusAuthorized = "authorized"
	AuthorizationStatusCaptured   = "captured"
	AuthorizationStatusReleased   = "released"
	AuthorizationStatusExpired    = "expired"
	AuthorizationStatusFailed     = "failed"

	PilotRoleRider  = "pilot_rider"
	PilotRoleDriver = "pilot_driver"
	PilotRoleAdmin  = "pilot_admin"

	PilotStatusEnabled   = "enabled"
	PilotStatusDisabled  = "disabled"
	PilotStatusSuspended = "suspended"
	PilotStatusRemoved   = "removed"

	ManualMethodEcoCash  = "manual_ecocash"
	ManualMethodInnbucks = "manual_innbucks"
	ManualMethodBank     = "manual_bank"
	ManualMethodCash     = "manual_cash"
	ManualMethodCard     = "manual_card"
	ManualMethodPayPal   = "manual_paypal"

	ProviderOneMoney = "onemoney"
	ProviderEcoCash  = "ecocash"
	ProviderInnbucks = "innbucks"
	ProviderCard     = "card"
	ProviderPayPal   = "paypal"

	FinancialJobStatusPending    = "pending"
	FinancialJobStatusProcessing = "processing"
	FinancialJobStatusSucceeded  = "succeeded"
	FinancialJobStatusFailed     = "failed"
	FinancialJobStatusDeadLetter = "dead_lettered"
	FinancialJobStatusCancelled  = "cancelled"

	FinancialJobTypeCashSettlement             = "cash_settlement"
	FinancialJobTypeWalletCapture              = "wallet_capture"
	FinancialJobTypeAuthorizationRelease       = "authorization_release"
	FinancialJobTypeAuthorizationExpiration    = "authorization_expiration"
	FinancialJobTypeReconciliationRun          = "reconciliation_run"
	FinancialJobTypeProviderCallbackProcessing = "provider_callback_processing"
	FinancialJobTypeRefundProcessing           = "refund_processing"
	FinancialJobTypeChargebackProcessing       = "chargeback_processing"
	FinancialJobTypeDisputeResolution          = "dispute_resolution"
	FinancialJobTypeProviderStatementReconcile = "provider_statement_reconciliation"
	FinancialJobTypeFinancialIncidentReview    = "financial_incident_review"
	FinancialJobTypeProviderCertification      = "provider_certification"
	FinancialJobTypeRecoveryDrill              = "recovery_drill"
	FinancialJobTypeSettlementFailureDrill     = "settlement_failure_drill"
	FinancialJobTypeReconciliationFailureDrill = "reconciliation_failure_drill"
	FinancialJobTypeProviderCallbackDrill      = "provider_callback_failure_drill"
	FinancialJobTypeDualApprovalReview         = "dual_approval_review"
	FinancialJobTypeFinanceClose               = "finance_close"
	FinancialJobTypeLaunchGateReview           = "launch_gate_review"
	FinancialJobTypeReleaseReadinessReview     = "release_readiness_review"
	FinancialJobTypeLaunchGateDrill            = "launch_gate_drill"
	FinancialJobTypeExecutiveSignoffPacket     = "executive_signoff_packet"
	FinancialJobTypeInternalLaunchDrill        = "internal_launch_drill"
	FinancialJobTypeDrillEvidenceReview        = "drill_evidence_review"
	FinancialJobTypeProductionExceptionClosure = "production_exception_closure"
	FinancialJobTypeDailyFinanceClose          = "daily_finance_close"
	FinancialJobTypeInternalPilotRunbook       = "internal_pilot_runbook"
	FinancialJobTypeInternalPilotAuthorization = "internal_pilot_authorization"

	FinancialMetricSettlementFailure       = "settlement_failure"
	FinancialMetricCallbackFailure         = "callback_failure"
	FinancialMetricReconciliationDrift     = "reconciliation_drift"
	FinancialMetricExpiredAuthorization    = "expired_authorization"
	FinancialMetricFailedCapture           = "failed_capture"
	FinancialMetricFailedRelease           = "failed_release"
	FinancialMetricProviderStatementDrift  = "provider_statement_drift"
	FinancialMetricRefundFailure           = "refund_failure"
	FinancialMetricChargebackFailure       = "chargeback_failure"
	FinancialMetricOpenDispute             = "open_dispute"
	FinancialMetricFinancialIncident       = "financial_incident"
	FinancialMetricCertificationFailure    = "certification_failure"
	FinancialMetricRecoveryDrillFailure    = "recovery_drill_failure"
	FinancialMetricRecoveryScore           = "recovery_score"
	FinancialMetricLaunchGateBlocked       = "launch_gate_blocked"
	FinancialMetricFinanceCloseFailure     = "finance_close_failure"
	FinancialMetricReleaseReadinessScore   = "release_readiness_score"
	FinancialMetricLaunchGateDrillFailure  = "launch_gate_drill_failure"
	FinancialMetricLaunchBlockerOpen       = "launch_blocker_open"
	FinancialMetricProductionExceptionOpen = "production_exception_open"

	RefundStatusPendingReview = "pending_review"
	RefundStatusApproved      = "approved"
	RefundStatusProcessing    = "processing"
	RefundStatusPosted        = "posted"
	RefundStatusFailed        = "failed"
	RefundStatusCancelled     = "cancelled"
	RefundStatusRejected      = "rejected"

	ChargebackStatusReceived    = "received"
	ChargebackStatusUnderReview = "under_review"
	ChargebackStatusAccepted    = "accepted"
	ChargebackStatusRepresented = "represented"
	ChargebackStatusWon         = "won"
	ChargebackStatusLost        = "lost"
	ChargebackStatusClosed      = "closed"

	DisputeStatusOpened             = "opened"
	DisputeStatusUnderReview        = "under_review"
	DisputeStatusAwaitingProvider   = "awaiting_provider"
	DisputeStatusAwaitingUser       = "awaiting_user"
	DisputeStatusResolvedRefund     = "resolved_refund"
	DisputeStatusResolvedNoChange   = "resolved_no_change"
	DisputeStatusResolvedAdjustment = "resolved_adjustment"
	DisputeStatusClosed             = "closed"
	DisputeStatusCancelled          = "cancelled"

	IncidentStatusOpened        = "opened"
	IncidentStatusInvestigating = "investigating"
	IncidentStatusMitigated     = "mitigated"
	IncidentStatusResolved      = "resolved"
	IncidentStatusClosed        = "closed"

	CertificationStatusPending = "pending"
	CertificationStatusRunning = "running"
	CertificationStatusPassed  = "passed"
	CertificationStatusFailed  = "failed"
	CertificationStatusExpired = "expired"
	CertificationStatusRevoked = "revoked"

	CertificationCheckStatusPending = "pending"
	CertificationCheckStatusPassed  = "passed"
	CertificationCheckStatusFailed  = "failed"
	CertificationCheckStatusWarning = "warning"

	RecoveryDrillStatusScheduled = "scheduled"
	RecoveryDrillStatusRunning   = "running"
	RecoveryDrillStatusPassed    = "passed"
	RecoveryDrillStatusFailed    = "failed"
	RecoveryDrillStatusCancelled = "cancelled"

	ApprovalStatusPending  = "pending"
	ApprovalStatusApproved = "approved"
	ApprovalStatusRejected = "rejected"
	ApprovalStatusExpired  = "expired"

	LaunchGateStatusBlocked  = "blocked"
	LaunchGateStatusPending  = "pending_approval"
	LaunchGateStatusApproved = "approved"
	LaunchGateStatusRejected = "rejected"

	FinanceCloseStatusOpened         = "opened"
	FinanceCloseStatusReconciling    = "reconciling"
	FinanceCloseStatusPendingSignoff = "pending_signoff"
	FinanceCloseStatusSignedOff      = "signed_off"
	FinanceCloseStatusFailed         = "failed"
	FinanceCloseStatusReopened       = "reopened"

	ReleaseEvidenceStatusPresent = "present"
	ReleaseEvidenceStatusMissing = "missing"
	ReleaseEvidenceStatusWarning = "warning"

	LaunchGateDrillStatusRunning = "running"
	LaunchGateDrillStatusPassed  = "passed"
	LaunchGateDrillStatusFailed  = "failed"

	ExecutiveApprovalStatusPending     = "pending"
	ExecutiveApprovalStatusApproved    = "approved"
	ExecutiveApprovalStatusRejected    = "rejected"
	ExecutiveApprovalStatusConditional = "conditional_approval"

	LaunchBlockerStatusOpen     = "open"
	LaunchBlockerStatusResolved = "resolved"

	InternalLaunchOutcomeNotReady        = "not_ready"
	InternalLaunchOutcomePilotReady      = "internal_pilot_ready"
	InternalLaunchOutcomeControlledReady = "controlled_launch_ready"
	InternalLaunchOutcomePublicReady     = "public_launch_ready"
	PilotAuthorizationOutcomeInternal    = "ready_for_internal_pilot"
	PilotAuthorizationOutcomeControlled  = "ready_for_controlled_launch"
	PilotAuthorizationOutcomePublic      = "ready_for_public_launch"

	ProductionExceptionStatusOpen          = "open"
	ProductionExceptionStatusInvestigating = "investigating"
	ProductionExceptionStatusMitigated     = "mitigated"
	ProductionExceptionStatusVerified      = "verified"
	ProductionExceptionStatusClosed        = "closed"

	DrillEvidenceReviewStatusPending  = "pending"
	DrillEvidenceReviewStatusApproved = "approved"
	DrillEvidenceReviewStatusRejected = "rejected"

	DailyCloseStatusOpen          = "open"
	DailyCloseStatusReconciling   = "reconciling"
	DailyCloseStatusPendingReview = "pending_review"
	DailyCloseStatusSignedOff     = "signed_off"
	DailyCloseStatusFailed        = "failed"

	IncidentEscalationInformational = "informational"
	IncidentEscalationWarning       = "warning"
	IncidentEscalationHigh          = "high"
	IncidentEscalationCritical      = "critical"

	PilotTimelineEventStart      = "pilot_start"
	PilotTimelineEventCheckpoint = "pilot_checkpoint"
	PilotTimelineEventReview     = "pilot_review"
	PilotTimelineEventClose      = "pilot_close"

	GoNoGoDecisionNoGo          = "no_go"
	GoNoGoDecisionConditionalGo = "conditional_go"
	GoNoGoDecisionGo            = "go"

	InternalPilotApprovalApproved    = "approved"
	InternalPilotApprovalConditional = "conditional_approval"
	InternalPilotApprovalRejected    = "rejected"
	InternalPilotApprovalExpired     = "expired"

	InternalPilotAuthorizationActive    = "active"
	InternalPilotAuthorizationExpired   = "expired"
	InternalPilotAuthorizationRevoked   = "revoked"
	InternalPilotAuthorizationCompleted = "completed"

	InternalPilotParticipantRoleRider      = "rider"
	InternalPilotParticipantRoleDriver     = "driver"
	InternalPilotParticipantRoleAdmin      = "admin"
	InternalPilotParticipantRoleOperations = "operations"
	InternalPilotParticipantRoleFinance    = "finance"
	InternalPilotParticipantRoleRisk       = "risk"

	InternalPilotParticipantActive    = "active"
	InternalPilotParticipantSuspended = "suspended"
	InternalPilotParticipantRemoved   = "removed"

	InternalPilotIncidentStatusOpen          = "open"
	InternalPilotIncidentStatusInvestigating = "investigating"
	InternalPilotIncidentStatusMitigated     = "mitigated"
	InternalPilotIncidentStatusResolved      = "resolved"
	InternalPilotIncidentStatusClosed        = "closed"

	InternalPilotIncidentSeverityLow      = "low"
	InternalPilotIncidentSeverityMedium   = "medium"
	InternalPilotIncidentSeverityHigh     = "high"
	InternalPilotIncidentSeverityCritical = "critical"

	InternalPilotServiceRideRequests = "ride_requests"
	InternalPilotServiceMatching     = "matching"
	InternalPilotServiceDispatch     = "dispatch"
	InternalPilotServiceWallets      = "wallets"
	InternalPilotServiceDeposits     = "deposits"
	InternalPilotServiceWithdrawals  = "withdrawals"
	InternalPilotServiceSettlements  = "settlements"

	InternalPilotKillSwitchActive   = "active"
	InternalPilotKillSwitchInactive = "inactive"

	InternalPilotEventParticipantJoined        = "participant_joined"
	InternalPilotEventRideRequested            = "ride_requested"
	InternalPilotEventRideOfferCreated         = "ride_offer_created"
	InternalPilotEventRideOfferAccepted        = "ride_offer_accepted"
	InternalPilotEventDriverEnroute            = "driver_enroute"
	InternalPilotEventPickupReached            = "pickup_reached"
	InternalPilotEventTripStarted              = "trip_started"
	InternalPilotEventTripCompleted            = "trip_completed"
	InternalPilotEventTripCancelled            = "trip_cancelled"
	InternalPilotEventWalletPaymentAttempted   = "wallet_payment_attempted"
	InternalPilotEventWalletPaymentCompleted   = "wallet_payment_completed"
	InternalPilotEventCashPaymentCompleted     = "cash_payment_completed"
	InternalPilotEventPlatformFeeRecorded      = "platform_fee_recorded"
	InternalPilotEventDriverEarningsRecorded   = "driver_earnings_recorded"
	InternalPilotEventAuthorizationCheckPassed = "authorization_check_passed"
	InternalPilotEventAuthorizationCheckFailed = "authorization_check_failed"
	InternalPilotEventIncidentCreated          = "incident_created"
	InternalPilotEventIncidentResolved         = "incident_resolved"
	InternalPilotEventKillSwitchTriggered      = "kill_switch_triggered"

	InternalPilotBoardReviewStatusPending   = "pending"
	InternalPilotBoardReviewStatusInReview  = "in_review"
	InternalPilotBoardReviewStatusCompleted = "completed"

	InternalPilotBoardDecisionApproved    = "approved"
	InternalPilotBoardDecisionConditional = "conditional_approval"
	InternalPilotBoardDecisionRejected    = "rejected"
	InternalPilotBoardDecisionDefer       = "defer"

	InternalPilotFindingCategoryOperations = "operations"
	InternalPilotFindingCategoryFinancial  = "financial"
	InternalPilotFindingCategoryCompliance = "compliance"
	InternalPilotFindingCategoryPlatform   = "platform"
	InternalPilotFindingCategorySafety     = "safety"
	InternalPilotFindingCategoryDispatch   = "dispatch"
	InternalPilotFindingCategoryWallet     = "wallet"
	InternalPilotFindingCategoryGovernance = "governance"

	InternalPilotReadinessCategoryOperational = "operational_readiness"
	InternalPilotReadinessCategoryFinancial   = "financial_readiness"
	InternalPilotReadinessCategoryDispatch    = "dispatch_readiness"
	InternalPilotReadinessCategoryWallet      = "wallet_readiness"
	InternalPilotReadinessCategoryGovernance  = "governance_readiness"
	InternalPilotReadinessCategoryCompliance  = "compliance_readiness"
	InternalPilotReadinessCategoryScalability = "scalability_readiness"

	WalletPilotCityGwanda   = "Gwanda"
	WalletPilotCityBulawayo = "Bulawayo"

	WalletPilotProgramStatusPlanned   = "planned"
	WalletPilotProgramStatusActive    = "active"
	WalletPilotProgramStatusPaused    = "paused"
	WalletPilotProgramStatusCompleted = "completed"
	WalletPilotProgramStatusSuspended = "suspended"

	WalletPilotParticipantTypeRider  = "rider"
	WalletPilotParticipantTypeDriver = "driver"

	WalletPilotParticipantStatusActive    = "active"
	WalletPilotParticipantStatusSuspended = "suspended"
	WalletPilotParticipantStatusRemoved   = "removed"

	WalletPilotTransactionTypeDeposit     = "deposit"
	WalletPilotTransactionTypeRidePayment = "ride_payment"
	WalletPilotTransactionTypeRefund      = "refund"
	WalletPilotTransactionTypeAdjustment  = "adjustment"

	WalletPilotTransactionStatusRecorded = "recorded"
	WalletPilotTransactionStatusRejected = "rejected"
	WalletPilotTransactionStatusFailed   = "failed"

	WalletPilotReconciliationBalanced         = "balanced"
	WalletPilotReconciliationVarianceDetected = "variance_detected"
	WalletPilotReconciliationInvestigating    = "investigating"

	WalletPilotFraudSeverityLow      = "low"
	WalletPilotFraudSeverityMedium   = "medium"
	WalletPilotFraudSeverityHigh     = "high"
	WalletPilotFraudSeverityCritical = "critical"

	WalletPilotFraudStatusOpen          = "open"
	WalletPilotFraudStatusInvestigating = "investigating"
	WalletPilotFraudStatusResolved      = "resolved"
	WalletPilotFraudStatusClosed        = "closed"

	WalletPilotFraudDuplicatePayments      = "duplicate_payments"
	WalletPilotFraudUnusualFrequency       = "unusual_payment_frequency"
	WalletPilotFraudAbnormalRefundActivity = "abnormal_refund_activity"
	WalletPilotFraudRapidBalanceCycling    = "rapid_balance_cycling"
	WalletPilotFraudMultiAccountAbuse      = "multi_account_abuse"
	WalletPilotFraudWalletFarming          = "wallet_farming"
	WalletPilotFraudPilotAbuse             = "pilot_abuse"
	WalletPilotFraudReconciliationVariance = "reconciliation_variance"

	WalletPilotKillSwitchDisableDeposits          = "disable_deposits"
	WalletPilotKillSwitchDisableWalletPayments    = "disable_wallet_payments"
	WalletPilotKillSwitchDisableRefunds           = "disable_refunds"
	WalletPilotKillSwitchDisableWalletAdjustments = "disable_wallet_adjustments"
)

type Account struct {
	ID                          string
	OwnerUserID                 string
	OwnerRole                   string
	AccountType                 string
	Currency                    string
	Status                      string
	CachedAvailableBalanceMinor int64
	CachedPendingBalanceMinor   int64
	CachedLiabilityBalanceMinor int64
	CreatedAt                   time.Time
	UpdatedAt                   time.Time
}

type Transaction struct {
	ID               string
	TransactionType  string
	Status           string
	IdempotencyKey   string
	Currency         string
	TotalAmountMinor int64
	SourceType       string
	SourceID         string
	OwnerUserID      string
	RideID           string
	PaymentProvider  string
	PaymentIntentID  string
	CreatedBy        string
	ApprovedBy       string
	ApprovedAt       *time.Time
	CreatedAt        time.Time
	UpdatedAt        time.Time
}

type LedgerEntry struct {
	ID              string
	TransactionID   string
	AccountID       string
	EntryType       string
	AmountMinor     int64
	Currency        string
	RideID          string
	SourceType      string
	SourceID        string
	PaymentProvider string
	CreatedAt       time.Time
}

type PaymentIntent struct {
	ID                  string
	UserID              string
	AmountMinor         int64
	Currency            string
	Provider            string
	PaymentMethod       string
	Status              string
	WalletAccountType   string
	ProviderReference   string
	IdempotencyKey      string
	ExpiresAt           *time.Time
	ApprovedBy          string
	ApprovedAt          *time.Time
	RejectedBy          string
	RejectedAt          *time.Time
	RejectionReason     string
	WalletTransactionID string
	CreatedAt           time.Time
	UpdatedAt           time.Time
}

type ProviderEvent struct {
	ID                string
	Provider          string
	ProviderEventID   string
	ProviderReference string
	EventType         string
	SignatureValid    bool
	PayloadHash       string
	Status            string
	Payload           string
	ReceivedAt        time.Time
	ProcessedAt       *time.Time
}

type ProviderDepositCallback struct {
	Provider          string
	ProviderEventID   string
	ProviderReference string
	EventType         string
	AmountMinor       int64
	Currency          string
	Status            string
	SignatureValid    bool
	PayloadHash       string
	Payload           string
	IdempotencyKey    string
}

type ProviderCallbackDeadLetter struct {
	Provider          string
	ProviderEventID   string
	ProviderReference string
	EventType         string
	PayloadHash       string
	Payload           string
	Reason            string
	CreatedAt         time.Time
}

type WithdrawalRequest struct {
	ID                   string
	DriverID             string
	WalletAccountID      string
	AmountMinor          int64
	Currency             string
	Provider             string
	DestinationReference string
	Status               string
	IdempotencyKey       string
	RequestedAt          time.Time
}

type WalletAuthorization struct {
	ID                  string
	RideID              string
	RiderID             string
	WalletAccountID     string
	AmountMinor         int64
	Currency            string
	Status              string
	IdempotencyKey      string
	ExpiresAt           time.Time
	CapturedAmountMinor int64
	ReleasedAmountMinor int64
	FailureReason       string
	CreatedAt           time.Time
	UpdatedAt           time.Time
}

type AuthorizationRequest struct {
	RideID         string
	RiderID        string
	AmountMinor    int64
	Currency       string
	City           string
	IdempotencyKey string
}

type CaptureRequest struct {
	RideID         string
	RiderID        string
	DriverID       string
	AmountMinor    int64
	Currency       string
	City           string
	IdempotencyKey string
}

type ReleaseRequest struct {
	RideID         string
	RiderID        string
	Reason         string
	IdempotencyKey string
}

type SettlementRecord struct {
	ID                  string
	RideID              string
	DriverID            string
	RiderID             string
	FareMinor           int64
	PlatformFeeMinor    int64
	DriverEarningMinor  int64
	Currency            string
	PaymentMethod       string
	SettlementMode      string
	Status              string
	WalletTransactionID string
	IdempotencyKey      string
	Error               string
	CreatedAt           time.Time
	UpdatedAt           time.Time
}

type CompletedRide struct {
	RideID        string
	RiderID       string
	DriverID      string
	FareMinor     int64
	PaymentMethod string
	Currency      string
	City          string
	CompletedAt   time.Time
}

type SettlementCalculation struct {
	FareMinor          int64
	PlatformFeeMinor   int64
	DriverEarningMinor int64
	Currency           string
}

type ReconciliationRun struct {
	ID                   string
	Provider             string
	RunType              string
	Status               string
	StartedAt            time.Time
	CompletedAt          *time.Time
	MatchedCount         int
	MismatchCount        int
	MissingProviderCount int
	MissingLedgerCount   int
}

type WalletReconciliationResult struct {
	RunID                      string
	Status                     string
	CheckedAccountCount        int
	DriftCount                 int
	OrphanedAuthorizationCount int
	SettlementMismatchCount    int
	LiabilityMismatchCount     int
	OpenAuthorizationCount     int
	ExpiredAuthorizationCount  int
	CreatedAt                  time.Time
}

type DepositRequest struct {
	UserID            string
	WalletAccountType string
	AmountMinor       int64
	Currency          string
	Method            string
	City              string
	IdempotencyKey    string
}

type WithdrawalCreateRequest struct {
	DriverID             string
	AmountMinor          int64
	Currency             string
	Method               string
	City                 string
	DestinationReference string
	IdempotencyKey       string
}

type TransferRequest struct {
	SenderID       string
	ReceiverID     string
	AmountMinor    int64
	Currency       string
	Note           string
	IdempotencyKey string
}

type TransferResult struct {
	TransactionID string
	AmountMinor   int64
	Currency      string
	Reference     string
}

type WalletPayRequest struct {
	RiderID        string
	RideID         string
	IdempotencyKey string
}

type WalletPayResult struct {
	SettlementID string
	AmountMinor  int64
	Currency     string
	AlreadyPaid  bool
	Reference    string
}

type WalletPINRequest struct {
	UserID         string
	PIN            string
	IdempotencyKey string
}

type LookupUserResult struct {
	UserID        string
	FullName      string
	PickMeAccount string
}

type AdminDecision struct {
	AdminUserID string
	TargetID    string
	Reason      string
}

type AdminAction struct {
	ID             string
	AdminUserID    string
	Action         string
	TargetType     string
	TargetID       string
	Reason         string
	PreviousStatus string
	NewStatus      string
	CreatedAt      time.Time
}

type PilotUser struct {
	ID          string
	UserID      string
	Role        string
	Status      string
	GroupName   string
	EnabledBy   string
	DisabledBy  string
	SuspendedBy string
	RemovedBy   string
	Reason      string
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

type PilotUserChange struct {
	UserID    string
	Role      string
	Status    string
	GroupName string
	AdminID   string
	Reason    string
}

type FinancialJob struct {
	ID             string
	JobType        string
	Status         string
	SourceType     string
	SourceID       string
	Provider       string
	IdempotencyKey string
	AttemptCount   int
	MaxAttempts    int
	NextAttemptAt  time.Time
	LockedBy       string
	LockedUntil    *time.Time
	FailureReason  string
	Metadata       string
	CreatedAt      time.Time
	UpdatedAt      time.Time
}

type FinancialMetric struct {
	ID            string
	MetricType    string
	Provider      string
	ReferenceType string
	ReferenceID   string
	Value         int
	Metadata      string
	CreatedAt     time.Time
}

type ProviderStatementImport struct {
	ID                 string
	Provider           string
	StatementReference string
	Status             string
	ImportedBy         string
	TotalLineCount     int
	MatchedCount       int
	MismatchCount      int
	UnmatchedCount     int
	FailureReason      string
	CreatedAt          time.Time
	CompletedAt        *time.Time
}

type ProviderStatementLine struct {
	ID                         string
	ImportID                   string
	Provider                   string
	LineReference              string
	ProviderReference          string
	ProviderEventID            string
	LineType                   string
	AmountMinor                int64
	Currency                   string
	Status                     string
	MatchStatus                string
	MatchedPaymentIntentID     string
	MatchedWalletTransactionID string
	MismatchReason             string
	OccurredAt                 *time.Time
	CreatedAt                  time.Time
}

type RefundIntent struct {
	ID                          string
	Provider                    string
	UserID                      string
	OriginalPaymentIntentID     string
	OriginalWalletTransactionID string
	AmountMinor                 int64
	Currency                    string
	Status                      string
	Reason                      string
	IdempotencyKey              string
	CreatedBy                   string
	ApprovedBy                  string
	WalletTransactionID         string
	FailureReason               string
	CreatedAt                   time.Time
	UpdatedAt                   time.Time
}

type ChargebackRecord struct {
	ID                   string
	Provider             string
	ProviderReference    string
	ProviderChargebackID string
	PaymentIntentID      string
	WalletTransactionID  string
	AmountMinor          int64
	Currency             string
	Status               string
	Reason               string
	OpenedAt             time.Time
	ResolvedAt           *time.Time
	Metadata             string
	CreatedAt            time.Time
	UpdatedAt            time.Time
}

type FinancialDispute struct {
	ID                  string
	DisputeType         string
	Status              string
	Provider            string
	RideID              string
	UserID              string
	PaymentIntentID     string
	WalletTransactionID string
	AmountMinor         int64
	Currency            string
	Reason              string
	Resolution          string
	OpenedBy            string
	AssignedTo          string
	CreatedAt           time.Time
	UpdatedAt           time.Time
	ResolvedAt          *time.Time
}

type FinancialIncident struct {
	ID           string
	Severity     string
	Status       string
	IncidentType string
	Provider     string
	SourceType   string
	SourceID     string
	Title        string
	Description  string
	OpenedBy     string
	ResolvedBy   string
	Resolution   string
	CreatedAt    time.Time
	UpdatedAt    time.Time
	ResolvedAt   *time.Time
}

type ProviderStatementImportRequest struct {
	ID                 string
	Provider           string
	StatementReference string
	ImportedBy         string
	Lines              []ProviderStatementLine
}

type RecoverySummary struct {
	OpenRefunds         int
	OpenChargebacks     int
	OpenDisputes        int
	OpenIncidents       int
	StatementMismatches int
	DeadLetterJobs      int
}

type ProviderCertification struct {
	ID                string
	Provider          string
	CertificationType string
	Status            string
	Score             int
	CertifiedBy       string
	CertifiedAt       *time.Time
	ExpiresAt         *time.Time
	Metadata          string
	CreatedAt         time.Time
	UpdatedAt         time.Time
}

type ProviderCertificationCheck struct {
	ID              string
	CertificationID string
	Provider        string
	CheckType       string
	Status          string
	Evidence        string
	FailureReason   string
	PerformedAt     *time.Time
	Metadata        string
	CreatedAt       time.Time
	UpdatedAt       time.Time
}

type RecoveryDrill struct {
	ID            string
	DrillType     string
	Provider      string
	Status        string
	Score         int
	TriggeredBy   string
	FailureReason string
	Metadata      string
	StartedAt     *time.Time
	CompletedAt   *time.Time
	CreatedAt     time.Time
	UpdatedAt     time.Time
}

type RecoveryDrillEvent struct {
	ID        string
	DrillID   string
	EventType string
	Status    string
	Message   string
	Metadata  string
	CreatedAt time.Time
}

type RecoveryScorecard struct {
	ID          string
	Provider    string
	ScoreType   string
	Score       int
	Status      string
	PeriodStart time.Time
	PeriodEnd   time.Time
	Metadata    string
	CreatedAt   time.Time
}

type FinanceApprovalRequest struct {
	ID                    string
	ApprovalType          string
	Status                string
	TargetType            string
	TargetID              string
	RequestedBy           string
	RequiredApprovalCount int
	ApprovalsCount        int
	RejectionReason       string
	Metadata              string
	CreatedAt             time.Time
	UpdatedAt             time.Time
	CompletedAt           *time.Time
}

type FinanceApprovalEvent struct {
	ID           string
	RequestID    string
	ApproverID   string
	ApproverRole string
	Decision     string
	Reason       string
	CreatedAt    time.Time
}

type LaunchGate struct {
	ID                       string
	GateKey                  string
	GateType                 string
	Provider                 string
	Status                   string
	ReadinessScore           int
	FinanceApprovalRequestID string
	CTOApprovalRequestID     string
	CreatedBy                string
	Metadata                 string
	CreatedAt                time.Time
	UpdatedAt                time.Time
}

type FinanceCloseRun struct {
	ID            string
	CloseType     string
	Status        string
	PeriodStart   time.Time
	PeriodEnd     time.Time
	OpenedBy      string
	SignedOffBy   string
	MismatchCount int
	Metadata      string
	CreatedAt     time.Time
	UpdatedAt     time.Time
	CompletedAt   *time.Time
}

type FinanceSignoff struct {
	ID          string
	SignoffType string
	TargetType  string
	TargetID    string
	Status      string
	SignerID    string
	Reason      string
	SignedAt    *time.Time
	CreatedAt   time.Time
}

type LaunchReadinessScorecard struct {
	ID                      string
	Score                   int
	Status                  string
	PublicPaymentsReady     bool
	ProviderActivationReady bool
	FinanceCloseReady       bool
	DualApprovalReady       bool
	RecoveryDrillsReady     bool
	CreatedBy               string
	Metadata                string
	CreatedAt               time.Time
}

type ReleaseEvidenceRecord struct {
	ID           string
	Category     string
	Component    string
	Status       string
	EvidenceType string
	EvidenceRef  string
	ScoreImpact  int
	CollectedBy  string
	Metadata     string
	CreatedAt    time.Time
}

type LaunchGateDrill struct {
	ID                      string
	DrillType               string
	Status                  string
	Provider                string
	SimulatedGateType       string
	MissingApprovalBlocked  bool
	LowScoreBlocked         bool
	CertificationBlocked    bool
	ReconciliationBlocked   bool
	AllRequirementsApproved bool
	NoActivationMutation    bool
	TriggeredBy             string
	FailureReason           string
	Metadata                string
	CreatedAt               time.Time
	CompletedAt             *time.Time
}

type FinalReadinessScorecard struct {
	ID                     string
	ArchitectureScore      int
	ReliabilityScore       int
	SecurityScore          int
	FinanceScore           int
	GovernanceScore        int
	OperationsScore        int
	ProviderReadinessScore int
	LaunchReadinessScore   int
	OverallScore           int
	Status                 string
	LaunchRecommendation   string
	Blockers               string
	CreatedBy              string
	Metadata               string
	CreatedAt              time.Time
}

type ExecutiveSignoffPacket struct {
	ID                   string
	PacketType           string
	Status               string
	FinanceStatus        string
	CTOStatus            string
	RiskStatus           string
	OperationsStatus     string
	EvidenceBundle       string
	ReadinessScorecardID string
	GeneratedBy          string
	Metadata             string
	CreatedAt            time.Time
	UpdatedAt            time.Time
}

type ExecutiveApprovalRecord struct {
	ID           string
	PacketID     string
	ApproverRole string
	ApproverID   string
	Status       string
	Conditions   string
	Reason       string
	CreatedAt    time.Time
}

type LaunchBlocker struct {
	ID         string
	Title      string
	Severity   string
	Status     string
	OwnerID    string
	DueDate    *time.Time
	ResolvedBy string
	Resolution string
	Metadata   string
	CreatedAt  time.Time
	UpdatedAt  time.Time
	ResolvedAt *time.Time
}

type InternalLaunchDecision struct {
	ID                               string
	Outcome                          string
	ProviderActivationSimulated      bool
	WalletActivationSimulated        bool
	WithdrawalActivationSimulated    bool
	PublicPaymentActivationSimulated bool
	OpenBlockersCount                int
	OverallReadinessScore            int
	DecidedBy                        string
	DecisionReason                   string
	Metadata                         string
	CreatedAt                        time.Time
}

type DrillEvidence struct {
	ID          string
	DrillType   string
	Provider    string
	Status      string
	EvidenceRef string
	SubmittedBy string
	Metadata    string
	CreatedAt   time.Time
}

type DrillEvidenceReview struct {
	ID           string
	EvidenceID   string
	ReviewerRole string
	ReviewerID   string
	Status       string
	Notes        string
	CreatedAt    time.Time
}

type ProductionException struct {
	ID                   string
	Severity             string
	OwnerID              string
	Status               string
	RemediationPlan      string
	TargetResolutionDate *time.Time
	VerifiedBy           string
	ClosedBy             string
	Metadata             string
	CreatedAt            time.Time
	UpdatedAt            time.Time
	ClosedAt             *time.Time
}

type ReliabilityScorecard struct {
	ID                              string
	ScorecardType                   string
	SettlementReliabilityScore      int
	ProviderReliabilityScore        int
	ReconciliationReliabilityScore  int
	GovernanceReliabilityScore      int
	LaunchReadinessReliabilityScore int
	OverallScore                    int
	AuthorizationOutcome            string
	CreatedBy                       string
	Metadata                        string
	CreatedAt                       time.Time
}

type ControlRoomSnapshot struct {
	ID                    string
	SettlementHealth      string
	ProviderHealth        string
	ReconciliationHealth  string
	AuthorizationHealth   string
	LaunchReadinessHealth string
	CreatedBy             string
	Metadata              string
	CreatedAt             time.Time
}

type DailyFinanceClose struct {
	ID                   string
	CloseDate            time.Time
	Status               string
	OpeningBalanceMinor  int64
	ClosingBalanceMinor  int64
	ProviderTotalMinor   int64
	WalletTotalMinor     int64
	ReconciliationStatus string
	UnresolvedExceptions int
	OpenedBy             string
	SignedOffBy          string
	Metadata             string
	CreatedAt            time.Time
	UpdatedAt            time.Time
	SignedOffAt          *time.Time
}

type DailyCloseReview struct {
	ID         string
	CloseID    string
	ReviewRole string
	ReviewerID string
	Status     string
	Notes      string
	CreatedAt  time.Time
}

type DailyReliabilityMetrics struct {
	ID                          string
	MetricDate                  time.Time
	SettlementSuccessRate       int
	ProviderCallbackSuccessRate int
	ReconciliationSuccessRate   int
	RefundSuccessRate           int
	DisputeResolutionRate       int
	CreatedBy                   string
	Metadata                    string
	CreatedAt                   time.Time
}

type PilotMonitoringSnapshot struct {
	ID                string
	PilotUsers        int
	PilotTransactions int
	PilotDeposits     int
	PilotWithdrawals  int
	PilotFailures     int
	CreatedBy         string
	Metadata          string
	CreatedAt         time.Time
}

type InternalPilotRunbook struct {
	ID          string
	RunbookType string
	Title       string
	Status      string
	OwnerID     string
	Steps       string
	Metadata    string
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

type Day1CloseSimulation struct {
	ID                       string
	Status                   string
	OpeningBalanceValidated  bool
	TransactionValidated     bool
	ProviderTotalValidated   bool
	WalletTotalValidated     bool
	ReconciliationValidated  bool
	ExceptionReviewCompleted bool
	FinanceSignedOff         bool
	OperationsSignedOff      bool
	SimulatedBy              string
	Metadata                 string
	CreatedAt                time.Time
}

type IncidentEscalation struct {
	ID           string
	IncidentType string
	Level        string
	Status       string
	OwnerID      string
	SourceID     string
	Metadata     string
	CreatedAt    time.Time
	UpdatedAt    time.Time
}

type PilotOperationsTimelineEvent struct {
	ID        string
	EventType string
	Status    string
	ActorID   string
	Notes     string
	Metadata  string
	CreatedAt time.Time
}

type InternalPilotSuccessCriteria struct {
	ID                    string
	SettlementSuccess     bool
	ReconciliationSuccess bool
	ProviderSuccess       bool
	ReliabilityScore      int
	UnresolvedExceptions  int
	Outcome               string
	EvaluatedBy           string
	Metadata              string
	CreatedAt             time.Time
}

type PilotAuthorization struct {
	ID                       string
	Decision                 string
	DecisionReason           string
	Approvers                string
	Conditions               string
	TechnologyReady          bool
	FinancialReady           bool
	ProviderReady            bool
	GovernanceReady          bool
	OperationalReady         bool
	ReliabilityReady         bool
	CriticalExceptionsExist  bool
	HighExceptionsExist      bool
	ReconciliationIncomplete bool
	FinanceSignoffMissing    bool
	OperationsSignoffMissing bool
	CTOSignoffMissing        bool
	RiskSignoffMissing       bool
	CreatedBy                string
	CreatedAt                time.Time
}

type PilotScopeDefinition struct {
	ID                string
	PilotUsers        int
	PilotDrivers      int
	PilotRiders       int
	PilotTransactions int
	PilotDurationDays int
	DefinedBy         string
	Metadata          string
	CreatedAt         time.Time
}

type PilotSuccessDefinition struct {
	ID                              string
	SettlementReliabilityTarget     int
	ReconciliationReliabilityTarget int
	ProviderReliabilityTarget       int
	DisputeResolutionTarget         int
	IncidentResponseTarget          int
	DefinedBy                       string
	Metadata                        string
	CreatedAt                       time.Time
}

type InternalPilotAuthorizationExecution struct {
	ID                      string
	PilotAuthorizationID    string
	Status                  string
	Decision                string
	DecisionReason          string
	RequiredSignoffs        string
	RequiredEvidence        string
	UnresolvedExceptions    int
	ReadinessScoreThreshold int
	ReadinessScore          int
	Conditions              string
	ApprovedPilotUsers      int
	ApprovedDrivers         int
	ApprovedRiders          int
	PilotTransactionLimit   int
	PilotDurationDays       int
	ExpiresAt               *time.Time
	CreatedBy               string
	Metadata                string
	CreatedAt               time.Time
	UpdatedAt               time.Time
}

type InternalPilotAuthorizationAudit struct {
	ID                       string
	AuthorizationExecutionID string
	ApproverID               string
	Decision                 string
	Reason                   string
	Conditions               string
	CreatedAt                time.Time
}

type InternalPilotParticipant struct {
	ID                       string
	AuthorizationExecutionID string
	UserID                   string
	Role                     string
	Status                   string
	EnrollmentSource         string
	EnrolledBy               string
	Reason                   string
	Metadata                 string
	EnrolledAt               time.Time
	UpdatedAt                time.Time
}

type InternalPilotParticipantEvent struct {
	ID                       string
	ParticipantID            string
	AuthorizationExecutionID string
	UserID                   string
	Role                     string
	PreviousStatus           string
	NewStatus                string
	Action                   string
	Reason                   string
	ActorID                  string
	Metadata                 string
	CreatedAt                time.Time
}

type InternalPilotAccessCheck struct {
	AuthorizationExecutionID string
	UserID                   string
	Role                     string
	Service                  string
	Operation                string
	CheckedAt                time.Time
}

type InternalPilotAccessSnapshot struct {
	ParticipantID          string
	ParticipantRole        string
	ParticipantStatus      string
	AuthorizationID        string
	AuthorizationStatus    string
	AuthorizationExpiresAt *time.Time
	AuthorizationCreatedAt time.Time
	ApprovedPilotUsers     int
	ApprovedDrivers        int
	ApprovedRiders         int
	PilotTransactionLimit  int
	PilotDurationDays      int
	ActiveParticipantCount int
	ActiveDriverCount      int
	ActiveRiderCount       int
	PilotTransactionCount  int
	KillSwitchActive       bool
}

type InternalPilotHealthReport struct {
	ID                          string
	AuthorizationExecutionID    string
	ReportDate                  time.Time
	RideRequests                int
	CompletedRides              int
	CancelledRides              int
	FailedRides                 int
	WalletPayments              int
	CashPayments                int
	DriverParticipation         int
	RiderParticipation          int
	IncidentCount               int
	CriticalIncidents           int
	AuthorizationStatus         string
	RideCompletionRate          int
	CancellationRate            int
	WalletSuccessRate           int
	OperationalIncidentRate     int
	AuthorizationComplianceRate int
	ParticipantActivityRate     int
	CreatedBy                   string
	Metadata                    string
	CreatedAt                   time.Time
}

type InternalPilotIncident struct {
	ID                       string
	AuthorizationExecutionID string
	IncidentType             string
	Severity                 string
	Status                   string
	SourceID                 string
	Title                    string
	Description              string
	OwnerID                  string
	OpenedBy                 string
	ResolvedBy               string
	Resolution               string
	Metadata                 string
	CreatedAt                time.Time
	UpdatedAt                time.Time
	ResolvedAt               *time.Time
}

type InternalPilotKillSwitch struct {
	ID            string
	Service       string
	Status        string
	ActivatedBy   string
	ActivatedAt   *time.Time
	DeactivatedBy string
	DeactivatedAt *time.Time
	Reason        string
	Metadata      string
	CreatedAt     time.Time
	UpdatedAt     time.Time
}

type InternalPilotKillSwitchEvent struct {
	ID           string
	KillSwitchID string
	Service      string
	Status       string
	OperatorID   string
	Reason       string
	Metadata     string
	CreatedAt    time.Time
}

type InternalPilotExecutionEvent struct {
	ID                       string
	AuthorizationExecutionID string
	ParticipantID            string
	EventType                string
	EntityType               string
	EntityID                 string
	Status                   string
	Metadata                 string
	CreatedAt                time.Time
}

type InternalPilotEvidencePackage struct {
	ID                       string
	AuthorizationExecutionID string
	ReportPeriodStart        time.Time
	ReportPeriodEnd          time.Time
	TotalEvents              int
	TotalRides               int
	CompletedRides           int
	CancelledRides           int
	WalletTransactions       int
	CashTransactions         int
	Incidents                int
	CriticalIncidents        int
	ComplianceScore          int
	Metadata                 string
	CreatedAt                time.Time
}

type InternalPilotObjectiveResult struct {
	ID                       string
	AuthorizationExecutionID string
	ObjectiveName            string
	TargetValue              int
	ActualValue              int
	Achieved                 bool
	Notes                    string
	CreatedAt                time.Time
}

type InternalPilotEvidenceMetrics struct {
	TotalEvents           int
	TotalParticipants     int
	ActiveParticipants    int
	RiderParticipation    int
	DriverParticipation   int
	TotalRides            int
	CompletedRides        int
	CancelledRides        int
	WalletTransactions    int
	CashTransactions      int
	PlatformFees          int
	DriverEarnings        int
	Incidents             int
	CriticalIncidents     int
	KillSwitchActivations int
	AuthorizationPassed   int
	AuthorizationFailed   int
	PolicyViolations      int
}

type InternalPilotBoardReview struct {
	ID                       string
	AuthorizationExecutionID string
	ReviewPeriodStart        time.Time
	ReviewPeriodEnd          time.Time
	ReviewStatus             string
	Decision                 string
	DecisionReason           string
	ReviewedBy               string
	ReviewedAt               *time.Time
	Metadata                 string
	CreatedAt                time.Time
	UpdatedAt                time.Time
}

type InternalPilotReviewFinding struct {
	ID             string
	BoardReviewID  string
	Category       string
	Severity       string
	Title          string
	Description    string
	Recommendation string
	CreatedAt      time.Time
}

type InternalPilotReadinessAssessment struct {
	ID            string
	BoardReviewID string
	Category      string
	Score         int
	TargetScore   int
	Passed        bool
	Notes         string
	CreatedAt     time.Time
}

type InternalPilotBoardRecommendation struct {
	BoardReviewID                string
	Decision                     string
	DecisionReason               string
	EligibilityResult            string
	PublicLaunchApproved         bool
	LimitedPublicPilotReview     bool
	RequiresCorrectiveActions    bool
	RequiresMoreInternalEvidence bool
}

type PublicWalletPilotProgram struct {
	ID                           string
	ProgramName                  string
	City                         string
	Status                       string
	ParticipantLimit             int
	DriverLimit                  int
	WalletBalanceLimitMinor      int64
	DailyTransactionLimitMinor   int64
	MonthlyTransactionLimitMinor int64
	Currency                     string
	StartDate                    time.Time
	EndDate                      time.Time
	AuthorizationExecutionID     string
	Metadata                     string
	CreatedAt                    time.Time
	UpdatedAt                    time.Time
}

type PublicWalletPilotParticipant struct {
	ID              string
	ProgramID       string
	UserID          string
	ParticipantType string
	Status          string
	EnrolledAt      time.Time
	EnrolledBy      string
	Metadata        string
	UpdatedAt       time.Time
}

type PublicWalletPilotTransaction struct {
	ID              string
	ProgramID       string
	WalletID        string
	UserID          string
	TransactionType string
	AmountMinor     int64
	Currency        string
	Status          string
	EvidenceID      string
	CreatedAt       time.Time
}

type PublicWalletPilotReconciliationReport struct {
	ID                             string
	ProgramID                      string
	ReportDate                     time.Time
	LedgerBalanceMinor             int64
	WalletBalanceMinor             int64
	TransactionHistoryBalanceMinor int64
	VarianceMinor                  int64
	Currency                       string
	Status                         string
	Metadata                       string
	CreatedAt                      time.Time
}

type PublicWalletPilotFraudEvent struct {
	ID          string
	ProgramID   string
	UserID      string
	EventType   string
	Severity    string
	Description string
	Status      string
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

type PublicWalletPilotKillSwitch struct {
	ID          string
	ProgramID   string
	Control     string
	Status      string
	OperatorID  string
	Reason      string
	Metadata    string
	ActivatedAt *time.Time
	UpdatedAt   time.Time
}

type PublicWalletPilotProgramSnapshot struct {
	ProgramID              string
	City                   string
	Status                 string
	ParticipantLimit       int
	DriverLimit            int
	ActiveParticipantCount int
	ActiveRiderCount       int
	ActiveDriverCount      int
	StartDate              time.Time
	EndDate                time.Time
}

type PublicWalletPilotAccessSnapshot struct {
	ProgramID                    string
	City                         string
	ProgramStatus                string
	ParticipantID                string
	ParticipantType              string
	ParticipantStatus            string
	StartDate                    time.Time
	EndDate                      time.Time
	ParticipantLimit             int
	DriverLimit                  int
	ActiveParticipantCount       int
	ActiveRiderCount             int
	ActiveDriverCount            int
	WalletBalanceLimitMinor      int64
	DailyTransactionLimitMinor   int64
	MonthlyTransactionLimitMinor int64
	CurrentWalletBalanceMinor    int64
	DailyUsedMinor               int64
	MonthlyUsedMinor             int64
	KillSwitches                 []string
}

type PublicWalletPilotTransactionRequest struct {
	ProgramID       string
	WalletID        string
	UserID          string
	ParticipantType string
	City            string
	TransactionType string
	AmountMinor     int64
	Currency        string
	EvidenceID      string
}

type PublicWalletPilotMetrics struct {
	ProgramID                 string
	City                      string
	ActiveParticipants        int
	ActiveRiders              int
	ActiveDrivers             int
	TransactionCount          int
	DepositCount              int
	RidePaymentCount          int
	RefundCount               int
	AdjustmentCount           int
	TotalVolumeMinor          int64
	ReconciliationReports     int
	VarianceReports           int
	OpenVarianceReports       int
	FraudEvents               int
	CriticalFraudEvents       int
	OpenCriticalFraudEvents   int
	WalletSuccessRate         int
	LedgerAccuracy            int
	ParticipantComplianceRate int
	PilotSuccessCriteriaMet   bool
	ReadinessRecommendation   string
}
