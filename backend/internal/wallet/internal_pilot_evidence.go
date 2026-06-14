package wallet

import (
	"context"
	"time"
)

type InternalPilotEvidenceRepository interface {
	CreateInternalPilotExecutionEvent(ctx context.Context, event InternalPilotExecutionEvent) (InternalPilotExecutionEvent, error)
	AggregateInternalPilotEvidence(ctx context.Context, authorizationExecutionID string, periodStart time.Time, periodEnd time.Time) (InternalPilotEvidenceMetrics, error)
	CreateInternalPilotEvidencePackage(ctx context.Context, pkg InternalPilotEvidencePackage) (InternalPilotEvidencePackage, error)
	CreateInternalPilotObjectiveResult(ctx context.Context, result InternalPilotObjectiveResult) (InternalPilotObjectiveResult, error)
}

type InternalPilotEvidenceService struct {
	repo InternalPilotEvidenceRepository
}

func NewInternalPilotEvidenceService(repo InternalPilotEvidenceRepository) *InternalPilotEvidenceService {
	return &InternalPilotEvidenceService{repo: repo}
}

func (s *InternalPilotEvidenceService) RecordExecutionEvent(ctx context.Context, event InternalPilotExecutionEvent) (InternalPilotExecutionEvent, error) {
	if s == nil || s.repo == nil {
		return InternalPilotExecutionEvent{}, nil
	}
	if event.AuthorizationExecutionID == "" || !validInternalPilotExecutionEventType(event.EventType) || event.EntityType == "" || event.EntityID == "" {
		return InternalPilotExecutionEvent{}, ErrInvalidLedgerEntry
	}
	if event.Status == "" {
		event.Status = "recorded"
	}
	return s.repo.CreateInternalPilotExecutionEvent(ctx, event)
}

func (s *InternalPilotEvidenceService) RecordRideEvidence(ctx context.Context, authorizationExecutionID string, participantID string, eventType string, rideID string, status string, metadata string) (InternalPilotExecutionEvent, error) {
	if !rideEvidenceEvent(eventType) {
		return InternalPilotExecutionEvent{}, ErrInvalidLedgerEntry
	}
	return s.RecordExecutionEvent(ctx, InternalPilotExecutionEvent{
		AuthorizationExecutionID: authorizationExecutionID,
		ParticipantID:            participantID,
		EventType:                eventType,
		EntityType:               "ride",
		EntityID:                 rideID,
		Status:                   status,
		Metadata:                 metadata,
	})
}

func (s *InternalPilotEvidenceService) RecordPaymentEvidence(ctx context.Context, authorizationExecutionID string, participantID string, eventType string, paymentID string, status string, metadata string) (InternalPilotExecutionEvent, error) {
	if !paymentEvidenceEvent(eventType) {
		return InternalPilotExecutionEvent{}, ErrInvalidLedgerEntry
	}
	return s.RecordExecutionEvent(ctx, InternalPilotExecutionEvent{
		AuthorizationExecutionID: authorizationExecutionID,
		ParticipantID:            participantID,
		EventType:                eventType,
		EntityType:               "payment",
		EntityID:                 paymentID,
		Status:                   status,
		Metadata:                 metadata,
	})
}

func (s *InternalPilotEvidenceService) RecordAuthorizationEvidence(ctx context.Context, authorizationExecutionID string, participantID string, eventType string, authorizationID string, status string, metadata string) (InternalPilotExecutionEvent, error) {
	if eventType != InternalPilotEventAuthorizationCheckPassed && eventType != InternalPilotEventAuthorizationCheckFailed {
		return InternalPilotExecutionEvent{}, ErrInvalidLedgerEntry
	}
	return s.RecordExecutionEvent(ctx, InternalPilotExecutionEvent{
		AuthorizationExecutionID: authorizationExecutionID,
		ParticipantID:            participantID,
		EventType:                eventType,
		EntityType:               "authorization",
		EntityID:                 authorizationID,
		Status:                   status,
		Metadata:                 metadata,
	})
}

