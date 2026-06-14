# Frontend Backend Wallet Match Report

Date: 2026-06-14

Scope: Verify frontend ↔ Go wallet integration for active wallet, deposit, admin wallet, driver earnings, and settlement flows. Application source files were not modified.

## Executive Summary

Result: **FAIL**

The frontend wallet code is centralized around `src/lib/goBackendClient.ts`, `src/lib/walletApi.ts`, and `src/lib/walletPayments.ts`, and the active wallet flows now call Go-style REST endpoints. However, this repository still contains **no implemented Go backend routes**. A workspace scan found no `*.go`, `go.mod`, or `go.sum` files.

Also note: `src/lib/backendClient.ts` does not exist. The active backend adapter is `src/lib/goBackendClient.ts`.

Legacy Supabase RPCs and Edge Functions exist, but they do not match the requested Go endpoint contract.

## Feature Match Table

| Feature | Frontend Endpoint | Backend Route | Status |
|---|---|---|---|
| Wallet balance | `GET /api/wallets/me`, fallback `GET /api/wallet/me` | No Go route found | Missing |
| Wallet transactions | `GET /api/wallets/me/transactions?limit=...`, fallback `GET /api/wallet/transactions?limit=...` | No Go route found | Missing |
| Wallet deposits | `GET /api/wallets/deposits?...`, fallback `GET /api/wallet/deposits?...`; `POST /api/wallets/deposits`, fallback `POST /api/wallet/deposit` | No Go route found | Missing |
| Rider deposits | `GET /api/wallets/deposits?type=rider`; `GET /admin/wallets/deposits?type=rider`; `POST /admin/wallets/deposits/:id/approve`; `POST /admin/wallets/deposits/:id/reject` | No Go route found | Missing |
| Driver deposits | `POST /api/wallets/deposits` with `wallet_type: "driver"`; `GET /admin/wallets/deposits?type=driver`; `POST /admin/wallets/deposits/:id/approve`; `POST /admin/wallets/deposits/:id/reject` | No Go route found | Missing |
| Transfer funds | `POST /api/wallets/transfer`, fallback `POST /api/wallet/transfer` | No Go route found | Missing |
| Pay ride | `POST /api/wallets/pay`, fallback `POST /api/wallet/pay` | No Go route found | Missing |
| Withdrawal | `POST /api/wallets/withdrawals`, fallback `POST /api/wallet/withdraw`; admin uses `GET /admin/wallets/withdrawals`, approve/reject routes | No Go route found | Missing |
| Lookup user | `GET /api/wallets/lookup-user?...`, fallback `GET /api/wallet/lookup-user?...` | No Go route found | Missing |
| Driver summary | `GET /api/wallets/driver/summary`, fallback `GET /api/wallet/driver/summary` | No Go route found | Missing |
| Driver earnings | `GET /api/wallets/driver/earnings?period=...`, fallback `GET /api/wallet/driver/earnings?period=...` | No Go route found | Missing |
| Admin earnings | `GET /admin/finance/earnings?limit=...` | No Go route found | Missing |
| Admin wallet dashboard | `GET /admin/finance/wallet-dashboard` | No Go route found | Missing |
| Settlement read | `GET /api/rides/:tripId/settlement` | No Go route found | Missing |
| Settlement execute | `POST /api/rides/:tripId/settle` | No Go route found | Missing |

## Frontend Files Scanned

Core adapters:

- `src/lib/goBackendClient.ts`
- `src/lib/walletApi.ts`
- `src/lib/walletPayments.ts`
- `src/hooks/useWallet.ts`
- `src/hooks/useWalletPin.ts`

Wallet/deposit pages and components:

- `src/pages/RiderWalletPage.tsx`
- `src/pages/DriverWalletPage.tsx`
- `src/pages/DriverDepositPage.tsx`
- `src/components/wallet/DepositModal.tsx`
- `src/components/wallet/TransferMoneyModal.tsx`
- `src/components/wallet/WithdrawalModal.tsx`
- `src/components/ride/PayRideButton.tsx`
- `src/components/driver/DriverEarningsDashboard.tsx`

Admin finance/wallet pages:

