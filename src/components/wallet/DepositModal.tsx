import { useState, useRef, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Plus, Minus, X, Upload, Phone, CheckCircle, Copy, Check } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { walletDeposit } from '@/lib/walletApi';
import ecocashLogo from '@/assets/payment-ecocash.png';
import innbucksLogo from '@/assets/payment-innbucks.png';
import cardLogo from '@/assets/payment-card.png';

interface DepositModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentBalance: number;
}


const PAYMENT_METHODS = [
  { id: 'ecocash', name: 'EcoCash', color: 'bg-green-500', merchant: '+263 778 553 169', logo: ecocashLogo, featured: true },
  { id: 'innbucks', name: 'InnBucks', color: 'bg-orange-500', merchant: '077 000 0000', logo: innbucksLogo, featured: true },
  { id: 'card', name: 'Visa / Mastercard', color: 'bg-blue-700', merchant: 'Card payment (coming soon)', logo: cardLogo, featured: true },
  { id: 'onemoney', name: 'OneMoney', color: 'bg-purple-500', merchant: '+263 712 000 000', logo: null, featured: false },
  { id: 'telecash', name: 'Telecash', color: 'bg-blue-500', merchant: '+263 733 000 000', logo: null, featured: false },
  { id: 'zimswitch', name: 'ZimSwitch', color: 'bg-red-500', merchant: 'Acc: 1234567890', logo: null, featured: false },
  { id: 'mukuru', name: 'Mukuru', color: 'bg-yellow-600', merchant: 'Agent: PickMe Ride', logo: null, featured: false },
  { id: 'bank_transfer', name: 'Bank Transfer', color: 'bg-slate-600', merchant: 'FNB: 62xxxxxxx', logo: null, featured: false },
] as const;


// Generate cryptographically-random unique payment code: PM-XXXXXXXX (8 chars, no 0/O/1/I)
function generatePaymentCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  let code = '';
  for (let i = 0; i < 8; i++) code += alphabet[bytes[i] % alphabet.length];
  return `PM-${code}`;
}

