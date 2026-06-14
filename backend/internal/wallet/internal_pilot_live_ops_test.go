package wallet

import (
	"context"
	"errors"
	"testing"
	"time"
)

type fakeInternalPilotLiveOpsRepo struct {
	participant InternalPilotParticipant
	event       InternalPilotParticipantEvent
	snapshot    InternalPilotAccessSnapshot
	health      InternalPilotHealthReport
	incident    InternalPilotIncident
	killSwitch  InternalPilotKillSwitch
}

func (f *fakeInternalPilotLiveOpsRepo) CreateInternalPilotParticipant(ctx context.Context, participant InternalPilotParticipant) (InternalPilotParticipant, error) {
	participant.ID = "participant-1"
	f.participant = participant
	return participant, nil
}

func (f *fakeInternalPilotLiveOpsRepo) UpdateInternalPilotParticipantStatus(ctx context.Context, participantID string, status string, actorID string, reason string) (InternalPilotParticipant, error) {
	f.participant.ID = participantID
	f.participant.Status = status
	f.participant.Reason = reason
	return f.participant, nil
}

func (f *fakeInternalPilotLiveOpsRepo) CreateInternalPilotParticipantEvent(ctx context.Context, event InternalPilotParticipantEvent) error {
	f.event = event
	return nil
}

func (f *fakeInternalPilotLiveOpsRepo) GetInternalPilotAccessSnapshot(ctx context.Context, check InternalPilotAccessCheck) (InternalPilotAccessSnapshot, error) {
	if f.snapshot.AuthorizationID == "" {
		return InternalPilotAccessSnapshot{}, errors.New("missing snapshot")
	}
	return f.snapshot, nil
}

func (f *fakeInternalPilotLiveOpsRepo) CreateInternalPilotHealthReport(ctx context.Context, report InternalPilotHealthReport) (InternalPilotHealthReport, error) {
	f.health = report
	return report, nil
}

func (f *fakeInternalPilotLiveOpsRepo) CreateInternalPilotIncident(ctx context.Context, incident InternalPilotIncident) (InternalPilotIncident, error) {
	incident.ID = "incident-1"
	f.incident = incident
	return incident, nil
}

func (f *fakeInternalPilotLiveOpsRepo) UpdateInternalPilotIncidentStatus(ctx context.Context, incidentID string, status string, actorID string, resolution string) (InternalPilotIncident, error) {
	f.incident.ID = incidentID
	f.incident.Status = status
	f.incident.ResolvedBy = actorID
	f.incident.Resolution = resolution
	return f.incident, nil
}

func (f *fakeInternalPilotLiveOpsRepo) UpsertInternalPilotKillSwitch(ctx context.Context, killSwitch InternalPilotKillSwitch) (InternalPilotKillSwitch, error) {
	killSwitch.ID = "kill-switch-1"
	f.killSwitch = killSwitch
	return killSwitch, nil
}

func (f *fakeInternalPilotLiveOpsRepo) CreateInternalPilotKillSwitchEvent(ctx context.Context, event InternalPilotKillSwitchEvent) error {
	return nil
}

func TestInternalPilotParticipantEnrollmentLifecycle(t *testing.T) {
	repo := &fakeInternalPilotLiveOpsRepo{}
	service := NewInternalPilotLiveOpsService(repo)

	participant, err := service.EnrollParticipant(context.Background(), InternalPilotParticipant{
		AuthorizationExecutionID: "authorization-1",
		UserID:                   "user-1",
		Role:                     InternalPilotParticipantRoleRider,
		EnrollmentSource:         "board_packet",
		EnrolledBy:               "admin-1",
	})
	if err != nil {
		t.Fatal(err)
	}
	if participant.Status != InternalPilotParticipantActive || repo.event.Action != "enrolled" {
		t.Fatalf("expected active enrollment and audit event, got %s/%s", participant.Status, repo.event.Action)
	}

	suspended, err := service.UpdateParticipantStatus(context.Background(), participant.ID, InternalPilotParticipantSuspended, "admin-2", "risk review")
	if err != nil {
		t.Fatal(err)
	}
	if suspended.Status != InternalPilotParticipantSuspended || repo.event.Action != "status_changed" {
		t.Fatalf("expected suspended status change audit, got %s/%s", suspended.Status, repo.event.Action)
	}

	removed, err := service.UpdateParticipantStatus(context.Background(), participant.ID, InternalPilotParticipantRemoved, "admin-2", "pilot ended")
	if err != nil {
		t.Fatal(err)
	}
	if removed.Status != InternalPilotParticipantRemoved {
		t.Fatalf("expected removed participant, got %s", removed.Status)
	}
}

func TestInternalPilotAccessValidation(t *testing.T) {
	now := time.Now().UTC()
	repo := &fakeInternalPilotLiveOpsRepo{snapshot: InternalPilotAccessSnapshot{
		ParticipantID:          "participant-1",
		ParticipantRole:        InternalPilotParticipantRoleDriver,
		ParticipantStatus:      InternalPilotParticipantActive,
		AuthorizationID:        "authorization-1",
		AuthorizationStatus:    InternalPilotAuthorizationActive,
		AuthorizationCreatedAt: now.Add(-24 * time.Hour),
		ApprovedPilotUsers:     10,
		ApprovedDrivers:        5,
		ApprovedRiders:         5,
		PilotTransactionLimit:  20,
		PilotDurationDays:      7,
		ActiveParticipantCount: 2,
		ActiveDriverCount:      1,
		ActiveRiderCount:       1,
		PilotTransactionCount:  3,
	}}
	service := NewInternalPilotLiveOpsService(repo)

	err := service.ValidateParticipantAccess(context.Background(), InternalPilotAccessCheck{UserID: "driver-1", Role: InternalPilotParticipantRoleDriver, Service: InternalPilotServiceDispatch, CheckedAt: now})
	if err != nil {
		t.Fatal(err)
	}

	repo.snapshot.ParticipantStatus = InternalPilotParticipantSuspended
	if err = service.ValidateParticipantAccess(context.Background(), InternalPilotAccessCheck{UserID: "driver-1", Role: InternalPilotParticipantRoleDriver, Service: InternalPilotServiceDispatch, CheckedAt: now}); !errors.Is(err, ErrPilotAccessDenied) {
		t.Fatalf("expected suspended participant to be denied, got %v", err)
	}
}

