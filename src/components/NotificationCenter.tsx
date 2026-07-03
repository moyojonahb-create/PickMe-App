/* eslint-disable react-hooks/exhaustive-deps */
import { useState, useEffect } from 'react';
import { Bell, X, Check, Car, DollarSign, AlertTriangle, Star, Gift, MapPin, CheckCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { showLocalNotification } from '@/lib/push';

interface Notification {
  id: string;
  title: string;
  body: string;
  notification_type: string;
  is_read: boolean;
  created_at: string;
}

const typeIcons: Record<string, typeof Bell> = {
  ride: Car,
  ride_request: Car,
  ride_accepted: CheckCircle,
  ride_completed: CheckCircle,
  ride_cancelled: X,
  driver_arrived: MapPin,
  new_offer: DollarSign,
  deposit_approved: DollarSign,
  payment: DollarSign,
  alert: AlertTriangle,
  rating: Star,
  promo: Gift,
};

export function NotificationBell() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(false);

  const unreadCount = notifications.filter(n => !n.is_read).length;

  useEffect(() => {
    if (!user) return;
    loadNotifications();

    const channel = supabase
      .channel('user-notifications')
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'notifications',
        filter: `user_id=eq.${user.id}`,
      }, (payload) => {
        const notif = payload.new as Notification;
        setNotifications(prev => [notif, ...prev]);
        // Show browser notification for new items
        showLocalNotification(notif.title, notif.body);
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [user]);

  const loadNotifications = async () => {
    if (!user) return;
    setLoading(true);
    const { data } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(50);
    setNotifications((data as Notification[]) || []);
    setLoading(false);
  };

  const markAsRead = async (id: string) => {
    await supabase.from('notifications').update({ is_read: true, read_at: new Date().toISOString() }).eq('id', id);
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n));
  };

  const markAllRead = async () => {
    if (!user) return;
    const unreadIds = notifications.filter(n => !n.is_read).map(n => n.id);
    if (unreadIds.length === 0) return;
    await supabase.from('notifications').update({ is_read: true, read_at: new Date().toISOString() }).in('id', unreadIds);
    setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
  };

  return (
    <>
      <motion.button
        whileTap={{ scale: 0.9 }}
        onClick={() => setOpen(true)}
        className="relative w-11 h-11 flex items-center justify-center rounded-full glass-card-heavy hover:shadow-[0_8px_20px_-8px_hsl(224_71%_37%/0.35)] transition-shadow"
        aria-label="Notifications"
      >
        <Bell className="w-5 h-5 text-foreground" strokeWidth={2.2} />
        <AnimatePresence>
          {unreadCount > 0 && (
            <motion.span
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0 }}
              className="absolute -top-1 -right-1 min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold px-1 ring-2 ring-background"
            >
              {unreadCount > 9 ? '9+' : unreadCount}
            </motion.span>
          )}
        </AnimatePresence>
      </motion.button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="w-full sm:max-w-md p-0 border-l border-border/40 bg-background">
          {/* Gradient header */}
          <div
            className="px-5 pt-6 pb-5 text-primary-foreground"
            style={{ background: 'linear-gradient(135deg, hsl(224 71% 37%), hsl(225 65% 48%))' }}
          >
            <SheetHeader>
              <div className="flex items-center justify-between">
                <div>
                  <SheetTitle className="text-xl font-black text-primary-foreground text-left">Notifications</SheetTitle>
                  <p className="text-xs text-primary-foreground/80 mt-0.5">
                    {unreadCount > 0 ? `${unreadCount} unread` : 'All caught up'}
                  </p>
                </div>
                {unreadCount > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs text-primary-foreground hover:bg-white/15 hover:text-primary-foreground rounded-full"
                    onClick={markAllRead}
                  >
                    <Check className="w-3.5 h-3.5 mr-1" />
                    Mark all read
                  </Button>
                )}
              </div>
            </SheetHeader>
          </div>

          <div className="overflow-y-auto h-[calc(100dvh-112px)] bg-background">
            {loading && (
              <div className="p-4 space-y-3">
                {[0, 1, 2, 3].map(i => (
                  <div key={i} className="flex items-start gap-3 p-3 rounded-2xl skeleton h-16" />
                ))}
              </div>
            )}

            {!loading && notifications.length === 0 && (
              <div className="flex flex-col items-center justify-center py-20 px-6 text-center">
                <div
                  className="w-20 h-20 rounded-3xl flex items-center justify-center mb-5"
                  style={{
                    background: 'linear-gradient(135deg, hsl(224 71% 37% / 0.12), hsl(225 65% 48% / 0.06))',
                    boxShadow: '0 8px 24px -8px hsl(224 71% 37% / 0.25)',
                  }}
                >
                  <Bell className="w-8 h-8 text-primary" strokeWidth={2} />
                </div>
                <p className="font-bold text-foreground text-base">You're all caught up</p>
                <p className="text-sm text-muted-foreground mt-1.5 max-w-[240px]">
                  Ride updates, payments and promotions will land here.
                </p>
              </div>
            )}

            {!loading && notifications.length > 0 && (
              <div className="p-3 space-y-2">
                {notifications.map((n, i) => {
                  const Icon = typeIcons[n.notification_type] || Bell;
                  return (
                    <motion.button
                      key={n.id}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: Math.min(i * 0.02, 0.2) }}
                      onClick={() => !n.is_read && markAsRead(n.id)}
                      className={cn(
                        'w-full flex items-start gap-3 p-3.5 rounded-2xl text-left transition-all active:scale-[0.99]',
                        !n.is_read
                          ? 'bg-primary/[0.06] border border-primary/15 shadow-[0_2px_8px_-4px_hsl(224_71%_37%/0.15)]'
                          : 'bg-card border border-border/40 hover:border-border'
                      )}
                    >
                      <div
                        className={cn(
                          'w-11 h-11 rounded-2xl flex items-center justify-center shrink-0',
                          !n.is_read ? 'text-primary-foreground' : 'bg-muted text-muted-foreground'
                        )}
                        style={!n.is_read ? {
                          background: 'linear-gradient(135deg, hsl(224 71% 37%), hsl(225 65% 48%))',
                          boxShadow: '0 4px 12px -4px hsl(224 71% 37% / 0.4)',
                        } : undefined}
                      >
                        <Icon className="w-5 h-5" strokeWidth={2.2} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className={cn('text-sm font-bold truncate', !n.is_read ? 'text-foreground' : 'text-muted-foreground')}>
                            {n.title}
                          </p>
                          {!n.is_read && (
                            <span className="w-2 h-2 rounded-full bg-primary shrink-0 animate-pulse-subtle" />
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2 leading-relaxed">{n.body}</p>
                        <p className="text-[10px] text-muted-foreground/60 mt-1.5 font-medium">
                          {format(new Date(n.created_at), 'MMM d · h:mm a')}
                        </p>
                      </div>
                    </motion.button>
                  );
                })}
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
