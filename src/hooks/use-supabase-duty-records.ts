// ============================================================================
// Supabase Duty Records Hook — Egress-Optimized
// Changes: select specific columns, limit to current month, no realtime sub
// ============================================================================

import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import type { DutyRecord, DutyRecordInsert, DutyRecordUpdate, TodayDutySummary, MonthlyDutyStats } from '../types/database';

interface QueryOptions {
  orderBy?: { column: keyof DutyRecord; ascending?: boolean };
  filters?: { column: keyof DutyRecord; value: unknown; operator?: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' }[];
  limit?: number;
  offset?: number;
}

interface RetryConfig { maxRetries: number; baseDelay: number; maxDelay: number; }

export type { DutyRecordUpdate };

interface UseSupabaseDutyRecordsReturn {
  dutyRecords: DutyRecord[];
  todaySummary: TodayDutySummary[];
  monthlyStats: MonthlyDutyStats[];
  loading: boolean;
  error: string | null;
  isRetrying: boolean;
  connectionStatus: 'connected' | 'disconnected' | 'reconnecting';
  fetchDutyRecords: (options?: QueryOptions) => Promise<void>;
  fetchDutyRecordsForOfficer: (officerId: string, options?: QueryOptions) => Promise<DutyRecord[]>;
  fetchDutyRecordsForDate: (date: Date, options?: QueryOptions) => Promise<DutyRecord[]>;
  checkInOfficer: (officerId: string, notes?: string) => Promise<DutyRecord | null>;
  checkOutOfficer: (officerId: string) => Promise<boolean>;
  addDutyRecord: (record: Omit<DutyRecordInsert, 'id' | 'created_at' | 'updated_at'>) => Promise<DutyRecord | null>;
  updateDutyRecord: (id: string, record: DutyRecordUpdate) => Promise<DutyRecord | null>;
  deleteDutyRecord: (id: string) => Promise<boolean>;
  fetchTodaySummary: () => Promise<void>;
  fetchMonthlyStats: (month?: Date) => Promise<void>;
  getOfficersOnDuty: (date?: Date) => Promise<TodayDutySummary[]>;
  getDutyStats: (startDate: Date, endDate: Date) => Promise<{ duty_date: string; total_officers: number; officers_on_duty: number; officers_off_duty: number }[]>;
  refreshData: () => Promise<void>;
  retryConnection: () => Promise<void>;
  onDutyRecordsChange?: (callback: (officerId?: string, status?: 'on-duty' | 'off-duty', dutyRecord?: DutyRecord) => void) => () => void;
}

const DEFAULT_RETRY_CONFIG: RetryConfig = { maxRetries: 3, baseDelay: 1000, maxDelay: 10000 };
const DUTY_RECORDS_STORAGE_KEY = 'bcps-1-duty-records-backup';
const DUTY_RECORDS_CACHE_TS_KEY = 'bcps-1-duty-records-cache-ts';
const CACHE_TTL_MS = 0;

// Only needed columns — excludes large/unused fields
const DUTY_RECORD_COLS = 'id,officer_id,duty_date,time_in,time_out,notes,created_at,updated_at';

const getRetryDelay = (attempt: number, config: RetryConfig): number =>
  Math.min(config.baseDelay * Math.pow(2, attempt), config.maxDelay);

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

const parseError = (error: unknown): string => {
  if (error instanceof Error) {
    const m = error.message;
    if (m.includes('23505')) return 'This duty record already exists.';
    if (m.includes('23503')) return 'Officer not found.';
    if (m.includes('P0001') || m.includes('Officer already checked in')) return 'Officer is already checked in for today.';
    if (m.includes('No active duty record')) return 'No active duty record found.';
    if (m.includes('42501') || m.includes('insufficient privilege')) return 'Permission denied.';
    if (m.includes('network') || m.includes('fetch') || m.includes('ECONNREFUSED')) return 'Network connection failed.';
    if (m.includes('timeout') || m.includes('408')) return 'Request timed out.';
    return m;
  }
  return 'An unexpected error occurred.';
};

const saveToLocalBackup = (records: DutyRecord[]): void => {
  try {
    localStorage.setItem(DUTY_RECORDS_STORAGE_KEY, JSON.stringify(records));
    localStorage.setItem(DUTY_RECORDS_CACHE_TS_KEY, Date.now().toString());
  } catch { /* ignore */ }
};

const loadFromLocalBackup = (): { records: DutyRecord[]; isFresh: boolean } => {
  try {
    const stored = localStorage.getItem(DUTY_RECORDS_STORAGE_KEY);
    const ts = localStorage.getItem(DUTY_RECORDS_CACHE_TS_KEY);
    if (stored) {
      const isFresh = ts ? Date.now() - Number(ts) < CACHE_TTL_MS : false;
      return { records: JSON.parse(stored), isFresh };
    }
  } catch { /* ignore */ }
  return { records: [], isFresh: false };
};

// Get current year date range to show historical data (Jan, Feb, Mar...)
const getCurrentMonthRange = () => {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 1).toISOString().split('T')[0]; // Jan 1st of current year
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];
  return { start, end };
};

