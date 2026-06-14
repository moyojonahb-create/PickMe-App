package wallet

import (
	"context"
	"errors"
	"testing"
	"time"
)

type fakePublicWalletPilotRepo struct {
	program           PublicWalletPilotProgram
	programSnapshot   PublicWalletPilotProgramSnapshot
	participant       PublicWalletPilotParticipant
	participantStatus string
	accessSnapshot    PublicWalletPilotAccessSnapshot
	transaction       PublicWalletPilotTransaction
	reconciliation    PublicWalletPilotReconciliationReport
	fraud             PublicWalletPilotFraudEvent
	killSwitch        PublicWalletPilotKillSwitch
	metrics           PublicWalletPilotMetrics
}

func (f *fakePublicWalletPilotRepo) CreatePublicWalletPilotProgram(ctx context.Context, program PublicWalletPilotProgram) (PublicWalletPilotProgram, error) {
	f.program = program
	return program, nil
}

func (f *fakePublicWalletPilotRepo) GetPublicWalletPilotProgramSnapshot(ctx context.Context, programID string) (PublicWalletPilotProgramSnapshot, error) {
	return f.programSnapshot, nil
}

func (f *fakePublicWalletPilotRepo) CreatePublicWalletPilotParticipant(ctx context.Context, participant PublicWalletPilotParticipant) (PublicWalletPilotParticipant, error) {
	f.participant = participant
	return participant, nil
}

func (f *fakePublicWalletPilotRepo) UpdatePublicWalletPilotParticipantStatus(ctx context.Context, participantID string, status string, actorID string) (PublicWalletPilotParticipant, error) {
	f.participantStatus = status
	return PublicWalletPilotParticipant{ID: participantID, Status: status, EnrolledBy: actorID}, nil
}

func (f *fakePublicWalletPilotRepo) GetPublicWalletPilotAccessSnapshot(ctx context.Context, programID string, userID string, participantType string, walletID string) (PublicWalletPilotAccessSnapshot, error) {
	return f.accessSnapshot, nil
}

func (f *fakePublicWalletPilotRepo) CreatePublicWalletPilotTransaction(ctx context.Context, transaction PublicWalletPilotTransaction) (PublicWalletPilotTransaction, error) {
	f.transaction = transaction
	return transaction, nil
}

func (f *fakePublicWalletPilotRepo) CreatePublicWalletPilotReconciliationReport(ctx context.Context, report PublicWalletPilotReconciliationReport) (PublicWalletPilotReconciliationReport, error) {
	f.reconciliation = report
	return report, nil
}

func (f *fakePublicWalletPilotRepo) CreatePublicWalletPilotFraudEvent(ctx context.Context, event PublicWalletPilotFraudEvent) (PublicWalletPilotFraudEvent, error) {
	f.fraud = event
	return event, nil
}

func (f *fakePublicWalletPilotRepo) CreatePublicWalletPilotKillSwitch(ctx context.Context, killSwitch PublicWalletPilotKillSwitch) (PublicWalletPilotKillSwitch, error) {
	f.killSwitch = killSwitch
	return killSwitch, nil
}

func (f *fakePublicWalletPilotRepo) AggregatePublicWalletPilotMetrics(ctx context.Context, programID string) (PublicWalletPilotMetrics, error) {
	f.metrics.ProgramID = programID
	return f.metrics, nil
}

func TestPublicWalletPilotProgramDefaults(t *testing.T) {
	now := time.Date(2026, 6, 8, 10, 0, 0, 0, time.UTC)
	repo := &fakePublicWalletPilotRepo{}
	service := NewPublicWalletPilotService(repo)
	service.now = func() time.Time { return now }

	program, err := service.CreatePilotProgram(context.Background(), PublicWalletPilotProgram{
		City:                     WalletPilotCityGwanda,
		AuthorizationExecutionID: "auth-exec-1",
	})
	if err != nil {
		t.Fatal(err)
	}
	if program.ParticipantLimit != 20 || program.DriverLimit != 10 || program.WalletBalanceLimitMinor != 5000 || program.DailyTransactionLimitMinor != 2000 || program.MonthlyTransactionLimitMinor != 20000 {
		t.Fatalf("unexpected Gwanda defaults: %+v", program)
	}
	if program.EndDate.Sub(program.StartDate) != 30*24*time.Hour {
		t.Fatalf("expected 30 day Gwanda duration, got %s", program.EndDate.Sub(program.StartDate))
	}
}

