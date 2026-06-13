import { goBackend, GoBackendError } from "@/lib/goBackendClient";
import { decimalToMinor, minorToDecimal } from "@/lib/money";

type UnknownRecord = Record<string, unknown>;

export interface WalletRecord {
  id: string;
  user_id: string;
  balance: number;
  is_locked?: boolean;
  locked_reason?: string | null;
  locked_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface WalletTransaction {
  id: string;
  wallet_id: string;
  user_id: string;
  amount: number;
  transaction_type: string;
  description: string | null;
  ride_id: string | null;
  reference_code?: string | null;
  created_at: string;
}

export interface DepositRecord {
  id: string;
  user_id?: string;
  driver_id?: string;
  amount_usd: number;
  payment_method?: string;
  ecocash_phone?: string;
  ecocash_reference?: string;
  phone_number?: string;
  reference?: string;
  proof_path: string | null;
  created_at: string;
  status: string;
}

export interface WithdrawalRecord {
  id: string;
  driver_id?: string;
  user_id?: string;
  amount_usd: number;
  method: string;
  destination: string;
  account_name: string | null;
  status: string;
  admin_note?: string | null;
  created_at: string;
  approved_at?: string | null;
}

export interface EarningRecord {
  id: string;
  ride_id: string | null;
  driver_id: string;
  fare_amount: number;
  platform_fee: number;
  driver_earnings: number;
  created_at: string;
}

export interface AdminWalletDashboardData {
  transactions: WalletTransaction[];
  deposits: DepositRecord[];
  withdrawals: WithdrawalRecord[];
  flags: UnknownRecord[];
  failed_rides: UnknownRecord[];
  locked_wallets: WalletRecord[];
}

export interface LedgerRow {
  id: string;
  trip_id: string;
  driver_id: string | null;
  passenger_id: string | null;
  amount: number;
  currency: string;
  status: string;
  to_account_id: string;
  created_at: string;
}

function listFrom<T>(payload: unknown, keys: string[]): T[] {
  if (Array.isArray(payload)) return payload as T[];
  if (!payload || typeof payload !== "object") return [];
  const record = payload as UnknownRecord;
  for (const key of keys) {
    const value = record[key];
    if (Array.isArray(value)) return value as T[];
    if (value && typeof value === "object") {
      const nested = listFrom<T>(value, keys);
      if (nested.length > 0) return nested;
    }
  }
  return [];
}

function objectFrom<T>(payload: unknown, keys: string[]): T | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as UnknownRecord;
  let sawKnownKey = false;
  for (const key of keys) {
    if (key in record) sawKnownKey = true;
    const value = record[key];
    if (value && typeof value === "object") return value as T;
  }
  if (sawKnownKey) return null;
  return payload as T;
}

function moneyDecimal(row: UnknownRecord, decimalKeys: string[], minorKeys: string[]): number {
  for (const key of decimalKeys) {
    const value = row[key];
    if (value !== undefined && value !== null) return Number(value);
  }
  for (const key of minorKeys) {
    const value = row[key];
    if (value !== undefined && value !== null) return minorToDecimal(value as number | string);
  }
  return 0;
}

function ok(payload: unknown): { ok: boolean; reason?: string; [key: string]: unknown } {
  if (payload && typeof payload === "object") {
    const record = payload as UnknownRecord;
    return {
      ...record,
      ok: record.ok === undefined ? true : Boolean(record.ok),
      reason: record.reason ? String(record.reason) : undefined,
    };
  }
  return { ok: true };
}

function query(params: Record<string, string | number | undefined | null>): string {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") qs.set(key, String(value));
  });
  const rendered = qs.toString();
  return rendered ? `?${rendered}` : "";
}

function canTryFallback(error: unknown): boolean {
  return error instanceof GoBackendError && (error.status === 404 || error.status === 405);
}

async function getWithFallback<T>(primary: string, fallback: string): Promise<T> {
  try {
    return await goBackend.get<T>(primary);
  } catch (error) {
    if (!canTryFallback(error)) throw error;
    return goBackend.get<T>(fallback);
  }
}

async function postWithFallback<T>(primary: string, fallback: string, body?: unknown): Promise<T> {
  try {
    return await goBackend.post<T>(primary, body);
  } catch (error) {
    if (!canTryFallback(error)) throw error;
    return goBackend.post<T>(fallback, body);
  }
}

