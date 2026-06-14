package wallet

import (
	"context"
	"time"
)

const (
	gwandaWalletBalanceLimitMinor        int64 = 5000
	gwandaDailyTransactionLimitMinor     int64 = 2000
	gwandaMonthlyTransactionLimitMinor   int64 = 20000
	bulawayoWalletBalanceLimitMinor      int64 = 10000
	bulawayoDailyTransactionLimitMinor   int64 = 5000
	bulawayoMonthlyTransactionLimitMinor int64 = 50000
)

type PublicWalletPilotRepository interface {
	CreatePublicWalletPilotProgram(ctx context.Context, program PublicWalletPilotProgram) (PublicWalletPilotProgram, error)
	GetPublicWalletPilotProgramSnapshot(ctx context.Context, programID string) (PublicWalletPilotProgramSnapshot, error)
	CreatePublicWalletPilotParticipant(ctx context.Context, participant PublicWalletPilotParticipant) (PublicWalletPilotParticipant, error)
	UpdatePublicWalletPilotParticipantStatus(ctx context.Context, participantID string, status string, actorID string) (PublicWalletPilotParticipant, error)
	GetPublicWalletPilotAccessSnapshot(ctx context.Context, programID string, userID string, participantType string, walletID string) (PublicWalletPilotAccessSnapshot, error)
	CreatePublicWalletPilotTransaction(ctx context.Context, transaction PublicWalletPilotTransaction) (PublicWalletPilotTransaction, error)
	CreatePublicWalletPilotReconciliationReport(ctx context.Context, report PublicWalletPilotReconciliationReport) (PublicWalletPilotReconciliationReport, error)
	CreatePublicWalletPilotFraudEvent(ctx context.Context, event PublicWalletPilotFraudEvent) (PublicWalletPilotFraudEvent, error)
	CreatePublicWalletPilotKillSwitch(ctx context.Context, killSwitch PublicWalletPilotKillSwitch) (PublicWalletPilotKillSwitch, error)
	AggregatePublicWalletPilotMetrics(ctx context.Context, programID string) (PublicWalletPilotMetrics, error)
}

type PublicWalletPilotService struct {
	repo PublicWalletPilotRepository
	now  func() time.Time
}

func NewPublicWalletPilotService(repo PublicWalletPilotRepository) *PublicWalletPilotService {
	return &PublicWalletPilotService{repo: repo, now: time.Now}
}

func (s *PublicWalletPilotService) CreatePilotProgram(ctx context.Context, program PublicWalletPilotProgram) (PublicWalletPilotProgram, error) {
	if s == nil || s.repo == nil {
		return PublicWalletPilotProgram{}, nil
	}
	if program.City == "" || !validWalletPilotCity(program.City) || program.AuthorizationExecutionID == "" {
		return PublicWalletPilotProgram{}, ErrWalletPilotNotAuthorized
	}
	defaults := DefaultPublicWalletPilotProgram(program.City, s.clock())
	if program.ProgramName == "" {
		program.ProgramName = defaults.ProgramName
	}
	if program.Status == "" {
		program.Status = WalletPilotProgramStatusPlanned
	}
	if !validWalletPilotProgramStatus(program.Status) {
		return PublicWalletPilotProgram{}, ErrWalletPilotNotAuthorized
	}
	if program.Currency == "" {
		program.Currency = CurrencyUSD
	}
	if program.ParticipantLimit <= 0 {
		program.ParticipantLimit = defaults.ParticipantLimit
	}
	if program.DriverLimit <= 0 {
		program.DriverLimit = defaults.DriverLimit
	}
	if program.WalletBalanceLimitMinor <= 0 {
		program.WalletBalanceLimitMinor = defaults.WalletBalanceLimitMinor
	}
	if program.DailyTransactionLimitMinor <= 0 {
		program.DailyTransactionLimitMinor = defaults.DailyTransactionLimitMinor
	}
	if program.MonthlyTransactionLimitMinor <= 0 {
		program.MonthlyTransactionLimitMinor = defaults.MonthlyTransactionLimitMinor
	}
	if program.StartDate.IsZero() {
		program.StartDate = defaults.StartDate
	}
	if program.EndDate.IsZero() {
		program.EndDate = defaults.EndDate
	}
	if !program.EndDate.After(program.StartDate) {
		return PublicWalletPilotProgram{}, ErrWalletPilotNotAuthorized
	}
	return s.repo.CreatePublicWalletPilotProgram(ctx, program)
}

