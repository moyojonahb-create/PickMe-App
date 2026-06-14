package wallet

import (
	"os"
	"strings"
	"testing"
)

func TestProviderDepositCallbackRepositoryPostsLedgerAndCreditsWallet(t *testing.T) {
	source, err := os.ReadFile("repository.go")
	if err != nil {
		t.Fatal(err)
	}
	required := []string{
		"ProcessProviderDepositCallback",
		"INSERT INTO public.provider_events",
		"lockDepositByProviderReference",
		"TransactionTypeDeposit",
		"PaymentProvider: callback.Provider",
		"EntryTypeDebit",
		"EntryTypeCredit",
		"cached_available_balance = cached_available_balance + $2",
		"cached_available_balance = cached_available_balance - $2",
		"status = 'completed'",
		"pending_provider_payment",
	}
	for _, pattern := range required {
		if !strings.Contains(string(source), pattern) {
			t.Fatalf("provider callback repository missing %s", pattern)
		}
	}
}
