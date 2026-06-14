package wallet

import (
	"context"
	"errors"
	"testing"
)

type fakeAdminRepo struct {
	deposits     map[string]PaymentIntent
	withdrawals  map[string]WithdrawalRequest
	accounts     []Account
	transactions []Transaction
	entries      []LedgerEntry
	actions      []AdminAction
}

type fakeRuntimeWalletPilot struct {
	err     error
	guards  []WalletPilotMutationRequest
	records []WalletPilotMutationRequest
}

func (f *fakeRuntimeWalletPilot) Enabled() bool {
	return true
}

func (f *fakeRuntimeWalletPilot) GuardWalletMutation(ctx context.Context, req WalletPilotMutationRequest) error {
	f.guards = append(f.guards, req)
	return f.err
}

func (f *fakeRuntimeWalletPilot) RecordWalletMutation(ctx context.Context, req WalletPilotMutationRequest) error {
	f.records = append(f.records, req)
	return nil
}

func newFakeAdminRepo() *fakeAdminRepo {
	return &fakeAdminRepo{deposits: map[string]PaymentIntent{}, withdrawals: map[string]WithdrawalRequest{}}
}

func (f *fakeAdminRepo) CreateDepositRequest(ctx context.Context, intent PaymentIntent) error {
	for _, existing := range f.deposits {
		if existing.IdempotencyKey == intent.IdempotencyKey {
			return errors.New("duplicate idempotency key")
		}
	}
	f.deposits[intent.ID] = intent
	return nil
}

func (f *fakeAdminRepo) GetDepositRequest(ctx context.Context, id string) (PaymentIntent, error) {
	value, ok := f.deposits[id]
	if !ok {
		return PaymentIntent{}, errors.New("not found")
	}
	return value, nil
}

func (f *fakeAdminRepo) ApproveDepositRequest(ctx context.Context, id string, adminID string, transactionID string) (PaymentIntent, error) {
	value, err := f.GetDepositRequest(ctx, id)
	if err != nil {
		return PaymentIntent{}, err
	}
	if value.Status != DepositStatusPendingAdminApproval {
		return PaymentIntent{}, ErrInvalidTransactionState
	}
	value.Status = DepositStatusApproved
	value.ApprovedBy = adminID
	value.WalletTransactionID = transactionID
	f.deposits[id] = value
	return value, nil
}

func (f *fakeAdminRepo) RejectDepositRequest(ctx context.Context, id string, adminID string, reason string) (PaymentIntent, error) {
	value, err := f.GetDepositRequest(ctx, id)
	if err != nil {
		return PaymentIntent{}, err
	}
	if value.Status != DepositStatusPendingAdminApproval {
		return PaymentIntent{}, ErrInvalidTransactionState
	}
	value.Status = DepositStatusRejected
	value.RejectedBy = adminID
	value.RejectionReason = reason
	f.deposits[id] = value
	return value, nil
}

func (f *fakeAdminRepo) CreateWithdrawalRequest(ctx context.Context, withdrawal WithdrawalRequest) error {
	for _, existing := range f.withdrawals {
		if existing.IdempotencyKey == withdrawal.IdempotencyKey {
			return errors.New("duplicate idempotency key")
		}
	}
	f.withdrawals[withdrawal.ID] = withdrawal
	return nil
}

func (f *fakeAdminRepo) GetWithdrawalRequest(ctx context.Context, id string) (WithdrawalRequest, error) {
	value, ok := f.withdrawals[id]
	if !ok {
		return WithdrawalRequest{}, errors.New("not found")
	}
	return value, nil
}

func (f *fakeAdminRepo) ApproveWithdrawalRequest(ctx context.Context, id string, adminID string, transactionID string) (WithdrawalRequest, error) {
	value, err := f.GetWithdrawalRequest(ctx, id)
	if err != nil {
		return WithdrawalRequest{}, err
	}
	if value.Status != WithdrawalStatusPendingApproval {
		return WithdrawalRequest{}, ErrInvalidTransactionState
	}
	value.Status = WithdrawalStatusApproved
	f.withdrawals[id] = value
	return value, nil
}

func (f *fakeAdminRepo) RejectWithdrawalRequest(ctx context.Context, id string, adminID string, reason string) (WithdrawalRequest, error) {
	value, err := f.GetWithdrawalRequest(ctx, id)
	if err != nil {
		return WithdrawalRequest{}, err
	}
	if value.Status != WithdrawalStatusPendingApproval {
		return WithdrawalRequest{}, ErrInvalidTransactionState
	}
	value.Status = WithdrawalStatusRejected
	f.withdrawals[id] = value
	return value, nil
}

func (f *fakeAdminRepo) CreateAdminAction(ctx context.Context, action AdminAction) error {
	f.actions = append(f.actions, action)
	return nil
}

func (f *fakeAdminRepo) CreateAccount(ctx context.Context, account Account) error { return nil }

