package wallet

import (
	"context"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/google/uuid"
)

type ActiveSettlementConfig struct {
	Enabled     bool
	CashEnabled bool
}

type ActiveCashSettlementRepository interface {
	PostActiveCashSettlement(ctx context.Context, ride CompletedRide, calc SettlementCalculation) (SettlementRecord, error)
	RecordActiveCashSettlementFailure(ctx context.Context, ride CompletedRide, calc SettlementCalculation, cause error) error
}

type ActiveCashSettlementService struct {
	repo   ActiveCashSettlementRepository
	config ActiveSettlementConfig
	now    func() time.Time
}

func NewActiveCashSettlementService(repo ActiveCashSettlementRepository, config ActiveSettlementConfig) *ActiveCashSettlementService {
	return &ActiveCashSettlementService{repo: repo, config: config, now: time.Now}
}

func (s *ActiveCashSettlementService) RecordCompletedCashRide(ctx context.Context, ride CompletedRide) {
	if s == nil || s.repo == nil || !s.config.Enabled || !s.config.CashEnabled {
		return
	}
	if strings.ToLower(defaultString(ride.PaymentMethod, "cash")) != "cash" {
		return
	}
	go func() {
		if err := s.SettleCompletedCashRide(context.Background(), ride); err != nil {
			log.Println("Active cash settlement warning:", err)
		}
	}()
}

func (s *ActiveCashSettlementService) SettleCompletedCashRide(ctx context.Context, ride CompletedRide) error {
	if s == nil || s.repo == nil || !s.config.Enabled || !s.config.CashEnabled {
		return nil
	}
	if strings.ToLower(defaultString(ride.PaymentMethod, "cash")) != "cash" {
		return nil
	}
	if ride.CompletedAt.IsZero() {
		ride.CompletedAt = s.now().UTC()
	}
	calc, err := CalculateSettlement(ride.FareMinor, defaultString(ride.Currency, CurrencyUSD))
	if err != nil {
		_ = s.repo.RecordActiveCashSettlementFailure(ctx, ride, calc, err)
		s.recordSettlementFailureMetric(ctx, ride, err)
		return err
	}
	_, err = s.repo.PostActiveCashSettlement(ctx, ride, calc)
	if err != nil {
		if failureErr := s.repo.RecordActiveCashSettlementFailure(ctx, ride, calc, err); failureErr != nil {
			return fmt.Errorf("%w; failed to record active settlement failure: %v", err, failureErr)
		}
		s.recordSettlementFailureMetric(ctx, ride, err)
		return err
	}
	return nil
}

func (s *ActiveCashSettlementService) recordSettlementFailureMetric(ctx context.Context, ride CompletedRide, cause error) {
	observer, ok := s.repo.(FinancialJobRepository)
	if !ok {
		return
	}
	_ = observer.CreateFinancialJob(ctx, FinancialJob{
		JobType:        FinancialJobTypeCashSettlement,
		Status:         FinancialJobStatusPending,
		SourceType:     "ride",
		SourceID:       ride.RideID,
		Provider:       "internal",
		IdempotencyKey: "cash-settlement-job:" + ride.RideID,
		FailureReason:  cause.Error(),
		Metadata:       "{}",
	})
	_ = observer.RecordFinancialMetric(ctx, FinancialMetric{
		MetricType:    FinancialMetricSettlementFailure,
		Provider:      "internal",
		ReferenceType: "ride",
		ReferenceID:   ride.RideID,
		Metadata:      "{}",
	})
}

func activeCashSettlementIdempotencyKey(rideID string) string {
	return "cash-settlement:" + rideID
}

func activeCashSettlementTransaction(ride CompletedRide, calc SettlementCalculation, totalAmountMinor int64) Transaction {
	return Transaction{
		ID:               uuid.NewString(),
		TransactionType:  TransactionTypeCashPlatformFee,
		Status:           TransactionStatusPosted,
		IdempotencyKey:   activeCashSettlementIdempotencyKey(ride.RideID),
		Currency:         calc.Currency,
		TotalAmountMinor: totalAmountMinor,
		SourceType:       "ride",
		SourceID:         ride.RideID,
		OwnerUserID:      ride.DriverID,
		RideID:           ride.RideID,
		PaymentProvider:  "cash",
		CreatedBy:        ride.DriverID,
	}
}

func activeCashSettlementEntry(transactionID string, accountID string, entryType string, amountMinor int64, ride CompletedRide, calc SettlementCalculation) LedgerEntry {
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
		PaymentProvider: "cash",
	}
}
