# V2 Deposit and Withdrawal Admin Flow Report

## Summary

GO V2.1-D Deposit and Withdrawal Admin Flow was implemented as a controlled manual/admin wallet operations layer.

Preserved:

```text
Go Core V1 ride lifecycle
Frontend F1 contracts
public.rides
public.ride_offers
canonical websocket events
ride completion behavior
shadow settlement behavior
production dispatch behavior
```

Not implemented:

```text
EcoCash live integration
Innbucks live integration
Visa/Mastercard live integration
PayPal live integration
automatic provider callbacks
active ride wallet settlement
wallet payment enforcement
frontend wallet UI
```

This phase supports manual deposit and withdrawal request workflows with admin approval/rejection, ledger posting after approval, and audit visibility.

## Files Changed

```text
cmd/server/main.go
internal/wallet/types.go
internal/wallet/validation.go
internal/wallet/repository.go
internal/wallet/reporting.go
internal/wallet/admin_flow.go
internal/wallet/admin_http.go
internal/wallet/admin_flow_test.go
internal/wallet/admin_http_test.go
internal/wallet/admin_schema_test.go
WALLET_ADMIN_FLOW_SCHEMA.sql
V2_DEPOSIT_WITHDRAWAL_ADMIN_FLOW_REPORT.md
```

Existing V2.1-B/C wallet foundation files remain in use:

```text
WALLET_LEDGER_SCHEMA.sql
internal/wallet/settlement.go
internal/wallet/settlement_test.go
internal/wallet/reporting_test.go
internal/wallet/repository_test.go
internal/wallet/schema_test.go
internal/wallet/validation_test.go
```

## Schema Additions

Created additive SQL file:

```text
WALLET_ADMIN_FLOW_SCHEMA.sql
```

Adds support for manual methods:

```text
manual_ecocash
manual_innbucks
manual_bank
manual_cash
manual_card
manual_paypal
```

Extends `public.payment_intents` for manual deposit approval:

```text
pending_admin_approval status
wallet_account_type
approved_by
approved_at
rejected_by
rejected_at
rejection_reason
wallet_transaction_id
```

Extends `public.withdrawal_requests` provider validation for manual withdrawal methods.

Creates admin audit table:

```text
public.wallet_admin_actions
```

Fields:

```text
admin_user_id
action
target_type
target_id
reason
previous_status
new_status
metadata
created_at
```

No changes were made to:

```text
public.rides
public.ride_offers
canonical websocket events
```

## Endpoints Added

User endpoints:

```text
POST /api/wallets/deposits
GET  /api/wallets/deposits/:id
GET  /api/wallets/me
GET  /api/wallets/me/transactions
```

Driver endpoints:

```text
POST /api/wallets/withdrawals
GET  /api/wallets/withdrawals/:id
```

Admin endpoints:

```text
GET  /admin/wallets/deposits/pending
POST /admin/wallets/deposits/:id/approve
POST /admin/wallets/deposits/:id/reject
GET  /admin/wallets/withdrawals/pending
POST /admin/wallets/withdrawals/:id/approve
POST /admin/wallets/withdrawals/:id/reject
GET  /admin/wallets/admin-actions
GET  /admin/wallets/reconciliation/summary
```

All endpoints return JSON only.

Admin mutation endpoints require:

```text
auth role = admin or service_role
```

## Deposit Flow

User creates a deposit request:

```text
POST /api/wallets/deposits
```

Required:

```text
amount
currency
method
idempotency_key
```

Supported method values:

```text
manual_ecocash
manual_innbucks
manual_bank
manual_cash
manual_card
manual_paypal
```

Initial status:

```text
pending_admin_approval
```

### Deposit Approval

Admin approval:

```text
POST /admin/wallets/deposits/:id/approve
```

Ledger posting:

```text
Debit: provider_clearing_wallet
Credit: rider_wallet or driver_wallet
```

Transaction:

```text
transaction_type = deposit
status = posted
idempotency_key = deposit-approval:{payment_intent_id}
```

Admin action:

```text
action = approve_deposit
target_type = payment_intent
previous_status = pending_admin_approval
new_status = approved
```

### Deposit Rejection

Admin rejection:

```text
POST /admin/wallets/deposits/:id/reject
```

No ledger entries are posted.

Admin action:

```text
action = reject_deposit
new_status = rejected
reason = provided rejection reason
```

Duplicate approval or rejection is blocked by status transition validation.

## Withdrawal Flow

Driver creates a withdrawal request:

```text
POST /api/wallets/withdrawals
```

Required:

```text
amount
currency
method
destination_reference
idempotency_key
```

Initial status:

```text
pending_approval
```

Balance enforcement is advisory/shadow in this phase. Active negative-balance enforcement remains deferred until active wallet settlement.

### Withdrawal Approval

Admin approval:

```text
POST /admin/wallets/withdrawals/:id/approve
```

Ledger posting:

```text
Debit: driver_wallet
Credit: provider_clearing_wallet
```

Transaction:

```text
transaction_type = withdrawal
status = posted
idempotency_key = withdrawal-approval:{withdrawal_request_id}
```

Admin action:

```text
action = approve_withdrawal
target_type = withdrawal_request
previous_status = pending_approval
new_status = approved
```

### Withdrawal Rejection

Admin rejection:

```text
POST /admin/wallets/withdrawals/:id/reject
```

No ledger entries are posted.

Admin action:

```text
action = reject_withdrawal
new_status = rejected
reason = provided rejection reason
```

