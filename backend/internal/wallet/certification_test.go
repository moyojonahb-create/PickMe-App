package wallet

import (
	"context"
	"testing"
	"time"
)

type fakeCertificationRepo struct {
	certifications int
	checks         int
	drills         int
	scorecards     int
}

func (f *fakeCertificationRepo) StartProviderCertification(ctx context.Context, cert ProviderCertification) (ProviderCertification, error) {
	f.certifications++
	cert.ID = "cert-1"
	return cert, nil
}

func (f *fakeCertificationRepo) RecordCertificationCheck(ctx context.Context, check ProviderCertificationCheck) (ProviderCertificationCheck, error) {
	f.checks++
	return check, nil
}

func (f *fakeCertificationRepo) RunRecoveryDrill(ctx context.Context, drill RecoveryDrill) (RecoveryDrill, error) {
	f.drills++
	drill.ID = "drill-1"
	return drill, nil
}

func (f *fakeCertificationRepo) RecordRecoveryScorecard(ctx context.Context, scorecard RecoveryScorecard) (RecoveryScorecard, error) {
	f.scorecards++
	scorecard.ID = "scorecard-1"
	return scorecard, nil
}

func TestCertificationServiceStartsProviderWorkflowWithChecks(t *testing.T) {
	repo := &fakeCertificationRepo{}
	service := NewCertificationService(repo)
	cert, err := service.StartProviderCertification(context.Background(), ProviderCard, "card_processor", "admin-1")
	if err != nil {
		t.Fatal(err)
	}
	if cert.ID != "cert-1" || repo.certifications != 1 {
		t.Fatalf("expected certification to be created, got %#v repo=%#v", cert, repo)
	}
	if repo.checks < len(defaultProviderCertificationChecks)+1 {
		t.Fatalf("expected card processor checks to be seeded, got %d", repo.checks)
	}
}

func TestCertificationServiceRunsDrillAndScores(t *testing.T) {
	repo := &fakeCertificationRepo{}
	service := NewCertificationService(repo)
	drill, err := service.RunRecoveryDrill(context.Background(), "provider_callback_failure", ProviderOneMoney, "admin-1")
	if err != nil {
		t.Fatal(err)
	}
	if drill.ID != "drill-1" || repo.drills != 1 {
		t.Fatalf("expected drill run, got %#v repo=%#v", drill, repo)
	}
	scorecard, err := service.RecordRecoveryScorecard(context.Background(), RecoveryScorecard{Provider: "internal", ScoreType: "overall", Score: 91, PeriodStart: time.Now().Add(-time.Hour), PeriodEnd: time.Now()})
	if err != nil {
		t.Fatal(err)
	}
	if scorecard.Status != "green" || repo.scorecards != 1 {
		t.Fatalf("expected green scorecard, got %#v repo=%#v", scorecard, repo)
	}
}
