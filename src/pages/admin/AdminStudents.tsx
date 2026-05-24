import { useEffect, useState, useCallback, useMemo } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Loader2, CheckCircle2, XCircle, RotateCcw, ShieldAlert, GraduationCap, History, Search } from 'lucide-react';
import { toast } from 'sonner';
import AdminLayout from '@/components/admin/AdminLayout';

interface Quality {
  brightness?: number;
  glare?: boolean;
  blur?: number;
  width?: number;
  height?: number;
}

interface Row {
  id: string;
  user_id: string;
  registration_number: string;
  national_id_number: string;
  face_match_score: number;
  verification_status: string;
  fraud_score: number;
  attempt_count: number;
  device_id: string | null;
  rejection_reason: string | null;
  id_photo_path: string | null;
  selfie_photo_path: string | null;
  id_photo_quality: Quality | null;
  selfie_photo_quality: Quality | null;
  created_at: string;
  institutions: { name: string; city: string } | null;
}

interface AttemptRow {
  id: string;
  user_id: string;
  photo_kind: 'id' | 'selfie';
  brightness: number | null;
  glare: boolean | null;
  blur: number | null;
  face_match_score: number | null;
  verification_status: string | null;
  rejected_step: string | null;
  notes: string | null;
  created_at: string;
}

function QualityChips({ q, label }: { q: Quality | null; label: string }) {
  if (!q) return <p className="text-[10px] text-muted-foreground">{label}: no quality data</p>;
  const tone = (ok: boolean) => ok ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700';
  const brightOk = (q.brightness ?? 50) >= 30 && (q.brightness ?? 50) <= 85;
  const blurOk = (q.blur ?? 0) <= 60;
  const glareOk = !q.glare;
  return (
    <div className="flex flex-wrap items-center gap-1">
      <span className="text-[10px] font-semibold text-muted-foreground mr-0.5">{label}:</span>
      <Badge className={`text-[10px] ${tone(brightOk)}`}>☀ {q.brightness ?? '?'}%</Badge>
      <Badge className={`text-[10px] ${tone(glareOk)}`}>{q.glare ? 'Glare' : 'No glare'}</Badge>
      <Badge className={`text-[10px] ${tone(blurOk)}`}>Blur {q.blur ?? '?'}</Badge>
    </div>
  );
}

