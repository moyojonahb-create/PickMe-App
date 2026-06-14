# Gwanda Pilot Risk Register

Report date: 2026-06-12

Scope: Controlled Gwanda pilot launch risks

| Risk | Impact | Likelihood | Mitigation | Owner |
| --- | --- | --- | --- | --- |
| Duplicate wallet credit | Critical financial loss and trust impact | Low | Provider event/reference uniqueness, callback signatures, status verification, daily reconciliation, deposit kill switch | Payments Lead |
| Provider status endpoint unavailable | Deposits may be delayed or fail closed | Medium | Provider-specific status URLs, provider outage playbook, support script, provider-specific kill switch | Payments Lead |
| Dead-letter callbacks not reviewed | Missed attack or delayed customer credit investigation | Medium | Daily dead-letter review, finance close requirement, incident escalation | Payments + Finance |
| Reconciliation variance | Financial integrity risk | Low | Daily reconciliation, zero-variance close gate, finance exception process | Finance Lead |
| Mock card processor enabled in production | Fake card deposits | Low | Startup failure outside explicit development mode, `SECURITY_PAYMENT_PROVIDER_MISCONFIGURATION` | Engineering Lead |
| Pilot cohort exceeds coded limits | Limit bypass or unmanaged expansion | Medium | Management approval gate, Go-controlled pilot enforcement, cohort freeze | Operations Lead |
| Week 3/4 rollout exceeds current defaults | Expansion blocked or misconfigured | High if expansion attempted | Explicit pilot limit change approval before Week 3 | Operations + Engineering |
| Websocket outage | Ride lifecycle communication degraded | Medium | Bounded websocket queues, write deadlines, reconnect support script, outage playbook | Engineering Lead |
| Redis outage | Driver location freshness degraded | Medium | Redis health check, connection pooling, fallback monitoring, pause expansion if unstable | SRE |
| Database outage | Full platform or wallet outage | Low | Health checks, backups, restore procedure, DB outage playbook | SRE |
| Rate limit blocks legitimate pilot users | Customer friction | Medium | Conservative Day 1 limits, dashboard monitoring, operations override through config change | SRE |
| Insufficient support coverage | Poor customer experience and delayed incident detection | Medium | Named support owner, support escalation flow, launch-day staffing | Support Lead |
| Fraud through rapid deposits or cycling | Financial loss or abuse | Medium | Pilot caps, cohort controls, fraud dashboard, risk review, account suspension process | Risk Lead |
| Admin account misuse | Sensitive financial data exposure or unauthorized action | Low | Admin-only middleware, auth logs, least privilege, admin failure monitoring | Security Lead |
| Location privacy issue | Safety and privacy incident | Low | Driver location privacy enforcement, ride-room authorization, security logging | Security Lead |
| Provider secret leakage | Forged callbacks or provider impersonation | Low | Secret rotation procedure, no secret logging, callback signature verification | Security + Payments |
| Manual remediation bypasses ledger | Audit failure and balance drift | Low | Finance approval and ledger-only correction policy | Finance Lead |
| Backup restore not rehearsed | Longer outage recovery | Medium | Backup verification before launch, restore owner assigned | SRE |
| Observability gap | Slow incident detection | Medium | Structured logs, request IDs, dashboard review cadence | SRE |
| National-scale assumptions leak into pilot | Overexpansion before proof | Medium | Gwanda-only approval, weekly gates, stop conditions | Management |

## Top Launch Risks

1. Provider status verification stability.
2. Daily finance close discipline.
3. Support readiness for real users.
4. Week 3 and Week 4 expansion exceeding current default pilot limits.
5. Websocket and Redis behavior under live driver/rider usage.

## Risk Acceptance

The listed risks are acceptable only for a controlled Gwanda pilot with capped users, daily reconciliation, live support coverage, and active incident response. They are not acceptable for Bulawayo expansion or nationwide launch without additional evidence and management approval.

