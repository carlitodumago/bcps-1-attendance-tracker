// ============================================================================
// Supabase Duty Records Hook
// Handles all duty record operations with Supabase
// ============================================================================

import { useState, useEffect, useCallback } from 'react';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import type { DutyRecord, DutyRecordInsert, DutyRecordUpdate, TodayDutySummary, MonthlyDutyStats } from '../types/database';

interface UseSupabaseDutyRecordsReturn {
  dutyRecords: DutyRecord[];
  todaySummary: TodayDutySummary[];
  monthlyStats: MonthlyDutyStats[];
  loading: boolean;
  error: string | null;
  fetchDutyRecords: () => Promise<void>;
  fetchDutyRecordsForOfficer: (officerId: string) => Promise<DutyRecord[]>;
  fetchDutyRecordsForDate: (date: Date) => Promise<DutyRecord[]>;
  checkInOfficer: (officerId: string, notes?: string) => Promise<DutyRecord | null>;
  checkOutOfficer: (officerId: string) => Promise<boolean>;
  addDutyRecord: (record: Omit<DutyRecordInsert, 'id' | 'created_at' | 'updated_at'>) => Promise<DutyRecord | null>;
  updateDutyRecord: (id: string, record: DutyRecordUpdate) => Promise<DutyRecord | null>;
  deleteDutyRecord: (id: string) => Promise<boolean>;
  fetchTodaySummary: () => Promise<void>;
  fetchMonthlyStats: (month?: Date) => Promise<void>;
  getOfficersOnDuty: (date?: Date) => Promise<TodayDutySummary[]>;
  getDutyStats: (startDate: Date, endDate: Date) => Promise<{ duty_date: string; total_officers: number; officers_on_duty: number; officers_off_duty: number }[]>;
}

