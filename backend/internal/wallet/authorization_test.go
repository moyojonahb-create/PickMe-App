package wallet

import (
	"context"
	"errors"
	"testing"
	"time"
)

type fakeAuthorizationRepo struct {
	authorization WalletAuthorization
	settlement    SettlementRecord
	err           error
	authCalls     int
	captureCalls  int
	releaseCalls  int
	expireCalls   int
}

func (f *fakeAuthorizationRepo) AuthorizeRideFunds(ctx context.Context, req AuthorizationRequest, expiresAt time.Time) (WalletAuthorization, error) {
	f.authCalls++
	if f.err != nil {
		return WalletAuthorization{}, f.err
	}
	if f.authorization.ID == "" {
		f.authorization = WalletAuthorization{
			ID:             "auth-1",
			RideID:         req.RideID,
			RiderID:        req.RiderID,
			AmountMinor:    req.AmountMinor,
			Currency:       req.Currency,
			Status:         AuthorizationStatusAuthorized,
			IdempotencyKey: req.IdempotencyKey,
			ExpiresAt:      expiresAt,
		}
	}
	return f.authorization, nil
}

func (f *fakeAuthorizationRepo) CaptureRideFunds(ctx context.Context, req CaptureRequest) (SettlementRecord, error) {
	f.captureCalls++
	if f.err != nil {
		return SettlementRecord{}, f.err
	}
	if f.settlement.ID == "" {
		f.settlement = SettlementRecord{
			ID:             "settlement-1",
			RideID:         req.RideID,
			RiderID:        req.RiderID,
			DriverID:       req.DriverID,
			FareMinor:      req.AmountMinor,
			Currency:       req.Currency,
			PaymentMethod:  "wallet",
			SettlementMode: SettlementModeActive,
			Status:         SettlementStatusSettled,
		}
		f.authorization.Status = AuthorizationStatusCaptured
	}
	return f.settlement, nil
}

func (f *fakeAuthorizationRepo) ReleaseRideFunds(ctx context.Context, req ReleaseRequest) (WalletAuthorization, error) {
	f.releaseCalls++
	if f.err != nil {
		return WalletAuthorization{}, f.err
	}
	f.authorization.Status = AuthorizationStatusReleased
	f.authorization.ReleasedAmountMinor = f.authorization.AmountMinor
	return f.authorization, nil
}

func (f *fakeAuthorizationRepo) ExpireRideAuthorization(ctx context.Context, rideID string, now time.Time) (WalletAuthorization, error) {
	f.expireCalls++
	if f.err != nil {
		return WalletAuthorization{}, f.err
	}
	f.authorization.Status = AuthorizationStatusExpired
	f.authorization.ReleasedAmountMinor = f.authorization.AmountMinor
	return f.authorization, nil
}

func (f *fakeAuthorizationRepo) ExpireStaleAuthorizations(ctx context.Context, now time.Time, limit int) ([]WalletAuthorization, error) {
	f.expireCalls++
	if f.err != nil {
		return nil, f.err
	}
	f.authorization.Status = AuthorizationStatusExpired
	f.authorization.ReleasedAmountMinor = f.authorization.AmountMinor
	return []WalletAuthorization{f.authorization}, nil
}

func TestWalletAuthorizationDisabledDoesNothing(t *testing.T) {
	repo := &fakeAuthorizationRepo{}
	service := NewAuthorizationService(repo, AuthorizationConfig{})
	result, err := service.AuthorizeRideFunds(context.Background(), AuthorizationRequest{RideID: "ride-1", RiderID: "rider-1", AmountMinor: 1000, Currency: CurrencyUSD})
	if err != nil {
		t.Fatal(err)
	}
	if result.ID != "" || repo.authCalls != 0 {
		t.Fatalf("disabled authorization should not call repository, result=%#v calls=%d", result, repo.authCalls)
	}
}

func TestSuccessfulAuthorization(t *testing.T) {
	repo := &fakeAuthorizationRepo{}
	service := NewAuthorizationService(repo, AuthorizationConfig{Enabled: true, HoldTTL: time.Hour})
	result, err := service.AuthorizeRideFunds(context.Background(), AuthorizationRequest{RideID: "ride-1", RiderID: "rider-1", AmountMinor: 1000, Currency: CurrencyUSD})
	if err != nil {
		t.Fatal(err)
	}
	if result.Status != AuthorizationStatusAuthorized || result.IdempotencyKey != "ride-authorization:ride-1" {
		t.Fatalf("unexpected authorization: %#v", result)
	}
}

