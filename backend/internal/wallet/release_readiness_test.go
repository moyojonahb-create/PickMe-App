package wallet

import (
	"context"
	"testing"
)

type fakeReleaseReadinessRepo struct {
	evidence  []ReleaseEvidenceRecord
	drill     LaunchGateDrill
	scorecard FinalReadinessScorecard
}

func (f *fakeReleaseReadinessRepo) CollectReleaseEvidence(ctx context.Context, evidence []ReleaseEvidenceRecord) ([]ReleaseEvidenceRecord, error) {
	f.evidence = append(f.evidence, evidence...)
	return evidence, nil
}

func (f *fakeReleaseReadinessRepo) RunLaunchGateDrill(ctx context.Context, drill LaunchGateDrill) (LaunchGateDrill, error) {
	f.drill = drill
	return drill, nil
}

func (f *fakeReleaseReadinessRepo) CreateFinalReadinessScorecard(ctx context.Context, scorecard FinalReadinessScorecard) (FinalReadinessScorecard, error) {
	f.scorecard = scorecard
	return scorecard, nil
}

func TestReleaseReadinessCollectsEvidence(t *testing.T) {
	repo := &fakeReleaseReadinessRepo{}
	service := NewReleaseReadinessService(repo)

	_, err := service.CollectReleaseEvidence(context.Background(), []ReleaseEvidenceRecord{{
		Category:     "architecture",
		Component:    "wallet_ledger",
		EvidenceType: "schema_check",
		CollectedBy:  "admin-1",
	}})
	if err != nil {
		t.Fatal(err)
	}
	if len(repo.evidence) != 1 || repo.evidence[0].Status != ReleaseEvidenceStatusPresent {
		t.Fatalf("expected present evidence, got %#v", repo.evidence)
	}
}

func TestLaunchGateDrillRequiresAllBlockingControlsAndNoMutation(t *testing.T) {
	repo := &fakeReleaseReadinessRepo{}
	service := NewReleaseReadinessService(repo)

	drill, err := service.RunLaunchGateDrill(context.Background(), LaunchGateDrill{
		DrillType:               "production_launch",
		SimulatedGateType:       "production_launch",
		MissingApprovalBlocked:  true,
		LowScoreBlocked:         true,
		CertificationBlocked:    true,
		ReconciliationBlocked:   true,
		AllRequirementsApproved: true,
		NoActivationMutation:    true,
		TriggeredBy:             "admin-1",
	})
	if err != nil {
		t.Fatal(err)
	}
	if drill.Status != LaunchGateDrillStatusPassed {
		t.Fatalf("expected passed drill, got %s", drill.Status)
	}

	failed, err := service.RunLaunchGateDrill(context.Background(), LaunchGateDrill{
		DrillType:         "provider_activation",
		SimulatedGateType: "provider_activation",
		TriggeredBy:       "admin-1",
	})
	if err != nil {
		t.Fatal(err)
	}
	if failed.Status != LaunchGateDrillStatusFailed {
		t.Fatalf("expected failed drill when controls are missing, got %s", failed.Status)
	}
}

func TestFinalReadinessScorecardCalculatesOverallAndRecommendation(t *testing.T) {
	repo := &fakeReleaseReadinessRepo{}
	service := NewReleaseReadinessService(repo)

	scorecard, err := service.CreateFinalReadinessScorecard(context.Background(), FinalReadinessScorecard{
		ArchitectureScore:      92,
		ReliabilityScore:       91,
		SecurityScore:          90,
		FinanceScore:           92,
		GovernanceScore:        93,
		OperationsScore:        91,
		ProviderReadinessScore: 90,
		LaunchReadinessScore:   90,
		CreatedBy:              "admin-1",
	})
	if err != nil {
		t.Fatal(err)
	}
	if scorecard.OverallScore != 91 || scorecard.Status != "green" {
		t.Fatalf("unexpected scorecard: %#v", scorecard)
	}
	if scorecard.LaunchRecommendation != "approved_for_controlled_internal_launch_drill_only" {
		t.Fatalf("unexpected recommendation %s", scorecard.LaunchRecommendation)
	}

	blocked, err := service.CreateFinalReadinessScorecard(context.Background(), FinalReadinessScorecard{
		ArchitectureScore:      90,
		ReliabilityScore:       90,
		SecurityScore:          90,
		FinanceScore:           90,
		GovernanceScore:        90,
		OperationsScore:        90,
		ProviderReadinessScore: 89,
		LaunchReadinessScore:   90,
		Blockers:               "provider certification incomplete",
		CreatedBy:              "admin-1",
	})
	if err != nil {
		t.Fatal(err)
	}
	if blocked.LaunchRecommendation != "not_approved_for_public_launch" {
		t.Fatalf("expected public launch to remain blocked, got %s", blocked.LaunchRecommendation)
	}
}
