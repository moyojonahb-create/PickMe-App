package wallet

import (
	"context"
	"time"
)

type InternalPilotLiveOpsRepository interface {
	CreateInternalPilotParticipant(ctx context.Context, participant InternalPilotParticipant) (InternalPilotParticipant, error)
	UpdateInternalPilotParticipantStatus(ctx context.Context, participantID string, status string, actorID string, reason string) (InternalPilotParticipant, error)
	CreateInternalPilotParticipantEvent(ctx context.Context, event InternalPilotParticipantEvent) error
	GetInternalPilotAccessSnapshot(ctx context.Context, check InternalPilotAccessCheck) (InternalPilotAccessSnapshot, error)
	CreateInternalPilotHealthReport(ctx context.Context, report InternalPilotHealthReport) (InternalPilotHealthReport, error)
	CreateInternalPilotIncident(ctx context.Context, incident InternalPilotIncident) (InternalPilotIncident, error)
	UpdateInternalPilotIncidentStatus(ctx context.Context, incidentID string, status string, actorID string, resolution string) (InternalPilotIncident, error)
	UpsertInternalPilotKillSwitch(ctx context.Context, killSwitch InternalPilotKillSwitch) (InternalPilotKillSwitch, error)
	CreateInternalPilotKillSwitchEvent(ctx context.Context, event InternalPilotKillSwitchEvent) error
}

type InternalPilotLiveOpsService struct {
	repo InternalPilotLiveOpsRepository
}

func NewInternalPilotLiveOpsService(repo InternalPilotLiveOpsRepository) *InternalPilotLiveOpsService {
	return &InternalPilotLiveOpsService{repo: repo}
}

func (s *InternalPilotLiveOpsService) EnrollParticipant(ctx context.Context, participant InternalPilotParticipant) (InternalPilotParticipant, error) {
	if s == nil || s.repo == nil {
		return InternalPilotParticipant{}, nil
	}
	if participant.AuthorizationExecutionID == "" || participant.UserID == "" || participant.EnrolledBy == "" || !validInternalPilotParticipantRole(participant.Role) {
		return InternalPilotParticipant{}, ErrInvalidLedgerEntry
	}
	if participant.Status == "" {
		participant.Status = InternalPilotParticipantActive
	}
	if !validInternalPilotParticipantStatus(participant.Status) {
		return InternalPilotParticipant{}, ErrInvalidLedgerEntry
	}
	created, err := s.repo.CreateInternalPilotParticipant(ctx, participant)
	if err != nil {
		return created, err
	}
	event := InternalPilotParticipantEvent{
		ParticipantID:            created.ID,
		AuthorizationExecutionID: created.AuthorizationExecutionID,
		UserID:                   created.UserID,
		Role:                     created.Role,
		NewStatus:                created.Status,
		Action:                   "enrolled",
		Reason:                   created.Reason,
		ActorID:                  created.EnrolledBy,
		Metadata:                 created.Metadata,
	}
	return created, s.repo.CreateInternalPilotParticipantEvent(ctx, event)
}

func (s *InternalPilotLiveOpsService) UpdateParticipantStatus(ctx context.Context, participantID string, status string, actorID string, reason string) (InternalPilotParticipant, error) {
	if s == nil || s.repo == nil {
		return InternalPilotParticipant{}, nil
	}
	if participantID == "" || actorID == "" || !validInternalPilotParticipantStatus(status) {
		return InternalPilotParticipant{}, ErrInvalidLedgerEntry
	}
	updated, err := s.repo.UpdateInternalPilotParticipantStatus(ctx, participantID, status, actorID, reason)
	if err != nil {
		return updated, err
	}
	event := InternalPilotParticipantEvent{
		ParticipantID:            updated.ID,
		AuthorizationExecutionID: updated.AuthorizationExecutionID,
		UserID:                   updated.UserID,
		Role:                     updated.Role,
		NewStatus:                updated.Status,
		Action:                   "status_changed",
		Reason:                   reason,
		ActorID:                  actorID,
		Metadata:                 updated.Metadata,
	}
	return updated, s.repo.CreateInternalPilotParticipantEvent(ctx, event)
}

func (s *InternalPilotLiveOpsService) ValidateParticipantAccess(ctx context.Context, check InternalPilotAccessCheck) error {
	if s == nil || s.repo == nil {
		return nil
	}
	if check.UserID == "" || !validInternalPilotParticipantRole(check.Role) || !validInternalPilotService(check.Service) {
		return ErrInvalidLedgerEntry
	}
	snapshot, err := s.repo.GetInternalPilotAccessSnapshot(ctx, check)
	if err != nil {
		return ErrPilotAccessDenied
	}
	return validateInternalPilotSnapshot(snapshot, check)
}

