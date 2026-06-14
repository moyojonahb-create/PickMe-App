package wallet

import (
	"context"
	"testing"
	"time"
)

type fakeGovernanceRepo struct {
	approvals  int
	events     int
	gates      int
	closes     int
	signoffs   int
	scorecards int
}

func (f *fakeGovernanceRepo) CreateFinanceApprovalRequest(ctx context.Context, request FinanceApprovalRequest) (FinanceApprovalRequest, error) {
	f.approvals++
	request.ID = "approval-1"
	return request, nil
}

func (f *fakeGovernanceRepo) RecordFinanceApproval(ctx context.Context, event FinanceApprovalEvent) (FinanceApprovalRequest, error) {
	f.events++
	return FinanceApprovalRequest{ID: event.RequestID, Status: ApprovalStatusPending}, nil
}

func (f *fakeGovernanceRepo) CreateLaunchGate(ctx context.Context, gate LaunchGate) (LaunchGate, error) {
	f.gates++
	gate.ID = "gate-1"
	return gate, nil
}

func (f *fakeGovernanceRepo) EvaluateLaunchGate(ctx context.Context, gateID string, adminID string) (LaunchGate, error) {
	f.gates++
	return LaunchGate{ID: gateID}, nil
}

func (f *fakeGovernanceRepo) CreateFinanceCloseRun(ctx context.Context, run FinanceCloseRun) (FinanceCloseRun, error) {
	f.closes++
	run.ID = "close-1"
	return run, nil
}

func (f *fakeGovernanceRepo) CreateFinanceSignoff(ctx context.Context, signoff FinanceSignoff) (FinanceSignoff, error) {
	f.signoffs++
	signoff.ID = "signoff-1"
	return signoff, nil
}

func (f *fakeGovernanceRepo) CreateLaunchReadinessScorecard(ctx context.Context, scorecard LaunchReadinessScorecard) (LaunchReadinessScorecard, error) {
	f.scorecards++
	scorecard.ID = "readiness-1"
	return scorecard, nil
}

func TestGovernanceServiceRequiresDualApproval(t *testing.T) {
	repo := &fakeGovernanceRepo{}
	service := NewGovernanceService(repo)
	request, err := service.CreateFinanceApprovalRequest(context.Background(), FinanceApprovalRequest{ApprovalType: "finance", TargetType: "launch_gate", TargetID: "gate-1", RequestedBy: "admin-1", RequiredApprovalCount: 1})
	if err != nil {
		t.Fatal(err)
	}
	if request.RequiredApprovalCount != 2 {
		t.Fatalf("expected required approval count to be forced to 2, got %d", request.RequiredApprovalCount)
	}
}

func TestGovernanceServiceCreatesCloseSignoffAndReadiness(t *testing.T) {
	repo := &fakeGovernanceRepo{}
	service := NewGovernanceService(repo)
	_, err := service.CreateFinanceCloseRun(context.Background(), FinanceCloseRun{CloseType: "daily", PeriodStart: time.Now().Add(-24 * time.Hour), PeriodEnd: time.Now(), OpenedBy: "admin-1"})
	if err != nil {
		t.Fatal(err)
	}
	_, err = service.CreateFinanceSignoff(context.Background(), FinanceSignoff{SignoffType: "finance", TargetType: "finance_close", TargetID: "close-1", SignerID: "admin-2"})
	if err != nil {
		t.Fatal(err)
	}
	scorecard, err := service.CreateLaunchReadinessScorecard(context.Background(), LaunchReadinessScorecard{Score: 75, CreatedBy: "admin-1"})
	if err != nil {
		t.Fatal(err)
	}
	if scorecard.Status != "yellow" {
		t.Fatalf("expected yellow readiness scorecard, got %s", scorecard.Status)
	}
	if repo.closes != 1 || repo.signoffs != 1 || repo.scorecards != 1 {
		t.Fatalf("unexpected repo calls: %#v", repo)
	}
}
