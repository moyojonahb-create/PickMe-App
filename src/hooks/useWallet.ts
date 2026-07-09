import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/hooks/useAuth';

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
      
      // Try to fetch existing wallet
      const { data: initialWalletData, error: walletError } = await supabase
        .from('wallets')
        .select('id, user_id, balance, is_locked, locked_reason, created_at, updated_at')
        .eq('user_id', user.id)
        .maybeSingle();
      let walletData = initialWalletData;

      // If no wallet exists, create one
      if (!walletData && !walletError) {
        const { data: newWallet, error: createError } = await supabase
          .from('wallets')
          .insert({ user_id: user.id, balance: 0 })
          .select('id, user_id, balance, is_locked, locked_reason, created_at, updated_at')
          .maybeSingle();

        if (createError) throw createError;
        walletData = newWallet;
      } else if (walletError) {
        throw walletError;
      }

      setWallet(walletData);

      // Fetch transactions
      if (walletData) {
        const { data: txData, error: txError } = await supabase
          .from('wallet_transactions')
          .select('*')
          .eq('wallet_id', walletData.id)
          .order('created_at', { ascending: false })
          .limit(50);

        if (txError) throw txError;
        setTransactions(txData || []);
      }
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [user]);


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
      
      const { data, error: fetchError } = await supabase
        .from('admin_earnings')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);

      if (fetchError) throw fetchError;

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
