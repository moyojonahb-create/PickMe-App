import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabaseClient';

export interface Street {
  id: string;
  name: string;
  town: string | null;
  road_class: string | null;
  latitude: number;
  longitude: number;
  keywords: string[];
  segment_count: number;
  matchScore?: number; // Set when a search query is active; higher = better match
}

interface UseStreetsOptions {
  searchQuery?: string;
  townName?: string | null; // matches selectedTown.name from src/lib/towns.ts, e.g. "Bulawayo"
  limit?: number;
}

// Streets have no "browse" mode — they only ever appear as search results,
// so this queries the DB directly per keystroke instead of downloading the
// whole town's street list and filtering client-side. `streets.name` and
// `streets.town` are both pg_trgm/btree indexed for this.
export const useStreets = ({ searchQuery = '', townName = null, limit = 10 }: UseStreetsOptions = {}) => {
  const [streets, setStreets] = useState<Street[]>([]);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const q = searchQuery.trim();
    if (debounceRef.current) clearTimeout(debounceRef.current);
    abortRef.current?.abort();

    if (!townName || q.length < 3) {
      setStreets([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    debounceRef.current = setTimeout(() => {
      const controller = new AbortController();
      abortRef.current = controller;

      // `streets` isn't in the generated DB types yet; untyped client avoids deep type instantiation.
      const db = supabase as unknown as {
        from: (t: string) => any;
      };
      const scoped = () =>
        db.from('streets').select('*').eq('is_active', true).eq('town', townName).abortSignal(controller.signal);


      (async () => {
        try {
          const [prefixRes, containsRes, keywordRes] = await Promise.all([
            scoped().ilike('name', `${q}%`).limit(limit),
            scoped().ilike('name', `%${q}%`).limit(limit),
            scoped().contains('keywords', [q.toLowerCase()]).limit(limit),
          ]);
          if (prefixRes.error) throw prefixRes.error;
          if (containsRes.error) throw containsRes.error;
          if (keywordRes.error) throw keywordRes.error;

          const seen = new Set<string>();
          const merged: Street[] = [];
          const addRows = (rows: Street[] | null, matchScore: number) => {
            (rows ?? []).forEach((row) => {
              if (seen.has(row.id)) return;
              seen.add(row.id);
              merged.push({ ...row, matchScore });
            });
          };
          // Prefix beats contains beats keyword-only matches.
          addRows(prefixRes.data as Street[] | null, 3);
          addRows(containsRes.data as Street[] | null, 2);
          addRows(keywordRes.data as Street[] | null, 1);
          merged.sort((a, b) => (b.matchScore ?? 0) - (a.matchScore ?? 0));
          setStreets(merged.slice(0, limit));
        } catch (err) {
          if ((err as { name?: string })?.name !== 'AbortError') {
            console.error('Street search failed:', err);
            setStreets([]);
          }
        } finally {
          if (abortRef.current === controller) setLoading(false);
        }
      })();
    }, 200);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      abortRef.current?.abort();
    };
  }, [searchQuery, townName, limit]);

  return { streets, loading };
};
