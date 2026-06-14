package wallet

import (
	"context"
	"testing"
)

type fakeGoNoGoRepo struct {
	authorization PilotAuthorization
	scope         PilotScopeDefinition
	success       PilotSuccessDefinition
}

func (f *fakeGoNoGoRepo) CreatePilotAuthorization(ctx context.Context, authorization PilotAuthorization) (PilotAuthorization, error) {
	f.authorization = authorization
	return authorization, nil
}

func (f *fakeGoNoGoRepo) CreatePilotScopeDefinition(ctx context.Context, scope PilotScopeDefinition) (PilotScopeDefinition, error) {
	f.scope = scope
	return scope, nil
}

func (f *fakeGoNoGoRepo) CreatePilotSuccessDefinition(ctx context.Context, success PilotSuccessDefinition) (PilotSuccessDefinition, error) {
	f.success = success
	return success, nil
}

func TestGoNoGoBlocksHardLaunchBlockers(t *testing.T) {
	repo := &fakeGoNoGoRepo{}
	service := NewGoNoGoService(repo)

	result, err := service.CreatePilotAuthorization(context.Background(), PilotAuthorization{
		TechnologyReady:         true,
		FinancialReady:          true,
		ProviderReady:           true,
		GovernanceReady:         true,
		OperationalReady:        true,
		ReliabilityReady:        true,
		CriticalExceptionsExist: true,
		CreatedBy:               "admin-1",
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.Decision != GoNoGoDecisionNoGo {
		t.Fatalf("expected hard blocker to force no_go, got %s", result.Decision)
	}
}

func TestGoNoGoAllowsCleanGoAndConditionalGo(t *testing.T) {
	repo := &fakeGoNoGoRepo{}
	service := NewGoNoGoService(repo)

	goResult, err := service.CreatePilotAuthorization(context.Background(), PilotAuthorization{
		TechnologyReady:  true,
		FinancialReady:   true,
		ProviderReady:    true,
		GovernanceReady:  true,
		OperationalReady: true,
		ReliabilityReady: true,
		CreatedBy:        "admin-1",
	})
	if err != nil {
		t.Fatal(err)
	}
	if goResult.Decision != GoNoGoDecisionGo {
		t.Fatalf("expected go, got %s", goResult.Decision)
	}

	conditional, err := service.CreatePilotAuthorization(context.Background(), PilotAuthorization{
		TechnologyReady: true,
		FinancialReady:  true,
		CreatedBy:       "admin-1",
	})
	if err != nil {
		t.Fatal(err)
	}
	if conditional.Decision != GoNoGoDecisionConditionalGo {
		t.Fatalf("expected conditional_go, got %s", conditional.Decision)
	}
}

func TestPilotScopeAndSuccessDefinitionsValidate(t *testing.T) {
	repo := &fakeGoNoGoRepo{}
	service := NewGoNoGoService(repo)

	_, err := service.CreatePilotScopeDefinition(context.Background(), PilotScopeDefinition{PilotUsers: 4, PilotDrivers: 2, PilotRiders: 2, PilotTransactions: 10, PilotDurationDays: 7, DefinedBy: "admin-1"})
	if err != nil {
		t.Fatal(err)
	}
	_, err = service.CreatePilotSuccessDefinition(context.Background(), PilotSuccessDefinition{SettlementReliabilityTarget: 95, ReconciliationReliabilityTarget: 95, ProviderReliabilityTarget: 90, DisputeResolutionTarget: 90, IncidentResponseTarget: 90, DefinedBy: "admin-1"})
	if err != nil {
		t.Fatal(err)
	}
	if repo.scope.PilotDurationDays != 7 || repo.success.ProviderReliabilityTarget != 90 {
		t.Fatalf("unexpected scope/success definitions: %#v %#v", repo.scope, repo.success)
	}
}