export default function AdminStudents() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'pending' | 'approved' | 'rejected' | 'locked'>('pending');
  const [signed, setSigned] = useState<Record<string, { id?: string; selfie?: string }>>({});
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<'newest' | 'lowest_blur' | 'highest_glare' | 'lowest_brightness'>('newest');
  const [historyOpen, setHistoryOpen] = useState<string | null>(null);
  const [history, setHistory] = useState<Record<string, AttemptRow[]>>({});

  const load = useCallback(async () => {
    setLoading(true);
    // Use SECURITY DEFINER RPC so column-level revokes on sensitive
    // anti-fraud fields don't strip them from the admin view.
    const { data, error } = await supabase.rpc('admin_list_student_profiles', {
      p_status: filter === 'all' ? null : filter,
    });
    if (error) toast.error(error.message);
    // Hydrate institution info in a second pass.
    const baseRows = (data as unknown as Row[]) ?? [];
    const instIds = Array.from(new Set(baseRows.map(r => r.institution_id).filter(Boolean)));
    if (instIds.length > 0) {
      const { data: insts } = await supabase
        .from('institutions')
        .select('id, name, city')
        .in('id', instIds as string[]);
      const byId = new Map((insts ?? []).map((i: any) => [i.id, { name: i.name, city: i.city }]));
      baseRows.forEach(r => { (r as any).institutions = byId.get(r.institution_id) ?? null; });
    }
    setRows(baseRows);
    setLoading(false);
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  /** Client-side search + quality-aware sort. Sorting prefers worst quality first to surface trouble. */
  const visibleRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = rows;
    if (q) {
      list = list.filter(r =>
        r.registration_number?.toLowerCase().includes(q) ||
        r.national_id_number?.toLowerCase().includes(q) ||
        r.institutions?.name?.toLowerCase().includes(q) ||
        r.institutions?.city?.toLowerCase().includes(q),
      );
    }
    const worstBlur = (r: Row) => Math.max(r.id_photo_quality?.blur ?? -1, r.selfie_photo_quality?.blur ?? -1);
    const anyGlare = (r: Row) => (r.id_photo_quality?.glare ? 1 : 0) + (r.selfie_photo_quality?.glare ? 1 : 0);
    const worstBright = (r: Row) => {
      const a = r.id_photo_quality?.brightness;
      const b = r.selfie_photo_quality?.brightness;
      const arr = [a, b].filter((v): v is number => typeof v === 'number');
      return arr.length ? Math.min(...arr) : 999;
    };
    const sorted = [...list];
    if (sortBy === 'lowest_blur') sorted.sort((a, b) => worstBlur(b) - worstBlur(a)); // higher blur score = blurrier
    else if (sortBy === 'highest_glare') sorted.sort((a, b) => anyGlare(b) - anyGlare(a));
    else if (sortBy === 'lowest_brightness') sorted.sort((a, b) => worstBright(a) - worstBright(b));
    return sorted;
  }, [rows, search, sortBy]);

  const sign = async (row: Row) => {
    if (signed[row.id]) return;
    const out: { id?: string; selfie?: string } = {};
    if (row.id_photo_path) {
      const { data } = await supabase.storage.from('student-verification').createSignedUrl(row.id_photo_path, 600);
      out.id = data?.signedUrl;
    }
    if (row.selfie_photo_path) {
      const { data } = await supabase.storage.from('student-verification').createSignedUrl(row.selfie_photo_path, 600);
      out.selfie = data?.signedUrl;
    }
    setSigned(prev => ({ ...prev, [row.id]: out }));
  };

  const loadHistory = async (row: Row) => {
    if (historyOpen === row.id) { setHistoryOpen(null); return; }
    setHistoryOpen(row.id);
    if (history[row.id]) return;
    const { data, error } = await supabase
      .from('student_verification_attempts')
      .select('*')
      .eq('user_id', row.user_id)
      .order('created_at', { ascending: false })
      .limit(40);
    if (error) { toast.error(error.message); return; }
    setHistory(prev => ({ ...prev, [row.id]: (data as AttemptRow[]) ?? [] }));
  };

  const update = async (row: Row, patch: Partial<Row> & Record<string, unknown>) => {
    const { error } = await supabase.from('student_profiles').update(patch as never).eq('id', row.id);
    if (error) return toast.error(error.message);
    toast.success('Updated');
    load();
  };

  return (
    <AdminLayout>
      <div className="p-4 max-w-6xl mx-auto">
        <div className="flex items-center gap-2 mb-4">
          <GraduationCap className="w-5 h-5 text-blue-600" />
          <h1 className="text-2xl font-bold">Student Verifications</h1>
        </div>

        <div className="flex gap-1.5 mb-3 overflow-x-auto">
          {(['pending', 'approved', 'rejected', 'locked', 'all'] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold capitalize border ${filter === f ? 'bg-blue-600 text-white border-blue-600' : 'bg-card border-border'}`}>
              {f}
            </button>
          ))}
        </div>

        <div className="relative mb-3">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by reg #, NID, institution or city"
            className="pl-9 h-10 rounded-2xl text-sm"
          />
        </div>

        <div className="flex gap-1.5 mb-4 overflow-x-auto" role="tablist" aria-label="Sort submissions">
          {([
            ['newest', 'Newest'],
            ['lowest_blur', 'Blurriest first'],
            ['highest_glare', 'Most glare'],
            ['lowest_brightness', 'Darkest first'],
          ] as const).map(([key, label]) => (
            <button
              key={key}
              role="tab"
              aria-selected={sortBy === key}
              onClick={() => setSortBy(key)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold border whitespace-nowrap ${sortBy === key ? 'bg-blue-600 text-white border-blue-600' : 'bg-card border-border'}`}
            >
              {label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin" /></div>
        ) : visibleRows.length === 0 ? (
          <p className="text-center text-sm text-muted-foreground py-10">No records.</p>
        ) : (
          <div className="space-y-3">
            {visibleRows.map(row => (
              <div key={row.id} className="bg-card border border-border rounded-2xl p-4">
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div>
                    <p className="font-semibold">{row.institutions?.name ?? 'Unknown'}</p>
                    <p className="text-xs text-muted-foreground">{row.institutions?.city}</p>
                    <div className="flex gap-1.5 mt-1.5 flex-wrap">
                      <Badge variant="outline" className="text-[10px] font-mono">Reg: {row.registration_number}</Badge>
                      <Badge variant="outline" className="text-[10px] font-mono">NID: {row.national_id_number}</Badge>
                    </div>
                  </div>
                  <Badge className={
                    row.verification_status === 'approved' ? 'bg-emerald-100 text-emerald-700' :
                    row.verification_status === 'pending' ? 'bg-amber-100 text-amber-700' :
                    row.verification_status === 'locked' ? 'bg-rose-100 text-rose-700' :
                    'bg-slate-100 text-slate-700'
                  }>{row.verification_status}</Badge>
                </div>

                <div className="grid grid-cols-3 gap-2 text-xs mb-3">
                  <div className="p-2 rounded-lg bg-muted">
                    <p className="text-muted-foreground">Match</p>
                    <p className="font-bold">{row.face_match_score}/100</p>
                  </div>
                  <div className="p-2 rounded-lg bg-muted">
                    <p className="text-muted-foreground">Fraud</p>
                    <p className={`font-bold ${row.fraud_score >= 50 ? 'text-rose-600' : ''}`}>{row.fraud_score}</p>
                  </div>
                  <div className="p-2 rounded-lg bg-muted">
                    <p className="text-muted-foreground">Attempts</p>
                    <p className="font-bold">{row.attempt_count}</p>
                  </div>
                </div>

                {row.rejection_reason && (
                  <p className="text-xs text-rose-600 mb-2">Notes: {row.rejection_reason}</p>
                )}

                <div className="space-y-1 mb-3">
                  <QualityChips q={row.id_photo_quality} label="ID photo" />
                  <QualityChips q={row.selfie_photo_quality} label="Selfie" />
                </div>

                {!signed[row.id] && (
                  <Button size="sm" variant="outline" onClick={() => sign(row)} className="mb-2 text-xs">View photos</Button>
                )}
                {signed[row.id] && (
                  <div className="grid grid-cols-2 gap-2 mb-3">
                    {signed[row.id].id && <img src={signed[row.id].id} alt="ID" className="rounded-lg w-full h-32 object-cover" />}
                    {signed[row.id].selfie && <img src={signed[row.id].selfie} alt="Selfie" className="rounded-lg w-full h-32 object-cover" />}
                  </div>
                )}

                <div className="flex gap-1.5 flex-wrap">
                  <Button size="sm" onClick={() => update(row, { verification_status: 'approved', student_mode_active: true, approved_at: new Date().toISOString(), rejection_reason: null })}
                    className="bg-emerald-600 hover:bg-emerald-700 text-xs gap-1">
                    <CheckCircle2 className="w-3 h-3" /> Approve
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => {
                    const reason = prompt('Reason for rejection?') ?? 'Rejected by admin';
                    update(row, { verification_status: 'rejected', student_mode_active: false, rejection_reason: reason });
                  }} className="text-xs gap-1">
                    <XCircle className="w-3 h-3" /> Reject
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => update(row, { device_id: null, attempt_count: 0 })} className="text-xs gap-1">
                    <RotateCcw className="w-3 h-3" /> Reset device
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => update(row, { fraud_score: 0 })} className="text-xs gap-1">
                    <ShieldAlert className="w-3 h-3" /> Clear fraud
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => loadHistory(row)} className="text-xs gap-1">
                    <History className="w-3 h-3" /> {historyOpen === row.id ? 'Hide' : 'History'}
                  </Button>
                </div>

                {historyOpen === row.id && (
                  <div className="mt-3 pt-3 border-t border-border">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-2">
                      Retake history ({history[row.id]?.length ?? 0})
                    </p>
                    {!history[row.id] ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : history[row.id].length === 0 ? (
                      <p className="text-xs text-muted-foreground">No quality history yet.</p>
                    ) : (
                      <div className="space-y-1.5 max-h-64 overflow-y-auto">
                        {history[row.id].map(a => {
                          const brightOk = (a.brightness ?? 50) >= 30 && (a.brightness ?? 50) <= 85;
                          const blurOk = (a.blur ?? 0) <= 60;
                          const glareOk = !a.glare;
                          const tone = (ok: boolean) => ok ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700';
                          return (
                            <div key={a.id} className="flex flex-wrap items-center gap-1.5 text-[10px] p-2 rounded-lg bg-muted/50">
                              <Badge variant="outline" className="capitalize text-[10px]">{a.photo_kind}</Badge>
                              <span className="text-muted-foreground">{new Date(a.created_at).toLocaleString()}</span>
                              <Badge className={`text-[10px] ${tone(brightOk)}`}>☀ {a.brightness ?? '?'}%</Badge>
                              <Badge className={`text-[10px] ${tone(glareOk)}`}>{a.glare ? 'Glare' : 'No glare'}</Badge>
                              <Badge className={`text-[10px] ${tone(blurOk)}`}>Blur {a.blur ?? '?'}</Badge>
                              {a.face_match_score !== null && (
                                <Badge variant="secondary" className="text-[10px]">Match {a.face_match_score}</Badge>
                              )}
                              {a.rejected_step && (
                                <Badge className="text-[10px] bg-amber-100 text-amber-800">Failed: {a.rejected_step}</Badge>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
