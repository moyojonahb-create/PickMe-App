import {
  adminApproveWithdrawalGo,
  adminRejectWithdrawalGo,
  lookupWalletUser,
  walletPayRide,
  walletTransfer,
  walletWithdraw,
} from "@/lib/walletApi";

export async function payRideFromWallet(rideId: string) {
  return walletPayRide(rideId) as Promise<{ ok: boolean; reason?: string; amount?: number; already_paid?: boolean }>;
}

export async function transferFunds(receiverId: string, amount: number, note?: string) {
  return walletTransfer({ receiver_id: receiverId, amount, note: note ?? null }) as Promise<{
    ok: boolean;
    reason?: string;
    amount?: number;
  }>;
}

export async function requestWithdrawal(
  amount: number,
  method: "ecocash" | "bank" | "innbucks",
  destination: string,
  accountName?: string
) {
  return walletWithdraw({
    amount,
    method,
    destination,
    account_name: accountName ?? null,
  }) as Promise<{ ok: boolean; reason?: string; id?: string }>;
}

export async function adminApproveWithdrawal(id: string, note = "") {
  return adminApproveWithdrawalGo(id, note) as Promise<{ ok: boolean; reason?: string }>;
}

export async function adminRejectWithdrawal(id: string, note = "") {
  return adminRejectWithdrawalGo(id, note) as Promise<{ ok: boolean; reason?: string; refunded?: number }>;
}

/** Look up a user by phone for transfers through the Go wallet boundary. */
export async function lookupUserByPhone(phone: string) {
  const cleaned = phone.replace(/\s+/g, "");
  return lookupWalletUser({ phone: cleaned }) as Promise<{
    user_id: string;
    full_name: string | null;
    phone: string | null;
  } | null>;
}

/** Look up a user by their PickMe Account number (PMR######R) for wallet-to-wallet transfers. */
export async function lookupUserByPickmeAccount(account: string) {
  const cleaned = account.trim().toUpperCase();
  return lookupWalletUser({ account: cleaned }) as Promise<{
    user_id: string;
    full_name: string | null;
    pickme_account: string;
  } | null>;
}
