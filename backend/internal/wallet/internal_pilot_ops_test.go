package wallet

import (
	"context"
	"testing"
)

type fakeInternalPilotOpsRepo struct {
	runbook    InternalPilotRunbook
	simulation Day1CloseSimulation
	escalation IncidentEscalation
	timeline   PilotOperationsTimelineEvent
	criteria   InternalPilotSuccessCriteria
}

func (f *fakeInternalPilotOpsRepo) CreateInternalPilotRunbook(ctx context.Context, runbook InternalPilotRunbook) (InternalPilotRunbook, error) {
	f.runbook = runbook
	return runbook, nil
}

func (f *fakeInternalPilotOpsRepo) CreateDay1CloseSimulation(ctx context.Context, simulation Day1CloseSimulation) (Day1CloseSimulation, error) {
	f.simulation = simulation
	return simulation, nil
}

func (f *fakeInternalPilotOpsRepo) CreateIncidentEscalation(ctx context.Context, escalation IncidentEscalation) (IncidentEscalation, error) {
	f.escalation = escalation
	return escalation, nil
}

func (f *fakeInternalPilotOpsRepo) CreatePilotTimelineEvent(ctx context.Context, event PilotOperationsTimelineEvent) (PilotOperationsTimelineEvent, error) {
	f.timeline = event
	return event, nil
}

func (f *fakeInternalPilotOpsRepo) EvaluateInternalPilotSuccess(ctx context.Context, criteria InternalPilotSuccessCriteria) (InternalPilotSuccessCriteria, error) {
	f.criteria = criteria
	return criteria, nil
}

func TestInternalPilotRunbookAndEscalationValidation(t *testing.T) {
	repo := &fakeInternalPilotOpsRepo{}
	service := NewInternalPilotOpsService(repo)

	_, err := service.CreateInternalPilotRunbook(context.Background(), InternalPilotRunbook{
		RunbookType: "settlement_incident",
		Title:       "Settlement incident runbook",
		OwnerID:     "admin-1",
		Steps:       `[{"step":"triage"}]`,
	})
	if err != nil {
		t.Fatal(err)
	}
	_, err = service.CreateIncidentEscalation(context.Background(), IncidentEscalation{IncidentType: "settlement", Level: IncidentEscalationHigh, OwnerID: "admin-1"})
	if err != nil {
		t.Fatal(err)
	}
	if repo.runbook.Status != "active" || repo.escalation.Level != IncidentEscalationHigh {
		t.Fatalf("unexpected runbook/escalation: %#v %#v", repo.runbook, repo.escalation)
	}
}

func TestDay1CloseSimulationRequiresAllChecksForSignoff(t *testing.T) {
	repo := &fakeInternalPilotOpsRepo{}
	service := NewInternalPilotOpsService(repo)

	pending, err := service.CreateDay1CloseSimulation(context.Background(), Day1CloseSimulation{OpeningBalanceValidated: true, SimulatedBy: "admin-1"})
	if err != nil {
		t.Fatal(err)
	}
	if pending.Status != DailyCloseStatusPendingReview {
		t.Fatalf("expected pending review, got %s", pending.Status)
	}

	signed, err := service.CreateDay1CloseSimulation(context.Background(), Day1CloseSimulation{
		OpeningBalanceValidated:  true,
		TransactionValidated:     true,
		ProviderTotalValidated:   true,
		WalletTotalValidated:     true,
		ReconciliationValidated:  true,
		ExceptionReviewCompleted: true,
		FinanceSignedOff:         true,
		OperationsSignedOff:      true,
		SimulatedBy:              "admin-1",
	})
	if err != nil {
		t.Fatal(err)
	}
	if signed.Status != DailyCloseStatusSignedOff {
		t.Fatalf("expected signed off simulation, got %s", signed.Status)
	}
}

func TestPilotTimelineAndSuccessCriteria(t *testing.T) {
	repo := &fakeInternalPilotOpsRepo{}
	service := NewInternalPilotOpsService(repo)

	_, err := service.CreatePilotTimelineEvent(context.Background(), PilotOperationsTimelineEvent{EventType: PilotTimelineEventStart, ActorID: "admin-1"})
	if err != nil {
		t.Fatal(err)
	}
	criteria, err := service.EvaluateInternalPilotSuccess(context.Background(), InternalPilotSuccessCriteria{
		SettlementSuccess:     true,
		ReconciliationSuccess: true,
		ProviderSuccess:       true,
		ReliabilityScore:      91,
		EvaluatedBy:           "admin-1",
	})
	if err != nil {
		t.Fatal(err)
	}
	if repo.timeline.EventType != PilotTimelineEventStart || criteria.Outcome != PilotAuthorizationOutcomeControlled {
		t.Fatalf("unexpected timeline/criteria: %#v %#v", repo.timeline, criteria)
	}
}
