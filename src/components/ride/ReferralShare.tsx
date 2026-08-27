import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Gift, Copy, Check, Users, Loader2 } from "lucide-react";
import { toast } from "sonner";

export default function ReferralShare() {
  const { user } = useAuth();
  const [referralCode, setReferralCode] = useState<string | null>(null);
  const [referralCount, setReferralCount] = useState(0);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data: profile } = await supabase
        .from("profiles")
        .select("referral_code")
        .eq("user_id", user.id)
        .maybeSingle();

      if (profile?.referral_code) {
        setReferralCode(profile.referral_code);
      }

      const { count } = await supabase
        .from("referrals")
        .select("*", { count: "exact", head: true })
        .eq("referrer_id", user.id);

      setReferralCount(count || 0);
      setLoading(false);
    })();
  }, [user]);

  const handleCopy = async () => {
    if (!referralCode) return;
    const shareText = `Join CruiXe and get $5 off your first ride! Use my code: ${referralCode}`;
    
    if (navigator.share) {
      try {
        await navigator.share({ title: "Join CruiXe", text: shareText });
        return;
      } catch { /* fallback to clipboard */ }
    }

    await navigator.clipboard.writeText(referralCode);
    setCopied(true);
    toast.success("Referral code copied!");
    setTimeout(() => setCopied(false), 2000);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-4">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!referralCode) return null;

  return (
    <div className="bg-gradient-to-r from-primary/10 to-accent/10 rounded-2xl p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Gift className="h-5 w-5 text-primary" />
        <h3 className="font-bold text-foreground">Invite friends, earn $2</h3>
      </div>
      <p className="text-sm text-muted-foreground">
        Share your code. You earn $2 per referral — credited to your wallet!
      </p>
      <div className="flex items-center gap-2">
        <div className="flex-1 bg-background rounded-xl px-4 py-3 font-mono font-bold text-lg text-center tracking-widest border border-border">
          {referralCode}
        </div>
        <Button onClick={handleCopy} variant="outline" size="icon" className="h-12 w-12">
          {copied ? <Check className="h-5 w-5 text-accent" /> : <Copy className="h-5 w-5" />}
        </Button>
      </div>
      {referralCount > 0 && (
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <Users className="h-3 w-3" />
          <span>{referralCount} friend{referralCount !== 1 ? "s" : ""} referred</span>
        </div>
      )}
    </div>
  );
}