func (s *PublicWalletPilotService) EnrollPilotParticipant(ctx context.Context, participant PublicWalletPilotParticipant) (PublicWalletPilotParticipant, error) {
	if s == nil || s.repo == nil {
		return PublicWalletPilotParticipant{}, nil
	}
	if participant.ProgramID == "" || participant.UserID == "" || !validWalletPilotParticipantType(participant.ParticipantType) || participant.EnrolledBy == "" {
		return PublicWalletPilotParticipant{}, ErrWalletPilotNotAuthorized
	}
	if participant.Status == "" {
		participant.Status = WalletPilotParticipantStatusActive
	}
	if !validWalletPilotParticipantStatus(participant.Status) {
		return PublicWalletPilotParticipant{}, ErrWalletPilotNotAuthorized
	}
	snapshot, err := s.repo.GetPublicWalletPilotProgramSnapshot(ctx, participant.ProgramID)
	if err != nil {
		return PublicWalletPilotParticipant{}, err
	}
	if snapshot.Status == WalletPilotProgramStatusSuspended || snapshot.Status == WalletPilotProgramStatusCompleted {
		return PublicWalletPilotParticipant{}, ErrWalletPilotNotAuthorized
	}
	if participant.ParticipantType == WalletPilotParticipantTypeRider && snapshot.ActiveRiderCount >= snapshot.ParticipantLimit {
		return PublicWalletPilotParticipant{}, ErrWalletPilotLimitExceeded
	}
	if participant.ParticipantType == WalletPilotParticipantTypeDriver && snapshot.ActiveDriverCount >= snapshot.DriverLimit {
		return PublicWalletPilotParticipant{}, ErrWalletPilotLimitExceeded
	}
	return s.repo.CreatePublicWalletPilotParticipant(ctx, participant)
}

func (s *PublicWalletPilotService) SuspendPilotParticipant(ctx context.Context, participantID string, actorID string) (PublicWalletPilotParticipant, error) {
	if s == nil || s.repo == nil {
		return PublicWalletPilotParticipant{}, nil
	}
	if participantID == "" || actorID == "" {
		return PublicWalletPilotParticipant{}, ErrWalletPilotNotAuthorized
	}
	return s.repo.UpdatePublicWalletPilotParticipantStatus(ctx, participantID, WalletPilotParticipantStatusSuspended, actorID)
}

func (s *PublicWalletPilotService) ValidateWalletPilotAccess(ctx context.Context, programID string, userID string, participantType string, walletID string, city string, operation string) error {
	if s == nil || s.repo == nil {
		return nil
	}
	if programID == "" || userID == "" || walletID == "" || !validWalletPilotParticipantType(participantType) || !validWalletPilotCity(city) {
		return ErrWalletPilotNotAuthorized
	}
	snapshot, err := s.repo.GetPublicWalletPilotAccessSnapshot(ctx, programID, userID, participantType, walletID)
	if err != nil {
		return err
	}
	return s.validateAccessSnapshot(snapshot, participantType, city, operation)
}

func (s *PublicWalletPilotService) ValidateWalletTransactionLimits(ctx context.Context, req PublicWalletPilotTransactionRequest) error {
	if s == nil || s.repo == nil {
		return nil
	}
	if req.ProgramID == "" || req.UserID == "" || req.WalletID == "" || !validWalletPilotParticipantType(req.ParticipantType) || !validWalletPilotCity(req.City) || req.AmountMinor <= 0 || req.Currency == "" || !validWalletPilotTransactionType(req.TransactionType) {
		return ErrWalletPilotNotAuthorized
	}
	snapshot, err := s.repo.GetPublicWalletPilotAccessSnapshot(ctx, req.ProgramID, req.UserID, req.ParticipantType, req.WalletID)
	if err != nil {
		return err
	}
	if err := s.validateAccessSnapshot(snapshot, req.ParticipantType, req.City, walletPilotOperationForTransaction(req.TransactionType)); err != nil {
		return err
	}
	if snapshot.DailyUsedMinor+req.AmountMinor > snapshot.DailyTransactionLimitMinor {
		return ErrWalletPilotLimitExceeded
	}
	if snapshot.MonthlyUsedMinor+req.AmountMinor > snapshot.MonthlyTransactionLimitMinor {
		return ErrWalletPilotLimitExceeded
	}
	if transactionIncreasesBalance(req.TransactionType) && snapshot.CurrentWalletBalanceMinor+req.AmountMinor > snapshot.WalletBalanceLimitMinor {
		return ErrWalletPilotLimitExceeded
	}
	return nil
}

