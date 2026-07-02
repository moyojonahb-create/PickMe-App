package wallet

import (
	"context"
	"fmt"

	"github.com/google/uuid"
)

type AdminFlowService struct {
	repo     AdminFlowRepository
	accounts AccountRepository
	ledger   LedgerRepository
	pilot    WalletPilotRuntimeEnforcer
}

type AtomicAdminFlowRepository interface {
	ApproveDepositAtomically(ctx context.Context, decision AdminDecision) (PaymentIntent, error)
	RejectDepositAtomically(ctx context.Context, decision AdminDecision) (PaymentIntent, error)
	ApproveWithdrawalAtomically(ctx context.Context, decision AdminDecision) (WithdrawalRequest, error)
	RejectWithdrawalAtomically(ctx context.Context, decision AdminDecision) (WithdrawalRequest, error)
}

type CompatibilityRepository interface {
	CreateTransfer(ctx context.Context, req TransferRequest) (TransferResult, error)
	PayRideFromWallet(ctx context.Context, req WalletPayRequest) (WalletPayResult, error)
	SetWalletPIN(ctx context.Context, req WalletPINRequest) error
	LookupUserByPickMeAccount(ctx context.Context, pickmeAccount string) (LookupUserResult, error)
	DriverSummary(ctx context.Context, driverID string) (map[string]any, error)
	DriverEarnings(ctx context.Context, driverID string, limit int) ([]map[string]any, error)
}

func NewAdminFlowService(repo *PostgresRepository) *AdminFlowService {
	return &AdminFlowService{repo: repo, accounts: repo, ledger: repo}
}

func NewAdminFlowServiceWithRepositories(repo AdminFlowRepository, accounts AccountRepository, ledger LedgerRepository) *AdminFlowService {
	return &AdminFlowService{repo: repo, accounts: accounts, ledger: ledger}
}

func (s *AdminFlowService) WithWalletPilotEnforcer(pilot WalletPilotRuntimeEnforcer) *AdminFlowService {
	if s != nil {
		s.pilot = pilot
	}
	return s
}

func (s *AdminFlowService) CreateDeposit(ctx context.Context, req DepositRequest) (PaymentIntent, error) {
	if req.WalletAccountType == "" {
		req.WalletAccountType = AccountTypeRiderWallet
	}
	if req.Currency == "" {
		req.Currency = CurrencyUSD
	}
	if err := ValidateDepositRequest(req); err != nil {
		return PaymentIntent{}, err
	}
	if err := s.guardWalletPilot(ctx, WalletPilotMutationRequest{
		Endpoint:        "/api/wallets/deposits",
		UserID:          req.UserID,
		ParticipantType: walletPilotParticipantTypeForAccount(req.WalletAccountType),
		City:            req.City,
		TransactionType: WalletPilotTransactionTypeDeposit,
		AmountMinor:     req.AmountMinor,
		Currency:        req.Currency,
	}); err != nil {
		return PaymentIntent{}, err
	}
	intent := PaymentIntent{
		ID:                uuid.NewString(),
		UserID:            req.UserID,
		AmountMinor:       req.AmountMinor,
		Currency:          req.Currency,
		Provider:          req.Method,
		PaymentMethod:     req.Method,
		Status:            DepositStatusPendingAdminApproval,
		WalletAccountType: req.WalletAccountType,
		IdempotencyKey:    req.IdempotencyKey,
	}
	if err := s.repo.CreateDepositRequest(ctx, intent); err != nil {
		return PaymentIntent{}, err
	}
	if lookup, ok := s.repo.(interface {
		GetDepositRequestByIdempotencyKey(context.Context, string) (PaymentIntent, error)
	}); ok {
		stored, err := lookup.GetDepositRequestByIdempotencyKey(ctx, req.IdempotencyKey)
		if err != nil {
			return PaymentIntent{}, err
		}
		if stored.UserID != req.UserID || stored.AmountMinor != req.AmountMinor || stored.Currency != req.Currency || stored.Provider != req.Method {
			return PaymentIntent{}, ErrInvalidIdempotencyKey
		}
		return stored, nil
	}
	return intent, nil
}

