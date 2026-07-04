# Supervised Ride Test Script

Date: 2026-07-02

Scope: one controlled end-to-end ride test before inviting the 5-driver / 10-rider pilot cohort.

## Preconditions

- Frontend is running at `http://localhost:5173`.
- Backend is running at `http://localhost:3000`.
- Redis is running if `REDIS_ENABLED=true`.
- Asynq worker is running if `ASYNQ_ENABLED=true`.
- Rider account is created and can log in.
- Driver account is created, approved, and can log in.
- Admin account is created and can access admin views.
- `PAYMENTS_PROVIDER_ENABLED=false`.
- Test ride uses cash.
- Operator has rider, driver, and support phone contact.

## Test Roles

- Rider:
- Driver:
- Admin/operator:
- Support phone:
- Test start time:
- Test end time:

## Script

### 1. Rider Logs In

Expected:

- Rider reaches the main ride booking screen.
- Rider profile/session remains active after refresh.

Record:

- Pass/fail:
- Notes:

### 2. Driver Logs In

Expected:

- Driver reaches dashboard.
- Driver account is approved.
- Driver can access online/offline controls.

Record:

- Pass/fail:
- Notes:

### 3. Driver Goes Online

Expected:

- Driver grants location permission.
- Driver appears online.
- No browser permission errors block the driver.

Record:

- Pass/fail:
- Notes:

### 4. Rider Requests Ride

Expected:

- Rider sets pickup in Gwanda.
- Rider sets drop-off in Gwanda.
- Fare preview appears.
- Payment method is cash or manual wallet-safe.
- Ride request succeeds.

Record:

- Ride ID:
- Pass/fail:
- Notes:

### 5. Driver Sends Offer

Expected:

- Driver sees open ride/request card.
- Driver reviews pickup, drop-off, fare, and ETA.
- Driver submits offer.

Record:

- Offer ID:
- Pass/fail:
- Notes:

### 6. Rider Accepts Offer

Expected:

- Rider sees the driver's offer.
- Rider can view basic driver/vehicle details.
- Rider accepts offer.
- Rider screen moves to accepted/connected trip state.

Record:

- Pass/fail:
- Notes:

### 7. Driver Sets Enroute

Expected:

- Driver can set `enroute`.
- Rider sees progress update.
- Trip is not marked started yet.

Record:

- Pass/fail:
- Notes:

### 8. Driver Sets Arrived

Expected:

- Driver can set `arrived`.
- Rider sees driver-arrived progress.
- Trip is not marked payable/in-progress yet.

Record:

- Pass/fail:
- Notes:

### 9. Driver Starts Ride

Expected:

- Driver starts the ride only after rider pickup.
- UI shows in-progress trip state.
- Backend canonical state is `ongoing`, with frontend compatibility as `in_progress`.

Record:

- Pass/fail:
- Notes:

### 10. Driver Completes Ride

Expected:

- Driver can complete only after ride has started.
- Rider sees completed ride.
- Driver sees completed ride or returns to available state.
- Cash collection is confirmed before completion.

Record:

- Pass/fail:
- Notes:

### 11. Rider Rates Ride

Expected:

- Rider sees rating/feedback prompt.
- Rider can submit rating or skip if the current UI allows.

Record:

- Pass/fail:
- Notes:

### 12. Admin Verifies Ride

Expected:

- Admin can find ride.
- Ride state is completed.
- Driver, rider, fare, and timestamps are correct.
- `/health/ready` remains green.
- `/health/dependencies` remains acceptable.
- Asynq stats are accessible to admin.

Commands:

```powershell
curl.exe -fsS http://localhost:3000/health/ready
curl.exe -fsS http://localhost:3000/health/dependencies
curl.exe -fsS -H "Authorization: Bearer $env:ADMIN_JWT" http://localhost:3000/admin/jobs/stats
```

Record:

- Pass/fail:
- Notes:

## GO Criteria

The controlled pilot can start only if:

- Rider request succeeds.
- Driver receives or finds the ride.
- Driver sends offer.
- Rider accepts offer.
- Enroute and arrived do not start the payable trip.
- Start ride moves the UI to in-progress.
- Complete ride succeeds.
- Rider and driver can both recover from refresh.
- Admin can verify the completed ride.
- Support fallback is staffed.

## Failure Rule

If any live-trip step fails, pause the pilot. Move the test rider and driver to WhatsApp/phone support, record the failure, and do not invite the full cohort until the failing step is fixed and retested.
