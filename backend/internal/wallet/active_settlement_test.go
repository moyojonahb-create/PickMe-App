package wallet

import (
	"context"
	"errors"
	"testing"
)

type fakeActiveCashRepo struct {
	postCalls    int
	failureCalls int
	err          error
	lastRide     CompletedRide
	lastCalc     SettlementCalculation
	settlement   SettlementRecord
}

func (f *fakeActiveCashRepo) PostActiveCashSettlement(ctx context.Context, ride CompletedRide, calc SettlementCalculation) (SettlementRecord, error) {
	f.postCalls++
	f.lastRide = ride
	f.lastCalc = calc
	if f.err != nil {
		return SettlementRecord{}, f.err
	}
	if f.settlement.ID == "" {
		f.settlement = SettlementRecord{
			ID:                 "settlement-1",
			RideID:             ride.RideID,
			DriverID:           ride.DriverID,
			RiderID:            ride.RiderID,
			FareMinor:          calc.FareMinor,
			PlatformFeeMinor:   calc.PlatformFeeMinor,
			DriverEarningMinor: calc.DriverEarningMinor,
			Currency:           calc.Currency,
			PaymentMethod:      "cash",
			SettlementMode:     SettlementModeActive,
			Status:             SettlementStatusSettled,
			IdempotencyKey:     activeCashSettlementIdempotencyKey(ride.RideID),
		}
	}
	return f.settlement, nil
}

func (f *fakeActiveCashRepo) RecordActiveCashSettlementFailure(ctx context.Context, ride CompletedRide, calc SettlementCalculation, cause error) error {
	f.failureCalls++
	f.lastRide = ride
	f.lastCalc = calc
	return nil
}

func TestActiveCashSettlementDisabledDoesNothing(t *testing.T) {
	repo := &fakeActiveCashRepo{}
	service := NewActiveCashSettlementService(repo, ActiveSettlementConfig{})
	if err := service.SettleCompletedCashRide(context.Background(), CompletedRide{RideID: "ride-1", FareMinor: 10000, PaymentMethod: "cash", Currency: CurrencyUSD}); err != nil {
		t.Fatal(err)
	}
	if repo.postCalls != 0 || repo.failureCalls != 0 {
		t.Fatalf("disabled active cash settlement should not write, posts=%d failures=%d", repo.postCalls, repo.failureCalls)
	}
}

func TestActiveCashSettlementPostsCashPlatformFee(t *testing.T) {
	repo := &fakeActiveCashRepo{}
	service := NewActiveCashSettlementService(repo, ActiveSettlementConfig{Enabled: true, CashEnabled: true})
	err := service.SettleCompletedCashRide(context.Background(), CompletedRide{
		RideID:        "ride-1",
		RiderID:       "rider-1",
		DriverID:      "driver-1",
		FareMinor:     10000,
		PaymentMethod: "cash",
		Currency:      CurrencyUSD,
	})
	if err != nil {
		t.Fatal(err)
	}
	if repo.postCalls != 1 || repo.failureCalls != 0 {
		t.Fatalf("expected one active post and no failure, posts=%d failures=%d", repo.postCalls, repo.failureCalls)
	}
	if repo.lastCalc.PlatformFeeMinor != 1500 || repo.lastCalc.DriverEarningMinor != 8500 {
		t.Fatalf("unexpected active cash calculation: %#v", repo.lastCalc)
	}
	if activeCashSettlementIdempotencyKey(repo.lastRide.RideID) != "cash-settlement:ride-1" {
		t.Fatalf("unexpected idempotency key")
	}
}

