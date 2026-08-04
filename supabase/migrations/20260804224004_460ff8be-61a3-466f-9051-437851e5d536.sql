-- 1) places_cache: remove client-side insert ability
DROP POLICY IF EXISTS "Authenticated users can cache places" ON public.places_cache;
DROP POLICY IF EXISTS "Anyone can read cached places" ON public.places_cache;
CREATE POLICY "Anyone can read cached places" ON public.places_cache FOR SELECT TO anon, authenticated USING (true);
REVOKE INSERT, UPDATE, DELETE ON public.places_cache FROM anon, authenticated;
GRANT SELECT ON public.places_cache TO anon, authenticated;
GRANT ALL ON public.places_cache TO service_role;

-- 2) Restrict user-owned table policies to the authenticated role explicitly
-- profiles
DROP POLICY IF EXISTS "Admins can view all profiles" ON public.profiles;
CREATE POLICY "Admins can view all profiles" ON public.profiles FOR SELECT TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));
DROP POLICY IF EXISTS "Users can insert their own profile" ON public.profiles;
CREATE POLICY "Users can insert their own profile" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;
CREATE POLICY "Users can update their own profile" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can view their own profile" ON public.profiles;
CREATE POLICY "Users can view their own profile" ON public.profiles FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Riders can view profiles of offering drivers" ON public.profiles;
CREATE POLICY "Riders can view profiles of offering drivers" ON public.profiles FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM offers o JOIN rides r ON r.id = o.ride_id
  WHERE o.driver_id = profiles.user_id AND r.user_id = auth.uid() AND o.status = 'pending'));

-- wallets
DROP POLICY IF EXISTS "Admins can manage all wallets" ON public.wallets;
CREATE POLICY "Admins can manage all wallets" ON public.wallets FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
DROP POLICY IF EXISTS "Admins can view all wallets" ON public.wallets;
CREATE POLICY "Admins can view all wallets" ON public.wallets FOR SELECT TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));
DROP POLICY IF EXISTS "Users can insert their own wallet" ON public.wallets;
CREATE POLICY "Users can insert their own wallet" ON public.wallets FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can view their own wallet" ON public.wallets;
CREATE POLICY "Users can view their own wallet" ON public.wallets FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- wallet_transactions
DROP POLICY IF EXISTS "Admins can manage all transactions" ON public.wallet_transactions;
CREATE POLICY "Admins can manage all transactions" ON public.wallet_transactions FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
DROP POLICY IF EXISTS "Admins can view all transactions" ON public.wallet_transactions;
CREATE POLICY "Admins can view all transactions" ON public.wallet_transactions FOR SELECT TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));
DROP POLICY IF EXISTS "Users can view their own transactions" ON public.wallet_transactions;
CREATE POLICY "Users can view their own transactions" ON public.wallet_transactions FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- wallet_transfers
DROP POLICY IF EXISTS "Admins can manage all transfers" ON public.wallet_transfers;
CREATE POLICY "Admins can manage all transfers" ON public.wallet_transfers FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
DROP POLICY IF EXISTS "Users can view their own transfers" ON public.wallet_transfers;
CREATE POLICY "Users can view their own transfers" ON public.wallet_transfers FOR SELECT TO authenticated USING (auth.uid() = sender_id OR auth.uid() = receiver_id);

-- driver_wallets
DROP POLICY IF EXISTS "Admins can manage all driver wallets" ON public.driver_wallets;
CREATE POLICY "Admins can manage all driver wallets" ON public.driver_wallets FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
DROP POLICY IF EXISTS "Drivers can insert their own wallet" ON public.driver_wallets;
CREATE POLICY "Drivers can insert their own wallet" ON public.driver_wallets FOR INSERT TO authenticated WITH CHECK (auth.uid() = driver_id);
DROP POLICY IF EXISTS "Drivers can view their own wallet" ON public.driver_wallets;
CREATE POLICY "Drivers can view their own wallet" ON public.driver_wallets FOR SELECT TO authenticated USING (auth.uid() = driver_id);

-- driver_ratings
DROP POLICY IF EXISTS "Admins can manage all ratings" ON public.driver_ratings;
CREATE POLICY "Admins can manage all ratings" ON public.driver_ratings FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
DROP POLICY IF EXISTS "Drivers can view their own ratings" ON public.driver_ratings;
CREATE POLICY "Drivers can view their own ratings" ON public.driver_ratings FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM drivers d WHERE d.id = driver_ratings.driver_id AND d.user_id = auth.uid()));
DROP POLICY IF EXISTS "Riders can view their own ratings" ON public.driver_ratings;
CREATE POLICY "Riders can view their own ratings" ON public.driver_ratings FOR SELECT TO authenticated USING (auth.uid() = rider_id);
DROP POLICY IF EXISTS "Riders can insert ratings for their rides" ON public.driver_ratings;
CREATE POLICY "Riders can insert ratings for their rides" ON public.driver_ratings FOR INSERT TO authenticated
WITH CHECK (auth.uid() = rider_id AND EXISTS (SELECT 1 FROM rides r WHERE r.id = driver_ratings.ride_id AND r.user_id = auth.uid() AND r.status = 'completed'));

