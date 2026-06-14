package wallet

import (
	"context"
	"errors"
	"fmt"
	"log"
	"time"
)

type PublicWalletPilotEnforcementConfig struct {
	Enabled         bool
	ProgramID       string
	City            string
	DefaultCurrency string
}

type WalletPilotMutationRequest struct {
	Endpoint        string
	UserID          string
	ParticipantType string
	City            string
	TransactionType string
	AmountMinor     int64
	Currency        string
	WalletID        string
	EvidenceID      string
}

type WalletPilotRuntimeEnforcer interface {
	Enabled() bool
	GuardWalletMutation(ctx context.Context, req WalletPilotMutationRequest) error
	RecordWalletMutation(ctx context.Context, req WalletPilotMutationRequest) error
}

type PublicWalletPilotRuntimeEnforcer struct {
	service *PublicWalletPilotService
	config  PublicWalletPilotEnforcementConfig
	now     func() time.Time
}

func NewPublicWalletPilotRuntimeEnforcer(service *PublicWalletPilotService, config PublicWalletPilotEnforcementConfig) *PublicWalletPilotRuntimeEnforcer {
	if config.City == "" {
		config.City = WalletPilotCityGwanda
	}
	if config.DefaultCurrency == "" {
		config.DefaultCurrency = CurrencyUSD
	}
	return &PublicWalletPilotRuntimeEnforcer{service: service, config: config, now: time.Now}
}

func (e *PublicWalletPilotRuntimeEnforcer) Enabled() bool {
	return e != nil && e.service != nil && e.config.Enabled
}

func (e *PublicWalletPilotRuntimeEnforcer) GuardWalletMutation(ctx context.Context, req WalletPilotMutationRequest) error {
	normalized, err := e.normalize(req)
	if err != nil {
		e.logDenied(req, "invalid_request")
		return err
	}
	if !e.Enabled() {
		e.logDenied(normalized, "pilot_not_enabled")
		return ErrWalletPilotNotAuthorized
	}
	if e.config.ProgramID == "" {
		e.logDenied(normalized, "pilot_program_not_configured")
		return ErrWalletPilotNotAuthorized
	}
	if normalized.AmountMinor <= 0 {
		e.logDenied(normalized, "invalid_amount")
		return ErrWalletPilotLimitExceeded
	}
	err = e.service.ValidateWalletTransactionLimits(ctx, PublicWalletPilotTransactionRequest{
		ProgramID:       e.config.ProgramID,
		WalletID:        normalized.WalletID,
		UserID:          normalized.UserID,
		ParticipantType: normalized.ParticipantType,
		City:            normalized.City,
		TransactionType: normalized.TransactionType,
		AmountMinor:     normalized.AmountMinor,
		Currency:        normalized.Currency,
		EvidenceID:      normalized.EvidenceID,
	})
	if err != nil {
		reason := walletPilotDenialReason(err)
		e.logDenied(normalized, reason)
		return err
	}
	return nil
}

func (e *PublicWalletPilotRuntimeEnforcer) RecordWalletMutation(ctx context.Context, req WalletPilotMutationRequest) error {
	if !e.Enabled() {
		return nil
	}
	normalized, err := e.normalize(req)
	if err != nil {
		return err
	}
	if normalized.AmountMinor <= 0 {
		return ErrWalletPilotLimitExceeded
	}
	_, err = e.service.RecordPilotTransaction(ctx, PublicWalletPilotTransactionRequest{
		ProgramID:       e.config.ProgramID,
		WalletID:        normalized.WalletID,
		UserID:          normalized.UserID,
		ParticipantType: normalized.ParticipantType,
		City:            normalized.City,
		TransactionType: normalized.TransactionType,
		AmountMinor:     normalized.AmountMinor,
		Currency:        normalized.Currency,
		EvidenceID:      normalized.EvidenceID,
	})
	return err
}

func (e *PublicWalletPilotRuntimeEnforcer) normalize(req WalletPilotMutationRequest) (WalletPilotMutationRequest, error) {
	if req.UserID == "" || !validWalletPilotParticipantType(req.ParticipantType) || !validWalletPilotTransactionType(req.TransactionType) {
		return req, ErrWalletPilotNotAuthorized
	}
	if req.City == "" {
		req.City = e.config.City
	}
	if !validWalletPilotCity(req.City) || req.City != e.config.City {
		return req, ErrWalletPilotNotAuthorized
	}
	if req.Currency == "" {
		req.Currency = e.config.DefaultCurrency
	}
	if req.WalletID == "" {
		req.WalletID = walletPilotAccountID(req.UserID, req.ParticipantType, req.Currency)
	}
	if req.WalletID == "" {
		return req, ErrWalletPilotNotAuthorized
	}
	return req, nil
}

func (e *PublicWalletPilotRuntimeEnforcer) logDenied(req WalletPilotMutationRequest, reason string) {
	timestamp := time.Now().UTC()
	if e != nil && e.now != nil {
		timestamp = e.now().UTC()
	}
	log.Printf(
		"SECURITY_WALLET_PILOT_DENIED user_id=%s endpoint=%s transaction_type=%s city=%s amount_minor=%d reason=%s timestamp=%s",
		req.UserID,
		req.Endpoint,
		req.TransactionType,
		req.City,
		req.AmountMinor,
		reason,
		timestamp.Format(time.RFC3339),
	)
}

func walletPilotAccountID(userID string, participantType string, currency string) string {
	switch participantType {
	case WalletPilotParticipantTypeRider:
		return deterministicAccountID(userID, AccountTypeRiderWallet, currency)
	case WalletPilotParticipantTypeDriver:
		return deterministicAccountID(userID, AccountTypeDriverWallet, currency)
	default:
		return ""
	}
}

func walletPilotDenialReason(err error) string {
	switch {
	case errors.Is(err, ErrWalletPilotDisabled):
		return "kill_switch_active"
	case errors.Is(err, ErrWalletPilotLimitExceeded):
		return "limit_exceeded"
	case errors.Is(err, ErrWalletPilotNotAuthorized):
		return "not_authorized"
	default:
		return fmt.Sprintf("guard_error:%T", err)
	}
}
