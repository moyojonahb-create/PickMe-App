package wallet

import (
	"context"
	"testing"
)

type fakeRecoveryRepo struct {
	imports int
	refunds int
}

func (f *fakeRecoveryRepo) CreateRefundIntent(ctx context.Context, refund RefundIntent) (RefundIntent, error) {
	f.refunds++
	refund.ID = "refund-1"
	return refund, nil
}

func (f *fakeRecoveryRepo) CreateChargeback(ctx context.Context, chargeback ChargebackRecord) (ChargebackRecord, error) {
	return chargeback, nil
}

func (f *fakeRecoveryRepo) OpenDispute(ctx context.Context, dispute FinancialDispute) (FinancialDispute, error) {
	return dispute, nil
}

func (f *fakeRecoveryRepo) UpdateDisputeStatus(ctx context.Context, disputeID string, status string, adminID string, resolution string) (FinancialDispute, error) {
	return FinancialDispute{ID: disputeID, Status: status}, nil
}

func (f *fakeRecoveryRepo) CreateFinancialIncident(ctx context.Context, incident FinancialIncident) (FinancialIncident, error) {
	return incident, nil
}

func (f *fakeRecoveryRepo) ImportProviderStatement(ctx context.Context, req ProviderStatementImportRequest) (ProviderStatementImport, error) {
	f.imports++
	return ProviderStatementImport{ID: "statement-1", Provider: req.Provider, StatementReference: req.StatementReference}, nil
}

func (f *fakeRecoveryRepo) RunProviderStatementReconciliation(ctx context.Context, importID string, provider string) (ReconciliationRun, error) {
	return ReconciliationRun{ID: "run-1", Provider: provider}, nil
}

func TestRecoveryServiceCreatesRefundIntent(t *testing.T) {
	repo := &fakeRecoveryRepo{}
	service := NewRecoveryService(repo)
	refund, err := service.CreateRefundIntent(context.Background(), RefundIntent{Provider: ProviderOneMoney, AmountMinor: 1000, Currency: CurrencyUSD, Reason: "duplicate", IdempotencyKey: "refund-key-1"})
	if err != nil {
		t.Fatal(err)
	}
	if refund.ID != "refund-1" || repo.refunds != 1 {
		t.Fatalf("expected delegated refund creation, got %#v repo=%#v", refund, repo)
	}
}

func TestRecoveryServiceRejectsInvalidStatementLine(t *testing.T) {
	repo := &fakeRecoveryRepo{}
	service := NewRecoveryService(repo)
	_, err := service.ImportProviderStatement(context.Background(), ProviderStatementImportRequest{
		Provider:           ProviderOneMoney,
		StatementReference: "stmt-1",
		Lines:              []ProviderStatementLine{{LineReference: "", AmountMinor: 1000, Currency: CurrencyUSD}},
	})
	if err == nil {
		t.Fatal("expected invalid provider statement line to be rejected")
	}
	if repo.imports != 0 {
		t.Fatal("invalid statement should not reach repository")
	}
}
