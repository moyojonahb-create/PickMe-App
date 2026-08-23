// Telemetry (Sentry) initializes off the critical path — see main.tsx's
// scheduleTelemetry — so anything that fails before it's ready needs
// somewhere to land instead of being dropped. Both the global window error
// handlers (main.tsx) and ErrorBoundary's componentDidCatch route through
// this same buffer, so a render crash during boot is captured exactly like
// any other early error rather than calling the not-yet-initialized Sentry
// SDK directly and silently discarding it.
let telemetryReady = false;
let reportTelemetryError: ((error: unknown) => void) | null = null;
const earlyErrors: unknown[] = [];

export function captureError(err: unknown) {
  if (telemetryReady && reportTelemetryError) reportTelemetryError(err);
  else if (earlyErrors.length < 20) earlyErrors.push(err);
}

/** Called once Sentry has finished initializing — flushes anything buffered
 * before that point and routes future captureError calls straight through. */
export function markTelemetryReady(report: (error: unknown) => void) {
  reportTelemetryError = report;
  telemetryReady = true;
  earlyErrors.splice(0).forEach((err) => report(err));
}
