# Expansion Roadmap

Date: 2026-07-02

## Stage 1 - Controlled Gwanda Pilot

- Drivers: 5
- Riders: 10
- Support staff: 1 operator, 1 engineering on-call, 1 finance owner
- Infrastructure: current staging/prod-like Docker profile, Redis, Asynq, monitoring, Sentry
- Payment readiness: cash-first, manual wallet approval
- Monitoring readiness: dashboards reachable, `/health/ready`, `/metrics`, Redis/Asynq stats
- Rollback: previous image tag ready
- GO gate: one supervised end-to-end ride passes

## Stage 2 - Gwanda Public Launch

- Drivers: 25-40
- Riders: 500-1,000
- Support staff: 2 operators, 1 engineering on-call, 1 finance owner
- Infrastructure: production Docker validation, alerting, backups, daily restore evidence
- Payment readiness: provider certification or cash-first public policy
- Monitoring readiness: alert rules verified with live traffic
- Rollback: rehearsed in staging and production
- GO gate: 7 consecutive pilot days without critical ride lifecycle incidents

## Stage 3 - Bulawayo Pilot

- Drivers: 20
- Riders: 100
- Support staff: 2 operators, city lead, engineering on-call
- Infrastructure: town pricing, dispatch density, monitoring by city
- Payment readiness: confirmed cash/wallet process for Bulawayo
- Monitoring readiness: city-level dashboards and incident tags
- Rollback: city feature/pilot pause plan
- GO gate: Gwanda public stable and Bulawayo driver onboarding complete

## Stage 4 - Bulawayo Public Launch

- Drivers: 100-150
- Riders: 5,000+
- Support staff: 4 operators, finance coverage, city operations lead
- Infrastructure: scaled backend/worker capacity, DB latency checks, Redis memory checks
- Payment readiness: provider routes certified or cash policy documented
- Monitoring readiness: alert response drill completed
- Rollback: traffic pause and driver/rider comms template
- GO gate: Bulawayo pilot completion rate >= 90% and support SLA stable

## Stage 5 - National Rollout

- Drivers: 1,000+
- Riders: 50,000+
- Support staff: national operations, city leads, 24/7 support rotation, finance ops
- Infrastructure: multi-region/cloud capacity review, backups, disaster recovery, load testing
- Payment readiness: production payment provider certification and reconciliation
- Monitoring readiness: SLOs, alert fatigue review, incident command process
- Rollback: city-by-city pause capability
- GO gate: two cities stable, payment reconciliation clean, support staffing funded

## Cross-Stage Risk Checks

- Ride lifecycle contract stable.
- Dispatch capacity adequate.
- Payment and wallet reconciliation clean.
- Support queue manageable.
- Emergency/SOS handling tested.
- Monitoring and rollback rehearsed.
- Driver supply matches rider demand.
