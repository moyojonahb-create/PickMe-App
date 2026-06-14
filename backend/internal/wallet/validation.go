package wallet

import (
	"errors"
	"fmt"
)

var (
	ErrInvalidAccountType       = errors.New("invalid wallet account type")
	ErrInvalidOwnerRole         = errors.New("invalid wallet owner role")
	ErrInvalidAccountStatus     = errors.New("invalid wallet account status")
	ErrInvalidTransactionType   = errors.New("invalid wallet transaction type")
	ErrInvalidTransactionState  = errors.New("invalid wallet transaction status")
	ErrInvalidLedgerEntry       = errors.New("invalid wallet ledger entry")
	ErrInvalidCurrency          = errors.New("invalid wallet currency")
	ErrInvalidIdempotencyKey    = errors.New("invalid idempotency key")
	ErrInvalidPaymentMethod     = errors.New("invalid payment method")
	ErrUnbalancedTransaction    = errors.New("wallet transaction is not balanced")
	ErrInsufficientFunds        = errors.New("insufficient wallet balance")
	ErrAuthorizationNotFound    = errors.New("wallet authorization not found")
	ErrAuthorizationState       = errors.New("invalid wallet authorization state")
	ErrPilotAccessDenied        = errors.New("wallet internal pilot access denied")
	ErrWalletPilotNotAuthorized = errors.New("wallet pilot not authorized")
	ErrWalletPilotLimitExceeded = errors.New("wallet pilot limit exceeded")
	ErrWalletPilotDisabled      = errors.New("wallet pilot disabled")
)

func ValidateAccount(account Account) error {
	if !validAccountType(account.AccountType) {
		return ErrInvalidAccountType
	}
	if !validOwnerRole(account.OwnerRole) {
		return ErrInvalidOwnerRole
	}
	if !validAccountStatus(defaultString(account.Status, AccountStatusActive)) {
		return ErrInvalidAccountStatus
	}
	return ValidateCurrency(account.Currency)
}

func ValidateTransaction(transaction Transaction) error {
	if !validTransactionType(transaction.TransactionType) {
		return ErrInvalidTransactionType
	}
	if !validTransactionStatus(defaultString(transaction.Status, TransactionStatusPending)) {
		return ErrInvalidTransactionState
	}
	if err := ValidateCurrency(transaction.Currency); err != nil {
		return err
	}
	totalMinor := transaction.TotalAmountMinor
	if totalMinor <= 0 {
		return fmt.Errorf("%w: total amount (minor) must be positive", ErrInvalidLedgerEntry)
	}
	return ValidateIdempotencyKey(transaction.IdempotencyKey)
}

func ValidateLedgerEntry(entry LedgerEntry) error {
	if entry.AccountID == "" {
		return fmt.Errorf("%w: account_id is required", ErrInvalidLedgerEntry)
	}
	if entry.EntryType != EntryTypeDebit && entry.EntryType != EntryTypeCredit {
		return fmt.Errorf("%w: entry_type must be debit or credit", ErrInvalidLedgerEntry)
	}
	amountMinor := entry.AmountMinor
	if amountMinor <= 0 {
		return fmt.Errorf("%w: amount (minor) must be positive", ErrInvalidLedgerEntry)
	}
	if err := ValidateCurrency(entry.Currency); err != nil {
		return err
	}
	return nil
}

func ValidateBalancedTransaction(transaction Transaction, entries []LedgerEntry) error {
	if err := ValidateTransaction(transaction); err != nil {
		return err
	}
	if len(entries) < 2 {
		return fmt.Errorf("%w: at least two ledger entries are required", ErrUnbalancedTransaction)
	}
	var debits int64
	var credits int64
	for _, entry := range entries {
		if err := ValidateLedgerEntry(entry); err != nil {
			return err
		}
		if entry.Currency != transaction.Currency {
			return ErrInvalidCurrency
		}
		entryMinor := entry.AmountMinor
		if entryMinor <= 0 {
			return fmt.Errorf("%w: amount (minor) must be positive", ErrInvalidLedgerEntry)
		}
		switch entry.EntryType {
		case EntryTypeDebit:
			debits += entryMinor
		case EntryTypeCredit:
			credits += entryMinor
		}
	}
	if debits != credits {
		return fmt.Errorf("%w: debits_minor %d credits_minor %d", ErrUnbalancedTransaction, debits, credits)
	}
	totalMinor := transaction.TotalAmountMinor
	if totalMinor <= 0 {
		return fmt.Errorf("%w: transaction total must be positive", ErrUnbalancedTransaction)
	}
	if totalMinor != debits {
		return fmt.Errorf("%w: transaction_total_minor %d does not equal debits_minor %d", ErrUnbalancedTransaction, totalMinor, debits)
	}
	return nil
}

