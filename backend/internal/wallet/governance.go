package wallet

import (
	"context"
	"time"
)

type GovernanceRepository interface {
	CreateFinanceApprovalRequest(ctx context.Context, request FinanceApprovalRequest) (FinanceApprovalRequest, error)
	RecordFinanceApproval(ctx context.Context, event FinanceApprovalEvent) (FinanceApprovalRequest, error)
	CreateLaunchGate(ctx context.Context, gate LaunchGate) (LaunchGate, error)
	EvaluateLaunchGate(ctx context.Context, gateID string, adminID string) (LaunchGate, error)
	CreateFinanceCloseRun(ctx context.Context, run FinanceCloseRun) (FinanceCloseRun, error)
	CreateFinanceSignoff(ctx context.Context, signoff FinanceSignoff) (FinanceSignoff, error)
	CreateLaunchReadinessScorecard(ctx context.Context, scorecard LaunchReadinessScorecard) (LaunchReadinessScorecard, error)
}

type GovernanceService struct {
	repo GovernanceRepository
}

func NewGovernanceService(repo GovernanceRepository) *GovernanceService {
	return &GovernanceService{repo: repo}
}

func (s *GovernanceService) CreateFinanceApprovalRequest(ctx context.Context, request FinanceApprovalRequest) (FinanceApprovalRequest, error) {
	if s == nil || s.repo == nil {
		return FinanceApprovalRequest{}, nil
	}
	if request.ApprovalType == "" || request.TargetType == "" || request.TargetID == "" || request.RequestedBy == "" {
		return FinanceApprovalRequest{}, ErrInvalidLedgerEntry
	}
	if request.RequiredApprovalCount < 2 {
		request.RequiredApprovalCount = 2
	}
	if request.Status == "" {
		request.Status = ApprovalStatusPending
	}
	return s.repo.CreateFinanceApprovalRequest(ctx, request)
}

func (s *GovernanceService) RecordFinanceApproval(ctx context.Context, event FinanceApprovalEvent) (FinanceApprovalRequest, error) {
	if s == nil || s.repo == nil {
		return FinanceApprovalRequest{}, nil
	}
	if event.RequestID == "" || event.ApproverID == "" || event.ApproverRole == "" || event.Decision == "" {
		return FinanceApprovalRequest{}, ErrInvalidLedgerEntry
	}
	return s.repo.RecordFinanceApproval(ctx, event)
}

func (s *GovernanceService) CreateLaunchGate(ctx context.Context, gate LaunchGate) (LaunchGate, error) {
	if s == nil || s.repo == nil {
		return LaunchGate{}, nil
	}
	if gate.GateKey == "" || gate.GateType == "" || gate.CreatedBy == "" {
		return LaunchGate{}, ErrInvalidLedgerEntry
	}
	if gate.Status == "" {
		gate.Status = LaunchGateStatusBlocked
	}
	return s.repo.CreateLaunchGate(ctx, gate)
}

func (s *GovernanceService) EvaluateLaunchGate(ctx context.Context, gateID string, adminID string) (LaunchGate, error) {
	if s == nil || s.repo == nil {
		return LaunchGate{}, nil
	}
	if gateID == "" || adminID == "" {
		return LaunchGate{}, ErrInvalidLedgerEntry
	}
	return s.repo.EvaluateLaunchGate(ctx, gateID, adminID)
}

func (s *GovernanceService) CreateFinanceCloseRun(ctx context.Context, run FinanceCloseRun) (FinanceCloseRun, error) {
	if s == nil || s.repo == nil {
		return FinanceCloseRun{}, nil
	}
	if run.CloseType == "" || run.PeriodStart.IsZero() || run.PeriodEnd.IsZero() || run.OpenedBy == "" {
		return FinanceCloseRun{}, ErrInvalidLedgerEntry
	}
	if run.Status == "" {
		run.Status = FinanceCloseStatusOpened
	}
	return s.repo.CreateFinanceCloseRun(ctx, run)
}

func (s *GovernanceService) CreateFinanceSignoff(ctx context.Context, signoff FinanceSignoff) (FinanceSignoff, error) {
	if s == nil || s.repo == nil {
		return FinanceSignoff{}, nil
	}
	if signoff.SignoffType == "" || signoff.TargetType == "" || signoff.TargetID == "" || signoff.SignerID == "" {
		return FinanceSignoff{}, ErrInvalidLedgerEntry
	}
	if signoff.Status == "" {
		signoff.Status = "signed"
	}
	now := time.Now().UTC()
	if signoff.SignedAt == nil && signoff.Status == "signed" {
		signoff.SignedAt = &now
	}
	return s.repo.CreateFinanceSignoff(ctx, signoff)
}

func (s *GovernanceService) CreateLaunchReadinessScorecard(ctx context.Context, scorecard LaunchReadinessScorecard) (LaunchReadinessScorecard, error) {
	if s == nil || s.repo == nil {
		return LaunchReadinessScorecard{}, nil
	}
	if scorecard.CreatedBy == "" || scorecard.Score < 0 || scorecard.Score > 100 {
		return LaunchReadinessScorecard{}, ErrInvalidLedgerEntry
	}
	if scorecard.Status == "" {
		scorecard.Status = scorecardStatus(scorecard.Score)
	}
	return s.repo.CreateLaunchReadinessScorecard(ctx, scorecard)
}
