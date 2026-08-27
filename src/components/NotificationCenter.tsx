/* eslint-disable react-hooks/exhaustive-deps */
import { useState, useEffect, useMemo, type CSSProperties } from 'react';
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

interface NotificationBellProps {
  /** Overrides the trigger button's default 44px glass-card look — used when
   * the bell is placed inside a differently-styled button stack (e.g. the
   * /ride map chrome's 52px glass circles). */
  className?: string;
  style?: CSSProperties;
}

export function NotificationBell({ className, style }: NotificationBellProps = {}) {
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
        className={cn(
          'relative flex items-center justify-center rounded-full transition-shadow',
          className ?? 'w-11 h-11 glass-card-heavy hover:shadow-[0_8px_20px_-8px_hsl(4_96%_37%/0.35)]'
        )}
        style={style}
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
            style={{ background: 'var(--gradient-primary)' }}
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
                    background: 'linear-gradient(135deg, hsl(4 96% 37% / 0.12), hsl(4 97% 25% / 0.06))',
                    boxShadow: '0 8px 24px -8px hsl(4 96% 37% / 0.25)',
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