func TestPublicWalletPilotEnrollmentAndCohortEnforcement(t *testing.T) {
	repo := &fakePublicWalletPilotRepo{programSnapshot: PublicWalletPilotProgramSnapshot{
		ProgramID:        "program-1",
		Status:           WalletPilotProgramStatusActive,
		ParticipantLimit: 20,
		DriverLimit:      10,
		ActiveRiderCount: 19,
	}}
	service := NewPublicWalletPilotService(repo)

	participant, err := service.EnrollPilotParticipant(context.Background(), PublicWalletPilotParticipant{
		ProgramID:       "program-1",
		UserID:          "user-1",
		ParticipantType: WalletPilotParticipantTypeRider,
		EnrolledBy:      "admin-1",
	})
	if err != nil {
		t.Fatal(err)
	}
	if participant.Status != WalletPilotParticipantStatusActive {
		t.Fatalf("expected active enrollment, got %s", participant.Status)
	}

	repo.programSnapshot.ActiveRiderCount = 20
	if _, err := service.EnrollPilotParticipant(context.Background(), PublicWalletPilotParticipant{ProgramID: "program-1", UserID: "user-2", ParticipantType: WalletPilotParticipantTypeRider, EnrolledBy: "admin-1"}); err == nil {
		t.Fatal("expected rider cohort limit to block enrollment")
	}

	_, err = service.SuspendPilotParticipant(context.Background(), "participant-1", "ops-1")
	if err != nil {
		t.Fatal(err)
	}
	if repo.participantStatus != WalletPilotParticipantStatusSuspended {
		t.Fatalf("expected suspension, got %s", repo.participantStatus)
	}
}

func TestPublicWalletPilotAccessValidation(t *testing.T) {
	now := time.Date(2026, 6, 8, 10, 0, 0, 0, time.UTC)
	repo := &fakePublicWalletPilotRepo{accessSnapshot: PublicWalletPilotAccessSnapshot{
		ProgramID:                    "program-1",
		City:                         WalletPilotCityGwanda,
		ProgramStatus:                WalletPilotProgramStatusActive,
		ParticipantType:              WalletPilotParticipantTypeRider,
		ParticipantStatus:            WalletPilotParticipantStatusActive,
		StartDate:                    now.Add(-time.Hour),
		EndDate:                      now.Add(24 * time.Hour),
		ParticipantLimit:             20,
		DriverLimit:                  10,
		ActiveRiderCount:             10,
		ActiveDriverCount:            5,
		WalletBalanceLimitMinor:      5000,
		DailyTransactionLimitMinor:   2000,
		MonthlyTransactionLimitMinor: 20000,
	}}
	service := NewPublicWalletPilotService(repo)
	service.now = func() time.Time { return now }

	err := service.ValidateWalletPilotAccess(context.Background(), "program-1", "user-1", WalletPilotParticipantTypeRider, "wallet-1", WalletPilotCityGwanda, WalletPilotKillSwitchDisableDeposits)
	if err != nil {
		t.Fatal(err)
	}
	if err := service.ValidateWalletPilotAccess(context.Background(), "program-1", "user-1", WalletPilotParticipantTypeRider, "wallet-1", "Bulawayo", WalletPilotKillSwitchDisableDeposits); err == nil {
		t.Fatal("expected city mismatch to deny access")
	}
	repo.accessSnapshot.EndDate = now.Add(-time.Minute)
	if err := service.ValidateWalletPilotAccess(context.Background(), "program-1", "user-1", WalletPilotParticipantTypeRider, "wallet-1", WalletPilotCityGwanda, WalletPilotKillSwitchDisableDeposits); err == nil {
		t.Fatal("expected expired pilot to deny access")
	}
}

