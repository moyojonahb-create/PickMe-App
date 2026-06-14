package auth

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"pickme-backend/internal/config"
)

type SupabaseJWT struct {
	secret   []byte
	audience string
	issuer   string
}

type Claims struct {
	Subject   string `json:"sub"`
	Role      string `json:"role"`
	Email     string `json:"email"`
	Issuer    string `json:"iss"`
	Audience  string `json:"aud"`
	Expires   int64  `json:"exp"`
	NotBefore int64  `json:"nbf"`
	IssuedAt  int64  `json:"iat"`
}

func NewSupabaseJWT(cfg config.AuthConfig) (*SupabaseJWT, error) {
	if cfg.SupabaseJWTSecret == "" {
		return nil, errors.New("SUPABASE_JWT_SECRET is required to validate Supabase JWTs")
	}

	return &SupabaseJWT{
		secret:   []byte(cfg.SupabaseJWTSecret),
		audience: cfg.Audience,
		issuer:   cfg.Issuer,
	}, nil
}

func (s *SupabaseJWT) Validate(token string) (Claims, error) {
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return Claims{}, errors.New("invalid JWT format")
	}

	var header struct {
		Alg string `json:"alg"`
		Typ string `json:"typ"`
	}
	if err := decodeSegment(parts[0], &header); err != nil {
		return Claims{}, fmt.Errorf("invalid JWT header: %w", err)
	}
	if header.Alg != "HS256" {
		return Claims{}, fmt.Errorf("unsupported JWT alg: %s", header.Alg)
	}

	signingInput := parts[0] + "." + parts[1]
	expected := hmac.New(sha256.New, s.secret)
	_, _ = expected.Write([]byte(signingInput))
	expectedSignature := expected.Sum(nil)

	signature, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil {
		return Claims{}, errors.New("invalid JWT signature encoding")
	}
	if !hmac.Equal(signature, expectedSignature) {
		return Claims{}, errors.New("invalid JWT signature")
	}

	var claims Claims
	if err := decodeSegment(parts[1], &claims); err != nil {
		return Claims{}, fmt.Errorf("invalid JWT claims: %w", err)
	}

	now := time.Now().Unix()
	if claims.Expires > 0 && now >= claims.Expires {
		return Claims{}, errors.New("JWT has expired")
	}
	if claims.NotBefore > 0 && now < claims.NotBefore {
		return Claims{}, errors.New("JWT is not valid yet")
	}
	if s.audience != "" && claims.Audience != s.audience {
		return Claims{}, errors.New("JWT audience is invalid")
	}
	if s.issuer != "" && claims.Issuer != s.issuer {
		return Claims{}, errors.New("JWT issuer is invalid")
	}
	if claims.Subject == "" {
		return Claims{}, errors.New("JWT subject is required")
	}

	return claims, nil
}

func decodeSegment[T any](segment string, target *T) error {
	raw, err := base64.RawURLEncoding.DecodeString(segment)
	if err != nil {
		return err
	}
	return json.Unmarshal(raw, target)
}
