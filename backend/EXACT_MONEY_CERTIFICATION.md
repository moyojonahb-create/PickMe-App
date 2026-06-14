# Exact Money Certification

Audit date: 2026-06-12

## Certification Result

Exact Money Migration is **COMPLETE** for live Go financial paths.

All monetary `float64` fields and monetary `float64` parameters identified by the authoritative Phase 4 audit have been removed from wallet balances, deposits, withdrawals, ride payments, platform fees, settlements, refunds, chargebacks, disputes, reconciliation, provider callbacks, and public wallet pilot enforcement.

Money is represented internally as signed 64-bit minor units:

- `10.55 USD = 1055`
- `0.01 USD = 1`
- `25.75 ZWG = 2575`

Sub-cent precision is rejected at the boundary. No internal financial calculations use `float64`.

## Removed Monetary `float64` Fields

### `internal/rides/types.go`

- `RideRequest.EstimatedFare`
- `SubmitOfferRequest.Amount`
- `SubmitOfferRequest.Price`
- `SubmitOfferRequest.OfferedFare`
- `SubmitOfferRequest.EstimatedFare`
- `OfferResponse.Amount`
- `OfferResponse.Fare`
- `OfferResponse.OfferedFare`
- `RideOfferBroadcast.EstimatedFare`
- `RideRecord.EstimatedFare`

### `internal/payments/provider.go`

- `DepositIntentRequest.Amount`
- `DepositIntent.Amount`
- `ProviderCallback.Amount`
- `VerifiedCallback.Amount`
- `WithdrawalRequest.Amount`

### `internal/payments/card.go`

- `CardPaymentIntentRequest.Amount`
- `CardPaymentIntent.Amount`
- `CardAuthorizationRequest.Amount`
- `CardAuthorization.Amount`
- `CardCaptureRequest.Amount`
- `CardCapture.Amount`
- `CardRefundRequest.Amount`
- `CardRefund.Amount`

### `internal/payments/http.go`

Anonymous deposit request body `Amount float64` fields were removed from:

- `createOneMoneyDepositHandler`
- `createEcoCashDepositHandler`
- `createInnbucksDepositHandler`
- `createPayPalDepositHandler`
- `createCardDepositHandler`

### `internal/wallet/admin_http.go`

Anonymous wallet operation request body `Amount float64` fields were removed from:

- `authorizeRideHandler`
- `captureRideHandler`
- `createDepositHandler`
- `createWithdrawalHandler`

### `internal/wallet/types.go`

- `PaymentIntent.Amount`
- `ProviderDepositCallback.Amount`
- `WithdrawalRequest.Amount`
- `WalletAuthorization.Amount`
- `WalletAuthorization.CapturedAmount`
- `WalletAuthorization.ReleasedAmount`
- `AuthorizationRequest.Amount`
- `CaptureRequest.Amount`
- `SettlementRecord.Fare`
- `SettlementRecord.PlatformFee`
- `SettlementRecord.DriverEarning`
- `CompletedRide.Fare`
- `SettlementCalculation.Fare`
- `SettlementCalculation.PlatformFee`
- `SettlementCalculation.DriverEarning`
- `DepositRequest.Amount`
- `WithdrawalCreateRequest.Amount`
- `ProviderStatementLine.Amount`
- `RefundIntent.Amount`
- `ChargebackRecord.Amount`
- `FinancialDispute.Amount`

### `internal/wallet/public_wallet_pilot_enforcement.go`

- `PublicWalletPilotEnforcementRequest.Amount`

## Removed Monetary `float64` Parameters

- `internal/wallet/active_settlement.go`: `totalAmount float64`
- `internal/wallet/active_settlement.go`: `amount float64`
- `internal/wallet/settlement.go`: `fare float64`
- `internal/wallet/settlement.go`: `totalAmount float64`
- `internal/wallet/settlement.go`: `amount float64`
- `internal/wallet/repository.go`: authorization release `amount float64`
- `internal/wallet/repository.go`: authorization event `amount float64`
- `internal/wallet/repository.go`: settlement ledger entry `amount float64`
- `internal/payments/card.go`: card event hash `amount float64`

## Minor-Unit Strategy

Go remains the single source of truth for financial behavior. Supabase remains storage only.

- Internal financial structs use `int64` minor-unit fields such as `AmountMinor`, `FareMinor`, `PlatformFeeMinor`, `DriverEarningMinor`, `CapturedAmountMinor`, and `ReleasedAmountMinor`.
- Boundary compatibility accepts legacy decimal JSON fields such as `"amount": 10.55`, parses them exactly, and immediately converts them to minor units.
- Invalid monetary values are rejected before entering financial services, including negative values and precision below the minor unit such as `0.001`.
- Platform fee calculation uses deterministic integer basis-point math: PickMe fee = `15% = 1500 bps`.
- Legacy SQL decimal columns are populated from minor units using exact decimal string formatting. Go minor-unit values remain authoritative.

## Verification

Commands run:

```powershell
go test ./...
go build ./cmd/server
rg -n "\bfloat64\b" -S -g "*.go" .
rg -n "\b[A-Za-z0-9_]*(Amount|Balance|Fare|Fee|Earning|Price|Refund|Settlement|Payment|Deposit|Withdrawal|Captured|Released)[A-Za-z0-9_]*\s+float64\b|\b[A-Za-z0-9_]*(Amount|Balance|Fare|Fee|Earning|Price|Refund|Settlement|Payment|Deposit|Withdrawal|Captured|Released)[A-Za-z0-9_]*\s*float64\b" -S -g "*.go" .
rg -n "\b(amount|balance|fare|fee|earning|price|refund|settlement|payment|deposit|withdrawal|captured|released)[a-z0-9_]*\s+(double precision|real|float8|float4|float)\b" -i -S -g "*.sql" .
```

Results:

- `go test ./...`: **PASS**
- `go build ./cmd/server`: **PASS**
- Monetary `float64` field/parameter audit: **PASS, no results**
- Monetary SQL floating-point column audit: **PASS, no results**

The broad `float64` scan still reports non-financial values only, including GPS coordinates, dispatch scoring, latency/radius metrics, reputation rates, configuration parsing, and test scan helper code.

## Remaining Financial Risks

- Some database tables still retain legacy exact decimal monetary columns alongside minor-unit fields. Go now writes those decimal columns from minor units; a later storage cleanup can deprecate them.
- External clients should migrate to `*_minor` API fields. Legacy decimal input is accepted only at Go-controlled boundaries for backward compatibility.
- Future multi-currency expansion should keep currency plumbing explicit anywhere minor units are formatted for legacy event metadata.

## Final Determination

Phase 4 Exact Money Migration is **fully certified** for the live Go financial paths covered by this audit.
