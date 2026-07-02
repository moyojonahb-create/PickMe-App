package wallet

import (
	"context"
	"encoding/json"
	"errors"
	"strconv"
	"strings"

	"github.com/gofiber/fiber/v2"

	"pickme-backend/internal/middleware"
	"pickme-backend/internal/observability"
)

type FlowService interface {
	CreateDeposit(ctx context.Context, req DepositRequest) (PaymentIntent, error)
	ApproveDeposit(ctx context.Context, decision AdminDecision) (PaymentIntent, error)
	RejectDeposit(ctx context.Context, decision AdminDecision) (PaymentIntent, error)
	CreateWithdrawal(ctx context.Context, req WithdrawalCreateRequest) (WithdrawalRequest, error)
	ApproveWithdrawal(ctx context.Context, decision AdminDecision) (WithdrawalRequest, error)
	RejectWithdrawal(ctx context.Context, decision AdminDecision) (WithdrawalRequest, error)
	CreateTransfer(ctx context.Context, req TransferRequest) (TransferResult, error)
	PayRide(ctx context.Context, req WalletPayRequest) (WalletPayResult, error)
	SetWalletPIN(ctx context.Context, req WalletPINRequest) error
	LookupUser(ctx context.Context, pickmeAccount string) (LookupUserResult, error)
	DriverSummary(ctx context.Context, driverID string) (map[string]any, error)
	DriverEarnings(ctx context.Context, driverID string, limit int) ([]map[string]any, error)
}

type RideAuthorizationService interface {
	AuthorizeRideFunds(ctx context.Context, req AuthorizationRequest) (WalletAuthorization, error)
	CaptureRideFunds(ctx context.Context, req CaptureRequest) (SettlementRecord, error)
	ReleaseRideFunds(ctx context.Context, req ReleaseRequest) (WalletAuthorization, error)
}

type WalletReconciliationService interface {
	RunWalletReconciliation(ctx context.Context) (WalletReconciliationResult, error)
}

type WalletPilotService interface {
	Enabled() bool
	IsPilotEligible(ctx context.Context, userID string, role string) bool
	SetPilotUser(ctx context.Context, change PilotUserChange) (PilotUser, error)
}

type FinancialRecoveryService interface {
	CreateRefundIntent(ctx context.Context, refund RefundIntent) (RefundIntent, error)
	CreateChargeback(ctx context.Context, chargeback ChargebackRecord) (ChargebackRecord, error)
	OpenDispute(ctx context.Context, dispute FinancialDispute) (FinancialDispute, error)
	UpdateDisputeStatus(ctx context.Context, disputeID string, status string, adminID string, resolution string) (FinancialDispute, error)
	CreateFinancialIncident(ctx context.Context, incident FinancialIncident) (FinancialIncident, error)
	ImportProviderStatement(ctx context.Context, req ProviderStatementImportRequest) (ProviderStatementImport, error)
	RunProviderStatementReconciliation(ctx context.Context, importID string, provider string) (ReconciliationRun, error)
	StartProviderCertification(ctx context.Context, provider string, certificationType string, adminID string) (ProviderCertification, error)
	RunRecoveryDrill(ctx context.Context, drillType string, provider string, adminID string) (RecoveryDrill, error)
	RecordRecoveryScorecard(ctx context.Context, scorecard RecoveryScorecard) (RecoveryScorecard, error)
	CreateFinanceApprovalRequest(ctx context.Context, request FinanceApprovalRequest) (FinanceApprovalRequest, error)
	RecordFinanceApproval(ctx context.Context, event FinanceApprovalEvent) (FinanceApprovalRequest, error)
	CreateLaunchGate(ctx context.Context, gate LaunchGate) (LaunchGate, error)
	EvaluateLaunchGate(ctx context.Context, gateID string, adminID string) (LaunchGate, error)
	CreateFinanceCloseRun(ctx context.Context, run FinanceCloseRun) (FinanceCloseRun, error)
	CreateFinanceSignoff(ctx context.Context, signoff FinanceSignoff) (FinanceSignoff, error)
	CreateLaunchReadinessScorecard(ctx context.Context, scorecard LaunchReadinessScorecard) (LaunchReadinessScorecard, error)
	CollectReleaseEvidence(ctx context.Context, evidence []ReleaseEvidenceRecord) ([]ReleaseEvidenceRecord, error)
	RunLaunchGateDrill(ctx context.Context, drill LaunchGateDrill) (LaunchGateDrill, error)
	CreateFinalReadinessScorecard(ctx context.Context, scorecard FinalReadinessScorecard) (FinalReadinessScorecard, error)
}

type OperationsReportReader interface {
	WalletState(ctx context.Context, userID string) ([]map[string]any, error)
	WalletTransactions(ctx context.Context, userID string, limit int) ([]map[string]any, error)
	WalletDeposits(ctx context.Context, userID string, limit int) ([]map[string]any, error)
	DepositDetail(ctx context.Context, userID string, id string) (map[string]any, error)
	WithdrawalDetail(ctx context.Context, driverID string, id string) (map[string]any, error)
	RideSettlement(ctx context.Context, rideID string, userID string) (map[string]any, error)
	PendingDeposits(ctx context.Context, limit int) ([]map[string]any, error)
	PendingWithdrawals(ctx context.Context, limit int) ([]map[string]any, error)
	AdminActions(ctx context.Context, limit int) ([]map[string]any, error)
	ReconciliationSummary(ctx context.Context) (map[string]any, error)
	ReconciliationDrift(ctx context.Context, limit int) ([]map[string]any, error)
	OpenAuthorizations(ctx context.Context, limit int) ([]map[string]any, error)
	ExpiredAuthorizations(ctx context.Context, limit int) ([]map[string]any, error)
	PilotSummary(ctx context.Context) (map[string]any, error)
	PilotUsers(ctx context.Context, limit int) ([]map[string]any, error)
	PilotFailures(ctx context.Context, limit int) ([]map[string]any, error)
	PilotReconciliation(ctx context.Context, limit int) ([]map[string]any, error)
	FinancialHardeningSummary(ctx context.Context) (map[string]any, error)
	FinancialRecoverySummary(ctx context.Context) (map[string]any, error)
	RefundIntents(ctx context.Context, limit int) ([]map[string]any, error)
	Chargebacks(ctx context.Context, limit int) ([]map[string]any, error)
	FinancialDisputes(ctx context.Context, limit int) ([]map[string]any, error)
	FinancialIncidents(ctx context.Context, limit int) ([]map[string]any, error)
	ProviderStatementImports(ctx context.Context, limit int) ([]map[string]any, error)
	ProviderStatementLines(ctx context.Context, limit int) ([]map[string]any, error)
	FinancialRunbooks(ctx context.Context, limit int) ([]map[string]any, error)
	FinancialReliabilitySummary(ctx context.Context) (map[string]any, error)
	ProviderCertifications(ctx context.Context, limit int) ([]map[string]any, error)
	ProviderCertificationChecks(ctx context.Context, limit int) ([]map[string]any, error)
	RecoveryDrills(ctx context.Context, limit int) ([]map[string]any, error)
	RecoveryDrillEvents(ctx context.Context, limit int) ([]map[string]any, error)
	RecoveryScorecards(ctx context.Context, limit int) ([]map[string]any, error)
	FinanceGovernanceSummary(ctx context.Context) (map[string]any, error)
	FinanceApprovalRequests(ctx context.Context, limit int) ([]map[string]any, error)
	LaunchGates(ctx context.Context, limit int) ([]map[string]any, error)
	FinanceCloseRuns(ctx context.Context, limit int) ([]map[string]any, error)
	FinanceSignoffs(ctx context.Context, limit int) ([]map[string]any, error)
	LaunchReadinessScorecards(ctx context.Context, limit int) ([]map[string]any, error)
	ReleaseReadinessSummary(ctx context.Context) (map[string]any, error)
	ReleaseEvidence(ctx context.Context, limit int) ([]map[string]any, error)
	ReleaseScorecards(ctx context.Context, limit int) ([]map[string]any, error)
	ExecutiveSignoffSummary(ctx context.Context) (map[string]any, error)
	LaunchBlockers(ctx context.Context, limit int) ([]map[string]any, error)
	InternalLaunchStatus(ctx context.Context) (map[string]any, error)
	DrillEvidence(ctx context.Context, limit int) ([]map[string]any, error)
	ProductionExceptions(ctx context.Context, limit int) ([]map[string]any, error)
	ReliabilityScorecards(ctx context.Context, limit int) ([]map[string]any, error)
	FinanceControlRoom(ctx context.Context) (map[string]any, error)
	DailyCloseReports(ctx context.Context, limit int) ([]map[string]any, error)
	PilotMonitoringReport(ctx context.Context) (map[string]any, error)
	Day1CloseReport(ctx context.Context) (map[string]any, error)
	PilotStatusReport(ctx context.Context) (map[string]any, error)
	GoNoGoReport(ctx context.Context) (map[string]any, error)
	PilotAuthorizationReport(ctx context.Context) (map[string]any, error)
	PilotReadinessReport(ctx context.Context) (map[string]any, error)
	InternalPilotBoardReport(ctx context.Context) (map[string]any, error)
	InternalPilotAuthorizationReport(ctx context.Context) (map[string]any, error)
	InternalPilotHealthReport(ctx context.Context) (map[string]any, error)
	InternalPilotIncidents(ctx context.Context, limit int) ([]map[string]any, error)
	InternalPilotParticipants(ctx context.Context, limit int) ([]map[string]any, error)
	InternalPilotKillSwitches(ctx context.Context, limit int) ([]map[string]any, error)
	InternalPilotReadinessReport(ctx context.Context) (map[string]any, error)
	InternalPilotEvidence(ctx context.Context, limit int) ([]map[string]any, error)
	InternalPilotObjectives(ctx context.Context, limit int) ([]map[string]any, error)
	InternalPilotSummary(ctx context.Context) (map[string]any, error)
	InternalPilotCompliance(ctx context.Context) (map[string]any, error)
	InternalPilotBoardReview(ctx context.Context) (map[string]any, error)
	InternalPilotFindings(ctx context.Context, limit int) ([]map[string]any, error)
	InternalPilotReadinessAssessment(ctx context.Context, limit int) ([]map[string]any, error)
	InternalPilotBoardRecommendation(ctx context.Context) (map[string]any, error)
	InternalPilotReviewSummary(ctx context.Context) (map[string]any, error)
	PublicWalletPilotReport(ctx context.Context) (map[string]any, error)
	PublicWalletPilotParticipants(ctx context.Context, limit int) ([]map[string]any, error)
	PublicWalletPilotTransactions(ctx context.Context, limit int) ([]map[string]any, error)
	PublicWalletPilotReconciliation(ctx context.Context, limit int) ([]map[string]any, error)
	PublicWalletPilotFraud(ctx context.Context, limit int) ([]map[string]any, error)
	PublicWalletPilotEvidence(ctx context.Context) (map[string]any, error)
}