export function useSupabaseDutyRecords(retryConfig: RetryConfig = DEFAULT_RETRY_CONFIG): UseSupabaseDutyRecordsReturn {
  const [dutyRecords, setDutyRecords] = useState<DutyRecord[]>([]);
  const [todaySummary, setTodaySummary] = useState<TodayDutySummary[]>([]);
  const [monthlyStats, setMonthlyStats] = useState<MonthlyDutyStats[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isRetrying, setIsRetrying] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'connected' | 'disconnected' | 'reconnecting'>('connected');

  const retryAttemptRef = useRef(0);
  const isMountedRef = useRef(true);
  const dutyRecordsChangeCallbacks = useRef<Set<(officerId?: string, status?: 'on-duty' | 'off-duty', dutyRecord?: DutyRecord) => void>>(new Set());

  const supabaseAvailable = isSupabaseConfigured();

  const onDutyRecordsChange = useCallback((callback: (officerId?: string, status?: 'on-duty' | 'off-duty', dutyRecord?: DutyRecord) => void) => {
    dutyRecordsChangeCallbacks.current.add(callback);
    return () => { dutyRecordsChangeCallbacks.current.delete(callback); };
  }, []);

  const fetchWithRetry = useCallback(async <T,>(fetchFn: () => Promise<T>, attempt = 0): Promise<T> => {
    try {
      const result = await fetchFn();
      retryAttemptRef.current = 0;
      if (isMountedRef.current) setConnectionStatus('connected');
      return result;
    } catch (err) {
      const msg = parseError(err);
      const retryable = msg.includes('network') || msg.includes('timeout') || msg.includes('ECONNREFUSED');
      if (retryable && attempt < retryConfig.maxRetries) {
        if (isMountedRef.current) { setIsRetrying(true); setConnectionStatus('reconnecting'); }
        await sleep(getRetryDelay(attempt, retryConfig));
        if (isMountedRef.current) { retryAttemptRef.current = attempt + 1; return fetchWithRetry(fetchFn, attempt + 1); }
      }
      throw err;
    }
  }, [retryConfig]);

  // ============================================================================
  // Fetch Duty Records — scoped to prev+current month, specific columns only
  // ============================================================================
  const fetchDutyRecords = useCallback(async (options?: QueryOptions) => {
    if (!supabaseAvailable) {
      setError('Supabase is not configured');
      setConnectionStatus('disconnected');
      const { records } = loadFromLocalBackup();
      setDutyRecords(records);
      return;
    }

    setLoading(true); setError(null); setIsRetrying(false);

    try {
      const data = await fetchWithRetry(async () => {
        const { start, end } = getCurrentMonthRange();
        let query = supabase
          .from('duty_records')
          .select(DUTY_RECORD_COLS)
          .gte('duty_date', start)
          .lte('duty_date', end);

        if (options?.filters) {
          options.filters.forEach(f => {
            const v = f.value;
            switch (f.operator || 'eq') {
              case 'eq': query = query.eq(f.column as string, v as string); break;
              case 'neq': query = query.neq(f.column as string, v as string); break;
              case 'gt': query = query.gt(f.column as string, v as number); break;
              case 'gte': query = query.gte(f.column as string, v as number); break;
              case 'lt': query = query.lt(f.column as string, v as number); break;
              case 'lte': query = query.lte(f.column as string, v as number); break;
            }
          });
        }

        query = options?.orderBy
          ? query.order(options.orderBy.column, { ascending: options.orderBy.ascending ?? false })
          : query.order('duty_date', { ascending: false });

        if (options?.limit) query = query.limit(options.limit);
        if (options?.offset) query = query.range(options.offset, options.offset + (options.limit || 1000) - 1);

        const { data, error: err } = await query;
        if (err) throw err;
        return (data || []) as DutyRecord[];
      });

      if (isMountedRef.current) { setDutyRecords(data); saveToLocalBackup(data); }
    } catch (err) {
      if (isMountedRef.current) {
        setError(parseError(err)); setConnectionStatus('disconnected');
        const { records } = loadFromLocalBackup();
        if (records.length > 0) setDutyRecords(records);
      }
    } finally {
      if (isMountedRef.current) { setLoading(false); setIsRetrying(false); }
    }
  }, [supabaseAvailable, fetchWithRetry]);

  // ============================================================================
  // Fetch for specific officer — limited columns
  // ============================================================================
  const fetchDutyRecordsForOfficer = useCallback(async (officerId: string, options?: QueryOptions): Promise<DutyRecord[]> => {
    if (!supabaseAvailable) return dutyRecords.filter(r => r.officer_id === officerId);

    try {
      const data = await fetchWithRetry(async () => {
        const { start, end } = getCurrentMonthRange();
        let query = supabase
          .from('duty_records')
          .select(DUTY_RECORD_COLS)
          .eq('officer_id', officerId)
          .gte('duty_date', start)
          .lte('duty_date', end);

        query = options?.orderBy
          ? query.order(options.orderBy.column, { ascending: options.orderBy.ascending ?? false })
          : query.order('duty_date', { ascending: false });

        const { data, error: err } = await query;
        if (err) throw err;
        return (data || []) as DutyRecord[];
      });
      return data;
    } catch {
      return dutyRecords.filter(r => r.officer_id === officerId);
    }
  }, [supabaseAvailable, dutyRecords, fetchWithRetry]);

  // ============================================================================
  // Fetch for specific date
  // ============================================================================
  const fetchDutyRecordsForDate = useCallback(async (date: Date): Promise<DutyRecord[]> => {
    const dateStr = date.toISOString().split('T')[0];
    if (!supabaseAvailable) return dutyRecords.filter(r => r.duty_date === dateStr);

    try {
      const data = await fetchWithRetry(async () => {
        const { data, error: err } = await supabase
          .from('duty_records')
          .select(DUTY_RECORD_COLS)
          .eq('duty_date', dateStr);
        if (err) throw err;
        return (data || []) as DutyRecord[];
      });
      return data;
    } catch {
      return dutyRecords.filter(r => r.duty_date === dateStr);
    }
  }, [supabaseAvailable, dutyRecords, fetchWithRetry]);

  // ============================================================================
  // Check In
  // ============================================================================
  const checkInOfficer = useCallback(async (officerId: string, notes?: string): Promise<DutyRecord | null> => {
    if (!supabaseAvailable) { setError('Supabase is not configured'); return null; }
    setLoading(true); setError(null);
    try {
      const data = await fetchWithRetry(async () => {
        const { data: recordId, error: fnErr } = await supabase
          .rpc('check_in_officer', { p_officer_id: officerId, p_notes: notes });
        if (fnErr) throw fnErr;

        const { data, error: fetchErr } = await supabase
          .from('duty_records')
          .select(DUTY_RECORD_COLS)
          .eq('id', recordId)
          .single();
        if (fetchErr) throw fetchErr;
        return data as DutyRecord;
      });

      if (data && isMountedRef.current) {
        setDutyRecords(prev => {
          const updated = [data, ...prev];
          saveToLocalBackup(updated);
          return updated;
        });
      }
      return data;
    } catch (err) {
      if (isMountedRef.current) setError(parseError(err));
      return null;
    } finally {
      if (isMountedRef.current) setLoading(false);
    }
  }, [supabaseAvailable, fetchWithRetry]);

  // ============================================================================
  // Check Out
  // ============================================================================
  const checkOutOfficer = useCallback(async (officerId: string): Promise<boolean> => {
    console.log('=== checkOutOfficer START ===', officerId);
    if (!supabaseAvailable) { setError('Supabase is not configured'); return false; }
    setLoading(true); setError(null);

    try {
      const { data, error: fnErr } = await supabase.rpc('check_out_officer', { p_officer_id: officerId });
      console.log('RPC response - data:', data, 'error:', fnErr);

      if (fnErr) {
        // Fallback: direct update
        const { data: activeRecords, error: fetchErr } = await supabase
          .from('duty_records')
          .select('id')
          .eq('officer_id', officerId)
          .is('time_out', null)
          .order('duty_date', { ascending: false })
          .limit(1);

        if (fetchErr) throw fetchErr;

        if (!activeRecords || activeRecords.length === 0) {
          await supabase.from('officers').update({ current_status: 'off-duty' }).eq('id', officerId);
          await fetchDutyRecords();
          return true;
        }

        const now = new Date();
        const timeOut = now.toTimeString().slice(0, 8);
        await supabase.from('duty_records').update({ time_out: timeOut }).eq('id', activeRecords[0].id);
        await supabase.from('officers').update({ current_status: 'off-duty' }).eq('id', officerId);
      }

      await fetchDutyRecords();

      try {
        await supabase.from('officers').update({ current_status: 'off-duty' }).eq('id', officerId);
      } catch { /* non-critical */ }

      console.log('=== checkOutOfficer SUCCESS ===');
      return true;
    } catch (err) {
      console.error('=== checkOutOfficer ERROR ===', err);
      try {
        await supabase.from('officers').update({ current_status: 'off-duty' }).eq('id', officerId);
        return true;
      } catch {
        setError(parseError(err));
        return false;
      }
    } finally {
      setLoading(false);
    }
  }, [supabaseAvailable, fetchDutyRecords]);

  // ============================================================================
  // Add / Update / Delete — minimal selects
  // ============================================================================
  const addDutyRecord = useCallback(async (
    record: Omit<DutyRecordInsert, 'id' | 'created_at' | 'updated_at'>
  ): Promise<DutyRecord | null> => {
    if (!supabaseAvailable) { setError('Supabase is not configured'); return null; }

    const tempId = `temp-${Date.now()}`;
    const timeOutValue = record.time_out === undefined ? null : record.time_out;
    const optimistic: DutyRecord = {
      id: tempId, officer_id: record.officer_id, duty_date: record.duty_date,
      time_in: record.time_in, time_out: timeOutValue, notes: record.notes || null,
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    };

    setDutyRecords(prev => [optimistic, ...prev]);

    try {
      const data = await fetchWithRetry(async () => {
        const { data, error: err } = await supabase
          .from('duty_records')
          .insert([{ ...record, time_out: timeOutValue }])
          .select(DUTY_RECORD_COLS)
          .single();
        if (err) throw err;
        return data as DutyRecord;
      });

      if (data && isMountedRef.current) {
        setDutyRecords(prev => {
          const updated = prev.map(r => r.id === tempId ? data : r);
          saveToLocalBackup(updated);
          return updated;
        });
      }
      return data;
    } catch (err) {
      if (isMountedRef.current) { setDutyRecords(prev => prev.filter(r => r.id !== tempId)); setError(parseError(err)); }
      return null;
    }
  }, [supabaseAvailable, fetchWithRetry]);

  const updateDutyRecord = useCallback(async (id: string, record: DutyRecordUpdate): Promise<DutyRecord | null> => {
    if (!supabaseAvailable) { setError('Supabase is not configured'); return null; }
    const original = dutyRecords.find(r => r.id === id);
    if (!original) return null;

    setDutyRecords(prev => prev.map(r => r.id === id ? { ...r, ...record, updated_at: new Date().toISOString() } : r));

    try {
      const data = await fetchWithRetry(async () => {
        const { data, error: err } = await supabase
          .from('duty_records')
          .update({ ...record, updated_at: new Date().toISOString() })
          .eq('id', id)
          .select(DUTY_RECORD_COLS)
          .single();
        if (err) throw err;
        return data as DutyRecord;
      });

      if (data && isMountedRef.current) {
        setDutyRecords(prev => { const u = prev.map(r => r.id === id ? data : r); saveToLocalBackup(u); return u; });
      }
      return data;
    } catch (err) {
      if (isMountedRef.current) { setDutyRecords(prev => prev.map(r => r.id === id ? original : r)); setError(parseError(err)); }
      return null;
    }
  }, [supabaseAvailable, dutyRecords, fetchWithRetry]);

  const deleteDutyRecord = useCallback(async (id: string): Promise<boolean> => {
    if (!supabaseAvailable) { setError('Supabase is not configured'); return false; }
    const original = dutyRecords.find(r => r.id === id);
    setDutyRecords(prev => prev.filter(r => r.id !== id));

    try {
      await fetchWithRetry(async () => {
        const { error: err } = await supabase.from('duty_records').delete().eq('id', id);
        if (err) throw err;
      });
      setDutyRecords(current => { saveToLocalBackup(current); return current; });
      return true;
    } catch (err) {
      if (isMountedRef.current && original) { setDutyRecords(prev => [...prev, original]); setError(parseError(err)); }
      return false;
    }
  }, [supabaseAvailable, dutyRecords, fetchWithRetry]);

  // ============================================================================
  // Summary / Stats — unchanged API, optimized selects
  // ============================================================================
  const fetchTodaySummary = useCallback(async () => {
    if (!supabaseAvailable) return;
    setLoading(true);
    try {
      const data = await fetchWithRetry(async () => {
        const { data, error: err } = await supabase
          .from('today_duty_summary')
          .select('*')
          .order('name', { ascending: true });
        if (err) throw err;
        return data || [];
      });
      if (isMountedRef.current) setTodaySummary(data as TodayDutySummary[]);
    } catch (err) {
      if (isMountedRef.current) setError(parseError(err));
    } finally {
      if (isMountedRef.current) setLoading(false);
    }
  }, [supabaseAvailable, fetchWithRetry]);

  const fetchMonthlyStats = useCallback(async (month?: Date) => {
    if (!supabaseAvailable) return;
    setLoading(true);
    try {
      const targetMonth = month || new Date();
      const monthStr = targetMonth.toISOString().slice(0, 7);
      const data = await fetchWithRetry(async () => {
        const { data, error: err } = await supabase
          .from('monthly_duty_stats')
          .select('*')
          .ilike('month', `${monthStr}%`)
          .order('name', { ascending: true });
        if (err) throw err;
        return data || [];
      });
      if (isMountedRef.current) setMonthlyStats(data as MonthlyDutyStats[]);
    } catch (err) {
      if (isMountedRef.current) setError(parseError(err));
    } finally {
      if (isMountedRef.current) setLoading(false);
    }
  }, [supabaseAvailable, fetchWithRetry]);

  const getOfficersOnDuty = useCallback(async (date?: Date): Promise<TodayDutySummary[]> => {
    if (!supabaseAvailable) return [];
    const dateStr = (date || new Date()).toISOString().split('T')[0];
    setLoading(true);
    try {
      const data = await fetchWithRetry(async () => {
        const { data, error: err } = await supabase.rpc('get_officers_on_duty', { p_date: dateStr });
        if (err) throw err;
        return data || [];
      });
      return (data as { officer_id: string; name: string; rank: string; badge_number: string | null; unit: string; time_in: string; time_out: string | null }[]).map(o => ({
        officer_id: o.officer_id, name: o.name, rank: o.rank, badge_number: o.badge_number,
        unit: o.unit, current_status: 'on-duty' as const, duty_record_id: null,
        time_in: o.time_in, time_out: o.time_out, duty_date: dateStr,
      }));
    } catch (err) { setError(parseError(err)); return []; }
    finally { setLoading(false); }
  }, [supabaseAvailable, fetchWithRetry]);

  const getDutyStats = useCallback(async (startDate: Date, endDate: Date) => {
    if (!supabaseAvailable) return [];
    setLoading(true);
    try {
      const data = await fetchWithRetry(async () => {
        const { data, error: err } = await supabase.rpc('get_duty_stats', {
          p_start_date: startDate.toISOString().split('T')[0],
          p_end_date: endDate.toISOString().split('T')[0],
        });
        if (err) throw err;
        return data || [];
      });
      return data as { duty_date: string; total_officers: number; officers_on_duty: number; officers_off_duty: number }[];
    } catch (err) { setError(parseError(err)); return []; }
    finally { setLoading(false); }
  }, [supabaseAvailable, fetchWithRetry]);

  const refreshData = useCallback(async () => {
    await Promise.all([fetchDutyRecords(), fetchTodaySummary()]);
  }, [fetchDutyRecords, fetchTodaySummary]);

  const retryConnection = useCallback(async () => {
    retryAttemptRef.current = 0;
    await refreshData();
  }, [refreshData]);

  // ============================================================================
  // NO realtime subscription — removed to eliminate persistent egress
  // ============================================================================

  // ============================================================================
  // Initial Fetch — serve from fresh cache when possible
  // ============================================================================
  useEffect(() => {
    if (supabaseAvailable) {
      const { records, isFresh } = loadFromLocalBackup();
      if (isFresh && records.length > 0) {
        setDutyRecords(records);
        setConnectionStatus('connected');
        // Still refresh summary (lightweight)
        fetchTodaySummary();
      } else {
        fetchDutyRecords();
        fetchTodaySummary();
      }
    } else {
      const { records } = loadFromLocalBackup();
      if (records.length > 0) setDutyRecords(records);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabaseAvailable]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);

  return {
    dutyRecords, todaySummary, monthlyStats, loading, error, isRetrying, connectionStatus,
    fetchDutyRecords, fetchDutyRecordsForOfficer, fetchDutyRecordsForDate,
    checkInOfficer, checkOutOfficer, addDutyRecord, updateDutyRecord, deleteDutyRecord,
    fetchTodaySummary, fetchMonthlyStats, getOfficersOnDuty, getDutyStats,
    refreshData, retryConnection, onDutyRecordsChange,
  };
}
