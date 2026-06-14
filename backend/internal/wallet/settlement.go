package wallet

import (
	"context"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/google/uuid"

	moneycore "pickme-backend/internal/money"
)

const platformOwnerID = "00000000-0000-0000-0000-000000000001"

type ShadowSettlementRepository interface {
	EnsureAccount(ctx context.Context, account Account) (Account, error)
	PostLedgerEntries(ctx context.Context, transaction Transaction, entries []LedgerEntry) error
	CreateSettlementRecord(ctx context.Context, settlement SettlementRecord) error
}

type ShadowSettlementService struct {
	repo ShadowSettlementRepository
	now  func() time.Time
}

func NewShadowSettlementService(repo ShadowSettlementRepository) *ShadowSettlementService {
	return &ShadowSettlementService{repo: repo, now: time.Now}
}

func (s *ShadowSettlementService) RecordCompletedRide(ctx context.Context, ride CompletedRide) {
	if s == nil || s.repo == nil {
		return
	}
	go func() {
		if err := s.SettleCompletedRideShadow(context.Background(), ride); err != nil {
			log.Println("Shadow settlement warning:", err)
		}
	}()
}

func (s *ShadowSettlementService) SettleCompletedRideShadow(ctx context.Context, ride CompletedRide) error {
	if s == nil || s.repo == nil {
		return nil
	}
	if ride.CompletedAt.IsZero() {
		ride.CompletedAt = s.now().UTC()
	}
	calc, err := CalculateSettlement(ride.FareMinor, defaultString(ride.Currency, CurrencyUSD))
	if err != nil {
		return s.recordFailedSettlement(ctx, ride, calc, err)
	}

	method := strings.ToLower(defaultString(ride.PaymentMethod, "cash"))
	switch method {
	case "cash":
		return s.postCashShadowSettlement(ctx, ride, calc)
	case "wallet":
		return s.postWalletShadowSettlement(ctx, ride, calc)
	default:
		return s.recordFailedSettlement(ctx, ride, calc, fmt.Errorf("unsupported shadow settlement payment method: %s", method))
	}
}

func CalculateSettlement(fareMinor int64, currency string) (SettlementCalculation, error) {
	if err := ValidateCurrency(currency); err != nil {
		return SettlementCalculation{Currency: currency}, err
	}
	fareMoney, err := moneycore.ParseAmount(fareMinor, currency)
	if err != nil {
		return SettlementCalculation{Currency: currency}, fmt.Errorf("fare must be positive")
	}
	if fareMoney.AmountMinor <= 0 {
		return SettlementCalculation{Currency: currency}, fmt.Errorf("fare must be positive")
	}
	platformFeeMoney := moneycore.PlatformFee(fareMoney)
	driverEarningMoney := moneycore.DriverEarnings(fareMoney)
	if err := moneycore.ValidateSplit(fareMoney, platformFeeMoney, driverEarningMoney); err != nil {
		return SettlementCalculation{Currency: currency}, err
	}
	return SettlementCalculation{
		FareMinor:          fareMoney.AmountMinor,
		PlatformFeeMinor:   platformFeeMoney.AmountMinor,
		DriverEarningMinor: driverEarningMoney.AmountMinor,
		Currency:           currency,
	}, nil
}

func (s *ShadowSettlementService) postCashShadowSettlement(ctx context.Context, ride CompletedRide, calc SettlementCalculation) error {
	driverLiability, err := s.ensureAccount(ctx, ride.DriverID, OwnerRoleDriver, AccountTypeCashLiabilityWallet, calc.Currency)
	if err != nil {
		return err
	}
	platform, err := s.ensureAccount(ctx, platformOwnerID, OwnerRolePlatform, AccountTypePlatformWallet, calc.Currency)
	if err != nil {
		return err
	}
	transaction := s.transaction(ride, calc, "cash", calc.PlatformFeeMinor)
	entries := []LedgerEntry{
		s.entry(transaction.ID, driverLiability.ID, EntryTypeDebit, calc.PlatformFeeMinor, ride, calc),
		s.entry(transaction.ID, platform.ID, EntryTypeCredit, calc.PlatformFeeMinor, ride, calc),
	}
	if err := s.repo.PostLedgerEntries(ctx, transaction, entries); err != nil {
		return err
	}
	return s.recordPostedSettlement(ctx, ride, calc, transaction.ID, "cash")
}

