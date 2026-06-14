package wallet

import (
	"context"
	"testing"
)

type fakeDrillReviewRepo struct {
	evidence  DrillEvidence
	review    DrillEvidenceReview
	exception ProductionException
	scorecard ReliabilityScorecard
}

func (f *fakeDrillReviewRepo) RecordDrillEvidence(ctx context.Context, evidence DrillEvidence) (DrillEvidence, error) {
	f.evidence = evidence
	return evidence, nil
}

func (f *fakeDrillReviewRepo) ReviewDrillEvidence(ctx context.Context, review DrillEvidenceReview) (DrillEvidenceReview, error) {
	f.review = review
	return review, nil
}

func (f *fakeDrillReviewRepo) CreateProductionException(ctx context.Context, exception ProductionException) (ProductionException, error) {
	f.exception = exception
	return exception, nil
}

func (f *fakeDrillReviewRepo) UpdateProductionExceptionStatus(ctx context.Context, exceptionID string, status string, adminID string, resolution string) (ProductionException, error) {
	return ProductionException{ID: exceptionID, Status: status, ClosedBy: adminID}, nil
}

func (f *fakeDrillReviewRepo) CreateReliabilityScorecard(ctx context.Context, scorecard ReliabilityScorecard) (ReliabilityScorecard, error) {
	f.scorecard = scorecard
	return scorecard, nil
}

func TestDrillReviewRecordsEvidenceAndIndependentReview(t *testing.T) {
	repo := &fakeDrillReviewRepo{}
	service := NewDrillReviewService(repo)

	_, err := service.RecordDrillEvidence(context.Background(), DrillEvidence{DrillType: "settlement", Status: "passed", EvidenceRef: "drill-1", SubmittedBy: "admin-1"})
	if err != nil {
		t.Fatal(err)
	}
	_, err = service.ReviewDrillEvidence(context.Background(), DrillEvidenceReview{EvidenceID: "evidence-1", ReviewerRole: "finance", ReviewerID: "admin-2", Status: DrillEvidenceReviewStatusApproved})
	if err != nil {
		t.Fatal(err)
	}
	if repo.evidence.DrillType != "settlement" || repo.review.Status != DrillEvidenceReviewStatusApproved {
		t.Fatalf("unexpected evidence/review state: %#v %#v", repo.evidence, repo.review)
	}
}

func TestProductionExceptionDefaultsOpenAndCloses(t *testing.T) {
	repo := &fakeDrillReviewRepo{}
	service := NewDrillReviewService(repo)

	exception, err := service.CreateProductionException(context.Background(), ProductionException{Severity: "high", OwnerID: "admin-1", RemediationPlan: "close provider mismatch"})
	if err != nil {
		t.Fatal(err)
	}
	if exception.Status != ProductionExceptionStatusOpen {
		t.Fatalf("expected open exception, got %#v", exception)
	}
	closed, err := service.UpdateProductionExceptionStatus(context.Background(), "exception-1", ProductionExceptionStatusClosed, "admin-2", "verified")
	if err != nil {
		t.Fatal(err)
	}
	if closed.Status != ProductionExceptionStatusClosed {
		t.Fatalf("expected closed exception, got %#v", closed)
	}
}

func TestReliabilityScorecardCalculatesPilotAuthorization(t *testing.T) {
	repo := &fakeDrillReviewRepo{}
	service := NewDrillReviewService(repo)

	scorecard, err := service.CreateReliabilityScorecard(context.Background(), ReliabilityScorecard{
		ScorecardType:                   "overall",
		SettlementReliabilityScore:      85,
		ProviderReliabilityScore:        82,
		ReconciliationReliabilityScore:  84,
		GovernanceReliabilityScore:      86,
		LaunchReadinessReliabilityScore: 83,
		CreatedBy:                       "admin-1",
	})
	if err != nil {
		t.Fatal(err)
	}
	if scorecard.OverallScore != 84 || scorecard.AuthorizationOutcome != PilotAuthorizationOutcomeInternal {
		t.Fatalf("unexpected reliability scorecard: %#v", scorecard)
	}
}
