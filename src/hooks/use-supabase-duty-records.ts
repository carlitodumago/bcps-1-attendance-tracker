// ============================================================================
// Production-Ready Supabase Duty Records Hook
// Handles all duty record operations with Supabase
// Features: Real-time updates, error handling, retry logic, optimistic updates
// ============================================================================

import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import type { DutyRecord, DutyRecordInsert, DutyRecordUpdate, TodayDutySummary, MonthlyDutyStats } from '../types/database';

// ============================================================================
// Types
// ============================================================================

interface QueryOptions {
  orderBy?: { column: keyof DutyRecord; ascending?: boolean };
  filters?: { column: keyof DutyRecord; value: unknown; operator?: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' }[];
  limit?: number;
  offset?: number;
}

interface RetryConfig {
  maxRetries: number;
  baseDelay: number;
  maxDelay: number;
}

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

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 5,
  baseDelay: 1000,
  maxDelay: 30000,
};

const DUTY_RECORDS_STORAGE_KEY = 'bcps-1-duty-records-backup';

// ============================================================================
// Utility Functions
// ============================================================================

const getRetryDelay = (attempt: number, config: RetryConfig): number => {
  const exponentialDelay = config.baseDelay * Math.pow(2, attempt);
  return Math.min(exponentialDelay, config.maxDelay);
};

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

const parseError = (error: unknown): string => {
  if (error instanceof Error) {
    const message = error.message;
    
    if (message.includes('23505')) {
      return 'This duty record already exists.';
    }
    if (message.includes('23503')) {
      return 'Officer not found.';
    }
    if (message.includes('P0001') || message.includes('Officer already checked in')) {
      return 'Officer is already checked in for today.';
    }
    if (message.includes('No active duty record')) {
      return 'No active duty record found for this officer.';
    }
    if (message.includes('42501') || message.includes('insufficient privilege')) {
      return 'Permission denied. Please check your access rights.';
    }
    if (message.includes('RLS')) {
      return 'Access denied by security policy.';
    }
    if (message.includes('network') || message.includes('fetch') || message.includes('ECONNREFUSED')) {
      return 'Network connection failed. Please check your internet connection.';
    }
    if (message.includes('timeout') || message.includes('408')) {
      return 'Request timed out. Please try again.';
    }
    
    return message;
  }
  return 'An unexpected error occurred. Please try again.';
};

const saveToLocalBackup = (records: DutyRecord[]): void => {
  try {
    localStorage.setItem(DUTY_RECORDS_STORAGE_KEY, JSON.stringify(records));
  } catch (err) {
    console.error('Failed to save duty records backup:', err);
  }
};