func TestPublicWalletPilotTransactionLimitsAndKillSwitch(t *testing.T) {
	now := time.Date(2026, 6, 8, 10, 0, 0, 0, time.UTC)
	base := PublicWalletPilotAccessSnapshot{
		ProgramID:                    "program-1",
		City:                         WalletPilotCityGwanda,
		ProgramStatus:                WalletPilotProgramStatusActive,
		ParticipantType:              WalletPilotParticipantTypeRider,
		ParticipantStatus:            WalletPilotParticipantStatusActive,
		StartDate:                    now.Add(-time.Hour),
		EndDate:                      now.Add(24 * time.Hour),
		ParticipantLimit:             20,
		DriverLimit:                  10,
		ActiveRiderCount:             10,
		ActiveDriverCount:            5,
		WalletBalanceLimitMinor:      5000,
		DailyTransactionLimitMinor:   2000,
		MonthlyTransactionLimitMinor: 20000,
		CurrentWalletBalanceMinor:    3000,
		DailyUsedMinor:               500,
		MonthlyUsedMinor:             1000,
	}
	repo := &fakePublicWalletPilotRepo{accessSnapshot: base}
	service := NewPublicWalletPilotService(repo)
	service.now = func() time.Time { return now }
	req := PublicWalletPilotTransactionRequest{ProgramID: "program-1", WalletID: "wallet-1", UserID: "user-1", ParticipantType: WalletPilotParticipantTypeRider, City: WalletPilotCityGwanda, TransactionType: WalletPilotTransactionTypeDeposit, AmountMinor: 1000, Currency: CurrencyUSD}

	if err := service.ValidateWalletTransactionLimits(context.Background(), req); err != nil {
		t.Fatal(err)
	}
	repo.accessSnapshot.DailyUsedMinor = 1500
	if err := service.ValidateWalletTransactionLimits(context.Background(), req); err == nil {
		t.Fatal("expected daily transaction limit denial")
	}
	repo.accessSnapshot = base
	repo.accessSnapshot.CurrentWalletBalanceMinor = 4500
	if err := service.ValidateWalletTransactionLimits(context.Background(), req); err == nil {
		t.Fatal("expected balance limit denial")
	}
	repo.accessSnapshot = base
	repo.accessSnapshot.KillSwitches = []string{WalletPilotKillSwitchDisableDeposits}
	if err := service.ValidateWalletTransactionLimits(context.Background(), req); err == nil {
		t.Fatal("expected kill switch denial")
	}
}

func TestPublicWalletPilotRuntimeEnforcerAccessAndCityControls(t *testing.T) {
	now := time.Date(2026, 6, 9, 10, 0, 0, 0, time.UTC)
	repo := &fakePublicWalletPilotRepo{accessSnapshot: PublicWalletPilotAccessSnapshot{
		ProgramID:                    "program-1",
		City:                         WalletPilotCityGwanda,
		ProgramStatus:                WalletPilotProgramStatusActive,
		ParticipantType:              WalletPilotParticipantTypeRider,
		ParticipantStatus:            WalletPilotParticipantStatusActive,
		StartDate:                    now.Add(-time.Hour),
		EndDate:                      now.Add(24 * time.Hour),
		ParticipantLimit:             20,
		DriverLimit:                  10,
		ActiveRiderCount:             10,
		ActiveDriverCount:            5,
		WalletBalanceLimitMinor:      5000,
		DailyTransactionLimitMinor:   2000,
		MonthlyTransactionLimitMinor: 20000,
	}}
	service := NewPublicWalletPilotService(repo)
	service.now = func() time.Time { return now }
	enforcer := NewPublicWalletPilotRuntimeEnforcer(service, PublicWalletPilotEnforcementConfig{Enabled: true, ProgramID: "program-1", City: WalletPilotCityGwanda})
	enforcer.now = func() time.Time { return now }

	err := enforcer.GuardWalletMutation(context.Background(), WalletPilotMutationRequest{
		Endpoint:        "/api/wallets/deposits",
		UserID:          "rider-1",
		ParticipantType: WalletPilotParticipantTypeRider,
		City:            WalletPilotCityGwanda,
		TransactionType: WalletPilotTransactionTypeDeposit,
		AmountMinor:     1000,
		Currency:        CurrencyUSD,
	})
	if err != nil {
		t.Fatal(err)
	}

	if err := enforcer.GuardWalletMutation(context.Background(), WalletPilotMutationRequest{Endpoint: "/api/wallets/deposits", UserID: "rider-1", ParticipantType: WalletPilotParticipantTypeRider, City: "Harare", TransactionType: WalletPilotTransactionTypeDeposit, AmountMinor: 1000, Currency: CurrencyUSD}); !errors.Is(err, ErrWalletPilotNotAuthorized) {
		t.Fatalf("expected non-authorized city denial, got %v", err)
	}

	repo.accessSnapshot.ParticipantStatus = WalletPilotParticipantStatusSuspended
	if err := enforcer.GuardWalletMutation(context.Background(), WalletPilotMutationRequest{Endpoint: "/api/wallets/deposits", UserID: "rider-1", ParticipantType: WalletPilotParticipantTypeRider, City: WalletPilotCityGwanda, TransactionType: WalletPilotTransactionTypeDeposit, AmountMinor: 1000, Currency: CurrencyUSD}); !errors.Is(err, ErrWalletPilotNotAuthorized) {
		t.Fatalf("expected non-cohort/suspended denial, got %v", err)
	}
}

