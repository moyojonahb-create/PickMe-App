package money

import (
	"errors"
	"fmt"
	"strconv"
	"strings"
)

const (
	CurrencyUSD = "USD"
	CurrencyZWG = "ZWG"

	PlatformFeeBps = int64(1500)
)

var (
	ErrInvalidAmount   = errors.New("invalid money amount")
	ErrInvalidCurrency = errors.New("invalid money currency")
	ErrInvalidSplit    = errors.New("invalid money split")
)

type Money struct {
	AmountMinor int64
	Currency    string
}

func CurrencyExponent(currency string) (int, error) {
	switch currency {
	case CurrencyUSD, CurrencyZWG:
		return 2, nil
	default:
		return 0, ErrInvalidCurrency
	}
}

func ParseAmount(value any, currency string) (Money, error) {
	exponent, err := CurrencyExponent(currency)
	if err != nil {
		return Money{}, err
	}
	switch typed := value.(type) {
	case Money:
		if typed.Currency != currency {
			return Money{}, ErrInvalidCurrency
		}
		if typed.AmountMinor < 0 {
			return Money{}, ErrInvalidAmount
		}
		return typed, nil
	case int64:
		if typed < 0 {
			return Money{}, ErrInvalidAmount
		}
		return Money{AmountMinor: typed, Currency: currency}, nil
	case int:
		if typed < 0 {
			return Money{}, ErrInvalidAmount
		}
		return Money{AmountMinor: int64(typed), Currency: currency}, nil
	case string:
		return parseAmountString(typed, currency, exponent)
	default:
		return Money{}, ErrInvalidAmount
	}
}

func FormatAmount(amount Money) string {
	exponent, err := CurrencyExponent(amount.Currency)
	if err != nil {
		return ""
	}
	if exponent == 0 {
		return strconv.FormatInt(amount.AmountMinor, 10)
	}
	scale := int64(1)
	for i := 0; i < exponent; i++ {
		scale *= 10
	}
	whole := amount.AmountMinor / scale
	fraction := amount.AmountMinor % scale
	return fmt.Sprintf("%d.%0*d", whole, exponent, fraction)
}

func PlatformFee(fare Money) Money {
	return Money{AmountMinor: (fare.AmountMinor*PlatformFeeBps + 5000) / 10000, Currency: fare.Currency}
}

func DriverEarnings(fare Money) Money {
	fee := PlatformFee(fare)
	return Money{AmountMinor: fare.AmountMinor - fee.AmountMinor, Currency: fare.Currency}
}

func ValidateSplit(fare Money, platformFee Money, driverEarnings Money) error {
	if fare.Currency != platformFee.Currency || fare.Currency != driverEarnings.Currency {
		return ErrInvalidCurrency
	}
	if fare.AmountMinor <= 0 || platformFee.AmountMinor < 0 || driverEarnings.AmountMinor < 0 {
		return ErrInvalidAmount
	}
	if platformFee.AmountMinor+driverEarnings.AmountMinor != fare.AmountMinor {
		return ErrInvalidSplit
	}
	return nil
}

func parseAmountString(value string, currency string, exponent int) (Money, error) {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" || strings.HasPrefix(trimmed, "-") {
		return Money{}, ErrInvalidAmount
	}
	parts := strings.Split(trimmed, ".")
	if len(parts) > 2 {
		return Money{}, ErrInvalidAmount
	}
	whole, err := strconv.ParseInt(defaultString(parts[0], "0"), 10, 64)
	if err != nil {
		return Money{}, ErrInvalidAmount
	}
	fractionText := ""
	if len(parts) == 2 {
		fractionText = parts[1]
	}
	if len(fractionText) > exponent {
		return Money{}, ErrInvalidAmount
	}
	for len(fractionText) < exponent {
		fractionText += "0"
	}
	fraction, err := strconv.ParseInt(defaultString(fractionText, "0"), 10, 64)
	if err != nil {
		return Money{}, ErrInvalidAmount
	}
	scale := int64(1)
	for i := 0; i < exponent; i++ {
		scale *= 10
	}
	return Money{AmountMinor: whole*scale + fraction, Currency: currency}, nil
}

func defaultString(value string, fallback string) string {
	if value == "" {
		return fallback
	}
	return value
}
