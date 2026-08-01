-- The driver registration wizard (DriverRegistrationWizard.tsx) and the
-- document re-upload flow (DocumentUpload.tsx) submit document_type values
-- that were never part of this constraint (e.g. 'drivers_license',
-- 'police_clearance', 'vehicle_registration', 'personal_photo'), so every
-- insert for those types has been failing with a check_violation and
-- silently dropped by the frontend's Promise.allSettled. Widen the
-- constraint to the actual set of types the app submits.
ALTER TABLE public.driver_documents DROP CONSTRAINT IF EXISTS driver_documents_document_type_check;

ALTER TABLE public.driver_documents ADD CONSTRAINT driver_documents_document_type_check
  CHECK (document_type IN (
    'license',
    'registration',
    'insurance',
    'id_card',
    'license_back',
    'selfie_with_id',
    'vehicle_photo',
    'personal_photo',
    'police_clearance'
  ));