func ValidateCurrency(currency string) error {
	if currency != CurrencyUSD && currency != CurrencyZWG {
		return ErrInvalidCurrency
	}
	return nil
}

func ValidateIdempotencyKey(key string) error {
	if len(key) < 8 || len(key) > 200 {
		return ErrInvalidIdempotencyKey
	}
	return nil
}

func ValidateManualPaymentMethod(method string) error {
	switch method {
	case ManualMethodEcoCash,
		ManualMethodInnbucks,
		ManualMethodBank,
		ManualMethodCash,
		ManualMethodCard,
		ManualMethodPayPal:
		return nil
	default:
		return ErrInvalidPaymentMethod
	}
}

func ValidateDepositRequest(req DepositRequest) error {
	if req.UserID == "" {
		return fmt.Errorf("%w: user_id is required", ErrInvalidLedgerEntry)
	}
	if req.WalletAccountType == "" {
		req.WalletAccountType = AccountTypeRiderWallet
	}
	if req.WalletAccountType != AccountTypeRiderWallet && req.WalletAccountType != AccountTypeDriverWallet {
		return ErrInvalidAccountType
	}
	if req.AmountMinor <= 0 {
		return fmt.Errorf("%w: amount_minor must be positive", ErrInvalidLedgerEntry)
	}
	if err := ValidateCurrency(req.Currency); err != nil {
		return err
	}
	if err := ValidateManualPaymentMethod(req.Method); err != nil {
		return err
	}
	return ValidateIdempotencyKey(req.IdempotencyKey)
}

func ValidateWithdrawalRequest(req WithdrawalCreateRequest) error {
	if req.DriverID == "" {
		return fmt.Errorf("%w: driver_id is required", ErrInvalidLedgerEntry)
	}
	if req.AmountMinor <= 0 {
		return fmt.Errorf("%w: amount_minor must be positive", ErrInvalidLedgerEntry)
	}
	if err := ValidateCurrency(req.Currency); err != nil {
		return err
	}
	if err := ValidateManualPaymentMethod(req.Method); err != nil {
		return err
	}
	if req.DestinationReference == "" {
		return fmt.Errorf("%w: destination_reference is required", ErrInvalidLedgerEntry)
	}
	return ValidateIdempotencyKey(req.IdempotencyKey)
}

func validAccountType(value string) bool {
	switch value {
	case AccountTypeRiderWallet,
		AccountTypeDriverWallet,
		AccountTypePlatformWallet,
		AccountTypeCashLiabilityWallet,
		AccountTypePendingDepositWallet,
		AccountTypeProviderClearing:
		return true
	default:
		return false
	}
}

func validOwnerRole(value string) bool {
	switch value {
	case OwnerRoleRider, OwnerRoleDriver, OwnerRolePlatform, OwnerRoleSystem:
		return true
	default:
		return false
	}
}

func validAccountStatus(value string) bool {
	switch value {
	case AccountStatusActive, AccountStatusFrozen, AccountStatusClosed:
		return true
	default:
		return false
	}
}

func validTransactionType(value string) bool {
	switch value {
	case TransactionTypeRideSettlement,
		TransactionTypeCashLiability,
		TransactionTypeDeposit,
		TransactionTypeWithdrawal,
		TransactionTypeRefund,
		TransactionTypeReversal,
		TransactionTypeAdminAdjustment,
		TransactionTypeShadowSettlement,
		TransactionTypeCashPlatformFee,
		TransactionTypeWalletSettlement:
		return true
	default:
		return false
	}
}

func validTransactionStatus(value string) bool {
	switch value {
	case TransactionStatusPending,
		TransactionStatusPosted,
		TransactionStatusReversed,
		TransactionStatusFailed,
		TransactionStatusCancelled,
		TransactionStatusRequiresApproval:
		return true
	default:
		return false
	}
}

func defaultString(value string, fallback string) string {
	if value == "" {
		return fallback
	}
	return value
}
