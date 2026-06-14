package wallet

import (
	"context"
	"testing"
	"time"
)

type fakeInternalPilotEvidenceRepo struct {
	events     []InternalPilotExecutionEvent
	pkg        InternalPilotEvidencePackage
	objectives []InternalPilotObjectiveResult
	metrics    InternalPilotEvidenceMetrics
}

func (f *fakeInternalPilotEvidenceRepo) CreateInternalPilotExecutionEvent(ctx context.Context, event InternalPilotExecutionEvent) (InternalPilotExecutionEvent, error) {
	event.ID = "event-1"
	f.events = append(f.events, event)
	return event, nil
}

func (f *fakeInternalPilotEvidenceRepo) AggregateInternalPilotEvidence(ctx context.Context, authorizationExecutionID string, periodStart time.Time, periodEnd time.Time) (InternalPilotEvidenceMetrics, error) {
	return f.metrics, nil
}

func (f *fakeInternalPilotEvidenceRepo) CreateInternalPilotEvidencePackage(ctx context.Context, pkg InternalPilotEvidencePackage) (InternalPilotEvidencePackage, error) {
	pkg.ID = "package-1"
	f.pkg = pkg
	return pkg, nil
}

func (f *fakeInternalPilotEvidenceRepo) CreateInternalPilotObjectiveResult(ctx context.Context, result InternalPilotObjectiveResult) (InternalPilotObjectiveResult, error) {
	result.ID = "objective-1"
	f.objectives = append(f.objectives, result)
	return result, nil
}

func TestInternalPilotExecutionEventCreation(t *testing.T) {
	repo := &fakeInternalPilotEvidenceRepo{}
	service := NewInternalPilotEvidenceService(repo)

	event, err := service.RecordExecutionEvent(context.Background(), InternalPilotExecutionEvent{
		AuthorizationExecutionID: "authorization-1",
		ParticipantID:            "participant-1",
		EventType:                InternalPilotEventParticipantJoined,
		EntityType:               "participant",
		EntityID:                 "participant-1",
	})
	if err != nil {
		t.Fatal(err)
	}
	if event.Status != "recorded" || len(repo.events) != 1 {
		t.Fatalf("expected recorded execution event, got %#v", event)
	}
}

func TestInternalPilotTypedEvidenceRecording(t *testing.T) {
	repo := &fakeInternalPilotEvidenceRepo{}
	service := NewInternalPilotEvidenceService(repo)

	_, err := service.RecordRideEvidence(context.Background(), "authorization-1", "participant-1", InternalPilotEventTripCompleted, "ride-1", "completed", "{}")
	if err != nil {
		t.Fatal(err)
	}
	_, err = service.RecordPaymentEvidence(context.Background(), "authorization-1", "participant-1", InternalPilotEventWalletPaymentCompleted, "payment-1", "completed", "{}")
	if err != nil {
		t.Fatal(err)
	}
	_, err = service.RecordAuthorizationEvidence(context.Background(), "authorization-1", "participant-1", InternalPilotEventAuthorizationCheckPassed, "auth-1", "passed", "{}")
	if err != nil {
		t.Fatal(err)
	}
	_, err = service.RecordIncidentEvidence(context.Background(), "authorization-1", "participant-1", InternalPilotEventIncidentCreated, "incident-1", InternalPilotIncidentSeverityCritical, "{}")
	if err != nil {
		t.Fatal(err)
	}
	if len(repo.events) != 4 {
		t.Fatalf("expected four typed evidence events, got %d", len(repo.events))
	}

	_, err = service.RecordPaymentEvidence(context.Background(), "authorization-1", "participant-1", InternalPilotEventTripCompleted, "payment-2", "completed", "{}")
	if err == nil {
		t.Fatal("expected invalid payment evidence event to fail")
	}
}

func TestInternalPilotEvidencePackageGeneration(t *testing.T) {
	repo := &fakeInternalPilotEvidenceRepo{metrics: InternalPilotEvidenceMetrics{
		TotalEvents:         20,
		TotalRides:          10,
		CompletedRides:      8,
		CancelledRides:      1,
		WalletTransactions:  4,
		CashTransactions:    4,
		Incidents:           2,
		CriticalIncidents:   1,
		AuthorizationPassed: 9,
		AuthorizationFailed: 1,
		PolicyViolations:    1,
	}}
	service := NewInternalPilotEvidenceService(repo)
	start := time.Now().UTC().Add(-24 * time.Hour)
	end := time.Now().UTC()

	pkg, err := service.CreateEvidencePackage(context.Background(), "authorization-1", start, end, "{}")
	if err != nil {
		t.Fatal(err)
	}
	if pkg.TotalEvents != 20 || pkg.CompletedRides != 8 || pkg.ComplianceScore >= 100 {
		t.Fatalf("expected generated package metrics and reduced compliance score, got %#v", pkg)
	}
}

func TestInternalPilotObjectiveEvaluationAndSummary(t *testing.T) {
	repo := &fakeInternalPilotEvidenceRepo{metrics: InternalPilotEvidenceMetrics{
		TotalParticipants:     6,
		ActiveParticipants:    5,
		RiderParticipation:    3,
		DriverParticipation:   2,
		TotalRides:            10,
		CompletedRides:        9,
		CancelledRides:        1,
		WalletTransactions:    5,
		CashTransactions:      4,
		PlatformFees:          9,
		DriverEarnings:        9,
		AuthorizationPassed:   10,
		AuthorizationFailed:   0,
		KillSwitchActivations: 0,
	}}
	service := NewInternalPilotEvidenceService(repo)

	results, err := service.EvaluatePilotObjectives(context.Background(), []InternalPilotObjectiveResult{
		{AuthorizationExecutionID: "authorization-1", ObjectiveName: "ride_completion_rate", TargetValue: 90, ActualValue: 90},
		{AuthorizationExecutionID: "authorization-1", ObjectiveName: "incident_rate", TargetValue: 100, ActualValue: 80},
	})
	if err != nil {
		t.Fatal(err)
	}
	if !results[0].Achieved || results[1].Achieved {
		t.Fatalf("expected first objective achieved and second missed, got %#v", results)
	}

	summary, err := service.GeneratePilotEvidenceSummary(context.Background(), "authorization-1", time.Now().Add(-time.Hour), time.Now())
	if err != nil {
		t.Fatal(err)
	}
	rideMetrics, ok := summary["ride_metrics"].(map[string]any)
	if !ok || rideMetrics["completion_percentage"] != 90 {
		t.Fatalf("expected generated ride completion percentage, got %#v", summary)
	}
}
