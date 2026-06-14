# Backend Route Verification V2

## Summary

Runtime verification was re-run after correcting the wrong-binary issue.

The backend currently serving `localhost:3000` is:

```text
ProcessName: server
Path: C:\Users\ntepemanamafm\Desktop\pickme-go-backend\server.exe
StartTime: 31/05/2026 19:40:11
```

This is the workspace `server.exe`, not the old Go build-cache binary.

## Binary Verification

String scan confirms the active workspace binary contains the new compatibility route strings:

```text
server.exe contains /api/rides
server.exe contains /api/drivers/me/presence
```

Old binaries checked:

```text
main.exe
pickme-backend.exe
```

Only `server.exe` matched the `/api` compatibility route strings.

## Method

Each route was verified with:

1. No `Authorization` header.
2. `Authorization: Bearer invalid.jwt.token`.
3. A locally signed Supabase-style HS256 JWT using the configured local `SUPABASE_JWT_SECRET`.

For valid-token checks, synthetic/no-op request payloads were used to avoid intentionally creating or mutating production-like ride data. Therefore, route execution is proven by a response other than `401` or `404`; some database-dependent paths return `500` when the synthetic ride/session does not exist or the database rejects the test shape.

## Verification Results

| Route | Missing JWT | Invalid JWT | Valid JWT | Result |
|---|---:|---:|---:|---|
| `POST /api/rides` | `401` | `401` | `400` | Registered; auth enforced; handler executed and rejected incomplete request body. |
| `POST /api/rides/:rideId/offers/:offerId/accept` | `401` | `401` | `500` | Registered; auth enforced; handler executed and reached database path with synthetic ride ID. |
| `POST /api/drivers/me/presence` | `401` | `401` | `500` | Registered; auth enforced; handler executed and reached existing heartbeat/presence database path. |
| `POST /api/drivers/me/location` | `401` | `401` | `400` | Registered; auth enforced; handler executed and rejected missing latitude/longitude. |
| `POST /api/rides/:rideId/status` | `401` | `401` | `500` | Registered; auth enforced; handler executed and reached database path with synthetic ride ID. |
| `POST /api/rides/:rideId/complete` | `401` | `401` | `500` | Registered; auth enforced; handler executed and reached database path with synthetic ride ID. |
| `POST /api/rides/:rideId/settle` | `401` | `401` | `500` | Registered; auth enforced; handler executed and reached database path with synthetic ride ID. |

## Route Mount Verification

`OPTIONS` probes against each `/api` route returned `405 Method Not Allowed`, not `404 Not Found`.

```text
OPTIONS /api/rides -> 405
OPTIONS /api/rides/00000000-0000-0000-0000-000000000000/offers/test-offer/accept -> 405
OPTIONS /api/drivers/me/presence -> 405
OPTIONS /api/drivers/me/location -> 405
OPTIONS /api/rides/00000000-0000-0000-0000-000000000000/status -> 405
OPTIONS /api/rides/00000000-0000-0000-0000-000000000000/complete -> 405
OPTIONS /api/rides/00000000-0000-0000-0000-000000000000/settle -> 405
```

This confirms the routes are mounted at runtime.

## Expected Behavior Check

Expected:

```text
Missing JWT -> 401
Invalid JWT -> 401
Valid JWT -> route executes
```

Observed:

```text
Missing JWT -> 401 for all routes
Invalid JWT -> 401 for all routes
Valid JWT -> route handler executed for all routes
```

No `/api` route returned `404` during this verification pass.

## Conclusion

Runtime route verification now passes.

The previous `404` condition was caused by the wrong binary running. The corrected runtime is serving the workspace `server.exe`, and all requested `/api` compatibility routes are mounted and protected by JWT middleware.
