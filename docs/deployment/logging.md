# Logging

## Format

The Go backend emits request IDs, admin security events, Asynq JSON logs, and observability events to stdout/stderr. Container and systemd deployments should collect stdout/stderr without writing application-local log files.

Required fields for production log review:

- timestamp
- level
- request_id
- trace_id when present
- user_id when authenticated and safe to include
- method
- path
- status
- duration_ms
- event name

## Rotation

Docker compose uses:

```yaml
logging:
  driver: json-file
  options:
    max-size: "50m"
    max-file: "5"
```

Systemd deployments should use journald retention:

```ini
SystemMaxUse=2G
MaxRetentionSec=14day
```

## Retention

- Application logs: 14 days locally, 90 days in centralized logging.
- Security/admin mutation logs: 180 days.
- Payment/wallet incident logs: 365 days or local regulatory requirement.

## Sensitive Data

Do not log:

- JWTs
- refresh tokens
- provider webhook secrets
- payment provider tokens
- Supabase service-role keys
- full card/bank details
- precise location history beyond operational incident windows