func (s *InternalPilotLiveOpsService) CreateHealthReport(ctx context.Context, report InternalPilotHealthReport) (InternalPilotHealthReport, error) {
	if s == nil || s.repo == nil {
		return InternalPilotHealthReport{}, nil
	}
	if report.AuthorizationExecutionID == "" || report.CreatedBy == "" || report.RideRequests < 0 || report.CompletedRides < 0 || report.CancelledRides < 0 || report.FailedRides < 0 || report.WalletPayments < 0 || report.CashPayments < 0 || report.DriverParticipation < 0 || report.RiderParticipation < 0 || report.IncidentCount < 0 || report.CriticalIncidents < 0 {
		return InternalPilotHealthReport{}, ErrInvalidLedgerEntry
	}
	if report.ReportDate.IsZero() {
		report.ReportDate = time.Now().UTC()
	}
	report.RideCompletionRate = percent(report.CompletedRides, report.RideRequests)
	report.CancellationRate = percent(report.CancelledRides, report.RideRequests)
	report.WalletSuccessRate = percent(report.WalletPayments, report.WalletPayments+report.CashPayments)
	report.OperationalIncidentRate = percent(report.IncidentCount, report.RideRequests)
	if report.AuthorizationStatus == InternalPilotAuthorizationActive {
		report.AuthorizationComplianceRate = 100
	}
	report.ParticipantActivityRate = percent(report.DriverParticipation+report.RiderParticipation, report.DriverParticipation+report.RiderParticipation)
	return s.repo.CreateInternalPilotHealthReport(ctx, report)
}

func (s *InternalPilotLiveOpsService) CreateIncident(ctx context.Context, incident InternalPilotIncident) (InternalPilotIncident, error) {
	if s == nil || s.repo == nil {
		return InternalPilotIncident{}, nil
	}
	if incident.AuthorizationExecutionID == "" || incident.IncidentType == "" || !validInternalPilotIncidentSeverity(incident.Severity) || incident.Title == "" || incident.OpenedBy == "" {
		return InternalPilotIncident{}, ErrInvalidLedgerEntry
	}
	if incident.Status == "" {
		incident.Status = InternalPilotIncidentStatusOpen
	}
	if !validInternalPilotIncidentStatus(incident.Status) {
		return InternalPilotIncident{}, ErrInvalidLedgerEntry
	}
	return s.repo.CreateInternalPilotIncident(ctx, incident)
}

func (s *InternalPilotLiveOpsService) UpdateIncidentStatus(ctx context.Context, incidentID string, status string, actorID string, resolution string) (InternalPilotIncident, error) {
	if s == nil || s.repo == nil {
		return InternalPilotIncident{}, nil
	}
	if incidentID == "" || actorID == "" || !validInternalPilotIncidentStatus(status) {
		return InternalPilotIncident{}, ErrInvalidLedgerEntry
	}
	return s.repo.UpdateInternalPilotIncidentStatus(ctx, incidentID, status, actorID, resolution)
}

func (s *InternalPilotLiveOpsService) ActivateKillSwitch(ctx context.Context, killSwitch InternalPilotKillSwitch) (InternalPilotKillSwitch, error) {
	if s == nil || s.repo == nil {
		return InternalPilotKillSwitch{}, nil
	}
	if !validInternalPilotService(killSwitch.Service) || killSwitch.ActivatedBy == "" || killSwitch.Reason == "" {
		return InternalPilotKillSwitch{}, ErrInvalidLedgerEntry
	}
	now := time.Now().UTC()
	killSwitch.Status = InternalPilotKillSwitchActive
	killSwitch.ActivatedAt = &now
	created, err := s.repo.UpsertInternalPilotKillSwitch(ctx, killSwitch)
	if err != nil {
		return created, err
	}
	event := InternalPilotKillSwitchEvent{KillSwitchID: created.ID, Service: created.Service, Status: created.Status, OperatorID: created.ActivatedBy, Reason: created.Reason, Metadata: created.Metadata}
	return created, s.repo.CreateInternalPilotKillSwitchEvent(ctx, event)
}

