package wallet

import (
	"context"
	"testing"
)

type fakeExecutiveReleaseRepo struct {
	packet   ExecutiveSignoffPacket
	approval ExecutiveApprovalRecord
	blocker  LaunchBlocker
	decision InternalLaunchDecision
}

func (f *fakeExecutiveReleaseRepo) GenerateExecutiveSignoffPacket(ctx context.Context, packet ExecutiveSignoffPacket) (ExecutiveSignoffPacket, error) {
	f.packet = packet
	return packet, nil
}

func (f *fakeExecutiveReleaseRepo) RecordExecutiveApproval(ctx context.Context, approval ExecutiveApprovalRecord) (ExecutiveSignoffPacket, error) {
	f.approval = approval
	return ExecutiveSignoffPacket{ID: approval.PacketID, Status: approval.Status}, nil
}

func (f *fakeExecutiveReleaseRepo) CreateLaunchBlocker(ctx context.Context, blocker LaunchBlocker) (LaunchBlocker, error) {
	f.blocker = blocker
	return blocker, nil
}

func (f *fakeExecutiveReleaseRepo) ResolveLaunchBlocker(ctx context.Context, blockerID string, adminID string, resolution string) (LaunchBlocker, error) {
	return LaunchBlocker{ID: blockerID, Status: LaunchBlockerStatusResolved, ResolvedBy: adminID, Resolution: resolution}, nil
}

func (f *fakeExecutiveReleaseRepo) RecordInternalLaunchDecision(ctx context.Context, decision InternalLaunchDecision) (InternalLaunchDecision, error) {
	f.decision = decision
	return decision, nil
}

func TestExecutiveSignoffPacketDefaultsAllApprovalsPending(t *testing.T) {
	repo := &fakeExecutiveReleaseRepo{}
	service := NewExecutiveReleaseService(repo)

	packet, err := service.GenerateExecutiveSignoffPacket(context.Background(), ExecutiveSignoffPacket{
		PacketType:  "executive_release",
		GeneratedBy: "admin-1",
	})
	if err != nil {
		t.Fatal(err)
	}
	if packet.Status != ExecutiveApprovalStatusPending ||
		packet.FinanceStatus != ExecutiveApprovalStatusPending ||
		packet.CTOStatus != ExecutiveApprovalStatusPending ||
		packet.RiskStatus != ExecutiveApprovalStatusPending ||
		packet.OperationsStatus != ExecutiveApprovalStatusPending {
		t.Fatalf("expected pending packet statuses, got %#v", packet)
	}
}

func TestExecutiveApprovalAllowsConditionalApproval(t *testing.T) {
	repo := &fakeExecutiveReleaseRepo{}
	service := NewExecutiveReleaseService(repo)

	_, err := service.RecordExecutiveApproval(context.Background(), ExecutiveApprovalRecord{
		PacketID:     "packet-1",
		ApproverRole: "finance",
		ApproverID:   "admin-1",
		Status:       ExecutiveApprovalStatusConditional,
		Conditions:   "resolve blocker-1",
	})
	if err != nil {
		t.Fatal(err)
	}
	if repo.approval.Status != ExecutiveApprovalStatusConditional {
		t.Fatalf("expected conditional approval, got %#v", repo.approval)
	}
}

func TestLaunchBlockerDefaultsOpenAndCanResolve(t *testing.T) {
	repo := &fakeExecutiveReleaseRepo{}
	service := NewExecutiveReleaseService(repo)

	blocker, err := service.CreateLaunchBlocker(context.Background(), LaunchBlocker{
		Title:    "provider statement mismatch",
		Severity: "high",
		OwnerID:  "admin-1",
	})
	if err != nil {
		t.Fatal(err)
	}
	if blocker.Status != LaunchBlockerStatusOpen {
		t.Fatalf("expected open blocker, got %#v", blocker)
	}
	resolved, err := service.ResolveLaunchBlocker(context.Background(), "blocker-1", "admin-2", "statement matched")
	if err != nil {
		t.Fatal(err)
	}
	if resolved.Status != LaunchBlockerStatusResolved {
		t.Fatalf("expected resolved blocker, got %#v", resolved)
	}
}

func TestInternalLaunchDecisionCalculatesConservativeOutcome(t *testing.T) {
	repo := &fakeExecutiveReleaseRepo{}
	service := NewExecutiveReleaseService(repo)

	notReady, err := service.RecordInternalLaunchDecision(context.Background(), InternalLaunchDecision{
		OpenBlockersCount:     1,
		OverallReadinessScore: 95,
		DecidedBy:             "admin-1",
	})
	if err != nil {
		t.Fatal(err)
	}
	if notReady.Outcome != InternalLaunchOutcomeNotReady {
		t.Fatalf("expected not ready, got %s", notReady.Outcome)
	}

	controlled, err := service.RecordInternalLaunchDecision(context.Background(), InternalLaunchDecision{
		ProviderActivationSimulated:      true,
		WalletActivationSimulated:        true,
		WithdrawalActivationSimulated:    true,
		PublicPaymentActivationSimulated: true,
		OverallReadinessScore:            91,
		DecidedBy:                        "admin-1",
	})
	if err != nil {
		t.Fatal(err)
	}
	if controlled.Outcome != InternalLaunchOutcomeControlledReady {
		t.Fatalf("expected controlled launch ready, got %s", controlled.Outcome)
	}
}