func (s *PublicWalletPilotService) RecordPilotTransaction(ctx context.Context, req PublicWalletPilotTransactionRequest) (PublicWalletPilotTransaction, error) {
	if s == nil || s.repo == nil {
		return PublicWalletPilotTransaction{}, nil
	}
	if err := s.ValidateWalletTransactionLimits(ctx, req); err != nil {
		return PublicWalletPilotTransaction{}, err
	}
	transaction := PublicWalletPilotTransaction{
		ProgramID:       req.ProgramID,
		WalletID:        req.WalletID,
		UserID:          req.UserID,
		TransactionType: req.TransactionType,
		AmountMinor:     req.AmountMinor,
		Currency:        req.Currency,
		Status:          WalletPilotTransactionStatusRecorded,
		EvidenceID:      req.EvidenceID,
	}
	return s.repo.CreatePublicWalletPilotTransaction(ctx, transaction)
}

func (s *PublicWalletPilotService) GenerateReconciliationReport(ctx context.Context, report PublicWalletPilotReconciliationReport) (PublicWalletPilotReconciliationReport, error) {
	if s == nil || s.repo == nil {
		return PublicWalletPilotReconciliationReport{}, nil
	}
	if report.ProgramID == "" || report.ReportDate.IsZero() || report.Currency == "" {
		return PublicWalletPilotReconciliationReport{}, ErrWalletPilotNotAuthorized
	}
	report.VarianceMinor = report.LedgerBalanceMinor - report.WalletBalanceMinor
	if report.VarianceMinor == 0 && report.TransactionHistoryBalanceMinor != 0 && report.TransactionHistoryBalanceMinor != report.WalletBalanceMinor {
		report.VarianceMinor = report.TransactionHistoryBalanceMinor - report.WalletBalanceMinor
	}
	if report.VarianceMinor == 0 {
		report.Status = WalletPilotReconciliationBalanced
	} else {
		report.Status = WalletPilotReconciliationVarianceDetected
	}
	return s.repo.CreatePublicWalletPilotReconciliationReport(ctx, report)
}

func (s *PublicWalletPilotService) CreateFraudEvent(ctx context.Context, event PublicWalletPilotFraudEvent) (PublicWalletPilotFraudEvent, error) {
	if s == nil || s.repo == nil {
		return PublicWalletPilotFraudEvent{}, nil
	}
	if event.ProgramID == "" || event.UserID == "" || !validWalletPilotFraudType(event.EventType) || !validWalletPilotFraudSeverity(event.Severity) || event.Description == "" {
		return PublicWalletPilotFraudEvent{}, ErrWalletPilotNotAuthorized
	}
	if event.Status == "" {
		event.Status = WalletPilotFraudStatusOpen
	}
	if !validWalletPilotFraudStatus(event.Status) {
		return PublicWalletPilotFraudEvent{}, ErrWalletPilotNotAuthorized
	}
	return s.repo.CreatePublicWalletPilotFraudEvent(ctx, event)
}

func (s *PublicWalletPilotService) ActivatePilotKillSwitch(ctx context.Context, killSwitch PublicWalletPilotKillSwitch) (PublicWalletPilotKillSwitch, error) {
	if s == nil || s.repo == nil {
		return PublicWalletPilotKillSwitch{}, nil
	}
	if killSwitch.ProgramID == "" || !validWalletPilotKillSwitch(killSwitch.Control) || killSwitch.OperatorID == "" || killSwitch.Reason == "" {
		return PublicWalletPilotKillSwitch{}, ErrWalletPilotNotAuthorized
	}
	killSwitch.Status = InternalPilotKillSwitchActive
	return s.repo.CreatePublicWalletPilotKillSwitch(ctx, killSwitch)
}