func TestPublicWalletPilotRuntimeEnforcerBulawayoFollowsConfig(t *testing.T) {
	now := time.Date(2026, 6, 9, 10, 0, 0, 0, time.UTC)
	repo := &fakePublicWalletPilotRepo{accessSnapshot: PublicWalletPilotAccessSnapshot{
		ProgramID:                    "program-byo",
		City:                         WalletPilotCityBulawayo,
		ProgramStatus:                WalletPilotProgramStatusActive,
		ParticipantType:              WalletPilotParticipantTypeRider,
		ParticipantStatus:            WalletPilotParticipantStatusActive,
		StartDate:                    now.Add(-time.Hour),
		EndDate:                      now.Add(24 * time.Hour),
		ParticipantLimit:             250,
		DriverLimit:                  75,
		ActiveRiderCount:             25,
		ActiveDriverCount:            8,
		WalletBalanceLimitMinor:      10000,
		DailyTransactionLimitMinor:   5000,
		MonthlyTransactionLimitMinor: 50000,
	}}
	service := NewPublicWalletPilotService(repo)
	service.now = func() time.Time { return now }
	enforcer := NewPublicWalletPilotRuntimeEnforcer(service, PublicWalletPilotEnforcementConfig{Enabled: true, ProgramID: "program-byo", City: WalletPilotCityBulawayo})

	err := enforcer.GuardWalletMutation(context.Background(), WalletPilotMutationRequest{Endpoint: "/api/wallets/deposits", UserID: "rider-1", ParticipantType: WalletPilotParticipantTypeRider, City: WalletPilotCityBulawayo, TransactionType: WalletPilotTransactionTypeDeposit, AmountMinor: 2500, Currency: CurrencyUSD})
	if err != nil {
		t.Fatal(err)
	}
	if err := enforcer.GuardWalletMutation(context.Background(), WalletPilotMutationRequest{Endpoint: "/api/wallets/deposits", UserID: "rider-1", ParticipantType: WalletPilotParticipantTypeRider, City: WalletPilotCityGwanda, TransactionType: WalletPilotTransactionTypeDeposit, AmountMinor: 2500, Currency: CurrencyUSD}); !errors.Is(err, ErrWalletPilotNotAuthorized) {
		t.Fatalf("expected configured Bulawayo guard to reject Gwanda request, got %v", err)
	}
}

func TestPublicWalletPilotRuntimeEnforcerLimitsAndKillSwitch(t *testing.T) {
	now := time.Date(2026, 6, 9, 10, 0, 0, 0, time.UTC)
	base := PublicWalletPilotAccessSnapshot{
		ProgramID:                    "program-1",
		City:                         WalletPilotCityGwanda,
		ProgramStatus:                WalletPilotProgramStatusActive,
		ParticipantType:              WalletPilotParticipantTypeRider,
		ParticipantStatus:            WalletPilotParticipantStatusActive,
		StartDate:                    now.Add(-time.Hour),
		EndDate:                      now.Add(24 * time.Hour),
		ParticipantLimit:             20,
		DriverLimit:                  10,
		ActiveRiderCount:             10,
		ActiveDriverCount:            5,
		WalletBalanceLimitMinor:      5000,
		DailyTransactionLimitMinor:   2000,
		MonthlyTransactionLimitMinor: 20000,
		CurrentWalletBalanceMinor:    1000,
	}
	repo := &fakePublicWalletPilotRepo{accessSnapshot: base}
	service := NewPublicWalletPilotService(repo)
	service.now = func() time.Time { return now }
	enforcer := NewPublicWalletPilotRuntimeEnforcer(service, PublicWalletPilotEnforcementConfig{Enabled: true, ProgramID: "program-1", City: WalletPilotCityGwanda})
	req := WalletPilotMutationRequest{Endpoint: "/api/wallets/deposits", UserID: "rider-1", ParticipantType: WalletPilotParticipantTypeRider, City: WalletPilotCityGwanda, TransactionType: WalletPilotTransactionTypeDeposit, AmountMinor: 1000, Currency: CurrencyUSD}

	repo.accessSnapshot = base
	repo.accessSnapshot.DailyUsedMinor = 1500
	if err := enforcer.GuardWalletMutation(context.Background(), req); !errors.Is(err, ErrWalletPilotLimitExceeded) {
		t.Fatalf("expected daily limit denial, got %v", err)
	}
	repo.accessSnapshot = base
	repo.accessSnapshot.MonthlyUsedMinor = 19500
	if err := enforcer.GuardWalletMutation(context.Background(), req); !errors.Is(err, ErrWalletPilotLimitExceeded) {
		t.Fatalf("expected monthly limit denial, got %v", err)
	}
	repo.accessSnapshot = base
	repo.accessSnapshot.KillSwitches = []string{WalletPilotKillSwitchDisableDeposits}
	if err := enforcer.GuardWalletMutation(context.Background(), req); !errors.Is(err, ErrWalletPilotDisabled) {
		t.Fatalf("expected kill switch denial, got %v", err)
	}
}

