package config

import "testing"

const testProductionDatabaseURL = "postgres://localhost/test?sslmode=require"

func TestLoadRequiresCORSAllowOriginsInProduction(t *testing.T) {
	t.Setenv("DATABASE_URL", testProductionDatabaseURL)
	t.Setenv("SUPABASE_JWT_SECRET", "secret")
	t.Setenv("APP_ENV", "production")
	t.Setenv("CORS_ALLOW_ORIGINS", "")

	if _, err := Load(); err == nil {
		t.Fatal("expected error when CORS_ALLOW_ORIGINS is missing in production")
	}
}

func TestLoadRejectsMissingCORSAllowOriginsInStaging(t *testing.T) {
	t.Setenv("DATABASE_URL", testProductionDatabaseURL)
	t.Setenv("SUPABASE_JWT_SECRET", "secret")
	t.Setenv("APP_ENV", "staging")
	t.Setenv("CORS_ALLOW_ORIGINS", "")

	if _, err := Load(); err == nil {
		t.Fatal("expected error when CORS_ALLOW_ORIGINS is missing outside explicit development mode")
	}
}

func TestLoadAllowsMissingCORSAllowOriginsInDevelopment(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://localhost/test")
	t.Setenv("SUPABASE_JWT_SECRET", "secret")
	t.Setenv("APP_ENV", "development")
	t.Setenv("CORS_ALLOW_ORIGINS", "")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("expected development fallback to succeed, got error: %v", err)
	}
	if cfg.CORS.AllowOrigins == "" {
		t.Fatal("expected a non-empty development CORS fallback")
	}
}

func TestLoadDoesNotFallBackToLegacyProductionDomains(t *testing.T) {
	t.Setenv("DATABASE_URL", testProductionDatabaseURL)
	t.Setenv("SUPABASE_JWT_SECRET", "secret")
	t.Setenv("APP_ENV", "production")
	t.Setenv("CORS_ALLOW_ORIGINS", "https://real-frontend.example.com")
	t.Setenv("SUPABASE_URL", "https://project.supabase.co")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.CORS.AllowOrigins != "https://real-frontend.example.com" {
		t.Fatalf("expected configured origin to be used as-is, got %q", cfg.CORS.AllowOrigins)
	}
}

func TestLoadRequiresSupabaseURLOrIssuerInProduction(t *testing.T) {
	t.Setenv("DATABASE_URL", testProductionDatabaseURL)
	t.Setenv("SUPABASE_JWT_SECRET", "secret")
	t.Setenv("APP_ENV", "production")
	t.Setenv("CORS_ALLOW_ORIGINS", "https://real-frontend.example.com")
	t.Setenv("SUPABASE_URL", "")
	t.Setenv("SUPABASE_JWT_ISSUER", "")

	if _, err := Load(); err == nil {
		t.Fatal("expected error when both SUPABASE_URL and SUPABASE_JWT_ISSUER are missing in production")
	}
}

func TestLoadRequiresSupabaseURLOrIssuerInStaging(t *testing.T) {
	t.Setenv("DATABASE_URL", testProductionDatabaseURL)
	t.Setenv("SUPABASE_JWT_SECRET", "secret")
	t.Setenv("APP_ENV", "staging")
	t.Setenv("CORS_ALLOW_ORIGINS", "https://real-frontend.example.com")
	t.Setenv("SUPABASE_URL", "")
	t.Setenv("SUPABASE_JWT_ISSUER", "")

	if _, err := Load(); err == nil {
		t.Fatal("expected error when both SUPABASE_URL and SUPABASE_JWT_ISSUER are missing outside explicit development mode")
	}
}

func TestLoadAllowsSupabaseURLAloneInProductionAndDerivesIssuer(t *testing.T) {
	t.Setenv("DATABASE_URL", testProductionDatabaseURL)
	t.Setenv("SUPABASE_JWT_SECRET", "secret")
	t.Setenv("APP_ENV", "production")
	t.Setenv("CORS_ALLOW_ORIGINS", "https://real-frontend.example.com")
	t.Setenv("SUPABASE_URL", "https://project.supabase.co")
	t.Setenv("SUPABASE_JWT_ISSUER", "")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.Auth.Issuer != "https://project.supabase.co/auth/v1" {
		t.Fatalf("expected issuer derived from SUPABASE_URL, got %q", cfg.Auth.Issuer)
	}
}

func TestLoadAllowsExplicitIssuerAloneInProduction(t *testing.T) {
	t.Setenv("DATABASE_URL", testProductionDatabaseURL)
	t.Setenv("SUPABASE_JWT_SECRET", "secret")
	t.Setenv("APP_ENV", "production")
	t.Setenv("CORS_ALLOW_ORIGINS", "https://real-frontend.example.com")
	t.Setenv("SUPABASE_URL", "")
	t.Setenv("SUPABASE_JWT_ISSUER", "https://issuer.example.com/auth/v1")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.Auth.Issuer != "https://issuer.example.com/auth/v1" {
		t.Fatalf("expected explicit SUPABASE_JWT_ISSUER to be used as-is, got %q", cfg.Auth.Issuer)
	}
}

