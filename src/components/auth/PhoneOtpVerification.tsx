/* eslint-disable react-hooks/exhaustive-deps */
import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp';
import { Loader2, CheckCircle2, RefreshCw } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface PhoneOtpVerificationProps {
  phone: string;
  onVerified: () => void;
  onBack: () => void;
}

const PhoneOtpVerification = ({ phone, onVerified, onBack }: PhoneOtpVerificationProps) => {
  const [otp, setOtp] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isVerified, setIsVerified] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const { toast } = useToast();

  useEffect(() => {
    // Send OTP on mount
    sendOtp();
  }, []);

  useEffect(() => {
    if (countdown > 0) {
      const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [countdown]);

  const sendOtp = async () => {
    if (countdown > 0) return;
    
    setIsSending(true);
    try {
      const { data, error } = await supabase.functions.invoke('omniflex-otp', {
        body: { action: 'send', phone }
      });

      if (error) throw error;
      if (!data.success) throw new Error(data.error || 'Failed to send OTP');

      toast({
        title: 'Code sent!',
        description: `A verification code has been sent to ${phone}`,
      });
      setCountdown(60); // 60 second cooldown
    } catch (err: unknown) {
      console.error('Error sending OTP:', err);
      const message = err instanceof Error ? err.message : 'Please try again';
      toast({
        title: 'Failed to send code',
        description: message,
        variant: 'destructive',
      });
    } finally {
      setIsSending(false);
    }
  };

  const verifyOtp = async () => {
    if (otp.length !== 6) {
      toast({
        title: 'Invalid code',
        description: 'Please enter the 6-digit code',
        variant: 'destructive',
      });
      return;
    }

    setIsVerifying(true);
    try {
      const { data, error } = await supabase.functions.invoke('omniflex-otp', {
        body: { action: 'verify', phone, code: otp }
      });

      if (error) throw error;
      
      if (!data.success) {
        toast({
          title: 'Verification failed',
          description: data.message || 'Invalid code',
          variant: 'destructive',
        });
        setOtp('');
        return;
      }

      setIsVerified(true);
      toast({
        title: 'Phone verified!',
        description: 'Your phone number has been verified.',
      });
      
      // Brief delay to show success state
      setTimeout(() => {
        onVerified();
      }, 1000);
    } catch (err: unknown) {
      console.error('Error verifying OTP:', err);
      const message = err instanceof Error ? err.message : 'Please try again';
      toast({
        title: 'Verification failed',
        description: message,
        variant: 'destructive',
      });
      setOtp('');
    } finally {
      setIsVerifying(false);
    }
  };

  if (isVerified) {
    return (
      <div className="flex flex-col items-center justify-center py-8 space-y-4">
        <div className="w-16 h-16 rounded-full bg-accent/20 flex items-center justify-center">
          <CheckCircle2 className="h-10 w-10 text-accent" />
        </div>
        <p className="text-lg font-semibold text-foreground">Phone Verified!</p>
        <p className="text-sm text-muted-foreground">Completing registration...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="text-center space-y-2">
        <h2 className="text-xl font-bold text-foreground">Verify your phone</h2>
        <p className="text-sm text-muted-foreground">
          We sent a 6-digit code to <span className="font-medium">{phone}</span>
        </p>
      </div>

      <div className="flex justify-center">
        <InputOTP
          maxLength={6}
          value={otp}
          onChange={setOtp}
          disabled={isVerifying}
        >
          <InputOTPGroup>
            <InputOTPSlot index={0} className="w-12 h-14 text-xl" />
            <InputOTPSlot index={1} className="w-12 h-14 text-xl" />
            <InputOTPSlot index={2} className="w-12 h-14 text-xl" />
            <InputOTPSlot index={3} className="w-12 h-14 text-xl" />
            <InputOTPSlot index={4} className="w-12 h-14 text-xl" />
            <InputOTPSlot index={5} className="w-12 h-14 text-xl" />
          </InputOTPGroup>
        </InputOTP>
      </div>

      <Button
        onClick={verifyOtp}
        disabled={otp.length !== 6 || isVerifying}
        className="w-full h-[52px] rounded-2xl bg-foreground hover:bg-foreground/90 text-white font-black text-base"
      >
        {isVerifying ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
            Verifying...
          </>
        ) : (
          'Verify Code'
        )}
      </Button>

      <div className="flex items-center justify-between">
        <Button
          variant="ghost"
          onClick={onBack}
          disabled={isVerifying}
          className="text-muted-foreground"
        >
          Change number
        </Button>

        <Button
          variant="ghost"
          onClick={sendOtp}
          disabled={countdown > 0 || isSending}
          className="text-accent"
        >
          {isSending ? (
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
          ) : (
            <RefreshCw className="h-4 w-4 mr-2" />
          )}
          {countdown > 0 ? `Resend in ${countdown}s` : 'Resend code'}
        </Button>
      </div>
    </div>
  );
};

export default PhoneOtpVerification;
