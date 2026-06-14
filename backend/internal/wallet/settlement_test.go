package wallet

import (
	"context"
	"errors"
	"testing"
)

type fakeSettlementRepo struct {
	accounts     []Account
	transactions []Transaction
	entries      []LedgerEntry
	settlements  []SettlementRecord
	err          error
}

func (f *fakeSettlementRepo) EnsureAccount(ctx context.Context, account Account) (Account, error) {
	if f.err != nil {
		return Account{}, f.err
	}
	f.accounts = append(f.accounts, account)
	return account, nil
}

func (f *fakeSettlementRepo) PostLedgerEntries(ctx context.Context, transaction Transaction, entries []LedgerEntry) error {
	if f.err != nil {
		return f.err
	}
	if err := ValidateBalancedTransaction(transaction, entries); err != nil {
		return err
	}
	f.transactions = append(f.transactions, transaction)
	f.entries = append(f.entries, entries...)
	return nil
}

func (f *fakeSettlementRepo) CreateSettlementRecord(ctx context.Context, settlement SettlementRecord) error {
	if f.err != nil {
		return f.err
	}
	f.settlements = append(f.settlements, settlement)
	return nil
}

func TestCalculateSettlement(t *testing.T) {
	calc, err := CalculateSettlement(10000, CurrencyUSD)
	if err != nil {
		t.Fatal(err)
	}
	if calc.PlatformFeeMinor != 1500 || calc.DriverEarningMinor != 8500 || calc.FareMinor != 10000 {
		t.Fatalf("unexpected settlement calculation: %#v", calc)
	}
}

func TestCashShadowSettlementCreatesLiabilityAndPlatformEntries(t *testing.T) {
	repo := &fakeSettlementRepo{}
	service := NewShadowSettlementService(repo)
	err := service.SettleCompletedRideShadow(context.Background(), CompletedRide{
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
	if len(repo.accounts) != 2 || len(repo.transactions) != 1 || len(repo.entries) != 2 || len(repo.settlements) != 1 {
		t.Fatalf("unexpected writes: accounts=%d tx=%d entries=%d settlements=%d", len(repo.accounts), len(repo.transactions), len(repo.entries), len(repo.settlements))
	}
	if repo.transactions[0].TransactionType != TransactionTypeShadowSettlement || repo.transactions[0].TotalAmountMinor != 1500 {
		t.Fatalf("unexpected cash transaction: %#v", repo.transactions[0])
	}
	if repo.entries[0].EntryType != EntryTypeDebit || repo.entries[0].AmountMinor != 1500 {
		t.Fatalf("expected debit driver liability entry, got %#v", repo.entries[0])
	}
	if repo.settlements[0].SettlementMode != SettlementModeShadow || repo.settlements[0].Status != SettlementStatusPosted {
		t.Fatalf("unexpected settlement record: %#v", repo.settlements[0])
	}
}

func TestWalletShadowSettlementCreatesHypotheticalSplit(t *testing.T) {
	repo := &fakeSettlementRepo{}
	service := NewShadowSettlementService(repo)
	err := service.SettleCompletedRideShadow(context.Background(), CompletedRide{
		RideID:        "ride-1",
		RiderID:       "rider-1",
		DriverID:      "driver-1",
		FareMinor:     8000,
		PaymentMethod: "wallet",
		Currency:      CurrencyUSD,
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(repo.accounts) != 3 || len(repo.entries) != 3 {
		t.Fatalf("expected rider, driver, platform accounts and three entries, got accounts=%d entries=%d", len(repo.accounts), len(repo.entries))
	}
	if repo.entries[0].EntryType != EntryTypeDebit || repo.entries[0].AmountMinor != 8000 {
		t.Fatalf("expected hypothetical rider debit, got %#v", repo.entries[0])
	}
	if repo.entries[1].AmountMinor != 6800 || repo.entries[2].AmountMinor != 1200 {
		t.Fatalf("expected 85/15 split, got %#v", repo.entries)
	}
}

func TestUnsupportedPaymentMethodRecordsFailedSettlement(t *testing.T) {
	repo := &fakeSettlementRepo{}
	service := NewShadowSettlementService(repo)
	err := service.SettleCompletedRideShadow(context.Background(), CompletedRide{
		RideID:        "ride-1",
		RiderID:       "rider-1",
		DriverID:      "driver-1",
		FareMinor:     8000,
		PaymentMethod: "ecocash",
		Currency:      CurrencyUSD,
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(repo.transactions) != 0 || len(repo.settlements) != 1 {
		t.Fatalf("unsupported method should only record failed settlement, tx=%d settlements=%d", len(repo.transactions), len(repo.settlements))
	}
	if repo.settlements[0].Status != SettlementStatusFailed {
		t.Fatalf("expected failed settlement, got %#v", repo.settlements[0])
	}
}

func TestShadowSettlementRepositoryFailureReturnsErrorForAsyncLogger(t *testing.T) {
	repo := &fakeSettlementRepo{err: errors.New("db unavailable")}
	service := NewShadowSettlementService(repo)
	err := service.SettleCompletedRideShadow(context.Background(), CompletedRide{
		RideID:        "ride-1",
		RiderID:       "rider-1",
		DriverID:      "driver-1",
		FareMinor:     10000,
		PaymentMethod: "cash",
		Currency:      CurrencyUSD,
	})
	if err == nil {
		t.Fatal("expected repository error")
	}
}
