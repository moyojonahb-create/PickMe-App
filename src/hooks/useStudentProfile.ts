import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/hooks/useAuth';

export interface StudentPhotoQuality {
  brightness?: number;
  glare?: boolean;
  blur?: number;
  width?: number;
  height?: number;
}

export interface StudentProfile {
  id: string;
  user_id: string;
  institution_id: string;
  // Note: registration_number and national_id_number are intentionally NOT
  // selected by the rider client. They are PII used only by the admin
  // verification workflow (AdminStudents) and are never displayed in-app.
  id_photo_path: string | null;
  selfie_photo_path: string | null;
  id_photo_quality: StudentPhotoQuality | null;
  selfie_photo_quality: StudentPhotoQuality | null;
  face_match_score: number;
  verification_status: 'pending' | 'approved' | 'rejected' | 'locked';
  student_mode_active: boolean;
  attempt_count: number;
  fraud_score: number;
  rejection_reason: string | null;
  created_at: string;
  updated_at: string;
}

export function useStudentProfile() {
  const { user } = useAuth();
  const [profile, setProfile] = useState<StudentProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    if (!user) {
      setProfile(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    // Explicit allowlist — never pull national_id_number / registration_number
    // into the client. Internal anti-fraud signals (fraud_score, device_id,
    // attempt_count, face_match_score) are column-level revoked from
    // authenticated and MUST NOT be selected by the client.
    const { data } = await supabase
      .from('student_profiles')
      .select(
        'id, user_id, institution_id, id_photo_path, selfie_photo_path, ' +
        'id_photo_quality, selfie_photo_quality, ' +
        'verification_status, student_mode_active, ' +
        'rejection_reason, created_at, updated_at'
      )
      .eq('user_id', user.id)
      .maybeSingle();
    setProfile((data as unknown as StudentProfile | null) ?? null);
    setLoading(false);
  }, [user]);

  useEffect(() => { fetch(); }, [fetch]);

  return { profile, loading, refetch: fetch };
}

export interface Institution {
  id: string;
  name: string;
  type: 'university' | 'college' | 'polytechnic';
  city: string;
}

export function useInstitutions() {
  const [list, setList] = useState<Institution[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      const { data } = await supabase
        .from('institutions')
        .select('id, name, type, city')
        .eq('is_active', true)
        .order('name');
      if (active) {
        setList((data as Institution[]) ?? []);
        setLoading(false);
      }
    })();
    return () => { active = false; };
  }, []);

  return { institutions: list, loading };
}

/** Whether the discount can be applied to the next ride. Checks daily cap. */
export function useStudentDiscountAvailable() {
  const { user } = useAuth();
  const { profile } = useStudentProfile();
  const [available, setAvailable] = useState(false);
  const [usedToday, setUsedToday] = useState(0);

  const refresh = useCallback(async () => {
    if (!user || !profile?.student_mode_active || profile.verification_status !== 'approved') {
      setAvailable(false);
      return;
    }
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const { count } = await supabase
      .from('student_discount_usage')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .gte('created_at', startOfDay.toISOString());
    const used = count ?? 0;
    setUsedToday(used);
    setAvailable(used < 4 && (profile.fraud_score ?? 0) < 50);
  }, [user, profile]);

  useEffect(() => { refresh(); }, [refresh]);

  return { available, usedToday, dailyCap: 4, profile, refresh };
}