func TestLoadAllowsMissingSupabaseURLAndIssuerInDevelopment(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://localhost/test")
	t.Setenv("SUPABASE_JWT_SECRET", "secret")
	t.Setenv("APP_ENV", "development")
	t.Setenv("CORS_ALLOW_ORIGINS", "")
	t.Setenv("SUPABASE_URL", "")
	t.Setenv("SUPABASE_JWT_ISSUER", "")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("expected development fallback to succeed, got error: %v", err)
	}
	if cfg.Auth.Issuer != "" {
		t.Fatalf("expected empty issuer to remain allowed in development, got %q", cfg.Auth.Issuer)
	}
}

func TestLoadDefaultsBackendInstanceCountToOne(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://localhost/test")
	t.Setenv("SUPABASE_JWT_SECRET", "secret")
	t.Setenv("APP_ENV", "development")
	t.Setenv("CORS_ALLOW_ORIGINS", "")
	t.Setenv("BACKEND_INSTANCE_COUNT", "")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.Deployment.InstanceCount != 1 {
		t.Fatalf("expected default instance count of 1, got %d", cfg.Deployment.InstanceCount)
	}
}

func TestLoadHonorsExplicitBackendInstanceCount(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://localhost/test")
	t.Setenv("SUPABASE_JWT_SECRET", "secret")
	t.Setenv("APP_ENV", "development")
	t.Setenv("CORS_ALLOW_ORIGINS", "")
	t.Setenv("BACKEND_INSTANCE_COUNT", "3")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.Deployment.InstanceCount != 3 {
		t.Fatalf("expected instance count of 3, got %d", cfg.Deployment.InstanceCount)
	}
}

func TestLoadRequiresDatabaseSSLModeInProduction(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://localhost/test")
	t.Setenv("SUPABASE_JWT_SECRET", "secret")
	t.Setenv("APP_ENV", "production")
	t.Setenv("CORS_ALLOW_ORIGINS", "https://real-frontend.example.com")
	t.Setenv("SUPABASE_URL", "https://project.supabase.co")

	if _, err := Load(); err == nil {
		t.Fatal("expected error when DATABASE_URL has no enforced sslmode in production")
	}
}

func TestLoadRequiresDatabaseSSLModeInStaging(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://localhost/test")
	t.Setenv("SUPABASE_JWT_SECRET", "secret")
	t.Setenv("APP_ENV", "staging")
	t.Setenv("CORS_ALLOW_ORIGINS", "https://real-frontend.example.com")
	t.Setenv("SUPABASE_URL", "https://project.supabase.co")

	if _, err := Load(); err == nil {
		t.Fatal("expected error when DATABASE_URL has no enforced sslmode outside explicit development mode")
	}
}

func TestLoadRejectsWeakDatabaseSSLModeInProduction(t *testing.T) {
	t.Setenv("SUPABASE_JWT_SECRET", "secret")
	t.Setenv("APP_ENV", "production")
	t.Setenv("CORS_ALLOW_ORIGINS", "https://real-frontend.example.com")
	t.Setenv("SUPABASE_URL", "https://project.supabase.co")

	for _, weakMode := range []string{"disable", "allow", "prefer"} {
		t.Setenv("DATABASE_URL", "postgres://localhost/test?sslmode="+weakMode)
		if _, err := Load(); err == nil {
			t.Fatalf("expected error for weak sslmode=%s in production", weakMode)
		}
	}
}

func TestLoadAcceptsEnforcedDatabaseSSLModesInProduction(t *testing.T) {
	t.Setenv("SUPABASE_JWT_SECRET", "secret")
	t.Setenv("APP_ENV", "production")
	t.Setenv("CORS_ALLOW_ORIGINS", "https://real-frontend.example.com")
	t.Setenv("SUPABASE_URL", "https://project.supabase.co")

	for _, strongMode := range []string{"require", "verify-ca", "verify-full"} {
		t.Setenv("DATABASE_URL", "postgres://localhost/test?sslmode="+strongMode)
		if _, err := Load(); err != nil {
			t.Fatalf("expected sslmode=%s to be accepted in production, got error: %v", strongMode, err)
		}
	}
}

func TestLoadAllowsMissingDatabaseSSLModeInDevelopment(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://localhost/test")
	t.Setenv("SUPABASE_JWT_SECRET", "secret")
	t.Setenv("APP_ENV", "development")
	t.Setenv("CORS_ALLOW_ORIGINS", "")

	if _, err := Load(); err != nil {
		t.Fatalf("expected development mode to allow a DATABASE_URL without sslmode, got error: %v", err)
	}
}

func TestHasRequiredDatabaseSSLModeIsCaseInsensitiveAndKeywordFormat(t *testing.T) {
	cases := []struct {
		url  string
		want bool
	}{
		{"postgres://localhost/test?sslmode=require", true},
		{"postgres://localhost/test?sslmode=REQUIRE", true},
		{"host=localhost sslmode=verify-full dbname=test", true},
		{"postgres://localhost/test?sslmode=verify-ca", true},
		{"postgres://localhost/test?sslmode=prefer", false},
		{"postgres://localhost/test", false},
		{"", false},
	}
	for _, tc := range cases {
		if got := hasRequiredDatabaseSSLMode(tc.url); got != tc.want {
			t.Errorf("hasRequiredDatabaseSSLMode(%q) = %v, want %v", tc.url, got, tc.want)
		}
	}
}
