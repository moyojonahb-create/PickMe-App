package wallet

import "context"

type ExecutiveReleaseRepository interface {
	GenerateExecutiveSignoffPacket(ctx context.Context, packet ExecutiveSignoffPacket) (ExecutiveSignoffPacket, error)
	RecordExecutiveApproval(ctx context.Context, approval ExecutiveApprovalRecord) (ExecutiveSignoffPacket, error)
	CreateLaunchBlocker(ctx context.Context, blocker LaunchBlocker) (LaunchBlocker, error)
	ResolveLaunchBlocker(ctx context.Context, blockerID string, adminID string, resolution string) (LaunchBlocker, error)
	RecordInternalLaunchDecision(ctx context.Context, decision InternalLaunchDecision) (InternalLaunchDecision, error)
}

type ExecutiveReleaseService struct {
	repo ExecutiveReleaseRepository
}

func NewExecutiveReleaseService(repo ExecutiveReleaseRepository) *ExecutiveReleaseService {
	return &ExecutiveReleaseService{repo: repo}
}

func (s *ExecutiveReleaseService) GenerateExecutiveSignoffPacket(ctx context.Context, packet ExecutiveSignoffPacket) (ExecutiveSignoffPacket, error) {
	if s == nil || s.repo == nil {
		return ExecutiveSignoffPacket{}, nil
	}
	if packet.PacketType == "" || packet.GeneratedBy == "" {
		return ExecutiveSignoffPacket{}, ErrInvalidLedgerEntry
	}
	if packet.Status == "" {
		packet.Status = ExecutiveApprovalStatusPending
	}
	packet.FinanceStatus = defaultString(packet.FinanceStatus, ExecutiveApprovalStatusPending)
	packet.CTOStatus = defaultString(packet.CTOStatus, ExecutiveApprovalStatusPending)
	packet.RiskStatus = defaultString(packet.RiskStatus, ExecutiveApprovalStatusPending)
	packet.OperationsStatus = defaultString(packet.OperationsStatus, ExecutiveApprovalStatusPending)
	return s.repo.GenerateExecutiveSignoffPacket(ctx, packet)
}

func (s *ExecutiveReleaseService) RecordExecutiveApproval(ctx context.Context, approval ExecutiveApprovalRecord) (ExecutiveSignoffPacket, error) {
	if s == nil || s.repo == nil {
		return ExecutiveSignoffPacket{}, nil
	}
	if approval.PacketID == "" || approval.ApproverRole == "" || approval.ApproverID == "" || approval.Status == "" {
		return ExecutiveSignoffPacket{}, ErrInvalidLedgerEntry
	}
	if !validExecutiveApprovalStatus(approval.Status) {
		return ExecutiveSignoffPacket{}, ErrInvalidLedgerEntry
	}
	return s.repo.RecordExecutiveApproval(ctx, approval)
}

func (s *ExecutiveReleaseService) CreateLaunchBlocker(ctx context.Context, blocker LaunchBlocker) (LaunchBlocker, error) {
	if s == nil || s.repo == nil {
		return LaunchBlocker{}, nil
	}
	if blocker.Title == "" || blocker.Severity == "" || blocker.OwnerID == "" {
		return LaunchBlocker{}, ErrInvalidLedgerEntry
	}
	if blocker.Status == "" {
		blocker.Status = LaunchBlockerStatusOpen
	}
	return s.repo.CreateLaunchBlocker(ctx, blocker)
}

func (s *ExecutiveReleaseService) ResolveLaunchBlocker(ctx context.Context, blockerID string, adminID string, resolution string) (LaunchBlocker, error) {
	if s == nil || s.repo == nil {
		return LaunchBlocker{}, nil
	}
	if blockerID == "" || adminID == "" || resolution == "" {
		return LaunchBlocker{}, ErrInvalidLedgerEntry
	}
	return s.repo.ResolveLaunchBlocker(ctx, blockerID, adminID, resolution)
}

func (s *ExecutiveReleaseService) RecordInternalLaunchDecision(ctx context.Context, decision InternalLaunchDecision) (InternalLaunchDecision, error) {
	if s == nil || s.repo == nil {
		return InternalLaunchDecision{}, nil
	}
	if decision.DecidedBy == "" {
		return InternalLaunchDecision{}, ErrInvalidLedgerEntry
	}
	if decision.Outcome == "" {
		decision.Outcome = internalLaunchOutcome(decision)
	}
	return s.repo.RecordInternalLaunchDecision(ctx, decision)
}

func validExecutiveApprovalStatus(status string) bool {
	return status == ExecutiveApprovalStatusPending ||
		status == ExecutiveApprovalStatusApproved ||
		status == ExecutiveApprovalStatusRejected ||
		status == ExecutiveApprovalStatusConditional
}

func internalLaunchOutcome(decision InternalLaunchDecision) string {
	if decision.OpenBlockersCount > 0 || decision.OverallReadinessScore < 75 {
		return InternalLaunchOutcomeNotReady
	}
	if decision.OverallReadinessScore < 90 {
		return InternalLaunchOutcomePilotReady
	}
	if decision.ProviderActivationSimulated &&
		decision.WalletActivationSimulated &&
		decision.WithdrawalActivationSimulated &&
		decision.PublicPaymentActivationSimulated {
		return InternalLaunchOutcomeControlledReady
	}
	return InternalLaunchOutcomePilotReady
}