func TestPublicWalletPilotRecordingReconciliationFraudAndEvidence(t *testing.T) {
	now := time.Date(2026, 6, 8, 10, 0, 0, 0, time.UTC)
	repo := &fakePublicWalletPilotRepo{
		accessSnapshot: PublicWalletPilotAccessSnapshot{
			ProgramID:                    "program-1",
			City:                         WalletPilotCityGwanda,
			ProgramStatus:                WalletPilotProgramStatusActive,
			ParticipantType:              WalletPilotParticipantTypeRider,
			ParticipantStatus:            WalletPilotParticipantStatusActive,
			StartDate:                    now.Add(-time.Hour),
			EndDate:                      now.Add(24 * time.Hour),
			ParticipantLimit:             20,
			DriverLimit:                  10,
			ActiveRiderCount:             10,
			ActiveDriverCount:            5,
			WalletBalanceLimitMinor:      5000,
			DailyTransactionLimitMinor:   2000,
			MonthlyTransactionLimitMinor: 20000,
		},
		metrics: PublicWalletPilotMetrics{
			City:                      WalletPilotCityGwanda,
			WalletSuccessRate:         100,
			LedgerAccuracy:            100,
			ParticipantComplianceRate: 99,
		},
	}
	service := NewPublicWalletPilotService(repo)
	service.now = func() time.Time { return now }

	tx, err := service.RecordPilotTransaction(context.Background(), PublicWalletPilotTransactionRequest{ProgramID: "program-1", WalletID: "wallet-1", UserID: "user-1", ParticipantType: WalletPilotParticipantTypeRider, City: WalletPilotCityGwanda, TransactionType: WalletPilotTransactionTypeDeposit, AmountMinor: 1000, Currency: CurrencyUSD})
	if err != nil {
		t.Fatal(err)
	}
	if tx.Status != WalletPilotTransactionStatusRecorded {
		t.Fatalf("expected recorded transaction, got %s", tx.Status)
	}

	report, err := service.GenerateReconciliationReport(context.Background(), PublicWalletPilotReconciliationReport{ProgramID: "program-1", ReportDate: now, LedgerBalanceMinor: 1000, WalletBalanceMinor: 900, TransactionHistoryBalanceMinor: 1000, Currency: CurrencyUSD})
	if err != nil {
		t.Fatal(err)
	}
	if report.Status != WalletPilotReconciliationVarianceDetected || report.VarianceMinor == 0 {
		t.Fatalf("expected variance report, got %+v", report)
	}

	fraud, err := service.CreateFraudEvent(context.Background(), PublicWalletPilotFraudEvent{ProgramID: "program-1", UserID: "user-1", EventType: WalletPilotFraudDuplicatePayments, Severity: WalletPilotFraudSeverityHigh, Description: "duplicate payment pattern"})
	if err != nil {
		t.Fatal(err)
	}
	if fraud.Status != WalletPilotFraudStatusOpen {
		t.Fatalf("expected open fraud event, got %s", fraud.Status)
	}

	evidence, err := service.GeneratePilotEvidencePackage(context.Background(), "program-1")
	if err != nil {
		t.Fatal(err)
	}
	if evidence["readiness_recommendation"] != "gwanda_wallet_pilot_success_criteria_met" {
		t.Fatalf("expected Gwanda success readiness, got %+v", evidence)
	}
	if evidence["public_launch_approved"].(bool) {
		t.Fatal("public launch must remain false")
	}
}
