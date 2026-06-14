package wallet

import (
	"context"
	"fmt"
)

type RecoveryRepository interface {
	CreateRefundIntent(ctx context.Context, refund RefundIntent) (RefundIntent, error)
	CreateChargeback(ctx context.Context, chargeback ChargebackRecord) (ChargebackRecord, error)
	OpenDispute(ctx context.Context, dispute FinancialDispute) (FinancialDispute, error)
	UpdateDisputeStatus(ctx context.Context, disputeID string, status string, adminID string, resolution string) (FinancialDispute, error)
	CreateFinancialIncident(ctx context.Context, incident FinancialIncident) (FinancialIncident, error)
	ImportProviderStatement(ctx context.Context, req ProviderStatementImportRequest) (ProviderStatementImport, error)
	RunProviderStatementReconciliation(ctx context.Context, importID string, provider string) (ReconciliationRun, error)
}

type RecoveryService struct {
	repo        RecoveryRepository
	certRepo    CertificationRepository
	govRepo     GovernanceRepository
	releaseRepo ReleaseReadinessRepository
}

func NewRecoveryService(repo RecoveryRepository) *RecoveryService {
	service := &RecoveryService{repo: repo}
	if certRepo, ok := repo.(CertificationRepository); ok {
		service.certRepo = certRepo
	}
	if govRepo, ok := repo.(GovernanceRepository); ok {
		service.govRepo = govRepo
	}
	if releaseRepo, ok := repo.(ReleaseReadinessRepository); ok {
		service.releaseRepo = releaseRepo
	}
	return service
}

func (s *RecoveryService) CreateRefundIntent(ctx context.Context, refund RefundIntent) (RefundIntent, error) {
	if s == nil || s.repo == nil {
		return RefundIntent{}, nil
	}
	if refund.Provider == "" || refund.AmountMinor <= 0 || refund.Currency == "" || refund.Reason == "" || refund.IdempotencyKey == "" {
		return RefundIntent{}, ErrInvalidLedgerEntry
	}
	if refund.Status == "" {
		refund.Status = RefundStatusPendingReview
	}
	return s.repo.CreateRefundIntent(ctx, refund)
}

func (s *RecoveryService) CreateChargeback(ctx context.Context, chargeback ChargebackRecord) (ChargebackRecord, error) {
	if s == nil || s.repo == nil {
		return ChargebackRecord{}, nil
	}
	if chargeback.Provider == "" || chargeback.ProviderChargebackID == "" || chargeback.AmountMinor <= 0 || chargeback.Currency == "" {
		return ChargebackRecord{}, ErrInvalidLedgerEntry
	}
	if chargeback.Status == "" {
		chargeback.Status = ChargebackStatusReceived
	}
	return s.repo.CreateChargeback(ctx, chargeback)
}

func (s *RecoveryService) OpenDispute(ctx context.Context, dispute FinancialDispute) (FinancialDispute, error) {
	if s == nil || s.repo == nil {
		return FinancialDispute{}, nil
	}
	if dispute.DisputeType == "" || dispute.Reason == "" {
		return FinancialDispute{}, ErrInvalidLedgerEntry
	}
	if dispute.Status == "" {
		dispute.Status = DisputeStatusOpened
	}
	return s.repo.OpenDispute(ctx, dispute)
}

func (s *RecoveryService) UpdateDisputeStatus(ctx context.Context, disputeID string, status string, adminID string, resolution string) (FinancialDispute, error) {
	if s == nil || s.repo == nil {
		return FinancialDispute{}, nil
	}
	if disputeID == "" || status == "" || adminID == "" {
		return FinancialDispute{}, ErrInvalidLedgerEntry
	}
	return s.repo.UpdateDisputeStatus(ctx, disputeID, status, adminID, resolution)
}

func (s *RecoveryService) CreateFinancialIncident(ctx context.Context, incident FinancialIncident) (FinancialIncident, error) {
	if s == nil || s.repo == nil {
		return FinancialIncident{}, nil
	}
	if incident.Severity == "" || incident.IncidentType == "" || incident.Title == "" {
		return FinancialIncident{}, ErrInvalidLedgerEntry
	}
	if incident.Status == "" {
		incident.Status = IncidentStatusOpened
	}
	return s.repo.CreateFinancialIncident(ctx, incident)
}

func (s *RecoveryService) ImportProviderStatement(ctx context.Context, req ProviderStatementImportRequest) (ProviderStatementImport, error) {
	if s == nil || s.repo == nil {
		return ProviderStatementImport{}, nil
	}
	if req.Provider == "" || req.StatementReference == "" {
		return ProviderStatementImport{}, ErrInvalidLedgerEntry
	}
	for i, line := range req.Lines {
		if line.LineReference == "" || line.AmountMinor == 0 || line.Currency == "" {
			return ProviderStatementImport{}, fmt.Errorf("%w: invalid provider statement line %d", ErrInvalidLedgerEntry, i)
		}
	}
	return s.repo.ImportProviderStatement(ctx, req)
}

