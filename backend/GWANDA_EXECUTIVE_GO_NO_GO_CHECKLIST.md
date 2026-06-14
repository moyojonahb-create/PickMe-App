# Gwanda Executive Go/No-Go Checklist

Report date: 2026-06-12

Decision scope: First controlled Gwanda pilot users

## Approval Summary

Current production readiness score: 91/100

Recommended launch decision:

- Gwanda Week 1 pilot: GO if all checklist items are approved.
- Bulawayo pilot: NO.
- Nationwide launch: NO.

## Mandatory Go Criteria

| Criteria | Required Result | Approved |
| --- | --- | --- |
| Production environment configured | `APP_ENV=production` and required env vars set |  |
| Database healthy | Health check passes |  |
| Redis healthy if enabled | Redis health check passes |  |
| Backups verified | Latest backup timestamp and restore owner confirmed |  |
| Pilot city locked | `PUBLIC_WALLET_PILOT_CITY=Gwanda` |  |
| Pilot enabled | `PUBLIC_WALLET_PILOT_ENABLED=true` |  |
| Cohort frozen | Week 1 cohort approved: 5 drivers, 10 riders |  |
| Driver authorization verified | All pilot drivers authorized |  |
| Admin routes protected | Admin-only access verified |  |
| Ride data protected | Riders/drivers/admins see only authorized rides |  |
| Exact money certified | Minor-unit money controls active |  |
| Wallet pilot enforcement active | Non-cohort and non-Gwanda wallet mutations denied |  |
| Kill switches tested | Deposits, payments, refunds, adjustments fail closed |  |
| Provider secrets configured | Secrets present for enabled providers |  |
| Provider status endpoints configured | Status verification available for enabled providers |  |
| Callback security tested | Forged, replayed, duplicate, and unsupported callbacks rejected |  |
| Mock card disabled | `CARD_PAYMENTS_ENABLED=false` unless real processor exists |  |
| Reconciliation baseline clean | No unexplained variance |  |
| Daily dashboard ready | Operations dashboard reviewed by owners |  |
| Support coverage confirmed | L1/L2 support staffed |  |
| Finance owner assigned | Daily reconciliation owner named |  |
| Incident commander assigned | Launch-day IC named |  |
| Risk owner assigned | Fraud review owner named |  |

## Automatic No-Go Conditions

Launch must not proceed if any condition is true:

- Production startup emits `SECURITY_PAYMENT_PROVIDER_MISCONFIGURATION`.
- Mock card processor is enabled in production.
- Provider status verification is missing for an enabled production provider.
- Reconciliation baseline has unexplained variance.
- Any duplicate credit is detected.
- Kill switch verification fails.
- Pilot cohort is not frozen.
- Support owner is not staffed.
- Finance owner is not staffed.
- Backup status is unknown.
- Any P0 or unresolved P1 incident is active.

## Management Sign-Off

| Function | Owner | Decision | Date |
| --- | --- | --- | --- |
| CEO/Management |  |  |  |
| Engineering |  |  |  |
| SRE/Operations |  |  |  |
| Payments |  |  |  |
| Finance |  |  |  |
| Risk/Fraud |  |  |  |
| Support |  |  |  |
| Security |  |  |  |

## Day 1 Decision

Final decision:

- GO
- GO WITH RESTRICTIONS
- NO-GO

Restrictions, if any:

Decision owner:

Decision timestamp:

Next review:

