package wallet

import (
	"context"
	"testing"
)

type fakeInternalPilotAuthorizationRepo struct {
	authorization InternalPilotAuthorizationExecution
	audit         InternalPilotAuthorizationAudit
}

func (f *fakeInternalPilotAuthorizationRepo) CreateInternalPilotAuthorizationExecution(ctx context.Context, authorization InternalPilotAuthorizationExecution) (InternalPilotAuthorizationExecution, error) {
	f.authorization = authorization
	return authorization, nil
}

func (f *fakeInternalPilotAuthorizationRepo) RecordInternalPilotAuthorizationAudit(ctx context.Context, audit InternalPilotAuthorizationAudit) (InternalPilotAuthorizationAudit, error) {
	f.audit = audit
	return audit, nil
}

func TestInternalPilotAuthorizationApprovesCleanExecution(t *testing.T) {
	repo := &fakeInternalPilotAuthorizationRepo{}
	service := NewInternalPilotAuthorizationService(repo)

	result, err := service.CreateAuthorizationExecution(context.Background(), InternalPilotAuthorizationExecution{
		ReadinessScoreThreshold: 90,
		ReadinessScore:          96,
		ApprovedPilotUsers:      10,
		ApprovedDrivers:         5,
		ApprovedRiders:          5,
		PilotTransactionLimit:   25,
		PilotDurationDays:       7,
		CreatedBy:               "00000000-0000-0000-0000-000000000010",
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.Decision != InternalPilotApprovalApproved || result.Status != InternalPilotAuthorizationActive {
		t.Fatalf("expected approved active authorization, got %s/%s", result.Decision, result.Status)
	}
}

func TestInternalPilotAuthorizationConditionalAndRejected(t *testing.T) {
	repo := &fakeInternalPilotAuthorizationRepo{}
	service := NewInternalPilotAuthorizationService(repo)

	conditional, err := service.CreateAuthorizationExecution(context.Background(), InternalPilotAuthorizationExecution{
		ReadinessScoreThreshold: 90,
		ReadinessScore:          93,
		Conditions:              "finance daily close must remain green",
		PilotDurationDays:       7,
		CreatedBy:               "00000000-0000-0000-0000-000000000010",
	})
	if err != nil {
		t.Fatal(err)
	}
	if conditional.Decision != InternalPilotApprovalConditional || conditional.Status != InternalPilotAuthorizationActive {
		t.Fatalf("expected conditional active authorization, got %s/%s", conditional.Decision, conditional.Status)
	}

	rejected, err := service.CreateAuthorizationExecution(context.Background(), InternalPilotAuthorizationExecution{
		ReadinessScoreThreshold: 95,
		ReadinessScore:          90,
		UnresolvedExceptions:    1,
		PilotDurationDays:       7,
		CreatedBy:               "00000000-0000-0000-0000-000000000010",
	})
	if err != nil {
		t.Fatal(err)
	}
	if rejected.Decision != InternalPilotApprovalRejected || rejected.Status != InternalPilotAuthorizationRevoked {
		t.Fatalf("expected rejected revoked authorization, got %s/%s", rejected.Decision, rejected.Status)
	}
}

func TestInternalPilotAuthorizationAuditValidation(t *testing.T) {
	repo := &fakeInternalPilotAuthorizationRepo{}
	service := NewInternalPilotAuthorizationService(repo)

	_, err := service.RecordAuthorizationAudit(context.Background(), InternalPilotAuthorizationAudit{
		AuthorizationExecutionID: "authorization-1",
		ApproverID:               "00000000-0000-0000-0000-000000000010",
		Decision:                 InternalPilotApprovalApproved,
		Reason:                   "board approved controlled internal pilot",
	})
	if err != nil {
		t.Fatal(err)
	}
	if repo.audit.Decision != InternalPilotApprovalApproved {
		t.Fatalf("expected audit decision to be recorded, got %s", repo.audit.Decision)
	}

	_, err = service.RecordAuthorizationAudit(context.Background(), InternalPilotAuthorizationAudit{AuthorizationExecutionID: "authorization-1", ApproverID: "admin-1", Decision: "go"})
	if err == nil {
		t.Fatal("expected invalid audit decision to fail")
	}
}