func (f *fakeAdminRepo) EnsureAccount(ctx context.Context, account Account) (Account, error) {
	f.accounts = append(f.accounts, account)
	return account, nil
}

func (f *fakeAdminRepo) GetAccount(ctx context.Context, accountID string) (Account, error) {
	return Account{ID: accountID}, nil
}

func (f *fakeAdminRepo) PostLedgerEntries(ctx context.Context, transaction Transaction, entries []LedgerEntry) error {
	if err := ValidateBalancedTransaction(transaction, entries); err != nil {
		return err
	}
	f.transactions = append(f.transactions, transaction)
	f.entries = append(f.entries, entries...)
	return nil
}

func TestDepositRequestCreation(t *testing.T) {
	repo := newFakeAdminRepo()
	service := NewAdminFlowServiceWithRepositories(repo, repo, repo)
	deposit, err := service.CreateDeposit(context.Background(), DepositRequest{UserID: "user-1", WalletAccountType: AccountTypeRiderWallet, AmountMinor: 2500, Currency: CurrencyUSD, Method: ManualMethodEcoCash, IdempotencyKey: "deposit-key-1"})
	if err != nil {
		t.Fatal(err)
	}
	if deposit.Status != DepositStatusPendingAdminApproval || deposit.PaymentMethod != ManualMethodEcoCash {
		t.Fatalf("unexpected deposit: %#v", deposit)
	}
}

func TestDepositCreationEnforcesPublicWalletPilotCohort(t *testing.T) {
	repo := newFakeAdminRepo()
	pilot := &fakeRuntimeWalletPilot{err: ErrWalletPilotNotAuthorized}
	service := NewAdminFlowServiceWithRepositories(repo, repo, repo).WithWalletPilotEnforcer(pilot)

	_, err := service.CreateDeposit(context.Background(), DepositRequest{UserID: "rider-1", WalletAccountType: AccountTypeRiderWallet, AmountMinor: 1000, Currency: CurrencyUSD, Method: ManualMethodCash, City: WalletPilotCityGwanda, IdempotencyKey: "deposit-key-1"})
	if !errors.Is(err, ErrWalletPilotNotAuthorized) {
		t.Fatalf("expected non-cohort deposit to be blocked, got %v", err)
	}
	if len(repo.deposits) != 0 {
		t.Fatalf("pilot denial must block deposit intent creation, got %#v", repo.deposits)
	}
}

func TestDepositApprovalPostsBalancedLedger(t *testing.T) {
	repo := newFakeAdminRepo()
	service := NewAdminFlowServiceWithRepositories(repo, repo, repo)
	deposit, _ := service.CreateDeposit(context.Background(), DepositRequest{UserID: "user-1", WalletAccountType: AccountTypeRiderWallet, AmountMinor: 2500, Currency: CurrencyUSD, Method: ManualMethodCash, IdempotencyKey: "deposit-key-1"})
	approved, err := service.ApproveDeposit(context.Background(), AdminDecision{AdminUserID: "admin-1", TargetID: deposit.ID, Reason: "verified"})
	if err != nil {
		t.Fatal(err)
	}
	if approved.Status != DepositStatusApproved || len(repo.transactions) != 1 || len(repo.entries) != 2 || len(repo.actions) != 1 {
		t.Fatalf("unexpected approval state: approved=%#v tx=%d entries=%d actions=%d", approved, len(repo.transactions), len(repo.entries), len(repo.actions))
	}
	if repo.entries[0].EntryType != EntryTypeDebit || repo.entries[1].EntryType != EntryTypeCredit {
		t.Fatalf("expected debit/credit ledger entries: %#v", repo.entries)
	}
}

func TestAdminApprovedDepositEnforcesPublicWalletPilotBeforeLedgerPosting(t *testing.T) {
	repo := newFakeAdminRepo()
	pilot := &fakeRuntimeWalletPilot{err: ErrWalletPilotNotAuthorized}
	service := NewAdminFlowServiceWithRepositories(repo, repo, repo).WithWalletPilotEnforcer(pilot)
	repo.deposits["deposit-1"] = PaymentIntent{
		ID:                "deposit-1",
		UserID:            "rider-1",
		AmountMinor:       1000,
		Currency:          CurrencyUSD,
		Provider:          ManualMethodCash,
		PaymentMethod:     ManualMethodCash,
		Status:            DepositStatusPendingAdminApproval,
		WalletAccountType: AccountTypeRiderWallet,
		IdempotencyKey:    "deposit-key-1",
	}

	_, err := service.ApproveDeposit(context.Background(), AdminDecision{AdminUserID: "admin-1", TargetID: "deposit-1", Reason: "verified"})
	if !errors.Is(err, ErrWalletPilotNotAuthorized) {
		t.Fatalf("expected wallet pilot denial, got %v", err)
	}
	if len(pilot.guards) != 1 || pilot.guards[0].TransactionType != WalletPilotTransactionTypeDeposit {
		t.Fatalf("expected deposit guard, got %#v", pilot.guards)
	}
	if len(repo.transactions) != 0 || len(repo.entries) != 0 || len(repo.actions) != 0 {
		t.Fatalf("pilot denial must block ledger/admin mutation, tx=%d entries=%d actions=%d", len(repo.transactions), len(repo.entries), len(repo.actions))
	}
}