function normalizeWallet(row: UnknownRecord): WalletRecord {
  return {
    ...(row as unknown as WalletRecord),
    id: String(row.id ?? ""),
    user_id: String(row.user_id ?? row.driver_id ?? ""),
    balance: moneyDecimal(row, ["balance", "balance_usd"], ["balance_minor", "amount_minor"]),
    locked_reason: (row.locked_reason as string | null | undefined) ?? null,
    locked_at: (row.locked_at as string | null | undefined) ?? null,
    created_at: String(row.created_at ?? new Date().toISOString()),
    updated_at: String(row.updated_at ?? row.created_at ?? new Date().toISOString()),
  };
}

function normalizeTransaction(row: UnknownRecord): WalletTransaction {
  return {
    ...(row as unknown as WalletTransaction),
    id: String(row.id ?? ""),
    user_id: String(row.user_id ?? ""),
    wallet_id: String(row.wallet_id ?? ""),
    amount: moneyDecimal(row, ["amount"], ["amount_minor"]),
    transaction_type: String(row.transaction_type ?? row.type ?? "transaction"),
    description: (row.description as string | null | undefined) ?? null,
    ride_id: (row.ride_id as string | null | undefined) ?? null,
    reference_code: (row.reference_code as string | null | undefined) ?? null,
    created_at: String(row.created_at ?? new Date().toISOString()),
  };
}

function normalizeDeposit(row: UnknownRecord): DepositRecord {
  return {
    ...(row as unknown as DepositRecord),
    id: String(row.id ?? ""),
    user_id: row.user_id ? String(row.user_id) : undefined,
    driver_id: row.driver_id ? String(row.driver_id) : undefined,
    amount_usd: moneyDecimal(row, ["amount_usd", "amount"], ["amount_minor"]),
    payment_method: row.payment_method ? String(row.payment_method) : undefined,
    ecocash_phone: row.ecocash_phone ? String(row.ecocash_phone) : undefined,
    ecocash_reference: row.ecocash_reference ? String(row.ecocash_reference) : undefined,
    phone_number: row.phone_number ? String(row.phone_number) : undefined,
    reference: row.reference ? String(row.reference) : undefined,
    proof_path: (row.proof_path as string | null | undefined) ?? null,
    status: String(row.status ?? "pending"),
    created_at: String(row.created_at ?? new Date().toISOString()),
  };
}

function normalizeWithdrawal(row: UnknownRecord): WithdrawalRecord {
  return {
    ...(row as unknown as WithdrawalRecord),
    id: String(row.id ?? ""),
    driver_id: row.driver_id ? String(row.driver_id) : undefined,
    user_id: row.user_id ? String(row.user_id) : undefined,
    amount_usd: moneyDecimal(row, ["amount_usd", "amount"], ["amount_minor"]),
    method: String(row.method ?? "ecocash"),
    destination: String(row.destination ?? ""),
    account_name: (row.account_name as string | null | undefined) ?? null,
    status: String(row.status ?? "pending"),
    admin_note: (row.admin_note as string | null | undefined) ?? null,
    created_at: String(row.created_at ?? new Date().toISOString()),
    approved_at: (row.approved_at as string | null | undefined) ?? null,
  };
}

function normalizeEarning(row: UnknownRecord): EarningRecord {
  return {
    ...(row as unknown as EarningRecord),
    id: String(row.id ?? ""),
    ride_id: (row.ride_id as string | null | undefined) ?? null,
    driver_id: String(row.driver_id ?? ""),
    fare_amount: moneyDecimal(row, ["fare_amount", "fare"], ["fare_minor", "amount_minor"]),
    platform_fee: moneyDecimal(row, ["platform_fee"], ["platform_fee_minor"]),
    driver_earnings: moneyDecimal(row, ["driver_earnings", "earnings"], ["driver_earnings_minor"]),
    created_at: String(row.created_at ?? new Date().toISOString()),
  };
}

export async function getWalletMe(): Promise<WalletRecord | null> {
  const payload = await getWithFallback<unknown>("/api/wallets/me", "/api/wallet/me");
  const wallet = objectFrom<UnknownRecord>(payload, ["wallet", "data"]);
  return wallet ? normalizeWallet(wallet) : null;
}

export async function getWalletTransactions(limit = 50): Promise<WalletTransaction[]> {
  const params = query({ limit });
  const payload = await getWithFallback<unknown>(`/api/wallets/me/transactions${params}`, `/api/wallet/transactions${params}`);
  return listFrom<UnknownRecord>(payload, ["transactions", "items", "data"]).map(normalizeTransaction);
}

export async function listWalletDeposits(params: { type?: "rider" | "driver"; limit?: number } = {}): Promise<DepositRecord[]> {
  const qs = query(params);
  const payload = await getWithFallback<unknown>(`/api/wallets/deposits${qs}`, `/api/wallet/deposits${qs}`);
  return listFrom<UnknownRecord>(payload, ["deposits", "items", "data"]).map(normalizeDeposit);
}

