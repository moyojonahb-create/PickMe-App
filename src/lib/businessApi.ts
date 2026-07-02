import { goBackend } from "@/lib/goBackendClient";

type ApiResult = {
  success?: boolean;
  updated?: number;
  deleted?: number;
  inserted?: number;
  error?: string;
};

export function submitDriverRating(input: {
  ride_id: string;
  driver_id: string;
  rating: number;
  comment?: string | null;
}) {
  return goBackend.post<ApiResult>("/api/ratings/driver", input);
}

export function submitDispute(input: {
  ride_id: string;
  reporter_role: string;
  category: string;
  description: string;
}) {
  return goBackend.post<ApiResult>("/api/disputes", input);
}

export function createEmergencyEvent(input: {
  ride_id?: string | null;
  latitude: number;
  longitude: number;
}) {
  return goBackend.post<ApiResult>("/api/emergency-events", input);
}

export function cancelRideWithPolicy(rideId: string, input: {
  cancellation_fee?: number;
  reason?: string;
}) {
  return goBackend.post<ApiResult>(`/api/rides/${rideId}/cancel`, input);
}

export function createNotification(input: Record<string, unknown>) {
  return goBackend.post<ApiResult>("/api/notifications", input);
}

export function markNotificationRead(id: string) {
  return goBackend.post<ApiResult>(`/api/notifications/${id}/read`);
}

export function markNotificationsRead(ids: string[]) {
  return goBackend.post<ApiResult>("/api/notifications/read", { ids });
}

export function createTip(input: {
  ride_id: string;
  driver_id: string;
  amount: number;
  message?: string | null;
}) {
  return goBackend.post<ApiResult>("/api/tips", input);
}

export function createFraudFlag(input: Record<string, unknown>) {
  return goBackend.post<ApiResult>("/api/fraud-flags", input);
}

export function createRideStops(input: Record<string, unknown> | Record<string, unknown>[]) {
  if (Array.isArray(input)) {
    return goBackend.post<ApiResult>("/api/ride-stops", { rows: input });
  }
  return goBackend.post<ApiResult>("/api/ride-stops", input);
}

export function createRidePreferences(input: Record<string, unknown>) {
  return goBackend.post<ApiResult>("/api/ride-preferences", input);
}

export function createStudentDiscountUsage(input: {
  ride_id: string;
  discount_amount: number;
}) {
  return goBackend.post<ApiResult>("/api/student-discount-usage", input);
}

export function adminUpdateRow(table: string, id: string, changes: Record<string, unknown>) {
  return goBackend.patch<ApiResult>(`/admin/business/${table}/${id}`, { changes });
}

export function adminInsertRow(table: string, row: Record<string, unknown>) {
  return goBackend.post<ApiResult>(`/admin/business/${table}`, row);
}

export function adminInsertRows(table: string, rows: Record<string, unknown>[]) {
  return goBackend.post<ApiResult>(`/admin/business/${table}`, { rows });
}

export function adminDeleteRow(table: string, id: string) {
  return goBackend.delete<ApiResult>(`/admin/business/${table}/${id}`);
}

export function adminUpdateDispute(id: string, changes: Record<string, unknown>) {
  return goBackend.post<ApiResult>(`/admin/disputes/${id}/status`, changes);
}

export function adminCreatePromo(input: Record<string, unknown>) {
  return goBackend.post<ApiResult>("/admin/promos", input);
}

export function adminUpdatePromo(id: string, changes: Record<string, unknown>) {
  return goBackend.patch<ApiResult>(`/admin/promos/${id}`, changes);
}

export function adminDeletePromo(id: string) {
  return goBackend.delete<ApiResult>(`/admin/promos/${id}`);
}

export function adminUpdateTownPricing(id: string, changes: Record<string, unknown>) {
  return goBackend.patch<ApiResult>(`/admin/town-pricing/${id}`, changes);
}

export function adminCancelRide(rideId: string, cancellation_fee = 0) {
  return goBackend.post<ApiResult>(`/admin/rides/${rideId}/cancel`, { cancellation_fee });
}

export function adminPurgeStaleLiveLocations(cutoff: string) {
  return goBackend.post<ApiResult>("/admin/live-locations/purge-stale", { cutoff });
}

export function adminForceOfflineGhostDrivers(cutoff: string) {
  return goBackend.post<ApiResult>("/admin/drivers/force-offline-ghosts", { cutoff });
}

export function adminCancelStuckRides(cutoff: string) {
  return goBackend.post<ApiResult>("/admin/rides/cancel-stuck", { cutoff });
}