func (s *PublicWalletPilotService) GeneratePilotMetrics(ctx context.Context, programID string) (PublicWalletPilotMetrics, error) {
	if s == nil || s.repo == nil {
		return PublicWalletPilotMetrics{}, nil
	}
	if programID == "" {
		return PublicWalletPilotMetrics{}, ErrWalletPilotNotAuthorized
	}
	metrics, err := s.repo.AggregatePublicWalletPilotMetrics(ctx, programID)
	if err != nil {
		return PublicWalletPilotMetrics{}, err
	}
	metrics.PilotSuccessCriteriaMet = metrics.WalletSuccessRate > 99 &&
		metrics.LedgerAccuracy == 100 &&
		metrics.OpenCriticalFraudEvents == 0 &&
		metrics.OpenVarianceReports == 0 &&
		metrics.ParticipantComplianceRate > 95
	if metrics.PilotSuccessCriteriaMet {
		metrics.ReadinessRecommendation = "gwanda_wallet_pilot_success_criteria_met"
	} else {
		metrics.ReadinessRecommendation = "remain_limited_to_gwanda_until_success_criteria_met"
	}
	return metrics, nil
}

func (s *PublicWalletPilotService) GeneratePilotEvidencePackage(ctx context.Context, programID string) (map[string]any, error) {
	metrics, err := s.GeneratePilotMetrics(ctx, programID)
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"program_id":                 metrics.ProgramID,
		"city":                       metrics.City,
		"participant_counts":         map[string]any{"active": metrics.ActiveParticipants, "riders": metrics.ActiveRiders, "drivers": metrics.ActiveDrivers},
		"transaction_volume":         map[string]any{"count": metrics.TransactionCount, "total_volume_minor": metrics.TotalVolumeMinor},
		"reconciliation":             map[string]any{"reports": metrics.ReconciliationReports, "variance_reports": metrics.VarianceReports, "open_variance_reports": metrics.OpenVarianceReports, "ledger_accuracy": metrics.LedgerAccuracy},
		"fraud":                      map[string]any{"events": metrics.FraudEvents, "critical_events": metrics.CriticalFraudEvents, "open_critical_events": metrics.OpenCriticalFraudEvents},
		"success_criteria":           map[string]any{"wallet_success_rate": metrics.WalletSuccessRate, "participant_compliance_rate": metrics.ParticipantComplianceRate},
		"readiness_recommendation":   metrics.ReadinessRecommendation,
		"pilot_success_criteria_met": metrics.PilotSuccessCriteriaMet,
		"public_launch_approved":     false,
	}, nil
}

func (s *PublicWalletPilotService) validateAccessSnapshot(snapshot PublicWalletPilotAccessSnapshot, participantType string, city string, operation string) error {
	if snapshot.ProgramStatus != WalletPilotProgramStatusActive {
		return ErrWalletPilotNotAuthorized
	}
	if snapshot.City != city {
		return ErrWalletPilotNotAuthorized
	}
	if snapshot.ParticipantStatus != WalletPilotParticipantStatusActive || snapshot.ParticipantType != participantType {
		return ErrWalletPilotNotAuthorized
	}
	now := s.clock()
	if snapshot.StartDate.IsZero() || snapshot.EndDate.IsZero() || now.Before(snapshot.StartDate) || !now.Before(snapshot.EndDate) {
		return ErrWalletPilotNotAuthorized
	}
	if snapshot.ActiveRiderCount > snapshot.ParticipantLimit || snapshot.ActiveDriverCount > snapshot.DriverLimit {
		return ErrWalletPilotLimitExceeded
	}
	if walletPilotKillSwitchActive(snapshot.KillSwitches, operation) {
		return ErrWalletPilotDisabled
	}
	return nil
}

func (s *PublicWalletPilotService) clock() time.Time {
	if s != nil && s.now != nil {
		return s.now()
	}
	return time.Now()
}

func DefaultPublicWalletPilotProgram(city string, start time.Time) PublicWalletPilotProgram {
	if start.IsZero() {
		start = time.Now()
	}
	if city == WalletPilotCityBulawayo {
		return PublicWalletPilotProgram{
			ProgramName:                  "Bulawayo Limited Public Wallet Pilot",
			City:                         WalletPilotCityBulawayo,
			Status:                       WalletPilotProgramStatusPlanned,
			ParticipantLimit:             250,
			DriverLimit:                  75,
			WalletBalanceLimitMinor:      bulawayoWalletBalanceLimitMinor,
			DailyTransactionLimitMinor:   bulawayoDailyTransactionLimitMinor,
			MonthlyTransactionLimitMinor: bulawayoMonthlyTransactionLimitMinor,
			Currency:                     CurrencyUSD,
			StartDate:                    start,
			EndDate:                      start.AddDate(0, 0, 60),
		}
	}
	return PublicWalletPilotProgram{
		ProgramName:                  "Gwanda Limited Public Wallet Pilot",
		City:                         WalletPilotCityGwanda,
		Status:                       WalletPilotProgramStatusPlanned,
		ParticipantLimit:             20,
		DriverLimit:                  10,
		WalletBalanceLimitMinor:      gwandaWalletBalanceLimitMinor,
		DailyTransactionLimitMinor:   gwandaDailyTransactionLimitMinor,
		MonthlyTransactionLimitMinor: gwandaMonthlyTransactionLimitMinor,
		Currency:                     CurrencyUSD,
		StartDate:                    start,
		EndDate:                      start.AddDate(0, 0, 30),
	}
}

