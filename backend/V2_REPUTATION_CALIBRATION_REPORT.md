# V2 Reputation Calibration Report

## Summary

GO V2.0-E Reputation Calibration and Marketplace Intelligence was implemented as an analytics-only backend layer.

Preserved:

```text
Go Core V1 ride lifecycle
Frontend F1 contracts
V2.0-A Redis Foundation
V2.0-B Smart Dispatch Shadow Mode
V2.0-C Dispatch Operations and Analytics
V2.0-D Driver Reputation System
public.rides
public.ride_offers
canonical websocket events
production dispatch behavior
```

Not implemented:

```text
active dispatch
reputation-based matching
frontend changes
wallet
push notifications
Kafka
NATS
pricing
fraud system
```

This phase measures whether reputation quality is ready to influence future dispatch. It does not use reputation in dispatch.

## Files Changed

```text
cmd/server/main.go
internal/reputation/calibration.go
internal/reputation/calibration_reporting.go
internal/reputation/calibration_test.go
internal/reputation/calibration_reporting_test.go
REPUTATION_CALIBRATION_SCHEMA.sql
V2_REPUTATION_CALIBRATION_REPORT.md
```

V2.0-D reputation files remain part of the working tree:

```text
internal/reputation/types.go
internal/reputation/service.go
internal/reputation/repository.go
internal/reputation/reporting.go
```

## Schema Additions

Created additive SQL file:

```text
REPUTATION_CALIBRATION_SCHEMA.sql
```

Tables:

```text
public.reputation_daily_stats
public.reputation_score_distribution
public.reputation_calibration_runs
```

No changes were made to:

```text
public.rides
public.ride_offers
public.driver_reputation
public.driver_reputation_snapshots
public.driver_reputation_events
```

RLS is enabled on the new public analytics tables.

## Analytics Produced

Reputation analytics:

```text
score distribution
score percentiles
acceptance distribution
completion distribution
cancellation distribution
freshness distribution
rating distribution
```

Health metrics:

```text
average dispatch_score
median dispatch_score
P25 score
P50 score
P75 score
P90 score
P95 score
```

Safety detection:

```text
score inflation
score compression
score starvation
new-driver disadvantage
over-rewarded veteran drivers
abnormal score clustering
```

Driver cohorts:

```text
new drivers
low-volume drivers
medium-volume drivers
high-volume drivers
```

Cohort measurements:

```text
average dispatch score
average acceptance rate
average completion rate
average cancellation rate
```

Dispatch simulation metrics using existing shadow dispatch data:

```text
actual_driver_was_selected_rate
actual_driver_rank_distribution
average_actual_driver_rank
reputation_vs_actual_acceptance
reputation_vs_completion
sample_count
```

## APIs Created

Authenticated admin-safe endpoints:

```text
GET /admin/reputation/health
GET /admin/reputation/distribution
GET /admin/reputation/cohorts
GET /admin/reputation/calibration
GET /admin/reputation/dispatch-analysis
```

These endpoints return JSON only and expose no secrets.

Existing V2.0-D endpoints remain available:

```text
GET /admin/reputation/drivers
GET /admin/reputation/drivers/:driverID
GET /admin/reputation/drivers/:driverID/events
GET /admin/reputation/top-drivers
GET /admin/reputation/low-score-drivers
```

## Tests Added

Added:

```text
internal/reputation/calibration_test.go
internal/reputation/calibration_reporting_test.go
```

Covered:

```text
percentile calculations
score distribution
cohort generation
calibration risk detection
dispatch analysis calculations
admin calibration endpoints return safe JSON
admin calibration endpoints return safe JSON errors
```

## Build Results

Executed with normal Windows Go build-cache access:

```text
go test ./...          PASS
go build ./cmd/server PASS
```

## Runtime Validation Plan

### 1. Apply Additive Schema

Run:

```text
REPUTATION_CALIBRATION_SCHEMA.sql
```

Verify:

```text
public.reputation_daily_stats exists
public.reputation_score_distribution exists
public.reputation_calibration_runs exists
public.rides unchanged
public.ride_offers unchanged
```

### 2. Confirm No Dispatch Activation

Verify:

```text
DISPATCH_MODE=off or DISPATCH_MODE=shadow behaves exactly as before
ride_offer delivery remains unchanged
driver reputation is not used in candidate selection
no frontend route changes are required
```

### 3. Populate Reputation Data

Run normal staging activity:

```text
driver location updates
ride requests
driver offer submissions
rider offer acceptances
ride completions
```

Verify:

```text
public.driver_reputation contains updated scores
public.driver_reputation_events contains audit rows
```

### 4. Refresh Calibration Rollups

Run the rollup SQL in:

```text
REPUTATION_CALIBRATION_SCHEMA.sql
```

Verify:

```text
public.reputation_daily_stats has current-day metrics
```

### 5. Query Admin APIs

Call:

```text
GET /admin/reputation/health
GET /admin/reputation/distribution
GET /admin/reputation/cohorts
GET /admin/reputation/calibration
GET /admin/reputation/dispatch-analysis
```

Verify:

```text
JSON responses are returned
percentiles are populated
cohorts are present
shadow dispatch analysis uses existing dispatch_shadow_outcomes
no endpoint exposes credentials or connection strings
```

## Operational Risks

### Sparse data

Early reputation distributions may be noisy because driver history is thin. Do not use these metrics for dispatch until enough completed rides and accepted offers exist.

### Missing ratings

Rating distribution will remain sparse until a rider rating input exists. Dispatch readiness should not depend on ratings until that product surface is implemented.

### Shadow dispatch dependency

Dispatch analysis depends on V2.0-B/C shadow data. If shadow dispatch is off or missing coordinates, dispatch-analysis sample counts will be low.

### Calibration table freshness

Daily stats and calibration runs are rollup-driven. Operations should schedule rollup execution before relying on daily panels.

### Bias interpretation

New-driver disadvantage and veteran over-reward checks are indicators, not final judgments. They should trigger review before any dispatch integration.

## Dispatch-Readiness Recommendation

```text
NOT READY FOR DISPATCH INTEGRATION
```

Reason:

```text
V2.0-E now provides the measurement system, but reputation should not influence dispatch until real staging/production data proves:

1. score distribution is not inflated or compressed
2. new drivers are not systematically disadvantaged
3. high-volume drivers are not over-rewarded
4. reputation correlates positively with acceptance and completion
5. shadow dispatch outcomes show improved or neutral marketplace quality
```

## Final Classification

```text
GO V2.0-E Reputation Calibration & Marketplace Intelligence: IMPLEMENTED
Reputation-based dispatch: NOT ACTIVATED
Production ride flow: PRESERVED
Frontend contracts: PRESERVED
Websocket contracts: PRESERVED
```