func RegisterOperationRoutes(app fiber.Router, service FlowService, authorizations RideAuthorizationService, reconciliation WalletReconciliationService, pilot WalletPilotService, recovery FinancialRecoveryService, reports OperationsReportReader, requireAuth fiber.Handler) {
	app.Post("/api/wallets/deposits", requireAuth, requirePilot(pilot, PilotRoleRider), createDepositHandler(service))
	app.Get("/api/wallets/deposits", requireAuth, frontendWalletDepositsHandler(reports))
	app.Get("/api/wallets/deposits/:id", requireAuth, depositDetailHandler(reports))
	app.Get("/api/wallets/me", requireAuth, walletStateHandler(reports))
	app.Get("/api/wallets/me/transactions", requireAuth, walletTransactionsHandler(reports))
	app.Post("/api/wallets/withdrawals", requireAuth, requirePilot(pilot, PilotRoleDriver), createWithdrawalHandler(service))
	app.Get("/api/wallets/withdrawals/:id", requireAuth, withdrawalDetailHandler(reports))
	app.Post("/api/wallets/transfer", requireAuth, requirePilot(pilot, PilotRoleRider), frontendTransferHandler(service))
	app.Post("/api/wallets/pay", requireAuth, requirePilot(pilot, PilotRoleRider), frontendPayRideHandler(service))
	app.Post("/api/wallets/pin", requireAuth, frontendPINHandler(service))
	app.Get("/api/wallets/lookup-user", requireAuth, frontendLookupUserGetHandler(service))
	app.Get("/api/wallets/driver/summary", requireAuth, frontendDriverSummaryHandler(service))
	app.Get("/api/wallets/driver/earnings", requireAuth, frontendDriverEarningsHandler(service))
	app.Post("/api/wallets/authorize-ride", requireAuth, requirePilot(pilot, PilotRoleRider), authorizeRideHandler(authorizations))
	app.Post("/api/wallets/capture-ride", requireAuth, middleware.AdminOnly(), captureRideHandler(authorizations))
	app.Post("/api/wallets/release-ride", requireAuth, middleware.AdminOnly(), releaseRideHandler(authorizations))

	app.Get("/api/wallet/me", requireAuth, frontendWalletStateHandler(reports))
	app.Get("/api/wallet/transactions", requireAuth, frontendWalletTransactionsHandler(reports))
	app.Get("/api/wallet/deposits", requireAuth, frontendWalletDepositsHandler(reports))
	app.Post("/api/wallet/deposit", requireAuth, requirePilot(pilot, PilotRoleRider), frontendDepositHandler(service))
	app.Post("/api/wallet/rider-deposits", requireAuth, requirePilot(pilot, PilotRoleRider), frontendRiderDepositHandler(service))
	app.Post("/api/wallet/withdraw", requireAuth, requirePilot(pilot, PilotRoleDriver), frontendWithdrawalHandler(service))
	app.Post("/api/wallet/withdrawals", requireAuth, requirePilot(pilot, PilotRoleDriver), frontendWithdrawalHandler(service))
	app.Post("/api/wallet/transfer", requireAuth, requirePilot(pilot, PilotRoleRider), frontendTransferHandler(service))
	app.Post("/api/wallet/pay", requireAuth, requirePilot(pilot, PilotRoleRider), frontendPayRideHandler(service))
	app.Post("/api/wallet/pay-ride", requireAuth, requirePilot(pilot, PilotRoleRider), frontendPayRideHandler(service))
	app.Post("/api/wallet/pin", requireAuth, frontendPINHandler(service))
	app.Get("/api/wallet/lookup-user", requireAuth, frontendLookupUserGetHandler(service))
	app.Post("/api/wallet/lookup-user", requireAuth, frontendLookupUserPostHandler(service))
	app.Get("/api/wallet/driver/summary", requireAuth, frontendDriverSummaryHandler(service))
	app.Get("/api/wallet/driver/earnings", requireAuth, frontendDriverEarningsHandler(service))
	app.Get("/api/rides/:tripId/settlement", requireAuth, frontendRideSettlementHandler(reports))

	app.Get("/admin/wallets/deposits", requireAuth, middleware.AdminOnly(), pendingDepositsHandler(reports))
	app.Get("/admin/wallets/deposits/pending", requireAuth, middleware.AdminOnly(), pendingDepositsHandler(reports))
	app.Post("/admin/wallets/deposits/:id/approve", requireAuth, middleware.AdminOnly(), approveDepositHandler(service))
	app.Post("/admin/wallets/deposits/:id/reject", requireAuth, middleware.AdminOnly(), rejectDepositHandler(service))
	app.Get("/admin/wallets/withdrawals", requireAuth, middleware.AdminOnly(), pendingWithdrawalsHandler(reports))
	app.Get("/admin/wallets/withdrawals/pending", requireAuth, middleware.AdminOnly(), pendingWithdrawalsHandler(reports))
	app.Post("/admin/wallets/withdrawals/:id/approve", requireAuth, middleware.AdminOnly(), approveWithdrawalHandler(service))
	app.Post("/admin/wallets/withdrawals/:id/reject", requireAuth, middleware.AdminOnly(), rejectWithdrawalHandler(service))
	app.Post("/admin/wallets/users/:userId/lock", requireAuth, middleware.AdminOnly(), adminLockWalletHandler(reports))
	app.Post("/admin/wallets/users/:userId/unlock", requireAuth, middleware.AdminOnly(), adminUnlockWalletHandler(reports))
	app.Post("/admin/wallets/transactions/:txId/reverse", requireAuth, middleware.AdminOnly(), adminReverseTransactionHandler())
	app.Get("/admin/wallets/admin-actions", requireAuth, middleware.AdminOnly(), adminActionsHandler(reports))
	app.Get("/admin/wallets/reconciliation/summary", requireAuth, middleware.AdminOnly(), reconciliationSummaryHandler(reports))
	app.Get("/admin/wallets/reconciliation/drift", requireAuth, middleware.AdminOnly(), reconciliationDriftHandler(reports))
	app.Post("/admin/wallets/reconciliation/run", requireAuth, middleware.AdminOnly(), runReconciliationHandler(reconciliation))
	app.Get("/admin/wallets/authorizations/open", requireAuth, middleware.AdminOnly(), openAuthorizationsHandler(reports))
	app.Get("/admin/wallets/authorizations/expired", requireAuth, middleware.AdminOnly(), expiredAuthorizationsHandler(reports))
	app.Get("/admin/wallets/pilot/summary", requireAuth, middleware.AdminOnly(), pilotSummaryHandler(reports))
	app.Get("/admin/wallets/pilot/users", requireAuth, middleware.AdminOnly(), pilotUsersHandler(reports))
	app.Get("/admin/wallets/pilot/failures", requireAuth, middleware.AdminOnly(), pilotFailuresHandler(reports))
	app.Get("/admin/wallets/pilot/reconciliation", requireAuth, middleware.AdminOnly(), pilotReconciliationHandler(reports))
	app.Post("/admin/wallets/pilot/users/:userId/enable", requireAuth, middleware.AdminOnly(), pilotUserControlHandler(pilot, PilotStatusEnabled))
	app.Post("/admin/wallets/pilot/users/:userId/disable", requireAuth, middleware.AdminOnly(), pilotUserControlHandler(pilot, PilotStatusDisabled))
	app.Post("/admin/wallets/pilot/users/:userId/suspend", requireAuth, middleware.AdminOnly(), pilotUserControlHandler(pilot, PilotStatusSuspended))
	app.Post("/admin/wallets/pilot/users/:userId/remove", requireAuth, middleware.AdminOnly(), pilotUserControlHandler(pilot, PilotStatusRemoved))
	app.Get("/admin/finance/wallet-dashboard", requireAuth, middleware.AdminOnly(), adminWalletDashboardHandler(reports))
	app.Get("/admin/finance/earnings", requireAuth, middleware.AdminOnly(), adminFinanceEarningsHandler(reports))
	app.Get("/admin/finance/ledger", requireAuth, middleware.AdminOnly(), adminFinanceLedgerHandler(reports))
	app.Get("/admin/finance/settlements/summary", requireAuth, middleware.AdminOnly(), adminFinanceSettlementsSummaryHandler(reports))
	app.Get("/admin/finance/health", requireAuth, middleware.AdminOnly(), adminFinanceHealthHandler(reports))
	app.Post("/admin/finance/fx-rate", requireAuth, middleware.AdminOnly(), adminSetFXRateHandler(reports))
	app.Post("/admin/finance/fraud-flags", requireAuth, middleware.AdminOnly(), adminCreateFraudFlagHandler(reports))
	app.Post("/admin/finance/fraud-flags/:id/resolve", requireAuth, middleware.AdminOnly(), adminResolveFraudFlagHandler(reports))
	app.Post("/admin/finance/low-balance-reminders", requireAuth, middleware.AdminOnly(), adminLowBalanceRemindersHandler())
	app.Get("/admin/finance/hardening/summary", requireAuth, middleware.AdminOnly(), financialHardeningSummaryHandler(reports))
	app.Get("/admin/finance/recovery/summary", requireAuth, middleware.AdminOnly(), financialRecoverySummaryHandler(reports))
	app.Get("/admin/finance/refunds", requireAuth, middleware.AdminOnly(), refundIntentsHandler(reports))
	app.Post("/admin/finance/refunds", requireAuth, middleware.AdminOnly(), createRefundIntentHandler(recovery))
	app.Get("/admin/finance/chargebacks", requireAuth, middleware.AdminOnly(), chargebacksHandler(reports))
	app.Post("/admin/finance/chargebacks", requireAuth, middleware.AdminOnly(), createChargebackHandler(recovery))
	app.Get("/admin/finance/disputes", requireAuth, middleware.AdminOnly(), financialDisputesHandler(reports))
	app.Post("/admin/finance/disputes", requireAuth, middleware.AdminOnly(), openDisputeHandler(recovery))
	app.Post("/admin/finance/disputes/:id/status", requireAuth, middleware.AdminOnly(), updateDisputeStatusHandler(recovery))
	app.Get("/admin/finance/incidents", requireAuth, middleware.AdminOnly(), financialIncidentsHandler(reports))
	app.Post("/admin/finance/incidents", requireAuth, middleware.AdminOnly(), createFinancialIncidentHandler(recovery))
	app.Get("/admin/finance/provider-statements", requireAuth, middleware.AdminOnly(), providerStatementImportsHandler(reports))
	app.Get("/admin/finance/provider-statements/lines", requireAuth, middleware.AdminOnly(), providerStatementLinesHandler(reports))
	app.Post("/admin/finance/provider-statements/import", requireAuth, middleware.AdminOnly(), importProviderStatementHandler(recovery))
	app.Post("/admin/finance/provider-statements/:id/reconcile", requireAuth, middleware.AdminOnly(), reconcileProviderStatementHandler(recovery))
	app.Get("/admin/finance/runbooks", requireAuth, middleware.AdminOnly(), financialRunbooksHandler(reports))
	app.Get("/admin/finance/reliability/summary", requireAuth, middleware.AdminOnly(), financialReliabilitySummaryHandler(reports))
	app.Get("/admin/finance/certifications", requireAuth, middleware.AdminOnly(), providerCertificationsHandler(reports))
	app.Get("/admin/finance/certifications/checks", requireAuth, middleware.AdminOnly(), providerCertificationChecksHandler(reports))
	app.Post("/admin/finance/certifications/:provider/start", requireAuth, middleware.AdminOnly(), startProviderCertificationHandler(recovery))
	app.Get("/admin/finance/recovery-drills", requireAuth, middleware.AdminOnly(), recoveryDrillsHandler(reports))
	app.Get("/admin/finance/recovery-drills/events", requireAuth, middleware.AdminOnly(), recoveryDrillEventsHandler(reports))
	app.Post("/admin/finance/recovery-drills", requireAuth, middleware.AdminOnly(), runRecoveryDrillHandler(recovery))
	app.Get("/admin/finance/recovery-scorecards", requireAuth, middleware.AdminOnly(), recoveryScorecardsHandler(reports))
	app.Post("/admin/finance/recovery-scorecards", requireAuth, middleware.AdminOnly(), recordRecoveryScorecardHandler(recovery))
	app.Get("/admin/finance/governance/summary", requireAuth, middleware.AdminOnly(), financeGovernanceSummaryHandler(reports))
	app.Get("/admin/finance/approvals", requireAuth, middleware.AdminOnly(), financeApprovalRequestsHandler(reports))
	app.Post("/admin/finance/approvals", requireAuth, middleware.AdminOnly(), createFinanceApprovalRequestHandler(recovery))
	app.Post("/admin/finance/approvals/:id/decision", requireAuth, middleware.AdminOnly(), recordFinanceApprovalHandler(recovery))
	app.Get("/admin/finance/launch-gates", requireAuth, middleware.AdminOnly(), launchGatesHandler(reports))
	app.Post("/admin/finance/launch-gates", requireAuth, middleware.AdminOnly(), createLaunchGateHandler(recovery))
	app.Post("/admin/finance/launch-gates/:id/evaluate", requireAuth, middleware.AdminOnly(), evaluateLaunchGateHandler(recovery))
	app.Get("/admin/finance/close-runs", requireAuth, middleware.AdminOnly(), financeCloseRunsHandler(reports))
	app.Post("/admin/finance/close-runs", requireAuth, middleware.AdminOnly(), createFinanceCloseRunHandler(recovery))
	app.Get("/admin/finance/signoffs", requireAuth, middleware.AdminOnly(), financeSignoffsHandler(reports))
	app.Post("/admin/finance/signoffs", requireAuth, middleware.AdminOnly(), createFinanceSignoffHandler(recovery))
	app.Get("/admin/finance/launch-readiness-scorecards", requireAuth, middleware.AdminOnly(), launchReadinessScorecardsHandler(reports))
	app.Post("/admin/finance/launch-readiness-scorecards", requireAuth, middleware.AdminOnly(), createLaunchReadinessScorecardHandler(recovery))
	app.Get("/admin/finance/release-readiness", requireAuth, middleware.AdminOnly(), releaseReadinessSummaryHandler(reports))
	app.Get("/admin/finance/release-evidence", requireAuth, middleware.AdminOnly(), releaseEvidenceHandler(reports))
	app.Get("/admin/finance/release-scorecards", requireAuth, middleware.AdminOnly(), releaseScorecardsHandler(reports))
	app.Get("/admin/finance/executive-signoff", requireAuth, middleware.AdminOnly(), executiveSignoffSummaryHandler(reports))
	app.Get("/admin/finance/launch-blockers", requireAuth, middleware.AdminOnly(), launchBlockersHandler(reports))
	app.Get("/admin/finance/internal-launch-status", requireAuth, middleware.AdminOnly(), internalLaunchStatusHandler(reports))
	app.Get("/admin/finance/drill-evidence", requireAuth, middleware.AdminOnly(), drillEvidenceHandler(reports))
	app.Get("/admin/finance/exceptions", requireAuth, middleware.AdminOnly(), productionExceptionsHandler(reports))
	app.Get("/admin/finance/reliability-scorecards", requireAuth, middleware.AdminOnly(), reliabilityScorecardsHandler(reports))
	app.Get("/admin/finance/control-room", requireAuth, middleware.AdminOnly(), financeControlRoomHandler(reports))
	app.Get("/admin/finance/daily-close", requireAuth, middleware.AdminOnly(), dailyCloseReportsHandler(reports))
	app.Get("/admin/finance/pilot-monitoring", requireAuth, middleware.AdminOnly(), pilotMonitoringReportHandler(reports))
	app.Get("/admin/finance/day1-close", requireAuth, middleware.AdminOnly(), day1CloseReportHandler(reports))
	app.Get("/admin/finance/pilot-status", requireAuth, middleware.AdminOnly(), pilotStatusReportHandler(reports))
	app.Get("/admin/finance/go-no-go", requireAuth, middleware.AdminOnly(), goNoGoReportHandler(reports))
	app.Get("/admin/finance/pilot-authorization", requireAuth, middleware.AdminOnly(), pilotAuthorizationReportHandler(reports))
	app.Get("/admin/finance/pilot-readiness", requireAuth, middleware.AdminOnly(), pilotReadinessReportHandler(reports))
	app.Get("/admin/finance/internal-pilot-board", requireAuth, middleware.AdminOnly(), internalPilotBoardReportHandler(reports))
	app.Get("/admin/finance/internal-pilot-authorization", requireAuth, middleware.AdminOnly(), internalPilotAuthorizationReportHandler(reports))
	app.Get("/admin/finance/internal-pilot-health", requireAuth, middleware.AdminOnly(), internalPilotHealthReportHandler(reports))
	app.Get("/admin/finance/internal-pilot-incidents", requireAuth, middleware.AdminOnly(), internalPilotIncidentsHandler(reports))
	app.Get("/admin/finance/internal-pilot-participants", requireAuth, middleware.AdminOnly(), internalPilotParticipantsHandler(reports))
	app.Get("/admin/finance/internal-pilot-kill-switches", requireAuth, middleware.AdminOnly(), internalPilotKillSwitchesHandler(reports))
	app.Get("/admin/finance/internal-pilot-readiness", requireAuth, middleware.AdminOnly(), internalPilotReadinessReportHandler(reports))
	app.Get("/admin/finance/internal-pilot-evidence", requireAuth, middleware.AdminOnly(), internalPilotEvidenceHandler(reports))
	app.Get("/admin/finance/internal-pilot-objectives", requireAuth, middleware.AdminOnly(), internalPilotObjectivesHandler(reports))
	app.Get("/admin/finance/internal-pilot-summary", requireAuth, middleware.AdminOnly(), internalPilotSummaryHandler(reports))
	app.Get("/admin/finance/internal-pilot-compliance", requireAuth, middleware.AdminOnly(), internalPilotComplianceHandler(reports))
	app.Get("/admin/finance/internal-pilot-board-review", requireAuth, middleware.AdminOnly(), internalPilotBoardReviewHandler(reports))
	app.Get("/admin/finance/internal-pilot-findings", requireAuth, middleware.AdminOnly(), internalPilotFindingsHandler(reports))
	app.Get("/admin/finance/internal-pilot-readiness-assessment", requireAuth, middleware.AdminOnly(), internalPilotReadinessAssessmentHandler(reports))
	app.Get("/admin/finance/internal-pilot-board-recommendation", requireAuth, middleware.AdminOnly(), internalPilotBoardRecommendationHandler(reports))
	app.Get("/admin/finance/internal-pilot-review-summary", requireAuth, middleware.AdminOnly(), internalPilotReviewSummaryHandler(reports))
	app.Get("/admin/finance/public-wallet-pilot", requireAuth, middleware.AdminOnly(), publicWalletPilotReportHandler(reports))
	app.Get("/admin/finance/public-wallet-pilot-participants", requireAuth, middleware.AdminOnly(), publicWalletPilotParticipantsHandler(reports))
	app.Get("/admin/finance/public-wallet-pilot-transactions", requireAuth, middleware.AdminOnly(), publicWalletPilotTransactionsHandler(reports))
	app.Get("/admin/finance/public-wallet-pilot-reconciliation", requireAuth, middleware.AdminOnly(), publicWalletPilotReconciliationHandler(reports))
	app.Get("/admin/finance/public-wallet-pilot-fraud", requireAuth, middleware.AdminOnly(), publicWalletPilotFraudHandler(reports))
	app.Get("/admin/finance/public-wallet-pilot-evidence", requireAuth, middleware.AdminOnly(), publicWalletPilotEvidenceHandler(reports))
	app.Get("/admin/pilot/cohort", requireAuth, middleware.AdminOnly(), publicWalletPilotParticipantsHandler(reports))
	app.Get("/admin/pilot/transactions", requireAuth, middleware.AdminOnly(), publicWalletPilotTransactionsHandler(reports))
	app.Get("/admin/pilot/monitoring", requireAuth, middleware.AdminOnly(), publicWalletPilotReportHandler(reports))
	app.Get("/admin/pilot/daily-report", requireAuth, middleware.AdminOnly(), publicWalletPilotEvidenceHandler(reports))
}