-- notifications
DROP POLICY IF EXISTS "Admins can manage all notifications" ON public.notifications;
CREATE POLICY "Admins can manage all notifications" ON public.notifications FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
DROP POLICY IF EXISTS "Service can insert notifications" ON public.notifications;
CREATE POLICY "Service can insert notifications" ON public.notifications FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "Users can update their own notifications" ON public.notifications;
CREATE POLICY "Users can update their own notifications" ON public.notifications FOR UPDATE TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can view their own notifications" ON public.notifications;
CREATE POLICY "Users can view their own notifications" ON public.notifications FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- user_settings
DROP POLICY IF EXISTS "Users can insert their own settings" ON public.user_settings;
CREATE POLICY "Users can insert their own settings" ON public.user_settings FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can update their own settings" ON public.user_settings;
CREATE POLICY "Users can update their own settings" ON public.user_settings FOR UPDATE TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "Users can view their own settings" ON public.user_settings;
CREATE POLICY "Users can view their own settings" ON public.user_settings FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- user_roles
DROP POLICY IF EXISTS "Admins can manage roles" ON public.user_roles;
CREATE POLICY "Admins can manage roles" ON public.user_roles FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
DROP POLICY IF EXISTS "Admins can view all roles" ON public.user_roles;
CREATE POLICY "Admins can view all roles" ON public.user_roles FOR SELECT TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));
DROP POLICY IF EXISTS "Block non-admin role insertion" ON public.user_roles;
CREATE POLICY "Block non-admin role insertion" ON public.user_roles FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
DROP POLICY IF EXISTS "Users can view their own roles" ON public.user_roles;
CREATE POLICY "Users can view their own roles" ON public.user_roles FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- Remove any anon table grants on these user-owned tables
REVOKE ALL ON public.profiles, public.wallets, public.wallet_transactions, public.wallet_transfers,
  public.driver_wallets, public.driver_ratings, public.notifications, public.user_settings,
  public.user_roles FROM anon;

-- 3) Strict realtime topic validation (anchored UUID suffix)
CREATE OR REPLACE FUNCTION public.realtime_topic_entity_id(p_topic text, p_prefixes text)
RETURNS uuid
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT NULLIF(
    (regexp_match(p_topic,
      '^(?:' || p_prefixes || ')([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$'
    ))[1], '')::uuid
$$;

DROP POLICY IF EXISTS "Authorize realtime channel subscriptions" ON realtime.messages;
CREATE POLICY "Authorize realtime channel subscriptions" ON realtime.messages FOR SELECT TO authenticated
USING (
  (public.realtime_topic_entity_id(realtime.topic(), 'ride-status-|offers-|ride-|ride:') IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.rides r LEFT JOIN public.drivers d ON d.id = r.driver_id
      WHERE r.id = public.realtime_topic_entity_id(realtime.topic(), 'ride-status-|offers-|ride-|ride:')
        AND (r.user_id = (SELECT auth.uid()) OR d.user_id = (SELECT auth.uid()))
    ))
  OR (public.realtime_topic_entity_id(realtime.topic(), 'driver-status-|global-ride-notifier-') IS NOT NULL
    AND public.realtime_topic_entity_id(realtime.topic(), 'driver-status-|global-ride-notifier-') = (SELECT auth.uid()))
  OR (realtime.topic() = ANY (ARRAY['open-rides','driver-ride-requests']) AND public.is_user_driver((SELECT auth.uid())))
  OR (realtime.topic() = 'admin-emergency-alerts' AND public.has_role((SELECT auth.uid()), 'admin'::public.app_role))
);

DROP POLICY IF EXISTS "Authorize realtime channel writes" ON realtime.messages;
CREATE POLICY "Authorize realtime channel writes" ON realtime.messages FOR INSERT TO authenticated
WITH CHECK (
  (public.realtime_topic_entity_id(realtime.topic(), 'ride-status-|offers-|ride-|ride:') IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.rides r LEFT JOIN public.drivers d ON d.id = r.driver_id
      WHERE r.id = public.realtime_topic_entity_id(realtime.topic(), 'ride-status-|offers-|ride-|ride:')
        AND (r.user_id = (SELECT auth.uid()) OR d.user_id = (SELECT auth.uid()))
    ))
  OR (public.realtime_topic_entity_id(realtime.topic(), 'driver-status-|global-ride-notifier-') IS NOT NULL
    AND public.realtime_topic_entity_id(realtime.topic(), 'driver-status-|global-ride-notifier-') = (SELECT auth.uid()))
  OR (realtime.topic() = ANY (ARRAY['open-rides','driver-ride-requests']) AND public.is_user_driver((SELECT auth.uid())))
  OR (realtime.topic() = 'admin-emergency-alerts' AND public.has_role((SELECT auth.uid()), 'admin'::public.app_role))
);