- `src/pages/admin/AdminWalletDashboard.tsx`
- `src/pages/admin/AdminDepositsPage.tsx`
- `src/pages/admin/AdminRiderDepositsPage.tsx`
- `src/pages/admin/AdminWithdrawalsPage.tsx`
- `src/pages/admin/AdminLedger.tsx`
- `src/pages/admin/AdminReports.tsx`
- `src/pages/admin/AdminRatePage.tsx`
- `src/pages/admin/AdminSystemHealth.tsx`

## Endpoint Mismatches

### Missing Backend Implementation

Every wallet endpoint called by `src/lib/walletApi.ts` is missing as an implemented Go route in this repo. The frontend calls are internally consistent, but there is no checked-in Go server to receive them.

### Singular vs Plural Naming

The frontend uses plural routes first and singular routes as fallbacks for public wallet endpoints:

- Primary: `/api/wallets/...`
- Fallback: `/api/wallet/...`

The migration report listed singular `/api/wallet/*` endpoints as the intended Go contract, while `walletApi.ts` currently tries plural `/api/wallets/*` first. This is a naming mismatch risk. A backend that implements only the singular contract will still work only if it returns `404` or `405` for plural routes, allowing frontend fallback. Network errors, `401`, `403`, or `500` on plural routes will block fallback.

Admin routes do not have fallback aliases:

- `/admin/wallets/...`
- `/admin/finance/...`

These must match exactly.

### Settlement Naming

The frontend uses:

- `GET /api/rides/:tripId/settlement`
- `POST /api/rides/:tripId/settle`

The repo only contains the legacy Supabase Edge Function `settle-trip`, which accepts `{ tripId }`. That does not match the Go REST path.

## Remaining Supabase Financial Logic

### Active Wallet Flow Supabase RPCs

No active wallet adapter/page in the scanned wallet scope calls the removed wallet RPCs directly:

- No active `supabase.rpc("pay_ride_from_wallet")`
- No active `supabase.rpc("transfer_funds")`
- No active `supabase.rpc("request_withdrawal")`
- No active `supabase.rpc("admin_approve_deposit")`
- No active `supabase.rpc("admin_approve_rider_deposit")`
- No active `supabase.rpc("admin_approve_withdrawal")`
- No active `supabase.rpc("admin_reject_withdrawal")`
- No active `supabase.rpc("admin_lock_wallet")`
- No active `supabase.rpc("admin_unlock_wallet")`
- No active `supabase.rpc("admin_reverse_transaction")`
- No active `supabase.rpc("admin_set_fx_rate")`
- No active `supabase.rpc("lookup_user_by_pickme_account")`

### Other Supabase RPCs Still Present

The broader frontend still has non-wallet RPC calls:

- `src/pages/DriverDashboard.tsx`: `can_driver_operate`
- `src/pages/DriverDashboard.tsx`: `is_top_driver`
- `src/pages/negotiate/DriverRequestsScreen.tsx`: `is_top_driver`
- `src/components/driver/DemandHeatmap.tsx`: `update_demand_zones`
- `src/lib/rideExpiry.ts`: `expire_old_rides`
- `src/lib/ramzActions.ts`: `expire_old_rides`, `auto_resolve_noise_fraud_flags`, `cleanup_old_messages`

These are not wallet finance RPCs, but they remain outside the Go boundary.

### Direct Financial Table Access

No active wallet-scoped frontend code was found directly querying or mutating these financial tables:

- `wallets`
- `wallet_transactions`
- `driver_wallets`
- `deposit_requests`
- `rider_deposit_requests`
- `withdrawals`
- `admin_earnings`
- `platform_ledger`
- `wallet_transfers`

Remaining table-name matches are static labels/normalization keys, not direct Supabase communication:

- `src/lib/walletApi.ts` response key names such as `withdrawals`, `locked_wallets`, and `admin_earnings`.
- `src/lib/ramzHeuristicScan.ts` static regex/audit strings.
- `src/pages/admin/AdminRlsViewer.tsx` static RLS/audit labels.

### Direct Financial Inserts

No active wallet-scoped direct inserts into financial tables were found.

Supabase Storage upload remains active for proof files:

- `src/components/wallet/DepositModal.tsx`
- `src/pages/DriverDepositPage.tsx`

This is storage usage, not financial table mutation.

### Direct Financial Updates

No active wallet-scoped direct updates to financial tables were found.

The scanned wallet/admin-health scope has non-financial writes to `system_error_logs` in `src/pages/admin/AdminSystemHealth.tsx`.

