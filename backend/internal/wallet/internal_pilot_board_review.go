package wallet

import (
	"context"
)

type InternalPilotBoardReviewRepository interface {
	CreateInternalPilotBoardReview(ctx context.Context, review InternalPilotBoardReview) (InternalPilotBoardReview, error)
	CreateInternalPilotReviewFinding(ctx context.Context, finding InternalPilotReviewFinding) (InternalPilotReviewFinding, error)
	CreateInternalPilotReadinessAssessment(ctx context.Context, assessment InternalPilotReadinessAssessment) (InternalPilotReadinessAssessment, error)
}

type InternalPilotBoardReviewService struct {
	repo InternalPilotBoardReviewRepository
}

func NewInternalPilotBoardReviewService(repo InternalPilotBoardReviewRepository) *InternalPilotBoardReviewService {
	return &InternalPilotBoardReviewService{repo: repo}
}

func (s *InternalPilotBoardReviewService) CreateBoardReview(ctx context.Context, review InternalPilotBoardReview) (InternalPilotBoardReview, error) {
	if s == nil || s.repo == nil {
		return InternalPilotBoardReview{}, nil
	}
	if review.AuthorizationExecutionID == "" || review.ReviewPeriodStart.IsZero() || review.ReviewPeriodEnd.IsZero() || !review.ReviewPeriodEnd.After(review.ReviewPeriodStart) {
		return InternalPilotBoardReview{}, ErrInvalidLedgerEntry
	}
	if review.ReviewStatus == "" {
		review.ReviewStatus = InternalPilotBoardReviewStatusPending
	}
	if !validInternalPilotBoardReviewStatus(review.ReviewStatus) {
		return InternalPilotBoardReview{}, ErrInvalidLedgerEntry
	}
	if review.Decision == "" {
		review.Decision = InternalPilotBoardDecisionDefer
	}
	if !validInternalPilotBoardDecision(review.Decision) {
		return InternalPilotBoardReview{}, ErrInvalidLedgerEntry
	}
	if review.DecisionReason == "" {
		review.DecisionReason = "board_review_pending"
	}
	return s.repo.CreateInternalPilotBoardReview(ctx, review)
}

func (s *InternalPilotBoardReviewService) CreateFinding(ctx context.Context, finding InternalPilotReviewFinding) (InternalPilotReviewFinding, error) {
	if s == nil || s.repo == nil {
		return InternalPilotReviewFinding{}, nil
	}
	if finding.BoardReviewID == "" || !validInternalPilotFindingCategory(finding.Category) || !validInternalPilotFindingSeverity(finding.Severity) || finding.Title == "" || finding.Recommendation == "" {
		return InternalPilotReviewFinding{}, ErrInvalidLedgerEntry
	}
	return s.repo.CreateInternalPilotReviewFinding(ctx, finding)
}

func (s *InternalPilotBoardReviewService) CreateReadinessAssessment(ctx context.Context, assessment InternalPilotReadinessAssessment) (InternalPilotReadinessAssessment, error) {
	if s == nil || s.repo == nil {
		return InternalPilotReadinessAssessment{}, nil
	}
	if assessment.BoardReviewID == "" || !validInternalPilotReadinessCategory(assessment.Category) || !validPercentScore(assessment.Score) || !validPercentScore(assessment.TargetScore) {
		return InternalPilotReadinessAssessment{}, ErrInvalidLedgerEntry
	}
	assessment.Passed = assessment.Score >= assessment.TargetScore
	return s.repo.CreateInternalPilotReadinessAssessment(ctx, assessment)
}

func (s *InternalPilotBoardReviewService) EvaluateOperationalReadiness(metrics InternalPilotEvidenceMetrics) InternalPilotReadinessAssessment {
	completionScore := percent(metrics.CompletedRides, metrics.TotalRides)
	cancellationScore := 100 - percent(metrics.CancelledRides, maxInt(metrics.TotalRides, 1))
	incidentScore := 100 - boundedPercent(metrics.Incidents, maxInt(metrics.TotalRides, 1))
	activityScore := percent(metrics.TotalParticipants, maxInt(metrics.ActiveParticipants, 1))

	score := averageScores(completionScore, cancellationScore, incidentScore, activityScore)
	return InternalPilotReadinessAssessment{
		Category:    InternalPilotReadinessCategoryOperational,
		Score:       score,
		TargetScore: 90,
		Passed:      score >= 90,
		Notes:       "generated_from_ride_completion_cancellation_incident_and_participant_activity_evidence",
	}
}