export function useSupabaseDutyRecords(): UseSupabaseDutyRecordsReturn {
  const [dutyRecords, setDutyRecords] = useState<DutyRecord[]>([]);
  const [todaySummary, setTodaySummary] = useState<TodayDutySummary[]>([]);
  const [monthlyStats, setMonthlyStats] = useState<MonthlyDutyStats[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const supabaseAvailable = isSupabaseConfigured();

  // Fetch all duty records
  const fetchDutyRecords = useCallback(async () => {
    if (!supabaseAvailable) {
      setError('Supabase is not configured');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const { data, error: supabaseError } = await supabase
        .from('duty_records')
        .select('*')
        .order('duty_date', { ascending: false });

      if (supabaseError) {
        throw supabaseError;
      }

      setDutyRecords(data || []);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to fetch duty records';
      setError(errorMessage);
      console.error('Error fetching duty records:', err);
    } finally {
      setLoading(false);
    }
  }, [supabaseAvailable]);

  // Fetch duty records for a specific officer
  const fetchDutyRecordsForOfficer = useCallback(async (officerId: string): Promise<DutyRecord[]> => {
    if (!supabaseAvailable) {
      setError('Supabase is not configured');
      return [];
    }

    setLoading(true);
    setError(null);

    try {
      const { data, error: supabaseError } = await supabase
        .from('duty_records')
        .select('*')
        .eq('officer_id', officerId)
        .order('duty_date', { ascending: false });

      if (supabaseError) {
        throw supabaseError;
      }

      return data || [];
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to fetch duty records';
      setError(errorMessage);
      console.error('Error fetching duty records:', err);
      return [];
    } finally {
      setLoading(false);
    }
  }, [supabaseAvailable]);

  // Fetch duty records for a specific date
  const fetchDutyRecordsForDate = useCallback(async (date: Date): Promise<DutyRecord[]> => {
    if (!supabaseAvailable) {
      setError('Supabase is not configured');
      return [];
    }

    const dateStr = date.toISOString().split('T')[0];
    setLoading(true);
    setError(null);

    try {
      const { data, error: supabaseError } = await supabase
        .from('duty_records')
        .select('*')
        .eq('duty_date', dateStr);

      if (supabaseError) {
        throw supabaseError;
      }

      return data || [];
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to fetch duty records';
      setError(errorMessage);
      console.error('Error fetching duty records:', err);
      return [];
    } finally {
      setLoading(false);
    }
  }, [supabaseAvailable]);

  // Check in an officer (using the stored procedure)
  const checkInOfficer = useCallback(async (officerId: string, notes?: string): Promise<DutyRecord | null> => {
    if (!supabaseAvailable) {
      setError('Supabase is not configured');
      return null;
    }

    setLoading(true);
    setError(null);

    try {
      // Call the check_in_officer function
      const { data: recordId, error: functionError } = await supabase
        .rpc('check_in_officer', {
          p_officer_id: officerId,
          p_notes: notes,
        });

      if (functionError) {
        throw functionError;
      }

      // Fetch the created record
      const { data, error: fetchError } = await supabase
        .from('duty_records')
        .select('*')
        .eq('id', recordId)
        .single();

      if (fetchError) {
        throw fetchError;
      }

      if (data) {
        setDutyRecords(prev => [data, ...prev]);
      }

      return data;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to check in officer';
      setError(errorMessage);
      console.error('Error checking in officer:', err);
      return null;
    } finally {
      setLoading(false);
    }
  }, [supabaseAvailable]);

  // Check out an officer (using the stored procedure)
  const checkOutOfficer = useCallback(async (officerId: string): Promise<boolean> => {
    if (!supabaseAvailable) {
      setError('Supabase is not configured');
      return false;
    }

    setLoading(true);
    setError(null);

    try {
      const { error: functionError } = await supabase
        .rpc('check_out_officer', {
          p_officer_id: officerId,
        });

      if (functionError) {
        throw functionError;
      }

      // Refresh duty records
      await fetchDutyRecords();
      return true;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to check out officer';
      setError(errorMessage);
      console.error('Error checking out officer:', err);
      return false;
    } finally {
      setLoading(false);
    }
  }, [supabaseAvailable, fetchDutyRecords]);

  // Add a new duty record manually
  const addDutyRecord = useCallback(async (
    record: Omit<DutyRecordInsert, 'id' | 'created_at' | 'updated_at'>
  ): Promise<DutyRecord | null> => {
    if (!supabaseAvailable) {
      setError('Supabase is not configured');
      return null;
    }

    setLoading(true);
    setError(null);

    try {
      const { data, error: supabaseError } = await supabase
        .from('duty_records')
        .insert([record])
        .select()
        .single();

      if (supabaseError) {
        throw supabaseError;
      }

      if (data) {
        setDutyRecords(prev => [data, ...prev]);
      }

      return data;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to add duty record';
      setError(errorMessage);
      console.error('Error adding duty record:', err);
      return null;
    } finally {
      setLoading(false);
    }
  }, [supabaseAvailable]);

  // Update a duty record
  const updateDutyRecord = useCallback(async (
    id: string,
    record: DutyRecordUpdate
  ): Promise<DutyRecord | null> => {
    if (!supabaseAvailable) {
      setError('Supabase is not configured');
      return null;
    }

    setLoading(true);
    setError(null);

    try {
      const { data, error: supabaseError } = await supabase
        .from('duty_records')
        .update({ ...record, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single();

      if (supabaseError) {
        throw supabaseError;
      }

      if (data) {
        setDutyRecords(prev =>
          prev.map(r => (r.id === id ? data : r))
        );
      }

      return data;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to update duty record';
      setError(errorMessage);
      console.error('Error updating duty record:', err);
      return null;
    } finally {
      setLoading(false);
    }
  }, [supabaseAvailable]);

  // Delete a duty record
  const deleteDutyRecord = useCallback(async (id: string): Promise<boolean> => {
    if (!supabaseAvailable) {
      setError('Supabase is not configured');
      return false;
    }

    setLoading(true);
    setError(null);

    try {
      const { error: supabaseError } = await supabase
        .from('duty_records')
        .delete()
        .eq('id', id);

      if (supabaseError) {
        throw supabaseError;
      }

      setDutyRecords(prev => prev.filter(r => r.id !== id));
      return true;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to delete duty record';
      setError(errorMessage);
      console.error('Error deleting duty record:', err);
      return false;
    } finally {
      setLoading(false);
    }
  }, [supabaseAvailable]);

  // Fetch today's duty summary
  const fetchTodaySummary = useCallback(async () => {
    if (!supabaseAvailable) {
      setError('Supabase is not configured');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const { data, error: supabaseError } = await supabase
        .from('today_duty_summary')
        .select('*')
        .order('name', { ascending: true });

      if (supabaseError) {
        throw supabaseError;
      }

      setTodaySummary(data || []);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to fetch today summary';
      setError(errorMessage);
      console.error('Error fetching today summary:', err);
    } finally {
      setLoading(false);
    }
  }, [supabaseAvailable]);

  // Fetch monthly statistics
  const fetchMonthlyStats = useCallback(async (month?: Date) => {
    if (!supabaseAvailable) {
      setError('Supabase is not configured');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const targetMonth = month || new Date();
      const monthStr = targetMonth.toISOString().slice(0, 7); // YYYY-MM

      const { data, error: supabaseError } = await supabase
        .from('monthly_duty_stats')
        .select('*')
        .ilike('month', `${monthStr}%`)
        .order('name', { ascending: true });

      if (supabaseError) {
        throw supabaseError;
      }

      setMonthlyStats(data || []);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to fetch monthly stats';
      setError(errorMessage);
      console.error('Error fetching monthly stats:', err);
    } finally {
      setLoading(false);
    }
  }, [supabaseAvailable]);

  // Get officers on duty for a specific date
  const getOfficersOnDuty = useCallback(async (date?: Date): Promise<TodayDutySummary[]> => {
    if (!supabaseAvailable) {
      setError('Supabase is not configured');
      return [];
    }

    const targetDate = date || new Date();
    const dateStr = targetDate.toISOString().split('T')[0];

    setLoading(true);
    setError(null);

    try {
      const { data, error: supabaseError } = await supabase
        .rpc('get_officers_on_duty', { p_date: dateStr });

      if (supabaseError) {
        throw supabaseError;
      }

      // Map the RPC result to TodayDutySummary format
      return (data || []).map((officer: {
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
      const errorMessage = err instanceof Error ? err.message : 'Failed to get officers on duty';
      setError(errorMessage);
      console.error('Error getting officers on duty:', err);
      return [];
    } finally {
      setLoading(false);
    }
  }, [supabaseAvailable]);

  // Get duty statistics for a date range
  const getDutyStats = useCallback(async (
    startDate: Date,
    endDate: Date
  ): Promise<{ duty_date: string; total_officers: number; officers_on_duty: number; officers_off_duty: number }[]> => {
    if (!supabaseAvailable) {
      setError('Supabase is not configured');
      return [];
    }

    const startStr = startDate.toISOString().split('T')[0];
    const endStr = endDate.toISOString().split('T')[0];

    setLoading(true);
    setError(null);

    try {
      const { data, error: supabaseError } = await supabase
        .rpc('get_duty_stats', {
          p_start_date: startStr,
          p_end_date: endStr,
        });

      if (supabaseError) {
        throw supabaseError;
      }

      return data || [];
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to get duty stats';
      setError(errorMessage);
      console.error('Error getting duty stats:', err);
      return [];
    } finally {
      setLoading(false);
    }
  }, [supabaseAvailable]);

  // Subscribe to real-time changes
  useEffect(() => {
    if (!supabaseAvailable) return;

    const subscription = supabase
      .channel('duty_records_changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'duty_records' },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            setDutyRecords(prev => [payload.new as DutyRecord, ...prev]);
          } else if (payload.eventType === 'UPDATE') {
            setDutyRecords(prev =>
              prev.map(r => (r.id === payload.new.id ? payload.new as DutyRecord : r))
            );
          } else if (payload.eventType === 'DELETE') {
            setDutyRecords(prev => prev.filter(r => r.id !== payload.old.id));
          }
          // Refresh today summary when duty records change
          fetchTodaySummary();
        }
      )
      .subscribe();

    return () => {
      subscription.unsubscribe();
    };
  }, [supabaseAvailable, fetchTodaySummary]);

  // Initial fetch
  useEffect(() => {
    if (supabaseAvailable) {
      fetchDutyRecords();
      fetchTodaySummary();
    }
  }, [supabaseAvailable, fetchDutyRecords, fetchTodaySummary]);

  return {
    dutyRecords,
    todaySummary,
    monthlyStats,
    loading,
    error,
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
  };
}
