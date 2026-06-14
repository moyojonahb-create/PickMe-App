package wallet

import (
	"context"
	"fmt"
)

var defaultProviderCertificationChecks = []string{
	"signature_verification",
	"callback_replay_window",
	"duplicate_callback",
	"tampered_amount",
	"tampered_reference",
	"delayed_callback",
	"statement_reconciliation",
}

type CertificationRepository interface {
	StartProviderCertification(ctx context.Context, cert ProviderCertification) (ProviderCertification, error)
	RecordCertificationCheck(ctx context.Context, check ProviderCertificationCheck) (ProviderCertificationCheck, error)
	RunRecoveryDrill(ctx context.Context, drill RecoveryDrill) (RecoveryDrill, error)
	RecordRecoveryScorecard(ctx context.Context, scorecard RecoveryScorecard) (RecoveryScorecard, error)
}

type CertificationService struct {
	repo CertificationRepository
}

func NewCertificationService(repo CertificationRepository) *CertificationService {
	return &CertificationService{repo: repo}
}

func (s *CertificationService) StartProviderCertification(ctx context.Context, provider string, certificationType string, adminID string) (ProviderCertification, error) {
	if s == nil || s.repo == nil {
		return ProviderCertification{}, nil
	}
	if provider == "" || certificationType == "" {
		return ProviderCertification{}, ErrInvalidPaymentMethod
	}
	cert, err := s.repo.StartProviderCertification(ctx, ProviderCertification{
		Provider:          provider,
		CertificationType: certificationType,
		Status:            CertificationStatusRunning,
		CertifiedBy:       adminID,
	})
	if err != nil {
		return ProviderCertification{}, err
	}
	for _, checkType := range certificationChecksForType(certificationType) {
		_, err := s.repo.RecordCertificationCheck(ctx, ProviderCertificationCheck{
			CertificationID: cert.ID,
			Provider:        provider,
			CheckType:       checkType,
			Status:          CertificationCheckStatusPending,
		})
		if err != nil {
			return ProviderCertification{}, err
		}
	}
	return cert, nil
}

func (s *CertificationService) RunRecoveryDrill(ctx context.Context, drillType string, provider string, adminID string) (RecoveryDrill, error) {
	if s == nil || s.repo == nil {
		return RecoveryDrill{}, nil
	}
	if drillType == "" {
		return RecoveryDrill{}, ErrInvalidLedgerEntry
	}
	return s.repo.RunRecoveryDrill(ctx, RecoveryDrill{
		DrillType:   drillType,
		Provider:    provider,
		Status:      RecoveryDrillStatusRunning,
		TriggeredBy: adminID,
	})
}

func (s *CertificationService) RecordRecoveryScorecard(ctx context.Context, scorecard RecoveryScorecard) (RecoveryScorecard, error) {
	if s == nil || s.repo == nil {
		return RecoveryScorecard{}, nil
	}
	if scorecard.ScoreType == "" || scorecard.Score < 0 || scorecard.Score > 100 {
		return RecoveryScorecard{}, ErrInvalidLedgerEntry
	}
	if scorecard.Status == "" {
		scorecard.Status = scorecardStatus(scorecard.Score)
	}
	return s.repo.RecordRecoveryScorecard(ctx, scorecard)
}

func certificationChecksForType(certificationType string) []string {
	checks := append([]string{}, defaultProviderCertificationChecks...)
	if certificationType == "card_processor" {
		checks = append(checks, "processor_authorize_capture")
	}
	if certificationType == "mobile_money" || certificationType == "paypal" {
		checks = append(checks, "status_polling")
	}
	return checks
}

func scorecardStatus(score int) string {
	switch {
	case score >= 90:
		return "green"
	case score >= 70:
		return "yellow"
	default:
		return "red"
	}
}

func certificationTypeForProvider(provider string) string {
	switch provider {
	case ProviderOneMoney, ProviderEcoCash, ProviderInnbucks:
		return "mobile_money"
	case ProviderCard:
		return "card_processor"
	case ProviderPayPal:
		return "paypal"
	default:
		return fmt.Sprintf("%s_certification", provider)
	}
}
