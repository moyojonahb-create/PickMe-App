package main

import (
	"strings"
	"testing"

	"pickme-backend/internal/config"
)

func TestCardProcessorDisabledByDefault(t *testing.T) {
	processor, err := cardProcessorForConfig(config.Config{AppEnv: "production"})
	if err != nil {
		t.Fatal(err)
	}
	if processor != nil {
		t.Fatal("expected no card processor when card payments are disabled")
	}
}

func TestMockCardProcessorRejectedOutsideDevelopment(t *testing.T) {
	processor, err := cardProcessorForConfig(config.Config{
		AppEnv: "production",
		Payments: config.PaymentsConfig{
			CardPaymentsEnabled: true,
		},
	})
	if err == nil {
		t.Fatal("expected production mock card processor validation error")
	}
	if processor != nil {
		t.Fatal("mock card processor must not be returned in production")
	}
}

func TestMockCardProcessorAllowedInExplicitDevelopmentMode(t *testing.T) {
	processor, err := cardProcessorForConfig(config.Config{
		AppEnv: "development",
		Payments: config.PaymentsConfig{
			CardPaymentsEnabled: true,
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if processor == nil {
		t.Fatal("expected mock card processor in explicit development mode")
	}
}

func TestProviderStatusVerifierRequiredInProduction(t *testing.T) {
	verifier, err := providerStatusVerifierForConfig(config.Config{
		AppEnv: "production",
		Payments: config.PaymentsConfig{
			OneMoneyEnabled: true,
		},
	}, "onemoney")
	if err == nil {
		t.Fatal("expected missing production provider status endpoint to fail")
	}
	if verifier != nil {
		t.Fatal("expected no verifier when production provider status config is invalid")
	}
}

func TestProviderStatusVerifierAllowsDevelopmentFallback(t *testing.T) {
	verifier, err := providerStatusVerifierForConfig(config.Config{
		AppEnv: "development",
		Payments: config.PaymentsConfig{
			OneMoneyEnabled: true,
		},
	}, "onemoney")
	if err != nil {
		t.Fatal(err)
	}
	if verifier == nil {
		t.Fatal("expected development fallback verifier")
	}
}

func TestSingleInstanceWarningMessageEmptyForSingleInstance(t *testing.T) {
	for _, count := range []int{0, 1} {
		msg := singleInstanceWarningMessage(config.Config{
			Deployment: config.DeploymentConfig{InstanceCount: count},
		})
		if msg != "" {
			t.Fatalf("expected no warning for instance count %d, got %q", count, msg)
		}
	}
}

func TestSingleInstanceWarningMessageNonEmptyForMultipleInstances(t *testing.T) {
	msg := singleInstanceWarningMessage(config.Config{
		Deployment: config.DeploymentConfig{InstanceCount: 3},
	})
	if msg == "" {
		t.Fatal("expected a warning for multi-instance config")
	}
	if !strings.Contains(msg, "DEPLOYMENT_SINGLE_INSTANCE_CONSTRAINT_VIOLATION") {
		t.Fatalf("expected structured event name in warning, got %q", msg)
	}
	if !strings.Contains(msg, "instance_count=3") {
		t.Fatalf("expected instance_count=3 in warning, got %q", msg)
	}
}