func (s *InternalPilotBoardReviewService) EvaluateFinancialReadiness(metrics InternalPilotEvidenceMetrics) InternalPilotReadinessAssessment {
	paymentTotal := metrics.WalletTransactions + metrics.CashTransactions
	paymentCoverage := percent(paymentTotal, maxInt(metrics.CompletedRides, 1))
	platformFeeCoverage := percent(metrics.PlatformFees, maxInt(metrics.CompletedRides, 1))
	driverEarningsCoverage := percent(metrics.DriverEarnings, maxInt(metrics.CompletedRides, 1))
	walletSuccess := percent(metrics.WalletTransactions, maxInt(metrics.WalletTransactions+metrics.AuthorizationFailed, 1))

	score := averageScores(paymentCoverage, platformFeeCoverage, driverEarningsCoverage, walletSuccess)
	return InternalPilotReadinessAssessment{
		Category:    InternalPilotReadinessCategoryFinancial,
		Score:       score,
		TargetScore: 90,
		Passed:      score >= 90,
		Notes:       "generated_from_payment_success_platform_fee_and_driver_earnings_evidence",
	}
}

func (s *InternalPilotBoardReviewService) EvaluateGovernanceReadiness(metrics InternalPilotEvidenceMetrics, objectives []InternalPilotObjectiveResult) InternalPilotReadinessAssessment {
	objectiveScore := 100
	if len(objectives) > 0 {
		achieved := 0
		for _, objective := range objectives {
			if objective.Achieved {
				achieved++
			}
		}
		objectiveScore = percent(achieved, len(objectives))
	}
	killSwitchScore := 100 - boundedPercent(metrics.KillSwitchActivations, maxInt(metrics.TotalEvents, 1))
	policyScore := 100 - boundedPercent(metrics.PolicyViolations, maxInt(metrics.TotalEvents, 1))

	score := averageScores(objectiveScore, killSwitchScore, policyScore)
	return InternalPilotReadinessAssessment{
		Category:    InternalPilotReadinessCategoryGovernance,
		Score:       score,
		TargetScore: 95,
		Passed:      score >= 95,
		Notes:       "generated_from_objective_achievement_kill_switch_and_policy_violation_evidence",
	}
}

func (s *InternalPilotBoardReviewService) EvaluateComplianceReadiness(metrics InternalPilotEvidenceMetrics) InternalPilotReadinessAssessment {
	authPassRate := percent(metrics.AuthorizationPassed, metrics.AuthorizationPassed+metrics.AuthorizationFailed)
	criticalIncidentScore := 100 - boundedPercent(metrics.CriticalIncidents, maxInt(metrics.Incidents, 1))
	policyScore := 100 - boundedPercent(metrics.PolicyViolations, maxInt(metrics.TotalEvents, 1))

	score := averageScores(authPassRate, criticalIncidentScore, policyScore)
	return InternalPilotReadinessAssessment{
		Category:    InternalPilotReadinessCategoryCompliance,
		Score:       score,
		TargetScore: 95,
		Passed:      score >= 95,
		Notes:       "generated_from_authorization_compliance_critical_incident_and_policy_evidence",
	}
}

func (s *InternalPilotBoardReviewService) GenerateBoardRecommendation(boardReviewID string, findings []InternalPilotReviewFinding, assessments []InternalPilotReadinessAssessment, objectives []InternalPilotObjectiveResult) InternalPilotBoardRecommendation {
	criticalFinding := false
	highFinding := false
	minorFinding := false
	financialOrComplianceHighRisk := false
	assessmentFailed := false
	severeAssessmentGap := false
	objectiveMissed := false

	for _, finding := range findings {
		switch finding.Severity {
		case InternalPilotIncidentSeverityCritical:
			criticalFinding = true
		case InternalPilotIncidentSeverityHigh:
			highFinding = true
			if finding.Category == InternalPilotFindingCategoryFinancial || finding.Category == InternalPilotFindingCategoryCompliance {
				financialOrComplianceHighRisk = true
			}
		case InternalPilotIncidentSeverityMedium, InternalPilotIncidentSeverityLow:
			minorFinding = true
		}
	}
	for _, assessment := range assessments {
		if !assessment.Passed {
			assessmentFailed = true
			if assessment.Score+10 < assessment.TargetScore {
				severeAssessmentGap = true
			}
		}
	}
	for _, objective := range objectives {
		if !objective.Achieved {
			objectiveMissed = true
		}
	}

	switch {
	case criticalFinding || financialOrComplianceHighRisk:
		return InternalPilotBoardRecommendation{
			BoardReviewID:        boardReviewID,
			Decision:             InternalPilotBoardDecisionRejected,
			DecisionReason:       "critical_or_financial_compliance_risk_blocks_public_pilot",
			EligibilityResult:    "public_pilot_blocked",
			PublicLaunchApproved: false,
		}
	case severeAssessmentGap || highFinding:
		return InternalPilotBoardRecommendation{
			BoardReviewID:                boardReviewID,
			Decision:                     InternalPilotBoardDecisionDefer,
			DecisionReason:               "significant_readiness_gap_requires_more_internal_evidence",
			EligibilityResult:            "remain_internal_pilot_more_evidence_required",
			PublicLaunchApproved:         false,
			RequiresMoreInternalEvidence: true,
			RequiresCorrectiveActions:    true,
		}
	case minorFinding || assessmentFailed || objectiveMissed:
		return InternalPilotBoardRecommendation{
			BoardReviewID:             boardReviewID,
			Decision:                  InternalPilotBoardDecisionConditional,
			DecisionReason:            "minor_findings_or_objective_gaps_require_corrective_actions",
			EligibilityResult:         "eligible_with_restrictions_for_v2_3_a_limited_public_wallet_pilot_review",
			PublicLaunchApproved:      false,
			LimitedPublicPilotReview:  true,
			RequiresCorrectiveActions: true,
		}
	default:
		return InternalPilotBoardRecommendation{
			BoardReviewID:            boardReviewID,
			Decision:                 InternalPilotBoardDecisionApproved,
			DecisionReason:           "pilot_evidence_meets_board_review_thresholds",
			EligibilityResult:        "eligible_for_v2_3_a_limited_public_wallet_pilot_review",
			PublicLaunchApproved:     false,
			LimitedPublicPilotReview: true,
		}
	}
}