func validWalletPilotCity(city string) bool {
	return city == WalletPilotCityGwanda || city == WalletPilotCityBulawayo
}

func validWalletPilotProgramStatus(status string) bool {
	switch status {
	case WalletPilotProgramStatusPlanned, WalletPilotProgramStatusActive, WalletPilotProgramStatusPaused, WalletPilotProgramStatusCompleted, WalletPilotProgramStatusSuspended:
		return true
	default:
		return false
	}
}

func validWalletPilotParticipantType(participantType string) bool {
	return participantType == WalletPilotParticipantTypeRider || participantType == WalletPilotParticipantTypeDriver
}

func validWalletPilotParticipantStatus(status string) bool {
	switch status {
	case WalletPilotParticipantStatusActive, WalletPilotParticipantStatusSuspended, WalletPilotParticipantStatusRemoved:
		return true
	default:
		return false
	}
}

func validWalletPilotTransactionType(transactionType string) bool {
	switch transactionType {
	case WalletPilotTransactionTypeDeposit, WalletPilotTransactionTypeRidePayment, WalletPilotTransactionTypeRefund, WalletPilotTransactionTypeAdjustment:
		return true
	default:
		return false
	}
}

func validWalletPilotFraudType(eventType string) bool {
	switch eventType {
	case WalletPilotFraudDuplicatePayments,
		WalletPilotFraudUnusualFrequency,
		WalletPilotFraudAbnormalRefundActivity,
		WalletPilotFraudRapidBalanceCycling,
		WalletPilotFraudMultiAccountAbuse,
		WalletPilotFraudWalletFarming,
		WalletPilotFraudPilotAbuse,
		WalletPilotFraudReconciliationVariance:
		return true
	default:
		return false
	}
}

func validWalletPilotFraudSeverity(severity string) bool {
	switch severity {
	case WalletPilotFraudSeverityLow, WalletPilotFraudSeverityMedium, WalletPilotFraudSeverityHigh, WalletPilotFraudSeverityCritical:
		return true
	default:
		return false
	}
}

func validWalletPilotFraudStatus(status string) bool {
	switch status {
	case WalletPilotFraudStatusOpen, WalletPilotFraudStatusInvestigating, WalletPilotFraudStatusResolved, WalletPilotFraudStatusClosed:
		return true
	default:
		return false
	}
}

func validWalletPilotKillSwitch(control string) bool {
	switch control {
	case WalletPilotKillSwitchDisableDeposits,
		WalletPilotKillSwitchDisableWalletPayments,
		WalletPilotKillSwitchDisableRefunds,
		WalletPilotKillSwitchDisableWalletAdjustments:
		return true
	default:
		return false
	}
}

func walletPilotOperationForTransaction(transactionType string) string {
	switch transactionType {
	case WalletPilotTransactionTypeDeposit:
		return WalletPilotKillSwitchDisableDeposits
	case WalletPilotTransactionTypeRidePayment:
		return WalletPilotKillSwitchDisableWalletPayments
	case WalletPilotTransactionTypeRefund:
		return WalletPilotKillSwitchDisableRefunds
	case WalletPilotTransactionTypeAdjustment:
		return WalletPilotKillSwitchDisableWalletAdjustments
	default:
		return ""
	}
}

func walletPilotKillSwitchActive(active []string, control string) bool {
	if control == "" {
		return false
	}
	for _, item := range active {
		if item == control {
			return true
		}
	}
	return false
}

func transactionIncreasesBalance(transactionType string) bool {
	return transactionType == WalletPilotTransactionTypeDeposit || transactionType == WalletPilotTransactionTypeRefund || transactionType == WalletPilotTransactionTypeAdjustment
}
