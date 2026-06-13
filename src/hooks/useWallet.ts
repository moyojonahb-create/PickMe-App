import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/hooks/useAuth';
import {
  getAdminEarnings,
  getWalletMe,
  getWalletTransactions,
  walletDeposit,
  walletWithdraw,
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
  }, [user]);

  const deposit = async (amount: number, description?: string) => {
    if (!wallet || !user || amount <= 0) return { error: 'Invalid deposit' };

    try {
      await walletDeposit({ amount, payment_method: 'manual', reference: description });
      await fetchWallet();
      return { error: null };
    } catch (e: unknown) {
      return { error: (e as Error).message };
    }
  };

  const withdraw = async (amount: number, description?: string) => {
    if (!wallet || !user || amount <= 0) return { error: 'Invalid withdrawal' };
    if (Number(wallet.balance) < amount) return { error: 'Insufficient balance' };

    try {
      await walletWithdraw({ amount, method: 'ecocash', destination: description || 'Wallet withdrawal' });
      await fetchWallet();
      return { error: null };
    } catch (e: unknown) {
      return { error: (e as Error).message };
    }
  };

  useEffect(() => {
    fetchWallet();
  }, [fetchWallet]);

  return {
    wallet,
    transactions,
    loading,
    error,
    deposit,
    withdraw,
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
