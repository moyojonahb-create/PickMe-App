package wallet

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gofiber/fiber/v2"

	"pickme-backend/internal/middleware"
)

type fakeFlowService struct {
	approved bool
	deposits int
	err      error
}

type fakeRideAuthorizationService struct {
	authorized bool
	captured   bool
	released   bool
}

type fakeWalletReconciliationService struct {
	ran bool
}

type fakePilotService struct {
	enabled  bool
	eligible bool
	changes  []PilotUserChange
}

type fakeRecoveryService struct {
	refunds        int
	chargebacks    int
	disputes       int
	incidents      int
	imports        int
	reconciles     int
	certifications int
	drills         int
	scorecards     int
	approvals      int
	approvalEvents int
	launchGates    int
	closeRuns      int
	signoffs       int
	readiness      int
	evidence       int
	gateDrills     int
	finalReadiness int
}

func (f *fakeFlowService) CreateDeposit(ctx context.Context, req DepositRequest) (PaymentIntent, error) {
	f.deposits++
	if f.err != nil {
		return PaymentIntent{}, f.err
	}
	return PaymentIntent{ID: "deposit-1", UserID: req.UserID, AmountMinor: req.AmountMinor, Status: DepositStatusPendingAdminApproval}, nil
}

func (f *fakeFlowService) ApproveDeposit(ctx context.Context, decision AdminDecision) (PaymentIntent, error) {
	f.approved = true
	if f.err != nil {
		return PaymentIntent{}, f.err
	}
	return PaymentIntent{ID: decision.TargetID, Status: DepositStatusApproved}, nil
}

func (f *fakeFlowService) RejectDeposit(ctx context.Context, decision AdminDecision) (PaymentIntent, error) {
	return PaymentIntent{ID: decision.TargetID, Status: DepositStatusRejected}, nil
}

func (f *fakeFlowService) CreateWithdrawal(ctx context.Context, req WithdrawalCreateRequest) (WithdrawalRequest, error) {
	if f.err != nil {
		return WithdrawalRequest{}, f.err
	}
	return WithdrawalRequest{ID: "withdrawal-1", DriverID: req.DriverID, AmountMinor: req.AmountMinor, Status: WithdrawalStatusPendingApproval}, nil
}

func (f *fakeFlowService) ApproveWithdrawal(ctx context.Context, decision AdminDecision) (WithdrawalRequest, error) {
	return WithdrawalRequest{ID: decision.TargetID, Status: WithdrawalStatusApproved}, nil
}

func (f *fakeFlowService) RejectWithdrawal(ctx context.Context, decision AdminDecision) (WithdrawalRequest, error) {
	return WithdrawalRequest{ID: decision.TargetID, Status: WithdrawalStatusRejected}, nil
}

func (f *fakeFlowService) CreateTransfer(ctx context.Context, req TransferRequest) (TransferResult, error) {
	if f.err != nil {
		return TransferResult{}, f.err
	}
	return TransferResult{TransactionID: "transfer-1", AmountMinor: req.AmountMinor, Currency: CurrencyUSD, Reference: "transfer-1"}, nil
}

func (f *fakeFlowService) PayRide(ctx context.Context, req WalletPayRequest) (WalletPayResult, error) {
	if f.err != nil {
		return WalletPayResult{}, f.err
	}
	return WalletPayResult{SettlementID: "settlement-1", AmountMinor: 500, Currency: CurrencyUSD, Reference: "wallet-settlement:" + req.RideID}, nil
}

func (f *fakeFlowService) SetWalletPIN(ctx context.Context, req WalletPINRequest) error {
	return f.err
}

func (f *fakeFlowService) LookupUser(ctx context.Context, pickmeAccount string) (LookupUserResult, error) {
	if f.err != nil {
		return LookupUserResult{}, f.err
	}
	return LookupUserResult{UserID: "lookup-user-1", FullName: "Lookup User", PickMeAccount: pickmeAccount}, nil
}

func (f *fakeFlowService) DriverSummary(ctx context.Context, driverID string) (map[string]any, error) {
	return map[string]any{"driver_id": driverID, "available_balance_minor": int64(1000), "currency": CurrencyUSD}, f.err
}

func (f *fakeFlowService) DriverEarnings(ctx context.Context, driverID string, limit int) ([]map[string]any, error) {
	return []map[string]any{{"driver_id": driverID, "driver_earning_minor": int64(850), "currency": CurrencyUSD}}, f.err
}

func (f *fakeRideAuthorizationService) AuthorizeRideFunds(ctx context.Context, req AuthorizationRequest) (WalletAuthorization, error) {
	f.authorized = true
	return WalletAuthorization{ID: "auth-1", RideID: req.RideID, RiderID: req.RiderID, AmountMinor: req.AmountMinor, Status: AuthorizationStatusAuthorized}, nil
}

func (f *fakeRideAuthorizationService) CaptureRideFunds(ctx context.Context, req CaptureRequest) (SettlementRecord, error) {
	f.captured = true
	return SettlementRecord{ID: "settlement-1", RideID: req.RideID, RiderID: req.RiderID, DriverID: req.DriverID, Status: SettlementStatusSettled}, nil
}

func (f *fakeRideAuthorizationService) ReleaseRideFunds(ctx context.Context, req ReleaseRequest) (WalletAuthorization, error) {
	f.released = true
	return WalletAuthorization{ID: "auth-1", RideID: req.RideID, RiderID: req.RiderID, Status: AuthorizationStatusReleased}, nil
}

func (f *fakeWalletReconciliationService) RunWalletReconciliation(ctx context.Context) (WalletReconciliationResult, error) {
	f.ran = true
	return WalletReconciliationResult{RunID: "run-1", Status: "completed"}, nil
}

func (f *fakePilotService) Enabled() bool {
	return f.enabled
}

func (f *fakePilotService) IsPilotEligible(ctx context.Context, userID string, role string) bool {
	return !f.enabled || f.eligible
}

func (f *fakePilotService) SetPilotUser(ctx context.Context, change PilotUserChange) (PilotUser, error) {
	f.changes = append(f.changes, change)
	return PilotUser{UserID: change.UserID, Role: change.Role, Status: change.Status, GroupName: change.GroupName, Reason: change.Reason}, nil
}

func (f *fakeRecoveryService) CreateRefundIntent(ctx context.Context, refund RefundIntent) (RefundIntent, error) {
	f.refunds++
	refund.ID = "refund-1"
	refund.Status = RefundStatusPendingReview
	return refund, nil
}

func (f *fakeRecoveryService) CreateChargeback(ctx context.Context, chargeback ChargebackRecord) (ChargebackRecord, error) {
	f.chargebacks++
	chargeback.ID = "chargeback-1"
	chargeback.Status = ChargebackStatusReceived
	return chargeback, nil
}