func (s *AdminFlowService) ApproveDeposit(ctx context.Context, decision AdminDecision) (PaymentIntent, error) {
	if decision.AdminUserID == "" {
		return PaymentIntent{}, fmt.Errorf("admin_user_id is required")
	}
	before, err := s.repo.GetDepositRequest(ctx, decision.TargetID)
	if err != nil {
		return PaymentIntent{}, err
	}
	accountType := defaultString(before.WalletAccountType, AccountTypeRiderWallet)
	if err := s.guardWalletPilot(ctx, WalletPilotMutationRequest{
		Endpoint:        "/admin/wallets/deposits/:id/approve",
		UserID:          before.UserID,
		ParticipantType: walletPilotParticipantTypeForAccount(accountType),
		City:            "",
		TransactionType: WalletPilotTransactionTypeDeposit,
		AmountMinor:     before.AmountMinor,
		Currency:        before.Currency,
	}); err != nil {
		return PaymentIntent{}, err
	}
	if atomicRepo, ok := s.repo.(AtomicAdminFlowRepository); ok {
		after, err := atomicRepo.ApproveDepositAtomically(ctx, decision)
		if err == nil {
			_ = s.recordWalletPilot(ctx, WalletPilotMutationRequest{
				Endpoint:        "/admin/wallets/deposits/:id/approve",
				UserID:          before.UserID,
				ParticipantType: walletPilotParticipantTypeForAccount(accountType),
				TransactionType: WalletPilotTransactionTypeDeposit,
				AmountMinor:     before.AmountMinor,
				Currency:        before.Currency,
				EvidenceID:      after.WalletTransactionID,
			})
		}
		return after, err
	}
	if before.Status != DepositStatusPendingAdminApproval {
		return PaymentIntent{}, ErrInvalidTransactionState
	}
	ownerRole := OwnerRoleRider
	if accountType == AccountTypeDriverWallet {
		ownerRole = OwnerRoleDriver
	}
	userAccount, err := s.accounts.EnsureAccount(ctx, Account{
		ID:          deterministicAccountID(before.UserID, accountType, before.Currency),
		OwnerUserID: before.UserID,
		OwnerRole:   ownerRole,
		AccountType: accountType,
		Currency:    before.Currency,
		Status:      AccountStatusActive,
	})
	if err != nil {
		return PaymentIntent{}, err
	}
	clearing, err := s.accounts.EnsureAccount(ctx, Account{
		ID:          deterministicAccountID(platformOwnerID, AccountTypeProviderClearing, before.Currency),
		OwnerUserID: platformOwnerID,
		OwnerRole:   OwnerRolePlatform,
		AccountType: AccountTypeProviderClearing,
		Currency:    before.Currency,
		Status:      AccountStatusActive,
	})
	if err != nil {
		return PaymentIntent{}, err
	}

	transaction := Transaction{
		ID:               uuid.NewString(),
		TransactionType:  TransactionTypeDeposit,
		Status:           TransactionStatusPosted,
		IdempotencyKey:   "deposit-approval:" + before.ID,
		Currency:         before.Currency,
		TotalAmountMinor: before.AmountMinor,
		SourceType:       "payment_intent",
		SourceID:         before.ID,
		OwnerUserID:      before.UserID,
		PaymentProvider:  "internal",
		CreatedBy:        before.UserID,
		ApprovedBy:       decision.AdminUserID,
	}
	entries := []LedgerEntry{
		{ID: uuid.NewString(), TransactionID: transaction.ID, AccountID: clearing.ID, EntryType: EntryTypeDebit, AmountMinor: before.AmountMinor, Currency: before.Currency, SourceType: "payment_intent", SourceID: before.ID, PaymentProvider: "internal"},
		{ID: uuid.NewString(), TransactionID: transaction.ID, AccountID: userAccount.ID, EntryType: EntryTypeCredit, AmountMinor: before.AmountMinor, Currency: before.Currency, SourceType: "payment_intent", SourceID: before.ID, PaymentProvider: "internal"},
	}
	if err := s.ledger.PostLedgerEntries(ctx, transaction, entries); err != nil {
		return PaymentIntent{}, err
	}
	after, err := s.repo.ApproveDepositRequest(ctx, before.ID, decision.AdminUserID, transaction.ID)
	if err != nil {
		return PaymentIntent{}, err
	}
	if err := s.repo.CreateAdminAction(ctx, AdminAction{
		ID:             uuid.NewString(),
		AdminUserID:    decision.AdminUserID,
		Action:         "approve_deposit",
		TargetType:     "payment_intent",
		TargetID:       before.ID,
		Reason:         decision.Reason,
		PreviousStatus: before.Status,
		NewStatus:      after.Status,
	}); err != nil {
		return PaymentIntent{}, err
	}
	_ = s.recordWalletPilot(ctx, WalletPilotMutationRequest{
		Endpoint:        "/admin/wallets/deposits/:id/approve",
		UserID:          before.UserID,
		ParticipantType: walletPilotParticipantTypeForAccount(accountType),
		TransactionType: WalletPilotTransactionTypeDeposit,
		AmountMinor:     before.AmountMinor,
		Currency:        before.Currency,
		EvidenceID:      after.WalletTransactionID,
	})
	return after, nil
}

