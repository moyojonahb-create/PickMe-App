package wallet

import "context"

type GoNoGoRepository interface {
	CreatePilotAuthorization(ctx context.Context, authorization PilotAuthorization) (PilotAuthorization, error)
	CreatePilotScopeDefinition(ctx context.Context, scope PilotScopeDefinition) (PilotScopeDefinition, error)
	CreatePilotSuccessDefinition(ctx context.Context, success PilotSuccessDefinition) (PilotSuccessDefinition, error)
}

type GoNoGoService struct {
	repo GoNoGoRepository
}

func NewGoNoGoService(repo GoNoGoRepository) *GoNoGoService {
	return &GoNoGoService{repo: repo}
}

func (s *GoNoGoService) CreatePilotAuthorization(ctx context.Context, authorization PilotAuthorization) (PilotAuthorization, error) {
	if s == nil || s.repo == nil {
		return PilotAuthorization{}, nil
	}
	if authorization.CreatedBy == "" {
		return PilotAuthorization{}, ErrInvalidLedgerEntry
	}
	authorization.Decision = goNoGoDecision(authorization)
	if authorization.DecisionReason == "" {
		authorization.DecisionReason = goNoGoReason(authorization)
	}
	return s.repo.CreatePilotAuthorization(ctx, authorization)
}

func (s *GoNoGoService) CreatePilotScopeDefinition(ctx context.Context, scope PilotScopeDefinition) (PilotScopeDefinition, error) {
	if s == nil || s.repo == nil {
		return PilotScopeDefinition{}, nil
	}
	if scope.DefinedBy == "" || scope.PilotUsers < 0 || scope.PilotDrivers < 0 || scope.PilotRiders < 0 || scope.PilotTransactions < 0 || scope.PilotDurationDays <= 0 {
		return PilotScopeDefinition{}, ErrInvalidLedgerEntry
	}
	return s.repo.CreatePilotScopeDefinition(ctx, scope)
}

func (s *GoNoGoService) CreatePilotSuccessDefinition(ctx context.Context, success PilotSuccessDefinition) (PilotSuccessDefinition, error) {
	if s == nil || s.repo == nil {
		return PilotSuccessDefinition{}, nil
	}
	if success.DefinedBy == "" {
		return PilotSuccessDefinition{}, ErrInvalidLedgerEntry
	}
	for _, score := range []int{success.SettlementReliabilityTarget, success.ReconciliationReliabilityTarget, success.ProviderReliabilityTarget, success.DisputeResolutionTarget, success.IncidentResponseTarget} {
		if score < 0 || score > 100 {
			return PilotSuccessDefinition{}, ErrInvalidLedgerEntry
		}
	}
	return s.repo.CreatePilotSuccessDefinition(ctx, success)
}

func goNoGoDecision(authorization PilotAuthorization) string {
	if hasHardLaunchBlocker(authorization) {
		return GoNoGoDecisionNoGo
	}
	if authorization.TechnologyReady &&
		authorization.FinancialReady &&
		authorization.ProviderReady &&
		authorization.GovernanceReady &&
		authorization.OperationalReady &&
		authorization.ReliabilityReady {
		return GoNoGoDecisionGo
	}
	return GoNoGoDecisionConditionalGo
}

func hasHardLaunchBlocker(authorization PilotAuthorization) bool {
	return authorization.CriticalExceptionsExist ||
		authorization.HighExceptionsExist ||
		authorization.ReconciliationIncomplete ||
		authorization.FinanceSignoffMissing ||
		authorization.OperationsSignoffMissing ||
		authorization.CTOSignoffMissing ||
		authorization.RiskSignoffMissing
}

func goNoGoReason(authorization PilotAuthorization) string {
	if hasHardLaunchBlocker(authorization) {
		return "blocked_by_go_no_go_rules"
	}
	if goNoGoDecision(authorization) == GoNoGoDecisionGo {
		return "all_internal_pilot_readiness_domains_approved"
	}
	return "conditional_readiness_requires_remaining_domain_approval"
}