export function adminForceFatigueBreak(cutoff: string) {
  return goBackend.post<ApiResult>("/admin/drivers/fatigue-break", { cutoff });
}

export async function adminExpireOldRides() {
  const result = await goBackend.post<ApiResult & { count?: number }>("/admin/operations/expire-old-rides");
  return Number(result.count ?? 0);
}

export async function adminAutoResolveNoiseFraudFlags() {
  const result = await goBackend.post<ApiResult & { count?: number }>("/admin/operations/auto-resolve-noise-fraud-flags");
  return Number(result.count ?? 0);
}

export async function adminCleanupOldMessages() {
  const result = await goBackend.post<ApiResult & { count?: number }>("/admin/operations/cleanup-old-messages");
  return Number(result.count ?? 0);
}

export function adminUpdateDemandZones() {
  return goBackend.post<ApiResult>("/admin/operations/update-demand-zones");
}

export async function canCurrentDriverOperate() {
  const result = await goBackend.get<{ can_operate?: boolean }>("/api/drivers/me/can-operate");
  return Boolean(result.can_operate);
}

export async function isCurrentDriverTopDriver() {
  const result = await goBackend.get<{ is_top_driver?: boolean }>("/api/drivers/me/top-status");
  return Boolean(result.is_top_driver);
}

export function adminIngestSystemHealthLogs(today_start: string, rows: Record<string, unknown>[]) {
  return goBackend.post<ApiResult>("/admin/system-health/logs/ingest", { today_start, rows });
}

export function adminResolveSystemHealthLog(id: string) {
  return goBackend.post<ApiResult>(`/admin/system-health/logs/${id}/resolve`);
}

export function createDriverApplication(input: Record<string, unknown>) {
  return goBackend.post<ApiResult & { id?: string }>("/api/drivers/applications", input);
}

export function upsertDriverApplication(input: {
  profile?: Record<string, unknown>;
  driver: Record<string, unknown>;
}) {
  return goBackend.post<ApiResult & { id?: string }>("/api/drivers/applications/upsert", input);
}

export function createDriverDocument(input: Record<string, unknown>) {
  return goBackend.post<ApiResult & { id?: string }>("/api/drivers/documents", input);
}

export function updateMyDriver(input: Record<string, unknown>) {
  return goBackend.patch<ApiResult>("/api/drivers/me", input);
}

export function createDriverFeedback(input: { type: string; message: string }) {
  return goBackend.post<ApiResult>("/api/drivers/feedback", input);
}

export function updateMyProfile(input: Record<string, unknown>) {
  return goBackend.patch<ApiResult>("/api/profiles/me", input);
}

export function updateMyProfileAvatar(avatar_url: string) {
  return goBackend.patch<ApiResult>("/api/profiles/me/avatar", { avatar_url });
}

export function upsertUserSettings(input: Record<string, unknown>) {
  return goBackend.post<ApiResult>("/api/user-settings", input);
}

export function updateRiderPreferences(input: Record<string, unknown>) {
  return goBackend.patch<ApiResult>("/api/rider-preferences", input);
}

export function createFavoriteLocation(input: Record<string, unknown>) {
  return goBackend.post<Record<string, unknown> & { id?: string }>("/api/favorite-locations", input);
}

export function deleteFavoriteLocation(id: string) {
  return goBackend.delete<ApiResult>(`/api/favorite-locations/${id}`);
}

export function createMessage(input: { ride_id: string; text: string }) {
  return goBackend.post<ApiResult & { id?: string }>("/api/messages", input);
}

export function createCallSession(input: { ride_id: string; callee_id: string; status?: string }) {
  return goBackend.post<ApiResult & { id?: string }>("/api/call-sessions", input);
}

export function updateCallSession(id: string, input: Record<string, unknown>) {
  return goBackend.patch<ApiResult>(`/api/call-sessions/${id}`, input);
}

export function createFatigueBreak(input: Record<string, unknown>) {
  return goBackend.post<ApiResult>("/api/driver-sessions/fatigue-break", input);
}

export function cachePlace(input: Record<string, unknown>) {
  return goBackend.post<ApiResult>("/api/dev/places-cache", input);
}

export function adminCreateRamzAudit(input: Record<string, unknown>) {
  return goBackend.post<ApiResult & { id?: string }>("/admin/ramz-audit", input);
}

export function adminVerify() {
  return goBackend.get<ApiResult & { isAdmin?: boolean }>("/admin/auth/verify");
}