func TestActiveCashSettlementRecordsFailureWithoutRideCoupling(t *testing.T) {
	repo := &fakeActiveCashRepo{err: errors.New("db unavailable")}
	service := NewActiveCashSettlementService(repo, ActiveSettlementConfig{Enabled: true, CashEnabled: true})
	err := service.SettleCompletedCashRide(context.Background(), CompletedRide{
		RideID:        "ride-1",
		RiderID:       "rider-1",
		DriverID:      "driver-1",
		FareMinor:     10000,
		PaymentMethod: "cash",
		Currency:      CurrencyUSD,
	})
	if err == nil {
		t.Fatal("expected settlement service to report repository error for logging")
	}
	if repo.postCalls != 1 || repo.failureCalls != 1 {
		t.Fatalf("expected failed active settlement to be recorded, posts=%d failures=%d", repo.postCalls, repo.failureCalls)
	}
}

func TestActiveCashSettlementIgnoresWalletPaymentMethod(t *testing.T) {
	repo := &fakeActiveCashRepo{}
	service := NewActiveCashSettlementService(repo, ActiveSettlementConfig{Enabled: true, CashEnabled: true})
	if err := service.SettleCompletedCashRide(context.Background(), CompletedRide{RideID: "ride-1", FareMinor: 10000, PaymentMethod: "wallet", Currency: CurrencyUSD}); err != nil {
		t.Fatal(err)
	}
	if repo.postCalls != 0 {
		t.Fatalf("active cash settlement must not process wallet rides, posts=%d", repo.postCalls)
	}
}

func TestActiveCashLedgerShapeWithSufficientDriverWalletIsBalanced(t *testing.T) {
	ride := CompletedRide{RideID: "ride-1", DriverID: "driver-1", FareMinor: 10000, PaymentMethod: "cash", Currency: CurrencyUSD}
	calc, err := CalculateSettlement(ride.FareMinor, ride.Currency)
	if err != nil {
		t.Fatal(err)
	}
	transaction := activeCashSettlementTransaction(ride, calc, calc.PlatformFeeMinor)
	entries := []LedgerEntry{
		activeCashSettlementEntry(transaction.ID, "driver-wallet", EntryTypeDebit, calc.PlatformFeeMinor, ride, calc),
		activeCashSettlementEntry(transaction.ID, "platform-wallet", EntryTypeCredit, calc.PlatformFeeMinor, ride, calc),
	}
	if transaction.TransactionType != TransactionTypeCashPlatformFee || transaction.PaymentProvider != "cash" {
		t.Fatalf("unexpected active cash transaction: %#v", transaction)
	}
	if err := ValidateBalancedTransaction(transaction, entries); err != nil {
		t.Fatal(err)
	}
}

func TestActiveCashLedgerShapeWithInsufficientDriverWalletCreatesLiabilityDebit(t *testing.T) {
	ride := CompletedRide{RideID: "ride-1", DriverID: "driver-1", FareMinor: 10000, PaymentMethod: "cash", Currency: CurrencyUSD}
	calc, err := CalculateSettlement(ride.FareMinor, ride.Currency)
	if err != nil {
		t.Fatal(err)
	}
	transaction := activeCashSettlementTransaction(ride, calc, calc.PlatformFeeMinor)
	entries := []LedgerEntry{
		activeCashSettlementEntry(transaction.ID, "driver-cash-liability-wallet", EntryTypeDebit, calc.PlatformFeeMinor, ride, calc),
		activeCashSettlementEntry(transaction.ID, "platform-wallet", EntryTypeCredit, calc.PlatformFeeMinor, ride, calc),
	}
	if entries[0].EntryType != EntryTypeDebit || entries[0].AmountMinor != 1500 {
		t.Fatalf("expected liability debit for platform fee, got %#v", entries[0])
	}
	if err := ValidateBalancedTransaction(transaction, entries); err != nil {
		t.Fatal(err)
	}
}

func TestActiveCashSettlementDuplicateKeyIsStable(t *testing.T) {
	first := activeCashSettlementIdempotencyKey("ride-1")
	second := activeCashSettlementIdempotencyKey("ride-1")
	if first != second || first != "cash-settlement:ride-1" {
		t.Fatalf("cash settlement idempotency key is not stable: %s %s", first, second)
	}
}
