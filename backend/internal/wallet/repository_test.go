package wallet

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

type fakeDB struct {
	execs []string
	args  [][]any
}

func (f *fakeDB) Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error) {
	f.execs = append(f.execs, sql)
	f.args = append(f.args, args)
	return pgconn.NewCommandTag("INSERT 1"), nil
}

func (f *fakeDB) Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error) {
	return nil, pgx.ErrNoRows
}

func (f *fakeDB) QueryRow(ctx context.Context, sql string, args ...any) pgx.Row {
	return fakeRow{err: pgx.ErrNoRows}
}

type fakeRow struct {
	err error
}

func (r fakeRow) Scan(dest ...any) error {
	return r.err
}

func TestRepositoryCreateAccount(t *testing.T) {
	db := &fakeDB{}
	repo := NewPostgresRepository(db)
	err := repo.CreateAccount(context.Background(), Account{
		ID:          "account-1",
		OwnerUserID: "user-1",
		OwnerRole:   OwnerRoleRider,
		AccountType: AccountTypeRiderWallet,
		Currency:    CurrencyUSD,
		Status:      AccountStatusActive,
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(db.execs) != 1 || !strings.Contains(db.execs[0], "INSERT INTO public.wallet_accounts") {
		t.Fatalf("expected wallet account insert, got %#v", db.execs)
	}
}

func TestRepositoryPostLedgerEntriesValidatesAndPersists(t *testing.T) {
	db := &fakeDB{}
	repo := NewPostgresRepository(db)
	err := repo.PostLedgerEntries(context.Background(), testTransaction(), testEntries())
	if err != nil {
		t.Fatal(err)
	}
	if len(db.execs) != 3 {
		t.Fatalf("expected transaction insert plus two ledger entries, got %d", len(db.execs))
	}
	if !strings.Contains(db.execs[0], "INSERT INTO public.wallet_transactions") {
		t.Fatalf("expected transaction insert first, got %s", db.execs[0])
	}
	if !strings.Contains(db.execs[1], "INSERT INTO public.wallet_ledger_entries") ||
		!strings.Contains(db.execs[2], "INSERT INTO public.wallet_ledger_entries") {
		t.Fatalf("expected ledger entry inserts, got %#v", db.execs)
	}
}

func TestRepositoryRejectsUnbalancedLedgerEntries(t *testing.T) {
	db := &fakeDB{}
	repo := NewPostgresRepository(db)
	entries := testEntries()
	entries[1].AmountMinor = 500
	err := repo.PostLedgerEntries(context.Background(), testTransaction(), entries)
	if err == nil {
		t.Fatal("expected unbalanced transaction rejection")
	}
	if len(db.execs) != 0 {
		t.Fatalf("repository should not write invalid ledger entries, got %#v", db.execs)
	}
}

func TestRepositoryCreateReconciliationRun(t *testing.T) {
	db := &fakeDB{}
	repo := NewPostgresRepository(db)
	err := repo.CreateReconciliationRun(context.Background(), ReconciliationRun{
		ID:      "run-1",
		RunType: "ledger_balance",
		Status:  "pending",
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(db.execs) != 1 || !strings.Contains(db.execs[0], "INSERT INTO public.reconciliation_runs") {
		t.Fatalf("expected reconciliation insert, got %#v", db.execs)
	}
}

func TestRepositoryCreateFinancialJob(t *testing.T) {
	db := &fakeDB{}
	repo := NewPostgresRepository(db)
	err := repo.CreateFinancialJob(context.Background(), FinancialJob{
		JobType:        FinancialJobTypeWalletCapture,
		SourceType:     "ride",
		SourceID:       "ride-1",
		Provider:       "internal",
		IdempotencyKey: "wallet-capture-job-ride-1",
		Metadata:       `{"ride_id":"ride-1"}`,
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(db.execs) != 1 || !strings.Contains(db.execs[0], "INSERT INTO public.financial_jobs") || !strings.Contains(db.execs[0], "ON CONFLICT (idempotency_key) DO NOTHING") {
		t.Fatalf("expected idempotent financial job insert, got %#v", db.execs)
	}
}

func TestRepositoryRecordFinancialMetric(t *testing.T) {
	db := &fakeDB{}
	repo := NewPostgresRepository(db)
	err := repo.RecordFinancialMetric(context.Background(), FinancialMetric{
		MetricType:    FinancialMetricFailedCapture,
		Provider:      "internal",
		ReferenceType: "ride",
		ReferenceID:   "ride-1",
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(db.execs) != 1 || !strings.Contains(db.execs[0], "INSERT INTO public.financial_metrics") {
		t.Fatalf("expected financial metric insert, got %#v", db.execs)
	}
}

func TestRepositoryCreateRefundIntentEnqueuesRecoveryJob(t *testing.T) {
	db := &fakeDB{}
	repo := NewPostgresRepository(db)
	_, err := repo.CreateRefundIntent(context.Background(), RefundIntent{
		Provider:       ProviderOneMoney,
		UserID:         "00000000-0000-0000-0000-000000000010",
		AmountMinor:    1000,
		Currency:       CurrencyUSD,
		Reason:         "duplicate payment",
		IdempotencyKey: "refund-key-1",
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(db.execs) < 2 || !strings.Contains(db.execs[0], "INSERT INTO public.refund_intents") || !strings.Contains(db.execs[1], "INSERT INTO public.financial_jobs") {
		t.Fatalf("expected refund intent and recovery job inserts, got %#v", db.execs)
	}
}

func TestRepositoryImportProviderStatementEnqueuesReconciliationJob(t *testing.T) {
	db := &fakeDB{}
	repo := NewPostgresRepository(db)
	_, err := repo.ImportProviderStatement(context.Background(), ProviderStatementImportRequest{
		Provider:           ProviderOneMoney,
		StatementReference: "stmt-1",
		Lines: []ProviderStatementLine{{
			LineReference:     "line-1",
			ProviderReference: "OM-1",
			LineType:          "deposit",
			AmountMinor:       1000,
			Currency:          CurrencyUSD,
			Status:            "posted",
		}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(db.execs) < 3 || !strings.Contains(db.execs[0], "INSERT INTO public.provider_statement_imports") || !strings.Contains(db.execs[1], "INSERT INTO public.provider_statement_lines") || !strings.Contains(db.execs[2], "INSERT INTO public.financial_jobs") {
		t.Fatalf("expected statement import, line, and reconciliation job inserts, got %#v", db.execs)
	}
}

func TestRepositoryRunProviderStatementReconciliationWritesRun(t *testing.T) {
	db := &fakeDB{}
	repo := NewPostgresRepository(db)
	_, err := repo.RunProviderStatementReconciliation(context.Background(), "statement-1", ProviderOneMoney)
	if err != nil {
		t.Fatal(err)
	}
	if len(db.execs) < 3 || !strings.Contains(db.execs[0], "UPDATE public.provider_statement_lines") || !strings.Contains(db.execs[1], "INSERT INTO public.reconciliation_runs") {
		t.Fatalf("expected statement matching and reconciliation run writes, got %#v", db.execs)
	}
}

func TestRepositoryStartProviderCertificationEnqueuesJob(t *testing.T) {
	db := &fakeDB{}
	repo := NewPostgresRepository(db)
	_, err := repo.StartProviderCertification(context.Background(), ProviderCertification{
		Provider:          ProviderOneMoney,
		CertificationType: "mobile_money",
		Status:            CertificationStatusRunning,
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(db.execs) < 2 || !strings.Contains(db.execs[0], "INSERT INTO public.provider_certifications") || !strings.Contains(db.execs[1], "INSERT INTO public.financial_jobs") {
		t.Fatalf("expected certification and financial job inserts, got %#v", db.execs)
	}
}

func TestRepositoryRunRecoveryDrillEnqueuesJobAndEvent(t *testing.T) {
	db := &fakeDB{}
	repo := NewPostgresRepository(db)
	_, err := repo.RunRecoveryDrill(context.Background(), RecoveryDrill{
		DrillType: "settlement_failure",
		Provider:  "internal",
		Status:    RecoveryDrillStatusRunning,
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(db.execs) < 3 || !strings.Contains(db.execs[0], "INSERT INTO public.recovery_drills") || !strings.Contains(db.execs[1], "INSERT INTO public.recovery_drill_events") || !strings.Contains(db.execs[2], "INSERT INTO public.financial_jobs") {
		t.Fatalf("expected recovery drill, event, and financial job inserts, got %#v", db.execs)
	}
}

func TestRepositoryCreateFinanceApprovalRequestEnqueuesDualApprovalJob(t *testing.T) {
	db := &fakeDB{}
	repo := NewPostgresRepository(db)
	_, err := repo.CreateFinanceApprovalRequest(context.Background(), FinanceApprovalRequest{ApprovalType: "finance", TargetType: "launch_gate", TargetID: "gate-1", RequestedBy: "00000000-0000-0000-0000-000000000010", RequiredApprovalCount: 2})
	if err != nil {
		t.Fatal(err)
	}
	if len(db.execs) < 2 || !strings.Contains(db.execs[0], "INSERT INTO public.finance_approval_requests") || !strings.Contains(db.execs[1], "INSERT INTO public.financial_jobs") {
		t.Fatalf("expected finance approval request and dual approval job inserts, got %#v", db.execs)
	}
}

func TestRepositoryCreateLaunchGateEnqueuesReviewJob(t *testing.T) {
	db := &fakeDB{}
	repo := NewPostgresRepository(db)
	_, err := repo.CreateLaunchGate(context.Background(), LaunchGate{GateKey: "public-payments", GateType: "public_payment_activation", CreatedBy: "00000000-0000-0000-0000-000000000010"})
	if err != nil {
		t.Fatal(err)
	}
	if len(db.execs) < 3 || !strings.Contains(db.execs[0], "INSERT INTO public.launch_gates") || !strings.Contains(db.execs[1], "INSERT INTO public.financial_jobs") || !strings.Contains(db.execs[2], "INSERT INTO public.financial_metrics") {
		t.Fatalf("expected launch gate, review job, and metric writes, got %#v", db.execs)
	}
}

func TestRepositoryCreateFinanceCloseRunEnqueuesCloseJob(t *testing.T) {
	db := &fakeDB{}
	repo := NewPostgresRepository(db)
	_, err := repo.CreateFinanceCloseRun(context.Background(), FinanceCloseRun{CloseType: "daily", PeriodStart: time.Now().Add(-24 * time.Hour), PeriodEnd: time.Now(), OpenedBy: "00000000-0000-0000-0000-000000000010"})
	if err != nil {
		t.Fatal(err)
	}
	if len(db.execs) < 2 || !strings.Contains(db.execs[0], "INSERT INTO public.finance_close_runs") || !strings.Contains(db.execs[1], "INSERT INTO public.financial_jobs") {
		t.Fatalf("expected finance close and job writes, got %#v", db.execs)
	}
}

func TestRepositoryCreateFinanceSignoffAndLaunchReadiness(t *testing.T) {
	db := &fakeDB{}
	repo := NewPostgresRepository(db)
	_, err := repo.CreateFinanceSignoff(context.Background(), FinanceSignoff{SignoffType: "finance", TargetType: "finance_close", TargetID: "close-1", Status: "signed", SignerID: "00000000-0000-0000-0000-000000000010"})
	if err != nil {
		t.Fatal(err)
	}
	_, err = repo.CreateLaunchReadinessScorecard(context.Background(), LaunchReadinessScorecard{Score: 70, Status: "yellow", CreatedBy: "00000000-0000-0000-0000-000000000010"})
	if err != nil {
		t.Fatal(err)
	}
	if len(db.execs) != 2 || !strings.Contains(db.execs[0], "INSERT INTO public.finance_signoffs") || !strings.Contains(db.execs[1], "INSERT INTO public.launch_readiness_scorecards") {
		t.Fatalf("expected signoff and readiness writes, got %#v", db.execs)
	}
}

func TestRepositoryCollectReleaseEvidenceEnqueuesReviewJob(t *testing.T) {
	db := &fakeDB{}
	repo := NewPostgresRepository(db)
	_, err := repo.CollectReleaseEvidence(context.Background(), []ReleaseEvidenceRecord{{
		Category:     "architecture",
		Component:    "wallet_ledger",
		Status:       ReleaseEvidenceStatusPresent,
		EvidenceType: "schema",
		CollectedBy:  "00000000-0000-0000-0000-000000000010",
	}})
	if err != nil {
		t.Fatal(err)
	}
	if len(db.execs) < 2 || !strings.Contains(db.execs[0], "INSERT INTO public.release_readiness_evidence") || !strings.Contains(db.execs[1], "INSERT INTO public.financial_jobs") {
		t.Fatalf("expected evidence and review job writes, got %#v", db.execs)
	}
}

func TestRepositoryRunLaunchGateDrillEnqueuesJobAndMetricOnFailure(t *testing.T) {
	db := &fakeDB{}
	repo := NewPostgresRepository(db)
	_, err := repo.RunLaunchGateDrill(context.Background(), LaunchGateDrill{
		DrillType:         "production_launch",
		Status:            LaunchGateDrillStatusFailed,
		SimulatedGateType: "production_launch",
		TriggeredBy:       "00000000-0000-0000-0000-000000000010",
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(db.execs) < 3 || !strings.Contains(db.execs[0], "INSERT INTO public.launch_gate_drills") || !strings.Contains(db.execs[1], "INSERT INTO public.financial_metrics") || !strings.Contains(db.execs[2], "INSERT INTO public.financial_jobs") {
		t.Fatalf("expected drill, failure metric, and job writes, got %#v", db.execs)
	}
}

func TestRepositoryCreateFinalReadinessScorecardRecordsMetric(t *testing.T) {
	db := &fakeDB{}
	repo := NewPostgresRepository(db)
	_, err := repo.CreateFinalReadinessScorecard(context.Background(), FinalReadinessScorecard{
		ArchitectureScore:      80,
		ReliabilityScore:       80,
		SecurityScore:          80,
		FinanceScore:           80,
		GovernanceScore:        80,
		OperationsScore:        80,
		ProviderReadinessScore: 80,
		LaunchReadinessScore:   80,
		OverallScore:           80,
		Status:                 "yellow",
		LaunchRecommendation:   "not_approved_for_public_launch",
		CreatedBy:              "00000000-0000-0000-0000-000000000010",
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(db.execs) < 2 || !strings.Contains(db.execs[0], "INSERT INTO public.final_readiness_scorecards") || !strings.Contains(db.execs[1], "INSERT INTO public.financial_metrics") {
		t.Fatalf("expected final readiness scorecard and metric writes, got %#v", db.execs)
	}
}

func TestRepositoryGenerateExecutiveSignoffPacketEnqueuesJob(t *testing.T) {
	db := &fakeDB{}
	repo := NewPostgresRepository(db)
	_, err := repo.GenerateExecutiveSignoffPacket(context.Background(), ExecutiveSignoffPacket{PacketType: "executive_release", Status: ExecutiveApprovalStatusPending, GeneratedBy: "00000000-0000-0000-0000-000000000010"})
	if err != nil {
		t.Fatal(err)
	}
	if len(db.execs) < 2 || !strings.Contains(db.execs[0], "INSERT INTO public.executive_signoff_packets") || !strings.Contains(db.execs[1], "INSERT INTO public.financial_jobs") {
		t.Fatalf("expected executive packet and job writes, got %#v", db.execs)
	}
}

func TestRepositoryRecordExecutiveApprovalUpdatesPacket(t *testing.T) {
	db := &fakeDB{}
	repo := NewPostgresRepository(db)
	_, err := repo.RecordExecutiveApproval(context.Background(), ExecutiveApprovalRecord{PacketID: "00000000-0000-0000-0000-000000000010", ApproverRole: "finance", ApproverID: "00000000-0000-0000-0000-000000000011", Status: ExecutiveApprovalStatusApproved})
	if err != nil {
		t.Fatal(err)
	}
	if len(db.execs) < 2 || !strings.Contains(db.execs[0], "INSERT INTO public.executive_approval_records") || !strings.Contains(db.execs[1], "UPDATE public.executive_signoff_packets") {
		t.Fatalf("expected approval insert and packet update, got %#v", db.execs)
	}
}

func TestRepositoryCreateLaunchBlockerRecordsMetric(t *testing.T) {
	db := &fakeDB{}
	repo := NewPostgresRepository(db)
	_, err := repo.CreateLaunchBlocker(context.Background(), LaunchBlocker{Title: "provider certification incomplete", Severity: "critical", Status: LaunchBlockerStatusOpen, OwnerID: "00000000-0000-0000-0000-000000000010"})
	if err != nil {
		t.Fatal(err)
	}
	if len(db.execs) < 2 || !strings.Contains(db.execs[0], "INSERT INTO public.launch_blockers") || !strings.Contains(db.execs[1], "INSERT INTO public.financial_metrics") {
		t.Fatalf("expected launch blocker and metric writes, got %#v", db.execs)
	}
}

func TestRepositoryRecordInternalLaunchDecisionEnqueuesJob(t *testing.T) {
	db := &fakeDB{}
	repo := NewPostgresRepository(db)
	_, err := repo.RecordInternalLaunchDecision(context.Background(), InternalLaunchDecision{Outcome: InternalLaunchOutcomeControlledReady, ProviderActivationSimulated: true, WalletActivationSimulated: true, WithdrawalActivationSimulated: true, PublicPaymentActivationSimulated: true, OverallReadinessScore: 91, DecidedBy: "00000000-0000-0000-0000-000000000010"})
	if err != nil {
		t.Fatal(err)
	}
	if len(db.execs) < 2 || !strings.Contains(db.execs[0], "INSERT INTO public.internal_launch_decisions") || !strings.Contains(db.execs[1], "INSERT INTO public.financial_jobs") {
		t.Fatalf("expected internal launch decision and job writes, got %#v", db.execs)
	}
}

func TestRepositoryRecordDrillEvidenceEnqueuesReviewJob(t *testing.T) {
	db := &fakeDB{}
	repo := NewPostgresRepository(db)
	_, err := repo.RecordDrillEvidence(context.Background(), DrillEvidence{DrillType: "settlement", Status: "passed", EvidenceRef: "drill-1", SubmittedBy: "00000000-0000-0000-0000-000000000010"})
	if err != nil {
		t.Fatal(err)
	}
	if len(db.execs) < 2 || !strings.Contains(db.execs[0], "INSERT INTO public.live_drill_evidence") || !strings.Contains(db.execs[1], "INSERT INTO public.financial_jobs") {
		t.Fatalf("expected drill evidence and review job writes, got %#v", db.execs)
	}
}

func TestRepositoryReviewDrillEvidenceWritesIndependentReview(t *testing.T) {
	db := &fakeDB{}
	repo := NewPostgresRepository(db)
	_, err := repo.ReviewDrillEvidence(context.Background(), DrillEvidenceReview{EvidenceID: "00000000-0000-0000-0000-000000000010", ReviewerRole: "finance", ReviewerID: "00000000-0000-0000-0000-000000000011", Status: DrillEvidenceReviewStatusApproved})
	if err != nil {
		t.Fatal(err)
	}
	if len(db.execs) != 1 || !strings.Contains(db.execs[0], "INSERT INTO public.drill_evidence_reviews") {
		t.Fatalf("expected drill evidence review write, got %#v", db.execs)
	}
}

func TestRepositoryCreateProductionExceptionRecordsMetricAndClosureJob(t *testing.T) {
	db := &fakeDB{}
	repo := NewPostgresRepository(db)
	_, err := repo.CreateProductionException(context.Background(), ProductionException{Severity: "critical", OwnerID: "00000000-0000-0000-0000-000000000010", Status: ProductionExceptionStatusOpen, RemediationPlan: "fix mismatch"})
	if err != nil {
		t.Fatal(err)
	}
	_, err = repo.UpdateProductionExceptionStatus(context.Background(), "00000000-0000-0000-0000-000000000012", ProductionExceptionStatusClosed, "00000000-0000-0000-0000-000000000011", "verified")
	if err != nil {
		t.Fatal(err)
	}
	if len(db.execs) < 4 || !strings.Contains(db.execs[0], "INSERT INTO public.production_exceptions") || !strings.Contains(db.execs[1], "INSERT INTO public.financial_metrics") || !strings.Contains(db.execs[2], "UPDATE public.production_exceptions") || !strings.Contains(db.execs[3], "INSERT INTO public.financial_jobs") {
		t.Fatalf("expected exception, metric, update, and closure job writes, got %#v", db.execs)
	}
}

func TestRepositoryCreateReliabilityScorecardWritesScorecard(t *testing.T) {
	db := &fakeDB{}
	repo := NewPostgresRepository(db)
	_, err := repo.CreateReliabilityScorecard(context.Background(), ReliabilityScorecard{ScorecardType: "overall", SettlementReliabilityScore: 80, ProviderReliabilityScore: 80, ReconciliationReliabilityScore: 80, GovernanceReliabilityScore: 80, LaunchReadinessReliabilityScore: 80, OverallScore: 80, AuthorizationOutcome: PilotAuthorizationOutcomeInternal, CreatedBy: "00000000-0000-0000-0000-000000000010"})
	if err != nil {
		t.Fatal(err)
	}
	if len(db.execs) != 1 || !strings.Contains(db.execs[0], "INSERT INTO public.reliability_scorecards") {
		t.Fatalf("expected reliability scorecard write, got %#v", db.execs)
	}
}

func TestRepositoryCreateControlRoomSnapshotWritesSnapshot(t *testing.T) {
	db := &fakeDB{}
	repo := NewPostgresRepository(db)
	_, err := repo.CreateControlRoomSnapshot(context.Background(), ControlRoomSnapshot{SettlementHealth: "green", ProviderHealth: "green", ReconciliationHealth: "green", AuthorizationHealth: "green", LaunchReadinessHealth: "yellow", CreatedBy: "00000000-0000-0000-0000-000000000010"})
	if err != nil {
		t.Fatal(err)
	}
	if len(db.execs) != 1 || !strings.Contains(db.execs[0], "INSERT INTO public.control_room_snapshots") {
		t.Fatalf("expected control room snapshot write, got %#v", db.execs)
	}
}

func TestRepositoryCreateDailyFinanceCloseEnqueuesJobAndReviewUpdatesClose(t *testing.T) {
	db := &fakeDB{}
	repo := NewPostgresRepository(db)
	_, err := repo.CreateDailyFinanceClose(context.Background(), DailyFinanceClose{CloseDate: time.Now(), Status: DailyCloseStatusOpen, ReconciliationStatus: "completed", OpenedBy: "00000000-0000-0000-0000-000000000010"})
	if err != nil {
		t.Fatal(err)
	}
	_, err = repo.ReviewDailyClose(context.Background(), DailyCloseReview{CloseID: "00000000-0000-0000-0000-000000000011", ReviewRole: "finance", ReviewerID: "00000000-0000-0000-0000-000000000012", Status: "approved"})
	if err != nil {
		t.Fatal(err)
	}
	if len(db.execs) < 4 || !strings.Contains(db.execs[0], "INSERT INTO public.daily_finance_closes") || !strings.Contains(db.execs[1], "INSERT INTO public.financial_jobs") || !strings.Contains(db.execs[2], "INSERT INTO public.daily_close_reviews") || !strings.Contains(db.execs[3], "UPDATE public.daily_finance_closes") {
		t.Fatalf("expected daily close, job, review, and update writes, got %#v", db.execs)
	}
}

func TestRepositoryCreateDailyReliabilityMetricsAndPilotMonitoring(t *testing.T) {
	db := &fakeDB{}
	repo := NewPostgresRepository(db)
	_, err := repo.CreateDailyReliabilityMetrics(context.Background(), DailyReliabilityMetrics{MetricDate: time.Now(), SettlementSuccessRate: 99, ProviderCallbackSuccessRate: 98, ReconciliationSuccessRate: 97, RefundSuccessRate: 96, DisputeResolutionRate: 95, CreatedBy: "00000000-0000-0000-0000-000000000010"})
	if err != nil {
		t.Fatal(err)
	}
	_, err = repo.CreatePilotMonitoringSnapshot(context.Background(), PilotMonitoringSnapshot{PilotUsers: 1, PilotTransactions: 2, PilotDeposits: 1, PilotWithdrawals: 0, PilotFailures: 0, CreatedBy: "00000000-0000-0000-0000-000000000010"})
	if err != nil {
		t.Fatal(err)
	}
	if len(db.execs) != 2 || !strings.Contains(db.execs[0], "INSERT INTO public.daily_reliability_metrics") || !strings.Contains(db.execs[1], "INSERT INTO public.pilot_monitoring_snapshots") {
		t.Fatalf("expected reliability metrics and pilot monitoring writes, got %#v", db.execs)
	}
}

func TestRepositoryInternalPilotRunbookEnqueuesJob(t *testing.T) {
	db := &fakeDB{}
	repo := NewPostgresRepository(db)
	_, err := repo.CreateInternalPilotRunbook(context.Background(), InternalPilotRunbook{RunbookType: "settlement_incident", Title: "Settlement", Status: "active", OwnerID: "00000000-0000-0000-0000-000000000010", Steps: "[]"})
	if err != nil {
		t.Fatal(err)
	}
	if len(db.execs) < 2 || !strings.Contains(db.execs[0], "INSERT INTO public.internal_pilot_runbooks") || !strings.Contains(db.execs[1], "INSERT INTO public.financial_jobs") {
		t.Fatalf("expected runbook and job writes, got %#v", db.execs)
	}
}

func TestRepositoryDay1CloseSimulationEscalationTimelineAndCriteria(t *testing.T) {
	db := &fakeDB{}
	repo := NewPostgresRepository(db)
	_, err := repo.CreateDay1CloseSimulation(context.Background(), Day1CloseSimulation{Status: DailyCloseStatusSignedOff, OpeningBalanceValidated: true, SimulatedBy: "00000000-0000-0000-0000-000000000010"})
	if err != nil {
		t.Fatal(err)
	}
	_, err = repo.CreateIncidentEscalation(context.Background(), IncidentEscalation{IncidentType: "settlement", Level: IncidentEscalationCritical, Status: IncidentStatusOpened, OwnerID: "00000000-0000-0000-0000-000000000010"})
	if err != nil {
		t.Fatal(err)
	}
	_, err = repo.CreatePilotTimelineEvent(context.Background(), PilotOperationsTimelineEvent{EventType: PilotTimelineEventStart, ActorID: "00000000-0000-0000-0000-000000000010"})
	if err != nil {
		t.Fatal(err)
	}
	_, err = repo.EvaluateInternalPilotSuccess(context.Background(), InternalPilotSuccessCriteria{SettlementSuccess: true, ReconciliationSuccess: true, ProviderSuccess: true, ReliabilityScore: 90, Outcome: PilotAuthorizationOutcomeControlled, EvaluatedBy: "00000000-0000-0000-0000-000000000010"})
	if err != nil {
		t.Fatal(err)
	}
	if len(db.execs) != 4 || !strings.Contains(db.execs[0], "INSERT INTO public.day1_close_simulations") || !strings.Contains(db.execs[1], "INSERT INTO public.incident_escalations") || !strings.Contains(db.execs[2], "INSERT INTO public.pilot_operations_timeline") || !strings.Contains(db.execs[3], "INSERT INTO public.internal_pilot_success_criteria") {
		t.Fatalf("expected day1/escalation/timeline/criteria writes, got %#v", db.execs)
	}
}

func TestRepositoryPilotAuthorizationScopeAndSuccessDefinitions(t *testing.T) {
	db := &fakeDB{}
	repo := NewPostgresRepository(db)
	_, err := repo.CreatePilotAuthorization(context.Background(), PilotAuthorization{Decision: GoNoGoDecisionConditionalGo, DecisionReason: "pending provider readiness", Approvers: "{}", CreatedBy: "00000000-0000-0000-0000-000000000010"})
	if err != nil {
		t.Fatal(err)
	}
	_, err = repo.CreatePilotScopeDefinition(context.Background(), PilotScopeDefinition{PilotUsers: 4, PilotDrivers: 2, PilotRiders: 2, PilotTransactions: 10, PilotDurationDays: 7, DefinedBy: "00000000-0000-0000-0000-000000000010"})
	if err != nil {
		t.Fatal(err)
	}
	_, err = repo.CreatePilotSuccessDefinition(context.Background(), PilotSuccessDefinition{SettlementReliabilityTarget: 95, ReconciliationReliabilityTarget: 95, ProviderReliabilityTarget: 90, DisputeResolutionTarget: 90, IncidentResponseTarget: 90, DefinedBy: "00000000-0000-0000-0000-000000000010"})
	if err != nil {
		t.Fatal(err)
	}
	if len(db.execs) != 3 || !strings.Contains(db.execs[0], "INSERT INTO public.pilot_authorizations") || !strings.Contains(db.execs[1], "INSERT INTO public.pilot_scope_definitions") || !strings.Contains(db.execs[2], "INSERT INTO public.pilot_success_definitions") {
		t.Fatalf("expected pilot authorization, scope, and success definition writes, got %#v", db.execs)
	}
}

func TestRepositoryInternalPilotAuthorizationExecutionAndAudit(t *testing.T) {
	db := &fakeDB{}
	repo := NewPostgresRepository(db)
	_, err := repo.CreateInternalPilotAuthorizationExecution(context.Background(), InternalPilotAuthorizationExecution{
		Status:                  InternalPilotAuthorizationActive,
		Decision:                InternalPilotApprovalConditional,
		DecisionReason:          "conditional approval",
		ReadinessScoreThreshold: 90,
		ReadinessScore:          95,
		PilotDurationDays:       7,
		CreatedBy:               "00000000-0000-0000-0000-000000000010",
	})
	if err != nil {
		t.Fatal(err)
	}
	_, err = repo.RecordInternalPilotAuthorizationAudit(context.Background(), InternalPilotAuthorizationAudit{
		AuthorizationExecutionID: "00000000-0000-0000-0000-000000000011",
		ApproverID:               "00000000-0000-0000-0000-000000000010",
		Decision:                 InternalPilotApprovalConditional,
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(db.execs) < 3 || !strings.Contains(db.execs[0], "INSERT INTO public.internal_pilot_authorization_executions") || !strings.Contains(db.execs[1], "INSERT INTO public.financial_jobs") || !strings.Contains(db.execs[2], "INSERT INTO public.internal_pilot_authorization_audits") {
		t.Fatalf("expected internal pilot authorization execution, job, and audit writes, got %#v", db.execs)
	}
}

func TestRepositoryInternalPilotLiveOpsPersistence(t *testing.T) {
	db := &fakeDB{}
	repo := NewPostgresRepository(db)
	_, err := repo.CreateInternalPilotParticipant(context.Background(), InternalPilotParticipant{AuthorizationExecutionID: "00000000-0000-0000-0000-000000000011", UserID: "00000000-0000-0000-0000-000000000012", Role: InternalPilotParticipantRoleRider, Status: InternalPilotParticipantActive, EnrolledBy: "00000000-0000-0000-0000-000000000010"})
	if err != nil {
		t.Fatal(err)
	}
	err = repo.CreateInternalPilotParticipantEvent(context.Background(), InternalPilotParticipantEvent{ParticipantID: "00000000-0000-0000-0000-000000000013", AuthorizationExecutionID: "00000000-0000-0000-0000-000000000011", UserID: "00000000-0000-0000-0000-000000000012", Role: InternalPilotParticipantRoleRider, NewStatus: InternalPilotParticipantActive, Action: "enrolled", ActorID: "00000000-0000-0000-0000-000000000010"})
	if err != nil {
		t.Fatal(err)
	}
	_, err = repo.CreateInternalPilotHealthReport(context.Background(), InternalPilotHealthReport{AuthorizationExecutionID: "00000000-0000-0000-0000-000000000011", ReportDate: time.Now(), AuthorizationStatus: InternalPilotAuthorizationActive, CreatedBy: "00000000-0000-0000-0000-000000000010"})
	if err != nil {
		t.Fatal(err)
	}
	_, err = repo.CreateInternalPilotIncident(context.Background(), InternalPilotIncident{AuthorizationExecutionID: "00000000-0000-0000-0000-000000000011", IncidentType: "duplicate_offer_generation", Severity: InternalPilotIncidentSeverityHigh, Status: InternalPilotIncidentStatusOpen, Title: "duplicate offers", OpenedBy: "00000000-0000-0000-0000-000000000010"})
	if err != nil {
		t.Fatal(err)
	}
	_, err = repo.UpsertInternalPilotKillSwitch(context.Background(), InternalPilotKillSwitch{Service: InternalPilotServiceDispatch, Status: InternalPilotKillSwitchActive, ActivatedBy: "00000000-0000-0000-0000-000000000010", Reason: "dispatch incident"})
	if err != nil {
		t.Fatal(err)
	}
	err = repo.CreateInternalPilotKillSwitchEvent(context.Background(), InternalPilotKillSwitchEvent{KillSwitchID: "00000000-0000-0000-0000-000000000014", Service: InternalPilotServiceDispatch, Status: InternalPilotKillSwitchActive, OperatorID: "00000000-0000-0000-0000-000000000010", Reason: "dispatch incident"})
	if err != nil {
		t.Fatal(err)
	}
	required := []string{
		"INSERT INTO public.internal_pilot_participants",
		"INSERT INTO public.internal_pilot_participant_events",
		"INSERT INTO public.internal_pilot_health_reports",
		"INSERT INTO public.internal_pilot_incidents",
		"INSERT INTO public.internal_pilot_kill_switches",
		"INSERT INTO public.internal_pilot_kill_switch_events",
	}
	if len(db.execs) != len(required) {
		t.Fatalf("expected %d writes, got %#v", len(required), db.execs)
	}
	for i, pattern := range required {
		if !strings.Contains(db.execs[i], pattern) {
			t.Fatalf("expected write %d to contain %s, got %s", i, pattern, db.execs[i])
		}
	}
}

func TestRepositoryInternalPilotEvidencePersistence(t *testing.T) {
	db := &fakeDB{}
	repo := NewPostgresRepository(db)
	_, err := repo.CreateInternalPilotExecutionEvent(context.Background(), InternalPilotExecutionEvent{AuthorizationExecutionID: "00000000-0000-0000-0000-000000000011", ParticipantID: "00000000-0000-0000-0000-000000000012", EventType: InternalPilotEventTripCompleted, EntityType: "ride", EntityID: "ride-1", Status: "completed"})
	if err != nil {
		t.Fatal(err)
	}
	_, err = repo.CreateInternalPilotEvidencePackage(context.Background(), InternalPilotEvidencePackage{AuthorizationExecutionID: "00000000-0000-0000-0000-000000000011", ReportPeriodStart: time.Now().Add(-time.Hour), ReportPeriodEnd: time.Now(), TotalEvents: 4, TotalRides: 1, CompletedRides: 1, ComplianceScore: 100})
	if err != nil {
		t.Fatal(err)
	}
	_, err = repo.CreateInternalPilotObjectiveResult(context.Background(), InternalPilotObjectiveResult{AuthorizationExecutionID: "00000000-0000-0000-0000-000000000011", ObjectiveName: "ride_completion_rate", TargetValue: 90, ActualValue: 100, Achieved: true})
	if err != nil {
		t.Fatal(err)
	}
	required := []string{
		"INSERT INTO public.internal_pilot_execution_events",
		"INSERT INTO public.internal_pilot_evidence_packages",
		"INSERT INTO public.internal_pilot_objective_results",
	}
	if len(db.execs) != len(required) {
		t.Fatalf("expected %d writes, got %#v", len(required), db.execs)
	}
	for i, pattern := range required {
		if !strings.Contains(db.execs[i], pattern) {
			t.Fatalf("expected write %d to contain %s, got %s", i, pattern, db.execs[i])
		}
	}
}

func TestRepositoryInternalPilotBoardReviewPersistence(t *testing.T) {
	db := &fakeDB{}
	repo := NewPostgresRepository(db)
	start := time.Now().Add(-24 * time.Hour)

	_, err := repo.CreateInternalPilotBoardReview(context.Background(), InternalPilotBoardReview{
		AuthorizationExecutionID: "00000000-0000-0000-0000-000000000011",
		ReviewPeriodStart:        start,
		ReviewPeriodEnd:          start.Add(24 * time.Hour),
		ReviewStatus:             InternalPilotBoardReviewStatusCompleted,
		Decision:                 InternalPilotBoardDecisionConditional,
		DecisionReason:           "minor dispatch corrective action required",
	})
	if err != nil {
		t.Fatal(err)
	}
	_, err = repo.CreateInternalPilotReviewFinding(context.Background(), InternalPilotReviewFinding{
		BoardReviewID:  "00000000-0000-0000-0000-000000000021",
		Category:       InternalPilotFindingCategoryDispatch,
		Severity:       InternalPilotIncidentSeverityMedium,
		Title:          "driver acceptance below target",
		Recommendation: "continue internal pilot dispatch monitoring",
	})
	if err != nil {
		t.Fatal(err)
	}
	_, err = repo.CreateInternalPilotReadinessAssessment(context.Background(), InternalPilotReadinessAssessment{
		BoardReviewID: "00000000-0000-0000-0000-000000000021",
		Category:      InternalPilotReadinessCategoryOperational,
		Score:         96,
		TargetScore:   95,
		Passed:        true,
	})
	if err != nil {
		t.Fatal(err)
	}
	required := []string{
		"INSERT INTO public.internal_pilot_board_reviews",
		"INSERT INTO public.internal_pilot_review_findings",
		"INSERT INTO public.internal_pilot_readiness_assessments",
	}
	if len(db.execs) != len(required) {
		t.Fatalf("expected %d writes, got %#v", len(required), db.execs)
	}
	for i, pattern := range required {
		if !strings.Contains(db.execs[i], pattern) {
			t.Fatalf("expected write %d to contain %s, got %s", i, pattern, db.execs[i])
		}
	}
}

func TestRepositoryPublicWalletPilotPersistence(t *testing.T) {
	db := &fakeDB{}
	repo := NewPostgresRepository(db)
	now := time.Now()

	_, err := repo.CreatePublicWalletPilotProgram(context.Background(), PublicWalletPilotProgram{
		ProgramName:                  "Gwanda Limited Public Wallet Pilot",
		City:                         WalletPilotCityGwanda,
		Status:                       WalletPilotProgramStatusPlanned,
		ParticipantLimit:             20,
		DriverLimit:                  10,
		WalletBalanceLimitMinor:      5000,
		DailyTransactionLimitMinor:   2000,
		MonthlyTransactionLimitMinor: 20000,
		Currency:                     CurrencyUSD,
		StartDate:                    now,
		EndDate:                      now.AddDate(0, 0, 30),
		AuthorizationExecutionID:     "00000000-0000-0000-0000-000000000011",
	})
	if err != nil {
		t.Fatal(err)
	}
	_, err = repo.CreatePublicWalletPilotParticipant(context.Background(), PublicWalletPilotParticipant{ProgramID: "00000000-0000-0000-0000-000000000021", UserID: "00000000-0000-0000-0000-000000000031", ParticipantType: WalletPilotParticipantTypeRider, Status: WalletPilotParticipantStatusActive, EnrolledBy: "00000000-0000-0000-0000-000000000010"})
	if err != nil {
		t.Fatal(err)
	}
	_, err = repo.UpdatePublicWalletPilotParticipantStatus(context.Background(), "00000000-0000-0000-0000-000000000041", WalletPilotParticipantStatusSuspended, "00000000-0000-0000-0000-000000000010")
	if err != nil {
		t.Fatal(err)
	}
	_, err = repo.CreatePublicWalletPilotTransaction(context.Background(), PublicWalletPilotTransaction{ProgramID: "00000000-0000-0000-0000-000000000021", WalletID: "00000000-0000-0000-0000-000000000051", UserID: "00000000-0000-0000-0000-000000000031", TransactionType: WalletPilotTransactionTypeDeposit, AmountMinor: 1000, Currency: CurrencyUSD, Status: WalletPilotTransactionStatusRecorded})
	if err != nil {
		t.Fatal(err)
	}
	_, err = repo.CreatePublicWalletPilotReconciliationReport(context.Background(), PublicWalletPilotReconciliationReport{ProgramID: "00000000-0000-0000-0000-000000000021", ReportDate: now, LedgerBalanceMinor: 1000, WalletBalanceMinor: 1000, Currency: CurrencyUSD, Status: WalletPilotReconciliationBalanced})
	if err != nil {
		t.Fatal(err)
	}
	_, err = repo.CreatePublicWalletPilotFraudEvent(context.Background(), PublicWalletPilotFraudEvent{ProgramID: "00000000-0000-0000-0000-000000000021", UserID: "00000000-0000-0000-0000-000000000031", EventType: WalletPilotFraudDuplicatePayments, Severity: WalletPilotFraudSeverityLow, Description: "duplicate callback", Status: WalletPilotFraudStatusOpen})
	if err != nil {
		t.Fatal(err)
	}
	_, err = repo.CreatePublicWalletPilotKillSwitch(context.Background(), PublicWalletPilotKillSwitch{ProgramID: "00000000-0000-0000-0000-000000000021", Control: WalletPilotKillSwitchDisableDeposits, Status: InternalPilotKillSwitchActive, OperatorID: "00000000-0000-0000-0000-000000000010", Reason: "drill"})
	if err != nil {
		t.Fatal(err)
	}
	required := []string{
		"INSERT INTO public.wallet_pilot_programs",
		"INSERT INTO public.wallet_pilot_participants",
		"UPDATE public.wallet_pilot_participants",
		"INSERT INTO public.wallet_pilot_transactions",
		"INSERT INTO public.wallet_pilot_reconciliation_reports",
		"INSERT INTO public.wallet_pilot_fraud_events",
		"INSERT INTO public.wallet_pilot_kill_switches",
	}
	if len(db.execs) != len(required) {
		t.Fatalf("expected %d writes, got %#v", len(required), db.execs)
	}
	for i, pattern := range required {
		if !strings.Contains(db.execs[i], pattern) {
			t.Fatalf("expected write %d to contain %s, got %s", i, pattern, db.execs[i])
		}
	}
}
