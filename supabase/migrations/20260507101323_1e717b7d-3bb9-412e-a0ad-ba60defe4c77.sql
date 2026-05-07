
-- 1. Trigger: auto-resolve clearly-noisy GPS spoofing flags on insert.
CREATE OR REPLACE FUNCTION public.auto_resolve_noise_fraud_flag()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.flag_type = 'gps_spoofing'
     AND COALESCE((NEW.details->>'speedKmh')::numeric, 0) > 2000 THEN
    NEW.resolved := true;
    NEW.resolved_at := now();
    NEW.severity := 'low';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_resolve_noise_fraud_flag ON public.fraud_flags;
CREATE TRIGGER trg_auto_resolve_noise_fraud_flag
BEFORE INSERT ON public.fraud_flags
FOR EACH ROW EXECUTE FUNCTION public.auto_resolve_noise_fraud_flag();

-- 2. On-demand cleanup for historical noise.
CREATE OR REPLACE FUNCTION public.auto_resolve_noise_fraud_flags()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_count integer;
BEGIN
  UPDATE public.fraud_flags
  SET resolved = true,
      resolved_at = now(),
      severity = 'low'
  WHERE resolved = false
    AND flag_type = 'gps_spoofing'
    AND COALESCE((details->>'speedKmh')::numeric, 0) > 2000;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- 3. Resolve existing noise flags now.
SELECT public.auto_resolve_noise_fraud_flags();
