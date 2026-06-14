package wallet

import (
	"context"
	"fmt"
	"time"
)

type AuthorizationConfig struct {
	Enabled         bool
	HoldTTL         time.Duration
	DefaultCurrency string
}

type AuthorizationRepository interface {
	AuthorizeRideFunds(ctx context.Context, req AuthorizationRequest, expiresAt time.Time) (WalletAuthorization, error)
	CaptureRideFunds(ctx context.Context, req CaptureRequest) (SettlementRecord, error)
	ReleaseRideFunds(ctx context.Context, req ReleaseRequest) (WalletAuthorization, error)
	ExpireRideAuthorization(ctx context.Context, rideID string, now time.Time) (WalletAuthorization, error)
	ExpireStaleAuthorizations(ctx context.Context, now time.Time, limit int) ([]WalletAuthorization, error)
}

type AuthorizationService struct {
	repo   AuthorizationRepository
	pilot  WalletPilotRuntimeEnforcer
	config AuthorizationConfig
	now    func() time.Time
}

func NewAuthorizationService(repo AuthorizationRepository, config AuthorizationConfig) *AuthorizationService {
	if config.HoldTTL <= 0 {
		config.HoldTTL = 30 * time.Minute
	}
	if config.DefaultCurrency == "" {
		config.DefaultCurrency = CurrencyUSD
	}
	return &AuthorizationService{repo: repo, config: config, now: time.Now}
}

func (s *AuthorizationService) WithWalletPilotEnforcer(pilot WalletPilotRuntimeEnforcer) *AuthorizationService {
	if s != nil {
		s.pilot = pilot
	}
	return s
}

func (s *AuthorizationService) Enabled() bool {
	return s != nil && s.repo != nil && s.config.Enabled
}

func (s *AuthorizationService) AuthorizeRideFunds(ctx context.Context, req AuthorizationRequest) (WalletAuthorization, error) {
	if !s.Enabled() {
		return WalletAuthorization{}, nil
	}
	if req.RideID == "" || req.RiderID == "" {
		return WalletAuthorization{}, fmt.Errorf("%w: ride_id and rider_id are required", ErrInvalidLedgerEntry)
	}
	if req.AmountMinor <= 0 {
		return WalletAuthorization{}, fmt.Errorf("%w: amount_minor must be positive", ErrInvalidLedgerEntry)
	}
	req.Currency = defaultString(req.Currency, s.config.DefaultCurrency)
	if _, err := NewPositiveMoneyFromMinor(req.AmountMinor, req.Currency); err != nil {
		return WalletAuthorization{}, err
	}
	req.IdempotencyKey = defaultString(req.IdempotencyKey, rideAuthorizationIdempotencyKey(req.RideID))
	if err := ValidateIdempotencyKey(req.IdempotencyKey); err != nil {
		return WalletAuthorization{}, err
	}
	if err := s.guardWalletPilot(ctx, WalletPilotMutationRequest{
		Endpoint:        "wallet_authorization",
		UserID:          req.RiderID,
		ParticipantType: WalletPilotParticipantTypeRider,
		City:            req.City,
		TransactionType: WalletPilotTransactionTypeRidePayment,
		AmountMinor:     req.AmountMinor,
		Currency:        req.Currency,
	}); err != nil {
		return WalletAuthorization{}, err
	}
	return s.repo.AuthorizeRideFunds(ctx, req, s.now().UTC().Add(s.config.HoldTTL))
}

func (s *AuthorizationService) CaptureRideFunds(ctx context.Context, req CaptureRequest) (SettlementRecord, error) {
	if !s.Enabled() {
		return SettlementRecord{}, nil
	}
	if req.RideID == "" || req.RiderID == "" || req.DriverID == "" {
		return SettlementRecord{}, fmt.Errorf("%w: ride_id, rider_id, and driver_id are required", ErrInvalidLedgerEntry)
	}
	req.Currency = defaultString(req.Currency, s.config.DefaultCurrency)
	if err := ValidateCurrency(req.Currency); err != nil {
		return SettlementRecord{}, err
	}
	if req.AmountMinor > 0 {
		if _, err := NewPositiveMoneyFromMinor(req.AmountMinor, req.Currency); err != nil {
			return SettlementRecord{}, err
		}
	}
	req.IdempotencyKey = defaultString(req.IdempotencyKey, rideCaptureIdempotencyKey(req.RideID))
	if err := ValidateIdempotencyKey(req.IdempotencyKey); err != nil {
		return SettlementRecord{}, err
	}
	if err := s.guardWalletPilot(ctx, WalletPilotMutationRequest{
		Endpoint:        "wallet_capture:rider",
		UserID:          req.RiderID,
		ParticipantType: WalletPilotParticipantTypeRider,
		City:            req.City,
		TransactionType: WalletPilotTransactionTypeRidePayment,
		AmountMinor:     req.AmountMinor,
		Currency:        req.Currency,
	}); err != nil {
		return SettlementRecord{}, err
	}
	if err := s.guardWalletPilot(ctx, WalletPilotMutationRequest{
		Endpoint:        "wallet_capture:driver",
		UserID:          req.DriverID,
		ParticipantType: WalletPilotParticipantTypeDriver,
		City:            req.City,
		TransactionType: WalletPilotTransactionTypeRidePayment,
		AmountMinor:     req.AmountMinor,
		Currency:        req.Currency,
	}); err != nil {
		return SettlementRecord{}, err
	}
	settlement, err := s.repo.CaptureRideFunds(ctx, req)
	if err != nil {
		s.recordAuthorizationJob(ctx, FinancialJobTypeWalletCapture, FinancialMetricFailedCapture, req.RideID, "wallet-capture-job:"+req.RideID, err)
	} else {
		_ = s.recordWalletPilot(ctx, WalletPilotMutationRequest{
			Endpoint:        "wallet_capture",
			UserID:          req.RiderID,
			ParticipantType: WalletPilotParticipantTypeRider,
			City:            req.City,
			TransactionType: WalletPilotTransactionTypeRidePayment,
			AmountMinor:     req.AmountMinor,
			Currency:        req.Currency,
			EvidenceID:      settlement.WalletTransactionID,
		})
	}
	return settlement, err
}

