package wallet

import (
	"os"
	"strings"
	"testing"
)

func adminFlowSchema(t *testing.T) string {
	t.Helper()
	source, err := os.ReadFile("../../WALLET_ADMIN_FLOW_SCHEMA.sql")
	if err != nil {
		t.Fatal(err)
	}
	return string(source)
}

func TestAdminFlowSchemaAddsAuditAndManualStatuses(t *testing.T) {
	source := adminFlowSchema(t)
	required := []string{
		"CREATE TABLE IF NOT EXISTS public.wallet_admin_actions",
		"pending_admin_approval",
		"manual_ecocash",
		"manual_innbucks",
		"manual_bank",
		"manual_cash",
		"manual_card",
		"manual_paypal",
		"wallet_transaction_id uuid REFERENCES public.wallet_transactions(id)",
		"wallet_admin_actions_admin_select",
	}
	for _, pattern := range required {
		if !strings.Contains(source, pattern) {
			t.Fatalf("admin flow schema missing %s", pattern)
		}
	}
}

func TestAdminFlowSchemaDoesNotModifyRideTables(t *testing.T) {
	source := adminFlowSchema(t)
	banned := []string{
		"ALTER TABLE public.rides",
		"ALTER TABLE public.ride_offers",
		"DROP TABLE public.rides",
		"DROP TABLE public.ride_offers",
	}
	for _, pattern := range banned {
		if strings.Contains(source, pattern) {
			t.Fatalf("admin flow schema must not modify ride tables: %s", pattern)
		}
	}
}