func (f *fakeRecoveryService) OpenDispute(ctx context.Context, dispute FinancialDispute) (FinancialDispute, error) {
	f.disputes++
	dispute.ID = "dispute-1"
	dispute.Status = DisputeStatusOpened
	return dispute, nil
}

func (f *fakeRecoveryService) UpdateDisputeStatus(ctx context.Context, disputeID string, status string, adminID string, resolution string) (FinancialDispute, error) {
	f.disputes++
	return FinancialDispute{ID: disputeID, Status: status, AssignedTo: adminID, Resolution: resolution}, nil
}

func (f *fakeRecoveryService) CreateFinancialIncident(ctx context.Context, incident FinancialIncident) (FinancialIncident, error) {
	f.incidents++
	incident.ID = "incident-1"
	incident.Status = IncidentStatusOpened
	return incident, nil
}

func (f *fakeRecoveryService) ImportProviderStatement(ctx context.Context, req ProviderStatementImportRequest) (ProviderStatementImport, error) {
	f.imports++
	return ProviderStatementImport{ID: "statement-1", Provider: req.Provider, StatementReference: req.StatementReference, Status: "pending"}, nil
}

func (f *fakeRecoveryService) RunProviderStatementReconciliation(ctx context.Context, importID string, provider string) (ReconciliationRun, error) {
	f.reconciles++
	return ReconciliationRun{ID: "run-1", Provider: provider, Status: "requires_review"}, nil
}

func (f *fakeRecoveryService) StartProviderCertification(ctx context.Context, provider string, certificationType string, adminID string) (ProviderCertification, error) {
	f.certifications++
	return ProviderCertification{ID: "cert-1", Provider: provider, CertificationType: certificationType, Status: CertificationStatusRunning, CertifiedBy: adminID}, nil
}

func (f *fakeRecoveryService) RunRecoveryDrill(ctx context.Context, drillType string, provider string, adminID string) (RecoveryDrill, error) {
	f.drills++
	return RecoveryDrill{ID: "drill-1", DrillType: drillType, Provider: provider, Status: RecoveryDrillStatusRunning, TriggeredBy: adminID}, nil
}

func (f *fakeRecoveryService) RecordRecoveryScorecard(ctx context.Context, scorecard RecoveryScorecard) (RecoveryScorecard, error) {
	f.scorecards++
	scorecard.ID = "scorecard-1"
	return scorecard, nil
}

func (f *fakeRecoveryService) CreateFinanceApprovalRequest(ctx context.Context, request FinanceApprovalRequest) (FinanceApprovalRequest, error) {
	f.approvals++
	request.ID = "approval-1"
	request.Status = ApprovalStatusPending
	return request, nil
}

func (f *fakeRecoveryService) RecordFinanceApproval(ctx context.Context, event FinanceApprovalEvent) (FinanceApprovalRequest, error) {
	f.approvalEvents++
	return FinanceApprovalRequest{ID: event.RequestID, Status: ApprovalStatusPending}, nil
}

func (f *fakeRecoveryService) CreateLaunchGate(ctx context.Context, gate LaunchGate) (LaunchGate, error) {
	f.launchGates++
	gate.ID = "gate-1"
	gate.Status = LaunchGateStatusBlocked
	return gate, nil
}

func (f *fakeRecoveryService) EvaluateLaunchGate(ctx context.Context, gateID string, adminID string) (LaunchGate, error) {
	f.launchGates++
	return LaunchGate{ID: gateID, Status: LaunchGateStatusBlocked}, nil
}

func (f *fakeRecoveryService) CreateFinanceCloseRun(ctx context.Context, run FinanceCloseRun) (FinanceCloseRun, error) {
	f.closeRuns++
	run.ID = "close-1"
	run.Status = FinanceCloseStatusOpened
	return run, nil
}

func (f *fakeRecoveryService) CreateFinanceSignoff(ctx context.Context, signoff FinanceSignoff) (FinanceSignoff, error) {
	f.signoffs++
	signoff.ID = "signoff-1"
	return signoff, nil
}

func (f *fakeRecoveryService) CreateLaunchReadinessScorecard(ctx context.Context, scorecard LaunchReadinessScorecard) (LaunchReadinessScorecard, error) {
	f.readiness++
	scorecard.ID = "readiness-1"
	return scorecard, nil
}

func (f *fakeRecoveryService) CollectReleaseEvidence(ctx context.Context, evidence []ReleaseEvidenceRecord) ([]ReleaseEvidenceRecord, error) {
	f.evidence += len(evidence)
	return evidence, nil
}

func (f *fakeRecoveryService) RunLaunchGateDrill(ctx context.Context, drill LaunchGateDrill) (LaunchGateDrill, error) {
	f.gateDrills++
	drill.ID = "launch-drill-1"
	return drill, nil
}

func (f *fakeRecoveryService) CreateFinalReadinessScorecard(ctx context.Context, scorecard FinalReadinessScorecard) (FinalReadinessScorecard, error) {
	f.finalReadiness++
	scorecard.ID = "final-readiness-1"
	return scorecard, nil
}

type fakeOpsReports struct{}

func (f fakeOpsReports) WalletState(ctx context.Context, userID string) ([]map[string]any, error) {
	return []map[string]any{{"account_type": AccountTypeRiderWallet, "currency": CurrencyUSD}}, nil
}

func (f fakeOpsReports) WalletTransactions(ctx context.Context, userID string, limit int) ([]map[string]any, error) {
	return []map[string]any{{"transaction_type": TransactionTypeDeposit}}, nil
}

func (f fakeOpsReports) WalletDeposits(ctx context.Context, userID string, limit int) ([]map[string]any, error) {
	return []map[string]any{{"id": "deposit-1", "amount": 10.00, "currency": CurrencyUSD}}, nil
}

func (f fakeOpsReports) RideSettlement(ctx context.Context, rideID string, userID string) (map[string]any, error) {
	return map[string]any{"ride_id": rideID, "rider_id": userID, "fare": 5.00, "status": SettlementStatusSettled}, nil
}

func (f fakeOpsReports) DepositDetail(ctx context.Context, userID string, id string) (map[string]any, error) {
	return map[string]any{"id": id, "user_id": userID}, nil
}

func (f fakeOpsReports) WithdrawalDetail(ctx context.Context, driverID string, id string) (map[string]any, error) {
	return map[string]any{"id": id, "driver_id": driverID}, nil
}

func (f fakeOpsReports) PendingDeposits(ctx context.Context, limit int) ([]map[string]any, error) {
	return []map[string]any{{"id": "deposit-1"}}, nil
}

func (f fakeOpsReports) PendingWithdrawals(ctx context.Context, limit int) ([]map[string]any, error) {
	return []map[string]any{{"id": "withdrawal-1"}}, nil
}

func (f fakeOpsReports) AdminActions(ctx context.Context, limit int) ([]map[string]any, error) {
	return []map[string]any{{"action": "approve_deposit"}}, nil
}