func (s *RecoveryService) RunProviderStatementReconciliation(ctx context.Context, importID string, provider string) (ReconciliationRun, error) {
	if s == nil || s.repo == nil {
		return ReconciliationRun{}, nil
	}
	if importID == "" || provider == "" {
		return ReconciliationRun{}, ErrInvalidLedgerEntry
	}
	return s.repo.RunProviderStatementReconciliation(ctx, importID, provider)
}

func (s *RecoveryService) StartProviderCertification(ctx context.Context, provider string, certificationType string, adminID string) (ProviderCertification, error) {
	if s == nil || s.certRepo == nil {
		return ProviderCertification{}, nil
	}
	return NewCertificationService(s.certRepo).StartProviderCertification(ctx, provider, defaultString(certificationType, certificationTypeForProvider(provider)), adminID)
}

func (s *RecoveryService) RunRecoveryDrill(ctx context.Context, drillType string, provider string, adminID string) (RecoveryDrill, error) {
	if s == nil || s.certRepo == nil {
		return RecoveryDrill{}, nil
	}
	return NewCertificationService(s.certRepo).RunRecoveryDrill(ctx, drillType, provider, adminID)
}

func (s *RecoveryService) RecordRecoveryScorecard(ctx context.Context, scorecard RecoveryScorecard) (RecoveryScorecard, error) {
	if s == nil || s.certRepo == nil {
		return RecoveryScorecard{}, nil
	}
	return NewCertificationService(s.certRepo).RecordRecoveryScorecard(ctx, scorecard)
}

func (s *RecoveryService) CreateFinanceApprovalRequest(ctx context.Context, request FinanceApprovalRequest) (FinanceApprovalRequest, error) {
	if s == nil || s.govRepo == nil {
		return FinanceApprovalRequest{}, nil
	}
	return NewGovernanceService(s.govRepo).CreateFinanceApprovalRequest(ctx, request)
}

func (s *RecoveryService) RecordFinanceApproval(ctx context.Context, event FinanceApprovalEvent) (FinanceApprovalRequest, error) {
	if s == nil || s.govRepo == nil {
		return FinanceApprovalRequest{}, nil
	}
	return NewGovernanceService(s.govRepo).RecordFinanceApproval(ctx, event)
}

func (s *RecoveryService) CreateLaunchGate(ctx context.Context, gate LaunchGate) (LaunchGate, error) {
	if s == nil || s.govRepo == nil {
		return LaunchGate{}, nil
	}
	return NewGovernanceService(s.govRepo).CreateLaunchGate(ctx, gate)
}

func (s *RecoveryService) EvaluateLaunchGate(ctx context.Context, gateID string, adminID string) (LaunchGate, error) {
	if s == nil || s.govRepo == nil {
		return LaunchGate{}, nil
	}
	return NewGovernanceService(s.govRepo).EvaluateLaunchGate(ctx, gateID, adminID)
}

func (s *RecoveryService) CreateFinanceCloseRun(ctx context.Context, run FinanceCloseRun) (FinanceCloseRun, error) {
	if s == nil || s.govRepo == nil {
		return FinanceCloseRun{}, nil
	}
	return NewGovernanceService(s.govRepo).CreateFinanceCloseRun(ctx, run)
}

func (s *RecoveryService) CreateFinanceSignoff(ctx context.Context, signoff FinanceSignoff) (FinanceSignoff, error) {
	if s == nil || s.govRepo == nil {
		return FinanceSignoff{}, nil
	}
	return NewGovernanceService(s.govRepo).CreateFinanceSignoff(ctx, signoff)
}

func (s *RecoveryService) CreateLaunchReadinessScorecard(ctx context.Context, scorecard LaunchReadinessScorecard) (LaunchReadinessScorecard, error) {
	if s == nil || s.govRepo == nil {
		return LaunchReadinessScorecard{}, nil
	}
	return NewGovernanceService(s.govRepo).CreateLaunchReadinessScorecard(ctx, scorecard)
}

func (s *RecoveryService) CollectReleaseEvidence(ctx context.Context, evidence []ReleaseEvidenceRecord) ([]ReleaseEvidenceRecord, error) {
	if s == nil || s.releaseRepo == nil {
		return nil, nil
	}
	return NewReleaseReadinessService(s.releaseRepo).CollectReleaseEvidence(ctx, evidence)
}

func (s *RecoveryService) RunLaunchGateDrill(ctx context.Context, drill LaunchGateDrill) (LaunchGateDrill, error) {
	if s == nil || s.releaseRepo == nil {
		return LaunchGateDrill{}, nil
	}
	return NewReleaseReadinessService(s.releaseRepo).RunLaunchGateDrill(ctx, drill)
}

func (s *RecoveryService) CreateFinalReadinessScorecard(ctx context.Context, scorecard FinalReadinessScorecard) (FinalReadinessScorecard, error) {
	if s == nil || s.releaseRepo == nil {
		return FinalReadinessScorecard{}, nil
	}
	return NewReleaseReadinessService(s.releaseRepo).CreateFinalReadinessScorecard(ctx, scorecard)
}
