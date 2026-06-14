package money

import "testing"

func TestParseAndFormatAmount(t *testing.T) {
	amount, err := ParseAmount("10.55", CurrencyUSD)
	if err != nil {
		t.Fatal(err)
	}
	if amount.AmountMinor != 1055 {
		t.Fatalf("expected 1055 minor units, got %d", amount.AmountMinor)
	}
	if FormatAmount(amount) != "10.55" {
		t.Fatalf("unexpected formatted amount: %s", FormatAmount(amount))
	}
}

func TestParseAmountRejectsSubCentPrecision(t *testing.T) {
	if _, err := ParseAmount("0.001", CurrencyUSD); err != ErrInvalidAmount {
		t.Fatalf("expected invalid amount for sub-cent precision, got %v", err)
	}
}

func TestPlatformFeeDriverEarningsAndValidateSplit(t *testing.T) {
	fare, err := ParseAmount("33.33", CurrencyUSD)
	if err != nil {
		t.Fatal(err)
	}
	fee := PlatformFee(fare)
	earning := DriverEarnings(fare)
	if err := ValidateSplit(fare, fee, earning); err != nil {
		t.Fatal(err)
	}
	if fee.AmountMinor+earning.AmountMinor != fare.AmountMinor {
		t.Fatal("split must conserve minor units")
	}
}

func TestValidateSplitRejectsCurrencyMismatch(t *testing.T) {
	fare, _ := ParseAmount("10.00", CurrencyUSD)
	fee, _ := ParseAmount("1.50", CurrencyUSD)
	earning, _ := ParseAmount("8.50", CurrencyZWG)
	if err := ValidateSplit(fare, fee, earning); err != ErrInvalidCurrency {
		t.Fatalf("expected currency error, got %v", err)
	}
}