func (f fakeOpsReports) ReconciliationSummary(ctx context.Context) (map[string]any, error) {
	return map[string]any{"pending_deposits": 1}, nil
}

func (f fakeOpsReports) ReconciliationDrift(ctx context.Context, limit int) ([]map[string]any, error) {
	return []map[string]any{{"account_id": "account-1"}}, nil
}

func (f fakeOpsReports) OpenAuthorizations(ctx context.Context, limit int) ([]map[string]any, error) {
	return []map[string]any{{"id": "auth-1", "status": AuthorizationStatusAuthorized}}, nil
}

func (f fakeOpsReports) ExpiredAuthorizations(ctx context.Context, limit int) ([]map[string]any, error) {
	return []map[string]any{{"id": "auth-2", "status": AuthorizationStatusAuthorized}}, nil
}

func (f fakeOpsReports) PilotSummary(ctx context.Context) (map[string]any, error) {
	return map[string]any{"pilot_users": 1, "failed_settlements": 0}, nil
}

func (f fakeOpsReports) PilotUsers(ctx context.Context, limit int) ([]map[string]any, error) {
	return []map[string]any{{"user_id": "user-1", "status": PilotStatusEnabled}}, nil
}

func (f fakeOpsReports) PilotFailures(ctx context.Context, limit int) ([]map[string]any, error) {
	return []map[string]any{{"type": "failed_settlement"}}, nil
}

func (f fakeOpsReports) PilotReconciliation(ctx context.Context, limit int) ([]map[string]any, error) {
	return []map[string]any{{"status": "completed"}}, nil
}

func (f fakeOpsReports) FinancialHardeningSummary(ctx context.Context) (map[string]any, error) {
	return map[string]any{"failed_captures": 0, "dead_letter_jobs": 0}, nil
}

func (f fakeOpsReports) FinancialRecoverySummary(ctx context.Context) (map[string]any, error) {
	return map[string]any{"open_refunds": 1, "open_disputes": 1}, nil
}

func (f fakeOpsReports) RefundIntents(ctx context.Context, limit int) ([]map[string]any, error) {
	return []map[string]any{{"id": "refund-1"}}, nil
}

func (f fakeOpsReports) Chargebacks(ctx context.Context, limit int) ([]map[string]any, error) {
	return []map[string]any{{"id": "chargeback-1"}}, nil
}

func (f fakeOpsReports) FinancialDisputes(ctx context.Context, limit int) ([]map[string]any, error) {
	return []map[string]any{{"id": "dispute-1"}}, nil
}

func (f fakeOpsReports) FinancialIncidents(ctx context.Context, limit int) ([]map[string]any, error) {
	return []map[string]any{{"id": "incident-1"}}, nil
}

func (f fakeOpsReports) ProviderStatementImports(ctx context.Context, limit int) ([]map[string]any, error) {
	return []map[string]any{{"id": "statement-1"}}, nil
}

func (f fakeOpsReports) ProviderStatementLines(ctx context.Context, limit int) ([]map[string]any, error) {
	return []map[string]any{{"id": "line-1"}}, nil
}

func (f fakeOpsReports) FinancialRunbooks(ctx context.Context, limit int) ([]map[string]any, error) {
	return []map[string]any{{"runbook_key": "provider-reconciliation"}}, nil
}

func (f fakeOpsReports) FinancialReliabilitySummary(ctx context.Context) (map[string]any, error) {
	return map[string]any{"provider_certifications_running": 1, "recovery_drills_failed": 0}, nil
}

func (f fakeOpsReports) ProviderCertifications(ctx context.Context, limit int) ([]map[string]any, error) {
	return []map[string]any{{"id": "cert-1", "provider": ProviderOneMoney}}, nil
}

func (f fakeOpsReports) ProviderCertificationChecks(ctx context.Context, limit int) ([]map[string]any, error) {
	return []map[string]any{{"id": "check-1", "check_type": "signature_verification"}}, nil
}

func (f fakeOpsReports) RecoveryDrills(ctx context.Context, limit int) ([]map[string]any, error) {
	return []map[string]any{{"id": "drill-1", "drill_type": "settlement_failure"}}, nil
}

func (f fakeOpsReports) RecoveryDrillEvents(ctx context.Context, limit int) ([]map[string]any, error) {
	return []map[string]any{{"id": "event-1", "event_type": "drill_started"}}, nil
}

func (f fakeOpsReports) RecoveryScorecards(ctx context.Context, limit int) ([]map[string]any, error) {
	return []map[string]any{{"id": "scorecard-1", "score": 90}}, nil
}

func (f fakeOpsReports) FinanceGovernanceSummary(ctx context.Context) (map[string]any, error) {
	return map[string]any{"pending_dual_approvals": 1, "blocked_launch_gates": 1}, nil
}

func (f fakeOpsReports) FinanceApprovalRequests(ctx context.Context, limit int) ([]map[string]any, error) {
	return []map[string]any{{"id": "approval-1"}}, nil
}

func (f fakeOpsReports) LaunchGates(ctx context.Context, limit int) ([]map[string]any, error) {
	return []map[string]any{{"id": "gate-1", "status": LaunchGateStatusBlocked}}, nil
}

func (f fakeOpsReports) FinanceCloseRuns(ctx context.Context, limit int) ([]map[string]any, error) {
	return []map[string]any{{"id": "close-1"}}, nil
}

func (f fakeOpsReports) FinanceSignoffs(ctx context.Context, limit int) ([]map[string]any, error) {
	return []map[string]any{{"id": "signoff-1"}}, nil
}

func (f fakeOpsReports) LaunchReadinessScorecards(ctx context.Context, limit int) ([]map[string]any, error) {
	return []map[string]any{{"id": "readiness-1", "score": 80}}, nil
}

func (f fakeOpsReports) ReleaseReadinessSummary(ctx context.Context) (map[string]any, error) {
	return map[string]any{"latest_overall_score": 78, "public_launch_approved": false}, nil
}

func (f fakeOpsReports) ReleaseEvidence(ctx context.Context, limit int) ([]map[string]any, error) {
	return []map[string]any{{"id": "evidence-1", "category": "architecture"}}, nil
}

func (f fakeOpsReports) ReleaseScorecards(ctx context.Context, limit int) ([]map[string]any, error) {
	return []map[string]any{{"id": "final-readiness-1", "overall_score": 78}}, nil
}

func (f fakeOpsReports) ExecutiveSignoffSummary(ctx context.Context) (map[string]any, error) {
	return map[string]any{"pending_packets": 1, "public_launch_approved": false}, nil
}

func (f fakeOpsReports) LaunchBlockers(ctx context.Context, limit int) ([]map[string]any, error) {
	return []map[string]any{{"id": "blocker-1", "status": LaunchBlockerStatusOpen}}, nil
}

func (f fakeOpsReports) InternalLaunchStatus(ctx context.Context) (map[string]any, error) {
	return map[string]any{"latest_outcome": InternalLaunchOutcomePilotReady, "public_launch_approved": false}, nil
}