func (s *InternalPilotLiveOpsService) DeactivateKillSwitch(ctx context.Context, service string, operatorID string, reason string) (InternalPilotKillSwitch, error) {
	if s == nil || s.repo == nil {
		return InternalPilotKillSwitch{}, nil
	}
	if !validInternalPilotService(service) || operatorID == "" || reason == "" {
		return InternalPilotKillSwitch{}, ErrInvalidLedgerEntry
	}
	now := time.Now().UTC()
	updated, err := s.repo.UpsertInternalPilotKillSwitch(ctx, InternalPilotKillSwitch{Service: service, Status: InternalPilotKillSwitchInactive, DeactivatedBy: operatorID, DeactivatedAt: &now, Reason: reason})
	if err != nil {
		return updated, err
	}
	event := InternalPilotKillSwitchEvent{KillSwitchID: updated.ID, Service: updated.Service, Status: updated.Status, OperatorID: operatorID, Reason: reason, Metadata: updated.Metadata}
	return updated, s.repo.CreateInternalPilotKillSwitchEvent(ctx, event)
}

func validateInternalPilotSnapshot(snapshot InternalPilotAccessSnapshot, check InternalPilotAccessCheck) error {
	now := check.CheckedAt
	if now.IsZero() {
		now = time.Now().UTC()
	}
	if snapshot.KillSwitchActive {
		return ErrPilotAccessDenied
	}
	if snapshot.ParticipantID == "" || snapshot.ParticipantStatus != InternalPilotParticipantActive || snapshot.ParticipantRole != check.Role {
		return ErrPilotAccessDenied
	}
	if snapshot.AuthorizationID == "" || snapshot.AuthorizationStatus != InternalPilotAuthorizationActive {
		return ErrPilotAccessDenied
	}
	if snapshot.AuthorizationExpiresAt != nil && !snapshot.AuthorizationExpiresAt.After(now) {
		return ErrPilotAccessDenied
	}
	if snapshot.PilotDurationDays > 0 && !snapshot.AuthorizationCreatedAt.IsZero() && !snapshot.AuthorizationCreatedAt.AddDate(0, 0, snapshot.PilotDurationDays).After(now) {
		return ErrPilotAccessDenied
	}
	if snapshot.ApprovedPilotUsers > 0 && snapshot.ActiveParticipantCount > snapshot.ApprovedPilotUsers {
		return ErrPilotAccessDenied
	}
	if snapshot.ApprovedDrivers > 0 && snapshot.ActiveDriverCount > snapshot.ApprovedDrivers {
		return ErrPilotAccessDenied
	}
	if snapshot.ApprovedRiders > 0 && snapshot.ActiveRiderCount > snapshot.ApprovedRiders {
		return ErrPilotAccessDenied
	}
	if snapshot.PilotTransactionLimit > 0 && snapshot.PilotTransactionCount >= snapshot.PilotTransactionLimit {
		return ErrPilotAccessDenied
	}
	return nil
}

func validInternalPilotParticipantRole(role string) bool {
	switch role {
	case InternalPilotParticipantRoleRider,
		InternalPilotParticipantRoleDriver,
		InternalPilotParticipantRoleAdmin,
		InternalPilotParticipantRoleOperations,
		InternalPilotParticipantRoleFinance,
		InternalPilotParticipantRoleRisk:
		return true
	default:
		return false
	}
}

func validInternalPilotParticipantStatus(status string) bool {
	switch status {
	case InternalPilotParticipantActive, InternalPilotParticipantSuspended, InternalPilotParticipantRemoved:
		return true
	default:
		return false
	}
}

func validInternalPilotIncidentStatus(status string) bool {
	switch status {
	case InternalPilotIncidentStatusOpen,
		InternalPilotIncidentStatusInvestigating,
		InternalPilotIncidentStatusMitigated,
		InternalPilotIncidentStatusResolved,
		InternalPilotIncidentStatusClosed:
		return true
	default:
		return false
	}
}

func validInternalPilotIncidentSeverity(severity string) bool {
	switch severity {
	case InternalPilotIncidentSeverityLow,
		InternalPilotIncidentSeverityMedium,
		InternalPilotIncidentSeverityHigh,
		InternalPilotIncidentSeverityCritical:
		return true
	default:
		return false
	}
}

func validInternalPilotService(service string) bool {
	switch service {
	case InternalPilotServiceRideRequests,
		InternalPilotServiceMatching,
		InternalPilotServiceDispatch,
		InternalPilotServiceWallets,
		InternalPilotServiceDeposits,
		InternalPilotServiceWithdrawals,
		InternalPilotServiceSettlements:
		return true
	default:
		return false
	}
}

func percent(numerator int, denominator int) int {
	if denominator <= 0 {
		return 0
	}
	if numerator <= 0 {
		return 0
	}
	value := (numerator * 100) / denominator
	if value > 100 {
		return 100
	}
	return value
}