func TestInternalPilotAccessBlocksExpiryCohortAndKillSwitch(t *testing.T) {
	now := time.Now().UTC()
	expired := now.Add(-time.Minute)
	base := InternalPilotAccessSnapshot{
		ParticipantID:          "participant-1",
		ParticipantRole:        InternalPilotParticipantRoleRider,
		ParticipantStatus:      InternalPilotParticipantActive,
		AuthorizationID:        "authorization-1",
		AuthorizationStatus:    InternalPilotAuthorizationActive,
		AuthorizationCreatedAt: now.Add(-24 * time.Hour),
		ApprovedPilotUsers:     1,
		ApprovedDrivers:        1,
		ApprovedRiders:         1,
		PilotTransactionLimit:  1,
		PilotDurationDays:      7,
		ActiveParticipantCount: 1,
		ActiveRiderCount:       1,
	}
	cases := []InternalPilotAccessSnapshot{
		func() InternalPilotAccessSnapshot { s := base; s.AuthorizationExpiresAt = &expired; return s }(),
		func() InternalPilotAccessSnapshot { s := base; s.ActiveParticipantCount = 2; return s }(),
		func() InternalPilotAccessSnapshot { s := base; s.PilotTransactionCount = 1; return s }(),
		func() InternalPilotAccessSnapshot { s := base; s.KillSwitchActive = true; return s }(),
	}
	for _, snapshot := range cases {
		service := NewInternalPilotLiveOpsService(&fakeInternalPilotLiveOpsRepo{snapshot: snapshot})
		err := service.ValidateParticipantAccess(context.Background(), InternalPilotAccessCheck{UserID: "rider-1", Role: InternalPilotParticipantRoleRider, Service: InternalPilotServiceRideRequests, CheckedAt: now})
		if !errors.Is(err, ErrPilotAccessDenied) {
			t.Fatalf("expected access denial for unsafe snapshot, got %v", err)
		}
	}
}

func TestInternalPilotIncidentKillSwitchAndHealthReport(t *testing.T) {
	repo := &fakeInternalPilotLiveOpsRepo{}
	service := NewInternalPilotLiveOpsService(repo)

	incident, err := service.CreateIncident(context.Background(), InternalPilotIncident{
		AuthorizationExecutionID: "authorization-1",
		IncidentType:             "wallet_reconciliation_mismatch",
		Severity:                 InternalPilotIncidentSeverityCritical,
		Title:                    "wallet drift",
		OpenedBy:                 "ops-1",
	})
	if err != nil {
		t.Fatal(err)
	}
	if incident.Status != InternalPilotIncidentStatusOpen {
		t.Fatalf("expected incident to default open, got %s", incident.Status)
	}
	closed, err := service.UpdateIncidentStatus(context.Background(), incident.ID, InternalPilotIncidentStatusClosed, "ops-2", "reconciled")
	if err != nil {
		t.Fatal(err)
	}
	if closed.Status != InternalPilotIncidentStatusClosed {
		t.Fatalf("expected closed incident, got %s", closed.Status)
	}

	killSwitch, err := service.ActivateKillSwitch(context.Background(), InternalPilotKillSwitch{Service: InternalPilotServiceWallets, ActivatedBy: "ops-1", Reason: "wallet incident"})
	if err != nil {
		t.Fatal(err)
	}
	if killSwitch.Status != InternalPilotKillSwitchActive || killSwitch.ActivatedAt == nil {
		t.Fatalf("expected active kill switch with timestamp, got %s", killSwitch.Status)
	}
	killSwitch, err = service.DeactivateKillSwitch(context.Background(), InternalPilotServiceWallets, "ops-2", "incident resolved")
	if err != nil {
		t.Fatal(err)
	}
	if killSwitch.Status != InternalPilotKillSwitchInactive || killSwitch.DeactivatedAt == nil {
		t.Fatalf("expected inactive kill switch with timestamp, got %s", killSwitch.Status)
	}

	report, err := service.CreateHealthReport(context.Background(), InternalPilotHealthReport{
		AuthorizationExecutionID: "authorization-1",
		RideRequests:             10,
		CompletedRides:           8,
		CancelledRides:           1,
		FailedRides:              1,
		WalletPayments:           4,
		CashPayments:             4,
		DriverParticipation:      3,
		RiderParticipation:       5,
		IncidentCount:            1,
		CriticalIncidents:        1,
		AuthorizationStatus:      InternalPilotAuthorizationActive,
		CreatedBy:                "ops-1",
	})
	if err != nil {
		t.Fatal(err)
	}
	if report.RideCompletionRate != 80 || report.CancellationRate != 10 || report.WalletSuccessRate != 50 || report.AuthorizationComplianceRate != 100 {
		t.Fatalf("unexpected health metrics: %#v", report)
	}
}
