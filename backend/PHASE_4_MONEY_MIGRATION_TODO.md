# Phase 4 — Exact Money Migration (TODO)

Goal: Remove float64 from all live wallet/payment financial paths and use integer minor units (money.Money{AmountMinor int64}) internally. Maintain decimal parsing/formatting at API boundaries only.

Checklist

- [x] Read existing money package (internal/money/money.go)
- [x] Inventory float64 usages across repo (initial search)
- [x] Read internal/wallet/types.go to identify fields to convert
- [ ] Design migration strategy and money type mapping
- [ ] Replace float64 fields in live wallet types with Money/AmountMinor
- [ ] Replace float64 usage in internal/payments (http, provider, service, card)
- [ ] Replace float64 usage in internal/rides (fare, estimated_fare, settlement)
- [ ] Update wallet repository methods and ledger posting to use minor units
- [ ] Add validation helpers for decimal input at HTTP boundary (reject negative, too many decimals, invalid exponent, overflow)
- [ ] Replace NewMoneyFromFloat helpers with money.ParseAmount and enforce non-float internal logic
- [ ] Update platform fee calculation to deterministic integer math: 15% (bps = 1500)
- [ ] Update wallet authorization, capture, settlement, refund, and reconciliation math to use integer minor units
- [ ] Add unit tests:
  - [ ] decimal input converts correctly (10.55 -> 1055, 0.01 -> 1)
  - [ ] too many decimals rejected
  - [ ] negative amount rejected
  - [ ] 15% platform fee deterministic and exact
  - [ ] rider debit + driver credit + platform fee balance correctly
  - [ ] refund reversals balance correctly
  - [ ] repeated calculations do not drift
  - [ ] no float64 remains in live wallet/payment paths
- [ ] Run `go test ./...` and fix failures
- [ ] Run `go build ./cmd/server`
- [ ] Document API compatibility notes and migration plan for downstream callers
- [ ] Produce Phase 4 closure report

Migration notes

- Use internal/money.Money{AmountMinor int64, Currency string} as canonical money type.
- At HTTP handlers, accept decimal in JSON (number or string) and call money.ParseAmount(value, currency).
- For backward compatibility at API responses, include AmountMinor (int64) and formatted Amount string only where required.
- All ledger/settlement calculations must use Money.AmountMinor (int64) and integer math only.
- Platform fee calculation example:
  - feeMinor = (fareMinor * 1500 + 5000) / 10000  // round half-up
- Review DB schema: ensure columns store integer minor units or adjust mapping layer.

Risk notes

- Database schema may store floats/decimals; schema migration required and out-of-scope in this change set.
- External providers expect decimal amounts — convert at provider boundary and store provider reference amounts separately.
- Tests must verify ledger balancing and idempotency.

Next actions (incremental PR plan)

1. Replace float fields in wallet types with AmountMinor and retain Amount (formatted) only where API compatibility demanded.
2. Update wallet/money helpers and repository functions to accept Money/AmountMinor.
3. Update payments/provider and payments/http to parse and convert incoming decimals to Money before calling service layer.
4. Update rides handler to use money.Money for fare and settlement calculations.
5. Add tests and run full suite.