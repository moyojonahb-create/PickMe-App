/* eslint-disable react-hooks/exhaustive-deps */
import { useState, useEffect, useMemo } from 'react';
import { Bell, X, Check, Car, DollarSign, AlertTriangle, Star, Gift, MapPin, CheckCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { showLocalNotification } from '@/lib/push';
import { markNotificationRead, markNotificationsRead } from '@/lib/businessApi';

type NotificationCategory = 'all' | 'ride' | 'wallet' | 'system';

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

function getNotificationCategory(type: string): Exclude<NotificationCategory, 'all'> {
  switch (type) {
    case 'ride':
    case 'ride_request':
    case 'ride_accepted':
    case 'ride_completed':
    case 'ride_cancelled':
    case 'driver_arrived':
    case 'new_offer':
      return 'ride';
    case 'deposit_approved':
    case 'payment':
      return 'wallet';
    default:
      return 'system';
  }
}

export function NotificationBell() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeFilter, setActiveFilter] = useState<NotificationCategory>('all');

  const unreadCount = notifications.filter(n => !n.is_read).length;
  const filteredNotifications = useMemo(() => {
    if (activeFilter === 'all') return notifications;
    return notifications.filter((n) => getNotificationCategory(n.notification_type) === activeFilter);
  }, [activeFilter, notifications]);

  const groupedNotifications = useMemo(() => {
    const grouped: Record<string, Notification[]> = {};
    filteredNotifications.forEach((n) => {
      const category = getNotificationCategory(n.notification_type);
      grouped[category] = grouped[category] ?? [];
      grouped[category].push(n);
    });
    return grouped;
  }, [filteredNotifications]);

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
    await markNotificationRead(id);
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n));
  };

  const markAllRead = async () => {
    if (!user) return;
    const unreadIds = notifications.filter(n => !n.is_read).map(n => n.id);
    if (unreadIds.length === 0) return;
    await markNotificationsRead(unreadIds);
    setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
  };

  return (
    <>
      <motion.button
        whileTap={{ scale: 0.9 }}
        onClick={() => setOpen(true)}
        className="relative w-10 h-10 flex items-center justify-center rounded-full glass-card"
      >
        <Bell className="w-5 h-5 text-foreground" />
        <AnimatePresence>
          {unreadCount > 0 && (
            <motion.span
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0 }}
              className="absolute -top-1 -right-1 min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold px-1"
            >
              {unreadCount > 9 ? '9+' : unreadCount}
            </motion.span>
          )}
        </AnimatePresence>
      </motion.button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="w-full sm:max-w-md p-0">
          <SheetHeader className="px-5 pt-5 pb-3 border-b border-border/30">
            <div className="flex items-center justify-between">
              <SheetTitle className="text-lg font-black">Notifications</SheetTitle>
              {unreadCount > 0 && (
                <Button variant="ghost" size="sm" className="text-xs text-primary" onClick={markAllRead}>
                  <Check className="w-3.5 h-3.5 mr-1" />
                  Mark all read
                </Button>
              )}
            </div>
          </SheetHeader>

          <div className="overflow-y-auto h-[calc(100dvh-80px)]">
            <div className="px-5 py-3 border-b border-border/30">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">Inbox</p>
                  <p className="text-sm font-semibold text-foreground">{unreadCount > 0 ? `${unreadCount} unread` : 'All caught up'}</p>
                </div>
                <div className="rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-semibold text-primary">{notifications.length}</div>
              </div>
              <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
                {(['all', 'ride', 'wallet', 'system'] as NotificationCategory[]).map((filter) => (
                  <button
                    key={filter}
                    onClick={() => setActiveFilter(filter)}
                    className={cn(
                      'rounded-full px-3 py-1.5 text-xs font-semibold capitalize',
                      activeFilter === filter ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground'
                    )}
                  >
                    {filter === 'all' ? 'All' : filter}
                  </button>
                ))}
              </div>
            </div>

            {loading && (
              <div className="flex items-center justify-center py-12">
                <div className="animate-pulse text-muted-foreground text-sm">Loading…</div>
              </div>
            )}

            {!loading && notifications.length === 0 && (
              <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
                <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
                  <Bell className="w-7 h-7 text-muted-foreground" />
                </div>
                <p className="font-bold text-foreground">No notifications yet</p>
                <p className="text-sm text-muted-foreground mt-1">We'll notify you about rides, payments, and more</p>
              </div>
            )}

            {!loading && notifications.length > 0 && filteredNotifications.length === 0 && (
              <div className="flex flex-col items-center justify-center py-14 px-6 text-center">
                <p className="font-semibold text-foreground">No {activeFilter === 'all' ? 'notifications' : activeFilter} updates in this view</p>
                <p className="text-sm text-muted-foreground mt-1">Try another inbox filter to view older activity.</p>
              </div>
            )}

            {!loading && Object.entries(groupedNotifications).map(([category, items]) => (
              <div key={category} className="px-5 py-3">
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">{category}</p>
                <div className="space-y-1">
                  {items.map((n, i) => {
                    const Icon = typeIcons[n.notification_type] || Bell;
                    return (
                      <motion.div
                        key={n.id}
                        initial={{ opacity: 0, x: 20 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: i * 0.03 }}
                        onClick={() => !n.is_read && markAsRead(n.id)}
                        className={cn(
                          'flex items-start gap-3 rounded-2xl px-3 py-3 border border-border/25 cursor-pointer transition-colors',
                          !n.is_read ? 'bg-primary/5' : 'hover:bg-muted/50'
                        )}
                      >
                        <div className={cn(
                          'w-10 h-10 rounded-full flex items-center justify-center shrink-0 mt-0.5',
                          !n.is_read ? 'bg-primary/10' : 'bg-muted'
                        )}>
                          <Icon className={cn('w-4.5 h-4.5', !n.is_read ? 'text-primary' : 'text-muted-foreground')} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className={cn('text-sm font-semibold truncate', !n.is_read ? 'text-foreground' : 'text-muted-foreground')}>
                              {n.title}
                            </p>
                            {!n.is_read && (
                              <span className="w-2 h-2 rounded-full bg-primary shrink-0" />
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{n.body}</p>
                          <p className="text-[10px] text-muted-foreground/60 mt-1">
                            {format(new Date(n.created_at), 'MMM d · h:mm a')}
                          </p>
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