func (s *InternalPilotEvidenceService) RecordIncidentEvidence(ctx context.Context, authorizationExecutionID string, participantID string, eventType string, incidentID string, status string, metadata string) (InternalPilotExecutionEvent, error) {
	if eventType != InternalPilotEventIncidentCreated && eventType != InternalPilotEventIncidentResolved && eventType != InternalPilotEventKillSwitchTriggered {
		return InternalPilotExecutionEvent{}, ErrInvalidLedgerEntry
	}
	entityType := "incident"
	if eventType == InternalPilotEventKillSwitchTriggered {
		entityType = "kill_switch"
	}
	return s.RecordExecutionEvent(ctx, InternalPilotExecutionEvent{
		AuthorizationExecutionID: authorizationExecutionID,
		ParticipantID:            participantID,
		EventType:                eventType,
		EntityType:               entityType,
		EntityID:                 incidentID,
		Status:                   status,
		Metadata:                 metadata,
	})
}

func (s *InternalPilotEvidenceService) CreateEvidencePackage(ctx context.Context, authorizationExecutionID string, periodStart time.Time, periodEnd time.Time, metadata string) (InternalPilotEvidencePackage, error) {
	if s == nil || s.repo == nil {
		return InternalPilotEvidencePackage{}, nil
	}
	if authorizationExecutionID == "" || periodStart.IsZero() || periodEnd.IsZero() || !periodEnd.After(periodStart) {
		return InternalPilotEvidencePackage{}, ErrInvalidLedgerEntry
	}
	metrics, err := s.repo.AggregateInternalPilotEvidence(ctx, authorizationExecutionID, periodStart, periodEnd)
	if err != nil {
		return InternalPilotEvidencePackage{}, err
	}
	pkg := InternalPilotEvidencePackage{
		AuthorizationExecutionID: authorizationExecutionID,
		ReportPeriodStart:        periodStart,
		ReportPeriodEnd:          periodEnd,
		TotalEvents:              metrics.TotalEvents,
		TotalRides:               metrics.TotalRides,
		CompletedRides:           metrics.CompletedRides,
		CancelledRides:           metrics.CancelledRides,
		WalletTransactions:       metrics.WalletTransactions,
		CashTransactions:         metrics.CashTransactions,
		Incidents:                metrics.Incidents,
		CriticalIncidents:        metrics.CriticalIncidents,
		ComplianceScore:          complianceScore(metrics),
		Metadata:                 metadata,
	}
	return s.repo.CreateInternalPilotEvidencePackage(ctx, pkg)
}

func (s *InternalPilotEvidenceService) EvaluatePilotObjectives(ctx context.Context, results []InternalPilotObjectiveResult) ([]InternalPilotObjectiveResult, error) {
	if s == nil || s.repo == nil {
		return nil, nil
	}
	created := make([]InternalPilotObjectiveResult, 0, len(results))
	for _, result := range results {
		if result.AuthorizationExecutionID == "" || result.ObjectiveName == "" || result.TargetValue < 0 || result.ActualValue < 0 {
			return nil, ErrInvalidLedgerEntry
		}
		result.Achieved = result.ActualValue >= result.TargetValue
		stored, err := s.repo.CreateInternalPilotObjectiveResult(ctx, result)
		if err != nil {
			return nil, err
		}
		created = append(created, stored)
	}
	return created, nil
}

