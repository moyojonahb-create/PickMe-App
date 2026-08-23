package auth

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"net/http"
	"strings"
	"sync"
	"time"

	"pickme-backend/internal/config"
)

// Supabase projects created (or migrated) after the asymmetric signing-key
// rollout issue user access tokens signed ES256 via a rotating key set, not
// the legacy shared HS256 secret. This verifier supports both: HS256 against
// the configured secret (for projects still on legacy signing), and ES256
// against Supabase's own JWKS endpoint (for everyone else). Relying on only
// one meant every token signed the other way was rejected before signature
// verification even ran — see the "unsupported JWT alg" error this used to
// return unconditionally for ES256 tokens.
type SupabaseJWT struct {
	secret     []byte
	audience   string
	issuer     string
	jwksURL    string
	httpClient *http.Client

	mu        sync.RWMutex
	keys      map[string]*ecdsa.PublicKey
	fetchedAt time.Time
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

// How long a fetched key set is trusted before a fresh fetch is preferred.
// A token whose `kid` isn't in the cache always triggers an immediate
// refetch regardless of this TTL, so key rotation is picked up promptly;
// this just bounds how often a cache hit re-fetches for no reason.
const jwksCacheTTL = 1 * time.Hour

func NewSupabaseJWT(cfg config.AuthConfig) (*SupabaseJWT, error) {
	jwksURL := ""
	if cfg.Issuer != "" {
		jwksURL = strings.TrimSuffix(cfg.Issuer, "/") + "/.well-known/jwks.json"
	} else if cfg.SupabaseURL != "" {
		jwksURL = strings.TrimSuffix(cfg.SupabaseURL, "/") + "/auth/v1/.well-known/jwks.json"
	}
	if cfg.SupabaseJWTSecret == "" && jwksURL == "" {
		return nil, errors.New("either SUPABASE_JWT_SECRET (HS256) or SUPABASE_URL/SUPABASE_JWT_ISSUER (for JWKS/ES256) is required to validate Supabase JWTs")
	}

	return &SupabaseJWT{
		secret:     []byte(cfg.SupabaseJWTSecret),
		audience:   cfg.Audience,
		issuer:     cfg.Issuer,
		jwksURL:    jwksURL,
		httpClient: &http.Client{Timeout: 5 * time.Second},
		keys:       map[string]*ecdsa.PublicKey{},
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
		Kid string `json:"kid"`
	}
	if err := decodeSegment(parts[0], &header); err != nil {
		return Claims{}, fmt.Errorf("invalid JWT header: %w", err)
	}

	signingInput := []byte(parts[0] + "." + parts[1])
	signature, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil {
		return Claims{}, errors.New("invalid JWT signature encoding")
	}

	switch header.Alg {
	case "HS256":
		if len(s.secret) == 0 {
			return Claims{}, errors.New("received an HS256 token but no SUPABASE_JWT_SECRET is configured")
		}
		mac := hmac.New(sha256.New, s.secret)
		mac.Write(signingInput)
		if !hmac.Equal(signature, mac.Sum(nil)) {
			return Claims{}, errors.New("invalid JWT signature")
		}
	case "ES256":
		pub, err := s.publicKeyFor(header.Kid)
		if err != nil {
			return Claims{}, fmt.Errorf("resolving JWT signing key: %w", err)
		}
		if !verifyES256(pub, signingInput, signature) {
			return Claims{}, errors.New("invalid JWT signature")
		}
	default:
		return Claims{}, fmt.Errorf("unsupported JWT alg: %s", header.Alg)
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

// publicKeyFor resolves an ES256 verification key by `kid`, refreshing the
// cached key set on a miss (covers both a cold cache and Supabase rotating
// keys) before giving up.
func (s *SupabaseJWT) publicKeyFor(kid string) (*ecdsa.PublicKey, error) {
	s.mu.RLock()
	key, ok := s.keys[kid]
	fresh := time.Since(s.fetchedAt) < jwksCacheTTL
	s.mu.RUnlock()
	if ok && fresh {
		return key, nil
	}

	refreshErr := s.refreshKeys()

	s.mu.RLock()
	key, ok = s.keys[kid]
	s.mu.RUnlock()
	if ok {
		return key, nil
	}
	if refreshErr != nil {
		return nil, refreshErr
	}
	return nil, fmt.Errorf("no signing key found for kid %q", kid)
}

func (s *SupabaseJWT) refreshKeys() error {
	if s.jwksURL == "" {
		return errors.New("no JWKS URL configured (set SUPABASE_URL or SUPABASE_JWT_ISSUER)")
	}
	resp, err := s.httpClient.Get(s.jwksURL)
	if err != nil {
		return fmt.Errorf("fetching JWKS: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("JWKS endpoint returned status %d", resp.StatusCode)
	}

	var body struct {
		Keys []struct {
			Kty string `json:"kty"`
			Crv string `json:"crv"`
			X   string `json:"x"`
			Y   string `json:"y"`
			Kid string `json:"kid"`
		} `json:"keys"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return fmt.Errorf("decoding JWKS response: %w", err)
	}

	keys := make(map[string]*ecdsa.PublicKey, len(body.Keys))
	for _, k := range body.Keys {
		if k.Kty != "EC" || k.Crv != "P-256" || k.Kid == "" {
			continue
		}
		xBytes, err := base64.RawURLEncoding.DecodeString(k.X)
		if err != nil {
			continue
		}
		yBytes, err := base64.RawURLEncoding.DecodeString(k.Y)
		if err != nil {
			continue
		}
		keys[k.Kid] = &ecdsa.PublicKey{
			Curve: elliptic.P256(),
			X:     new(big.Int).SetBytes(xBytes),
			Y:     new(big.Int).SetBytes(yBytes),
		}
	}
	if len(keys) == 0 {
		return errors.New("JWKS response contained no usable P-256 EC keys")
	}

	s.mu.Lock()
	s.keys = keys
	s.fetchedAt = time.Now()
	s.mu.Unlock()
	return nil
}

// verifyES256 checks a JWS ES256 signature, which is the raw 32-byte-r ||
// 32-byte-s encoding (not ASN.1 DER, unlike most other ECDSA signature
// formats) over the SHA-256 hash of the signing input.
func verifyES256(pub *ecdsa.PublicKey, signingInput, signature []byte) bool {
	if len(signature) != 64 {
		return false
	}
	r := new(big.Int).SetBytes(signature[:32])
	sVal := new(big.Int).SetBytes(signature[32:])
	hash := sha256.Sum256(signingInput)
	return ecdsa.Verify(pub, hash[:], r, sVal)
}

func decodeSegment[T any](segment string, target *T) error {
	raw, err := base64.RawURLEncoding.DecodeString(segment)
	if err != nil {
		return err
	}
	return json.Unmarshal(raw, target)
}