func (s *InternalPilotBoardReviewService) GeneratePilotReviewSummary(boardReviewID string, findings []InternalPilotReviewFinding, assessments []InternalPilotReadinessAssessment, objectives []InternalPilotObjectiveResult) map[string]any {
	recommendation := s.GenerateBoardRecommendation(boardReviewID, findings, assessments, objectives)
	findingsBySeverity := map[string]int{
		InternalPilotIncidentSeverityLow:      0,
		InternalPilotIncidentSeverityMedium:   0,
		InternalPilotIncidentSeverityHigh:     0,
		InternalPilotIncidentSeverityCritical: 0,
	}
	readinessScores := map[string]int{}
	passedAssessments := 0
	achievedObjectives := 0
	for _, finding := range findings {
		findingsBySeverity[finding.Severity]++
	}
	for _, assessment := range assessments {
		readinessScores[assessment.Category] = assessment.Score
		if assessment.Passed {
			passedAssessments++
		}
	}
	for _, objective := range objectives {
		if objective.Achieved {
			achievedObjectives++
		}
	}
	return map[string]any{
		"board_review_id":             boardReviewID,
		"decision":                    recommendation.Decision,
		"decision_reason":             recommendation.DecisionReason,
		"eligibility_result":          recommendation.EligibilityResult,
		"readiness_scores":            readinessScores,
		"passed_assessments":          passedAssessments,
		"total_assessments":           len(assessments),
		"achieved_objectives":         achievedObjectives,
		"total_objectives":            len(objectives),
		"findings_by_severity":        findingsBySeverity,
		"limited_public_pilot_review": recommendation.LimitedPublicPilotReview,
		"public_launch_approved":      false,
	}
}

func validInternalPilotBoardReviewStatus(status string) bool {
	switch status {
	case InternalPilotBoardReviewStatusPending, InternalPilotBoardReviewStatusInReview, InternalPilotBoardReviewStatusCompleted:
		return true
	default:
		return false
	}
}

func validInternalPilotBoardDecision(decision string) bool {
	switch decision {
	case InternalPilotBoardDecisionApproved, InternalPilotBoardDecisionConditional, InternalPilotBoardDecisionRejected, InternalPilotBoardDecisionDefer:
		return true
	default:
		return false
	}
}

func validInternalPilotFindingCategory(category string) bool {
	switch category {
	case InternalPilotFindingCategoryOperations,
		InternalPilotFindingCategoryFinancial,
		InternalPilotFindingCategoryCompliance,
		InternalPilotFindingCategoryPlatform,
		InternalPilotFindingCategorySafety,
		InternalPilotFindingCategoryDispatch,
		InternalPilotFindingCategoryWallet,
		InternalPilotFindingCategoryGovernance:
		return true
	default:
		return false
	}
}

func validInternalPilotFindingSeverity(severity string) bool {
	switch severity {
	case InternalPilotIncidentSeverityLow, InternalPilotIncidentSeverityMedium, InternalPilotIncidentSeverityHigh, InternalPilotIncidentSeverityCritical:
		return true
	default:
		return false
	}
}

func validInternalPilotReadinessCategory(category string) bool {
	switch category {
	case InternalPilotReadinessCategoryOperational,
		InternalPilotReadinessCategoryFinancial,
		InternalPilotReadinessCategoryDispatch,
		InternalPilotReadinessCategoryWallet,
		InternalPilotReadinessCategoryGovernance,
		InternalPilotReadinessCategoryCompliance,
		InternalPilotReadinessCategoryScalability:
		return true
	default:
		return false
	}
}

func validPercentScore(score int) bool {
	return score >= 0 && score <= 100
}

func boundedPercent(part int, whole int) int {
	score := percent(part, whole)
	if score > 100 {
		return 100
	}
	return score
}

func averageScores(scores ...int) int {
	if len(scores) == 0 {
		return 0
	}
	total := 0
	for _, score := range scores {
		if score < 0 {
			score = 0
		}
		if score > 100 {
			score = 100
		}
		total += score
	}
	return total / len(scores)
}
