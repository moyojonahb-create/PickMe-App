/**
 * @cruixe/core — business logic shared by the CruiXe web app and RN app.
 *
 * Rules for this package:
 *   - No DOM globals (enforced by .eslintrc.cjs's no-restricted-globals).
 *   - No `import.meta.env` — config is injected via defineCoreConfig().
 *   - No React Native imports either; this must stay runnable in Node for tests.
 *   - No module-level side effects. Everything is a factory, so tests get clean
 *     state and RN screens can dispose what they create.
 */

export { defineCoreConfig, CoreConfigError, type CoreConfig } from './config.js';

export {
  createSupabaseAuthProvider,
  type AuthTokenProvider,
  type AuthEvent,
  type SupabaseAuthLike,
} from './auth.js';

export {
  createGoBackendClient,
  GoBackendError,
  type GoBackendClient,
  type GoBackendErrorCode,
} from './net/goBackendClient.js';

export {
  BackendSocketClient,
  createBackendSocketClient,
  type BackendSocketEvent,
  type BackendSocketEventType,
  type BackendSocketState,
  type SocketFactory,
} from './net/backendSocketClient.js';

export {
  eventRideId,
  eventDriverId,
  eventOfferId,
  eventNumber,
  eventString,
} from './net/socketEvents.js';

export {
  buildSupabaseOptions,
  type StorageAdapter,
  type SupabaseClientOptions,
} from './supabase/createSupabaseClient.js';

export * from './tokens/index.js';