func TestWalletAuthorizationEnforcesPublicWalletPilotBeforeRepository(t *testing.T) {
	repo := &fakeAuthorizationRepo{}
	pilot := &fakeRuntimeWalletPilot{err: ErrWalletPilotLimitExceeded}
	service := NewAuthorizationService(repo, AuthorizationConfig{Enabled: true, HoldTTL: time.Hour}).WithWalletPilotEnforcer(pilot)

	_, err := service.AuthorizeRideFunds(context.Background(), AuthorizationRequest{RideID: "ride-1", RiderID: "rider-1", AmountMinor: 2500, Currency: CurrencyUSD, City: WalletPilotCityGwanda})
	if !errors.Is(err, ErrWalletPilotLimitExceeded) {
		t.Fatalf("expected wallet pilot limit denial, got %v", err)
	}
	if repo.authCalls != 0 {
		t.Fatalf("pilot denial must block authorization repository call, got %d", repo.authCalls)
	}
	if len(pilot.guards) != 1 || pilot.guards[0].TransactionType != WalletPilotTransactionTypeRidePayment {
		t.Fatalf("expected ride payment guard, got %#v", pilot.guards)
	}
}

func TestInsufficientBalanceAuthorizationFailsClearly(t *testing.T) {
	repo := &fakeAuthorizationRepo{err: ErrInsufficientFunds}
	service := NewAuthorizationService(repo, AuthorizationConfig{Enabled: true})
	_, err := service.AuthorizeRideFunds(context.Background(), AuthorizationRequest{RideID: "ride-1", RiderID: "rider-1", AmountMinor: 1000, Currency: CurrencyUSD})
	if err != ErrInsufficientFunds {
		t.Fatalf("expected insufficient funds, got %v", err)
	}
}

func TestDuplicateAuthorizationIsIdempotent(t *testing.T) {
	repo := &fakeAuthorizationRepo{}
	service := NewAuthorizationService(repo, AuthorizationConfig{Enabled: true})
	first, err := service.AuthorizeRideFunds(context.Background(), AuthorizationRequest{RideID: "ride-1", RiderID: "rider-1", AmountMinor: 1000, Currency: CurrencyUSD})
	if err != nil {
		t.Fatal(err)
	}
	second, err := service.AuthorizeRideFunds(context.Background(), AuthorizationRequest{RideID: "ride-1", RiderID: "rider-1", AmountMinor: 1000, Currency: CurrencyUSD})
	if err != nil {
		t.Fatal(err)
	}
	if first.ID != second.ID || repo.authCalls != 2 {
		t.Fatalf("expected idempotent duplicate authorization, first=%#v second=%#v calls=%d", first, second, repo.authCalls)
	}
}

func TestAuthorizationExpiration(t *testing.T) {
	repo := &fakeAuthorizationRepo{authorization: WalletAuthorization{ID: "auth-1", RideID: "ride-1", AmountMinor: 1000, Status: AuthorizationStatusAuthorized}}
	service := NewAuthorizationService(repo, AuthorizationConfig{Enabled: true})
	result, err := service.ExpireRideAuthorization(context.Background(), "ride-1")
	if err != nil {
		t.Fatal(err)
	}
	if result.Status != AuthorizationStatusExpired || repo.expireCalls != 1 {
		t.Fatalf("expected expired authorization, got %#v calls=%d", result, repo.expireCalls)
	}
}