func authorizeRideHandler(service RideAuthorizationService) fiber.Handler {
	return func(c *fiber.Ctx) error {
		riderID, ok := middleware.AuthenticatedUserID(c)
		if !ok {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Authentication required"})
		}
		var body struct {
			RideID         string          `json:"ride_id"`
			Amount         json.RawMessage `json:"amount"`
			Currency       string          `json:"currency"`
			City           string          `json:"city"`
			IdempotencyKey string          `json:"idempotency_key"`
		}
		if err := c.BodyParser(&body); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request body"})
		}
		amountMinor, err := parseHTTPAmountMinor(body.Amount, body.Currency)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid amount"})
		}
		result, err := service.AuthorizeRideFunds(middleware.RequestContext(c), AuthorizationRequest{RideID: body.RideID, RiderID: riderID, AmountMinor: amountMinor, Currency: body.Currency, City: body.City, IdempotencyKey: body.IdempotencyKey})
		return walletResult(c, fiber.StatusCreated, result, err)
	}
}

func captureRideHandler(service RideAuthorizationService) fiber.Handler {
	return func(c *fiber.Ctx) error {
		var body struct {
			RideID         string          `json:"ride_id"`
			RiderID        string          `json:"rider_id"`
			DriverID       string          `json:"driver_id"`
			Amount         json.RawMessage `json:"amount"`
			Currency       string          `json:"currency"`
			City           string          `json:"city"`
			IdempotencyKey string          `json:"idempotency_key"`
		}
		if err := c.BodyParser(&body); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request body"})
		}
		var amountMinor int64
		if len(body.Amount) > 0 && string(body.Amount) != "null" {
			parsedAmount, err := parseHTTPAmountMinor(body.Amount, body.Currency)
			if err != nil {
				return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid amount"})
			}
			amountMinor = parsedAmount
		}
		result, err := service.CaptureRideFunds(middleware.RequestContext(c), CaptureRequest{RideID: body.RideID, RiderID: body.RiderID, DriverID: body.DriverID, AmountMinor: amountMinor, Currency: body.Currency, City: body.City, IdempotencyKey: body.IdempotencyKey})
		return walletResult(c, fiber.StatusOK, result, err)
	}
}

func releaseRideHandler(service RideAuthorizationService) fiber.Handler {
	return func(c *fiber.Ctx) error {
		var body struct {
			RideID         string `json:"ride_id"`
			RiderID        string `json:"rider_id"`
			Reason         string `json:"reason"`
			IdempotencyKey string `json:"idempotency_key"`
		}
		if err := c.BodyParser(&body); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request body"})
		}
		result, err := service.ReleaseRideFunds(middleware.RequestContext(c), ReleaseRequest{RideID: body.RideID, RiderID: body.RiderID, Reason: body.Reason, IdempotencyKey: body.IdempotencyKey})
		return walletResult(c, fiber.StatusOK, result, err)
	}
}

func createDepositHandler(service FlowService) fiber.Handler {
	return func(c *fiber.Ctx) error {
		userID, ok := middleware.AuthenticatedUserID(c)
		if !ok {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Authentication required"})
		}
		var body struct {
			Amount            json.RawMessage `json:"amount"`
			Currency          string          `json:"currency"`
			Method            string          `json:"method"`
			WalletAccountType string          `json:"wallet_account_type"`
			City              string          `json:"city"`
			IdempotencyKey    string          `json:"idempotency_key"`
		}
		if err := c.BodyParser(&body); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request body"})
		}
		amountMinor, err := parseHTTPAmountMinor(body.Amount, body.Currency)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid amount"})
		}
		result, err := service.CreateDeposit(middleware.RequestContext(c), DepositRequest{UserID: userID, WalletAccountType: body.WalletAccountType, AmountMinor: amountMinor, Currency: body.Currency, Method: body.Method, City: body.City, IdempotencyKey: body.IdempotencyKey})
		if err == nil {
			observability.RecordWalletDeposit()
		} else {
			observability.RecordWalletFailure("deposit")
			observability.CaptureError(err)
		}
		return walletResult(c, fiber.StatusCreated, result, err)
	}
}

func createWithdrawalHandler(service FlowService) fiber.Handler {
	return func(c *fiber.Ctx) error {
		driverID, ok := middleware.AuthenticatedUserID(c)
		if !ok {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Authentication required"})
		}
		var body struct {
			Amount               json.RawMessage `json:"amount"`
			Currency             string          `json:"currency"`
			Method               string          `json:"method"`
			City                 string          `json:"city"`
			DestinationReference string          `json:"destination_reference"`
			IdempotencyKey       string          `json:"idempotency_key"`
		}
		if err := c.BodyParser(&body); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request body"})
		}
		amountMinor, err := parseHTTPAmountMinor(body.Amount, body.Currency)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid amount"})
		}
		result, err := service.CreateWithdrawal(middleware.RequestContext(c), WithdrawalCreateRequest{DriverID: driverID, AmountMinor: amountMinor, Currency: body.Currency, Method: body.Method, City: body.City, DestinationReference: body.DestinationReference, IdempotencyKey: body.IdempotencyKey})
		if err == nil {
			observability.RecordWalletWithdrawal()
		} else {
			observability.RecordWalletFailure("withdrawal")
			observability.CaptureError(err)
		}
		return walletResult(c, fiber.StatusCreated, result, err)
	}
}

