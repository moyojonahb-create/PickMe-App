package wallet

import (
	"context"
	"strings"
)

type ReleaseReadinessRepository interface {
	CollectReleaseEvidence(ctx context.Context, evidence []ReleaseEvidenceRecord) ([]ReleaseEvidenceRecord, error)
	RunLaunchGateDrill(ctx context.Context, drill LaunchGateDrill) (LaunchGateDrill, error)
	CreateFinalReadinessScorecard(ctx context.Context, scorecard FinalReadinessScorecard) (FinalReadinessScorecard, error)
}

type ReleaseReadinessService struct {
	repo ReleaseReadinessRepository
}

func NewReleaseReadinessService(repo ReleaseReadinessRepository) *ReleaseReadinessService {
	return &ReleaseReadinessService{repo: repo}
}

func (s *ReleaseReadinessService) CollectReleaseEvidence(ctx context.Context, evidence []ReleaseEvidenceRecord) ([]ReleaseEvidenceRecord, error) {
	if s == nil || s.repo == nil {
		return nil, nil
	}
	if len(evidence) == 0 {
		return nil, ErrInvalidLedgerEntry
	}
	for i := range evidence {
		if evidence[i].Category == "" || evidence[i].Component == "" || evidence[i].EvidenceType == "" || evidence[i].CollectedBy == "" {
			return nil, ErrInvalidLedgerEntry
		}
		if evidence[i].Status == "" {
			evidence[i].Status = ReleaseEvidenceStatusPresent
		}
		if evidence[i].Status != ReleaseEvidenceStatusPresent && evidence[i].Status != ReleaseEvidenceStatusMissing && evidence[i].Status != ReleaseEvidenceStatusWarning {
			return nil, ErrInvalidLedgerEntry
		}
	}
	return s.repo.CollectReleaseEvidence(ctx, evidence)
}

func (s *ReleaseReadinessService) RunLaunchGateDrill(ctx context.Context, drill LaunchGateDrill) (LaunchGateDrill, error) {
	if s == nil || s.repo == nil {
		return LaunchGateDrill{}, nil
	}
	if drill.DrillType == "" || drill.SimulatedGateType == "" || drill.TriggeredBy == "" {
		return LaunchGateDrill{}, ErrInvalidLedgerEntry
	}
	if drill.Status == "" {
		drill.Status = launchGateDrillStatus(drill)
	}
	if drill.Status == LaunchGateDrillStatusPassed && !drill.NoActivationMutation {
		return LaunchGateDrill{}, ErrInvalidLedgerEntry
	}
	return s.repo.RunLaunchGateDrill(ctx, drill)
}

func (s *ReleaseReadinessService) CreateFinalReadinessScorecard(ctx context.Context, scorecard FinalReadinessScorecard) (FinalReadinessScorecard, error) {
	if s == nil || s.repo == nil {
		return FinalReadinessScorecard{}, nil
	}
	if scorecard.CreatedBy == "" {
		return FinalReadinessScorecard{}, ErrInvalidLedgerEntry
	}
	scores := []int{
		scorecard.ArchitectureScore,
		scorecard.ReliabilityScore,
		scorecard.SecurityScore,
		scorecard.FinanceScore,
		scorecard.GovernanceScore,
		scorecard.OperationsScore,
		scorecard.ProviderReadinessScore,
		scorecard.LaunchReadinessScore,
	}
	total := 0
	for _, score := range scores {
		if score < 0 || score > 100 {
			return FinalReadinessScorecard{}, ErrInvalidLedgerEntry
		}
		total += score
	}
	scorecard.OverallScore = total / len(scores)
	if scorecard.Status == "" {
		scorecard.Status = scorecardStatus(scorecard.OverallScore)
	}
	if scorecard.LaunchRecommendation == "" {
		scorecard.LaunchRecommendation = launchRecommendation(scorecard)
	}
	return s.repo.CreateFinalReadinessScorecard(ctx, scorecard)
}

func launchGateDrillStatus(drill LaunchGateDrill) string {
	if drill.MissingApprovalBlocked &&
		drill.LowScoreBlocked &&
		drill.CertificationBlocked &&
		drill.ReconciliationBlocked &&
		drill.AllRequirementsApproved &&
		drill.NoActivationMutation {
		return LaunchGateDrillStatusPassed
	}
	return LaunchGateDrillStatusFailed
}

func launchRecommendation(scorecard FinalReadinessScorecard) string {
	if scorecard.OverallScore >= 90 &&
		scorecard.ProviderReadinessScore >= 90 &&
		scorecard.LaunchReadinessScore >= 90 &&
		strings.TrimSpace(scorecard.Blockers) == "" {
		return "approved_for_controlled_internal_launch_drill_only"
	}
	return "not_approved_for_public_launch"
}