func (s *AdminFlowService) RejectDeposit(ctx context.Context, decision AdminDecision) (PaymentIntent, error) {
	if atomicRepo, ok := s.repo.(AtomicAdminFlowRepository); ok {
		return atomicRepo.RejectDepositAtomically(ctx, decision)
	}
	before, err := s.repo.GetDepositRequest(ctx, decision.TargetID)
	if err != nil {
		return PaymentIntent{}, err
	}
	if before.Status != DepositStatusPendingAdminApproval {
		return PaymentIntent{}, ErrInvalidTransactionState
	}
	after, err := s.repo.RejectDepositRequest(ctx, before.ID, decision.AdminUserID, decision.Reason)
	if err != nil {
		return PaymentIntent{}, err
	}
	err = s.repo.CreateAdminAction(ctx, AdminAction{ID: uuid.NewString(), AdminUserID: decision.AdminUserID, Action: "reject_deposit", TargetType: "payment_intent", TargetID: before.ID, Reason: decision.Reason, PreviousStatus: before.Status, NewStatus: after.Status})
	return after, err
}

func (s *AdminFlowService) CreateWithdrawal(ctx context.Context, req WithdrawalCreateRequest) (WithdrawalRequest, error) {
	if req.Currency == "" {
		req.Currency = CurrencyUSD
	}
	if err := ValidateWithdrawalRequest(req); err != nil {
		return WithdrawalRequest{}, err
	}
	if err := s.guardWalletPilot(ctx, WalletPilotMutationRequest{
		Endpoint:        "/api/wallets/withdrawals",
		UserID:          req.DriverID,
		ParticipantType: WalletPilotParticipantTypeDriver,
		City:            req.City,
		TransactionType: "withdrawal",
		AmountMinor:     req.AmountMinor,
		Currency:        req.Currency,
	}); err != nil {
		return WithdrawalRequest{}, err
	}
	driverAccount, err := s.accounts.EnsureAccount(ctx, Account{
		ID:          deterministicAccountID(req.DriverID, AccountTypeDriverWallet, req.Currency),
		OwnerUserID: req.DriverID,
		OwnerRole:   OwnerRoleDriver,
		AccountType: AccountTypeDriverWallet,
		Currency:    req.Currency,
		Status:      AccountStatusActive,
	})
	if err != nil {
		return WithdrawalRequest{}, err
	}
	withdrawal := WithdrawalRequest{
		ID:                   uuid.NewString(),
		DriverID:             req.DriverID,
		WalletAccountID:      driverAccount.ID,
		AmountMinor:          req.AmountMinor,
		Currency:             req.Currency,
		Provider:             req.Method,
		DestinationReference: req.DestinationReference,
		Status:               WithdrawalStatusPendingApproval,
		IdempotencyKey:       req.IdempotencyKey,
	}
	if err := s.repo.CreateWithdrawalRequest(ctx, withdrawal); err != nil {
		return WithdrawalRequest{}, err
	}
	if lookup, ok := s.repo.(interface {
		GetWithdrawalRequestByIdempotencyKey(context.Context, string) (WithdrawalRequest, error)
	}); ok {
		stored, err := lookup.GetWithdrawalRequestByIdempotencyKey(ctx, req.IdempotencyKey)
		if err != nil {
			return WithdrawalRequest{}, err
		}
		if stored.DriverID != req.DriverID || stored.AmountMinor != req.AmountMinor || stored.Currency != req.Currency || stored.Provider != req.Method || stored.DestinationReference != req.DestinationReference {
			return WithdrawalRequest{}, ErrInvalidIdempotencyKey
		}
		return stored, nil
	}
	return withdrawal, nil
}

