import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/hooks/useAuth';
import {
  getAdminEarnings,
  getWalletMe,
  getWalletTransactions,
} from '@/lib/walletApi';

interface Wallet {
  id: string;
  user_id: string;
  balance: number;
  created_at: string;
  updated_at: string;
}

interface WalletTransaction {
  id: string;
  wallet_id: string;
  user_id: string;
  amount: number | string;
  transaction_type: string;
  description: string | null;
  ride_id: string | null;
  created_at: string;
}

interface AdminEarning {
  id: string;
  ride_id: string | null;
  driver_id: string;
  fare_amount: number;
  platform_fee: number;
  driver_earnings: number;
  created_at: string;
}

export const useWallet = () => {
  const { user } = useAuth();
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchWallet = useCallback(async () => {
    if (!user) {
      setLoading(false);
      return;
    }

    try {
      setError(null);
      
      const walletData = await getWalletMe();
      setWallet(walletData);

      if (walletData) {
        const txData = await getWalletTransactions(50);
        setTransactions(txData || []);
      }
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
    // Keyed on user?.id, not the user object: useAuth's onAuthStateChange
    // fires more than once during startup (listener + the explicit
    // getSession() check both set state), each handing back a new-but-
    // equivalent session/user object. Depending on the object identity
    // reruns this — and its network calls — on every one of those, even
    // though the signed-in user hasn't actually changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  useEffect(() => {
    fetchWallet();
  }, [fetchWallet]);

  return {
    wallet,
    transactions,
    loading,
    error,
    refresh: fetchWallet,
    balance: wallet ? Number(wallet.balance) : 0,
  };
};

export const useAdminEarnings = () => {
  const [earnings, setEarnings] = useState<AdminEarning[]>([]);
  const [totalEarnings, setTotalEarnings] = useState(0);
  const [totalPlatformFees, setTotalPlatformFees] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchEarnings = useCallback(async () => {
    try {
      setError(null);
      
      const data = await getAdminEarnings(100);
      setEarnings(data || []);
      
      // Calculate totals
      const totals = (data || []).reduce(
        (acc, e) => ({
          total: acc.total + Number(e.fare_amount),
          fees: acc.fees + Number(e.platform_fee),
        }),
        { total: 0, fees: 0 }
      );
      
      setTotalEarnings(totals.total);
      setTotalPlatformFees(totals.fees);
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchEarnings();
  }, [fetchEarnings]);

  return {
    earnings,
    totalEarnings,
    totalPlatformFees,
    loading,
    error,
    refresh: fetchEarnings,
  };
};
