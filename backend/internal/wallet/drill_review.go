package wallet

import "context"

type DrillReviewRepository interface {
	RecordDrillEvidence(ctx context.Context, evidence DrillEvidence) (DrillEvidence, error)
	ReviewDrillEvidence(ctx context.Context, review DrillEvidenceReview) (DrillEvidenceReview, error)
	CreateProductionException(ctx context.Context, exception ProductionException) (ProductionException, error)
	UpdateProductionExceptionStatus(ctx context.Context, exceptionID string, status string, adminID string, resolution string) (ProductionException, error)
	CreateReliabilityScorecard(ctx context.Context, scorecard ReliabilityScorecard) (ReliabilityScorecard, error)
}

type DrillReviewService struct {
	repo DrillReviewRepository
}

func NewDrillReviewService(repo DrillReviewRepository) *DrillReviewService {
	return &DrillReviewService{repo: repo}
}

func (s *DrillReviewService) RecordDrillEvidence(ctx context.Context, evidence DrillEvidence) (DrillEvidence, error) {
	if s == nil || s.repo == nil {
		return DrillEvidence{}, nil
	}
	if evidence.DrillType == "" || evidence.Status == "" || evidence.EvidenceRef == "" || evidence.SubmittedBy == "" {
		return DrillEvidence{}, ErrInvalidLedgerEntry
	}
	return s.repo.RecordDrillEvidence(ctx, evidence)
}

func (s *DrillReviewService) ReviewDrillEvidence(ctx context.Context, review DrillEvidenceReview) (DrillEvidenceReview, error) {
	if s == nil || s.repo == nil {
		return DrillEvidenceReview{}, nil
	}
	if review.EvidenceID == "" || review.ReviewerRole == "" || review.ReviewerID == "" || review.Status == "" {
		return DrillEvidenceReview{}, ErrInvalidLedgerEntry
	}
	if review.Status != DrillEvidenceReviewStatusPending && review.Status != DrillEvidenceReviewStatusApproved && review.Status != DrillEvidenceReviewStatusRejected {
		return DrillEvidenceReview{}, ErrInvalidLedgerEntry
	}
	return s.repo.ReviewDrillEvidence(ctx, review)
}

func (s *DrillReviewService) CreateProductionException(ctx context.Context, exception ProductionException) (ProductionException, error) {
	if s == nil || s.repo == nil {
		return ProductionException{}, nil
	}
	if exception.Severity == "" || exception.OwnerID == "" || exception.RemediationPlan == "" {
		return ProductionException{}, ErrInvalidLedgerEntry
	}
	if exception.Status == "" {
		exception.Status = ProductionExceptionStatusOpen
	}
	return s.repo.CreateProductionException(ctx, exception)
}

func (s *DrillReviewService) UpdateProductionExceptionStatus(ctx context.Context, exceptionID string, status string, adminID string, resolution string) (ProductionException, error) {
	if s == nil || s.repo == nil {
		return ProductionException{}, nil
	}
	if exceptionID == "" || status == "" || adminID == "" {
		return ProductionException{}, ErrInvalidLedgerEntry
	}
	return s.repo.UpdateProductionExceptionStatus(ctx, exceptionID, status, adminID, resolution)
}

func (s *DrillReviewService) CreateReliabilityScorecard(ctx context.Context, scorecard ReliabilityScorecard) (ReliabilityScorecard, error) {
	if s == nil || s.repo == nil {
		return ReliabilityScorecard{}, nil
	}
	if scorecard.ScorecardType == "" || scorecard.CreatedBy == "" {
		return ReliabilityScorecard{}, ErrInvalidLedgerEntry
	}
	scores := []int{
		scorecard.SettlementReliabilityScore,
		scorecard.ProviderReliabilityScore,
		scorecard.ReconciliationReliabilityScore,
		scorecard.GovernanceReliabilityScore,
		scorecard.LaunchReadinessReliabilityScore,
	}
	total := 0
	for _, score := range scores {
		if score < 0 || score > 100 {
			return ReliabilityScorecard{}, ErrInvalidLedgerEntry
		}
		total += score
	}
	scorecard.OverallScore = total / len(scores)
	if scorecard.AuthorizationOutcome == "" {
		scorecard.AuthorizationOutcome = pilotAuthorizationOutcome(scorecard.OverallScore)
	}
	return s.repo.CreateReliabilityScorecard(ctx, scorecard)
}

func pilotAuthorizationOutcome(score int) string {
	switch {
	case score >= 95:
		return PilotAuthorizationOutcomePublic
	case score >= 90:
		return PilotAuthorizationOutcomeControlled
	case score >= 80:
		return PilotAuthorizationOutcomeInternal
	default:
		return InternalLaunchOutcomeNotReady
	}
}