func (f fakeOpsReports) DrillEvidence(ctx context.Context, limit int) ([]map[string]any, error) {
	return []map[string]any{{"id": "evidence-1", "drill_type": "settlement"}}, nil
}

func (f fakeOpsReports) ProductionExceptions(ctx context.Context, limit int) ([]map[string]any, error) {
	return []map[string]any{{"id": "exception-1", "status": ProductionExceptionStatusOpen}}, nil
}

func (f fakeOpsReports) ReliabilityScorecards(ctx context.Context, limit int) ([]map[string]any, error) {
	return []map[string]any{{"id": "reliability-1", "authorization_outcome": PilotAuthorizationOutcomeInternal}}, nil
}

func (f fakeOpsReports) FinanceControlRoom(ctx context.Context) (map[string]any, error) {
	return map[string]any{"settlement_health": "green", "public_launch_approved": false}, nil
}

func (f fakeOpsReports) DailyCloseReports(ctx context.Context, limit int) ([]map[string]any, error) {
	return []map[string]any{{"id": "close-1", "status": DailyCloseStatusPendingReview}}, nil
}

func (f fakeOpsReports) PilotMonitoringReport(ctx context.Context) (map[string]any, error) {
	return map[string]any{"pilot_users": 1, "pilot_failures": 0, "public_launch_approved": false}, nil
}

func (f fakeOpsReports) Day1CloseReport(ctx context.Context) (map[string]any, error) {
	return map[string]any{"latest_status": DailyCloseStatusSignedOff, "public_launch_approved": false}, nil
}

func (f fakeOpsReports) PilotStatusReport(ctx context.Context) (map[string]any, error) {
	return map[string]any{"latest_outcome": PilotAuthorizationOutcomeInternal, "public_launch_approved": false}, nil
}

func (f fakeOpsReports) GoNoGoReport(ctx context.Context) (map[string]any, error) {
	return map[string]any{"latest_decision": GoNoGoDecisionConditionalGo, "public_launch_approved": false}, nil
}

func (f fakeOpsReports) PilotAuthorizationReport(ctx context.Context) (map[string]any, error) {
	return map[string]any{"latest_decision": GoNoGoDecisionConditionalGo, "authorization_count": 1}, nil
}

func (f fakeOpsReports) PilotReadinessReport(ctx context.Context) (map[string]any, error) {
	return map[string]any{"technology_ready": true, "public_launch_approved": false}, nil
}

func (f fakeOpsReports) InternalPilotBoardReport(ctx context.Context) (map[string]any, error) {
	return map[string]any{"latest_decision": InternalPilotApprovalConditional, "public_launch_approved": false}, nil
}

func (f fakeOpsReports) InternalPilotAuthorizationReport(ctx context.Context) (map[string]any, error) {
	return map[string]any{"authorization_count": 1, "public_launch_approved": false}, nil
}

func (f fakeOpsReports) InternalPilotHealthReport(ctx context.Context) (map[string]any, error) {
	return map[string]any{"authorization_state": InternalPilotAuthorizationActive, "public_launch_approved": false}, nil
}

func (f fakeOpsReports) InternalPilotIncidents(ctx context.Context, limit int) ([]map[string]any, error) {
	return []map[string]any{{"id": "incident-1", "severity": InternalPilotIncidentSeverityCritical}}, nil
}

func (f fakeOpsReports) InternalPilotParticipants(ctx context.Context, limit int) ([]map[string]any, error) {
	return []map[string]any{{"user_id": "user-1", "status": InternalPilotParticipantActive}}, nil
}

func (f fakeOpsReports) InternalPilotKillSwitches(ctx context.Context, limit int) ([]map[string]any, error) {
	return []map[string]any{{"service": InternalPilotServiceWallets, "status": InternalPilotKillSwitchInactive}}, nil
}

func (f fakeOpsReports) InternalPilotReadinessReport(ctx context.Context) (map[string]any, error) {
	return map[string]any{"readiness_status": "ready_for_internal_pilot_start", "public_launch_approved": false}, nil
}

func (f fakeOpsReports) InternalPilotEvidence(ctx context.Context, limit int) ([]map[string]any, error) {
	return []map[string]any{{"id": "evidence-1", "compliance_score": 100}}, nil
}

func (f fakeOpsReports) InternalPilotObjectives(ctx context.Context, limit int) ([]map[string]any, error) {
	return []map[string]any{{"objective_name": "ride_completion_rate", "achieved": true}}, nil
}

func (f fakeOpsReports) InternalPilotSummary(ctx context.Context) (map[string]any, error) {
	return map[string]any{"readiness_recommendation": "ready_for_board_review", "public_launch_approved": false}, nil
}

func (f fakeOpsReports) InternalPilotCompliance(ctx context.Context) (map[string]any, error) {
	return map[string]any{"readiness_recommendation": "compliance_ready_for_board_review", "public_launch_approved": false}, nil
}

func (f fakeOpsReports) InternalPilotBoardReview(ctx context.Context) (map[string]any, error) {
	return map[string]any{"latest_decision": InternalPilotBoardDecisionConditional, "public_launch_approved": false}, nil
}

func (f fakeOpsReports) InternalPilotFindings(ctx context.Context, limit int) ([]map[string]any, error) {
	return []map[string]any{{"category": InternalPilotFindingCategoryOperations, "severity": InternalPilotIncidentSeverityLow}}, nil
}

func (f fakeOpsReports) InternalPilotReadinessAssessment(ctx context.Context, limit int) ([]map[string]any, error) {
	return []map[string]any{{"category": InternalPilotReadinessCategoryOperational, "score": 96, "passed": true}}, nil
}

func (f fakeOpsReports) InternalPilotBoardRecommendation(ctx context.Context) (map[string]any, error) {
	return map[string]any{"board_recommendation": "eligible_for_v2_3_a_limited_public_wallet_pilot_review", "public_launch_approved": false}, nil
}

func (f fakeOpsReports) InternalPilotReviewSummary(ctx context.Context) (map[string]any, error) {
	return map[string]any{"decision": InternalPilotBoardDecisionConditional, "public_launch_approved": false}, nil
}

func (f fakeOpsReports) PublicWalletPilotReport(ctx context.Context) (map[string]any, error) {
	return map[string]any{"city": WalletPilotCityGwanda, "pilot_readiness": "gwanda_pilot_ready_for_controlled_operation", "public_launch_approved": false}, nil
}

func (f fakeOpsReports) PublicWalletPilotParticipants(ctx context.Context, limit int) ([]map[string]any, error) {
	return []map[string]any{{"user_id": "user-1", "participant_type": WalletPilotParticipantTypeRider, "status": WalletPilotParticipantStatusActive}}, nil
}