export async function walletDeposit(input: {
  amount: number;
  wallet_type?: "rider" | "driver";
  payment_method?: string;
  phone_number?: string;
  ecocash_phone?: string;
  reference?: string;
  ecocash_reference?: string;
  proof_path?: string | null;
}) {
  return ok(await postWithFallback<unknown>("/api/wallets/deposits", "/api/wallet/deposit", {
    ...input,
    amount_minor: decimalToMinor(input.amount),
  }));
}

export async function walletWithdraw(input: {
  amount: number;
  method: "ecocash" | "bank" | "innbucks";
  destination: string;
  account_name?: string | null;
}) {
  return ok(await postWithFallback<unknown>("/api/wallets/withdrawals", "/api/wallet/withdraw", {
    ...input,
    amount_minor: decimalToMinor(input.amount),
  }));
}

export async function walletTransfer(input: { receiver_id: string; amount: number; note?: string | null }) {
  return ok(await postWithFallback<unknown>("/api/wallets/transfer", "/api/wallet/transfer", {
    ...input,
    amount_minor: decimalToMinor(input.amount),
  }));
}

export async function walletPayRide(rideId: string) {
  return ok(await postWithFallback<unknown>("/api/wallets/pay", "/api/wallet/pay", { ride_id: rideId }));
}

export async function lookupWalletUser(params: { phone?: string; account?: string }) {
  const qs = query(params);
  const payload = await getWithFallback<unknown>(`/api/wallets/lookup-user${qs}`, `/api/wallet/lookup-user${qs}`);
  return objectFrom<{ user_id: string; full_name: string | null; phone?: string | null; pickme_account?: string }>(payload, ["user", "profile", "data"]);
}

export async function getDriverWalletSummary() {
  const payload = await getWithFallback<unknown>("/api/wallets/driver/summary", "/api/wallet/driver/summary");
  const record = objectFrom<UnknownRecord>(payload, ["summary", "data"]) ?? {};
  return {
    balance: moneyDecimal(record, ["balance", "balance_usd"], ["balance_minor"]),
    deposits: listFrom<UnknownRecord>(record.deposits ?? payload, ["deposits"]).map(normalizeDeposit),
    earnings: listFrom<UnknownRecord>(record.earnings ?? payload, ["earnings", "admin_earnings"]).map(normalizeEarning),
    withdrawals: listFrom<UnknownRecord>(record.withdrawals ?? payload, ["withdrawals"]).map(normalizeWithdrawal),
  };
}

export async function getAdminEarnings(limit = 100): Promise<EarningRecord[]> {
  const payload = await goBackend.get<unknown>(`/admin/finance/earnings${query({ limit })}`);
  return listFrom<UnknownRecord>(payload, ["earnings", "items", "data"]).map(normalizeEarning);
}

export async function getDriverEarnings(period: "7d" | "30d" = "7d"): Promise<EarningRecord[]> {
  const qs = query({ period });
  const payload = await getWithFallback<unknown>(`/api/wallets/driver/earnings${qs}`, `/api/wallet/driver/earnings${qs}`);
  return listFrom<UnknownRecord>(payload, ["earnings", "items", "data"]).map(normalizeEarning);
}

export async function walletPin(action: string, pin?: string) {
  return postWithFallback<{ ok?: boolean; hasPin?: boolean; has_pin?: boolean; error?: string }>(
    "/api/wallets/pin",
    "/api/wallet/pin",
    { action, pin },
  );
}

export async function getAdminWalletDashboard(): Promise<AdminWalletDashboardData> {
  const payload = await goBackend.get<unknown>("/admin/finance/wallet-dashboard");
  const record = (objectFrom<UnknownRecord>(payload, ["dashboard", "data"]) ?? {}) as UnknownRecord;
  return {
    transactions: listFrom<UnknownRecord>(record.transactions ?? payload, ["transactions"]).map(normalizeTransaction),
    deposits: listFrom<UnknownRecord>(record.deposits ?? payload, ["deposits"]).map(normalizeDeposit),
    withdrawals: listFrom<UnknownRecord>(record.withdrawals ?? payload, ["withdrawals"]).map(normalizeWithdrawal),
    flags: listFrom<UnknownRecord>(record.flags ?? payload, ["flags", "fraud_flags"]),
    failed_rides: listFrom<UnknownRecord>(record.failed_rides ?? payload, ["failed_rides", "failed"]),
    locked_wallets: listFrom<UnknownRecord>(record.locked_wallets ?? payload, ["locked_wallets", "locked"]).map(normalizeWallet),
  };
}

