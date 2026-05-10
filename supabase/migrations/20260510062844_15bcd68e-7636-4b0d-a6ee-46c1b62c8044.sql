
CREATE TABLE public.ramz_patch_audit (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  admin_id UUID NOT NULL,
  file_path TEXT NOT NULL,
  finding_title TEXT NOT NULL,
  finding_severity TEXT NOT NULL,
  finding_category TEXT NOT NULL,
  finding_line INTEGER,
  ai_summary TEXT,
  action TEXT NOT NULL CHECK (action IN ('generated','applied','skipped','reverted','verified')),
  verification_status TEXT,
  verification_findings JSONB,
  original_content TEXT,
  patched_content TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.ramz_patch_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view all patch audit"
ON public.ramz_patch_audit FOR SELECT
USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can insert patch audit"
ON public.ramz_patch_audit FOR INSERT
WITH CHECK (has_role(auth.uid(), 'admin'::app_role) AND admin_id = auth.uid());

CREATE INDEX idx_ramz_patch_audit_created ON public.ramz_patch_audit(created_at DESC);
CREATE INDEX idx_ramz_patch_audit_file ON public.ramz_patch_audit(file_path, created_at DESC);