func frontendDepositHandler(service FlowService) fiber.Handler {
	return func(c *fiber.Ctx) error {
		userID, ok := middleware.AuthenticatedUserID(c)
		if !ok {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Authentication required"})
		}
		var body struct {
			AmountUSD        json.RawMessage `json:"amount_usd"`
			Amount           json.RawMessage `json:"amount"`
			EcoCashPhone     string          `json:"ecocash_phone"`
			EcoCashReference string          `json:"ecocash_reference"`
			ProofPath        string          `json:"proof_path"`
			IdempotencyKey   string          `json:"idempotency_key"`
		}
		if err := c.BodyParser(&body); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request body"})
		}
		rawAmount := body.AmountUSD
		if len(rawAmount) == 0 {
			rawAmount = body.Amount
		}
		amountMinor, err := parseHTTPAmountMinor(rawAmount, CurrencyUSD)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid amount"})
		}
		key := defaultString(body.IdempotencyKey, "frontend-deposit:"+userID+":"+body.EcoCashReference)
		result, err := service.CreateDeposit(middleware.RequestContext(c), DepositRequest{UserID: userID, WalletAccountType: AccountTypeRiderWallet, AmountMinor: amountMinor, Currency: CurrencyUSD, Method: ManualMethodEcoCash, IdempotencyKey: key})
		if err != nil {
			observability.RecordWalletFailure("deposit")
			observability.CaptureError(err)
			return walletResult(c, fiber.StatusCreated, nil, err)
		}
		observability.RecordWalletDeposit()
		return c.Status(fiber.StatusCreated).JSON(fiber.Map{"ok": true, "id": result.ID})
	}
}

func frontendRiderDepositHandler(service FlowService) fiber.Handler {
	return func(c *fiber.Ctx) error {
		userID, ok := middleware.AuthenticatedUserID(c)
		if !ok {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Authentication required"})
		}
		var body struct {
			AmountUSD      json.RawMessage `json:"amount_usd"`
			PaymentMethod  string          `json:"payment_method"`
			PhoneNumber    string          `json:"phone_number"`
			Reference      string          `json:"reference"`
			ProofPath      string          `json:"proof_path"`
			IdempotencyKey string          `json:"idempotency_key"`
		}
		if err := c.BodyParser(&body); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request body"})
		}
		amountMinor, err := parseHTTPAmountMinor(body.AmountUSD, CurrencyUSD)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid amount"})
		}
		key := defaultString(body.IdempotencyKey, "frontend-rider-deposit:"+userID+":"+body.Reference)
		result, err := service.CreateDeposit(middleware.RequestContext(c), DepositRequest{UserID: userID, WalletAccountType: AccountTypeRiderWallet, AmountMinor: amountMinor, Currency: CurrencyUSD, Method: frontendManualMethod(body.PaymentMethod), IdempotencyKey: key})
		if err != nil {
			observability.RecordWalletFailure("deposit")
			observability.CaptureError(err)
			return walletResult(c, fiber.StatusCreated, nil, err)
		}
		observability.RecordWalletDeposit()
		return c.Status(fiber.StatusCreated).JSON(fiber.Map{"ok": true, "id": result.ID})
	}
}

func frontendWithdrawalHandler(service FlowService) fiber.Handler {
	return func(c *fiber.Ctx) error {
		driverID, ok := middleware.AuthenticatedUserID(c)
		if !ok {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Authentication required"})
		}
		var body struct {
			Amount         json.RawMessage `json:"amount"`
			Method         string          `json:"method"`
			Destination    string          `json:"destination"`
			AccountName    string          `json:"account_name"`
			IdempotencyKey string          `json:"idempotency_key"`
		}
		if err := c.BodyParser(&body); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request body"})
		}
		amountMinor, err := parseHTTPAmountMinor(body.Amount, CurrencyUSD)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid amount"})
		}
		key := defaultString(body.IdempotencyKey, "frontend-withdrawal:"+driverID+":"+body.Destination+":"+MinorDecimalString(amountMinor, CurrencyUSD))
		result, err := service.CreateWithdrawal(middleware.RequestContext(c), WithdrawalCreateRequest{DriverID: driverID, AmountMinor: amountMinor, Currency: CurrencyUSD, Method: frontendManualMethod(body.Method), DestinationReference: body.Destination, IdempotencyKey: key})
		if err != nil {
			observability.RecordWalletFailure("withdrawal")
			observability.CaptureError(err)
			return walletResult(c, fiber.StatusCreated, nil, err)
		}
		observability.RecordWalletWithdrawal()
		return c.Status(fiber.StatusCreated).JSON(fiber.Map{"ok": true, "id": result.ID})
	}
}

func frontendTransferHandler(service FlowService) fiber.Handler {
	return func(c *fiber.Ctx) error {
		senderID, ok := middleware.AuthenticatedUserID(c)
		if !ok {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Authentication required"})
		}
		var body struct {
			ReceiverID     string          `json:"receiver_id"`
			Amount         json.RawMessage `json:"amount"`
			Note           string          `json:"note"`
			IdempotencyKey string          `json:"idempotency_key"`
		}
		if err := c.BodyParser(&body); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request body"})
		}
		amountMinor, err := parseHTTPAmountMinor(body.Amount, CurrencyUSD)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid amount"})
		}
		key := defaultString(body.IdempotencyKey, "frontend-transfer:"+senderID+":"+body.ReceiverID+":"+MinorDecimalString(amountMinor, CurrencyUSD))
		result, err := service.CreateTransfer(middleware.RequestContext(c), TransferRequest{SenderID: senderID, ReceiverID: body.ReceiverID, AmountMinor: amountMinor, Currency: CurrencyUSD, Note: body.Note, IdempotencyKey: key})
		if err != nil {
			observability.RecordWalletFailure("transfer")
			observability.CaptureError(err)
			return walletResult(c, fiber.StatusOK, nil, err)
		}
		observability.RecordWalletTransfer()
		return c.JSON(fiber.Map{"ok": true, "amount": amountJSON(result.AmountMinor), "reference": result.Reference})
	}
}

func frontendPayRideHandler(service FlowService) fiber.Handler {
	return func(c *fiber.Ctx) error {
		ctx, span := observability.StartSpan(middleware.RequestContext(c), "Wallet Settlement")
		defer span.End()

		riderID, ok := middleware.AuthenticatedUserID(c)
		if !ok {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Authentication required"})
		}
		var body struct {
			RideID         string `json:"ride_id"`
			IdempotencyKey string `json:"idempotency_key"`
		}
		if err := c.BodyParser(&body); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request body"})
		}
		result, err := service.PayRide(ctx, WalletPayRequest{RiderID: riderID, RideID: body.RideID, IdempotencyKey: defaultString(body.IdempotencyKey, "frontend-pay-ride:"+body.RideID)})
		if err != nil {
			observability.RecordWalletFailure("settlement")
			observability.CaptureError(err)
			return walletResult(c, fiber.StatusOK, nil, err)
		}
		return c.JSON(fiber.Map{"ok": true, "amount": amountJSON(result.AmountMinor), "already_paid": result.AlreadyPaid, "reference": result.Reference})
	}
}

func frontendPINHandler(service FlowService) fiber.Handler {
	return func(c *fiber.Ctx) error {
		userID, ok := middleware.AuthenticatedUserID(c)
		if !ok {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Authentication required"})
		}
		var body struct {
			PIN            string `json:"pin"`
			IdempotencyKey string `json:"idempotency_key"`
		}
		if err := c.BodyParser(&body); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request body"})
		}
		if err := service.SetWalletPIN(middleware.RequestContext(c), WalletPINRequest{UserID: userID, PIN: body.PIN, IdempotencyKey: body.IdempotencyKey}); err != nil {
			return walletResult(c, fiber.StatusOK, nil, err)
		}
		return c.JSON(fiber.Map{"ok": true})
	}
}

func frontendLookupUserGetHandler(service FlowService) fiber.Handler {
	return func(c *fiber.Ctx) error {
		return frontendLookupUser(c, service, c.Query("pickme_account"))
	}
}

func frontendLookupUserPostHandler(service FlowService) fiber.Handler {
	return func(c *fiber.Ctx) error {
		var body struct {
			PickMeAccount string `json:"pickme_account"`
		}
		if err := c.BodyParser(&body); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request body"})
		}
		return frontendLookupUser(c, service, body.PickMeAccount)
	}
}

func frontendLookupUser(c *fiber.Ctx, service FlowService, pickmeAccount string) error {
	result, err := service.LookupUser(middleware.RequestContext(c), pickmeAccount)
	if err != nil {
		return walletResult(c, fiber.StatusOK, nil, err)
	}
	return c.JSON(fiber.Map{"user_id": result.UserID, "full_name": result.FullName, "pickme_account": result.PickMeAccount})
}

func frontendDriverSummaryHandler(service FlowService) fiber.Handler {
	return func(c *fiber.Ctx) error {
		driverID, _ := middleware.AuthenticatedUserID(c)
		result, err := service.DriverSummary(middleware.RequestContext(c), driverID)
		if err != nil {
			return walletResult(c, fiber.StatusOK, nil, err)
		}
		return c.JSON(frontendMoneyMap(result))
	}
}

func frontendDriverEarningsHandler(service FlowService) fiber.Handler {
	return func(c *fiber.Ctx) error {
		driverID, _ := middleware.AuthenticatedUserID(c)
		result, err := service.DriverEarnings(middleware.RequestContext(c), driverID, limitParam(c, 50))
		if err != nil {
			return walletResult(c, fiber.StatusOK, nil, err)
		}
		return c.JSON(frontendMoneyRows(result))
	}
}

func frontendWalletStateHandler(reports OperationsReportReader) fiber.Handler {
	return func(c *fiber.Ctx) error {
		userID, _ := middleware.AuthenticatedUserID(c)
		result, err := reports.WalletState(middleware.RequestContext(c), userID)
		if err != nil {
			return walletResult(c, fiber.StatusOK, nil, err)
		}
		return c.JSON(frontendMoneyRows(result))
	}
}

func frontendWalletTransactionsHandler(reports OperationsReportReader) fiber.Handler {
	return func(c *fiber.Ctx) error {
		userID, _ := middleware.AuthenticatedUserID(c)
		result, err := reports.WalletTransactions(middleware.RequestContext(c), userID, limitParam(c, 50))
		if err != nil {
			return walletResult(c, fiber.StatusOK, nil, err)
		}
		return c.JSON(frontendMoneyRows(result))
	}
}

func frontendWalletDepositsHandler(reports OperationsReportReader) fiber.Handler {
	return func(c *fiber.Ctx) error {
		userID, _ := middleware.AuthenticatedUserID(c)
		result, err := reports.WalletDeposits(middleware.RequestContext(c), userID, limitParam(c, 50))
		if err != nil {
			return walletResult(c, fiber.StatusOK, nil, err)
		}
		return c.JSON(frontendMoneyRows(result))
	}
}

func frontendRideSettlementHandler(reports OperationsReportReader) fiber.Handler {
	return func(c *fiber.Ctx) error {
		userID, _ := middleware.AuthenticatedUserID(c)
		result, err := reports.RideSettlement(middleware.RequestContext(c), c.Params("tripId"), userID)
		if err != nil {
			return walletResult(c, fiber.StatusOK, nil, err)
		}
		return c.JSON(frontendMoneyMap(result))
	}
}