func (s *AdminFlowService) ApproveWithdrawal(ctx context.Context, decision AdminDecision) (WithdrawalRequest, error) {
	before, err := s.repo.GetWithdrawalRequest(ctx, decision.TargetID)
	if err != nil {
		return WithdrawalRequest{}, err
	}
	if err := s.guardWalletPilot(ctx, WalletPilotMutationRequest{
		Endpoint:        "/admin/wallets/withdrawals/:id/approve",
		UserID:          before.DriverID,
		ParticipantType: WalletPilotParticipantTypeDriver,
		TransactionType: "withdrawal",
		AmountMinor:     before.AmountMinor,
		Currency:        before.Currency,
	}); err != nil {
		return WithdrawalRequest{}, err
	}
	if atomicRepo, ok := s.repo.(AtomicAdminFlowRepository); ok {
		return atomicRepo.ApproveWithdrawalAtomically(ctx, decision)
	}
	if before.Status != WithdrawalStatusPendingApproval {
		return WithdrawalRequest{}, ErrInvalidTransactionState
	}
	clearing, err := s.accounts.EnsureAccount(ctx, Account{ID: deterministicAccountID(platformOwnerID, AccountTypeProviderClearing, before.Currency), OwnerUserID: platformOwnerID, OwnerRole: OwnerRolePlatform, AccountType: AccountTypeProviderClearing, Currency: before.Currency, Status: AccountStatusActive})
	if err != nil {
		return WithdrawalRequest{}, err
	}
	transaction := Transaction{
		ID:               uuid.NewString(),
		TransactionType:  TransactionTypeWithdrawal,
		Status:           TransactionStatusPosted,
		IdempotencyKey:   "withdrawal-approval:" + before.ID,
		Currency:         before.Currency,
		TotalAmountMinor: before.AmountMinor,
		SourceType:       "withdrawal_request",
		SourceID:         before.ID,
		OwnerUserID:      before.DriverID,
		PaymentProvider:  "internal",
		CreatedBy:        before.DriverID,
		ApprovedBy:       decision.AdminUserID,
	}
	entries := []LedgerEntry{
		{ID: uuid.NewString(), TransactionID: transaction.ID, AccountID: before.WalletAccountID, EntryType: EntryTypeDebit, AmountMinor: before.AmountMinor, Currency: before.Currency, SourceType: "withdrawal_request", SourceID: before.ID, PaymentProvider: "internal"},
		{ID: uuid.NewString(), TransactionID: transaction.ID, AccountID: clearing.ID, EntryType: EntryTypeCredit, AmountMinor: before.AmountMinor, Currency: before.Currency, SourceType: "withdrawal_request", SourceID: before.ID, PaymentProvider: "internal"},
	}
	if err := s.ledger.PostLedgerEntries(ctx, transaction, entries); err != nil {
		return WithdrawalRequest{}, err
	}
	after, err := s.repo.ApproveWithdrawalRequest(ctx, before.ID, decision.AdminUserID, transaction.ID)
	if err != nil {
		return WithdrawalRequest{}, err
	}
	err = s.repo.CreateAdminAction(ctx, AdminAction{ID: uuid.NewString(), AdminUserID: decision.AdminUserID, Action: "approve_withdrawal", TargetType: "withdrawal_request", TargetID: before.ID, Reason: decision.Reason, PreviousStatus: before.Status, NewStatus: after.Status})
	return after, err
}