func (f fakeOpsReports) PublicWalletPilotTransactions(ctx context.Context, limit int) ([]map[string]any, error) {
	return []map[string]any{{"transaction_type": WalletPilotTransactionTypeDeposit, "amount_minor": 1000, "status": WalletPilotTransactionStatusRecorded}}, nil
}

func (f fakeOpsReports) PublicWalletPilotReconciliation(ctx context.Context, limit int) ([]map[string]any, error) {
	return []map[string]any{{"status": WalletPilotReconciliationBalanced, "variance_minor": 0}}, nil
}

func (f fakeOpsReports) PublicWalletPilotFraud(ctx context.Context, limit int) ([]map[string]any, error) {
	return []map[string]any{{"event_type": WalletPilotFraudDuplicatePayments, "severity": WalletPilotFraudSeverityLow}}, nil
}

func (f fakeOpsReports) PublicWalletPilotEvidence(ctx context.Context) (map[string]any, error) {
	return map[string]any{"readiness_recommendation": "gwanda_wallet_pilot_ready_when_success_criteria_confirmed", "public_launch_approved": false}, nil
}

func TestWalletOperationEndpointsReturnSafeJSON(t *testing.T) {
	app := fiber.New()
	RegisterOperationRoutes(app, &fakeFlowService{}, &fakeRideAuthorizationService{}, &fakeWalletReconciliationService{}, &fakePilotService{}, &fakeRecoveryService{}, fakeOpsReports{}, authAs("user-1", "authenticated"))

	tests := []struct {
		method string
		path   string
		body   any
	}{
		{http.MethodPost, "/api/wallets/deposits", map[string]any{"amount": 10, "currency": CurrencyUSD, "method": ManualMethodCash, "idempotency_key": "deposit-key-1"}},
		{http.MethodGet, "/api/wallets/deposits/deposit-1", nil},
		{http.MethodGet, "/api/wallets/me", nil},
		{http.MethodGet, "/api/wallets/me/transactions", nil},
		{http.MethodPost, "/api/wallets/withdrawals", map[string]any{"amount": 10, "currency": CurrencyUSD, "method": ManualMethodBank, "destination_reference": "bank-1", "idempotency_key": "withdraw-key-1"}},
		{http.MethodGet, "/api/wallets/withdrawals/withdrawal-1", nil},
		{http.MethodPost, "/api/wallets/authorize-ride", map[string]any{"ride_id": "ride-1", "amount": 10, "currency": CurrencyUSD, "idempotency_key": "auth-key-1"}},
	}
	for _, tt := range tests {
		resp := walletHTTPTestRequest(t, app, tt.method, tt.path, tt.body)
		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			t.Fatalf("expected %s %s to succeed, got %d", tt.method, tt.path, resp.StatusCode)
		}
	}
}

func TestFrontendWalletCompatibilityEndpoints(t *testing.T) {
	app := fiber.New()
	RegisterOperationRoutes(app, &fakeFlowService{}, &fakeRideAuthorizationService{}, &fakeWalletReconciliationService{}, &fakePilotService{}, &fakeRecoveryService{}, fakeOpsReports{}, authAs("user-1", "authenticated"))

	tests := []struct {
		method string
		path   string
		body   any
		want   string
	}{
		{http.MethodGet, "/api/wallet/me", nil, "rider_wallet"},
		{http.MethodGet, "/api/wallet/transactions", nil, "deposit"},
		{http.MethodGet, "/api/wallet/deposits", nil, "deposit-1"},
		{http.MethodPost, "/api/wallet/deposit", map[string]any{"amount_usd": 10.00, "ecocash_phone": "0770000000", "ecocash_reference": "ABC123", "proof_path": "proof.jpg"}, `"ok":true`},
		{http.MethodPost, "/api/wallet/rider-deposits", map[string]any{"amount_usd": 10.00, "payment_method": "ecocash", "phone_number": "0770000000", "reference": "ABC123", "proof_path": "proof.jpg"}, `"ok":true`},
		{http.MethodPost, "/api/wallet/withdraw", map[string]any{"amount": 10.00, "method": "ecocash", "destination": "0770000000", "account_name": "Name"}, `"ok":true`},
		{http.MethodPost, "/api/wallet/transfer", map[string]any{"receiver_id": "receiver-1", "amount": 2.50, "note": "test"}, `"reference":"transfer-1"`},
		{http.MethodPost, "/api/wallet/pay", map[string]any{"ride_id": "ride-1"}, `"already_paid":false`},
		{http.MethodPost, "/api/wallet/pay-ride", map[string]any{"ride_id": "ride-1"}, `"amount":5`},
		{http.MethodPost, "/api/wallet/pin", map[string]any{"pin": "1234"}, `"ok":true`},
		{http.MethodGet, "/api/wallet/lookup-user?pickme_account=PM123456", nil, `"pickme_account":"PM123456"`},
		{http.MethodPost, "/api/wallet/lookup-user", map[string]any{"pickme_account": "PM123456"}, `"full_name":"Lookup User"`},
		{http.MethodGet, "/api/wallet/driver/summary", nil, `"available_balance":10`},
		{http.MethodGet, "/api/wallet/driver/earnings", nil, `"driver_earning":8.5`},
	}
	for _, tt := range tests {
		resp := walletHTTPTestRequest(t, app, tt.method, tt.path, tt.body)
		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			t.Fatalf("expected %s %s to succeed, got %d body=%s", tt.method, tt.path, resp.StatusCode, string(readHTTPBody(t, resp)))
		}
		body := string(readHTTPBody(t, resp))
		if !strings.Contains(body, tt.want) {
			t.Fatalf("expected %s %s response to contain %s, got %s", tt.method, tt.path, tt.want, body)
		}
		if strings.Contains(body, "amount_minor") || strings.Contains(body, "driver_earning_minor") || strings.Contains(body, "available_balance_minor") {
			t.Fatalf("frontend response must not expose minor-unit fields: %s", body)
		}
	}
}

func TestRideSettlementCompatibilityEndpoint(t *testing.T) {
	app := fiber.New()
	RegisterOperationRoutes(app, &fakeFlowService{}, &fakeRideAuthorizationService{}, &fakeWalletReconciliationService{}, &fakePilotService{}, &fakeRecoveryService{}, fakeOpsReports{}, authAs("rider-1", "authenticated"))

	resp := walletHTTPTestRequest(t, app, http.MethodGet, "/api/rides/ride-1/settlement", nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected settlement fetch to return 200, got %d", resp.StatusCode)
	}
	body := string(readHTTPBody(t, resp))
	if !strings.Contains(body, `"ride_id":"ride-1"`) || strings.Contains(body, "_minor") {
		t.Fatalf("unexpected settlement response: %s", body)
	}
}