func adminWalletDashboardHandler(reports OperationsReportReader) fiber.Handler {
	return func(c *fiber.Ctx) error {
		ctx := middleware.RequestContext(c)
		limit := limitParam(c, 50)
		deposits, err := reports.PendingDeposits(ctx, limit)
		if err != nil {
			return walletResult(c, fiber.StatusOK, nil, err)
		}
		withdrawals, err := reports.PendingWithdrawals(ctx, limit)
		if err != nil {
			return walletResult(c, fiber.StatusOK, nil, err)
		}
		flags := []map[string]any{}
		transactions := []map[string]any{}
		lockedWallets := []map[string]any{}
		if db, ok := reportsDB(reports); ok {
			flags, _ = rawRowsToMaps(queryJSONRows(ctx, db, `
				SELECT json_build_object(
					'id', id,
					'user_id', user_id,
					'flag_type', flag_type,
					'severity', severity,
					'resolved', resolved,
					'created_at', created_at
				)
				FROM public.fraud_flags
				ORDER BY created_at DESC
				LIMIT $1
			`, limit))
			transactions, _ = rawRowsToMaps(queryJSONRows(ctx, db, `
				SELECT json_build_object(
					'id', id,
					'transaction_type', transaction_type,
					'status', status,
					'total_amount', total_amount,
					'created_at', created_at
				)
				FROM public.wallet_transactions
				ORDER BY created_at DESC
				LIMIT $1
			`, limit))
			lockedWallets, _ = rawRowsToMaps(queryJSONRows(ctx, db, `
				SELECT json_build_object(
					'id', id,
					'user_id', user_id,
					'balance', balance,
					'is_locked', is_locked,
					'locked_reason', locked_reason,
					'locked_at', locked_at,
					'created_at', created_at,
					'updated_at', updated_at
				)
				FROM public.wallets
				WHERE COALESCE(is_locked, false) = true
				ORDER BY locked_at DESC NULLS LAST
				LIMIT $1
			`, limit))
		}
		return c.JSON(fiber.Map{
			"transactions":   frontendMoneyRows(transactions),
			"deposits":       frontendMoneyRows(deposits),
			"withdrawals":    frontendMoneyRows(withdrawals),
			"flags":          flags,
			"failed_rides":   []map[string]any{},
			"locked_wallets": frontendMoneyRows(lockedWallets),
		})
	}
}

func adminFinanceEarningsHandler(reports OperationsReportReader) fiber.Handler {
	return func(c *fiber.Ctx) error {
		db, ok := reportsDB(reports)
		if !ok {
			return c.JSON(fiber.Map{"earnings": []map[string]any{}})
		}
		rows, err := rawRowsToMaps(queryJSONRows(middleware.RequestContext(c), db, `
			SELECT json_build_object(
				'id', id,
				'ride_id', ride_id,
				'driver_id', driver_id,
				'fare_amount', fare_amount,
				'platform_fee', platform_fee,
				'driver_earnings', driver_earnings,
				'created_at', created_at
			)
			FROM public.admin_earnings
			ORDER BY created_at DESC
			LIMIT $1
		`, limitParam(c, 100)))
		if err != nil {
			return walletResult(c, fiber.StatusOK, nil, err)
		}
		return c.JSON(fiber.Map{"earnings": frontendMoneyRows(rows)})
	}
}

func adminFinanceLedgerHandler(reports OperationsReportReader) fiber.Handler {
	return func(c *fiber.Ctx) error {
		db, ok := reportsDB(reports)
		if !ok {
			return c.JSON(fiber.Map{"ledger": []map[string]any{}})
		}
		rows, err := rawRowsToMaps(queryJSONRows(middleware.RequestContext(c), db, `
			SELECT json_build_object(
				'id', id,
				'trip_id', trip_id,
				'driver_id', driver_id,
				'passenger_id', passenger_id,
				'amount', amount,
				'currency', currency,
				'status', status,
				'to_account_id', to_account_id,
				'created_at', created_at
			)
			FROM public.platform_ledger
			ORDER BY created_at DESC
			LIMIT $1
		`, limitParam(c, 200)))
		if err != nil {
			return walletResult(c, fiber.StatusOK, nil, err)
		}
		return c.JSON(fiber.Map{"ledger": frontendMoneyRows(rows)})
	}
}

func adminFinanceSettlementsSummaryHandler(reports OperationsReportReader) fiber.Handler {
	return func(c *fiber.Ctx) error {
		db, ok := reportsDB(reports)
		if !ok {
			return c.JSON(fiber.Map{"summary": fiber.Map{"totalSettlements": 0, "totalAmount": 0, "lastSettlementDate": nil}})
		}
		raw, err := queryJSON(middleware.RequestContext(c), db, `
			SELECT json_build_object(
				'totalSettlements', COUNT(*),
				'totalAmount', COALESCE(SUM(fare), 0),
				'lastSettlementDate', MAX(created_at)
			)
			FROM public.settlement_records
		`)
		if err != nil {
			return walletResult(c, fiber.StatusOK, nil, err)
		}
		result, err := rawToMap(raw)
		if err != nil {
			return walletResult(c, fiber.StatusOK, nil, err)
		}
		return c.JSON(fiber.Map{"summary": result})
	}
}

func adminFinanceHealthHandler(reports OperationsReportReader) fiber.Handler {
	return func(c *fiber.Ctx) error {
		ctx := middleware.RequestContext(c)
		deposits, _ := reports.PendingDeposits(ctx, 100)
		withdrawals, _ := reports.PendingWithdrawals(ctx, 100)
		return c.JSON(fiber.Map{
			"health": fiber.Map{
				"low_balance_drivers":             0,
				"pending_driver_deposits_over_2h": len(deposits),
				"pending_rider_deposits_over_2h":  len(deposits),
				"pending_withdrawals":             len(withdrawals),
			},
		})
	}
}

func adminCreateFraudFlagHandler(reports OperationsReportReader) fiber.Handler {
	return func(c *fiber.Ctx) error {
		db, ok := reportsDB(reports)
		if !ok {
			return c.JSON(fiber.Map{"ok": true, "stored": false})
		}
		var body struct {
			UserID   string `json:"user_id"`
			Reason   string `json:"reason"`
			Severity string `json:"severity"`
		}
		if err := c.BodyParser(&body); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request body"})
		}
		if body.UserID == "" || body.Reason == "" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "user_id and reason are required"})
		}
		severity := defaultString(body.Severity, "medium")
		_, err := db.Exec(middleware.RequestContext(c), `
			INSERT INTO public.fraud_flags (user_id, flag_type, severity, details)
			VALUES ($1, 'admin_flag', $2, jsonb_build_object('reason', $3))
		`, body.UserID, severity, body.Reason)
		if err != nil {
			return walletResult(c, fiber.StatusOK, nil, err)
		}
		return c.JSON(fiber.Map{"ok": true})
	}
}

func adminResolveFraudFlagHandler(reports OperationsReportReader) fiber.Handler {
	return func(c *fiber.Ctx) error {
		db, ok := reportsDB(reports)
		if !ok {
			return c.JSON(fiber.Map{"ok": true, "stored": false})
		}
		_, err := db.Exec(middleware.RequestContext(c), `
			UPDATE public.fraud_flags
			SET resolved = true, resolved_at = NOW()
			WHERE id = $1
		`, c.Params("id"))
		if err != nil {
			return walletResult(c, fiber.StatusOK, nil, err)
		}
		return c.JSON(fiber.Map{"ok": true})
	}
}

func adminSetFXRateHandler(reports OperationsReportReader) fiber.Handler {
	return func(c *fiber.Ctx) error {
		db, ok := reportsDB(reports)
		if !ok {
			return c.JSON(fiber.Map{"ok": true, "stored": false})
		}
		adminID, _ := middleware.AuthenticatedUserID(c)
		var body struct {
			ZARPerUSD float64 `json:"zar_per_usd"`
		}
		if err := c.BodyParser(&body); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request body"})
		}
		if body.ZARPerUSD <= 0 {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "zar_per_usd must be positive"})
		}
		_, err := db.Exec(middleware.RequestContext(c), `
			INSERT INTO public.fx_rates (zar_per_usd, effective_date, set_by)
			VALUES ($1, NOW(), $2)
		`, body.ZARPerUSD, adminID)
		if err != nil {
			return walletResult(c, fiber.StatusOK, nil, err)
		}
		return c.JSON(fiber.Map{"ok": true, "zar_per_usd": body.ZARPerUSD})
	}
}

func adminLowBalanceRemindersHandler() fiber.Handler {
	return func(c *fiber.Ctx) error {
		return c.JSON(fiber.Map{"ok": true, "sent": 0})
	}
}

func adminLockWalletHandler(reports OperationsReportReader) fiber.Handler {
	return func(c *fiber.Ctx) error {
		db, ok := reportsDB(reports)
		if !ok {
			return c.JSON(fiber.Map{"ok": true, "stored": false})
		}
		var body struct {
			Reason string `json:"reason"`
		}
		_ = c.BodyParser(&body)
		reason := defaultString(body.Reason, "admin lock")
		_, err := db.Exec(middleware.RequestContext(c), `
			UPDATE public.wallets
			SET is_locked = true, locked_reason = $2, locked_at = NOW(), updated_at = NOW()
			WHERE user_id = $1
		`, c.Params("userId"), reason)
		if err != nil {
			return walletResult(c, fiber.StatusOK, nil, err)
		}
		return c.JSON(fiber.Map{"ok": true})
	}
}

func adminUnlockWalletHandler(reports OperationsReportReader) fiber.Handler {
	return func(c *fiber.Ctx) error {
		db, ok := reportsDB(reports)
		if !ok {
			return c.JSON(fiber.Map{"ok": true, "stored": false})
		}
		_, err := db.Exec(middleware.RequestContext(c), `
			UPDATE public.wallets
			SET is_locked = false, locked_reason = NULL, locked_at = NULL, updated_at = NOW()
			WHERE user_id = $1
		`, c.Params("userId"))
		if err != nil {
			return walletResult(c, fiber.StatusOK, nil, err)
		}
		return c.JSON(fiber.Map{"ok": true})
	}
}

func adminReverseTransactionHandler() fiber.Handler {
	return func(c *fiber.Ctx) error {
		return c.Status(fiber.StatusNotImplemented).JSON(fiber.Map{
			"ok":    false,
			"error": "transaction reversal must use the ledger-backed recovery workflow",
		})
	}
}

func reportsDB(reports OperationsReportReader) (DB, bool) {
	postgres, ok := reports.(*PostgresReports)
	if !ok || postgres == nil || postgres.db == nil {
		return nil, false
	}
	return postgres.db, true
}

func approveDepositHandler(service FlowService) fiber.Handler {
	return func(c *fiber.Ctx) error {
		result, err := service.ApproveDeposit(middleware.RequestContext(c), adminDecision(c))
		return walletResult(c, fiber.StatusOK, result, err)
	}
}

func rejectDepositHandler(service FlowService) fiber.Handler {
	return func(c *fiber.Ctx) error {
		result, err := service.RejectDeposit(middleware.RequestContext(c), adminDecision(c))
		return walletResult(c, fiber.StatusOK, result, err)
	}
}

func approveWithdrawalHandler(service FlowService) fiber.Handler {
	return func(c *fiber.Ctx) error {
		result, err := service.ApproveWithdrawal(middleware.RequestContext(c), adminDecision(c))
		return walletResult(c, fiber.StatusOK, result, err)
	}
}

func rejectWithdrawalHandler(service FlowService) fiber.Handler {
	return func(c *fiber.Ctx) error {
		result, err := service.RejectWithdrawal(middleware.RequestContext(c), adminDecision(c))
		return walletResult(c, fiber.StatusOK, result, err)
	}
}

func walletStateHandler(reports OperationsReportReader) fiber.Handler {
	return func(c *fiber.Ctx) error {
		userID, _ := middleware.AuthenticatedUserID(c)
		result, err := reports.WalletState(middleware.RequestContext(c), userID)
		return walletResult(c, fiber.StatusOK, result, err)
	}
}

