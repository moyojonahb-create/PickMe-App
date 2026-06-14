package wallet

import "context"

type InternalPilotOpsRepository interface {
	CreateInternalPilotRunbook(ctx context.Context, runbook InternalPilotRunbook) (InternalPilotRunbook, error)
	CreateDay1CloseSimulation(ctx context.Context, simulation Day1CloseSimulation) (Day1CloseSimulation, error)
	CreateIncidentEscalation(ctx context.Context, escalation IncidentEscalation) (IncidentEscalation, error)
	CreatePilotTimelineEvent(ctx context.Context, event PilotOperationsTimelineEvent) (PilotOperationsTimelineEvent, error)
	EvaluateInternalPilotSuccess(ctx context.Context, criteria InternalPilotSuccessCriteria) (InternalPilotSuccessCriteria, error)
}

type InternalPilotOpsService struct {
	repo InternalPilotOpsRepository
}

func NewInternalPilotOpsService(repo InternalPilotOpsRepository) *InternalPilotOpsService {
	return &InternalPilotOpsService{repo: repo}
}

func (s *InternalPilotOpsService) CreateInternalPilotRunbook(ctx context.Context, runbook InternalPilotRunbook) (InternalPilotRunbook, error) {
	if s == nil || s.repo == nil {
		return InternalPilotRunbook{}, nil
	}
	if runbook.RunbookType == "" || runbook.Title == "" || runbook.OwnerID == "" || runbook.Steps == "" {
		return InternalPilotRunbook{}, ErrInvalidLedgerEntry
	}
	if runbook.Status == "" {
		runbook.Status = "active"
	}
	return s.repo.CreateInternalPilotRunbook(ctx, runbook)
}

func (s *InternalPilotOpsService) CreateDay1CloseSimulation(ctx context.Context, simulation Day1CloseSimulation) (Day1CloseSimulation, error) {
	if s == nil || s.repo == nil {
		return Day1CloseSimulation{}, nil
	}
	if simulation.SimulatedBy == "" {
		return Day1CloseSimulation{}, ErrInvalidLedgerEntry
	}
	if simulation.Status == "" {
		simulation.Status = day1SimulationStatus(simulation)
	}
	return s.repo.CreateDay1CloseSimulation(ctx, simulation)
}

func (s *InternalPilotOpsService) CreateIncidentEscalation(ctx context.Context, escalation IncidentEscalation) (IncidentEscalation, error) {
	if s == nil || s.repo == nil {
		return IncidentEscalation{}, nil
	}
	if escalation.IncidentType == "" || escalation.Level == "" || escalation.OwnerID == "" {
		return IncidentEscalation{}, ErrInvalidLedgerEntry
	}
	if !validIncidentLevel(escalation.Level) {
		return IncidentEscalation{}, ErrInvalidLedgerEntry
	}
	if escalation.Status == "" {
		escalation.Status = IncidentStatusOpened
	}
	return s.repo.CreateIncidentEscalation(ctx, escalation)
}

func (s *InternalPilotOpsService) CreatePilotTimelineEvent(ctx context.Context, event PilotOperationsTimelineEvent) (PilotOperationsTimelineEvent, error) {
	if s == nil || s.repo == nil {
		return PilotOperationsTimelineEvent{}, nil
	}
	if event.EventType == "" || event.ActorID == "" {
		return PilotOperationsTimelineEvent{}, ErrInvalidLedgerEntry
	}
	return s.repo.CreatePilotTimelineEvent(ctx, event)
}

func (s *InternalPilotOpsService) EvaluateInternalPilotSuccess(ctx context.Context, criteria InternalPilotSuccessCriteria) (InternalPilotSuccessCriteria, error) {
	if s == nil || s.repo == nil {
		return InternalPilotSuccessCriteria{}, nil
	}
	if criteria.EvaluatedBy == "" || criteria.ReliabilityScore < 0 || criteria.ReliabilityScore > 100 || criteria.UnresolvedExceptions < 0 {
		return InternalPilotSuccessCriteria{}, ErrInvalidLedgerEntry
	}
	if criteria.Outcome == "" {
		criteria.Outcome = internalPilotCriteriaOutcome(criteria)
	}
	return s.repo.EvaluateInternalPilotSuccess(ctx, criteria)
}

func day1SimulationStatus(simulation Day1CloseSimulation) string {
	if simulation.OpeningBalanceValidated &&
		simulation.TransactionValidated &&
		simulation.ProviderTotalValidated &&
		simulation.WalletTotalValidated &&
		simulation.ReconciliationValidated &&
		simulation.ExceptionReviewCompleted &&
		simulation.FinanceSignedOff &&
		simulation.OperationsSignedOff {
		return DailyCloseStatusSignedOff
	}
	return DailyCloseStatusPendingReview
}

func validIncidentLevel(level string) bool {
	return level == IncidentEscalationInformational ||
		level == IncidentEscalationWarning ||
		level == IncidentEscalationHigh ||
		level == IncidentEscalationCritical
}

func internalPilotCriteriaOutcome(criteria InternalPilotSuccessCriteria) string {
	if criteria.SettlementSuccess &&
		criteria.ReconciliationSuccess &&
		criteria.ProviderSuccess &&
		criteria.ReliabilityScore >= 90 &&
		criteria.UnresolvedExceptions == 0 {
		return PilotAuthorizationOutcomeControlled
	}
	if criteria.SettlementSuccess &&
		criteria.ReconciliationSuccess &&
		criteria.ReliabilityScore >= 80 &&
		criteria.UnresolvedExceptions == 0 {
		return PilotAuthorizationOutcomeInternal
	}
	return InternalLaunchOutcomeNotReady
}