func TestNonAdminApprovalRejected(t *testing.T) {
	flow := &fakeFlowService{}
	app := fiber.New()
	RegisterOperationRoutes(app, flow, &fakeRideAuthorizationService{}, &fakeWalletReconciliationService{}, &fakePilotService{}, &fakeRecoveryService{}, fakeOpsReports{}, authAs("user-1", "authenticated"))
	resp := walletHTTPTestRequest(t, app, http.MethodPost, "/admin/wallets/deposits/deposit-1/approve", map[string]any{"reason": "ok"})
	assertAdminNotAuthorized(t, resp)
	if flow.approved {
		t.Fatal("non-admin request must not approve deposit")
	}
}

func TestWalletAdminRoutesRequireAdminRole(t *testing.T) {
	for _, tc := range []struct {
		name string
		role string
	}{
		{name: "rider", role: "authenticated"},
		{name: "driver", role: "driver"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			app := fiber.New()
			RegisterOperationRoutes(app, &fakeFlowService{}, &fakeRideAuthorizationService{}, &fakeWalletReconciliationService{}, &fakePilotService{}, &fakeRecoveryService{}, fakeOpsReports{}, authAs(tc.name+"-1", tc.role))

			resp := walletHTTPTestRequest(t, app, http.MethodGet, "/admin/wallets/deposits/pending", nil)
			assertAdminNotAuthorized(t, resp)
		})
	}
}

func TestAdminApprovalEndpointAllowsAdmin(t *testing.T) {
	flow := &fakeFlowService{}
	app := fiber.New()
	RegisterOperationRoutes(app, flow, &fakeRideAuthorizationService{}, &fakeWalletReconciliationService{}, &fakePilotService{}, &fakeRecoveryService{}, fakeOpsReports{}, authAs("admin-1", "admin"))
	resp := walletHTTPTestRequest(t, app, http.MethodPost, "/admin/wallets/deposits/deposit-1/approve", map[string]any{"reason": "verified"})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}
	if !flow.approved {
		t.Fatal("expected admin approval to call service")
	}
}

func TestRideCaptureAndReleaseRequireAdmin(t *testing.T) {
	authz := &fakeRideAuthorizationService{}
	app := fiber.New()
	RegisterOperationRoutes(app, &fakeFlowService{}, authz, &fakeWalletReconciliationService{}, &fakePilotService{}, &fakeRecoveryService{}, fakeOpsReports{}, authAs("user-1", "authenticated"))

	capture := walletHTTPTestRequest(t, app, http.MethodPost, "/api/wallets/capture-ride", map[string]any{"ride_id": "ride-1"})
	if capture.StatusCode != http.StatusForbidden {
		t.Fatalf("expected non-admin capture to be forbidden, got %d", capture.StatusCode)
	}
	release := walletHTTPTestRequest(t, app, http.MethodPost, "/api/wallets/release-ride", map[string]any{"ride_id": "ride-1"})
	if release.StatusCode != http.StatusForbidden {
		t.Fatalf("expected non-admin release to be forbidden, got %d", release.StatusCode)
	}
	if authz.captured || authz.released {
		t.Fatal("non-admin capture/release must not call authorization service")
	}
}

func TestAdminCanCaptureAndReleaseRideAuthorization(t *testing.T) {
	authz := &fakeRideAuthorizationService{}
	app := fiber.New()
	RegisterOperationRoutes(app, &fakeFlowService{}, authz, &fakeWalletReconciliationService{}, &fakePilotService{}, &fakeRecoveryService{}, fakeOpsReports{}, authAs("admin-1", "admin"))

	capture := walletHTTPTestRequest(t, app, http.MethodPost, "/api/wallets/capture-ride", map[string]any{"ride_id": "ride-1", "rider_id": "rider-1", "driver_id": "driver-1"})
	if capture.StatusCode != http.StatusOK {
		t.Fatalf("expected admin capture 200, got %d", capture.StatusCode)
	}
	release := walletHTTPTestRequest(t, app, http.MethodPost, "/api/wallets/release-ride", map[string]any{"ride_id": "ride-2", "rider_id": "rider-1", "reason": "cancelled"})
	if release.StatusCode != http.StatusOK {
		t.Fatalf("expected admin release 200, got %d", release.StatusCode)
	}
	if !authz.captured || !authz.released {
		t.Fatal("expected admin capture and release to call authorization service")
	}
}

func TestAdminReconciliationAndAuthorizationReports(t *testing.T) {
	reconciliation := &fakeWalletReconciliationService{}
	app := fiber.New()
	RegisterOperationRoutes(app, &fakeFlowService{}, &fakeRideAuthorizationService{}, reconciliation, &fakePilotService{}, &fakeRecoveryService{}, fakeOpsReports{}, authAs("admin-1", "admin"))

	paths := []struct {
		method string
		path   string
	}{
		{http.MethodGet, "/admin/wallets/reconciliation/summary"},
		{http.MethodGet, "/admin/wallets/reconciliation/drift"},
		{http.MethodGet, "/admin/wallets/authorizations/open"},
		{http.MethodGet, "/admin/wallets/authorizations/expired"},
		{http.MethodGet, "/admin/finance/hardening/summary"},
		{http.MethodPost, "/admin/wallets/reconciliation/run"},
	}
	for _, tt := range paths {
		resp := walletHTTPTestRequest(t, app, tt.method, tt.path, nil)
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("expected %s %s to return 200, got %d", tt.method, tt.path, resp.StatusCode)
		}
	}
	if !reconciliation.ran {
		t.Fatal("expected admin reconciliation run endpoint to call service")
	}
}

func TestPilotGateBlocksNonPilotWalletOperations(t *testing.T) {
	flow := &fakeFlowService{}
	app := fiber.New()
	RegisterOperationRoutes(app, flow, &fakeRideAuthorizationService{}, &fakeWalletReconciliationService{}, &fakePilotService{enabled: true, eligible: false}, &fakeRecoveryService{}, fakeOpsReports{}, authAs("user-1", "authenticated"))

	resp := walletHTTPTestRequest(t, app, http.MethodPost, "/api/wallets/deposits", map[string]any{"amount": 10, "currency": CurrencyUSD, "method": ManualMethodCash, "idempotency_key": "deposit-key-1"})
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("expected non-pilot wallet operation to be forbidden, got %d", resp.StatusCode)
	}
	if flow.deposits != 0 {
		t.Fatal("pilot gate must block deposit before calling flow service")
	}
}

