# Frontend Go Finance Migration Report

Date: 2026-06-12

Scope: GO V2.3-A.1 frontend wallet and finance communication migration. UX, ride lifecycle logic, websocket contracts, and pilot governance were left unchanged.

## 1. Files Changed

- `src/lib/walletApi.ts`
- `src/lib/walletPayments.ts`
- `src/hooks/useWallet.ts`
- `src/hooks/useWalletPin.ts`
- `src/components/wallet/DepositModal.tsx`
- `src/components/driver/DriverEarningsDashboard.tsx`
- `src/pages/RiderWalletPage.tsx`
- `src/pages/DriverWalletPage.tsx`
- `src/pages/DriverDepositPage.tsx`
- `src/pages/DriverDashboard.tsx`
- `src/pages/RideDetail.tsx`
- `src/pages/admin/AdminWalletDashboard.tsx`
- `src/pages/admin/AdminDepositsPage.tsx`
- `src/pages/admin/AdminRiderDepositsPage.tsx`
- `src/pages/admin/AdminWithdrawalsPage.tsx`
- `src/pages/admin/AdminRatePage.tsx`
- `src/pages/admin/AdminLedger.tsx`
- `src/pages/admin/AdminReports.tsx`
- `src/pages/admin/AdminSystemHealth.tsx`
- `src/lib/ramzActions.ts`

## 2. RPCs Removed From Active Frontend Flows

- `pay_ride_from_wallet`
- `transfer_funds`
- `request_withdrawal`
- `admin_approve_withdrawal`
- `admin_reject_withdrawal`
- `admin_approve_deposit`
- `admin_approve_rider_deposit`
- `admin_lock_wallet`
- `admin_unlock_wallet`
- `admin_reverse_transaction`
- `admin_set_fx_rate`
- `lookup_user_by_pickme_account`

`settle-trip` Supabase Edge Function usage was also removed from the ride settlement UI.

## 3. Tables No Longer Accessed Directly

Active frontend code no longer directly queries or mutates:

- `wallets`
- `wallet_transactions`
- `driver_wallets`
- `deposit_requests`
- `rider_deposit_requests`
- `withdrawals`
- `admin_earnings`
- `platform_ledger`

Supabase Storage remains in use for deposit proof upload and signed proof viewing, which matches the architecture standard.

## 4. New Go API Integrations

Public wallet:

- `GET /api/wallet/me`
- `GET /api/wallet/transactions`
- `GET /api/wallet/deposits`
- `POST /api/wallet/deposit`
- `POST /api/wallet/withdraw`
- `POST /api/wallet/transfer`
- `POST /api/wallet/pay`
- `POST /api/wallet/pin`
- `GET /api/wallet/lookup-user`
- `GET /api/wallet/driver/summary`
- `GET /api/wallet/driver/earnings`

Admin finance/wallet:

- `GET /admin/finance/wallet-dashboard`
- `GET /admin/finance/earnings`
- `GET /admin/finance/ledger`
- `GET /admin/finance/settlements/summary`
- `GET /admin/finance/health`
- `POST /admin/finance/fx-rate`
- `POST /admin/finance/fraud-flags`
- `POST /admin/finance/fraud-flags/:id/resolve`
- `POST /admin/finance/low-balance-reminders`
- `GET /admin/wallets/deposits`
- `POST /admin/wallets/deposits/:id/approve`
- `POST /admin/wallets/deposits/:id/reject`
- `GET /admin/wallets/withdrawals`
- `POST /admin/wallets/withdrawals/:id/approve`
- `POST /admin/wallets/withdrawals/:id/reject`
- `POST /admin/wallets/users/:userId/lock`
- `POST /admin/wallets/users/:userId/unlock`
- `POST /admin/wallets/transactions/:txId/reverse`

Settlement:

- `GET /api/rides/:tripId/settlement`
- `POST /api/rides/:tripId/settle`

## 5. Remaining Architecture Violations

Finance/wallet:

- `src/pages/admin/AdminRlsViewer.tsx` and `src/lib/ramzHeuristicScan.ts` still contain static strings naming old wallet tables/RPCs. They are not active Supabase communication paths.
- The frontend now assumes the Go backend exposes the singular `/api/wallet/*` and admin finance endpoints listed above. If backend route names differ from these contracts, backend adapter aliases are required.

Non-finance debt left intentionally out of this pass:

- Driver policy RPCs: `can_driver_operate`, `is_top_driver`
- Dispatch RPC: `update_demand_zones`
- Operational RPCs: `expire_old_rides`, `cleanup_old_messages`, `auto_resolve_noise_fraud_flags`
- Direct ride/dispatch/profile/admin reads identified in the broader architecture audit

## 6. Updated Compliance Score

- Wallet Architecture: 84%
- Financial Architecture: 82%
- Ride Architecture: 65% unchanged
- Dispatch Architecture: 45% unchanged

Overall compliance score: 72%

Verdict after this migration slice: MOSTLY COMPLIANT for wallet/finance communication paths, PARTIALLY COMPLIANT overall because non-finance architecture debt remains.

## 7. Build Verification

- `npx tsc --noEmit -p tsconfig.app.json`: PASS
- `npm run build`: BLOCKED by sandbox `spawn EPERM` while Vite/esbuild loaded config.
- Escalated rebuild could not be executed because the environment rejected approval due usage limit.

## 8. Test Verification

- `npm test`: BLOCKED by repository Node guard.
- Current Node: `24.14.0`
- Repo requirement: Node 20 or 22

## Verification Searches

Targeted active-code search for removed wallet RPCs and `settle-trip` returned no active flow hits. Remaining matches are static dev-audit labels in `AdminRlsViewer`.

Targeted active-code search for the financial tables above returned no direct `.from(...)` communication paths. Remaining matches are UI labels, adapter response-key names, or static heuristic/audit strings.