func (s *InternalPilotEvidenceService) GeneratePilotEvidenceSummary(ctx context.Context, authorizationExecutionID string, periodStart time.Time, periodEnd time.Time) (map[string]any, error) {
	if s == nil || s.repo == nil {
		return map[string]any{}, nil
	}
	if authorizationExecutionID == "" || periodStart.IsZero() || periodEnd.IsZero() || !periodEnd.After(periodStart) {
		return nil, ErrInvalidLedgerEntry
	}
	metrics, err := s.repo.AggregateInternalPilotEvidence(ctx, authorizationExecutionID, periodStart, periodEnd)
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"participation": map[string]any{
			"total_participants":   metrics.TotalParticipants,
			"active_participants":  metrics.ActiveParticipants,
			"rider_participation":  metrics.RiderParticipation,
			"driver_participation": metrics.DriverParticipation,
		},
		"ride_metrics": map[string]any{
			"rides_requested":         metrics.TotalRides,
			"rides_completed":         metrics.CompletedRides,
			"rides_cancelled":         metrics.CancelledRides,
			"completion_percentage":   percent(metrics.CompletedRides, metrics.TotalRides),
			"cancellation_percentage": percent(metrics.CancelledRides, metrics.TotalRides),
		},
		"financial_metrics": map[string]any{
			"wallet_transactions": metrics.WalletTransactions,
			"cash_transactions":   metrics.CashTransactions,
			"driver_earnings":     metrics.DriverEarnings,
			"platform_fees":       metrics.PlatformFees,
		},
		"operational_metrics": map[string]any{
			"incidents":               metrics.Incidents,
			"critical_incidents":      metrics.CriticalIncidents,
			"kill_switch_activations": metrics.KillSwitchActivations,
		},
		"compliance_metrics": map[string]any{
			"authorization_pass_rate":    percent(metrics.AuthorizationPassed, metrics.AuthorizationPassed+metrics.AuthorizationFailed),
			"authorization_failure_rate": percent(metrics.AuthorizationFailed, metrics.AuthorizationPassed+metrics.AuthorizationFailed),
			"policy_violations":          metrics.PolicyViolations,
			"compliance_score":           complianceScore(metrics),
		},
	}, nil
}

func complianceScore(metrics InternalPilotEvidenceMetrics) int {
	score := 100
	score -= percent(metrics.AuthorizationFailed, metrics.AuthorizationPassed+metrics.AuthorizationFailed)
	score -= percent(metrics.CriticalIncidents, maxInt(metrics.Incidents, 1))
	score -= percent(metrics.PolicyViolations, maxInt(metrics.TotalEvents, 1))
	if score < 0 {
		return 0
	}
	return score
}

func validInternalPilotExecutionEventType(eventType string) bool {
	switch eventType {
	case InternalPilotEventParticipantJoined,
		InternalPilotEventRideRequested,
		InternalPilotEventRideOfferCreated,
		InternalPilotEventRideOfferAccepted,
		InternalPilotEventDriverEnroute,
		InternalPilotEventPickupReached,
		InternalPilotEventTripStarted,
		InternalPilotEventTripCompleted,
		InternalPilotEventTripCancelled,
		InternalPilotEventWalletPaymentAttempted,
		InternalPilotEventWalletPaymentCompleted,
		InternalPilotEventCashPaymentCompleted,
		InternalPilotEventPlatformFeeRecorded,
		InternalPilotEventDriverEarningsRecorded,
		InternalPilotEventAuthorizationCheckPassed,
		InternalPilotEventAuthorizationCheckFailed,
		InternalPilotEventIncidentCreated,
		InternalPilotEventIncidentResolved,
		InternalPilotEventKillSwitchTriggered:
		return true
	default:
		return false
	}
}

func rideEvidenceEvent(eventType string) bool {
	switch eventType {
	case InternalPilotEventRideRequested,
		InternalPilotEventRideOfferCreated,
		InternalPilotEventRideOfferAccepted,
		InternalPilotEventDriverEnroute,
		InternalPilotEventPickupReached,
		InternalPilotEventTripStarted,
		InternalPilotEventTripCompleted,
		InternalPilotEventTripCancelled:
		return true
	default:
		return false
	}
}

func paymentEvidenceEvent(eventType string) bool {
	switch eventType {
	case InternalPilotEventWalletPaymentAttempted,
		InternalPilotEventWalletPaymentCompleted,
		InternalPilotEventCashPaymentCompleted,
		InternalPilotEventPlatformFeeRecorded,
		InternalPilotEventDriverEarningsRecorded:
		return true
	default:
		return false
	}
}

func maxInt(a int, b int) int {
	if a > b {
		return a
	}
	return b
}