func TestWalletPilotErrorsUseRequiredHTTPContract(t *testing.T) {
	for _, tt := range []struct {
		name       string
		err        error
		wantStatus int
		wantBody   string
	}{
		{name: "unauthorized", err: ErrWalletPilotNotAuthorized, wantStatus: http.StatusForbidden, wantBody: "wallet_pilot_not_authorized"},
		{name: "limit", err: ErrWalletPilotLimitExceeded, wantStatus: http.StatusForbidden, wantBody: "wallet_pilot_limit_exceeded"},
		{name: "disabled", err: ErrWalletPilotDisabled, wantStatus: http.StatusLocked, wantBody: "wallet_pilot_disabled"},
	} {
		t.Run(tt.name, func(t *testing.T) {
			app := fiber.New()
			RegisterOperationRoutes(app, &fakeFlowService{err: tt.err}, &fakeRideAuthorizationService{}, &fakeWalletReconciliationService{}, &fakePilotService{}, &fakeRecoveryService{}, fakeOpsReports{}, authAs("user-1", "authenticated"))

			resp := walletHTTPTestRequest(t, app, http.MethodPost, "/api/wallets/deposits", map[string]any{"amount": 10, "currency": CurrencyUSD, "method": ManualMethodCash, "city": WalletPilotCityGwanda, "idempotency_key": "deposit-key-1"})
			if resp.StatusCode != tt.wantStatus {
				t.Fatalf("expected %d, got %d", tt.wantStatus, resp.StatusCode)
			}
			if !strings.Contains(string(readHTTPBody(t, resp)), tt.wantBody) {
				t.Fatalf("expected %s response", tt.wantBody)
			}
		})
	}
}

func TestAdminPilotReportsAndControls(t *testing.T) {
	pilot := &fakePilotService{enabled: true, eligible: true}
	app := fiber.New()
	RegisterOperationRoutes(app, &fakeFlowService{}, &fakeRideAuthorizationService{}, &fakeWalletReconciliationService{}, pilot, &fakeRecoveryService{}, fakeOpsReports{}, authAs("admin-1", "admin"))

	paths := []string{
		"/admin/wallets/pilot/summary",
		"/admin/wallets/pilot/users",
		"/admin/wallets/pilot/failures",
		"/admin/wallets/pilot/reconciliation",
	}
	for _, path := range paths {
		resp := walletHTTPTestRequest(t, app, http.MethodGet, path, nil)
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("expected %s to return 200, got %d", path, resp.StatusCode)
		}
	}

	controls := []struct {
		path   string
		status string
	}{
		{"/admin/wallets/pilot/users/user-1/enable", PilotStatusEnabled},
		{"/admin/wallets/pilot/users/user-1/disable", PilotStatusDisabled},
		{"/admin/wallets/pilot/users/user-1/suspend", PilotStatusSuspended},
		{"/admin/wallets/pilot/users/user-1/remove", PilotStatusRemoved},
	}
	for _, control := range controls {
		resp := walletHTTPTestRequest(t, app, http.MethodPost, control.path, map[string]any{"role": PilotRoleRider, "reason": "pilot test"})
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("expected %s to return 200, got %d", control.path, resp.StatusCode)
		}
		if got := pilot.changes[len(pilot.changes)-1].Status; got != control.status {
			t.Fatalf("expected pilot status %s, got %s", control.status, got)
		}
	}
	if len(pilot.changes) != len(controls) {
		t.Fatalf("expected %d audited pilot changes, got %d", len(controls), len(pilot.changes))
	}
}

func TestAdminFinancialRecoveryReportsAndControls(t *testing.T) {
	recovery := &fakeRecoveryService{}
	app := fiber.New()
	RegisterOperationRoutes(app, &fakeFlowService{}, &fakeRideAuthorizationService{}, &fakeWalletReconciliationService{}, &fakePilotService{}, recovery, fakeOpsReports{}, authAs("admin-1", "admin"))

	getPaths := []string{
		"/admin/finance/recovery/summary",
		"/admin/finance/refunds",
		"/admin/finance/chargebacks",
		"/admin/finance/disputes",
		"/admin/finance/incidents",
		"/admin/finance/provider-statements",
		"/admin/finance/provider-statements/lines",
		"/admin/finance/runbooks",
		"/admin/finance/reliability/summary",
		"/admin/finance/certifications",
		"/admin/finance/certifications/checks",
		"/admin/finance/recovery-drills",
		"/admin/finance/recovery-drills/events",
		"/admin/finance/recovery-scorecards",
		"/admin/finance/governance/summary",
		"/admin/finance/approvals",
		"/admin/finance/launch-gates",
		"/admin/finance/close-runs",
		"/admin/finance/signoffs",
		"/admin/finance/launch-readiness-scorecards",
		"/admin/finance/release-readiness",
		"/admin/finance/release-evidence",
		"/admin/finance/release-scorecards",
		"/admin/finance/executive-signoff",
		"/admin/finance/launch-blockers",
		"/admin/finance/internal-launch-status",
		"/admin/finance/drill-evidence",
		"/admin/finance/exceptions",
		"/admin/finance/reliability-scorecards",
		"/admin/finance/control-room",
		"/admin/finance/daily-close",
		"/admin/finance/pilot-monitoring",
		"/admin/finance/day1-close",
		"/admin/finance/pilot-status",
		"/admin/finance/go-no-go",
		"/admin/finance/pilot-authorization",
		"/admin/finance/pilot-readiness",
		"/admin/finance/internal-pilot-board",
		"/admin/finance/internal-pilot-authorization",
		"/admin/finance/internal-pilot-health",
		"/admin/finance/internal-pilot-incidents",
		"/admin/finance/internal-pilot-participants",
		"/admin/finance/internal-pilot-kill-switches",
		"/admin/finance/internal-pilot-readiness",
		"/admin/finance/internal-pilot-evidence",
		"/admin/finance/internal-pilot-objectives",
		"/admin/finance/internal-pilot-summary",
		"/admin/finance/internal-pilot-compliance",
		"/admin/finance/internal-pilot-board-review",
		"/admin/finance/internal-pilot-findings",
		"/admin/finance/internal-pilot-readiness-assessment",
		"/admin/finance/internal-pilot-board-recommendation",
		"/admin/finance/internal-pilot-review-summary",
		"/admin/finance/public-wallet-pilot",
		"/admin/finance/public-wallet-pilot-participants",
		"/admin/finance/public-wallet-pilot-transactions",
		"/admin/finance/public-wallet-pilot-reconciliation",
		"/admin/finance/public-wallet-pilot-fraud",
		"/admin/finance/public-wallet-pilot-evidence",
		"/admin/pilot/cohort",
		"/admin/pilot/transactions",
		"/admin/pilot/monitoring",
		"/admin/pilot/daily-report",
	}
	for _, path := range getPaths {
		resp := walletHTTPTestRequest(t, app, http.MethodGet, path, nil)
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("expected %s to return 200, got %d", path, resp.StatusCode)
		}
	}

	postCases := []struct {
		path string
		body any
	}{
		{"/admin/finance/refunds", map[string]any{"provider": ProviderOneMoney, "amount": 10, "currency": CurrencyUSD, "reason": "duplicate", "idempotency_key": "refund-key-1"}},
		{"/admin/finance/chargebacks", map[string]any{"provider": ProviderCard, "provider_chargeback_id": "cb-1", "amount": 10, "currency": CurrencyUSD}},
		{"/admin/finance/disputes", map[string]any{"dispute_type": "refund", "reason": "rider complaint"}},
		{"/admin/finance/disputes/dispute-1/status", map[string]any{"status": DisputeStatusUnderReview, "resolution": "assigned"}},
		{"/admin/finance/incidents", map[string]any{"severity": "high", "incident_type": "provider_reconciliation", "title": "statement mismatch"}},
		{"/admin/finance/provider-statements/import", map[string]any{"provider": ProviderOneMoney, "statement_reference": "stmt-1", "lines": []map[string]any{{"line_reference": "line-1", "provider_reference": "OM-1", "line_type": "deposit", "amount": 10, "amount_minor": 1000, "currency": CurrencyUSD, "status": "posted"}}}},
		{"/admin/finance/provider-statements/statement-1/reconcile", map[string]any{"provider": ProviderOneMoney}},
		{"/admin/finance/certifications/onemoney/start", map[string]any{"certification_type": "mobile_money"}},
		{"/admin/finance/recovery-drills", map[string]any{"drill_type": "settlement_failure", "provider": "internal"}},
		{"/admin/finance/recovery-scorecards", map[string]any{"provider": "internal", "score_type": "overall", "score": 90, "status": "green", "period_start": "2026-06-01T00:00:00Z", "period_end": "2026-06-03T00:00:00Z"}},
		{"/admin/finance/approvals", map[string]any{"approval_type": "finance", "target_type": "launch_gate", "target_id": "gate-1", "required_approval_count": 2}},
		{"/admin/finance/approvals/approval-1/decision", map[string]any{"approver_role": "finance", "decision": "approved", "reason": "reviewed"}},
		{"/admin/finance/launch-gates", map[string]any{"gate_key": "public-payments", "gate_type": "public_payment_activation", "status": LaunchGateStatusBlocked, "readiness_score": 80}},
		{"/admin/finance/launch-gates/gate-1/evaluate", map[string]any{}},
		{"/admin/finance/close-runs", map[string]any{"close_type": "daily", "period_start": "2026-06-01T00:00:00Z", "period_end": "2026-06-02T00:00:00Z"}},
		{"/admin/finance/signoffs", map[string]any{"signoff_type": "finance", "target_type": "finance_close", "target_id": "close-1", "status": "signed"}},
		{"/admin/finance/launch-readiness-scorecards", map[string]any{"score": 80, "status": "yellow", "public_payments_ready": false, "provider_activation_ready": false, "finance_close_ready": true, "dual_approval_ready": true, "recovery_drills_ready": true}},
	}
	for _, tt := range postCases {
		resp := walletHTTPTestRequest(t, app, http.MethodPost, tt.path, tt.body)
		if resp.StatusCode != http.StatusCreated && resp.StatusCode != http.StatusOK {
			t.Fatalf("expected %s to return 2xx, got %d", tt.path, resp.StatusCode)
		}
	}
	if recovery.refunds != 1 || recovery.chargebacks != 1 || recovery.disputes != 2 || recovery.incidents != 1 || recovery.imports != 1 || recovery.reconciles != 1 || recovery.certifications != 1 || recovery.drills != 1 || recovery.scorecards != 1 || recovery.approvals != 1 || recovery.approvalEvents != 1 || recovery.launchGates != 2 || recovery.closeRuns != 1 || recovery.signoffs != 1 || recovery.readiness != 1 {
		t.Fatalf("unexpected recovery service calls: %#v", recovery)
	}
}