func walletTransactionsHandler(reports OperationsReportReader) fiber.Handler {
	return func(c *fiber.Ctx) error {
		userID, _ := middleware.AuthenticatedUserID(c)
		result, err := reports.WalletTransactions(middleware.RequestContext(c), userID, limitParam(c, 50))
		return walletResult(c, fiber.StatusOK, result, err)
	}
}

func depositDetailHandler(reports OperationsReportReader) fiber.Handler {
	return func(c *fiber.Ctx) error {
		userID, _ := middleware.AuthenticatedUserID(c)
		result, err := reports.DepositDetail(middleware.RequestContext(c), userID, c.Params("id"))
		return walletResult(c, fiber.StatusOK, result, err)
	}
}

func withdrawalDetailHandler(reports OperationsReportReader) fiber.Handler {
	return func(c *fiber.Ctx) error {
		driverID, _ := middleware.AuthenticatedUserID(c)
		result, err := reports.WithdrawalDetail(middleware.RequestContext(c), driverID, c.Params("id"))
		return walletResult(c, fiber.StatusOK, result, err)
	}
}

func pendingDepositsHandler(reports OperationsReportReader) fiber.Handler {
	return func(c *fiber.Ctx) error {
		result, err := reports.PendingDeposits(middleware.RequestContext(c), limitParam(c, 50))
		return walletResult(c, fiber.StatusOK, result, err)
	}
}

func pendingWithdrawalsHandler(reports OperationsReportReader) fiber.Handler {
	return func(c *fiber.Ctx) error {
		result, err := reports.PendingWithdrawals(middleware.RequestContext(c), limitParam(c, 50))
		return walletResult(c, fiber.StatusOK, result, err)
	}
}

func adminActionsHandler(reports OperationsReportReader) fiber.Handler {
	return func(c *fiber.Ctx) error {
		result, err := reports.AdminActions(middleware.RequestContext(c), limitParam(c, 50))
		return walletResult(c, fiber.StatusOK, result, err)
	}
}

func reconciliationSummaryHandler(reports OperationsReportReader) fiber.Handler {
	return func(c *fiber.Ctx) error {
		result, err := reports.ReconciliationSummary(middleware.RequestContext(c))
		return walletResult(c, fiber.StatusOK, result, err)
	}
}

func reconciliationDriftHandler(reports OperationsReportReader) fiber.Handler {
	return func(c *fiber.Ctx) error {
		result, err := reports.ReconciliationDrift(middleware.RequestContext(c), limitParam(c, 100))
		return walletResult(c, fiber.StatusOK, result, err)
	}
}

func runReconciliationHandler(service WalletReconciliationService) fiber.Handler {
	return func(c *fiber.Ctx) error {
		result, err := service.RunWalletReconciliation(middleware.RequestContext(c))
		return walletResult(c, fiber.StatusOK, result, err)
	}
}

func openAuthorizationsHandler(reports OperationsReportReader) fiber.Handler {
	return func(c *fiber.Ctx) error {
		result, err := reports.OpenAuthorizations(middleware.RequestContext(c), limitParam(c, 100))
		return walletResult(c, fiber.StatusOK, result, err)
	}
}

func expiredAuthorizationsHandler(reports OperationsReportReader) fiber.Handler {
	return func(c *fiber.Ctx) error {
		result, err := reports.ExpiredAuthorizations(middleware.RequestContext(c), limitParam(c, 100))
		return walletResult(c, fiber.StatusOK, result, err)
	}
}

func financialHardeningSummaryHandler(reports OperationsReportReader) fiber.Handler {
	return func(c *fiber.Ctx) error {
		result, err := reports.FinancialHardeningSummary(middleware.RequestContext(c))
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to load financial hardening summary"})
		}
		return c.JSON(result)
	}
}

func financialRecoverySummaryHandler(reports OperationsReportReader) fiber.Handler {
	return func(c *fiber.Ctx) error {
		result, err := reports.FinancialRecoverySummary(middleware.RequestContext(c))
		return walletResult(c, fiber.StatusOK, result, err)
	}
}

func refundIntentsHandler(reports OperationsReportReader) fiber.Handler {
	return func(c *fiber.Ctx) error {
		result, err := reports.RefundIntents(middleware.RequestContext(c), limitParam(c, 100))
		return walletResult(c, fiber.StatusOK, result, err)
	}
}

func createRefundIntentHandler(service FinancialRecoveryService) fiber.Handler {
	return func(c *fiber.Ctx) error {
		adminID, _ := middleware.AuthenticatedUserID(c)
		var body RefundIntent
		if err := c.BodyParser(&body); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request body"})
		}
		body.CreatedBy = adminID
		result, err := service.CreateRefundIntent(middleware.RequestContext(c), body)
		return walletResult(c, fiber.StatusCreated, result, err)
	}
}

func chargebacksHandler(reports OperationsReportReader) fiber.Handler {
	return func(c *fiber.Ctx) error {
		result, err := reports.Chargebacks(middleware.RequestContext(c), limitParam(c, 100))
		return walletResult(c, fiber.StatusOK, result, err)
	}
}

func createChargebackHandler(service FinancialRecoveryService) fiber.Handler {
	return func(c *fiber.Ctx) error {
		var body ChargebackRecord
		if err := c.BodyParser(&body); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request body"})
		}
		result, err := service.CreateChargeback(middleware.RequestContext(c), body)
		return walletResult(c, fiber.StatusCreated, result, err)
	}
}

func financialDisputesHandler(reports OperationsReportReader) fiber.Handler {
	return func(c *fiber.Ctx) error {
		result, err := reports.FinancialDisputes(middleware.RequestContext(c), limitParam(c, 100))
		return walletResult(c, fiber.StatusOK, result, err)
	}
}

func openDisputeHandler(service FinancialRecoveryService) fiber.Handler {
	return func(c *fiber.Ctx) error {
		adminID, _ := middleware.AuthenticatedUserID(c)
		var body FinancialDispute
		if err := c.BodyParser(&body); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request body"})
		}
		body.OpenedBy = adminID
		result, err := service.OpenDispute(middleware.RequestContext(c), body)
		return walletResult(c, fiber.StatusCreated, result, err)
	}
}

func updateDisputeStatusHandler(service FinancialRecoveryService) fiber.Handler {
	return func(c *fiber.Ctx) error {
		adminID, _ := middleware.AuthenticatedUserID(c)
		var body struct {
			Status     string `json:"status"`
			Resolution string `json:"resolution"`
		}
		if err := c.BodyParser(&body); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request body"})
		}
		result, err := service.UpdateDisputeStatus(middleware.RequestContext(c), c.Params("id"), body.Status, adminID, body.Resolution)
		return walletResult(c, fiber.StatusOK, result, err)
	}
}

func financialIncidentsHandler(reports OperationsReportReader) fiber.Handler {
	return func(c *fiber.Ctx) error {
		result, err := reports.FinancialIncidents(middleware.RequestContext(c), limitParam(c, 100))
		return walletResult(c, fiber.StatusOK, result, err)
	}
}

func createFinancialIncidentHandler(service FinancialRecoveryService) fiber.Handler {
	return func(c *fiber.Ctx) error {
		adminID, _ := middleware.AuthenticatedUserID(c)
		var body FinancialIncident
		if err := c.BodyParser(&body); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request body"})
		}
		body.OpenedBy = adminID
		result, err := service.CreateFinancialIncident(middleware.RequestContext(c), body)
		return walletResult(c, fiber.StatusCreated, result, err)
	}
}

func providerStatementImportsHandler(reports OperationsReportReader) fiber.Handler {
	return func(c *fiber.Ctx) error {
		result, err := reports.ProviderStatementImports(middleware.RequestContext(c), limitParam(c, 100))
		return walletResult(c, fiber.StatusOK, result, err)
	}
}

func providerStatementLinesHandler(reports OperationsReportReader) fiber.Handler {
	return func(c *fiber.Ctx) error {
		result, err := reports.ProviderStatementLines(middleware.RequestContext(c), limitParam(c, 100))
		return walletResult(c, fiber.StatusOK, result, err)
	}
}

func importProviderStatementHandler(service FinancialRecoveryService) fiber.Handler {
	return func(c *fiber.Ctx) error {
		adminID, _ := middleware.AuthenticatedUserID(c)
		var body ProviderStatementImportRequest
		if err := c.BodyParser(&body); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request body"})
		}
		body.ImportedBy = adminID
		result, err := service.ImportProviderStatement(middleware.RequestContext(c), body)
		return walletResult(c, fiber.StatusCreated, result, err)
	}
}

func reconcileProviderStatementHandler(service FinancialRecoveryService) fiber.Handler {
	return func(c *fiber.Ctx) error {
		var body struct {
			Provider string `json:"provider"`
		}
		_ = c.BodyParser(&body)
		result, err := service.RunProviderStatementReconciliation(middleware.RequestContext(c), c.Params("id"), body.Provider)
		return walletResult(c, fiber.StatusOK, result, err)
	}
}

func financialRunbooksHandler(reports OperationsReportReader) fiber.Handler {
	return func(c *fiber.Ctx) error {
		result, err := reports.FinancialRunbooks(middleware.RequestContext(c), limitParam(c, 50))
		return walletResult(c, fiber.StatusOK, result, err)
	}
}

func financialReliabilitySummaryHandler(reports OperationsReportReader) fiber.Handler {
	return func(c *fiber.Ctx) error {
		result, err := reports.FinancialReliabilitySummary(middleware.RequestContext(c))
		return walletResult(c, fiber.StatusOK, result, err)
	}
}

func providerCertificationsHandler(reports OperationsReportReader) fiber.Handler {
	return func(c *fiber.Ctx) error {
		result, err := reports.ProviderCertifications(middleware.RequestContext(c), limitParam(c, 100))
		return walletResult(c, fiber.StatusOK, result, err)
	}
}

func providerCertificationChecksHandler(reports OperationsReportReader) fiber.Handler {
	return func(c *fiber.Ctx) error {
		result, err := reports.ProviderCertificationChecks(middleware.RequestContext(c), limitParam(c, 100))
		return walletResult(c, fiber.StatusOK, result, err)
	}
}

func startProviderCertificationHandler(service FinancialRecoveryService) fiber.Handler {
	return func(c *fiber.Ctx) error {
		adminID, _ := middleware.AuthenticatedUserID(c)
		var body struct {
			CertificationType string `json:"certification_type"`
		}
		_ = c.BodyParser(&body)
		result, err := service.StartProviderCertification(middleware.RequestContext(c), c.Params("provider"), body.CertificationType, adminID)
		return walletResult(c, fiber.StatusCreated, result, err)
	}
}

func recoveryDrillsHandler(reports OperationsReportReader) fiber.Handler {
	return func(c *fiber.Ctx) error {
		result, err := reports.RecoveryDrills(middleware.RequestContext(c), limitParam(c, 100))
		return walletResult(c, fiber.StatusOK, result, err)
	}
}

func recoveryDrillEventsHandler(reports OperationsReportReader) fiber.Handler {
	return func(c *fiber.Ctx) error {
		result, err := reports.RecoveryDrillEvents(middleware.RequestContext(c), limitParam(c, 100))
		return walletResult(c, fiber.StatusOK, result, err)
	}
}

func runRecoveryDrillHandler(service FinancialRecoveryService) fiber.Handler {
	return func(c *fiber.Ctx) error {
		adminID, _ := middleware.AuthenticatedUserID(c)
		var body struct {
			DrillType string `json:"drill_type"`
			Provider  string `json:"provider"`
		}
		if err := c.BodyParser(&body); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request body"})
		}
		result, err := service.RunRecoveryDrill(middleware.RequestContext(c), body.DrillType, body.Provider, adminID)
		return walletResult(c, fiber.StatusCreated, result, err)
	}
}

