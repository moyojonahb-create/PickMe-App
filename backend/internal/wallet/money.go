package wallet

import (
	"fmt"

	moneycore "pickme-backend/internal/money"
)

type Money struct {
	MinorUnits int64
	Currency   string
}

func NewMoneyFromDecimal(amount string, currency string) (Money, error) {
	parsed, err := moneycore.ParseAmount(amount, currency)
	return Money{MinorUnits: parsed.AmountMinor, Currency: parsed.Currency}, mapMoneyError(err)
}

func NewPositiveMoneyFromDecimal(amount string, currency string) (Money, error) {
	money, err := NewMoneyFromDecimal(amount, currency)
	if err != nil {
		return Money{}, err
	}
	if money.MinorUnits <= 0 {
		return Money{}, fmt.Errorf("%w: amount must be positive", ErrInvalidLedgerEntry)
	}
	return money, nil
}

// NewMoneyFromMinor creates a Money value directly from minor units.
// Use this when callers already have integer minor-units to avoid float conversions.
func NewMoneyFromMinor(minorUnits int64, currency string) (Money, error) {
	parsed, err := moneycore.ParseAmount(minorUnits, currency)
	return Money{MinorUnits: parsed.AmountMinor, Currency: parsed.Currency}, mapMoneyError(err)
}

// NewPositiveMoneyFromMinor creates a Money value from minor units and ensures it's > 0.
func NewPositiveMoneyFromMinor(minorUnits int64, currency string) (Money, error) {
	money, err := NewMoneyFromMinor(minorUnits, currency)
	if err != nil {
		return Money{}, err
	}
	if money.MinorUnits <= 0 {
		return Money{}, fmt.Errorf("%w: amount must be positive", ErrInvalidLedgerEntry)
	}
	return money, nil
}

func MoneyFromMinor(minorUnits int64, currency string) (Money, error) {
	parsed, err := moneycore.ParseAmount(minorUnits, currency)
	return Money{MinorUnits: parsed.AmountMinor, Currency: parsed.Currency}, mapMoneyError(err)
}

func (m Money) DecimalString() string {
	return moneycore.FormatAmount(moneycore.Money{AmountMinor: m.MinorUnits, Currency: m.Currency})
}

func (m Money) Add(other Money) (Money, error) {
	if m.Currency != other.Currency {
		return Money{}, ErrInvalidCurrency
	}
	return Money{MinorUnits: m.MinorUnits + other.MinorUnits, Currency: m.Currency}, nil
}

func (m Money) Sub(other Money) (Money, error) {
	if m.Currency != other.Currency {
		return Money{}, ErrInvalidCurrency
	}
	if other.MinorUnits > m.MinorUnits {
		return Money{}, ErrInsufficientFunds
	}
	return Money{MinorUnits: m.MinorUnits - other.MinorUnits, Currency: m.Currency}, nil
}

func (m Money) MulBasisPoints(bps int64) Money {
	return Money{MinorUnits: (m.MinorUnits*bps + 5000) / 10000, Currency: m.Currency}
}

func MinorDecimalString(minorUnits int64, currency string) string {
	money, err := MoneyFromMinor(minorUnits, currency)
	if err != nil {
		return ""
	}
	return money.DecimalString()
}

func mapMoneyError(err error) error {
	if err == nil {
		return nil
	}
	if err == moneycore.ErrInvalidCurrency {
		return ErrInvalidCurrency
	}
	return ErrInvalidLedgerEntry
}
