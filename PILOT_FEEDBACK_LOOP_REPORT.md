# Pilot Feedback Loop Report

Date: 2026-07-02

## Existing Feedback Surfaces

- Rider rating modal after completed ride.
- Dispute form on completed ride.
- Driver feedback component exists.
- Admin reports/disputes pages exist.
- Sentry and observability are configured for runtime errors when enabled.

## Pilot Feedback Process

### In-App After Ride

- Rider rates completed ride.
- Rider can open dispute/report.
- Driver reports operational issue to support if app flow blocks completion.

### Issue Reporting

Capture every issue with:

- ride id
- rider id
- driver id
- time
- device
- screen
- screenshot or recording
- expected behavior
- actual behavior
- severity
- workaround used

## Pilot Bug Report Template

```text
Title:
Severity: Critical / High / Medium / Low
Ride ID:
Rider:
Driver:
Device:
App version / build:
Time:
Flow step:
Expected:
Actual:
Screenshot/log:
Workaround:
Owner:
Status:
```

## Daily Pilot Report Template

```text
Date:
Active drivers:
Active riders:
Ride requests:
Offers submitted:
Offers accepted:
Completed trips:
Cancelled trips:
Average pickup time:
Payment issues:
Notification failures:
App crashes:
Support incidents:
Emergency/SOS events:
Top driver feedback:
Top rider feedback:
Blockers for tomorrow:
GO / NO-GO for next pilot day:
```

## Metrics To Track

| Metric | Source | Pilot Target |
|---|---|---|
| Request success rate | API + admin dashboard | >= 95% |
| Offer acceptance rate | ride offers | >= 70% |
| Cancellation rate | rides | <= 15% |
| Average pickup time | ride status timestamps | <= 12 minutes |
| Completion rate | rides completed / accepted | >= 90% |
| Payment issues | support + wallet/payment logs | 0 critical |
| Notification failures | notification history + support | <= 10% |
| App crashes | Sentry | 0 critical |

## Feedback Loop Cadence

- Morning readiness check.
- Midday support review.
- End-of-day pilot report.
- Fix only pilot-blocking bugs before the next day.
- Defer noncritical UX polish until the cohort is stable.