const loadFromLocalBackup = (): DutyRecord[] => {
  try {
    const stored = localStorage.getItem(DUTY_RECORDS_STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (err) {
    console.error('Failed to load duty records backup:', err);
  }
  return [];
};

// ============================================================================
// Hook Implementation
// ============================================================================

export function useSupabaseDutyRecords(retryConfig: RetryConfig = DEFAULT_RETRY_CONFIG): UseSupabaseDutyRecordsReturn {
  const [dutyRecords, setDutyRecords] = useState<DutyRecord[]>([]);
  const [todaySummary, setTodaySummary] = useState<TodayDutySummary[]>([]);
  const [monthlyStats, setMonthlyStats] = useState<MonthlyDutyStats[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isRetrying, setIsRetrying] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'connected' | 'disconnected' | 'reconnecting'>('connected');

  const subscriptionRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const retryAttemptRef = useRef(0);
  const isMountedRef = useRef(true);
  const dutyRecordsChangeCallbacks = useRef<Set<(officerId?: string, status?: 'on-duty' | 'off-duty', dutyRecord?: DutyRecord) => void>>(new Set());

  const supabaseAvailable = isSupabaseConfigured();

  // Callback registration for duty records changes
  const onDutyRecordsChange = useCallback((callback: (officerId?: string, status?: 'on-duty' | 'off-duty', dutyRecord?: DutyRecord) => void) => {
    dutyRecordsChangeCallbacks.current.add(callback);
    return () => {
      dutyRecordsChangeCallbacks.current.delete(callback);
    };
  }, []);

  const notifyDutyRecordsChange = useCallback((officerId?: string, status?: 'on-duty' | 'off-duty', dutyRecord?: DutyRecord) => {
    dutyRecordsChangeCallbacks.current.forEach(callback => {
      try {
        callback(officerId, status, dutyRecord);
      } catch (err) {
        console.error('Error in duty records change callback:', err);
      }
    });
  }, []);

  // ============================================================================
  // Core Fetch with Retry Logic
  // ============================================================================
  const fetchWithRetry = useCallback(async <T,>(
    fetchFn: () => Promise<T>,
    attempt: number = 0
  ): Promise<T> => {
    try {
      const result = await fetchFn();
      retryAttemptRef.current = 0;
      if (isMountedRef.current) {
        setConnectionStatus('connected');
      }
      return result;
    } catch (err) {
      const errorMessage = parseError(err);
      const isRetryableError = 
        errorMessage.includes('network') ||
        errorMessage.includes('timeout') ||
        errorMessage.includes('ECONNREFUSED');

      if (isRetryableError && attempt < retryConfig.maxRetries) {
        const delay = getRetryDelay(attempt, retryConfig);
        if (isMountedRef.current) {
          setIsRetrying(true);
          setConnectionStatus('reconnecting');
        }
        await sleep(delay);
        if (isMountedRef.current) {
          retryAttemptRef.current = attempt + 1;
          return fetchWithRetry(fetchFn, attempt + 1);
        }
      }
      throw err;
    }
  }, [retryConfig]);

  // ============================================================================
  // Fetch All Duty Records
  // ============================================================================
  const fetchDutyRecords = useCallback(async (options?: QueryOptions) => {
    if (!supabaseAvailable) {
      setError('Supabase is not configured');
      setConnectionStatus('disconnected');
      const backup = loadFromLocalBackup();
      setDutyRecords(backup);
      return;
    }

    setLoading(true);
    setError(null);
    setIsRetrying(false);

    try {
      const data = await fetchWithRetry(async () => {
        let query = supabase.from('duty_records').select('*');

        if (options?.filters) {
          options.filters.forEach(filter => {
            const op = filter.operator || 'eq';
            const value = filter.value;
            switch (op) {
              case 'eq': query = query.eq(filter.column as string, value as string); break;
              case 'neq': query = query.neq(filter.column as string, value as string); break;
              case 'gt': query = query.gt(filter.column as string, value as number); break;
              case 'gte': query = query.gte(filter.column as string, value as number); break;
              case 'lt': query = query.lt(filter.column as string, value as number); break;
              case 'lte': query = query.lte(filter.column as string, value as number); break;
            }
          });
        }

        if (options?.orderBy) {
          query = query.order(options.orderBy.column, { ascending: options.orderBy.ascending ?? false });
        } else {
          query = query.order('duty_date', { ascending: false });
        }

        if (options?.limit) query = query.limit(options.limit);
        if (options?.offset) query = query.range(options.offset, options.offset + (options.limit || 1000) - 1);

        const { data, error: supabaseError } = await query;
        if (supabaseError) throw supabaseError;
        return data || [];
      });

      if (isMountedRef.current) {
        setDutyRecords(data);
        saveToLocalBackup(data);
      }
    } catch (err) {
      if (isMountedRef.current) {
        setError(parseError(err));
        setConnectionStatus('disconnected');
        const backup = loadFromLocalBackup();
        if (backup.length > 0) setDutyRecords(backup);
      }
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
        setIsRetrying(false);
      }
    }
  }, [supabaseAvailable, fetchWithRetry]);

  // ============================================================================
  // Fetch Duty Records for Officer
  // ============================================================================
  const fetchDutyRecordsForOfficer = useCallback(async (officerId: string, options?: QueryOptions): Promise<DutyRecord[]> => {
    if (!supabaseAvailable) {
      // Fallback to local data
      return dutyRecords.filter(r => r.officer_id === officerId);
    }

    setLoading(true);
    setError(null);

    try {
      const data = await fetchWithRetry(async () => {
        let query = supabase
          .from('duty_records')
          .select('*')
          .eq('officer_id', officerId);

        if (options?.orderBy) {
          query = query.order(options.orderBy.column, { ascending: options.orderBy.ascending ?? false });
        } else {
          query = query.order('duty_date', { ascending: false });
        }

        const { data, error: supabaseError } = await query;
        if (supabaseError) throw supabaseError;
        return data || [];
      });

      return data;
    } catch (err) {
      setError(parseError(err));
      return dutyRecords.filter(r => r.officer_id === officerId);
    } finally {
      setLoading(false);
    }
  }, [supabaseAvailable, dutyRecords, fetchWithRetry]);

  // ============================================================================
  // Fetch Duty Records for Date
  // ============================================================================
  const fetchDutyRecordsForDate = useCallback(async (date: Date): Promise<DutyRecord[]> => {
    const dateStr = date.toISOString().split('T')[0];
    
    if (!supabaseAvailable) {
      return dutyRecords.filter(r => r.duty_date === dateStr);
    }

    setLoading(true);
    setError(null);

    try {
      const data = await fetchWithRetry(async () => {
        const { data, error: supabaseError } = await supabase
          .from('duty_records')
          .select('*')
          .eq('duty_date', dateStr);

        if (supabaseError) throw supabaseError;
        return data || [];
      });

      return data;
    } catch (err) {
      setError(parseError(err));
      return dutyRecords.filter(r => r.duty_date === dateStr);
    } finally {
      setLoading(false);
    }
  }, [supabaseAvailable, dutyRecords, fetchWithRetry]);

  // ============================================================================
  // Check In Officer (with stored procedure)
  // ============================================================================
  const checkInOfficer = useCallback(async (officerId: string, notes?: string): Promise<DutyRecord | null> => {
    if (!supabaseAvailable) {
      setError('Supabase is not configured');
      return null;
    }

    setLoading(true);
    setError(null);

    try {
      const data = await fetchWithRetry(async () => {
        const { data: recordId, error: functionError } = await supabase
          .rpc('check_in_officer', {
            p_officer_id: officerId,
            p_notes: notes,
          });

        if (functionError) throw functionError;

        const { data, error: fetchError } = await supabase
          .from('duty_records')
          .select('*')
          .eq('id', recordId)
          .single();

        if (fetchError) throw fetchError;
        return data;
      });

      if (data && isMountedRef.current) {
        setDutyRecords(prev => [data, ...prev]);
        saveToLocalBackup([data, ...dutyRecords]);
      }

      return data;
    } catch (err) {
      if (isMountedRef.current) {
        setError(parseError(err));
      }
      return null;
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  }, [supabaseAvailable, dutyRecords, fetchWithRetry]);

  // ============================================================================
  // Check Out Officer (with stored procedure)
  // ============================================================================
  const checkOutOfficer = useCallback(async (officerId: string): Promise<boolean> => {
    console.log('=== checkOutOfficer START ===');
    console.log('supabaseAvailable:', supabaseAvailable);
    console.log('officerId:', officerId);
    
    if (!supabaseAvailable) {
      console.log('Supabase not available');
      setError('Supabase is not configured');
      return false;
    }

    setLoading(true);
    setError(null);

    try {
      // First, try the RPC
      console.log('Attempting check_out_officer RPC...');
      const { data, error: functionError } = await supabase
        .rpc('check_out_officer', { p_officer_id: officerId });

      console.log('RPC response - data:', data, 'error:', functionError);
      
      if (functionError) {
        console.log('RPC failed, trying direct update method...');
        
        // Fallback: Find the active duty record and update it directly
        const { data: activeRecords, error: fetchError } = await supabase
          .from('duty_records')
          .select('*')
          .eq('officer_id', officerId)
          .is('time_out', null)
          .order('duty_date', { ascending: false })
          .limit(1);

        if (fetchError) {
          console.error('Error fetching active record:', fetchError);
          throw fetchError;
        }

        if (!activeRecords || activeRecords.length === 0) {
          console.log('No active duty record found, updating officer status directly');
          
          // Just update the officer's status to off-duty
          const { error: updateError } = await supabase
            .from('officers')
            .update({ current_status: 'off-duty' })
            .eq('id', officerId);

          if (updateError) {
            console.error('Error updating officer status:', updateError);
            throw updateError;
          }
          
          await fetchDutyRecords();
          console.log('=== checkOutOfficer SUCCESS (direct update) ===');
          return true;
        }

        // Update the active duty record with time_out
        const activeRecord = activeRecords[0];
        // Get current time as-is
        const now = new Date();
        const timeOut = now.toTimeString().slice(0, 8); // HH:MM:SS format

        const { error: updateError } = await supabase
          .from('duty_records')
          .update({ time_out: timeOut })
          .eq('id', activeRecord.id);

        if (updateError) {
          console.error('Error updating duty record:', updateError);
          throw updateError;
        }

        // Also update officer status
        await supabase
          .from('officers')
          .update({ current_status: 'off-duty' })
          .eq('id', officerId);
      }

      await fetchDutyRecords();
      console.log('=== checkOutOfficer SUCCESS ===');
      return true;
    } catch (err) {
      console.error('=== checkOutOfficer ERROR ===', err);
      const errorMsg = parseError(err);
      setError(errorMsg);
      return false;
    } finally {
      setLoading(false);
    }
  }, [supabaseAvailable, fetchDutyRecords]);

  // ============================================================================
  // Add Duty Record Manually
  // ============================================================================
  const addDutyRecord = useCallback(async (
    record: Omit<DutyRecordInsert, 'id' | 'created_at' | 'updated_at'>
  ): Promise<DutyRecord | null> => {
    if (!supabaseAvailable) {
      setError('Supabase is not configured');
      return null;
    }

    const tempId = `temp-${Date.now()}`;
    // Always set time_out to prevent triggering the officer status update
    // Calendar assignments should NOT change officer status
    // Use 23:59:59 to ensure it's always after time_in
    const timeOutValue = record.time_out ?? '23:59:59';
    const recordWithTimeOut = {
      ...record,
      time_out: timeOutValue
    };
    
    const optimisticRecord: DutyRecord = {
      id: tempId,
      officer_id: record.officer_id,
      duty_date: record.duty_date,
      time_in: record.time_in,
      time_out: timeOutValue,
      notes: record.notes || null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    setDutyRecords(prev => [optimisticRecord, ...prev]);

    try {
      console.log('Inserting duty record:', recordWithTimeOut);
      const data = await fetchWithRetry(async () => {
        const { data, error: supabaseError } = await supabase
          .from('duty_records')
          .insert([recordWithTimeOut])
          .select()
          .single();

        if (supabaseError) {
          console.error('Supabase insert error:', supabaseError);
          throw supabaseError;
        }
        console.log('Insert result:', data);
        return data;
      });

      if (data && isMountedRef.current) {
        setDutyRecords(prev => prev.map(r => r.id === tempId ? data : r));
        saveToLocalBackup(dutyRecords.map(r => r.id === tempId ? data : r));
      }

      return data;
    } catch (err) {
      if (isMountedRef.current) {
        setDutyRecords(prev => prev.filter(r => r.id !== tempId));
        setError(parseError(err));
      }
      return null;
    }
  }, [supabaseAvailable, dutyRecords, fetchWithRetry]);

  // ============================================================================
  // Update Duty Record
  // ============================================================================
  const updateDutyRecord = useCallback(async (id: string, record: DutyRecordUpdate): Promise<DutyRecord | null> => {
    if (!supabaseAvailable) {
      setError('Supabase is not configured');
      return null;
    }

    const originalRecord = dutyRecords.find(r => r.id === id);
    if (!originalRecord) return null;

    setDutyRecords(prev =>
      prev.map(r => (r.id === id ? { ...r, ...record, updated_at: new Date().toISOString() } : r))
    );

    try {
      const data = await fetchWithRetry(async () => {
        const { data, error: supabaseError } = await supabase
          .from('duty_records')
          .update({ ...record, updated_at: new Date().toISOString() })
          .eq('id', id)
          .select()
          .single();

        if (supabaseError) throw supabaseError;
        return data;
      });

      if (data && isMountedRef.current) {
        setDutyRecords(prev => prev.map(r => (r.id === id ? data : r)));
        saveToLocalBackup(dutyRecords.map(r => r.id === id ? data : r));
      }

      return data;
    } catch (err) {
      if (isMountedRef.current) {
        setDutyRecords(prev => prev.map(r => (r.id === id ? originalRecord : r)));
        setError(parseError(err));
      }
      return null;
    }
  }, [supabaseAvailable, dutyRecords, fetchWithRetry]);

  // ============================================================================
  // Delete Duty Record
  // ============================================================================
  const deleteDutyRecord = useCallback(async (id: string): Promise<boolean> => {
    if (!supabaseAvailable) {
      setError('Supabase is not configured');
      return false;
    }

    const originalRecord = dutyRecords.find(r => r.id === id);
    setDutyRecords(prev => prev.filter(r => r.id !== id));

    try {
      await fetchWithRetry(async () => {
        const { error: supabaseError } = await supabase
          .from('duty_records')
          .delete()
          .eq('id', id);

        if (supabaseError) throw supabaseError;
      });

      if (isMountedRef.current) {
        saveToLocalBackup(dutyRecords.filter(r => r.id !== id));
      }
      return true;
    } catch (err) {
      if (isMountedRef.current && originalRecord) {
        setDutyRecords(prev => [...prev, originalRecord]);
        setError(parseError(err));
      }
      return false;
    }
  }, [supabaseAvailable, dutyRecords, fetchWithRetry]);

  // ============================================================================
  // Fetch Today Summary
  // ============================================================================
  const fetchTodaySummary = useCallback(async () => {
    if (!supabaseAvailable) {
      setError('Supabase is not configured');
      return;
    }

    setLoading(true);
    try {
      const data = await fetchWithRetry(async () => {
        const { data, error: supabaseError } = await supabase
          .from('today_duty_summary')
          .select('*')
          .order('name', { ascending: true });

        if (supabaseError) throw supabaseError;
        return data || [];
      });

      if (isMountedRef.current) {
        setTodaySummary(data);
      }
    } catch (err) {
      if (isMountedRef.current) {
        setError(parseError(err));
      }
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  }, [supabaseAvailable, fetchWithRetry]);

  // ============================================================================
  // Fetch Monthly Stats
  // ============================================================================
  const fetchMonthlyStats = useCallback(async (month?: Date) => {
    if (!supabaseAvailable) {
      setError('Supabase is not configured');
      return;
    }

    setLoading(true);
    try {
      const targetMonth = month || new Date();
      const monthStr = targetMonth.toISOString().slice(0, 7);

      const data = await fetchWithRetry(async () => {
        const { data, error: supabaseError } = await supabase
          .from('monthly_duty_stats')
          .select('*')
          .ilike('month', `${monthStr}%`)
          .order('name', { ascending: true });

        if (supabaseError) throw supabaseError;
        return data || [];
      });

      if (isMountedRef.current) {
        setMonthlyStats(data);
      }
    } catch (err) {
      if (isMountedRef.current) {
        setError(parseError(err));
      }
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  }, [supabaseAvailable, fetchWithRetry]);

  // ============================================================================
  // Get Officers On Duty
  // ============================================================================
  const getOfficersOnDuty = useCallback(async (date?: Date): Promise<TodayDutySummary[]> => {
    if (!supabaseAvailable) {
      return [];
    }

    const targetDate = date || new Date();
    const dateStr = targetDate.toISOString().split('T')[0];

    setLoading(true);
    try {
      const data = await fetchWithRetry(async () => {
        const { data, error: supabaseError } = await supabase
          .rpc('get_officers_on_duty', { p_date: dateStr });

        if (supabaseError) throw supabaseError;
        return data || [];
      });

      return data.map((officer: {
        officer_id: string;
        name: string;
        rank: string;
        badge_number: string | null;
        unit: string;
        time_in: string;
        time_out: string | null;
      }) => ({
        officer_id: officer.officer_id,
        name: officer.name,
        rank: officer.rank,
        badge_number: officer.badge_number,
        unit: officer.unit,
        current_status: 'on-duty',
        duty_record_id: null,
        time_in: officer.time_in,
        time_out: officer.time_out,
        duty_date: dateStr,
      }));
    } catch (err) {
      setError(parseError(err));
      return [];
    } finally {
      setLoading(false);
    }
  }, [supabaseAvailable, fetchWithRetry]);

  // ============================================================================
  // Get Duty Stats
  // ============================================================================
  const getDutyStats = useCallback(async (
    startDate: Date,
    endDate: Date
  ): Promise<{ duty_date: string; total_officers: number; officers_on_duty: number; officers_off_duty: number }[]> => {
    if (!supabaseAvailable) {
      return [];
    }

    const startStr = startDate.toISOString().split('T')[0];
    const endStr = endDate.toISOString().split('T')[0];

    setLoading(true);
    try {
      const data = await fetchWithRetry(async () => {
        const { data, error: supabaseError } = await supabase
          .rpc('get_duty_stats', {
            p_start_date: startStr,
            p_end_date: endStr,
          });

        if (supabaseError) throw supabaseError;
        return data || [];
      });

      return data;
    } catch (err) {
      setError(parseError(err));
      return [];
    } finally {
      setLoading(false);
    }
  }, [supabaseAvailable, fetchWithRetry]);

  // ============================================================================
  // Refresh and Retry Methods
  // ============================================================================
  const refreshData = useCallback(async () => {
    await Promise.all([
      fetchDutyRecords(),
      fetchTodaySummary(),
    ]);
  }, [fetchDutyRecords, fetchTodaySummary]);

  const retryConnection = useCallback(async () => {
    retryAttemptRef.current = 0;
    await refreshData();
  }, [refreshData]);

  // ============================================================================
  // Real-time Subscription
  // ============================================================================
  useEffect(() => {
    if (!supabaseAvailable) return;

    const setupSubscription = () => {
      if (subscriptionRef.current) {
        subscriptionRef.current.unsubscribe();
      }

      subscriptionRef.current = supabase
        .channel('duty_records_changes')
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'duty_records' },
          (payload) => {
            if (!isMountedRef.current) return;

            if (payload.eventType === 'INSERT') {
              const newRecord = payload.new as DutyRecord;
              setDutyRecords(prev => {
                if (prev.find(r => r.id === newRecord.id)) return prev;
                return [newRecord, ...prev];
              });
              // Don't change officer status - just record the duty for calendar
            } else if (payload.eventType === 'UPDATE') {
              const updatedRecord = payload.new as DutyRecord;
              setDutyRecords(prev =>
                prev.map(r => (r.id === updatedRecord.id ? updatedRecord : r))
              );
              // Don't change officer status - calendar only
            } else if (payload.eventType === 'DELETE') {
              const deletedRecord = payload.old as DutyRecord;
              setDutyRecords(prev => prev.filter(r => r.id !== payload.old.id));
              // Don't change officer status - calendar only
            }

            setDutyRecords(current => {
              saveToLocalBackup(current);
              return current;
            });
            fetchTodaySummary();
          }
        )
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            setConnectionStatus('connected');
          } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
            setConnectionStatus('disconnected');
          }
        });
    };

    setupSubscription();

    return () => {
      if (subscriptionRef.current) {
        subscriptionRef.current.unsubscribe();
        subscriptionRef.current = null;
      }
    };
  }, [supabaseAvailable, fetchTodaySummary]);

  // ============================================================================
  // Initial Fetch
  // ============================================================================
  useEffect(() => {
    if (supabaseAvailable) {
      fetchDutyRecords();
      fetchTodaySummary();
    } else {
      const backup = loadFromLocalBackup();
      if (backup.length > 0) {
        setDutyRecords(backup);
      }
    }
  }, [supabaseAvailable, fetchDutyRecords, fetchTodaySummary]);

  // ============================================================================
  // Cleanup
  // ============================================================================
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (subscriptionRef.current) {
        subscriptionRef.current.unsubscribe();
      }
    };
  }, []);

  return {
    dutyRecords,
    todaySummary,
    monthlyStats,
    loading,
    error,
    isRetrying,
    connectionStatus,
    fetchDutyRecords,
    fetchDutyRecordsForOfficer,
    fetchDutyRecordsForDate,
    checkInOfficer,
    checkOutOfficer,
    addDutyRecord,
    updateDutyRecord,
    deleteDutyRecord,
    fetchTodaySummary,
    fetchMonthlyStats,
    getOfficersOnDuty,
    getDutyStats,
    refreshData,
    retryConnection,
    onDutyRecordsChange,
  };
}