func TestDepositRejectionPostsNoLedger(t *testing.T) {
	repo := newFakeAdminRepo()
	service := NewAdminFlowServiceWithRepositories(repo, repo, repo)
	deposit, _ := service.CreateDeposit(context.Background(), DepositRequest{UserID: "user-1", WalletAccountType: AccountTypeRiderWallet, AmountMinor: 2500, Currency: CurrencyUSD, Method: ManualMethodCash, IdempotencyKey: "deposit-key-1"})
	rejected, err := service.RejectDeposit(context.Background(), AdminDecision{AdminUserID: "admin-1", TargetID: deposit.ID, Reason: "bad proof"})
	if err != nil {
		t.Fatal(err)
	}
	if rejected.Status != DepositStatusRejected || len(repo.transactions) != 0 || len(repo.entries) != 0 || len(repo.actions) != 1 {
		t.Fatalf("unexpected rejection state: rejected=%#v tx=%d entries=%d actions=%d", rejected, len(repo.transactions), len(repo.entries), len(repo.actions))
	}
}

func TestDuplicateDepositApprovalBlocked(t *testing.T) {
	repo := newFakeAdminRepo()
	service := NewAdminFlowServiceWithRepositories(repo, repo, repo)
	deposit, _ := service.CreateDeposit(context.Background(), DepositRequest{UserID: "user-1", WalletAccountType: AccountTypeRiderWallet, AmountMinor: 2500, Currency: CurrencyUSD, Method: ManualMethodCash, IdempotencyKey: "deposit-key-1"})
	_, _ = service.ApproveDeposit(context.Background(), AdminDecision{AdminUserID: "admin-1", TargetID: deposit.ID})
	if _, err := service.ApproveDeposit(context.Background(), AdminDecision{AdminUserID: "admin-1", TargetID: deposit.ID}); !errors.Is(err, ErrInvalidTransactionState) {
		t.Fatalf("expected duplicate approval to be blocked, got %v", err)
	}
}

func TestWithdrawalRequestCreationAndApproval(t *testing.T) {
	repo := newFakeAdminRepo()
	service := NewAdminFlowServiceWithRepositories(repo, repo, repo)
	withdrawal, err := service.CreateWithdrawal(context.Background(), WithdrawalCreateRequest{DriverID: "driver-1", AmountMinor: 1000, Currency: CurrencyUSD, Method: ManualMethodBank, DestinationReference: "bank-123", IdempotencyKey: "withdraw-key-1"})
	if err != nil {
		t.Fatal(err)
	}
	if withdrawal.Status != WithdrawalStatusPendingApproval {
		t.Fatalf("unexpected withdrawal: %#v", withdrawal)
	}
	approved, err := service.ApproveWithdrawal(context.Background(), AdminDecision{AdminUserID: "admin-1", TargetID: withdrawal.ID})
	if err != nil {
		t.Fatal(err)
	}
	if approved.Status != WithdrawalStatusApproved || len(repo.transactions) != 1 || len(repo.entries) != 2 || len(repo.actions) != 1 {
		t.Fatalf("unexpected withdrawal approval: %#v", approved)
	}
}

func TestWithdrawalRejectionPostsNoLedgerAndDuplicateApprovalBlocked(t *testing.T) {
	repo := newFakeAdminRepo()
	service := NewAdminFlowServiceWithRepositories(repo, repo, repo)
	withdrawal, _ := service.CreateWithdrawal(context.Background(), WithdrawalCreateRequest{DriverID: "driver-1", AmountMinor: 1000, Currency: CurrencyUSD, Method: ManualMethodBank, DestinationReference: "bank-123", IdempotencyKey: "withdraw-key-1"})
	rejected, err := service.RejectWithdrawal(context.Background(), AdminDecision{AdminUserID: "admin-1", TargetID: withdrawal.ID, Reason: "review failed"})
	if err != nil {
		t.Fatal(err)
	}
	if rejected.Status != WithdrawalStatusRejected || len(repo.transactions) != 0 || len(repo.entries) != 0 || len(repo.actions) != 1 {
		t.Fatalf("unexpected withdrawal rejection: %#v", rejected)
	}
	if _, err := service.ApproveWithdrawal(context.Background(), AdminDecision{AdminUserID: "admin-1", TargetID: withdrawal.ID}); !errors.Is(err, ErrInvalidTransactionState) {
		t.Fatalf("expected approval after rejection to be blocked, got %v", err)
	}
}