export default function DepositModal({ isOpen, onClose, currentBalance }: DepositModalProps) {
  const { user } = useAuth();
  const [step, setStep] = useState<'method' | 'details' | 'done'>('method');
  const [selectedMethod, setSelectedMethod] = useState('');
  const [amount, setAmount] = useState(5);
  const [phone, setPhone] = useState('');
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedMerchant, setCopiedMerchant] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // System-generated unique payment code, regenerated each time modal/method changes
  const paymentCode = useMemo(
    () => (isOpen && selectedMethod ? generatePaymentCode() : ''),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isOpen, selectedMethod]
  );

  if (!isOpen) return null;

  const quickAmounts = [1, 2, 5, 10, 20];
  const method = PAYMENT_METHODS.find((m) => m.id === selectedMethod);

  const resetForm = () => {
    setStep('method');
    setSelectedMethod('');
    setAmount(5);
    setPhone('');
    setProofFile(null);
    setCopiedCode(false);
    setCopiedMerchant(false);
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const copy = async (text: string, which: 'code' | 'merchant') => {
    try {
      await navigator.clipboard.writeText(text);
      if (which === 'code') { setCopiedCode(true); setTimeout(() => setCopiedCode(false), 1500); }
      else { setCopiedMerchant(true); setTimeout(() => setCopiedMerchant(false), 1500); }
      toast.success('Copied to clipboard');
    } catch {
      toast.error('Could not copy — long-press to select');
    }
  };

  const handleSubmit = async () => {
    if (!user || !method) return;
    if (!phone.trim() || phone.trim().length < 9) { toast.error('Enter a valid phone number'); return; }
    if (amount <= 0 || amount > 5000) { toast.error('Amount must be between $1 and $5000'); return; }
    if (!paymentCode) { toast.error('Payment code not generated, try again'); return; }

    setLoading(true);
    try {
      let proofPath: string | null = null;

      if (proofFile) {
        if (proofFile.size > 5 * 1024 * 1024) throw new Error('Screenshot must be under 5MB');
        const ext = proofFile.name.split('.').pop();
        const path = `${user.id}/${Date.now()}.${ext}`;
        const { error: uploadErr } = await supabase.storage
          .from('rider-deposit-proofs')
          .upload(path, proofFile);
        if (uploadErr) throw uploadErr;
        proofPath = path;
      }

      const res = await walletDeposit({
        amount,
        wallet_type: 'rider',
        payment_method: selectedMethod,
        phone_number: phone.trim(),
        reference: paymentCode,
        proof_path: proofPath,
      });
      if (!res?.ok) throw new Error(res?.reason || 'Failed to submit deposit');

      setStep('done');
    } catch (e: unknown) {
      toast.error('Failed to submit', { description: (e as Error).message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50">
      <div className="w-full max-w-md bg-background rounded-t-2xl sm:rounded-2xl p-5 space-y-4 animate-in slide-in-from-bottom max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">
            {step === 'method' ? 'Top Up Wallet' : step === 'details' ? method?.name : 'Request Sent!'}
          </h2>
          <Button variant="ghost" size="icon" onClick={handleClose}>
            <X className="h-5 w-5" />
          </Button>
        </div>

        {/* Balance */}
        <div className="bg-primary/10 rounded-xl p-3 text-center">
          <p className="text-xs text-muted-foreground">Current Balance</p>
          <p className="text-xl font-black text-primary">${currentBalance.toFixed(2)}</p>
        </div>

        {/* Step 1: Select Payment Method */}
        {step === 'method' && (
          <div className="space-y-3">
            <p className="text-sm font-medium text-muted-foreground">Choose how you want to top up</p>

            {/* Featured: EcoCash, InnBucks, Visa/MC with logos */}
            <div className="grid grid-cols-3 gap-2">
              {PAYMENT_METHODS.filter((m) => m.featured).map((m) => (
                <button
                  key={m.id}
                  onClick={() => {
                    if (m.id === 'card') {
                      toast.info('Card payments coming soon. Pick another method for now.');
                      return;
                    }
                    setSelectedMethod(m.id);
                    setStep('details');
                  }}
                  className="flex flex-col items-center gap-2 p-3 rounded-2xl border-2 hover:border-primary bg-card transition-all active:scale-95 min-h-[110px]"
                >
                  {m.logo && (
                    <img
                      src={m.logo}
                      alt={`${m.name} logo`}
                      width={48}
                      height={48}
                      loading="lazy"
                      className="h-12 w-12 object-contain"
                    />
                  )}
                  <span className="text-[11px] font-bold text-center leading-tight">{m.name}</span>
                </button>
              ))}
            </div>

            {/* Other methods */}
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground pt-2">Other options</p>
            <div className="grid grid-cols-2 gap-2">
              {PAYMENT_METHODS.filter((m) => !m.featured).map((m) => (
                <button
                  key={m.id}
                  onClick={() => { setSelectedMethod(m.id); setStep('details'); }}
                  className="flex items-center gap-2 p-3 rounded-xl border hover:border-primary transition-colors text-left"
                >
                  <div className={`w-8 h-8 rounded-full ${m.color} flex items-center justify-center text-white text-xs font-bold shrink-0`}>
                    {m.name[0]}
                  </div>
                  <span className="text-sm font-medium truncate">{m.name}</span>
                </button>
              ))}
            </div>
          </div>
        )}


        {/* Step 2: Enter Details */}
        {step === 'details' && method && (
          <div className="space-y-4">
            {/* Amount FIRST so the code reflects intent */}
            <div className="space-y-2">
              <p className="text-sm font-medium text-muted-foreground">Amount (USD)</p>
              <div className="flex items-center justify-center gap-3">
                <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setAmount((a) => Math.max(1, a - 1))} disabled={amount <= 1}>
                  <Minus className="h-3 w-3" />
                </Button>
                <span className="text-3xl font-black min-w-[80px] text-center">${amount}</span>
                <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setAmount((a) => a + 1)}>
                  <Plus className="h-3 w-3" />
                </Button>
              </div>
              <div className="flex flex-wrap gap-1.5 justify-center">
                {quickAmounts.map((qa) => (
                  <Button key={qa} variant={amount === qa ? 'default' : 'outline'} size="sm" onClick={() => setAmount(qa)} className="min-w-[48px] h-7 text-xs">
                    ${qa}
                  </Button>
                ))}
              </div>
            </div>

            {/* Payment Instructions with merchant + UNIQUE PAYMENT CODE */}
            <div className="bg-accent/50 rounded-xl p-3 space-y-3 border-2 border-primary/30">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground mb-1">Step 1 — Send ${amount} to</p>
                <button
                  onClick={() => copy(method.merchant, 'merchant')}
                  className="w-full flex items-center justify-between gap-2 bg-background rounded-lg p-2.5 hover:border-primary border-2 border-transparent transition-colors"
                >
                  <span className="text-sm font-mono font-bold truncate">{method.merchant}</span>
                  {copiedMerchant ? <Check className="h-4 w-4 text-green-600 shrink-0" /> : <Copy className="h-4 w-4 text-muted-foreground shrink-0" />}
                </button>
              </div>

              <div>
                <p className="text-[10px] font-bold uppercase tracking-wide text-primary mb-1">Step 2 — Use this Payment Code as the reference</p>
                <button
                  onClick={() => copy(paymentCode, 'code')}
                  className="w-full flex items-center justify-between gap-2 bg-primary/10 rounded-lg p-3 border-2 border-primary hover:bg-primary/15 transition-colors"
                  aria-label={`Copy payment code ${paymentCode}`}
                >
                  <span className="text-lg font-mono font-black tracking-widest text-primary">{paymentCode}</span>
                  {copiedCode ? <Check className="h-5 w-5 text-green-600 shrink-0" /> : <Copy className="h-5 w-5 text-primary shrink-0" />}
                </button>
                <p className="text-[10px] text-muted-foreground mt-1.5 leading-snug">
                  Paste this code in the EcoCash/InnBucks message field. Admin uses it to verify and credit your wallet.
                </p>
              </div>
            </div>

            {/* Phone */}
            <div className="space-y-1">
              <label className="text-sm font-medium text-muted-foreground flex items-center gap-1">
                <Phone className="h-3 w-3" /> Phone Number you paid from
              </label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="e.g. 0771234567" maxLength={15} />
            </div>

            {/* Proof Upload (optional) */}
            <div className="space-y-1">
              <label className="text-sm font-medium text-muted-foreground flex items-center gap-1">
                <Upload className="h-3 w-3" /> Payment Screenshot (optional)
              </label>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => setProofFile(e.target.files?.[0] ?? null)}
              />
              <Button
                variant="outline"
                className="w-full justify-start text-sm"
                onClick={() => fileRef.current?.click()}
              >
                {proofFile ? proofFile.name : 'Tap to upload screenshot'}
              </Button>
            </div>

            {/* Actions */}
            <div className="flex gap-2 pt-1">
              <Button variant="outline" className="flex-1" onClick={() => { setStep('method'); setSelectedMethod(''); }}>
                Back
              </Button>
              <Button className="flex-1" onClick={handleSubmit} disabled={loading}>
                {loading ? 'Submitting...' : 'I have paid'}
              </Button>
            </div>
          </div>
        )}

        {/* Step 3: Success */}
        {step === 'done' && (
          <div className="text-center space-y-4 py-4">
            <CheckCircle className="h-16 w-16 text-green-500 mx-auto" />
            <div>
              <p className="text-lg font-bold">Deposit Request Sent!</p>
              <p className="text-sm text-muted-foreground mt-1">
                Your <span className="font-mono font-bold">{paymentCode}</span> deposit of ${amount} via {method?.name} is pending admin verification.
              </p>
              <p className="text-xs text-muted-foreground mt-2">
                Track its status on your Wallet screen.
              </p>
            </div>
            <Button className="w-full" onClick={handleClose}>Done</Button>
          </div>
        )}
      </div>
    </div>
  );
}
