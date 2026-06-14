package wallet

import (
	"context"
	"testing"
	"time"
)

type fakeInternalPilotBoardReviewRepo struct {
	review     InternalPilotBoardReview
	finding    InternalPilotReviewFinding
	assessment InternalPilotReadinessAssessment
}

func (f *fakeInternalPilotBoardReviewRepo) CreateInternalPilotBoardReview(ctx context.Context, review InternalPilotBoardReview) (InternalPilotBoardReview, error) {
	f.review = review
	return review, nil
}

func (f *fakeInternalPilotBoardReviewRepo) CreateInternalPilotReviewFinding(ctx context.Context, finding InternalPilotReviewFinding) (InternalPilotReviewFinding, error) {
	f.finding = finding
	return finding, nil
}

func (f *fakeInternalPilotBoardReviewRepo) CreateInternalPilotReadinessAssessment(ctx context.Context, assessment InternalPilotReadinessAssessment) (InternalPilotReadinessAssessment, error) {
	f.assessment = assessment
	return assessment, nil
}

func TestInternalPilotBoardReviewCreationDefaults(t *testing.T) {
	repo := &fakeInternalPilotBoardReviewRepo{}
	service := NewInternalPilotBoardReviewService(repo)

	start := time.Now().Add(-24 * time.Hour)
	review, err := service.CreateBoardReview(context.Background(), InternalPilotBoardReview{
		AuthorizationExecutionID: "auth-exec-1",
		ReviewPeriodStart:        start,
		ReviewPeriodEnd:          start.Add(24 * time.Hour),
	})
	if err != nil {
		t.Fatal(err)
	}
	if review.ReviewStatus != InternalPilotBoardReviewStatusPending {
		t.Fatalf("expected pending review status, got %s", review.ReviewStatus)
	}
	if review.Decision != InternalPilotBoardDecisionDefer {
		t.Fatalf("expected defer decision, got %s", review.Decision)
	}
	if repo.review.AuthorizationExecutionID != "auth-exec-1" {
		t.Fatal("expected review to be persisted")
	}
}

func TestInternalPilotBoardFindingsAndAssessments(t *testing.T) {
	repo := &fakeInternalPilotBoardReviewRepo{}
	service := NewInternalPilotBoardReviewService(repo)

	finding, err := service.CreateFinding(context.Background(), InternalPilotReviewFinding{
		BoardReviewID:  "review-1",
		Category:       InternalPilotFindingCategoryDispatch,
		Severity:       InternalPilotIncidentSeverityMedium,
		Title:          "driver acceptance below target",
		Recommendation: "continue internal dispatch monitoring",
	})
	if err != nil {
		t.Fatal(err)
	}
	if finding.Category != InternalPilotFindingCategoryDispatch {
		t.Fatalf("unexpected finding category %s", finding.Category)
	}

	assessment, err := service.CreateReadinessAssessment(context.Background(), InternalPilotReadinessAssessment{
		BoardReviewID: "review-1",
		Category:      InternalPilotReadinessCategoryOperational,
		Score:         96,
		TargetScore:   95,
	})
	if err != nil {
		t.Fatal(err)
	}
	if !assessment.Passed {
		t.Fatal("expected assessment to pass when score meets target")
	}
}

func TestInternalPilotBoardReadinessScoreGeneration(t *testing.T) {
	service := NewInternalPilotBoardReviewService(nil)
	metrics := InternalPilotEvidenceMetrics{
		TotalEvents:           100,
		TotalParticipants:     20,
		ActiveParticipants:    20,
		TotalRides:            50,
		CompletedRides:        48,
		CancelledRides:        2,
		WalletTransactions:    20,
		CashTransactions:      28,
		PlatformFees:          48,
		DriverEarnings:        48,
		Incidents:             1,
		CriticalIncidents:     0,
		KillSwitchActivations: 0,
		AuthorizationPassed:   98,
		AuthorizationFailed:   2,
		PolicyViolations:      0,
	}

	operational := service.EvaluateOperationalReadiness(metrics)
	financial := service.EvaluateFinancialReadiness(metrics)
	governance := service.EvaluateGovernanceReadiness(metrics, []InternalPilotObjectiveResult{{Achieved: true}})
	compliance := service.EvaluateComplianceReadiness(metrics)

	if operational.Score < 90 || !operational.Passed {
		t.Fatalf("expected operational readiness to pass, got %+v", operational)
	}
	if financial.Score < 90 || !financial.Passed {
		t.Fatalf("expected financial readiness to pass, got %+v", financial)
	}
	if governance.Score < 95 || !governance.Passed {
		t.Fatalf("expected governance readiness to pass, got %+v", governance)
	}
	if compliance.Score < 95 || !compliance.Passed {
		t.Fatalf("expected compliance readiness to pass, got %+v", compliance)
	}
}

func TestInternalPilotBoardRecommendationPaths(t *testing.T) {
	service := NewInternalPilotBoardReviewService(nil)
	passing := []InternalPilotReadinessAssessment{
		{Category: InternalPilotReadinessCategoryOperational, Score: 96, TargetScore: 90, Passed: true},
		{Category: InternalPilotReadinessCategoryFinancial, Score: 95, TargetScore: 90, Passed: true},
	}
	objectives := []InternalPilotObjectiveResult{{ObjectiveName: "ride_completion", Achieved: true}}

	approved := service.GenerateBoardRecommendation("review-1", nil, passing, objectives)
	if approved.Decision != InternalPilotBoardDecisionApproved || !approved.LimitedPublicPilotReview || approved.PublicLaunchApproved {
		t.Fatalf("expected approved limited-public-pilot-review eligibility, got %+v", approved)
	}

	conditional := service.GenerateBoardRecommendation("review-1", []InternalPilotReviewFinding{{
		Category: InternalPilotFindingCategoryOperations,
		Severity: InternalPilotIncidentSeverityLow,
		Title:    "minor operations finding",
	}}, passing, objectives)
	if conditional.Decision != InternalPilotBoardDecisionConditional {
		t.Fatalf("expected conditional approval, got %+v", conditional)
	}

	deferDecision := service.GenerateBoardRecommendation("review-1", []InternalPilotReviewFinding{{
		Category: InternalPilotFindingCategoryDispatch,
		Severity: InternalPilotIncidentSeverityHigh,
		Title:    "dispatch gap",
	}}, passing, objectives)
	if deferDecision.Decision != InternalPilotBoardDecisionDefer {
		t.Fatalf("expected defer, got %+v", deferDecision)
	}

	rejected := service.GenerateBoardRecommendation("review-1", []InternalPilotReviewFinding{{
		Category: InternalPilotFindingCategoryCompliance,
		Severity: InternalPilotIncidentSeverityCritical,
		Title:    "compliance breach",
	}}, passing, objectives)
	if rejected.Decision != InternalPilotBoardDecisionRejected || rejected.PublicLaunchApproved {
		t.Fatalf("expected rejected public-pilot block, got %+v", rejected)
	}
}
