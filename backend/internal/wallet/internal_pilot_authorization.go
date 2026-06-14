package wallet

import "context"

type InternalPilotAuthorizationRepository interface {
	CreateInternalPilotAuthorizationExecution(ctx context.Context, authorization InternalPilotAuthorizationExecution) (InternalPilotAuthorizationExecution, error)
	RecordInternalPilotAuthorizationAudit(ctx context.Context, audit InternalPilotAuthorizationAudit) (InternalPilotAuthorizationAudit, error)
}

type InternalPilotAuthorizationService struct {
	repo InternalPilotAuthorizationRepository
}

func NewInternalPilotAuthorizationService(repo InternalPilotAuthorizationRepository) *InternalPilotAuthorizationService {
	return &InternalPilotAuthorizationService{repo: repo}
}

func (s *InternalPilotAuthorizationService) CreateAuthorizationExecution(ctx context.Context, authorization InternalPilotAuthorizationExecution) (InternalPilotAuthorizationExecution, error) {
	if s == nil || s.repo == nil {
		return InternalPilotAuthorizationExecution{}, nil
	}
	if authorization.CreatedBy == "" ||
		authorization.ReadinessScoreThreshold < 0 ||
		authorization.ReadinessScoreThreshold > 100 ||
		authorization.ReadinessScore < 0 ||
		authorization.ReadinessScore > 100 ||
		authorization.UnresolvedExceptions < 0 ||
		authorization.ApprovedPilotUsers < 0 ||
		authorization.ApprovedDrivers < 0 ||
		authorization.ApprovedRiders < 0 ||
		authorization.PilotTransactionLimit < 0 ||
		authorization.PilotDurationDays <= 0 {
		return InternalPilotAuthorizationExecution{}, ErrInvalidLedgerEntry
	}
	authorization.Decision = internalPilotAuthorizationDecision(authorization)
	authorization.Status = internalPilotAuthorizationStatus(authorization.Decision)
	if authorization.DecisionReason == "" {
		authorization.DecisionReason = internalPilotAuthorizationReason(authorization)
	}
	return s.repo.CreateInternalPilotAuthorizationExecution(ctx, authorization)
}

func (s *InternalPilotAuthorizationService) RecordAuthorizationAudit(ctx context.Context, audit InternalPilotAuthorizationAudit) (InternalPilotAuthorizationAudit, error) {
	if s == nil || s.repo == nil {
		return InternalPilotAuthorizationAudit{}, nil
	}
	if audit.AuthorizationExecutionID == "" || audit.ApproverID == "" || !validInternalPilotApprovalDecision(audit.Decision) {
		return InternalPilotAuthorizationAudit{}, ErrInvalidLedgerEntry
	}
	return s.repo.RecordInternalPilotAuthorizationAudit(ctx, audit)
}

func internalPilotAuthorizationDecision(authorization InternalPilotAuthorizationExecution) string {
	if authorization.UnresolvedExceptions > 0 || authorization.ReadinessScore < authorization.ReadinessScoreThreshold {
		return InternalPilotApprovalRejected
	}
	if authorization.Conditions != "" {
		return InternalPilotApprovalConditional
	}
	return InternalPilotApprovalApproved
}

func internalPilotAuthorizationStatus(decision string) string {
	switch decision {
	case InternalPilotApprovalApproved, InternalPilotApprovalConditional:
		return InternalPilotAuthorizationActive
	case InternalPilotApprovalExpired:
		return InternalPilotAuthorizationExpired
	default:
		return InternalPilotAuthorizationRevoked
	}
}

func internalPilotAuthorizationReason(authorization InternalPilotAuthorizationExecution) string {
	if authorization.UnresolvedExceptions > 0 {
		return "blocked_by_unresolved_production_exceptions"
	}
	if authorization.ReadinessScore < authorization.ReadinessScoreThreshold {
		return "blocked_by_readiness_score_threshold"
	}
	if authorization.Conditions != "" {
		return "conditional_internal_pilot_authorization"
	}
	return "internal_pilot_authorized_without_activation"
}

func validInternalPilotApprovalDecision(decision string) bool {
	switch decision {
	case InternalPilotApprovalApproved, InternalPilotApprovalConditional, InternalPilotApprovalRejected, InternalPilotApprovalExpired:
		return true
	default:
		return false
	}
}