func (s *AdminFlowService) guardWalletPilot(ctx context.Context, req WalletPilotMutationRequest) error {
	if s == nil || s.pilot == nil {
		return nil
	}
	return s.pilot.GuardWalletMutation(ctx, req)
}

func (s *AdminFlowService) recordWalletPilot(ctx context.Context, req WalletPilotMutationRequest) error {
	if s == nil || s.pilot == nil {
		return nil
	}
	return s.pilot.RecordWalletMutation(ctx, req)
}

func walletPilotParticipantTypeForAccount(accountType string) string {
	switch defaultString(accountType, AccountTypeRiderWallet) {
	case AccountTypeDriverWallet:
		return WalletPilotParticipantTypeDriver
	default:
		return WalletPilotParticipantTypeRider
	}
}

func (s *AdminFlowService) RejectWithdrawal(ctx context.Context, decision AdminDecision) (WithdrawalRequest, error) {
	if atomicRepo, ok := s.repo.(AtomicAdminFlowRepository); ok {
		return atomicRepo.RejectWithdrawalAtomically(ctx, decision)
	}
	before, err := s.repo.GetWithdrawalRequest(ctx, decision.TargetID)
	if err != nil {
		return WithdrawalRequest{}, err
	}
	if before.Status != WithdrawalStatusPendingApproval {
		return WithdrawalRequest{}, ErrInvalidTransactionState
	}
	after, err := s.repo.RejectWithdrawalRequest(ctx, before.ID, decision.AdminUserID, decision.Reason)
	if err != nil {
		return WithdrawalRequest{}, err
	}
	err = s.repo.CreateAdminAction(ctx, AdminAction{ID: uuid.NewString(), AdminUserID: decision.AdminUserID, Action: "reject_withdrawal", TargetType: "withdrawal_request", TargetID: before.ID, Reason: decision.Reason, PreviousStatus: before.Status, NewStatus: after.Status})
	return after, err
}

func (s *AdminFlowService) CreateTransfer(ctx context.Context, req TransferRequest) (TransferResult, error) {
	repo, ok := s.repo.(CompatibilityRepository)
	if !ok {
		return TransferResult{}, ErrInvalidLedgerEntry
	}
	return repo.CreateTransfer(ctx, req)
}

func (s *AdminFlowService) PayRide(ctx context.Context, req WalletPayRequest) (WalletPayResult, error) {
	repo, ok := s.repo.(CompatibilityRepository)
	if !ok {
		return WalletPayResult{}, ErrInvalidLedgerEntry
	}
	return repo.PayRideFromWallet(ctx, req)
}

func (s *AdminFlowService) SetWalletPIN(ctx context.Context, req WalletPINRequest) error {
	repo, ok := s.repo.(CompatibilityRepository)
	if !ok {
		return ErrInvalidLedgerEntry
	}
	return repo.SetWalletPIN(ctx, req)
}

func (s *AdminFlowService) LookupUser(ctx context.Context, pickmeAccount string) (LookupUserResult, error) {
	repo, ok := s.repo.(CompatibilityRepository)
	if !ok {
		return LookupUserResult{}, ErrInvalidLedgerEntry
	}
	return repo.LookupUserByPickMeAccount(ctx, pickmeAccount)
}

func (s *AdminFlowService) DriverSummary(ctx context.Context, driverID string) (map[string]any, error) {
	repo, ok := s.repo.(CompatibilityRepository)
	if !ok {
		return nil, ErrInvalidLedgerEntry
	}
	return repo.DriverSummary(ctx, driverID)
}

func (s *AdminFlowService) DriverEarnings(ctx context.Context, driverID string, limit int) ([]map[string]any, error) {
	repo, ok := s.repo.(CompatibilityRepository)
	if !ok {
		return nil, ErrInvalidLedgerEntry
	}
	return repo.DriverEarnings(ctx, driverID, limit)
}