### Direct Financial Deletes

No active wallet-scoped direct deletes from financial tables were found.

## Per-Feature Notes

### Wallet Balance

Frontend: `getWalletMe()`.

Routes:

- `GET /api/wallets/me`
- fallback `GET /api/wallet/me`

Backend match: **missing**.

### Wallet Transactions

Frontend: `getWalletTransactions(limit)`.

Routes:

- `GET /api/wallets/me/transactions?limit=...`
- fallback `GET /api/wallet/transactions?limit=...`

Backend match: **missing**.

### Wallet Deposits

Frontend: `listWalletDeposits()`, `walletDeposit()`.

Routes:

- `GET /api/wallets/deposits`
- fallback `GET /api/wallet/deposits`
- `POST /api/wallets/deposits`
- fallback `POST /api/wallet/deposit`

Backend match: **missing**.

### Rider Deposits

Frontend: `listWalletDeposits({ type: "rider" })`, `adminListDeposits("rider")`, `adminApproveDeposit(..., "rider")`, `adminRejectDeposit(..., "rider")`.

Routes:

- `GET /api/wallets/deposits?type=rider`
- fallback `GET /api/wallet/deposits?type=rider`
- `GET /admin/wallets/deposits?type=rider`
- `POST /admin/wallets/deposits/:id/approve`
- `POST /admin/wallets/deposits/:id/reject`

Backend match: **missing**.

### Driver Deposits

Frontend: `walletDeposit({ wallet_type: "driver" })`, `adminListDeposits("driver")`, `adminApproveDeposit(..., "driver")`.

Routes:

- `POST /api/wallets/deposits`
- fallback `POST /api/wallet/deposit`
- `GET /admin/wallets/deposits?type=driver`
- `POST /admin/wallets/deposits/:id/approve`
- `POST /admin/wallets/deposits/:id/reject`

Backend match: **missing**.

### Transfer Funds

Frontend: `walletTransfer()`, `transferFunds()`.

Routes:

- `POST /api/wallets/transfer`
- fallback `POST /api/wallet/transfer`

Backend match: **missing**.

### Pay Ride

Frontend: `walletPayRide()`, `payRideFromWallet()`.

Routes:

- `POST /api/wallets/pay`
- fallback `POST /api/wallet/pay`

Backend match: **missing**.

### Withdrawal

Frontend: `walletWithdraw()`, `requestWithdrawal()`, `adminListWithdrawals()`, `adminApproveWithdrawalGo()`, `adminRejectWithdrawalGo()`.

Routes:

- `POST /api/wallets/withdrawals`
- fallback `POST /api/wallet/withdraw`
- `GET /admin/wallets/withdrawals`
- `POST /admin/wallets/withdrawals/:id/approve`
- `POST /admin/wallets/withdrawals/:id/reject`

Backend match: **missing**.

### Lookup User

Frontend: `lookupWalletUser()`, `lookupUserByPhone()`, `lookupUserByPickmeAccount()`.

Routes:

- `GET /api/wallets/lookup-user`
- fallback `GET /api/wallet/lookup-user`

Backend match: **missing**.

### Driver Summary

Frontend: `getDriverWalletSummary()`.

Routes:

- `GET /api/wallets/driver/summary`
- fallback `GET /api/wallet/driver/summary`

Backend match: **missing**.

### Driver Earnings

Frontend: `getDriverEarnings(period)`.

Routes:

- `GET /api/wallets/driver/earnings?period=...`
- fallback `GET /api/wallet/driver/earnings?period=...`

Backend match: **missing**.

### Settlement

Frontend: `getRideSettlement(tripId)`, `settleRideThroughGo(tripId)`, `settleTrip(tripId)`.

Routes:

- `GET /api/rides/:tripId/settlement`
- `POST /api/rides/:tripId/settle`

Backend match: **missing**.

Legacy non-matching backend:

- `supabase/functions/settle-trip`

## Verdict

Frontend wallet integration is structurally migrated to Go-style REST calls, and active wallet flows no longer directly use Supabase wallet RPCs or financial table mutations.

However, **none of the checked frontend wallet endpoints can be verified against an implemented Go backend in this repository**. The integration is therefore not complete unless an external Go service exists outside this repo and exposes the exact routes listed above.

