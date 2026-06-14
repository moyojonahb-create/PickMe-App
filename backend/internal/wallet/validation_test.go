package wallet

import (
	"errors"
	"testing"
)

func testTransaction() Transaction {
	return Transaction{
		ID:               "tx-1",
		TransactionType:  TransactionTypeDeposit,
		Status:           TransactionStatusPosted,
		IdempotencyKey:   "deposit-key-1",
		Currency:         CurrencyUSD,
		TotalAmountMinor: 1000,
	}
}

func testEntries() []LedgerEntry {
	return []LedgerEntry{
		{AccountID: "account-1", EntryType: EntryTypeDebit, AmountMinor: 1000, Currency: CurrencyUSD},
		{AccountID: "account-2", EntryType: EntryTypeCredit, AmountMinor: 1000, Currency: CurrencyUSD},
	}
}

func TestLedgerEntryValidation(t *testing.T) {
	if err := ValidateLedgerEntry(testEntries()[0]); err != nil {
		t.Fatalf("expected valid ledger entry: %v", err)
	}
	invalid := testEntries()[0]
	invalid.AmountMinor = 0
	if err := ValidateLedgerEntry(invalid); err == nil {
		t.Fatal("expected invalid amount error")
	}
	invalid = testEntries()[0]
	invalid.EntryType = "move"
	if err := ValidateLedgerEntry(invalid); err == nil {
		t.Fatal("expected invalid entry type error")
	}
}

func TestBalancedTransactionValidation(t *testing.T) {
	if err := ValidateBalancedTransaction(testTransaction(), testEntries()); err != nil {
		t.Fatalf("expected balanced transaction: %v", err)
	}
	entries := testEntries()
	entries[1].AmountMinor = 900
	err := ValidateBalancedTransaction(testTransaction(), entries)
	if !errors.Is(err, ErrUnbalancedTransaction) {
		t.Fatalf("expected unbalanced transaction error, got %v", err)
	}
}

func TestIdempotencyValidation(t *testing.T) {
	if err := ValidateIdempotencyKey("wallet-key-123"); err != nil {
		t.Fatalf("expected valid idempotency key: %v", err)
	}
	if err := ValidateIdempotencyKey("short"); !errors.Is(err, ErrInvalidIdempotencyKey) {
		t.Fatalf("expected invalid idempotency key, got %v", err)
	}
}

func TestValidAccountTypesAndCurrencies(t *testing.T) {
	account := Account{
		OwnerRole:   OwnerRoleRider,
		AccountType: AccountTypeRiderWallet,
		Currency:    CurrencyUSD,
		Status:      AccountStatusActive,
	}
	if err := ValidateAccount(account); err != nil {
		t.Fatalf("expected valid account: %v", err)
	}
	account.AccountType = "mutable_balance"
	if !errors.Is(ValidateAccount(account), ErrInvalidAccountType) {
		t.Fatal("expected invalid account type")
	}
}
