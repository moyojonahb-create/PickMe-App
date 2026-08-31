ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS nickname text;

CREATE UNIQUE INDEX IF NOT EXISTS profiles_nickname_lower_unique
  ON public.profiles (lower(nickname)) WHERE nickname IS NOT NULL;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, full_name, nickname, phone)
  VALUES (
    NEW.id,
    NEW.raw_user_meta_data->>'full_name',
    NULLIF(NEW.raw_user_meta_data->>'nickname', ''),
    NULLIF(NEW.raw_user_meta_data->>'phone', '')
  );
  RETURN NEW;
END;
$$;

-- Returns true when a nickname is already taken (no data leaked).
CREATE OR REPLACE FUNCTION public.nickname_is_taken(_nickname text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE lower(nickname) = lower(trim(_nickname))
  );
$$;

-- Resolves a nickname to the sign-in email for that account.
CREATE OR REPLACE FUNCTION public.email_for_nickname(_nickname text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT u.email
  FROM public.profiles p
  JOIN auth.users u ON u.id = p.user_id
  WHERE lower(p.nickname) = lower(trim(_nickname))
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.nickname_is_taken(text) FROM public;
REVOKE ALL ON FUNCTION public.email_for_nickname(text) FROM public;
GRANT EXECUTE ON FUNCTION public.nickname_is_taken(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.email_for_nickname(text) TO anon, authenticated;