func (s *ShadowSettlementService) postWalletShadowSettlement(ctx context.Context, ride CompletedRide, calc SettlementCalculation) error {
	rider, err := s.ensureAccount(ctx, ride.RiderID, OwnerRoleRider, AccountTypeRiderWallet, calc.Currency)
	if err != nil {
		return err
	}
	driver, err := s.ensureAccount(ctx, ride.DriverID, OwnerRoleDriver, AccountTypeDriverWallet, calc.Currency)
	if err != nil {
		return err
	}
	platform, err := s.ensureAccount(ctx, platformOwnerID, OwnerRolePlatform, AccountTypePlatformWallet, calc.Currency)
	if err != nil {
		return err
	}
	transaction := s.transaction(ride, calc, "wallet", calc.FareMinor)
	entries := []LedgerEntry{
		s.entry(transaction.ID, rider.ID, EntryTypeDebit, calc.FareMinor, ride, calc),
		s.entry(transaction.ID, driver.ID, EntryTypeCredit, calc.DriverEarningMinor, ride, calc),
		s.entry(transaction.ID, platform.ID, EntryTypeCredit, calc.PlatformFeeMinor, ride, calc),
	}
	if err := s.repo.PostLedgerEntries(ctx, transaction, entries); err != nil {
		return err
	}
	return s.recordPostedSettlement(ctx, ride, calc, transaction.ID, "wallet")
}

func (s *ShadowSettlementService) ensureAccount(ctx context.Context, ownerID string, ownerRole string, accountType string, currency string) (Account, error) {
	return s.repo.EnsureAccount(ctx, Account{
		ID:          deterministicAccountID(ownerID, accountType, currency),
		OwnerUserID: ownerID,
		OwnerRole:   ownerRole,
		AccountType: accountType,
		Currency:    currency,
		Status:      AccountStatusActive,
	})
}

func (s *ShadowSettlementService) transaction(ride CompletedRide, calc SettlementCalculation, method string, totalAmountMinor int64) Transaction {
	transactionID := uuid.NewString()
	return Transaction{
		ID:               transactionID,
		TransactionType:  TransactionTypeShadowSettlement,
		Status:           TransactionStatusPosted,
		IdempotencyKey:   settlementIdempotencyKey(ride.RideID, method),
		Currency:         calc.Currency,
		TotalAmountMinor: totalAmountMinor,
		SourceType:       "ride",
		SourceID:         ride.RideID,
		OwnerUserID:      ride.RiderID,
		RideID:           ride.RideID,
		PaymentProvider:  method,
		CreatedBy:        ride.RiderID,
	}
}

func (s *ShadowSettlementService) entry(transactionID string, accountID string, entryType string, amountMinor int64, ride CompletedRide, calc SettlementCalculation) LedgerEntry {
	return LedgerEntry{
		ID:              uuid.NewString(),
		TransactionID:   transactionID,
		AccountID:       accountID,
		EntryType:       entryType,
		AmountMinor:     amountMinor,
		Currency:        calc.Currency,
		RideID:          ride.RideID,
		SourceType:      "ride",
		SourceID:        ride.RideID,
		PaymentProvider: strings.ToLower(defaultString(ride.PaymentMethod, "cash")),
	}
}

func (s *ShadowSettlementService) recordPostedSettlement(ctx context.Context, ride CompletedRide, calc SettlementCalculation, transactionID string, method string) error {
	return s.repo.CreateSettlementRecord(ctx, SettlementRecord{
		ID:                  uuid.NewString(),
		RideID:              ride.RideID,
		DriverID:            ride.DriverID,
		RiderID:             ride.RiderID,
		FareMinor:           calc.FareMinor,
		PlatformFeeMinor:    calc.PlatformFeeMinor,
		DriverEarningMinor:  calc.DriverEarningMinor,
		Currency:            calc.Currency,
		PaymentMethod:       method,
		SettlementMode:      SettlementModeShadow,
		Status:              SettlementStatusPosted,
		WalletTransactionID: transactionID,
		IdempotencyKey:      settlementIdempotencyKey(ride.RideID, method),
	})
}

func (s *ShadowSettlementService) recordFailedSettlement(ctx context.Context, ride CompletedRide, calc SettlementCalculation, cause error) error {
	method := strings.ToLower(defaultString(ride.PaymentMethod, "cash"))
	return s.repo.CreateSettlementRecord(ctx, SettlementRecord{
		ID:                 uuid.NewString(),
		RideID:             ride.RideID,
		DriverID:           ride.DriverID,
		RiderID:            ride.RiderID,
		FareMinor:          calc.FareMinor,
		PlatformFeeMinor:   calc.PlatformFeeMinor,
		DriverEarningMinor: calc.DriverEarningMinor,
		Currency:           calc.Currency,
		PaymentMethod:      method,
		SettlementMode:     SettlementModeShadow,
		Status:             SettlementStatusFailed,
		IdempotencyKey:     settlementIdempotencyKey(ride.RideID, method),
		Error:              cause.Error(),
	})
}

func settlementIdempotencyKey(rideID string, method string) string {
	return "shadow-settlement:" + rideID + ":" + strings.ToLower(defaultString(method, "cash"))
}

func deterministicAccountID(ownerID string, accountType string, currency string) string {
	return uuid.NewSHA1(uuid.NameSpaceURL, []byte("pickme-wallet:"+ownerID+":"+accountType+":"+currency)).String()
}
