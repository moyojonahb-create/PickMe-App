package wallet

import "testing"

func TestMoneyUsesMinorUnitsForRoundingAndSplits(t *testing.T) {
	fare, err := NewPositiveMoneyFromDecimal("10.55", CurrencyUSD)
	if err != nil {
		t.Fatal(err)
	}
	if fare.MinorUnits != 1055 || fare.DecimalString() != "10.55" {
		t.Fatalf("expected exact cent parsing, got %#v", fare)
	}
	fee := fare.MulBasisPoints(1500)
	earning, err := fare.Sub(fee)
	if err != nil {
		t.Fatal(err)
	}
	if fee.MinorUnits+earning.MinorUnits != fare.MinorUnits {
		t.Fatalf("split must conserve cents: fare=%d fee=%d earning=%d", fare.MinorUnits, fee.MinorUnits, earning.MinorUnits)
	}
}

func TestCalculateSettlementConservesMinorUnits(t *testing.T) {
	calc, err := CalculateSettlement(3333, CurrencyUSD)
	if err != nil {
		t.Fatal(err)
	}
	if calc.PlatformFeeMinor+calc.DriverEarningMinor != calc.FareMinor {
		t.Fatalf("settlement must balance in minor units: %#v", calc)
	}
}

func TestValidateBalancedTransactionUsesMinorUnits(t *testing.T) {
	transaction := testTransaction()
	transaction.TotalAmountMinor = 1001
	entries := testEntries()
	entries[0].AmountMinor = 1001
	entries[1].AmountMinor = 1001
	if err := ValidateBalancedTransaction(transaction, entries); err != nil {
		t.Fatalf("expected rounded minor-unit balance, got %v", err)
	}
}