func (s *AuthorizationService) ReleaseRideFunds(ctx context.Context, req ReleaseRequest) (WalletAuthorization, error) {
	if !s.Enabled() {
		return WalletAuthorization{}, nil
	}
	if req.RideID == "" || req.RiderID == "" {
		return WalletAuthorization{}, fmt.Errorf("%w: ride_id and rider_id are required", ErrInvalidLedgerEntry)
	}
	req.IdempotencyKey = defaultString(req.IdempotencyKey, rideReleaseIdempotencyKey(req.RideID))
	if err := ValidateIdempotencyKey(req.IdempotencyKey); err != nil {
		return WalletAuthorization{}, err
	}
	authorization, err := s.repo.ReleaseRideFunds(ctx, req)
	if err != nil {
		s.recordAuthorizationJob(ctx, FinancialJobTypeAuthorizationRelease, FinancialMetricFailedRelease, req.RideID, "authorization-release-job:"+req.RideID, err)
	}
	return authorization, err
}

func (s *AuthorizationService) guardWalletPilot(ctx context.Context, req WalletPilotMutationRequest) error {
	if s == nil || s.pilot == nil {
		return nil
	}
	return s.pilot.GuardWalletMutation(ctx, req)
}

func (s *AuthorizationService) recordWalletPilot(ctx context.Context, req WalletPilotMutationRequest) error {
	if s == nil || s.pilot == nil {
		return nil
	}
	return s.pilot.RecordWalletMutation(ctx, req)
}

func (s *AuthorizationService) ExpireRideAuthorization(ctx context.Context, rideID string) (WalletAuthorization, error) {
	if !s.Enabled() {
		return WalletAuthorization{}, nil
	}
	if rideID == "" {
		return WalletAuthorization{}, fmt.Errorf("%w: ride_id is required", ErrInvalidLedgerEntry)
	}
	authorization, err := s.repo.ExpireRideAuthorization(ctx, rideID, s.now().UTC())
	if err != nil {
		s.recordAuthorizationJob(ctx, FinancialJobTypeAuthorizationExpiration, FinancialMetricExpiredAuthorization, rideID, "authorization-expiration-job:"+rideID, err)
	}
	return authorization, err
}

func (s *AuthorizationService) ExpireStaleAuthorizations(ctx context.Context, limit int) ([]WalletAuthorization, error) {
	if !s.Enabled() {
		return []WalletAuthorization{}, nil
	}
	if limit <= 0 {
		limit = 100
	}
	return s.repo.ExpireStaleAuthorizations(ctx, s.now().UTC(), limit)
}

func (s *AuthorizationService) StartExpirationWorker(ctx context.Context, interval time.Duration, limit int) {
	if !s.Enabled() {
		return
	}
	if interval <= 0 {
		interval = time.Minute
	}
	go func() {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				if _, err := s.ExpireStaleAuthorizations(ctx, limit); err != nil {
					fmt.Println("Wallet authorization expiration warning:", err)
				}
			}
		}
	}()
}

func (s *AuthorizationService) recordAuthorizationJob(ctx context.Context, jobType string, metricType string, rideID string, idempotencyKey string, cause error) {
	observer, ok := s.repo.(FinancialJobRepository)
	if !ok {
		return
	}
	_ = observer.CreateFinancialJob(ctx, FinancialJob{
		JobType:        jobType,
		Status:         FinancialJobStatusPending,
		SourceType:     "ride",
		SourceID:       rideID,
		Provider:       "internal",
		IdempotencyKey: idempotencyKey,
		FailureReason:  cause.Error(),
		Metadata:       "{}",
	})
	_ = observer.RecordFinancialMetric(ctx, FinancialMetric{
		MetricType:    metricType,
		Provider:      "internal",
		ReferenceType: "ride",
		ReferenceID:   rideID,
		Metadata:      "{}",
	})
}

func rideAuthorizationIdempotencyKey(rideID string) string {
	return "ride-authorization:" + rideID
}

func rideCaptureIdempotencyKey(rideID string) string {
	return "ride-capture:" + rideID
}

func rideReleaseIdempotencyKey(rideID string) string {
	return "ride-release:" + rideID
}