func TestStaleAuthorizationExpirationBatch(t *testing.T) {
	repo := &fakeAuthorizationRepo{authorization: WalletAuthorization{ID: "auth-1", RideID: "ride-1", AmountMinor: 1000, Status: AuthorizationStatusAuthorized}}
	service := NewAuthorizationService(repo, AuthorizationConfig{Enabled: true})
	result, err := service.ExpireStaleAuthorizations(context.Background(), 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(result) != 1 || result[0].Status != AuthorizationStatusExpired || repo.expireCalls != 1 {
		t.Fatalf("expected one expired authorization, got %#v calls=%d", result, repo.expireCalls)
	}
}

func TestReleaseAfterCancellation(t *testing.T) {
	repo := &fakeAuthorizationRepo{authorization: WalletAuthorization{ID: "auth-1", RideID: "ride-1", RiderID: "rider-1", AmountMinor: 1000, Status: AuthorizationStatusAuthorized}}
	service := NewAuthorizationService(repo, AuthorizationConfig{Enabled: true})
	result, err := service.ReleaseRideFunds(context.Background(), ReleaseRequest{RideID: "ride-1", RiderID: "rider-1", Reason: "cancelled"})
	if err != nil {
		t.Fatal(err)
	}
	if result.Status != AuthorizationStatusReleased || result.ReleasedAmountMinor != 1000 {
		t.Fatalf("expected released authorization, got %#v", result)
	}
}

func TestCaptureAfterCompletion(t *testing.T) {
	repo := &fakeAuthorizationRepo{authorization: WalletAuthorization{ID: "auth-1", RideID: "ride-1", RiderID: "rider-1", AmountMinor: 1000, Status: AuthorizationStatusAuthorized}}
	service := NewAuthorizationService(repo, AuthorizationConfig{Enabled: true})
	settlement, err := service.CaptureRideFunds(context.Background(), CaptureRequest{RideID: "ride-1", RiderID: "rider-1", DriverID: "driver-1", AmountMinor: 1000, Currency: CurrencyUSD})
	if err != nil {
		t.Fatal(err)
	}
	if settlement.Status != SettlementStatusSettled || settlement.PaymentMethod != "wallet" {
		t.Fatalf("expected wallet settlement capture, got %#v", settlement)
	}
}

func TestWalletCaptureKillSwitchBlocksBeforeRepository(t *testing.T) {
	repo := &fakeAuthorizationRepo{authorization: WalletAuthorization{ID: "auth-1", RideID: "ride-1", RiderID: "rider-1", AmountMinor: 1000, Status: AuthorizationStatusAuthorized}}
	pilot := &fakeRuntimeWalletPilot{err: ErrWalletPilotDisabled}
	service := NewAuthorizationService(repo, AuthorizationConfig{Enabled: true}).WithWalletPilotEnforcer(pilot)

	_, err := service.CaptureRideFunds(context.Background(), CaptureRequest{RideID: "ride-1", RiderID: "rider-1", DriverID: "driver-1", AmountMinor: 1000, Currency: CurrencyUSD, City: WalletPilotCityGwanda})
	if !errors.Is(err, ErrWalletPilotDisabled) {
		t.Fatalf("expected wallet pilot kill switch denial, got %v", err)
	}
	if repo.captureCalls != 0 {
		t.Fatalf("kill switch must block capture repository call, got %d", repo.captureCalls)
	}
	if len(pilot.guards) != 1 || pilot.guards[0].UserID != "rider-1" {
		t.Fatalf("expected rider capture guard before repository call, got %#v", pilot.guards)
	}
}

func TestDoubleCapturePrevention(t *testing.T) {
	repo := &fakeAuthorizationRepo{authorization: WalletAuthorization{ID: "auth-1", RideID: "ride-1", RiderID: "rider-1", AmountMinor: 1000, Status: AuthorizationStatusAuthorized}}
	service := NewAuthorizationService(repo, AuthorizationConfig{Enabled: true})
	first, err := service.CaptureRideFunds(context.Background(), CaptureRequest{RideID: "ride-1", RiderID: "rider-1", DriverID: "driver-1", AmountMinor: 1000, Currency: CurrencyUSD})
	if err != nil {
		t.Fatal(err)
	}
	second, err := service.CaptureRideFunds(context.Background(), CaptureRequest{RideID: "ride-1", RiderID: "rider-1", DriverID: "driver-1", AmountMinor: 1000, Currency: CurrencyUSD})
	if err != nil {
		t.Fatal(err)
	}
	if first.ID != second.ID {
		t.Fatalf("expected duplicate capture to return existing settlement, first=%#v second=%#v", first, second)
	}
}

func TestDoubleReleasePrevention(t *testing.T) {
	repo := &fakeAuthorizationRepo{authorization: WalletAuthorization{ID: "auth-1", RideID: "ride-1", RiderID: "rider-1", AmountMinor: 1000, Status: AuthorizationStatusAuthorized}}
	service := NewAuthorizationService(repo, AuthorizationConfig{Enabled: true})
	first, err := service.ReleaseRideFunds(context.Background(), ReleaseRequest{RideID: "ride-1", RiderID: "rider-1"})
	if err != nil {
		t.Fatal(err)
	}
	second, err := service.ReleaseRideFunds(context.Background(), ReleaseRequest{RideID: "ride-1", RiderID: "rider-1"})
	if err != nil {
		t.Fatal(err)
	}
	if first.ReleasedAmountMinor != second.ReleasedAmountMinor {
		t.Fatalf("expected duplicate release to remain stable, first=%#v second=%#v", first, second)
	}
}

func TestWalletSettlementLedgerCorrectness(t *testing.T) {
	req := CaptureRequest{RideID: "ride-1", RiderID: "rider-1", DriverID: "driver-1", AmountMinor: 10000, Currency: CurrencyUSD}
	calc, err := CalculateSettlement(req.AmountMinor, req.Currency)
	if err != nil {
		t.Fatal(err)
	}
	transaction := walletSettlementTransaction(req, calc)
	entries := []LedgerEntry{
		walletSettlementEntry(transaction.ID, "rider-wallet", EntryTypeDebit, calc.FareMinor, req, calc),
		walletSettlementEntry(transaction.ID, "driver-wallet", EntryTypeCredit, calc.DriverEarningMinor, req, calc),
		walletSettlementEntry(transaction.ID, "platform-wallet", EntryTypeCredit, calc.PlatformFeeMinor, req, calc),
	}
	if transaction.TransactionType != TransactionTypeWalletSettlement || transaction.PaymentProvider != "wallet" {
		t.Fatalf("unexpected wallet settlement transaction: %#v", transaction)
	}
	if err := ValidateBalancedTransaction(transaction, entries); err != nil {
		t.Fatal(err)
	}
}