Duplicate approval or rejection is blocked by status transition validation.

## Admin Audit Model

Every admin approval/rejection records:

```text
admin_user_id
action
target_type
target_id
reason
previous_status
new_status
created_at
metadata
```

Audit records are append-only operational evidence. They do not replace immutable ledger entries.

## Security Protections

Implemented protections:

```text
missing idempotency keys rejected
invalid amount rejected
invalid currency rejected
invalid manual method rejected
non-admin approval rejected
duplicate approval blocked
duplicate rejection blocked
admin action audit recorded
ledger entries validated as balanced
wallet endpoints return safe JSON errors
user wallet state scoped to authenticated user
withdrawal detail scoped to authenticated driver
```

Not yet active by design:

```text
provider signature verification
automatic provider callback processing
hard available-balance enforcement
provider payout processing
```

## Tests Added

Added:

```text
internal/wallet/admin_flow_test.go
internal/wallet/admin_http_test.go
internal/wallet/admin_schema_test.go
```

Covered:

```text
deposit request creation
deposit approval posts balanced ledger
deposit rejection posts no ledger
duplicate deposit approval blocked
withdrawal request creation
withdrawal approval posts balanced ledger
withdrawal rejection posts no ledger
duplicate withdrawal approval blocked
non-admin approval rejected
admin approval allowed for admin role
admin action audit recorded
wallet balance endpoint returns safe JSON
transaction history endpoint returns safe JSON
admin schema adds audit table and manual methods
admin schema does not modify public.rides or public.ride_offers
```

Existing tests continue to cover:

```text
ledger validation
balanced transaction validation
shadow settlement
ride lifecycle preservation
websocket contract preservation
```

## Build Results

Executed with normal Windows Go build-cache access:

```text
go test ./...          PASS
go build ./cmd/server PASS
```

## Runtime Validation Plan

### 1. Apply Schemas In Staging

Apply in order:

```text
WALLET_LEDGER_SCHEMA.sql
WALLET_ADMIN_FLOW_SCHEMA.sql
```

Verify:

```text
payment_intents accepts pending_admin_approval
payment_intents accepts manual_* methods
withdrawal_requests accepts manual_* methods
wallet_admin_actions exists
public.rides unchanged
public.ride_offers unchanged
```

### 2. Deposit Request Probe

Call:

```text
POST /api/wallets/deposits
```

Verify:

```text
payment_intents row created
status = pending_admin_approval
no ledger entries yet
```

### 3. Deposit Approval Probe

Call:

```text
POST /admin/wallets/deposits/:id/approve
```

Verify:

```text
payment_intents.status = approved
wallet_transactions transaction_type = deposit
wallet_ledger_entries contains balanced debit/credit
wallet_admin_actions records approve_deposit
duplicate approval returns safe conflict
```

### 4. Deposit Rejection Probe

Create another deposit and reject it.

Verify:

```text
payment_intents.status = rejected
rejection_reason stored
no wallet_transactions row created for the rejection
wallet_admin_actions records reject_deposit
```

### 5. Withdrawal Probe

Call:

```text
POST /api/wallets/withdrawals
```

Verify:

```text
withdrawal_requests row created
status = pending_approval
driver wallet account exists
```

Approve and reject separate withdrawals.

Verify:

```text
approved withdrawal posts balanced debit/credit ledger
rejected withdrawal posts no ledger
wallet_admin_actions records each decision
duplicate approval/rejection is blocked
```

### 6. Security Probe

Verify:

```text
non-admin cannot approve deposit
non-admin cannot approve withdrawal
user cannot read another user's deposit detail
driver cannot read another driver's withdrawal detail
admin reporting endpoints require admin role
```

## Operational Risks

### No provider verification yet

Manual methods are admin-controlled placeholders. Provider callbacks and signature verification are intentionally deferred to V2.1-F.

### Balance enforcement advisory only

Withdrawal approval posts ledger entries, but hard available-balance enforcement is not active yet. This must be enforced before public withdrawals are allowed at scale.

### Admin role source

Admin endpoint authorization depends on trusted auth role context. Production should ensure admin role is issued from trusted Supabase app metadata or backend-controlled claims.

### Transaction atomicity

Ledger validation occurs before posting. Future production hardening should wrap approval status update, ledger posting, and admin audit in a single database transaction.

### Manual operations risk

Manual deposit approval can create real wallet credit records. Operations must use strict admin process, proof review, and reconciliation before real funds are credited.

## Readiness For Provider Integration Phase

```text
READY FOR V2.1-E ACTIVE WALLET SETTLEMENT DESIGN
READY FOR V2.1-F PROVIDER INTEGRATION DESIGN
NOT READY FOR AUTOMATIC PROVIDER CALLBACKS
```

Required before provider integration:

```text
1. Validate admin role enforcement in staging.
2. Validate duplicate approval/rejection behavior against the real database.
3. Add transaction wrapping for approval + ledger + audit.
4. Define provider signature verification per provider.
5. Add reconciliation reports for manual deposits and withdrawals.
```

## Final Classification

```text
GO V2.1-D Deposit and Withdrawal Admin Flow: IMPLEMENTED
Provider integrations: NOT ACTIVATED
Active ride wallet settlement: NOT ACTIVATED
Wallet payment enforcement: NOT ACTIVATED
Production ride flow: PRESERVED
Frontend contracts: PRESERVED
Websocket contracts: PRESERVED
```
