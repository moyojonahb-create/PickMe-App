import { useState, useEffect, useCallback } from 'react';
import { MessageSquare, Send, AlertTriangle } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import { createDriverFeedback } from '@/lib/businessApi';

interface FeedbackItem {
  id: string;
  type: string;
  message: string;
  status: string;
  admin_response: string | null;
  created_at: string;
}

export default function DriverFeedback() {
  const { user } = useAuth();
  const [tab, setTab] = useState<'suggestion' | 'complaint'>('suggestion');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [items, setItems] = useState<FeedbackItem[]>([]);

  const fetchFeedback = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from('driver_feedback')
      .select('*')
      .eq('driver_id', user.id)
      .order('created_at', { ascending: false });
    setItems(data || []);
  }, [user]);

  useEffect(() => {
    fetchFeedback();
  }, [fetchFeedback]);

  const handleSubmit = async () => {
    if (!user || !message.trim()) return;
    setSubmitting(true);
    try {
      await createDriverFeedback({
        type: tab,
        message: message.trim(),
      });
      toast.success(`${tab === 'suggestion' ? 'Suggestion' : 'Complaint'} submitted`);
      setMessage('');
      fetchFeedback();
    } catch (error) {
      toast.error('Failed to submit', { description: error instanceof Error ? error.message : 'Unknown error' });
    }
    setSubmitting(false);
  };

  return (
    <Card>
      <CardContent className="pt-4 space-y-4">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-5 w-5 text-primary" />
          <p className="font-semibold">Suggestions & Complaints</p>
        </div>

        <Tabs value={tab} onValueChange={(v) => setTab(v as 'suggestion' | 'complaint')}>
          <TabsList className="w-full">
            <TabsTrigger value="suggestion" className="flex-1">Suggestion</TabsTrigger>
            <TabsTrigger value="complaint" className="flex-1">Complaint</TabsTrigger>
          </TabsList>

          <TabsContent value="suggestion" className="space-y-3 mt-3">
            <Textarea
              placeholder="Share your suggestion to improve the platform..."
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={3}
            />
          </TabsContent>
          <TabsContent value="complaint" className="space-y-3 mt-3">
            <Textarea
              placeholder="Describe your complaint..."
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={3}
            />
          </TabsContent>
        </Tabs>

        <Button onClick={handleSubmit} disabled={submitting || !message.trim()} className="w-full" size="sm">
          <Send className="h-4 w-4 mr-2" />
          {submitting ? 'Submitting...' : 'Submit'}
        </Button>

        {items.length > 0 && (
          <div className="space-y-2 pt-2 border-t border-border">
            <p className="text-xs font-semibold text-muted-foreground">Your submissions</p>
            {items.map((item) => (
              <div key={item.id} className="p-3 bg-muted/50 rounded-lg text-sm space-y-1">
                <div className="flex items-center justify-between">
                  <Badge variant="outline" className="text-xs">
                    {item.type === 'complaint' ? <AlertTriangle className="h-3 w-3 mr-1" /> : null}
                    {item.type}
                  </Badge>
                  <Badge variant={item.status === 'resolved' ? 'default' : 'secondary'} className="text-xs">
                    {item.status}
                  </Badge>
                </div>
                <p className="text-muted-foreground">{item.message}</p>
                {item.admin_response && (
                  <p className="text-xs text-primary mt-1">Admin: {item.admin_response}</p>
                )}
                <p className="text-xs text-muted-foreground">{new Date(item.created_at).toLocaleDateString()}</p>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