export async function adminListDeposits(type: "driver" | "rider", status = "pending", limit = 50): Promise<DepositRecord[]> {
  const payload = await goBackend.get<unknown>(`/admin/wallets/deposits${query({ type, status, limit })}`);
  return listFrom<UnknownRecord>(payload, ["deposits", "items", "data"]).map(normalizeDeposit);
}

export async function adminApproveDeposit(id: string, note = "", type?: "driver" | "rider") {
  return ok(await goBackend.post<unknown>(`/admin/wallets/deposits/${id}/approve`, { note, type }));
}

export async function adminRejectDeposit(id: string, note = "", type?: "driver" | "rider") {
  return ok(await goBackend.post<unknown>(`/admin/wallets/deposits/${id}/reject`, { note, type }));
}

export async function adminListWithdrawals(status = "pending", limit = 100): Promise<WithdrawalRecord[]> {
  const payload = await goBackend.get<unknown>(`/admin/wallets/withdrawals${query({ status, limit })}`);
  return listFrom<UnknownRecord>(payload, ["withdrawals", "items", "data"]).map(normalizeWithdrawal);
}

export async function adminApproveWithdrawalGo(id: string, note = "") {
  return ok(await goBackend.post<unknown>(`/admin/wallets/withdrawals/${id}/approve`, { note }));
}

export async function adminRejectWithdrawalGo(id: string, note = "") {
  const response = ok(await goBackend.post<unknown>(`/admin/wallets/withdrawals/${id}/reject`, { note }));
  return {
    ...response,
    refunded: moneyDecimal(response, ["refunded"], ["refunded_minor"]),
  };
}

export async function adminFlagUser(userId: string, reason: string, severity: string) {
  return ok(await goBackend.post<unknown>("/admin/finance/fraud-flags", { user_id: userId, reason, severity }));
}

export async function adminResolveFraudFlag(id: string) {
  return ok(await goBackend.post<unknown>(`/admin/finance/fraud-flags/${id}/resolve`));
}

export async function adminLockWallet(userId: string, reason: string) {
  return ok(await goBackend.post<unknown>(`/admin/wallets/users/${userId}/lock`, { reason }));
}

export async function adminUnlockWallet(userId: string) {
  return ok(await goBackend.post<unknown>(`/admin/wallets/users/${userId}/unlock`));
}

export async function adminReverseTransaction(txId: string, reason: string) {
  return ok(await goBackend.post<unknown>(`/admin/wallets/transactions/${txId}/reverse`, { reason }));
}

export async function adminSetFxRate(zarPerUsd: number) {
  return ok(await goBackend.post<unknown>("/admin/finance/fx-rate", { zar_per_usd: zarPerUsd }));
}

export async function getRideSettlement(tripId: string) {
  return objectFrom<{ status: string; created_at: string }>(
    await goBackend.get<unknown>(`/api/rides/${tripId}/settlement`),
    ["settlement", "data"],
  );
}

export async function settleRideThroughGo(tripId: string) {
  return ok(await goBackend.post<unknown>(`/api/rides/${tripId}/settle`));
}

export async function adminListLedger(dateFilter = "all"): Promise<LedgerRow[]> {
  const payload = await goBackend.get<unknown>(`/admin/finance/ledger${query({ date_filter: dateFilter, limit: 200 })}`);
  return listFrom<UnknownRecord>(payload, ["ledger", "rows", "items", "data"]).map((row) => ({
    ...(row as unknown as LedgerRow),
    amount: moneyDecimal(row, ["amount"], ["amount_minor"]),
  }));
}

export async function getSettlementMetrics() {
  return objectFrom<{ totalSettlements: number; totalAmount: number; lastSettlementDate: string | null }>(
    await goBackend.get<unknown>("/admin/finance/settlements/summary"),
    ["summary", "data"],
  ) ?? { totalSettlements: 0, totalAmount: 0, lastSettlementDate: null };
}

export async function getAdminFinanceHealth() {
  const data = objectFrom<UnknownRecord>(
    await goBackend.get<unknown>("/admin/finance/health"),
    ["health", "data"],
  ) ?? {};
  return {
    low_balance_drivers: Number(data.low_balance_drivers ?? 0),
    pending_driver_deposits_over_2h: Number(data.pending_driver_deposits_over_2h ?? 0),
    pending_rider_deposits_over_2h: Number(data.pending_rider_deposits_over_2h ?? 0),
  };
}

export async function adminSendLowBalanceReminders() {
  return ok(await goBackend.post<unknown>("/admin/finance/low-balance-reminders"));
}