func recoveryScorecardsHandler(reports OperationsReportReader) fiber.Handler {
	return func(c *fiber.Ctx) error {
		result, err := reports.RecoveryScorecards(middleware.RequestContext(c), limitParam(c, 100))
		return walletResult(c, fiber.StatusOK, result, err)
	}
}

func recordRecoveryScorecardHandler(service FinancialRecoveryService) fiber.Handler {
	return func(c *fiber.Ctx) error {
		var body RecoveryScorecard
		if err := c.BodyParser(&body); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request body"})
		}
		result, err := service.RecordRecoveryScorecard(middleware.RequestContext(c), body)
		return walletResult(c, fiber.StatusCreated, result, err)
	}
}

func financeGovernanceSummaryHandler(reports OperationsReportReader) fiber.Handler {
	return func(c *fiber.Ctx) error {
		result, err := reports.FinanceGovernanceSummary(middleware.RequestContext(c))
		return walletResult(c, fiber.StatusOK, result, err)
	}
}

func financeApprovalRequestsHandler(reports OperationsReportReader) fiber.Handler {
	return func(c *fiber.Ctx) error {
		result, err := reports.FinanceApprovalRequests(middleware.RequestContext(c), limitParam(c, 100))
		return walletResult(c, fiber.StatusOK, result, err)
	}
}

func createFinanceApprovalRequestHandler(service FinancialRecoveryService) fiber.Handler {
	return func(c *fiber.Ctx) error {
		adminID, _ := middleware.AuthenticatedUserID(c)
		var body FinanceApprovalRequest
		if err := c.BodyParser(&body); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request body"})
		}
		body.RequestedBy = adminID
		result, err := service.CreateFinanceApprovalRequest(middleware.RequestContext(c), body)
		return walletResult(c, fiber.StatusCreated, result, err)
	}
}

func recordFinanceApprovalHandler(service FinancialRecoveryService) fiber.Handler {
	return func(c *fiber.Ctx) error {
		adminID, _ := middleware.AuthenticatedUserID(c)
		var body FinanceApprovalEvent
		if err := c.BodyParser(&body); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request body"})
		}
		body.RequestID = c.Params("id")
		body.ApproverID = adminID
		result, err := service.RecordFinanceApproval(middleware.RequestContext(c), body)
		return walletResult(c, fiber.StatusOK, result, err)
	}
}

func launchGatesHandler(reports OperationsReportReader) fiber.Handler {
	return func(c *fiber.Ctx) error {
		result, err := reports.LaunchGates(middleware.RequestContext(c), limitParam(c, 100))
		return walletResult(c, fiber.StatusOK, result, err)
	}
}

func createLaunchGateHandler(service FinancialRecoveryService) fiber.Handler {
	return func(c *fiber.Ctx) error {
		adminID, _ := middleware.AuthenticatedUserID(c)
		var body LaunchGate
		if err := c.BodyParser(&body); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request body"})
		}
		body.CreatedBy = adminID
		result, err := service.CreateLaunchGate(middleware.RequestContext(c), body)
		return walletResult(c, fiber.StatusCreated, result, err)
	}
}

func evaluateLaunchGateHandler(service FinancialRecoveryService) fiber.Handler {
	return func(c *fiber.Ctx) error {
		adminID, _ := middleware.AuthenticatedUserID(c)
		result, err := service.EvaluateLaunchGate(middleware.RequestContext(c), c.Params("id"), adminID)
		return walletResult(c, fiber.StatusOK, result, err)
	}
}

func financeCloseRunsHandler(reports OperationsReportReader) fiber.Handler {
	return func(c *fiber.Ctx) error {
		result, err := reports.FinanceCloseRuns(middleware.RequestContext(c), limitParam(c, 100))
		return walletResult(c, fiber.StatusOK, result, err)
	}
}

func createFinanceCloseRunHandler(service FinancialRecoveryService) fiber.Handler {
	return func(c *fiber.Ctx) error {
		adminID, _ := middleware.AuthenticatedUserID(c)
		var body FinanceCloseRun
		if err := c.BodyParser(&body); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request body"})
		}
		body.OpenedBy = adminID
		result, err := service.CreateFinanceCloseRun(middleware.RequestContext(c), body)
		return walletResult(c, fiber.StatusCreated, result, err)
	}
}

func financeSignoffsHandler(reports OperationsReportReader) fiber.Handler {
	return func(c *fiber.Ctx) error {
		result, err := reports.FinanceSignoffs(middleware.RequestContext(c), limitParam(c, 100))
		return walletResult(c, fiber.StatusOK, result, err)
	}
}

func createFinanceSignoffHandler(service FinancialRecoveryService) fiber.Handler {
	return func(c *fiber.Ctx) error {
		adminID, _ := middleware.AuthenticatedUserID(c)
		var body FinanceSignoff
		if err := c.BodyParser(&body); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request body"})
		}
		body.SignerID = adminID
		result, err := service.CreateFinanceSignoff(middleware.RequestContext(c), body)
		return walletResult(c, fiber.StatusCreated, result, err)
	}
}

func launchReadinessScorecardsHandler(reports OperationsReportReader) fiber.Handler {
	return func(c *fiber.Ctx) error {
		result, err := reports.LaunchReadinessScorecards(middleware.RequestContext(c), limitParam(c, 100))
		return walletResult(c, fiber.StatusOK, result, err)
	}
}

func createLaunchReadinessScorecardHandler(service FinancialRecoveryService) fiber.Handler {
	return func(c *fiber.Ctx) error {
		adminID, _ := middleware.AuthenticatedUserID(c)
		var body LaunchReadinessScorecard
		if err := c.BodyParser(&body); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request body"})
		}
		body.CreatedBy = adminID
		result, err := service.CreateLaunchReadinessScorecard(middleware.RequestContext(c), body)
		return walletResult(c, fiber.StatusCreated, result, err)
	}
}

func releaseReadinessSummaryHandler(reports OperationsReportReader) fiber.Handler {
	return func(c *fiber.Ctx) error {
		result, err := reports.ReleaseReadinessSummary(middleware.RequestContext(c))
		return walletResult(c, fiber.StatusOK, result, err)
	}
}

func releaseEvidenceHandler(reports OperationsReportReader) fiber.Handler {
	return func(c *fiber.Ctx) error {
		result, err := reports.ReleaseEvidence(middleware.RequestContext(c), limitParam(c, 100))
		return walletResult(c, fiber.StatusOK, result, err)
	}
}

func releaseScorecardsHandler(reports OperationsReportReader) fiber.Handler {
	return func(c *fiber.Ctx) error {
		result, err := reports.ReleaseScorecards(middleware.RequestContext(c), limitParam(c, 100))
		return walletResult(c, fiber.StatusOK, result, err)
	}
}

func executiveSignoffSummaryHandler(reports OperationsReportReader) fiber.Handler {
	return func(c *fiber.Ctx) error {
		result, err := reports.ExecutiveSignoffSummary(middleware.RequestContext(c))
		return walletResult(c, fiber.StatusOK, result, err)
	}
}

func launchBlockersHandler(reports OperationsReportReader) fiber.Handler {
	return func(c *fiber.Ctx) error {
		result, err := reports.LaunchBlockers(middleware.RequestContext(c), limitParam(c, 100))
		return walletResult(c, fiber.StatusOK, result, err)
	}
}

func internalLaunchStatusHandler(reports OperationsReportReader) fiber.Handler {
	return func(c *fiber.Ctx) error {
		result, err := reports.InternalLaunchStatus(middleware.RequestContext(c))
		return walletResult(c, fiber.StatusOK, result, err)
	}
}

func drillEvidenceHandler(reports OperationsReportReader) fiber.Handler {
	return func(c *fiber.Ctx) error {
		result, err := reports.DrillEvidence(middleware.RequestContext(c), limitParam(c, 100))
		return walletResult(c, fiber.StatusOK, result, err)
	}
}

func productionExceptionsHandler(reports OperationsReportReader) fiber.Handler {
	return func(c *fiber.Ctx) error {
		result, err := reports.ProductionExceptions(middleware.RequestContext(c), limitParam(c, 100))
		return walletResult(c, fiber.StatusOK, result, err)
	}
}

func reliabilityScorecardsHandler(reports OperationsReportReader) fiber.Handler {
	return func(c *fiber.Ctx) error {
		result, err := reports.ReliabilityScorecards(middleware.RequestContext(c), limitParam(c, 100))
		return walletResult(c, fiber.StatusOK, result, err)
	}
}

func financeControlRoomHandler(reports OperationsReportReader) fiber.Handler {
	return func(c *fiber.Ctx) error {
		result, err := reports.FinanceControlRoom(middleware.RequestContext(c))
		return walletResult(c, fiber.StatusOK, result, err)
	}
}

func dailyCloseReportsHandler(reports OperationsReportReader) fiber.Handler {
	return func(c *fiber.Ctx) error {
		result, err := reports.DailyCloseReports(middleware.RequestContext(c), limitParam(c, 100))
		return walletResult(c, fiber.StatusOK, result, err)
	}
}

func pilotMonitoringReportHandler(reports OperationsReportReader) fiber.Handler {
	return func(c *fiber.Ctx) error {
		result, err := reports.PilotMonitoringReport(middleware.RequestContext(c))
		return walletResult(c, fiber.StatusOK, result, err)
	}
}

func day1CloseReportHandler(reports OperationsReportReader) fiber.Handler {
	return func(c *fiber.Ctx) error {
		result, err := reports.Day1CloseReport(middleware.RequestContext(c))
		return walletResult(c, fiber.StatusOK, result, err)
	}
}

func pilotStatusReportHandler(reports OperationsReportReader) fiber.Handler {
	return func(c *fiber.Ctx) error {
		result, err := reports.PilotStatusReport(middleware.RequestContext(c))
		return walletResult(c, fiber.StatusOK, result, err)
	}
}

func goNoGoReportHandler(reports OperationsReportReader) fiber.Handler {
	return func(c *fiber.Ctx) error {
		result, err := reports.GoNoGoReport(middleware.RequestContext(c))
		return walletResult(c, fiber.StatusOK, result, err)
	}
}

func pilotAuthorizationReportHandler(reports OperationsReportReader) fiber.Handler {
	return func(c *fiber.Ctx) error {
		result, err := reports.PilotAuthorizationReport(middleware.RequestContext(c))
		return walletResult(c, fiber.StatusOK, result, err)
	}
}

func pilotReadinessReportHandler(reports OperationsReportReader) fiber.Handler {
	return func(c *fiber.Ctx) error {
		result, err := reports.PilotReadinessReport(middleware.RequestContext(c))
		return walletResult(c, fiber.StatusOK, result, err)
	}
}

func internalPilotBoardReportHandler(reports OperationsReportReader) fiber.Handler {
	return func(c *fiber.Ctx) error {
		result, err := reports.InternalPilotBoardReport(middleware.RequestContext(c))
		return walletResult(c, fiber.StatusOK, result, err)
	}
}

func internalPilotAuthorizationReportHandler(reports OperationsReportReader) fiber.Handler {
	return func(c *fiber.Ctx) error {
		result, err := reports.InternalPilotAuthorizationReport(middleware.RequestContext(c))
		return walletResult(c, fiber.StatusOK, result, err)
	}
}

func internalPilotHealthReportHandler(reports OperationsReportReader) fiber.Handler {
	return func(c *fiber.Ctx) error {
		result, err := reports.InternalPilotHealthReport(middleware.RequestContext(c))
		return walletResult(c, fiber.StatusOK, result, err)
	}
}

func internalPilotIncidentsHandler(reports OperationsReportReader) fiber.Handler {
	return func(c *fiber.Ctx) error {
		result, err := reports.InternalPilotIncidents(middleware.RequestContext(c), limitParam(c, 100))
		return walletResult(c, fiber.StatusOK, result, err)
	}
}

func internalPilotParticipantsHandler(reports OperationsReportReader) fiber.Handler {
	return func(c *fiber.Ctx) error {
		result, err := reports.InternalPilotParticipants(middleware.RequestContext(c), limitParam(c, 100))
		return walletResult(c, fiber.StatusOK, result, err)
	}
}