func TestFrontendAdminCompatibilityAliases(t *testing.T) {
	app := fiber.New()
	RegisterOperationRoutes(app, &fakeFlowService{}, &fakeRideAuthorizationService{}, &fakeWalletReconciliationService{}, &fakePilotService{}, &fakeRecoveryService{}, fakeOpsReports{}, authAs("admin-1", "admin"))

	getPaths := []string{
		"/api/wallets/deposits",
		"/api/wallets/driver/summary",
		"/api/wallets/driver/earnings",
		"/admin/wallets/deposits",
		"/admin/wallets/withdrawals",
		"/admin/finance/wallet-dashboard",
		"/admin/finance/earnings",
		"/admin/finance/ledger",
		"/admin/finance/settlements/summary",
		"/admin/finance/health",
	}
	for _, path := range getPaths {
		resp := walletHTTPTestRequest(t, app, http.MethodGet, path, nil)
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("expected %s to return 200, got %d body=%s", path, resp.StatusCode, string(readHTTPBody(t, resp)))
		}
	}

	postCases := []struct {
		path string
		body any
	}{
		{"/api/wallets/transfer", map[string]any{"receiver_id": "receiver-1", "amount": 2.50}},
		{"/api/wallets/pay", map[string]any{"ride_id": "ride-1"}},
		{"/api/wallets/pin", map[string]any{"pin": "1234"}},
		{"/admin/finance/fraud-flags", map[string]any{"user_id": "user-1", "reason": "manual review", "severity": "medium"}},
		{"/admin/finance/fraud-flags/flag-1/resolve", nil},
		{"/admin/finance/fx-rate", map[string]any{"zar_per_usd": 18.5}},
		{"/admin/finance/low-balance-reminders", nil},
		{"/admin/wallets/users/user-1/lock", map[string]any{"reason": "risk review"}},
		{"/admin/wallets/users/user-1/unlock", nil},
	}
	for _, tt := range postCases {
		resp := walletHTTPTestRequest(t, app, http.MethodPost, tt.path, tt.body)
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("expected %s to return 200, got %d body=%s", tt.path, resp.StatusCode, string(readHTTPBody(t, resp)))
		}
	}

	reverse := walletHTTPTestRequest(t, app, http.MethodPost, "/admin/wallets/transactions/tx-1/reverse", map[string]any{"reason": "audit"})
	if reverse.StatusCode != http.StatusNotImplemented {
		t.Fatalf("expected reversal compatibility route to be explicit 501, got %d", reverse.StatusCode)
	}
}

func authAs(userID string, role string) fiber.Handler {
	return func(c *fiber.Ctx) error {
		c.Locals(middleware.LocalsAuthSubject, userID)
		c.Locals(middleware.LocalsAuthRole, role)
		return c.Next()
	}
}

func assertAdminNotAuthorized(t *testing.T, resp *http.Response) {
	t.Helper()
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("expected 403, got %d", resp.StatusCode)
	}
	var body map[string]string
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if body["error"] != "admin_not_authorized" {
		t.Fatalf("expected admin_not_authorized, got %#v", body)
	}
}

func walletHTTPTestRequest(t *testing.T, app *fiber.App, method string, path string, body any) *http.Response {
	t.Helper()
	var reader *bytes.Reader
	if body != nil {
		payload, err := json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
		reader = bytes.NewReader(payload)
	} else {
		reader = bytes.NewReader(nil)
	}
	req := httptest.NewRequest(method, path, reader)
	req.Header.Set("Content-Type", "application/json")
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	return resp
}

func readHTTPBody(t *testing.T, resp *http.Response) []byte {
	t.Helper()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatal(err)
	}
	return body
}
