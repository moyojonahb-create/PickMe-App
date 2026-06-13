import { supabase } from "@/integrations/supabase/client";
import {
  walletPayRide,
  walletTransfer,
  walletRequestWithdrawal,
  walletLookupByPickmeAccount,
} from "@/lib/backendClient";

/**
 * Wallet Phase B: all wallet business logic is owned by the Go backend.
 * Supabase remains the system-of-record for persistence and auth, but the
 * frontend no longer invokes Supabase RPCs directly for wallet operations.
 *
 * Admin approve/reject withdrawal helpers continue to call admin RPCs for
 * now — those are scheduled to move behind /api/admin/* in a later phase.
 */

export async function payRideFromWallet(rideId: string) {
  return walletPayRide(rideId);
}

export async function transferFunds(receiverId: string, amount: number, note?: string) {
  return walletTransfer(receiverId, amount, note);
}

export async function requestWithdrawal(
  amount: number,
  method: "ecocash" | "bank" | "innbucks",
  destination: string,
  accountName?: string
) {
  return walletRequestWithdrawal(amount, method, destination, accountName);
}

export async function adminApproveWithdrawal(id: string, note = "") {
  const { data, error } = await supabase.rpc("admin_approve_withdrawal", { p_id: id, p_note: note });
  if (error) throw error;
  return data as { ok: boolean; reason?: string };
}

export async function adminRejectWithdrawal(id: string, note = "") {
  const { data, error } = await supabase.rpc("admin_reject_withdrawal", { p_id: id, p_note: note });
  if (error) throw error;
  return data as { ok: boolean; reason?: string; refunded?: number };
}

/** Look up a user by phone for transfers. Persistence read — stays on Supabase. */
export async function lookupUserByPhone(phone: string) {
  const cleaned = phone.replace(/\s+/g, "");
  const { data } = await supabase
    .from("profiles")
    .select("user_id, full_name, phone")
    .eq("phone", cleaned)
    .maybeSingle();
  return data as { user_id: string; full_name: string | null; phone: string | null } | null;
}

/** Look up a user by PickMe Account — routed through Go for rate-limiting/audit. */
export async function lookupUserByPickmeAccount(account: string) {
  try {
    return await walletLookupByPickmeAccount(account);
  } catch {
    return null;
  }
}