func internalPilotKillSwitchesHandler(reports OperationsReportReader) fiber.Handler {
	return func(c *fiber.Ctx) error {
		result, err := reports.InternalPilotKillSwitches(middleware.RequestContext(c), limitParam(c, 100))
		return walletResult(c, fiber.StatusOK, result, err)
	}
}

func internalPilotReadinessReportHandler(reports OperationsReportReader) fiber.Handler {
	return func(c *fiber.Ctx) error {
		result, err := reports.InternalPilotReadinessReport(middleware.RequestContext(c))
		return walletResult(c, fiber.StatusOK, result, err)
	}
}

func internalPilotEvidenceHandler(reports OperationsReportReader) fiber.Handler {
	return func(c *fiber.Ctx) error {
		result, err := reports.InternalPilotEvidence(middleware.RequestContext(c), limitParam(c, 100))
		return walletResult(c, fiber.StatusOK, result, err)
	}
}

func internalPilotObjectivesHandler(reports OperationsReportReader) fiber.Handler {
	return func(c *fiber.Ctx) error {
		result, err := reports.InternalPilotObjectives(middleware.RequestContext(c), limitParam(c, 100))
		return walletResult(c, fiber.StatusOK, result, err)
	}
}

func internalPilotSummaryHandler(reports OperationsReportReader) fiber.Handler {
	return func(c *fiber.Ctx) error {
		result, err := reports.InternalPilotSummary(middleware.RequestContext(c))
		return walletResult(c, fiber.StatusOK, result, err)
	}
}

func internalPilotComplianceHandler(reports OperationsReportReader) fiber.Handler {
	return func(c *fiber.Ctx) error {
		result, err := reports.InternalPilotCompliance(middleware.RequestContext(c))
		return walletResult(c, fiber.StatusOK, result, err)
	}
}

func internalPilotBoardReviewHandler(reports OperationsReportReader) fiber.Handler {
	return func(c *fiber.Ctx) error {
		result, err := reports.InternalPilotBoardReview(middleware.RequestContext(c))
		return walletResult(c, fiber.StatusOK, result, err)
	}
}

func internalPilotFindingsHandler(reports OperationsReportReader) fiber.Handler {
	return func(c *fiber.Ctx) error {
		result, err := reports.InternalPilotFindings(middleware.RequestContext(c), limitParam(c, 100))
		return walletResult(c, fiber.StatusOK, result, err)
	}
}

func internalPilotReadinessAssessmentHandler(reports OperationsReportReader) fiber.Handler {
	return func(c *fiber.Ctx) error {
		result, err := reports.InternalPilotReadinessAssessment(middleware.RequestContext(c), limitParam(c, 100))
		return walletResult(c, fiber.StatusOK, result, err)
	}
}

func internalPilotBoardRecommendationHandler(reports OperationsReportReader) fiber.Handler {
	return func(c *fiber.Ctx) error {
		result, err := reports.InternalPilotBoardRecommendation(middleware.RequestContext(c))
		return walletResult(c, fiber.StatusOK, result, err)
	}
}

func internalPilotReviewSummaryHandler(reports OperationsReportReader) fiber.Handler {
	return func(c *fiber.Ctx) error {
		result, err := reports.InternalPilotReviewSummary(middleware.RequestContext(c))
		return walletResult(c, fiber.StatusOK, result, err)
	}
}

func publicWalletPilotReportHandler(reports OperationsReportReader) fiber.Handler {
	return func(c *fiber.Ctx) error {
		result, err := reports.PublicWalletPilotReport(middleware.RequestContext(c))
		return walletResult(c, fiber.StatusOK, result, err)
	}
}

func publicWalletPilotParticipantsHandler(reports OperationsReportReader) fiber.Handler {
	return func(c *fiber.Ctx) error {
		result, err := reports.PublicWalletPilotParticipants(middleware.RequestContext(c), limitParam(c, 100))
		return walletResult(c, fiber.StatusOK, result, err)
	}
}

func publicWalletPilotTransactionsHandler(reports OperationsReportReader) fiber.Handler {
	return func(c *fiber.Ctx) error {
		result, err := reports.PublicWalletPilotTransactions(middleware.RequestContext(c), limitParam(c, 100))
		return walletResult(c, fiber.StatusOK, result, err)
	}
}

func publicWalletPilotReconciliationHandler(reports OperationsReportReader) fiber.Handler {
	return func(c *fiber.Ctx) error {
		result, err := reports.PublicWalletPilotReconciliation(middleware.RequestContext(c), limitParam(c, 100))
		return walletResult(c, fiber.StatusOK, result, err)
	}
}

func publicWalletPilotFraudHandler(reports OperationsReportReader) fiber.Handler {
	return func(c *fiber.Ctx) error {
		result, err := reports.PublicWalletPilotFraud(middleware.RequestContext(c), limitParam(c, 100))
		return walletResult(c, fiber.StatusOK, result, err)
	}
}

func publicWalletPilotEvidenceHandler(reports OperationsReportReader) fiber.Handler {
	return func(c *fiber.Ctx) error {
		result, err := reports.PublicWalletPilotEvidence(middleware.RequestContext(c))
		return walletResult(c, fiber.StatusOK, result, err)
	}
}

func pilotSummaryHandler(reports OperationsReportReader) fiber.Handler {
	return func(c *fiber.Ctx) error {
		result, err := reports.PilotSummary(middleware.RequestContext(c))
		return walletResult(c, fiber.StatusOK, result, err)
	}
}

func pilotUsersHandler(reports OperationsReportReader) fiber.Handler {
	return func(c *fiber.Ctx) error {
		result, err := reports.PilotUsers(middleware.RequestContext(c), limitParam(c, 100))
		return walletResult(c, fiber.StatusOK, result, err)
	}
}

func pilotFailuresHandler(reports OperationsReportReader) fiber.Handler {
	return func(c *fiber.Ctx) error {
		result, err := reports.PilotFailures(middleware.RequestContext(c), limitParam(c, 100))
		return walletResult(c, fiber.StatusOK, result, err)
	}
}

func pilotReconciliationHandler(reports OperationsReportReader) fiber.Handler {
	return func(c *fiber.Ctx) error {
		result, err := reports.PilotReconciliation(middleware.RequestContext(c), limitParam(c, 50))
		return walletResult(c, fiber.StatusOK, result, err)
	}
}

func pilotUserControlHandler(service WalletPilotService, status string) fiber.Handler {
	return func(c *fiber.Ctx) error {
		adminID, _ := middleware.AuthenticatedUserID(c)
		var body struct {
			Role      string `json:"role"`
			GroupName string `json:"group_name"`
			Reason    string `json:"reason"`
		}
		_ = c.BodyParser(&body)
		result, err := service.SetPilotUser(middleware.RequestContext(c), PilotUserChange{
			UserID:    c.Params("userId"),
			Role:      defaultString(body.Role, PilotRoleRider),
			Status:    status,
			GroupName: body.GroupName,
			AdminID:   adminID,
			Reason:    body.Reason,
		})
		return walletResult(c, fiber.StatusOK, result, err)
	}
}

func requirePilot(service WalletPilotService, role string) fiber.Handler {
	return func(c *fiber.Ctx) error {
		if service == nil || !service.Enabled() {
			return c.Next()
		}
		userID, ok := middleware.AuthenticatedUserID(c)
		if !ok {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Authentication required"})
		}
		if !service.IsPilotEligible(middleware.RequestContext(c), userID, role) {
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "Wallet internal pilot access required"})
		}
		return c.Next()
	}
}

func adminDecision(c *fiber.Ctx) AdminDecision {
	adminID, _ := middleware.AuthenticatedUserID(c)
	var body struct {
		Reason string `json:"reason"`
		Note   string `json:"note"`
	}
	_ = c.BodyParser(&body)
	if body.Reason == "" {
		body.Reason = body.Note
	}
	return AdminDecision{AdminUserID: adminID, TargetID: c.Params("id"), Reason: body.Reason}
}

func walletResult(c *fiber.Ctx, status int, result any, err error) error {
	if err != nil {
		if errors.Is(err, ErrWalletPilotDisabled) {
			return c.Status(fiber.StatusLocked).JSON(fiber.Map{"error": "wallet_pilot_disabled"})
		}
		if errors.Is(err, ErrWalletPilotLimitExceeded) {
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "wallet_pilot_limit_exceeded"})
		}
		if errors.Is(err, ErrWalletPilotNotAuthorized) {
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "wallet_pilot_not_authorized"})
		}
		if errors.Is(err, ErrInsufficientFunds) {
			return c.Status(fiber.StatusPaymentRequired).JSON(fiber.Map{"error": "Insufficient wallet balance"})
		}
		if errors.Is(err, ErrPilotAccessDenied) {
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "Wallet internal pilot access required"})
		}
		return c.Status(fiber.StatusConflict).JSON(fiber.Map{"error": "Wallet operation could not be completed"})
	}
	return c.Status(status).JSON(result)
}

func parseHTTPAmountMinor(raw json.RawMessage, currency string) (int64, error) {
	if currency == "" {
		currency = CurrencyUSD
	}
	text := strings.TrimSpace(string(raw))
	text = strings.Trim(text, `"`)
	money, err := NewPositiveMoneyFromDecimal(text, currency)
	if err != nil {
		return 0, err
	}
	return money.MinorUnits, nil
}

func amountJSON(amountMinor int64) float64 {
	amount, err := strconv.ParseFloat(MinorDecimalString(amountMinor, CurrencyUSD), 64)
	if err != nil {
		return 0
	}
	return amount
}

func frontendManualMethod(method string) string {
	switch strings.ToLower(strings.TrimSpace(method)) {
	case "", "ecocash", "manual_ecocash":
		return ManualMethodEcoCash
	case "innbucks", "manual_innbucks":
		return ManualMethodInnbucks
	case "bank", "manual_bank":
		return ManualMethodBank
	case "cash", "manual_cash":
		return ManualMethodCash
	case "card", "manual_card":
		return ManualMethodCard
	case "paypal", "manual_paypal":
		return ManualMethodPayPal
	default:
		return method
	}
}

func frontendMoneyRows(rows []map[string]any) []map[string]any {
	normalized := make([]map[string]any, 0, len(rows))
	for _, row := range rows {
		normalized = append(normalized, frontendMoneyMap(row))
	}
	return normalized
}

func frontendMoneyMap(row map[string]any) map[string]any {
	normalized := map[string]any{}
	for key, value := range row {
		if strings.HasSuffix(key, "_minor") || key == "amount_minor" || key == "total_amount_minor" {
			continue
		}
		normalized[key] = value
	}
	for _, pair := range []struct {
		minorKey string
		outKey   string
	}{
		{"amount_minor", "amount"},
		{"total_amount_minor", "amount"},
		{"fare_minor", "fare"},
		{"platform_fee_minor", "platform_fee"},
		{"driver_earning_minor", "driver_earning"},
		{"cached_available_balance_minor", "available_balance"},
		{"cached_pending_balance_minor", "pending_balance"},
		{"cached_liability_balance_minor", "liability_balance"},
		{"available_balance_minor", "available_balance"},
		{"pending_balance_minor", "pending_balance"},
		{"liability_balance_minor", "liability_balance"},
		{"total_earnings_minor", "total_earnings"},
	} {
		if minor, ok := minorFromAny(row[pair.minorKey]); ok {
			normalized[pair.outKey] = amountJSON(minor)
		}
	}
	return normalized
}

func minorFromAny(value any) (int64, bool) {
	switch typed := value.(type) {
	case int64:
		return typed, true
	case int:
		return int64(typed), true
	case float64:
		return int64(typed), true
	case json.Number:
		parsed, err := typed.Int64()
		return parsed, err == nil
	case string:
		money, err := NewMoneyFromDecimal(typed, CurrencyUSD)
		return money.MinorUnits, err == nil
	default:
		return 0, false
	}
}
