
-- 1. Revoke anon/authenticated execute on internal trigger/cleanup functions
REVOKE EXECUTE ON FUNCTION public.auto_resolve_noise_fraud_flag() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.auto_resolve_noise_fraud_flags() FROM PUBLIC, anon, authenticated;

-- 2. Revoke all client access to PII / secret tables (service_role only)
REVOKE ALL ON public.phone_verifications FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.wallet_pins FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.phone_verifications TO service_role;
GRANT ALL ON public.wallet_pins TO service_role;
